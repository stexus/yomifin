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
import {
  importDictionaryFromZip,
  type TermInsertRow,
} from "../utils/yomifin/importDictionary";
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

const t0 = Date.now();

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
const insertMany = db.transaction((rows: TermInsertRow[]) => {
  for (const r of rows) {
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
  }
});

const zipBytes = new Uint8Array(await Bun.file(zipPath).arrayBuffer());
const result = await importDictionaryFromZip(
  zipBytes,
  { insertBatch: (rows) => insertMany(rows) },
  {
    title: overrideTitle,
    // Idempotent: replace this dictionary's rows if it was imported before.
    onTitleResolved: (title) =>
      db.run("DELETE FROM terms WHERE dictionary = ?", [title]),
    onProgress: (p) =>
      process.stdout.write(
        `\r  bank ${p.bank}/${p.totalBanks} → ${p.terms} terms`,
      ),
  },
);
process.stdout.write("\n");

db.run(
  "INSERT OR REPLACE INTO dictionaries (title, revision, termCount) VALUES (?, ?, ?)",
  [result.title, result.revision, result.termCount],
);

// Indices are in TERMS_SCHEMA; ANALYZE helps the planner.
db.exec("ANALYZE;");
// Finalize as a SINGLE self-contained file: checkpoint the WAL and switch back to the
// rollback journal so the .db can be copied/shipped/opened read-only without sidecars.
db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
db.exec("PRAGMA journal_mode = DELETE;");
db.close();

const sizeMb = (Bun.file(outPath).size / 1e6).toFixed(1);
console.log(
  `built "${result.title}": ${result.termCount} terms from ${result.bankCount} banks → ${outPath} (${sizeMb}MB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
);
