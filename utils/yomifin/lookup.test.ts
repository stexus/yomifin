/*
 * Phase 2 integration smoke (REGRESSION GUARD).
 * Exercises the whole harvested stack together:
 *   synthetic Yomitan .zip  →  termBankLoader  →  InMemoryDictionaryDatabase
 *                           →  vendored Translator (deinflection + forward-greedy)
 *                           →  clean lookup() API.
 *
 * Test inputs are "from the tapped token to the END of the line" (exactly what the
 * tap handler will pass), with realistic TRAILING CONTEXT after the target word and
 * multi-step deinflection — so we prove both (a) deinflection chains and (b) that the
 * forward-greedy boundary stops at the right place instead of eating the rest of the line.
 *
 * Run: bun utils/yomifin/lookup.test.ts
 */
import { strToU8, zipSync } from "fflate";
import { InMemoryDictionaryDatabase } from "./InMemoryDictionaryDatabase";
import { YomifinDictionary } from "./lookup";
import { loadDictionaryFromZip } from "./termBankLoader";

const DICT = "SynthJA";

// --- Build a synthetic Yomitan dictionary zip (v3 term banks). ---------------
// tuple: [expression, reading, definitionTags, rules, score, glossary[], sequence, termTags]
type V3 = [
  string,
  string,
  string | null,
  string,
  number,
  unknown[],
  number,
  string,
];
const termBank: V3[] = [
  ["食べる", "たべる", "v1 vt", "v1", 0, ["to eat", "to consume"], 1, ""],
  ["行く", "いく", "v5 vi", "v5", 0, ["to go"], 2, ""],
  ["読む", "よむ", "v5 vt", "v5", 0, ["to read"], 3, ""],
  ["話す", "はなす", "v5 vt", "v5", 0, ["to speak; to talk"], 4, ""],
  ["待つ", "まつ", "v5 vt", "v5", 0, ["to wait"], 5, ""],
  ["来る", "くる", "vk vi", "vk", 0, ["to come"], 6, ""],
  ["泳ぐ", "およぐ", "v5 vi", "v5", 0, ["to swim"], 7, ""],
  ["飲む", "のむ", "v5 vt", "v5", 0, ["to drink"], 8, ""],
  // a reading-only match target + a decoy noun the boundary test must NOT swallow:
  ["本", "ほん", "n", "", 0, ["book"], 9, ""],
  // --- Phase 6 lookup-fidelity fixtures ---------------------------------------
  // あっさり: own adverb entry (must headline) AND, via emphatic collapse (っ removed)
  // → あさり → deinflect → 漁る. Proves textPreprocessors are wired.
  ["あっさり", "あっさり", "adv", "", 0, ["easily; readily; simply"], 10, ""],
  ["漁る", "あさる", "v5 vt", "v5", 0, ["to fish for; to forage"], 11, ""],
  // 計画通り prefix ladder → cycleable panes 計画通り → 計画 → 計.
  ["計画通り", "けいかくどおり", "n", "", 0, ["as planned"], 12, ""],
  ["計画", "けいかく", "n", "", 0, ["plan; project"], 13, ""],
  ["計", "けい", "n", "", 0, ["plan; total"], 14, ""],
  // Reading-match fixture: the written form is イケ面 but the READING is イケメン.
  // Looking up the katakana イケメン must still find this entry (Yomitan indexes by
  // BOTH expression and reading). Proves reading matches surface, not just kanji.
  ["イケ面", "イケメン", "n", "", 0, ["a good-looking guy"], 15, ""],
  // Kana-normalization fixture: reading stored in HIRAGANA (そら). A KATAKANA query
  // ソラ must still find it via the JA text preprocessor (katakana→hiragana variant).
  ["空", "そら", "n", "", 0, ["sky; the heavens"], 16, ""],
];
const zip = zipSync({
  "index.json": strToU8(
    JSON.stringify({
      title: DICT,
      format: 3,
      revision: "synth-1",
      sequenced: true,
    }),
  ),
  "term_bank_1.json": strToU8(JSON.stringify(termBank)),
});

