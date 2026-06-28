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

console.log(`\n${pass}/${cases.length + 1} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
