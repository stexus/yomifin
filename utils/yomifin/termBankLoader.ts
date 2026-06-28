/*
 * Minimal Yomitan dictionary loader: unzip a .zip dictionary and feed its term banks
 * into an InMemoryDictionaryDatabase. This is the crude in-memory load the MVP calls
 * for (PHASE2_YOMITAN.md) — NOT the full Yomitan importer (no media, no schema
 * validation, no kanji/meta banks, no SQLite). Those are later phases.
 *
 * Term-bank v3 tuple (dictionary-term-bank-v3-schema.json):
 *   [expression, reading, definitionTags|null, rules, score, glossary[], sequence, termTags]
 * Yomitan convention: reading === '' means the reading equals the expression.
 */
import { strFromU8, unzipSync } from "fflate";
import type {
  InMemoryDictionaryDatabase,
  TermRow,
} from "./InMemoryDictionaryDatabase";

export interface DictionaryIndex {
  title: string;
  revision?: string;
  format?: number;
  version?: number;
  sequenced?: boolean;
}

export interface LoadResult {
  title: string;
  termCount: number;
  termBankFiles: number;
}

/** A single v3 term-bank tuple. */
type TermBankV3Entry = [
  expression: string,
  reading: string,
  definitionTags: string | null,
  rules: string,
  score: number,
  glossary: unknown[],
  sequence: number,
  termTags: string,
];

/**
 * Parse a Yomitan dictionary zip and add all of its terms to `db`.
 * @param zipData raw bytes of the .zip
 * @param db target in-memory database
 * @param overrideTitle use this dictionary name instead of index.json's title
 */
export function loadDictionaryFromZip(
  zipData: Uint8Array,
  db: InMemoryDictionaryDatabase,
  overrideTitle?: string,
): LoadResult {
  const files = unzipSync(zipData);

  const indexRaw = files["index.json"];
  if (!indexRaw) {
    throw new Error("Invalid Yomitan dictionary: index.json not found in zip");
  }
  const index = JSON.parse(strFromU8(indexRaw)) as DictionaryIndex;
  const title = overrideTitle ?? index.title;
  if (!title) {
    throw new Error("Invalid Yomitan dictionary: index.json has no title");
  }

  const termBankNames = Object.keys(files)
    .filter((name) => /^term_bank_\d+\.json$/.test(name))
    .sort();

  const rows: Omit<TermRow, "id">[] = [];
  for (const name of termBankNames) {
    const entries = JSON.parse(strFromU8(files[name])) as TermBankV3Entry[];
    for (const entry of entries) {
      const [
        expression,
        reading,
        definitionTags,
        rules,
        score,
        glossary,
        sequence,
        termTags,
      ] = entry;
      rows.push({
        expression,
        reading: reading.length > 0 ? reading : expression,
        definitionTags,
        rules,
        score,
        glossary,
        sequence,
        termTags,
        dictionary: title,
      });
    }
  }

  db.addTerms(rows);
  return { title, termCount: rows.length, termBankFiles: termBankNames.length };
}