// --- Load it the real way (unzip → parse → index). ---------------------------
const db = new InMemoryDictionaryDatabase();
const loaded = loadDictionaryFromZip(zip, db);

const dict = new YomifinDictionary(db, { dictionaryNames: [DICT] });

// [input from tap to end of line, expected lemma, expected matched surface, expect deinflected?]
const cases: [string, string, string, boolean][] = [
  // brutal chain: causative + passive + tai(want) + negative + past, then trailing から
  ["食べさせられたくなかったから", "食べる", "食べさせられたくなかった", true],
  // must-go (negative-conditional + ならない) resolved by forward-greedy shortening, + trailing んだ
  ["行かなければならないんだ", "行く", "行かなければ", true],
  // te-iru past, boundary must stop BEFORE 本を借りて
  ["読んでいた本を借りて", "読む", "読んでいた", true],
  // tai + negative-conditional, trailing 言って
  ["話したくなければ言って", "話す", "話したくなければ", true],
  // contracted て-iru imperative 待ってて, trailing くださいね
  ["待っててくださいね", "待つ", "待ってて", true],
  // potential/passive negative past, trailing ので
  ["来られなかったので", "来る", "来られなかった", true],
  // 3rd-person desire progressive past (たがる + ている past), trailing のに
  ["泳ぎたがっていたのに", "泳ぐ", "泳ぎたがっていた", true],
  // causative + くれる auxiliary: forward-greedy must stop at 飲ませて (NOT eat くれなかった)
  ["飲ませてくれなかった", "飲む", "飲ませて", true],
  // plain exact word, boundary stops before continuation particle を
  ["本を読んだ", "本", "本", false],
  // Phase 6: あっさり is its own entry and must be the FIRST pane (not bare あ/あっ).
  ["あっさり", "あっさり", "あっさり", false],
  // Phase 6: forward-greedy picks the longest prefix 計画通り as the first pane.
  ["計画通り", "計画通り", "計画通り", false],
  // Reading match: katakana query イケメン resolves the イケ面 entry via its reading.
  ["イケメンだね", "イケ面", "イケメン", false],
  // Kana normalization: katakana query ソラ resolves 空 (reading stored as hiragana そら).
  ["ソラを見て", "空", "ソラ", false],
];

let pass = 0;
let fail = 0;

// loader sanity
if (
  loaded.termCount !== termBank.length ||
  loaded.title !== DICT ||
  db.termCount !== termBank.length
) {
  fail++;
  console.log(
    `  FAIL  loader: termCount=${loaded.termCount} title=${loaded.title} dbCount=${db.termCount}`,
  );
} else {
  pass++;
  console.log(
    `  PASS  loader loaded ${loaded.termCount} terms from ${loaded.termBankFiles} bank(s) as "${loaded.title}"`,
  );
}

for (const [
  input,
  expectedLemma,
  expectedSurface,
  expectDeinflected,
] of cases) {
  const res = await dict.lookup(input);
  const top = res.entries[0];
  const term = top?.term;
  const surfaceOk = res.matchedText === expectedSurface;
  const lemmaOk = term === expectedLemma;
  const glossOk = (top?.definitions?.[0]?.glossary?.length ?? 0) > 0;
  const chainOk = expectDeinflected ? top?.inflectionChain.length > 0 : true;
  const ok = surfaceOk && lemmaOk && glossOk && chainOk;
  if (ok) {
    pass++;
    const chain = top.inflectionChain.length
      ? ` [${top.inflectionChain.join(" ← ")}]`
      : "";
    console.log(
      `  PASS  ${input}  →  ${term} (${top.reading}) "${top.definitions[0].glossary[0]}" matched「${res.matchedText}」${chain}`,
    );
  } else {
    fail++;
    console.log(
      `  FAIL  ${input}  →  term=${term} matched「${res.matchedText}」 (expected ${expectedLemma}/「${expectedSurface}」) surfaceOk=${surfaceOk} lemmaOk=${lemmaOk} glossOk=${glossOk} chainOk=${chainOk}`,
    );
  }
}

