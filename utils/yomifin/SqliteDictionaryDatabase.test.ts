/*
 * Regression guard for the SQLite dictionary backend.
 * Run: bun utils/yomifin/SqliteDictionaryDatabase.test.ts
 *
 * Proves (1) SqliteDictionaryDatabase drives the Translator correctly via real SQL,
 * and (2) it returns IDENTICAL lookups to the in-memory backend (parity), using the
 * same complex sentences as lookup.test.ts. Uses an in-process bun:sqlite DB so no
 * external file is needed. If /tmp/JMdict.db exists (from build-dictionary-db.ts),
 * also runs a few real-data lookups + query timing.
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { InMemoryDictionaryDatabase } from "./InMemoryDictionaryDatabase";
import { YomifinDictionary } from "./lookup";
import {
  SqliteDictionaryDatabase,
  type SqlRunner,
  TERMS_SCHEMA,
  type TermRowRecord,
} from "./SqliteDictionaryDatabase";
import type { TermRow } from "./termMatching";

const DICT = "SynthJA";

// Same synthetic dictionary as lookup.test.ts.
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
    expression: "読む",
    reading: "よむ",
    definitionTags: "v5 vt",
    rules: "v5",
    score: 0,
    glossary: ["to read"],
    sequence: 3,
    dictionary: DICT,
  },
  {
    expression: "話す",
    reading: "はなす",
    definitionTags: "v5 vt",
    rules: "v5",
    score: 0,
    glossary: ["to speak"],
    sequence: 4,
    dictionary: DICT,
  },
  {
    expression: "待つ",
    reading: "まつ",
    definitionTags: "v5 vt",
    rules: "v5",
    score: 0,
    glossary: ["to wait"],
    sequence: 5,
    dictionary: DICT,
  },
  {
    expression: "来る",
    reading: "くる",
    definitionTags: "vk vi",
    rules: "vk",
    score: 0,
    glossary: ["to come"],
    sequence: 6,
    dictionary: DICT,
  },
  {
    expression: "泳ぐ",
    reading: "およぐ",
    definitionTags: "v5 vi",
    rules: "v5",
    score: 0,
    glossary: ["to swim"],
    sequence: 7,
    dictionary: DICT,
  },
  {
    expression: "飲む",
    reading: "のむ",
    definitionTags: "v5 vt",
    rules: "v5",
    score: 0,
    glossary: ["to drink"],
    sequence: 8,
    dictionary: DICT,
  },
  {
    expression: "本",
    reading: "ほん",
    definitionTags: "n",
    rules: "",
    score: 0,
    glossary: ["book"],
    sequence: 9,
    dictionary: DICT,
  },
];

// --- Build an in-process SQLite DB and wrap it. ---
const sqlite = new Database(":memory:");
sqlite.run(TERMS_SCHEMA);
const insert = sqlite.prepare(
  "INSERT INTO terms (expression, reading, definitionTags, rules, score, glossary, sequence, termTags, dictionary) VALUES (?,?,?,?,?,?,?,?,?)",
);
for (const r of rows) {
  insert.run(
    r.expression,
    r.reading,
    r.definitionTags,
    r.rules,
    r.score,
    JSON.stringify(r.glossary),
    r.sequence ?? null,
    r.termTags ?? null,
    r.dictionary,
  );
}
const runner: SqlRunner = {
  all: (sql, params) =>
    sqlite.prepare(sql).all(...(params as never[])) as TermRowRecord[],
};
const sqliteDb = new SqliteDictionaryDatabase(runner);
const sqliteDict = new YomifinDictionary(sqliteDb, { dictionaryNames: [DICT] });

// In-memory reference for parity.
const memDb = new InMemoryDictionaryDatabase();
memDb.addTerms(rows);
const memDict = new YomifinDictionary(memDb, { dictionaryNames: [DICT] });

const cases: [string, string, string][] = [
  ["食べさせられたくなかったから", "食べる", "食べさせられたくなかった"],
  ["行かなければならないんだ", "行く", "行かなければ"],
  ["読んでいた本を借りて", "読む", "読んでいた"],
  ["話したくなければ言って", "話す", "話したくなければ"],
  ["待っててくださいね", "待つ", "待ってて"],
  ["来られなかったので", "来る", "来られなかった"],
  ["泳ぎたがっていたのに", "泳ぐ", "泳ぎたがっていた"],
  ["飲ませてくれなかった", "飲む", "飲ませて"],
  ["本を読んだ", "本", "本"],
];

let pass = 0;
let fail = 0;
for (const [input, lemma, surface] of cases) {
  const s = await sqliteDict.lookup(input);
  const m = await memDict.lookup(input);
  const sTerm = s.entries[0]?.term;
  const correct = sTerm === lemma && s.matchedText === surface;
  // parity: sqlite result must equal in-memory result
  const parity =
    sTerm === m.entries[0]?.term &&
    s.matchedText === m.matchedText &&
    JSON.stringify(s.entries[0]?.definitions) ===
      JSON.stringify(m.entries[0]?.definitions);
  if (correct && parity) {
    pass++;
    console.log(
      `  PASS  ${input} → ${sTerm} 「${s.matchedText}」 (= in-memory)`,
    );
  } else {
    fail++;
    console.log(
      `  FAIL  ${input} → sqlite=${sTerm}/「${s.matchedText}」 mem=${m.entries[0]?.term}/「${m.matchedText}」 correct=${correct} parity=${parity}`,
    );
  }
}

// --- Optional: real JMdict.db lookups + timing. ---
if (existsSync("/tmp/JMdict.db")) {
  const real = new Database("/tmp/JMdict.db", { readonly: true });
  const realRunner: SqlRunner = {
    all: (sql, params) =>
      real.prepare(sql).all(...(params as never[])) as TermRowRecord[],
  };
  const realDb = new SqliteDictionaryDatabase(realRunner);
  // discover the dictionary title
  const title = (
    real.prepare("SELECT title FROM dictionaries LIMIT 1").get() as {
      title: string;
    }
  ).title;
  const realDict = new YomifinDictionary(realDb, { dictionaryNames: [title] });
  let maxMs = 0;
  for (const inp of [
    "好きじゃなかった",
    "食べさせられたくなかった",
    "飲ませてくれなかった",
    "綺麗だった",
  ]) {
    const t = performance.now();
    const r = await realDict.lookup(inp);
    maxMs = Math.max(maxMs, performance.now() - t);
    const ok = (r.entries[0]?.term?.length ?? 0) > 0;
    if (ok) pass++;
    else fail++;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  [real] ${inp} → ${r.entries[0]?.term}「${r.matchedText}」`,
    );
  }
  console.log(`  (real JMdict.db lookups, slowest ${maxMs.toFixed(1)}ms)`);
} else {
  console.log(
    "  SKIP  real JMdict.db lookups (/tmp/JMdict.db not present — run build-dictionary-db.ts)",
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
