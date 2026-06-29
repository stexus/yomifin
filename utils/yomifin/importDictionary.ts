/*
 * Runner-agnostic Yomitan dictionary import.
 *
 * Unzips a Yomitan dictionary .zip, walks its `term_bank_*.json` files, transforms each
 * v3 term tuple into a row matching TERMS_SCHEMA, and hands batches to a `sink` that
 * does the actual SQLite writes. The SAME module powers:
 *   - the offline builder (scripts/build-dictionary-db.ts, bun:sqlite sink), and
 *   - on-device import (expo-sqlite sink, with a `yieldToEventLoop` between banks so the
 *     UI thread stays responsive and a progress bar can update).
 * Keeping the parse/transform here means both paths produce byte-identical rows.
 *
 * fflate is pure JS and runs in both bun and React Native (Hermes).
 */
import { strFromU8, unzipSync } from "fflate";

/** A row ready to INSERT into the `terms` table (glossary already JSON-stringified). */
export interface TermInsertRow {
  expression: string;
  reading: string;
  definitionTags: string;
  rules: string;
  score: number;
  /** JSON string of the glossary array. */
  glossary: string;
  sequence: number | null;
  termTags: string | null;
  dictionary: string;
}

/** Yomitan v3 term-bank tuple. */
type V3Term = [
  string, // expression
  string, // reading ("" => same as expression)
  string | null, // definitionTags
  string, // rules (deinflection)
  number, // score
  unknown[], // glossary
  number, // sequence
  string, // termTags
];

export interface ImportProgress {
  /** 1-based index of the bank just written. */
  bank: number;
  totalBanks: number;
  /** Running total of terms inserted. */
  terms: number;
}

export interface ImportSink {
  /** Insert a batch of rows (one term bank). May be async (device) or sync (bun). */
  insertBatch(rows: TermInsertRow[]): Promise<void> | void;
}

export interface ImportOptions {
  /** Override the dictionary title (defaults to index.json `title`). */
  title?: string;
  /**
   * Called once with the resolved title BEFORE any bank is inserted. Use it to make
   * import idempotent (e.g. DELETE existing rows for this dictionary) so re-importing
   * the same dictionary replaces rather than duplicates.
   */
  onTitleResolved?: (title: string) => Promise<void> | void;
  /** Called after each bank is written (for a progress bar). */
  onProgress?: (p: ImportProgress) => void;
  /**
   * Awaited between banks so the JS/UI thread can breathe on device. Pass
   * `() => new Promise((r) => setTimeout(r, 0))` in RN; omit for bun.
   */
  yieldToEventLoop?: () => Promise<void>;
  /** Rows per insert batch within a bank (default: whole bank at once). */
  batchSize?: number;
}

export interface ImportResult {
  title: string;
  revision: string;
  termCount: number;
  bankCount: number;
}

/** Transform one v3 tuple into a TERMS_SCHEMA row for the given dictionary title. */
export function v3ToRow(t: V3Term, dictionary: string): TermInsertRow {
  const [
    expression,
    reading,
    definitionTags,
    rules,
    score,
    glossary,
    sequence,
    termTags,
  ] = t;
  return {
    expression,
    // Yomitan convention: empty reading means the reading equals the expression.
    reading: reading && reading.length > 0 ? reading : expression,
    definitionTags: definitionTags ?? "",
    rules: rules ?? "",
    score: score ?? 0,
    glossary: JSON.stringify(glossary ?? []),
    sequence: sequence ?? null,
    termTags: termTags ?? null,
    dictionary,
  };
}

/**
 * Import a Yomitan dictionary .zip into `sink`. The caller is responsible for creating
 * the schema (TERMS_SCHEMA + a `dictionaries` table) before calling, and for recording
 * the returned metadata afterwards.
 */
export async function importDictionaryFromZip(
  zipBytes: Uint8Array,
  sink: ImportSink,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const zip = unzipSync(zipBytes);

  const indexRaw = zip["index.json"];
  if (!indexRaw)
    throw new Error("not a Yomitan dictionary: missing index.json");
  const index = JSON.parse(strFromU8(indexRaw)) as {
    title?: string;
    revision?: string;
  };
  const title = opts.title ?? index.title;
  if (!title) throw new Error("dictionary index.json has no title");
  await opts.onTitleResolved?.(title);

  const bankNames = Object.keys(zip)
    .filter((n) => /^term_bank_\d+\.json$/.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/\d+/)?.[0] ?? 0);
      const nb = Number(b.match(/\d+/)?.[0] ?? 0);
      return na - nb;
    });

  let termCount = 0;
  for (let i = 0; i < bankNames.length; i++) {
    const entries = JSON.parse(strFromU8(zip[bankNames[i]])) as V3Term[];
    const rows = entries.map((e) => v3ToRow(e, title));

    if (opts.batchSize && opts.batchSize > 0) {
      for (let j = 0; j < rows.length; j += opts.batchSize) {
        await sink.insertBatch(rows.slice(j, j + opts.batchSize));
      }
    } else {
      await sink.insertBatch(rows);
    }
    termCount += rows.length;

    opts.onProgress?.({
      bank: i + 1,
      totalBanks: bankNames.length,
      terms: termCount,
    });
    if (opts.yieldToEventLoop) await opts.yieldToEventLoop();
  }

  return {
    title,
    revision: index.revision ?? "",
    termCount,
    bankCount: bankNames.length,
  };
}
