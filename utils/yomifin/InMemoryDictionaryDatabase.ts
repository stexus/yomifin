/*
 * In-memory replacement for Yomitan's IndexedDB-backed DictionaryDatabase.
 *
 * The vendored Translator (utils/yomifin/yomitan/translator.js) only touches storage
 * through a narrow ~10-method interface on `this._database` (see PHASE2_YOMITAN.md).
 * For the MVP we satisfy that interface from plain JS Maps held in memory: only term
 * lookup (findTermsBulk) needs to be real; meta/kanji/tag/sequence methods return []
 * for now and can be filled in later. Large-scale SQLite storage is Phase 6.
 *
 * Row shape mirrors Yomitan's `DatabaseTermEntry`; result shape mirrors `TermEntry`
 * (what Translator consumes). Field semantics copied from dictionary-database.js
 * (_createTerm / _splitField).
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

/** Anything with a `.has(dictionaryName)` — Translator passes its enabledDictionaryMap. */
type DictionarySet = { has(dictionary: string): boolean };

/** Yomitan's _splitField: space-separated string → array (empty/blank → []). */
function splitField(field: string | null | undefined): string[] {
  return typeof field === "string" && field.length > 0 ? field.split(" ") : [];
}

export class InMemoryDictionaryDatabase {
  private _rows: TermRow[] = [];
  private _byExpression = new Map<string, TermRow[]>();
  private _byReading = new Map<string, TermRow[]>();
  private _nextId = 1;

  /** Add term rows (id assigned automatically). */
  addTerms(rows: Omit<TermRow, "id">[]): void {
    for (const row of rows) {
      const withId: TermRow = { ...row, id: this._nextId++ };
      this._rows.push(withId);
      pushToIndex(this._byExpression, withId.expression, withId);
      pushToIndex(this._byReading, withId.reading, withId);
    }
  }

  get termCount(): number {
    return this._rows.length;
  }

  /**
   * Core lookup. For each term in termList, find rows whose expression OR reading
   * matches (exact only for MVP), restricted to enabled dictionaries, de-duplicated
   * by row id. `index` on each result points back into termList.
   *
   * Mirrors dictionary-database.js findTermsBulk semantics (expression index first,
   * then reading; matchSource 'term' vs 'reading').
   */
  findTermsBulk(
    termList: string[],
    dictionaries: DictionarySet,
    matchType: "exact" | "prefix" | "suffix" = "exact",
  ): TermEntryResult[] {
    if (matchType !== "exact") {
      // prefix/suffix not needed by the deinflection lookup path; add in a later phase.
      return [];
    }
    const results: TermEntryResult[] = [];
    const visited = new Set<number>();
    for (let index = 0; index < termList.length; index++) {
      const term = termList[index];
      // expression matches first (matchSource 'term'), then reading (matchSource 'reading')
      collect(this._byExpression.get(term), "term");
      collect(this._byReading.get(term), "reading");

      function collect(
        rows: TermRow[] | undefined,
        matchSource: "term" | "reading",
      ) {
        if (!rows) return;
        for (const row of rows) {
          if (!dictionaries.has(row.dictionary)) continue;
          if (visited.has(row.id)) continue;
          visited.add(row.id);
          results.push({
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
          });
        }
      }
    }
    return results;
  }

  // --- Remaining DictionaryDatabase interface: stubbed for the MVP (return empty). ---
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

function pushToIndex(
  map: Map<string, TermRow[]>,
  key: string,
  row: TermRow,
): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(row);
  } else {
    map.set(key, [row]);
  }
}
