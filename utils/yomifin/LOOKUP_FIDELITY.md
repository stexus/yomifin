# Lookup fidelity — "does it match like Yomitan?"

The concern: since we vendored Yomitan's core but wrote our own storage + call site,
how do we know we aren't silently missing a feature that makes a word **fail to match**
when real Yomitan would find it? This documents the audit, its conclusion, and how to
**re-run it** after any change under `utils/yomifin/`.

TL;DR: **exactly one seam decides whether a term is found — `findTermsBulk` — and it is
fully implemented.** Everything else our DB backends stub is *display/enrichment*, which
can only change how a result looks or ranks, never whether it exists. The real ways our
results can diverge from Yomitan are **configuration knobs** (listed at the bottom), not
missing code.

---

## 1. The matching pipeline (what turns a tap into a hit)

A lookup in `lookup.ts` calls the vendored `Translator.findTerms("group", text, options)`.
For a term to be **found**, three vendored stages run, all wired and tested:

1. **Text preprocessors** (`_getAlgorithmDeinflections → _getTextVariants`). For JA these
   are Yomitan's *real* upstream objects (`japanese-text-preprocessors.js`, listed in
   `language-descriptors.js`): half-width→full-width, alphabetic→hiragana, alphanumeric
   width variants, **hiragana↔katakana (both directions)**, emphatic-sequence collapse,
   combining-character normalization, CJK-compatibility normalization, kanji
   standardization. Each yields extra search candidates, so a katakana query finds a
   hiragana-stored reading and vice-versa. *Proven live* by `lookup.test.ts`
   (`あっさり→あさり→漁る`, `イケメン→イケ面`, `ソラ→空`).
2. **Deinflection** (`japanese-transforms.js`, the upstream ruleset). Reduces conjugations
   to lemmas before the DB hit. *Proven* by `deinflect-smoke.test.mjs` + `lookup.test.ts`.
3. **DB match** (`this._database.findTermsBulk`). Our `SqliteDictionaryDatabase` /
   `InMemoryDictionaryDatabase` run `WHERE expression IN (…) OR reading IN (…)` and
   `assembleTermEntries` collects **both** expression and reading hits, filtered to the
   enabled dictionaries. This is the only method that decides existence.

If a word is genuinely in an enabled dictionary (by written form OR reading, in any of
the kana/width/variant forms the preprocessors generate, after deinflection), it matches.

## 2. Seam audit — every DB method the Translator can call

The Translator only ever touches storage through `this._database.<method>`. Enumerate
them and classify each. Regenerate the list with:

```
rg -n 'this\._database\.\w+' utils/yomifin/yomitan/translator.js \
  | sed -E 's/.*this\._database\.([a-zA-Z]+).*/\1/' | sort -u
```

| DB method | Our backends | Used for | Can cause a false "no match"? |
|---|---|---|---|
| `findTermsBulk` | **implemented** (exact; expression OR reading) | **the** term lookup | This IS the matcher — implemented, so no |
| `findTermsExactBulk` | stub `[]` | secondary-search dictionaries only; guarded by `secondarySearchDictionaryMap.size === 0` | No — we set `allowSecondarySearches:false` for all dicts, so the map is empty and the call is skipped |
| `findTermsBySequenceBulk` | stub `[]` | related entries in **`"merge"`** mode | No — we use `"group"`, this path never runs |
| `findTermMetaBulk` | stub `[]` | frequency/pitch **display** + `getTermFrequencies` (a method we never call) | No — display only; we pass `sortFrequencyDictionary:null` |
| `findTagMetaBulk` | stub `[]` | tag name/category/notes **enrichment** | No — tags still render by raw name; POS filtering uses `rules`, not tags |
| `findKanjiBulk` | stub `[]` | the `findKanji` API | No — we never call `findKanji`, only `findTerms` |
| `findKanjiMetaBulk` | stub `[]` | kanji frequency **display** | No — `findKanji` only |
| `getDictionaryInfo` | stub `[]` | dictionary metadata/alias | No — cosmetic |

