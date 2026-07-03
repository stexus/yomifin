/*
 * Regression guard for the Phase 8 word-audio SOURCE logic (pure parts only —
 * wordAudioSources.ts; the network driver wordAudio.ts is device-tested).
 * Run: bun utils/yomifin/wordAudio.test.ts
 */

import { seedFieldTemplates } from "./ankiFieldSeeds";
import {
  audioExtensionForMime,
  base64ToBytes,
  bytesToBase64,
  customAudioUrl,
  extractJishoAudioUrl,
  jpod101Url,
  parseCustomJsonAudio,
} from "./wordAudioSources";

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

// --- jpod101 URL construction (Yomitan semantics) -------------------------------------

check(
  "jpod101 kanji+kana",
  jpod101Url("読む", "よむ") ===
    "https://assets.languagepod101.com/dictionary/japanese/audiomp3.php?kanji=%E8%AA%AD%E3%82%80&kana=%E3%82%88%E3%82%80",
  jpod101Url("読む", "よむ"),
);
check(
  "jpod101 kana-only term sends kana alone",
  jpod101Url("あっさり", "あっさり") ===
    "https://assets.languagepod101.com/dictionary/japanese/audiomp3.php?kana=%E3%81%82%E3%81%A3%E3%81%95%E3%82%8A",
);
check(
  "jpod101 katakana term counts as kana",
  jpod101Url("イケメン", "イケメン").includes("kana=") &&
    !jpod101Url("イケメン", "イケメン").includes("kanji="),
);

// --- jisho scrape extraction ------------------------------------------------------------

const jishoHtml = `
<div class="concept_light">
  <audio id="audio_読む:よむ" preload="none">
    <source src="//d1vjc5dkcd3yh2.cloudfront.net/audio/abc.mp3" type="audio/mpeg">
    <source src="//d1vjc5dkcd3yh2.cloudfront.net/audio_ogg/abc.ogg" type="audio/ogg">
  </audio>
</div>`;

check(
  "jisho extracts + normalizes protocol-relative src",
  extractJishoAudioUrl(jishoHtml, "読む", "よむ") ===
    "https://d1vjc5dkcd3yh2.cloudfront.net/audio/abc.mp3",
);
check(
  "jisho no match = null",
  extractJishoAudioUrl(jishoHtml, "書く", "かく") === null,
);
check(
  "jisho kana-only anchor fallback",
  extractJishoAudioUrl(
    `<audio id="audio_ねこ"><source src="https://x/y.mp3"></audio>`,
    "猫",
    "ねこ",
  ) === "https://x/y.mp3",
);

// --- custom URL + custom JSON --------------------------------------------------------------

check(
  "custom URL substitution",
  customAudioUrl("https://x/a?k={term}&r={reading}", "読む", "よむ") ===
    "https://x/a?k=%E8%AA%AD%E3%82%80&r=%E3%82%88%E3%82%80",
);
check(
  "custom URL {expression} alias",
  customAudioUrl("https://x/{expression}", "猫", "ねこ") ===
    "https://x/%E7%8C%AB",
);
check(
  "custom JSON audioSourceList",
  JSON.stringify(
    parseCustomJsonAudio(
      '{"type":"audioSourceList","audioSources":[{"url":"https://a/1.mp3"},{"url":"https://a/2.mp3"}]}',
    ),
  ) === JSON.stringify(["https://a/1.mp3", "https://a/2.mp3"]),
);
check(
  "custom JSON bare array of strings",
  JSON.stringify(parseCustomJsonAudio('["https://a/1.mp3"]')) ===
    JSON.stringify(["https://a/1.mp3"]),
);
check(
  "custom JSON garbage = []",
  parseCustomJsonAudio("not json").length === 0,
);
check(
  "custom JSON wrong shape = []",
  parseCustomJsonAudio('{"foo":1}').length === 0,
);

// --- mime / base64 helpers -------------------------------------------------------------------

check("mime mp3 default", audioExtensionForMime("audio/mpeg") === "mp3");
check("mime m4a", audioExtensionForMime("audio/mp4") === "m4a");
check("mime null → mp3", audioExtensionForMime(null) === "mp3");

check("base64 empty", bytesToBase64(new Uint8Array([])) === "");
check(
  "base64 known vector",
  bytesToBase64(new Uint8Array([77, 97, 110])) === "TWFu",
);
check("base64 padding 1", bytesToBase64(new Uint8Array([77, 97])) === "TWE=");
check("base64 padding 2", bytesToBase64(new Uint8Array([77])) === "TQ==");

// base64ToBytes round-trips (popup 🔊 playback writes fetched clips to disk)
{
  const cases = [
    new Uint8Array([]),
    new Uint8Array([77]),
    new Uint8Array([77, 97]),
    new Uint8Array([77, 97, 110]),
    new Uint8Array(Array.from({ length: 300 }, (_, i) => (i * 7 + 3) % 256)),
  ];
  let ok = true;
  for (const bytes of cases) {
    const round = base64ToBytes(bytesToBase64(bytes));
    if (round.length !== bytes.length) ok = false;
    else
      for (let i = 0; i < bytes.length; i++)
        if (round[i] !== bytes[i]) ok = false;
  }
  check("base64ToBytes round-trips", ok);
}

// --- field template seeding (ankiConfig heuristics, RN-free shim) ---------------------------

{
  const seeded = seedFieldTemplates([
    "Expression",
    "ExpressionReading",
    "Sentence",
    "SentenceAudio",
    "Glossary",
    "Picture",
    "ExpressionAudio",
    "MiscInfo",
  ]);
  check("seed Expression", seeded.Expression === "{expression}");
  check("seed ExpressionReading", seeded.ExpressionReading === "{reading}");
  check("seed Sentence", seeded.Sentence === "{sentence}");
  check("seed SentenceAudio", seeded.SentenceAudio === "{sentence-audio}");
  check("seed Glossary", seeded.Glossary === "{glossary}");
  check("seed Picture", seeded.Picture === "{picture}");
  check("seed ExpressionAudio", seeded.ExpressionAudio === "{audio}");
  check("seed unknown stays empty", seeded.MiscInfo === "");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
