/*
 * Regression guard for content-derived media keys (media dedup / batch mining).
 * Run: bun utils/yomifin/mediaKey.test.ts
 */
import {
  audioMediaKey,
  fnv1a,
  imageMediaKey,
  quantizeSec,
  wordAudioKey,
} from "./mediaKey";

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

// fnv1a basics
const h1 = fnv1a("abc");
const h2 = fnv1a("abc");
check("fnv1a deterministic", h1 === h2);
check("fnv1a distinguishes inputs", fnv1a("abc") !== fnv1a("abd"));
check("fnv1a 8 hex chars", /^[0-9a-f]{8}$/.test(fnv1a("読む")));
check("fnv1a empty ok", /^[0-9a-f]{8}$/.test(fnv1a("")));

// quantization: 250ms buckets kill float jitter
check("quantize same bucket", quantizeSec(12.301) === quantizeSec(12.32));
check("quantize different bucket", quantizeSec(12.3) !== quantizeSec(12.6));

// image keys: same item + ~same frame → same file
check(
  "image key stable under jitter",
  imageMediaKey("item1", 100.301) === imageMediaKey("item1", 100.32),
);
check(
  "image key differs across items",
  imageMediaKey("item1", 100.3) !== imageMediaKey("item2", 100.3),
);
check(
  "image key differs across positions",
  imageMediaKey("item1", 100.3) !== imageMediaKey("item1", 130.3),
);

// audio keys: keyed on the SELECTED cue range (1-line vs 2-line selections differ)
check(
  "audio key stable for same range",
  audioMediaKey("item1", 10.0, 12.5) === audioMediaKey("item1", 10.001, 12.499),
);
check(
  "audio key: extended range differs",
  audioMediaKey("item1", 10.0, 12.5) !== audioMediaKey("item1", 10.0, 15.5),
);
check(
  "audio key differs across items",
  audioMediaKey("a", 10, 12) !== audioMediaKey("b", 10, 12),
);
check(
  "audio and image keys never collide in name-space",
  imageMediaKey("item1", 10) !== audioMediaKey("item1", 10, 10),
);

// word audio keys
const w1 = wordAudioKey("読む", "よむ");
const w2 = wordAudioKey("読む", "よむ");
check("word key stable", w1 === w2);
check(
  "word key distinguishes readings",
  wordAudioKey("方", "かた") !== wordAudioKey("方", "ほう"),
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