// --- Phase 6: pane content (entries beyond entries[0]) -----------------------
// Each of these checks the FULL headword list a lookup surfaces (≈ popup panes):
// the first pane must be `first`, and every lemma in `includes` must appear.
// [input, expected first pane, lemmas that MUST appear]
// Panes mirror Yomitan (ja = letter resolution, group mode, no length filter):
// EVERY prefix length that matches is returned, sorted longest-surface-first. So the
// first pane is the longest headword, and shorter prefixes are present but DEMOTED
// (never headlined) — identical to Yomitan's own ordering.
const paneCases: [string, string, string[]][] = [
  // あっさり headlines; emphatic collapse also surfaces 漁る (via あさり). Bare あ / あっ
  // exist but must NOT be first (they sort last, exactly as Yomitan demotes them).
  ["あっさり", "あっさり", ["あっさり", "漁る"]],
  // 計画通り → cycleable panes 計画通り → 計画 → 計, longest first.
  ["計画通り", "計画通り", ["計画通り", "計画", "計"]],
];

for (const [input, first, includes] of paneCases) {
  const res = await dict.lookup(input);
  const lemmas = res.entries.map((e) => e.term);
  const firstOk = lemmas[0] === first;
  const missing = includes.filter((t) => !lemmas.includes(t));
  const ok = firstOk && missing.length === 0;
  if (ok) {
    pass++;
    console.log(`  PASS  panes ${input}  →  [${lemmas.join(", ")}]`);
  } else {
    fail++;
    console.log(
      `  FAIL  panes ${input}  →  [${lemmas.join(", ")}] firstOk=${firstOk} missing=[${missing.join(", ")}]`,
    );
  }
}

// --- Phase 7: multi-dictionary priority + enable/disable ---------------------
// Two dictionaries define the SAME headword. The order of `dictionaryNames` must
// set the order of the definition blocks (the vendored Translator sorts definition
// groups by the dictionary's index in the enabledDictionaryMap), and omitting a
// dictionary from the list must exclude its block entirely.
function makeDict(title: string, gloss: string) {
  return zipSync({
    "index.json": strToU8(
      JSON.stringify({
        title,
        format: 3,
        revision: "synth-1",
        sequenced: true,
      }),
    ),
    "term_bank_1.json": strToU8(
      JSON.stringify([["猫", "ねこ", "n", "", 0, [gloss], 1, ""]]),
    ),
  });
}
const multiDb = new InMemoryDictionaryDatabase();
loadDictionaryFromZip(makeDict("DictX", "cat (X)"), multiDb);
loadDictionaryFromZip(makeDict("DictY", "cat (Y)"), multiDb);

async function dictOrder(names: string[]): Promise<string[]> {
  const d = new YomifinDictionary(multiDb, { dictionaryNames: names });
  const res = await d.lookup("猫");
  return (res.entries[0]?.definitions ?? []).map((g) => g.dictionary);
}

function checkP7(name: string, cond: boolean, got: string) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}  →  [${got}]`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}  →  [${got}]`);
  }
}
{
  const xy = await dictOrder(["DictX", "DictY"]);
  checkP7("priority X,Y", xy.join(",") === "DictX,DictY", xy.join(", "));
  const yx = await dictOrder(["DictY", "DictX"]);
  checkP7("priority Y,X", yx.join(",") === "DictY,DictX", yx.join(", "));
  const onlyX = await dictOrder(["DictX"]);
  checkP7(
    "disabled Y excluded",
    onlyX.length === 1 && onlyX[0] === "DictX",
    onlyX.join(", "),
  );
}

