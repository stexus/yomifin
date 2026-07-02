/*
 * Regression guard for Phase 8 cue-range logic (pure, RN-free): anchoring mpv's live
 * cue to the parsed track, range extension, joined sentence text, and the audio span.
 * Run: bun utils/yomifin/cues.test.ts
 */
import {
  clampRange,
  extendRange,
  findCueIndexByTime,
  rangeLength,
  rangeSpanSec,
  rangeText,
} from "./cues";
import type { SubtitleCue } from "./srt";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
}

const cues: SubtitleCue[] = [
  { index: 1, startMs: 1000, endMs: 3000, text: "最初の行" },
  { index: 2, startMs: 3500, endMs: 6000, text: "二番目の\n行だよ" },
  { index: 3, startMs: 7000, endMs: 9000, text: "三番目。" },
];

// --- findCueIndexByTime ---------------------------------------------------------------

check("exact match", findCueIndexByTime(cues, 3.5, 6.0) === 1);
check(
  "overlap match (drifted by 40ms)",
  findCueIndexByTime(cues, 3.54, 6.04) === 1,
);
check("mid-cue position", findCueIndexByTime(cues, 7.5, 7.5) === 2);
check(
  "no overlap but within tolerance",
  findCueIndexByTime(cues, 6.9, 6.9) === 2, // 100ms before cue 3 starts
);
check("far off-track = -1", findCueIndexByTime(cues, 100, 101) === -1);
check("empty track = -1", findCueIndexByTime([], 1, 2) === -1);
check(
  "best overlap wins over first overlap",
  findCueIndexByTime(cues, 2.9, 5.9) === 1, // overlaps cue1 by 100ms, cue2 by 2400ms
);

// --- range math -------------------------------------------------------------------------

{
  const r = { startIndex: 1, endIndex: 1 };
  check("extend back", extendRange(r, -1, cues.length).startIndex === 0);
  check("extend fwd", extendRange(r, 1, cues.length).endIndex === 2);
  check(
    "extend clamps at track start",
    extendRange({ startIndex: 0, endIndex: 0 }, -1, cues.length).startIndex ===
      0,
  );
  check(
    "extend clamps at track end",
    extendRange({ startIndex: 2, endIndex: 2 }, 1, cues.length).endIndex === 2,
  );
  check("rangeLength", rangeLength({ startIndex: 0, endIndex: 2 }) === 3);
  const clamped = clampRange({ startIndex: -2, endIndex: 99 }, cues.length);
  check(
    "clampRange bounds",
    clamped.startIndex === 0 && clamped.endIndex === 2,
  );
}

// --- text + audio span --------------------------------------------------------------------

check(
  "single-cue text (internal newline joined)",
  rangeText(cues, { startIndex: 1, endIndex: 1 }) === "二番目の行だよ",
);
check(
  "2-cue text joined without separator",
  rangeText(cues, { startIndex: 1, endIndex: 2 }) === "二番目の行だよ三番目。",
);
check("empty track text", rangeText([], { startIndex: 0, endIndex: 0 }) === "");

{
  const span = rangeSpanSec(cues, { startIndex: 1, endIndex: 2 });
  check(
    "2-cue audio span = min start … max end",
    span?.start === 3.5 && span?.end === 9,
    JSON.stringify(span),
  );
  check(
    "single-cue span",
    JSON.stringify(rangeSpanSec(cues, { startIndex: 0, endIndex: 0 })) ===
      JSON.stringify({ start: 1, end: 3 }),
  );
  check(
    "empty track span = null",
    rangeSpanSec([], { startIndex: 0, endIndex: 0 }) === null,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
