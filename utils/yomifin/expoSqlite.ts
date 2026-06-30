/*
 * expo-sqlite glue for the device dictionary backend (DEVICE-ONLY: imports the native
 * expo-sqlite module, so this is not used in bun tests).
 *
 * Provides:
 *   - makeSqlRunner: the narrow SqlRunner that SqliteDictionaryDatabase needs for
 *     lookups (one indexed SELECT; sub-ms on a 215MB JMdict.db).
 *   - ensureSchema + makeImportSink: the write side used by on-device import, driving
 *     the SHARED importDictionary.ts so device imports match the offline builder exactly.
 */
import type { SQLiteBindParams, SQLiteDatabase } from "expo-sqlite";
import type { ImportSink, TermInsertRow } from "./importDictionary";
import {
  type SqlRunner,
  TERMS_SCHEMA,
  type TermRowRecord,
} from "./SqliteDictionaryDatabase";

/** Tracks installed dictionaries (mirrors the offline builder's table). */
export const DICTIONARIES_SCHEMA =
  "CREATE TABLE IF NOT EXISTS dictionaries (title TEXT PRIMARY KEY, revision TEXT, termCount INTEGER)";

/** Read-only SELECT executor over an open expo-sqlite database. */
export function makeSqlRunner(db: SQLiteDatabase): SqlRunner {
  return {
    all: (sql, params) =>
      db.getAllSync<TermRowRecord>(sql, params as SQLiteBindParams),
  };
}

/** Create the terms + dictionaries tables/indices if missing. */
export function ensureSchema(db: SQLiteDatabase): void {
  db.execSync(TERMS_SCHEMA);
  db.execSync(DICTIONARIES_SCHEMA);
}

const INSERT_SQL =
  "INSERT INTO terms (expression, reading, definitionTags, rules, score, glossary, sequence, termTags, dictionary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";

/**
 * Build an ImportSink backed by a prepared INSERT statement. Each batch (one term bank)
 * runs in a single transaction. Call `finalize()` after the import to release the
 * statement. Tuned to keep memory flat and the iPad UI responsive (the caller passes a
 * yieldToEventLoop between banks).
 */
export function makeImportSink(db: SQLiteDatabase): {
  sink: ImportSink;
  finalize: () => void;
} {
  const stmt = db.prepareSync(INSERT_SQL);
  const sink: ImportSink = {
    insertBatch(rows: TermInsertRow[]) {
      db.withTransactionSync(() => {
        for (const r of rows) {
          stmt.executeSync([
            r.expression,
            r.reading,
            r.definitionTags,
            r.rules,
            r.score,
            r.glossary,
            r.sequence,
            r.termTags,
            r.dictionary,
          ]);
        }
      });
    },
  };
  return { sink, finalize: () => stmt.finalizeSync() };
}