// --- Yomitan settings parity: maxResults caps the pane count -------------------
// 計画通り surfaces 3 panes uncapped (計画通り → 計画 → 計); maxResults:2 must trim the
// TAIL only — the headline pane and its order are unaffected.
{
  const capped = new YomifinDictionary(db, {
    dictionaryNames: [DICT],
    maxResults: 2,
  });
  const res = await capped.lookup("計画通り");
  const lemmas = res.entries.map((e) => e.term);
  const ok = lemmas.length === 2 && lemmas[0] === "計画通り";
  if (ok) {
    pass++;
    console.log(`  PASS  maxResults=2 計画通り  →  [${lemmas.join(", ")}]`);
  } else {
    fail++;
    console.log(`  FAIL  maxResults=2 計画通り  →  [${lemmas.join(", ")}]`);
  }
}

// --- Chinese parity: language threading, longest-match, script folding ---------
// zh has NO deinflection; matching is exact + forward-greedy. The foldScriptVariants
// preprocessor (ours) must let a query in one script hit an entry stored in the
// other (simplified↔traditional), closing the LOOKUP_FIDELITY §4 divergence.
const ZH_DICT = "SynthZH";
const zhBank: V3[] = [
  // trad-only entry — must be found from a simplified query
  ["漢語", "hànyǔ", "", "", 0, ["Chinese language"], 1, ""],
  // simp-only entry — must be found from a traditional query
  ["词典", "cídiǎn", "", "", 0, ["dictionary"], 2, ""],
  // longest-match ladder
  ["电视机", "diànshìjī", "", "", 0, ["TV set"], 3, ""],
  ["电视", "diànshì", "", "", 0, ["television"], 4, ""],
];
const zhDb = new InMemoryDictionaryDatabase();
loadDictionaryFromZip(
  zipSync({
    "index.json": strToU8(
      JSON.stringify({
        title: ZH_DICT,
        format: 3,
        revision: "synth-1",
        sequenced: true,
      }),
    ),
    "term_bank_1.json": strToU8(JSON.stringify(zhBank)),
  }),
  zhDb,
);
const zhDict = new YomifinDictionary(zhDb, {
  language: "zh",
  dictionaryNames: [ZH_DICT],
});

// [input, expected lemma, expected matched surface]
const zhCases: [string, string, string][] = [
  // simplified query → traditional-stored entry (script folding), boundary before 词典
  ["汉语词典", "漢語", "汉语"],
  // traditional query → simplified-stored entry
  ["詞典很好", "词典", "詞典"],
  // exact same-script still works, longest match wins
  ["电视机很大", "电视机", "电视机"],
];
for (const [input, expectedLemma, expectedSurface] of zhCases) {
  const res = await zhDict.lookup(input);
  const top = res.entries[0];
  const ok = top?.term === expectedLemma && res.matchedText === expectedSurface;
  if (ok) {
    pass++;
    console.log(
      `  PASS  zh ${input}  →  ${top.term} (${top.reading}) matched「${res.matchedText}」`,
    );
  } else {
    fail++;
    console.log(
      `  FAIL  zh ${input}  →  term=${top?.term} matched「${res.matchedText}」 (expected ${expectedLemma}/「${expectedSurface}」)`,
    );
  }
}
// zh longest-match must ALSO surface the shorter prefix as a demoted pane.
{
  const res = await zhDict.lookup("电视机很大");
  const lemmas = res.entries.map((e) => e.term);
  const ok = lemmas[0] === "电视机" && lemmas.includes("电视");
  if (ok) {
    pass++;
    console.log(`  PASS  zh panes 电视机  →  [${lemmas.join(", ")}]`);
  } else {
    fail++;
    console.log(`  FAIL  zh panes 电视机  →  [${lemmas.join(", ")}]`);
  }
}

const total = pass + fail;
console.log(`\n${pass}/${total} passed, ${fail} failed`);
if (fail > 0) throw new Error(`${fail} regression checks failed`);
