/*
 * Regression guard for the shared dictionary importer.
 * Run: bun utils/yomifin/importDictionary.test.ts
 *
 * Proves the runner-agnostic importer (used by both the offline builder and on-device
 * import) (1) parses + transforms a Yomitan zip correctly, (2) is IDEMPOTENT per
 * dictionary (re-import replaces, never duplicates), and (3) feeds SqliteDictionaryDatabase
 * lookups that match expectations. Uses a synthetic in-memory zip so no files are needed;
 * if ./JMdict.zip exists, also imports the real dictionary and checks count + lookups.
 */
import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import {
  importDictionaryFromZip,
  type TermInsertRow,
} from "./importDictionary";
import { YomifinDictionary } from "./lookup";
import {
  SqliteDictionaryDatabase,
  type SqlRunner,
  TERMS_SCHEMA,
  type TermRowRecord,
} from "./SqliteDictionaryDatabase";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}`);
  }
}

/** Make a bun:sqlite-backed import sink + an idempotent onTitleResolved. */
function makeDb() {
  const db = new Database(":memory:");
  db.run(TERMS_SCHEMA);
  const insert = db.prepare(
    "INSERT INTO terms (expression, reading, definitionTags, rules, score, glossary, sequence, termTags, dictionary) VALUES (?,?,?,?,?,?,?,?,?)",
  );
  const insertMany = db.transaction((rows: TermInsertRow[]) => {
    for (const r of rows)
      insert.run(
        r.expression,
        r.reading,
        r.definitionTags,
        r.rules,
        r.score,
        r.glossary,
        r.sequence,
        r.termTags,
        r.dictionary,
      );
  });
  return {
    db,
    sink: { insertBatch: (rows: TermInsertRow[]) => insertMany(rows) },
    clear: (title: string) => {
      db.run("DELETE FROM terms WHERE dictionary = ?", [title]);
    },
    count: () =>
      (db.prepare("SELECT COUNT(*) c FROM terms").get() as { c: number }).c,
    runner: {
      all: (sql: string, params: unknown[]) =>
        db.prepare(sql).all(...(params as never[])) as TermRowRecord[],
    } satisfies SqlRunner,
  };
}

// --- Synthetic Yomitan zip (index.json + one term bank) ---
const synthTerms = [
  ["食べる", "たべる", "v1 vt", "v1", 0, ["to eat"], 1, ""],
  ["本", "", "n", "", 0, ["book"], 2, ""], // empty reading => reading falls back to expression
];
const synthZip = zipSync({
  "index.json": strToU8(
    JSON.stringify({ title: "Synth", revision: "r1", format: 3 }),
  ),
  "term_bank_1.json": strToU8(JSON.stringify(synthTerms)),
});

{
  const { sink, clear, count, runner } = makeDb();
  const r1 = await importDictionaryFromZip(synthZip, sink, {
    onTitleResolved: clear,
  });
  check("synthetic: title from index.json", r1.title === "Synth");
  check("synthetic: termCount = 2", r1.termCount === 2 && count() === 2);

  // empty reading falls back to expression
  const dict = new YomifinDictionary(new SqliteDictionaryDatabase(runner), {
    dictionaryNames: ["Synth"],
  });
  const hon = await dict.lookup("本を読む");
  check(
    "synthetic: 本 reading fell back to expression",
    hon.entries[0]?.reading === "本",
  );
  const taberu = await dict.lookup("食べさせられた");
  check(
    "synthetic: 食べる deinflects + resolves",
    taberu.entries[0]?.term === "食べる",
  );

  // idempotency: import the SAME dictionary again → still 2 rows, not 4
  await importDictionaryFromZip(synthZip, sink, { onTitleResolved: clear });
  check("synthetic: re-import is idempotent (no duplicates)", count() === 2);

  // batchSize splits inserts but yields identical result
  const fresh = makeDb();
  const r3 = await importDictionaryFromZip(synthZip, fresh.sink, {
    onTitleResolved: fresh.clear,
    batchSize: 1,
  });
  check(
    "synthetic: batchSize=1 same count",
    r3.termCount === 2 && fresh.count() === 2,
  );
}

// --- Real JMdict.zip (optional) ---
if (existsSync("./JMdict.zip")) {
  const { sink, clear, count, runner } = makeDb();
  const bytes = new Uint8Array(readFileSync("./JMdict.zip"));
  let lastBank = 0;
  const r = await importDictionaryFromZip(bytes, sink, {
    onTitleResolved: clear,
    onProgress: (p) => {
      lastBank = p.bank;
    },
  });
  check(
    "real: termCount = 523745",
    r.termCount === 523745 && count() === 523745,
  );
  check(
    "real: progress reported all banks",
    lastBank === r.bankCount && r.bankCount > 0,
  );

  // re-import idempotent on the real dict
  await importDictionaryFromZip(bytes, sink, { onTitleResolved: clear });
  check("real: re-import idempotent (still 523745)", count() === 523745);

  const dict = new YomifinDictionary(new SqliteDictionaryDatabase(runner), {
    dictionaryNames: [r.title],
  });
  for (const [inp, lemma] of [
    ["好きじゃなかった", "好き"],
    ["食べさせられたくなかった", "食べる"],
    ["綺麗だった", "綺麗"],
  ] as const) {
    const res = await dict.lookup(inp);
    check(
      `real lookup: ${inp} → ${lemma}`,
      res.entries.some((e) => e.term === lemma),
    );
  }
} else {
  console.log("  SKIP  real JMdict.zip import (./JMdict.zip not present)");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) throw new Error(`${fail} regression checks failed`);
