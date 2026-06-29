/*
 * Shared term-row types + the result-assembly logic used by BOTH the in-memory and
 * the SQLite dictionary databases. Keeping the matching in one place guarantees the
 * two backends return byte-identical results to the Translator (the SQLite path is
 * validated against the in-memory path in a bun test).
 *
 * Mirrors Yomitan's dictionary-database.js findTermsBulk semantics: for each query
 * term, expression matches first (matchSource 'term'), then reading ('reading'),
 * restricted to enabled dictionaries, de-duplicated by row id; result `index` points
 * back into the query list.
 */

/** A stored term row (mirror of Yomitan DatabaseTermEntry + an id). */
export interface TermRow {
  id: number;
  expression: string;
  reading: string;
  /** space-separated tag string, or null */
  definitionTags: string | null;
  /** space-separated part-of-speech rule string, e.g. "v1" / "v5 vt" / "adj-i" */
  rules: string;
  score: number;
  /** glossary entries: plain strings or structured-content objects */
  glossary: unknown[];
  sequence?: number;
  termTags?: string;
  dictionary: string;
}

/** Result row consumed by Translator (mirror of Yomitan TermEntry). */
export interface TermEntryResult {
  index: number;
  matchType: "exact" | "prefix" | "suffix";
  matchSource: "term" | "reading";
  term: string;
  reading: string;
  definitionTags: string[];
  termTags: string[];
  rules: string[];
  definitions: unknown[];
  score: number;
  dictionary: string;
  id: number;
  sequence: number;
}

/** Anything with `.has(dictionaryName)` — Translator passes its enabledDictionaryMap. */
export interface DictionarySet {
  has(dictionary: string): boolean;
}

/** Yomitan's _splitField: space-separated string → array (empty/blank → []). */
export function splitField(field: string | null | undefined): string[] {
  return typeof field === "string" && field.length > 0 ? field.split(" ") : [];
}

function toResult(
  row: TermRow,
  index: number,
  matchSource: "term" | "reading",
): TermEntryResult {
  return {
    index,
    matchType: "exact",
    matchSource,
    term: row.expression,
    reading: row.reading,
    definitionTags: splitField(row.definitionTags),
    termTags: splitField(row.termTags),
    rules: splitField(row.rules),
    definitions: row.glossary,
    score: row.score,
    dictionary: row.dictionary,
    id: row.id,
    sequence: typeof row.sequence === "number" ? row.sequence : -1,
  };
}

/**
 * Assemble TermEntryResults from a pool of candidate rows that matched any term in
 * `termList` (by expression or reading). `candidateRows` may be a superset; this
 * filters to enabled dictionaries and assigns the correct `index`/`matchSource`.
 * Identical ordering/dedup to the in-memory and Yomitan implementations.
 */
export function assembleTermEntries(
  termList: string[],
  candidateRows: TermRow[],
  dictionaries: DictionarySet,
): TermEntryResult[] {
  const byExpression = new Map<string, TermRow[]>();
  const byReading = new Map<string, TermRow[]>();
  for (const row of candidateRows) {
    if (!dictionaries.has(row.dictionary)) continue;
    pushToIndex(byExpression, row.expression, row);
    pushToIndex(byReading, row.reading, row);
  }

  const results: TermEntryResult[] = [];
  const visited = new Set<number>();
  const collect = (
    rows: TermRow[] | undefined,
    index: number,
    matchSource: "term" | "reading",
  ) => {
    if (!rows) return;
    for (const row of rows) {
      if (visited.has(row.id)) continue;
      visited.add(row.id);
      results.push(toResult(row, index, matchSource));
    }
  };
  for (let index = 0; index < termList.length; index++) {
    const term = termList[index];
    collect(byExpression.get(term), index, "term");
    collect(byReading.get(term), index, "reading");
  }
  return results;
}

function pushToIndex(
  map: Map<string, TermRow[]>,
  key: string,
  row: TermRow,
): void {
  const existing = map.get(key);
  if (existing) existing.push(row);
  else map.set(key, [row]);
}
