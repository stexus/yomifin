/*
 * Phase 2 integration smoke: vendored Yomitan Translator + InMemoryDictionaryDatabase.
 * Proves a conjugated JA word resolves to its dictionary entry through deinflection.
 *
 * Run: bun utils/yomifin/lookup.test.ts
 */
// @ts-expect-error — vendored JS (no .d.ts); typed loosely on purpose.

import {
  InMemoryDictionaryDatabase,
  type TermRow,
} from "./InMemoryDictionaryDatabase";
import { Translator } from "./yomitan/translator.js";

const DICT = "TestDict";

const db = new InMemoryDictionaryDatabase();
const rows: Omit<TermRow, "id">[] = [
  {
    expression: "食べる",
    reading: "たべる",
    definitionTags: "v1 vt",
    rules: "v1",
    score: 0,
    glossary: ["to eat"],
    sequence: 1,
    dictionary: DICT,
  },
  {
    expression: "行く",
    reading: "いく",
    definitionTags: "v5 vi",
    rules: "v5",
    score: 0,
    glossary: ["to go"],
    sequence: 2,
    dictionary: DICT,
  },
  {
    expression: "高い",
    reading: "たかい",
    definitionTags: "adj-i",
    rules: "adj-i",
    score: 0,
    glossary: ["high; tall; expensive"],
    sequence: 3,
    dictionary: DICT,
  },
  {
    expression: "読む",
    reading: "よむ",
    definitionTags: "v5 vt",
    rules: "v5",
    score: 0,
    glossary: ["to read"],
    sequence: 4,
    dictionary: DICT,
  },
  {
    expression: "猫",
    reading: "ねこ",
    definitionTags: "n",
    rules: "",
    score: 0,
    glossary: ["cat"],
    sequence: 5,
    dictionary: DICT,
  },
];
db.addTerms(rows);

const translator = new Translator(db as never);
translator.prepare();

const enabledDictionaryMap = new Map([
  [
    DICT,
    {
      index: 0,
      priority: 0,
      allowSecondarySearches: false,
      partsOfSpeechFilter: true,
      useDeinflections: true,
    },
  ],
]);

async function lookup(text: string) {
  const { dictionaryEntries, originalTextLength } = await translator.findTerms(
    "simple",
    text,
    {
      matchType: "exact",
      deinflect: true,
      language: "ja",
      mainDictionary: DICT,
      sortFrequencyDictionary: null,
      sortFrequencyDictionaryOrder: "descending",
      removeNonJapaneseCharacters: false,
      textReplacements: [null],
      enabledDictionaryMap,
      excludeDictionaryDefinitions: null,
      searchResolution: "letter",
      primaryReading: "",
      useAllFrequencyDictionaries: false,
    } as never,
  );
  return { dictionaryEntries, originalTextLength };
}

// [input (from tap to end of line), expected lemma, expected matched length]
const cases: [string, string, number][] = [
  ["猫が", "猫", 1],
  ["食べた", "食べる", 3],
  ["食べさせられた", "食べる", 7],
  ["行きました", "行く", 5],
  ["高かったです", "高い", 4],
  ["読まなかった本", "読む", 6],
];

let pass = 0;
let fail = 0;
for (const [input, expectedLemma, expectedLen] of cases) {
  const { dictionaryEntries, originalTextLength } = await lookup(input);
  const headword =
    dictionaryEntries[0]?.headwords?.[0]?.term ?? dictionaryEntries[0]?.term;
  const gloss = JSON.stringify(
    dictionaryEntries[0]?.definitions?.[0]?.entries ??
      dictionaryEntries[0]?.definitions?.[0]?.glossary ??
      "",
  );
  const ok = headword === expectedLemma && originalTextLength === expectedLen;
  if (ok) {
    pass++;
    console.log(
      `  PASS  ${input}  ->  ${headword}  (matched ${originalTextLength}) ${gloss}`,
    );
  } else {
    fail++;
    console.log(
      `  FAIL  ${input}  ->  got headword=${headword} len=${originalTextLength} (expected ${expectedLemma}/${expectedLen}); entries=${dictionaryEntries.length}`,
    );
  }
}

console.log(`\n${pass}/${cases.length} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
