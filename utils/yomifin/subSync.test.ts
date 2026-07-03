/*
 * Sync estimation tests: recovering a known constant shift between two versions of
 * the same track (with jitter + missing/extra cues), identity, and no-match cases.
 *
 * Run: bun utils/yomifin/subSync.test.ts (or ./scripts/yomifin-test.sh)
 */
import assert from "node:assert/strict";
import type { SubtitleCue } from "./srt";
import { estimateSubtitleOffset } from "./subSync";
import { degradeAndShift, makeTrack, rng } from "./subSyncFixtures";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

test("recovers a +3.21s shift (ext earlier than ref) within fine-step tolerance", () => {
  const ref = makeTrack(1);
  const ext = degradeAndShift(ref, -3210, 2); // ext cues sit 3.21s EARLY
  const est = estimateSubtitleOffset(ref, ext);
  assert.ok(est, "expected a confident estimate");
  assert.ok(
    Math.abs(est.offsetMs - 3210) <= 60,
    `offset ${est.offsetMs} not within 60ms of 3210`,
  );
  assert.ok(est.score > 0.5, `score ${est.score} unexpectedly low`);
});

test("recovers a negative shift (ext late → negative delay)", () => {
  const ref = makeTrack(3);
  const ext = degradeAndShift(ref, 47_500, 4);
  const est = estimateSubtitleOffset(ref, ext);
  assert.ok(est, "expected a confident estimate");
  assert.ok(
    Math.abs(est.offsetMs - -47_500) <= 60,
    `offset ${est.offsetMs} not within 60ms of -47500`,
  );
});

test("aligned tracks → ~0 offset", () => {
  const ref = makeTrack(5);
  const ext = degradeAndShift(ref, 0, 6);
  const est = estimateSubtitleOffset(ref, ext);
  assert.ok(est);
  assert.ok(
    Math.abs(est.offsetMs) <= 60,
    `offset ${est.offsetMs} should be ~0`,
  );
});

test("unrelated tracks → null (no confident match)", () => {
  const ref = makeTrack(7);
  // Sparse unrelated track: little overlap mass at ANY offset.
  const rand = rng(8);
  const ext: SubtitleCue[] = [];
  let t = 2_000;
  for (let i = 0; i < 40; i++) {
    ext.push({ index: i + 1, startMs: t, endMs: t + 400, text: `x${i}` });
    t += 25_000 + Math.floor(rand() * 20_000);
  }
  const est = estimateSubtitleOffset(ref, ext);
  assert.equal(est, null);
});

test("too few cues → null", () => {
  const ref = makeTrack(9);
  assert.equal(estimateSubtitleOffset(ref, ref.slice(0, 3)), null);
  assert.equal(estimateSubtitleOffset(ref.slice(0, 2), ref), null);
  assert.equal(estimateSubtitleOffset([], []), null);
});

console.log(`\nsubSync: all ${passed} tests passed`);
