/*
 * In-memory implementation of the narrow DictionaryDatabase interface the vendored
 * Translator needs (see PHASE2_YOMITAN.md). Kept for tests / small dictionaries; the
 * device path uses SqliteDictionaryDatabase (in-memory is too heavy on device — a full
 * JMdict is ~300MB heap and minutes to parse). Both share termMatching.ts so results
 * are identical.
 */
import {
  assembleTermEntries,
  type DictionarySet,
  type TermEntryResult,
  type TermRow,
} from "./termMatching";

export type { TermEntryResult, TermRow } from "./termMatching";

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
   * matches (exact only), restricted to enabled dictionaries; `index` points back
   * into termList. Async to match the SQLite backend / Translator's await.
   */
  findTermsBulk(
    termList: string[],
    dictionaries: DictionarySet,
    matchType: "exact" | "prefix" | "suffix" = "exact",
  ): TermEntryResult[] {
    if (matchType !== "exact") {
      // prefix/suffix not needed by the deinflection lookup path; add later if needed.
      return [];
    }
    const candidates: TermRow[] = [];
    const seen = new Set<number>();
    for (const term of termList) {
      for (const row of this._byExpression.get(term) ?? []) {
        if (!seen.has(row.id)) {
          seen.add(row.id);
          candidates.push(row);
        }
      }
      for (const row of this._byReading.get(term) ?? []) {
        if (!seen.has(row.id)) {
          seen.add(row.id);
          candidates.push(row);
        }
      }
    }
    return assembleTermEntries(termList, candidates, dictionaries);
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
  if (existing) existing.push(row);
  else map.set(key, [row]);
}
