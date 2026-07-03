#!/usr/bin/env bun
/*
 * Cross-validate utils/yomifin/subSync.ts against the REAL alass
 * (https://github.com/kaegi/alass, `brew install alass` → alass-cli).
 *
 * Why this exists: the on-device sync estimator is necessarily our own TS (ffsubsync
 * is Python+VAD, alass is Rust, Hermes has no wasm — see FEATURES.md), but its
 * correctness contract is "agrees with alass's no-split mode". This harness makes
 * that contract executable:
 *
 *   1. SYNTHETIC pairs: generate ref tracks + shifted/jittered/degraded copies with
 *      KNOWN offsets (same generator as subSync.test.ts), run
 *      `alass-cli --no-split --disable-fps-guessing` on the SRT files, and require
 *      BOTH alass and estimateSubtitleOffset to land within tolerance of the truth
 *      AND of each other.
 *   2. REAL pairs (optional): drop `<name>.ref.srt` + `<name>.inc.{srt,ass}` into
 *      scripts/sync-fixtures/ (e.g. a Jellyfin track + the jimaku file for the same
 *      episode) and the harness compares our estimate against alass's correction.
 *      If alass applies a NON-constant correction (fps drift — spread across cues),
 *      it reports that our constant-offset model can't express the pair instead of
 *      hard-failing (that's a documented model limitation, not a bug).
 *
 * Dev-box only (never ships). Skips cleanly when alass-cli isn't installed, so
 * yomifin-test.sh can always invoke it.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSrt, type SubtitleCue } from "../utils/yomifin/srt";
import { estimateSubtitleOffset } from "../utils/yomifin/subSync";
import {
  cuesToSrt,
  degradeAndShift,
  makeTrack,
} from "../utils/yomifin/subSyncFixtures";
import { parseSubtitleText } from "../utils/yomifin/subtitleParse";

/** |ours − alass| and |x − truth| must be within this. Sub-200ms is imperceptible. */
const TOLERANCE_MS = 150;
/** Per-cue correction spread above this ⇒ alass applied a non-constant correction. */
const CONSTANT_SPREAD_MS = 200;

const FIXTURES_DIR = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "sync-fixtures",
);

function findAlass(): string | null {
  for (const cand of ["alass-cli", "alass", "/opt/homebrew/bin/alass-cli"]) {
    const r = spawnSync(cand, ["--version"], { encoding: "utf-8" });
    if (r.status === 0) return cand;
  }
  return null;
}

/** Run alass on two SRT paths; return the corrected cues. */
function runAlass(
  alass: string,
  refPath: string,
  incPath: string,
): SubtitleCue[] {
  const outPath = incPath.replace(/(\.[^.]+)?$/, ".corrected.srt");
  const r = spawnSync(
    alass,
    ["--no-split", "--disable-fps-guessing", refPath, incPath, outPath],
    { encoding: "utf-8" },
  );
  if (r.status !== 0) {
    throw new Error(`alass failed: ${r.stderr || r.stdout}`);
  }
  return parseSrt(readFileSync(outPath, "utf-8"));
}

/**
 * The correction alass applied: per-cue start deltas (corrected − input), matched by
 * index (no-split preserves the cue list). Returns median + spread (p90 − p10).
 */
function appliedCorrection(
  input: SubtitleCue[],
  corrected: SubtitleCue[],
): { medianMs: number; spreadMs: number } {
  const n = Math.min(input.length, corrected.length);
  const deltas: number[] = [];
  for (let i = 0; i < n; i++)
    deltas.push(corrected[i].startMs - input[i].startMs);
  deltas.sort((a, b) => a - b);
  const q = (p: number) => deltas[Math.floor(p * (deltas.length - 1))];
  return { medianMs: q(0.5), spreadMs: q(0.9) - q(0.1) };
}

function fmt(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "  (none)";
  return `${ms >= 0 ? "+" : ""}${(ms / 1000).toFixed(3)}s`;
}

const alass = findAlass();
if (!alass) {
  console.log(
    "⤷ skipped: alass-cli not installed (brew install alass) — subSync cross-check needs it",
  );
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), "yomifin-sync-"));
let failures = 0;