Conclusion: **no stubbed method participates in term existence.** They affect frequency,
pitch, kanji, tag labels, and secondary/merge features — all display/enrichment or
code paths our options disable.

## 3. `findTerms` options — what we pass vs. why (the real divergence surface)

Set in `lookup.ts`. These are where behavior *can* differ from a stock Yomitan profile,
because they're choices, not missing code:

| Option | We pass | Effect on matching | Notes / risk |
|---|---|---|---|
| `matchType` | `"exact"` | exact term/reading | Same as Yomitan's normal scan. `findTermsBulk` returns `[]` for prefix/suffix (wildcard search only — unused) |
| `deinflect` | `true` | conjugations resolve | parity |
| `language` | `"ja"` | selects JA preprocessors + transforms | ZH path has **no** preprocessors (see §4) |
| `searchResolution` | `"letter"` | scan granularity | matches Yomitan default |
| `removeNonJapaneseCharacters` | `false` | keeps non-JA chars in the scan | permissive; unlikely to drop matches |
| `partsOfSpeechFilter` (per-dict) | `true` | deinflected hits filtered by POS conditions from the entry's `rules` | Yomitan default is also on. A dictionary with missing/wrong `rules` could drop a *deinflected* match — same as Yomitan would |
| `allowSecondarySearches` (per-dict) | `false` | all dicts are primary | **more** permissive than marking some secondary — not a miss source |
| `sortFrequencyDictionary` | `null` | ranking only | affects order, never existence |
| `maxScanLength` (ours, `lookup.ts`) | `16` | caps the forward-greedy scan | **the one real cap**: a single match longer than 16 chars won't fully resolve. Fine for words; a knob to lift (FEATURES.md → Yomitan settings parity) |

## 4. Known, documented divergences (not bugs — scope/config)

1. **`maxScanLength = 16`** — our forward-greedy cap in `lookup.ts`. Long compounds/phrases
   beyond 16 chars won't match their full form. Lift/expose per FEATURES.md (Yomitan settings
   parity). Low impact for word lookup.
2. **Chinese has no text preprocessors** — `language-descriptors.js` sets `zh
   textPreprocessors: {}` (and no deinflection, which ZH doesn't need). So there is **no
   simplified↔traditional folding**: a query in one script won't match an entry stored in
   the other. Expected until Chinese parity (parked). ZH still matches exact form + reading.
3. **Frequency/pitch/kanji/tag metadata absent** — `findTermMetaBulk`/`findTagMetaBulk`/
   `findKanji*` are stubs. By design (definitions-only scope). Affects
   display/sort, never whether a definition is found.
4. **Trimmed language set** — `language-descriptors.js` registers only JA + ZH (upstream
   has ~50, several with Hermes-hostile `\p{}` regex). Other languages aren't supported by
   design; not a JA/ZH matching gap.

## 5. How to re-audit after changes

Run these after any change under `utils/yomifin/` (they are the standing guards):

1. `./scripts/yomifin-test.sh` — includes `lookup.test.ts`, whose cases pin the matching
   pipeline: emphatic collapse (`あっさり→漁る`), reading-only match (`イケメン→イケ面`),
   kana normalization (`ソラ→空`), multi-dictionary priority + enable/disable, and pane
   grouping. If matching regressed, these fail.
2. Re-run the §2 `rg` command. **If the Translator gained a new `this._database.*` call**,
   classify it: if it can affect term *existence* (a new find-terms path), implement it in
   both DB backends; if it's display/enrichment, a stub is fine — add a row to the §2 table.
3. If you change any `findTerms` option in `lookup.ts`, update §3.

The invariant to preserve: **`findTermsBulk` is the only existence-deciding seam, and it
searches expression OR reading against the preprocessor-expanded, deinflected candidates.**
As long as that holds and the tests are green, a "Yomitan matches but we don't" report is
either a §4 known divergence or a genuine bug worth a repro with that dictionary's row.
