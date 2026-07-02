/*
 * Regression guard for the Phase 8 marker engine (pure, RN-free).
 * Run: bun utils/yomifin/markers.test.ts
 */
import { furiganaHtml, furiganaPlain } from "./furigana";
import {
  collectMarkers,
  emptyMarkerContext,
  type MarkerContext,
  renderTemplate,
} from "./markers";

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

const ctx: MarkerContext = {
  ...emptyMarkerContext(),
  expression: "読む",
  reading: "よむ",
  furigana: "<ruby>読<rt>よ</rt></ruby>む",
  furiganaPlain: "読[よ]む",
  sentence: "本を読むのが好きだ。",
  clozePrefix: "本を",
  clozeBody: "読む",
  clozeSuffix: "のが好きだ。",
  glossary: "to read\nto guess",
  glossaryByDictionary: {
    "JMdict (English)": "to read",
    大辞泉: "文字を見て意味を理解する",
  },
  conjugation: "-た « potential",
  dictionary: "JMdict (English)",
  tags: "v5m, vt",
  documentTitle: "進撃の巨人 - S1E1",
  audioRef: "[sound:word.mp3]",
  sentenceAudioRef: "[sound:sent.m4a]",
  pictureRef: '<img src="frame.jpg">',
};

// --- basic markers ---------------------------------------------------------------

check("expression", renderTemplate("{expression}", ctx) === "読む");
check("word alias", renderTemplate("{word}", ctx) === "読む");
check("reading", renderTemplate("{reading}", ctx) === "よむ");
check("sentence", renderTemplate("{sentence}", ctx) === "本を読むのが好きだ。");
check("glossary", renderTemplate("{glossary}", ctx) === "to read\nto guess");
check("audio", renderTemplate("{audio}", ctx) === "[sound:word.mp3]");
check(
  "sentence-audio",
  renderTemplate("{sentence-audio}", ctx) === "[sound:sent.m4a]",
);
check("picture", renderTemplate("{picture}", ctx) === '<img src="frame.jpg">');

// --- composition / literals -------------------------------------------------------

check(
  "mixed template",
  renderTemplate("{expression}【{reading}】", ctx) === "読む【よむ】",
);
check(
  "literal text preserved",
  renderTemplate("word: {expression}!", ctx) === "word: 読む!",
);
check(
  "unknown marker left verbatim",
  renderTemplate("{expresion}", ctx) === "{expresion}",
);
check("whitespace tolerated", renderTemplate("{ expression }", ctx) === "読む");

// --- single-glossary ---------------------------------------------------------------

check(
  "single-glossary colon",
  renderTemplate("{single-glossary:JMdict (English)}", ctx) === "to read",
);
check(
  "single-glossary hyphen (Yomitan spelling)",
  renderTemplate("{single-glossary-大辞泉}", ctx) ===
    "文字を見て意味を理解する",
);
check(
  "single-glossary case-insensitive",
  renderTemplate("{single-glossary:jmdict (english)}", ctx) === "to read",
);
check(
  "single-glossary unknown dict = empty",
  renderTemplate("x{single-glossary:Nope}y", ctx) === "xy",
);

// --- selection: EMPTY when nothing selected (no glossary fallback — device feedback) --

check(
  "selection empty renders empty",
  renderTemplate("x{popup-selection-text}y", ctx) === "xy",
);
check("selection alias empty too", renderTemplate("{selection}", ctx) === "");
check(
  "selection-text alias (Yomitan spelling)",
  renderTemplate("{selection-text}", ctx) === "",
);
{
  const withSel = { ...ctx, selectionText: "to read" };
  check(
    "selection set wins",
    renderTemplate("{popup-selection-text}", withSel) === "to read",
  );
}

// --- Yomitan-parity markers ------------------------------------------------------------

check(
  "furigana",
  renderTemplate("{furigana}", ctx) === "<ruby>読<rt>よ</rt></ruby>む",
);
check("furigana-plain", renderTemplate("{furigana-plain}", ctx) === "読[よ]む");
check(
  "cloze reassembles the sentence",
  renderTemplate("{cloze-prefix}{cloze-body}{cloze-suffix}", ctx) ===
    ctx.sentence,
);
check(
  "conjugation",
  renderTemplate("{conjugation}", ctx) === "-た « potential",
);
check("dictionary", renderTemplate("{dictionary}", ctx) === "JMdict (English)");
check("tags", renderTemplate("{tags}", ctx) === "v5m, vt");
check(
  "document-title",
  renderTemplate("{document-title}", ctx) === "進撃の巨人 - S1E1",
);

// --- furigana helpers (vendored distributeFurigana) -------------------------------------

check(
  "furiganaHtml segments kanji only",
  furiganaHtml("読む", "よむ") === "<ruby>読<rt>よ</rt></ruby>む",
  furiganaHtml("読む", "よむ"),
);
check(
  "furiganaPlain kanji only",
  furiganaPlain("読む", "よむ") === "読[よ]む",
  furiganaPlain("読む", "よむ"),
);
check(
  "furiganaPlain space-delimits later segments",
  furiganaPlain("お土産", "おみやげ") === "お 土産[みやげ]",
  furiganaPlain("お土産", "おみやげ"),
);
check(
  "furigana kana word passes through",
  furiganaHtml("ねこ", "ねこ") === "ねこ",
);
check("furigana empty term", furiganaHtml("", "") === "");

// --- empty refs ----------------------------------------------------------------------

check(
  "missing media renders empty",
  renderTemplate("{audio}{picture}", emptyMarkerContext()) === "",
);

// --- collectMarkers ------------------------------------------------------------------

{
  const markers = collectMarkers({
    Expression: "{expression}",
    Sentence: "{sentence}",
    Extra: "{single-glossary:JMdict (English)}",
    Empty: "",
    Audio: "{sentence-audio}",
  });
  check("collect basic", markers.has("expression") && markers.has("sentence"));
  check(
    "collect canonicalizes single-glossary",
    markers.has("single-glossary"),
  );
  check("collect sentence-audio", markers.has("sentence-audio"));
  check("collect no picture", !markers.has("picture"));
  check("collect ignores empty templates", !markers.has(""));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
