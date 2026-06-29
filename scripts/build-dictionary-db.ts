/*
 * Offline builder: Yomitan dictionary .zip  →  indexed SQLite .db.
 *
 * Runs on the dev machine with bun (fast bun:sqlite + JSON parse), so the device never
 * has to parse 170MB of JSON. Ship/serve the resulting .db; the app opens it and runs
 * indexed lookups (see SqliteDictionaryDatabase). Supports multiple dictionaries in one
 * .db (run repeatedly with different zips + the same --out to add more).
 *
 * Usage:
 *   bun scripts/build-dictionary-db.ts --zip JMdict.zip --out assets/dictionaries/dictionaries.db [--title "Name"]
 */
import { Database } from "bun:sqlite";
import { strFromU8, unzipSync } from "fflate";
import { TERMS_SCHEMA } from "../utils/yomifin/SqliteDictionaryDatabase";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const zipPath = arg("zip");
const outPath = arg("out");
const overrideTitle = arg("title");
if (!zipPath || !outPath) {
  console.error(
    "usage: bun scripts/build-dictionary-db.ts --zip <dict.zip> --out <db path> [--title <name>]",
  );
  process.exit(2);
}

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

const t0 = Date.now();
const zip = unzipSync(new Uint8Array(await Bun.file(zipPath).arrayBuffer()));

const index = JSON.parse(strFromU8(zip["index.json"])) as { title: string };
const title = overrideTitle ?? index.title;
if (!title) throw new Error("dictionary index.json has no title");

const db = new Database(outPath, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA synchronous = NORMAL;");
db.run(TERMS_SCHEMA);
db.run(
  "CREATE TABLE IF NOT EXISTS dictionaries (title TEXT PRIMARY KEY, revision TEXT, termCount INTEGER)",
);

const insert = db.prepare(
  "INSERT INTO terms (expression, reading, definitionTags, rules, score, glossary, sequence, termTags, dictionary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
);

const bankNames = Object.keys(zip)
  .filter((n) => /^term_bank_\d+\.json$/.test(n))
  .sort();

let count = 0;
const insertMany = db.transaction((rows: V3[]) => {
  for (const [
    expression,
    reading,
    definitionTags,
    rules,
    score,
    glossary,
    sequence,
    termTags,
  ] of rows) {
    insert.run(
      expression,
      reading.length > 0 ? reading : expression,
      definitionTags,
      rules,
      score,
      JSON.stringify(glossary),
      sequence,
      termTags,
      title,
    );
    count++;
  }
});

for (const name of bankNames) {
  const entries = JSON.parse(strFromU8(zip[name])) as V3[];
  insertMany(entries);
  process.stdout.write(`\r  ${name} → ${count} terms`);
}
process.stdout.write("\n");

db.run(
  "INSERT OR REPLACE INTO dictionaries (title, revision, termCount) VALUES (?, ?, ?)",
  [title, (index as { revision?: string }).revision ?? "", count],
);

// Indices are in TERMS_SCHEMA; ANALYZE helps the planner.
db.exec("ANALYZE;");
db.close();

const sizeMb = (Bun.file(outPath).size / 1e6).toFixed(1);
console.log(
  `built "${title}": ${count} terms from ${bankNames.length} banks → ${outPath} (${sizeMb}MB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
);
