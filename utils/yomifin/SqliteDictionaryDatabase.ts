/*
 * SQLite-backed implementation of the Translator's DictionaryDatabase interface.
 *
 * This is the device storage path (replaces the in-memory load that was ~300MB heap /
 * minutes-to-parse). The terms live on disk in an indexed table; a lookup is a single
 * indexed query returning only the handful of candidate rows, which are then assembled
 * into Translator results by the SHARED termMatching.ts logic (so results are identical
 * to the in-memory backend — proven in SqliteDictionaryDatabase.test.ts).
 *
 * Storage is abstracted behind `SqlRunner` so the SAME class runs on:
 *   - bun:sqlite (tests, and the offline DB builder), and
 *   - expo-sqlite (device) — see makeExpoSqlRunner (device-only, separate file).
 */
import {
  assembleTermEntries,
  type DictionarySet,
  type TermEntryResult,
  type TermRow,
} from "./termMatching";

/** Raw `terms` row as stored (glossary is JSON text on disk). */
export interface TermRowRecord {
  id: number;
  expression: string;
  reading: string;
  definitionTags: string | null;
  rules: string;
  score: number;
  glossary: string; // JSON
  sequence: number | null;
  termTags: string | null;
  dictionary: string;
}

/** Minimal SELECT executor; sync (bun) or async (expo) both fit. */
export interface SqlRunner {
  all(
    sql: string,
    params: unknown[],
  ): TermRowRecord[] | Promise<TermRowRecord[]>;
}

/** `terms` table DDL + indices, shared by the builder and any importer. */
export const TERMS_SCHEMA = `
CREATE TABLE IF NOT EXISTS terms (
  id INTEGER PRIMARY KEY,
  expression TEXT NOT NULL,
  reading TEXT NOT NULL,
  definitionTags TEXT,
  rules TEXT NOT NULL DEFAULT '',
  score REAL NOT NULL DEFAULT 0,
  glossary TEXT NOT NULL,
  sequence INTEGER,
  termTags TEXT,
  dictionary TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_terms_expression ON terms(expression);
CREATE INDEX IF NOT EXISTS idx_terms_reading ON terms(reading);
`;

function recordToRow(r: TermRowRecord): TermRow {
  let glossary: unknown[];
  try {
    glossary = JSON.parse(r.glossary);
  } catch {
    glossary = [r.glossary];
  }
  return {
    id: r.id,
    expression: r.expression,
    reading: r.reading,
    definitionTags: r.definitionTags,
    rules: r.rules,
    score: r.score,
    glossary,
    sequence: r.sequence ?? undefined,
    termTags: r.termTags ?? undefined,
    dictionary: r.dictionary,
  };
}

export class SqliteDictionaryDatabase {
  constructor(private _runner: SqlRunner) {}

  async findTermsBulk(
    termList: string[],
    dictionaries: DictionarySet,
    matchType: "exact" | "prefix" | "suffix" = "exact",
  ): Promise<TermEntryResult[]> {
    if (matchType !== "exact" || termList.length === 0) return [];
    // Unique placeholders for expression OR reading match.
    const placeholders = termList.map(() => "?").join(",");
    const sql =
      `SELECT id, expression, reading, definitionTags, rules, score, glossary, sequence, termTags, dictionary ` +
      `FROM terms WHERE expression IN (${placeholders}) OR reading IN (${placeholders})`;
    const records = await this._runner.all(sql, [...termList, ...termList]);
    const candidates = records.map(recordToRow);
    return assembleTermEntries(termList, candidates, dictionaries);
  }

  // --- Remaining interface: stubbed (same as in-memory) ---
  findTermsExactBulk(): TermEntryResult[] {
    return [];
  }
  findTermsBySequenceBulk(): TermEntryResult[] {
    return [];
  }
  findTermMetaBulk(): unknown[] {
    return [];
  }
  findTagMetaBulk(): unknown[] {
    return [];
  }
  findKanjiBulk(): unknown[] {
    return [];
  }
  findKanjiMetaBulk(): unknown[] {
    return [];
  }
  getDictionaryInfo(): unknown[] {
    return [];
  }
}