try {
  // ── 1. synthetic pairs with known truth ─────────────────────────────────────
  // Track starts at 100s so even a -90s shift keeps timestamps positive (alass
  // clamps negative output timestamps, which would corrupt the comparison).
  const CASES: { shiftMs: number; seed: number }[] = [
    { shiftMs: 0, seed: 11 },
    { shiftMs: -1234, seed: 12 },
    { shiftMs: 3210, seed: 13 },
    { shiftMs: -15000, seed: 14 },
    { shiftMs: 47500, seed: 15 },
    { shiftMs: -90000, seed: 16 },
  ];

  console.log(
    `synthetic pairs (truth = -shift; tolerance ±${TOLERANCE_MS}ms):`,
  );
  for (const { shiftMs, seed } of CASES) {
    const ref = makeTrack(seed, 300, 100_000);
    const inc = degradeAndShift(ref, shiftMs, seed + 100);
    const truthMs = -shiftMs; // offset to ADD to `inc` to reach `ref`

    const refPath = join(tmp, `ref-${seed}.srt`);
    const incPath = join(tmp, `inc-${seed}.srt`);
    writeFileSync(refPath, cuesToSrt(ref));
    writeFileSync(incPath, cuesToSrt(inc));

    const corrected = runAlass(alass, refPath, incPath);
    const alassMs = appliedCorrection(inc, corrected).medianMs;
    const ours = estimateSubtitleOffset(ref, inc);
    const oursMs = ours?.offsetMs ?? null;

    const okOurs =
      oursMs !== null && Math.abs(oursMs - truthMs) <= TOLERANCE_MS;
    const okAlass = Math.abs(alassMs - truthMs) <= TOLERANCE_MS;
    const okAgree =
      oursMs !== null && Math.abs(oursMs - alassMs) <= TOLERANCE_MS;
    const ok = okOurs && okAlass && okAgree;
    if (!ok) failures++;
    console.log(
      `  ${ok ? "✓" : "✗"} truth ${fmt(truthMs).padStart(9)} | alass ${fmt(alassMs).padStart(9)} | ours ${fmt(oursMs).padStart(9)}${
        ours ? ` (score ${ours.score.toFixed(2)})` : ""
      }`,
    );
  }

  // ── 2. real-world pairs (optional drop-in fixtures) ─────────────────────────
  if (existsSync(FIXTURES_DIR)) {
    const names = readdirSync(FIXTURES_DIR)
      .filter((f) => /\.ref\.srt$/.test(f))
      .map((f) => f.replace(/\.ref\.srt$/, ""));
    if (names.length > 0)
      console.log(
        `\nreal fixtures (${FIXTURES_DIR}), no ground truth — comparing to alass:`,
      );
    for (const name of names) {
      const incName = readdirSync(FIXTURES_DIR).find((f) =>
        new RegExp(`^${name}\\.inc\\.(srt|ass|ssa)$`).test(f),
      );
      if (!incName) {
        console.log(`  ? ${name}: no matching .inc.{srt,ass} file`);
        continue;
      }
      const refPath = join(FIXTURES_DIR, `${name}.ref.srt`);
      const incPathOrig = join(FIXTURES_DIR, incName);
      const ref = parseSrt(readFileSync(refPath, "utf-8"));
      const incRaw = readFileSync(incPathOrig, "utf-8");
      const inc = parseSubtitleText(incRaw, incName);

      // Give alass a normalized SRT of the SAME cues we estimate on, so the
      // comparison is apples-to-apples (and .ass quirks don't diverge the inputs).
      const incPath = join(tmp, `${name}.inc.srt`);
      writeFileSync(incPath, cuesToSrt(inc));

      const corrected = runAlass(alass, refPath, incPath);
      const { medianMs: alassMs, spreadMs } = appliedCorrection(inc, corrected);
      const ours = estimateSubtitleOffset(ref, inc);
      const oursMs = ours?.offsetMs ?? null;

      if (spreadMs > CONSTANT_SPREAD_MS) {
        console.log(
          `  ! ${name}: alass applied a NON-constant correction (spread ${spreadMs}ms) — constant-offset model can't express this pair (alass median ${fmt(alassMs)}, ours ${fmt(oursMs)})`,
        );
        continue;
      }
      const ok = oursMs !== null && Math.abs(oursMs - alassMs) <= TOLERANCE_MS;
      if (!ok) failures++;
      console.log(
        `  ${ok ? "✓" : "✗"} ${name}: alass ${fmt(alassMs)} | ours ${fmt(oursMs)}${
          ours ? ` (score ${ours.score.toFixed(2)})` : ""
        }`,
      );
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n✗ subSync disagrees with alass on ${failures} pair(s)`);
  process.exit(1);
}
console.log("\nsubSync ↔ alass cross-check: all pairs agree");
