/*
 * Clean lookup API over the vendored Yomitan Translator + InMemoryDictionaryDatabase.
 *
 * Hides the verbose FindTermsOptions and the raw TermDictionaryEntry shape behind a
 * small surface tailored to yomifin's needs: feed "text from the tapped token to the
 * end of the line", get back the forward-greedy matched length + the resolved
 * dictionary entries (term, reading, how it deinflected, and the glossary to render).
 *
 * See docs/yomifin/archive/PHASE2_YOMITAN.md. The glossary entries are returned untouched (plain strings or
 * Yomitan structured-content objects) for the structured-content renderer to handle.
 */
import type { InMemoryDictionaryDatabase } from "./InMemoryDictionaryDatabase";
import type { SqliteDictionaryDatabase } from "./SqliteDictionaryDatabase";
// vendored JS (no .d.ts) — typed loosely via the `any` field below.
import { Translator } from "./yomitan/translator.js";

/** Either dictionary backend satisfies the Translator's DB interface. */
export type YomifinDatabase =
  | InMemoryDictionaryDatabase
  | SqliteDictionaryDatabase;

/** A glossary block from one dictionary for one resolved headword. */
export interface DefinitionGroup {
  dictionary: string;
  tags: string[];
  /** glossary items: plain strings and/or Yomitan structured-content objects */
  glossary: unknown[];
}

/** One resolved dictionary entry (lemma) for the tapped text. */
export interface LookupEntry {
  term: string;
  reading: string;
  /** part-of-speech classes, e.g. ["v1"], ["adj-i"] */
  wordClasses: string[];
  /** human-readable deinflection chain, e.g. ["causative", "potential or passive", "-た"] */
  inflectionChain: string[];
  definitions: DefinitionGroup[];
}

export interface LookupResult {
  /** number of characters from the start of `text` that formed the match (forward-greedy) */
  matchedLength: number;
  /** the matched surface substring (text.slice(0, matchedLength)) */
  matchedText: string;
  entries: LookupEntry[];
}

export interface YomifinDictionaryOptions {
  /** ISO language for the Translator pipeline; 'ja' for now, 'zh' later. */
  language?: string;
  /** Names of the dictionaries to search, in priority order. */
  dictionaryNames: string[];
  /**
   * Max characters of the input the forward-greedy scan considers. The scan tries
   * every substring length from the tapped position, so an unbounded line makes a
   * tap on a particle / mid-word explore a huge space and block the JS thread. A
   * single word is rarely longer than this, so capping it bounds the work with no
   * practical loss of matches. Default 16.
   */
  maxScanLength?: number;
  /**
   * Max entries (≈ popup panes) a lookup returns. Yomitan's own default is 32.
   * Caps the tail of short-prefix panes on dense dictionaries; never affects WHICH
   * entry headlines (entries are longest-surface-first before the cap applies).
   */
  maxResults?: number;
}

/** Builds the enabledDictionaryMap the Translator expects from a list of names. */
function buildEnabledDictionaryMap(
  dictionaryNames: string[],
): Map<string, unknown> {
  const map = new Map<string, unknown>();
  dictionaryNames.forEach((name, index) => {
    map.set(name, {
      index,
      priority: 0,
      allowSecondarySearches: false,
      partsOfSpeechFilter: true,
      useDeinflections: true,
    });
  });
  return map;
}

export class YomifinDictionary {
  private _translator: any;
  private _language: string;
  private _enabledDictionaryMap: Map<string, unknown>;
  private _mainDictionary: string;
  private _maxScanLength: number;
  private _maxResults: number;

  constructor(db: YomifinDatabase, options: YomifinDictionaryOptions) {
    this._translator = new Translator(db);
    this._translator.prepare();
    this._language = options.language ?? "ja";
    this._enabledDictionaryMap = buildEnabledDictionaryMap(
      options.dictionaryNames,
    );
    this._mainDictionary = options.dictionaryNames[0] ?? "";
    this._maxScanLength = options.maxScanLength ?? 16;
    this._maxResults = options.maxResults ?? 32;
  }

  /**
   * Forward-greedy lookup. Pass text from the tapped position to the end of the line;
   * the dictionary + deinflector decide the real word boundary.
   */
  async lookup(text: string): Promise<LookupResult> {
    // Bound the forward-greedy scan space (see maxScanLength).
    const scanText =
      text.length > this._maxScanLength
        ? text.slice(0, this._maxScanLength)
        : text;
    // "group" mode = Yomitan's own popup mode: entries with the same headword
    // (term+reading+inflection) are merged into ONE entry carrying one definition
    // block PER dictionary (sorted by dictionary priority). This is what the Phase 6
    // pane model + Phase 7 per-dictionary boundaries require. "simple" (the old mode)
    // never groups, so multi-dictionary results fragmented into duplicate panes.
    const { dictionaryEntries, originalTextLength } =
      await this._translator.findTerms("group", scanText, {
        matchType: "exact",
        deinflect: true,
        language: this._language,
        mainDictionary: this._mainDictionary,
        sortFrequencyDictionary: null,
        sortFrequencyDictionaryOrder: "descending",
        removeNonJapaneseCharacters: false,
        textReplacements: [null],
        enabledDictionaryMap: this._enabledDictionaryMap,
        excludeDictionaryDefinitions: null,
        searchResolution: "letter",
        primaryReading: "",
        useAllFrequencyDictionaries: false,
      });

    return {
      matchedLength: originalTextLength,
      matchedText: scanText.slice(0, originalTextLength),
      // Entries arrive already sorted by the vendored Translator's own
      // `_sortTermDictionaryEntries` (longest matched surface first), so panes are
      // longest-headword-first and shorter prefixes are demoted — exactly Yomitan's
      // ordering. We do NOT filter: Yomitan itself returns shorter prefixes too.
      // The maxResults cap (Yomitan parity knob) trims the tail AFTER sorting, so
      // the headline pane and its order are unaffected.
      entries: (dictionaryEntries as any[])
        .slice(0, this._maxResults)
        .map(mapEntry),
    };
  }
}

function mapEntry(entry: any): LookupEntry {
  const headword = entry.headwords?.[0] ?? {};
  // Each inflectionRuleChainCandidate is a chain of {name}; take the first candidate.
  const chain: string[] =
    entry.inflectionRuleChainCandidates?.[0]?.inflectionRules?.map(
      (r: { name: string }) => r.name,
    ) ?? [];
  const definitions: DefinitionGroup[] = (entry.definitions ?? []).map(
    (d: any) => ({
      dictionary: d.dictionary,
      tags: (d.tags ?? []).map((t: { name: string }) => t.name ?? t),
      glossary: d.entries ?? [],
    }),
  );
  return {
    term: headword.term ?? "",
    reading: headword.reading ?? "",
    wordClasses: headword.wordClasses ?? [],
    inflectionChain: chain,
    definitions,
  };
}
