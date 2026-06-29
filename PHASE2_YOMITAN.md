# PHASE2_YOMITAN.md — Mapping Yomitan's core for extraction into RN

Investigation deliverable for **Phase 2** (see `IMPLEMENTATION_PLAN.md`). Goal: find
exactly which Yomitan modules implement (1) the **deinflector**, (2) the
**dictionary-database / lookup layer** (and its IndexedDB dependency), and (3) the
**structured-content renderer**; assess extraction difficulty; and produce a plan to
repoint storage to **SQLite or in-memory**. **No code modified — map only.**

Reference: Yomitan cloned at `./yomitan` (commit `d9c3c4d0`). All paths below are
relative to `yomitan/ext/js/` unless noted.

---

## TL;DR — the three pieces, ranked by extraction difficulty

| Piece | Modules | Difficulty | Why |
|---|---|---|---|
| **1. Deinflector** | `language/language-transformer.js` + `language/language-transforms.js` + `language/ja/japanese-transforms.js` | **Trivial** | Pure data + algorithm. One real dep (`core/log.js`). No DOM, no storage, no async. Lift almost verbatim. |
| **2. Lookup layer** | `language/translator.js` (orchestration) + a **DB that satisfies ~10 methods** | **Medium** | `Translator` is pure logic but large (2522 LOC) and pulls in language helpers. Its only storage coupling is a **narrow interface** on `this._database`. We re-implement that interface in-memory; we do **not** lift `dictionary-database.js`/`database.js` (those are the IndexedDB layer). |
| **3. Structured-content renderer** | `display/structured-content-generator.js` | **Medium-High** | Pure-logic tree walker, but emits **DOM nodes** (`document.createElement`). RN has no DOM. We **port** it to emit an RN element tree (or a plain JSON tree we render with RN components). ~507 LOC, mechanical but not copy-paste. |

The architecture boundary is clean: **deinflection** and **lookup** lift well;
**storage** gets replaced (not lifted); **rendering** gets re-targeted from DOM to RN.

---

## 1. The deinflector (forward-greedy deinflection)

### Modules
- **`language/language-transformer.js`** (273 LOC) — the engine. Class
  `LanguageTransformer`. Takes a *transform descriptor* (rules) via `addDescriptor()`
  and exposes `transform(sourceText)` → array of `{text, conditions, trace}` variants
  (every way the input could be a deinflected form). Also `getConditionFlagsFromParts`,
  `getUserFacingInflectionRules`. **Only import: `core/log.js`.**
- **`language/language-transforms.js`** — tiny helpers `suffixInflection`,
  `wholeWordInflection`, `prefixInflection`, etc. that build rule objects. **No imports.**
- **`language/ja/japanese-transforms.js`** — the actual **Japanese rule set**
  (`japaneseTransforms`): conditions (verb types, adjective types, etc.) and the
  inflection rules (て-form, past, passive, causative, potential, etc.). Imports only
  `../language-transforms.js`. This is the high-value data Yomitan is famous for.
- (For later) **`language/multi-language-transformer.js`** (90 LOC) — a thin registry
  that maps language ISO → a `LanguageTransformer` with that language's descriptor.
  `Translator` uses this. For a JA-only MVP we can use a single `LanguageTransformer`
  directly and skip the multi wrapper.

### Dependencies / portability
- Pure JS. No DOM. No IndexedDB. No async. No `Intl` requirement.
- `core/log.js` is a trivial logging shim — copy it or stub `log.warn/error`.
- **Verdict: lift near-verbatim.** This is the cleanest part of the whole harvest.

### How it's used in lookup
`translator.js::_getDeinflections()` (line ~391) calls the transformer to expand the
input text into candidate lemma forms, then asks the DB for each candidate. This is
the "forward-greedy" behavior: it tries progressively shorter substrings of the line
from the tap point and, for each, all deinflected variants, and keeps the longest that
hits the dictionary.

---

## 2. The lookup layer (Translator + a replaceable DB)

### The orchestrator: `language/translator.js`
- Class `Translator`, constructed with **one argument: a `DictionaryDatabase`**
  (`constructor(database)` → `this._database = database`).
- Public API we care about: **`findTerms(mode, text, options)`** (line 86) — returns
  `{dictionaryEntries, originalTextLength}`. `originalTextLength` is exactly the
  forward-greedy match length we need to advance the tap selection. Also `findKanji`,
  `getTermFrequencies` (frequency = out of scope for MVP display).
- Imports: `safePerformance` (trivial shim-able), `general/regex-util.js`
  (`applyTextReplacement`), `ja/japanese.js` (`isCodePointJapanese`),
  `ko/korean.js` (`isCodePointKorean`), `zh/chinese.js` (`isCodePointChinese`),
  `LanguageTransformer`, `MultiLanguageTransformer`, `languages.js`
  (`getAllLanguageTextProcessors`, `getAllLanguageReadingNormalizers`),
  `text-processors.js` (`MAX_PROCESS_VARIANTS`). All **pure logic**, no DOM/storage.
- `prepare()` wires up text processors + reading normalizers per language. For JA-only
  we still call `prepare()`; it self-discovers from the language descriptors.

### The storage coupling is NARROW — this is the key finding
`Translator` touches the database through **only these methods** (every `this._database.*`
call in the file):

| Method | Used for | Needed for MVP (JA definitions)? |
|---|---|---|
| `findTermsBulk(termList, dictMap, matchType)` | the core term lookup | **YES** |
| `findTermsExactBulk(termList, dictMap)` | secondary/related lookups | YES (can stub to `[]` initially) |
| `findTermsBySequenceBulk(items)` | grouping related entries by sequence | YES-ish (stub `[]` → entries just won't be grouped) |
| `findTermMetaBulk(termList, dictMap)` | frequency/pitch meta | **NO** (return `[]`) |
| `findTagMetaBulk(items)` | tag expansion | NO (return `[]` → tags show as raw names) |
| `findKanjiBulk` / `findKanjiMetaBulk` | kanji lookup | NO (kanji mode unused in MVP) |
| `getDictionaryInfo()` | frequency mode map | NO (return `[]`) |

So to get **term definitions working**, we implement an object exposing these methods,
of which only **`findTermsBulk`** must be real; the rest can return `[]` for a first
cut and be filled in incrementally. This is the SQLite/in-memory swap point.

### What we do NOT lift: the IndexedDB layer
- **`dictionary/dictionary-database.js`** (883 LOC) and **`data/database.js`** (619 LOC)
  are the IndexedDB implementation. They drag in: `lib/resvg-wasm.js` (SVG→raster for
  dictionary media — **media only, out of scope**), `core/api-map.js`, a Web **Worker**
  (`dictionary-database-worker-main.js`), `safePerformance`, `ExtensionError`.
- The IndexedDB schema (from `prepare()`, final version 60) is the data model we must
  reproduce in our store:
  - **`terms`**: primaryKey `id` (autoIncrement); indices `dictionary`, `expression`,
    `reading`, `sequence`, `expressionReverse`, `readingReverse`.
  - `kanji`, `termMeta`, `kanjiMeta`, `tagMeta`, `dictionaries`, `media` (latter all
    deferrable).
- `findTermsBulk` semantics to replicate: given a list of candidate terms, find rows
  where `expression` **or** `reading` matches (exact / prefix / suffix per `matchType`),
  filtered to enabled dictionaries, de-duplicated by row `id`. For in-memory MVP this is
  two `Map<string, entry[]>` indexes (by expression, by reading) and a `matchType ===
  'exact'` path; prefix/suffix can come later (the default `findTerms` deinflection path
  uses exact-match on each deinflected candidate, so **exact is enough to start**).

### Term-bank data format (what we load)
Yomitan dictionaries are zips containing `term_bank_*.json`. Each term entry is the
array form `[expression, reading, definitionTags, rules, score, glossary[], sequence,
termTags]`. The dictionary **importer** (`dictionary/dictionary-importer.js`) normalizes
these into the `terms` store rows (`{dictionary, expression, reading, definitionTags,
rules, score, glossary, sequence, termTags, expressionReverse, readingReverse}`). For
MVP we can write a **minimal loader** that unzips one dictionary and builds the
in-memory `terms` index directly in that row shape — we do **not** need the full
importer (which also handles media, schema validation, progress, worker offload).

### Verdict
- Lift `translator.js` + the small language helpers it imports (mechanical).
- **Replace** the DB with an in-memory object implementing the ~10-method interface
  (only `findTermsBulk` must be real for the gate).
- Defer SQLite to Phase 6 (storage-at-scale); in-memory is explicitly the MVP bar.

---

## 3. The structured-content renderer

### Module
- **`display/structured-content-generator.js`** (507 LOC). Class
  `StructuredContentGenerator`. Walks the **structured-content tree** (the mini-HTML
  JSON: nested `div`/`span`/`img`/`a`/`table` nodes with a `style` object, defined in
  `types/ext/structured-content.d.ts`) and builds output.
- Entry points: `createStructuredContent(content, dictionary)` and
  `appendStructuredContent(node, content, dictionary)`.

### The problem: it emits DOM
- Internally it calls `this._createElement('span', ...)`, `node.appendChild(...)`,
  `setAttribute`, `classList.add`, i.e. **browser DOM**. RN/Hermes has **no DOM**.
- Imports `DisplayContentManager`, `AnkiTemplateRendererContentManager`,
  `getLanguageFromText`. The content managers handle media/image loading and hover —
  **image rendering is out of scope** for MVP, so the image branch can be stubbed.

### Extraction strategy (port, don't lift)
The tree-walking logic (which node types exist, how `style` maps to CSS-ish props, how
text/links/tables nest) is reusable; the **output target** is not. Two options:
1. **Re-target to RN elements**: replace `_createElement`/`appendChild` with calls that
   build React Native `<View>`/`<Text>` (+ `StyleSheet`) instead of DOM nodes. The
   `style` object (fontStyle, fontWeight, color, textDecorationLine, verticalAlign,
   etc. from `structured-content.d.ts`) maps cleanly onto RN text/view styles.
2. **Two-stage**: port the walker to emit a **plain JSON render-tree**, then a small RN
   component renders that tree. Cleaner separation, easier to test in JS-only.

Recommended: **option 2** — keep a pure function `structuredContentToTree(content)`
(portable, unit-testable in Hermes) + a `<StructuredContent>` RN component. Skip image
nodes for MVP (render a placeholder or omit).

### Note on glossary shapes
Definitions in `glossary[]` come in several shapes: plain strings, `{type:'text'}`,
`{type:'structured-content', content}`, `{type:'image'}`, deinflection arrays. The MVP
renderer must handle **string** and **structured-content** (the two common ones — see
CONTEXT §2: "many dictionaries store definitions as structured content"); image can be
stubbed.

---

## What we deliberately leave behind (the extension shell)

- **Storage**: `dictionary/dictionary-database.js`, `data/database.js`, the DB Web
  Worker, `lib/resvg-wasm.js` → replaced by in-memory store.
- **Messaging / background / content scripts**: `background/`, `comm/`, `app/`,
  `extension/`, `sw.js`, offscreen — none needed; we call `Translator` directly.
- **DOM scanning / popup plumbing**: `dom/`, `display/display.js`,
  `language/text-scanner.js`, `display/query-parser.js` — Phase 1 already owns tap
  anchors + from-token-to-end-of-line text, so we feed `translator.findTerms()`
  ourselves.
- **Settings/options/profiles UI**: `pages/`, `data/options-util.js`,
  `data/profiles-util.js` — Phase 5.
- **AnkiConnect**: `data/anki-*.js` — Phase 3 will write its own minimal POST; not part
  of the lookup harvest.

---

## Concrete build plan for Phase 2 (proposed, JA-first)

Target dir: `utils/yomifin/yomitan/` (vendored, lightly modified) + `utils/yomifin/`
(our glue), keeping the Phase 1 isolation pattern.

1. **Vendor the deinflector**: copy `language-transformer.js`, `language-transforms.js`,
   `ja/japanese-transforms.js`, and a `log.js` stub. Smoke-test in Hermes:
   `好きでした → 好き`, `食べさせられた → 食べる`.
2. **Vendor `translator.js`** + the pure language helpers it imports
   (`ja/japanese.js`, `zh/chinese.js`, `ko/korean.js`, `languages.js`,
   `language-descriptors.js` subset, `text-processors.js`, `text-utilities.js`,
   `general/regex-util.js`, `multi-language-transformer.js`) and shims
   (`safePerformance` no-op). Resolve the import graph; drop anything DOM/storage.
3. **Implement `InMemoryDictionaryDatabase`** with the ~10-method interface; make
   `findTermsBulk` real (exact match over `expression`/`reading` Maps), the rest return
   `[]`. Build it from a **minimal term-bank loader** (unzip one JA dictionary → rows).
4. **Wire tap → `translator.findTerms('simple', text, options)`** using the
   from-token-to-end-of-line string from Phase 1; use `originalTextLength` to know the
   matched span.
5. **Port the structured-content renderer** to a JSON tree + `<StructuredContent>` RN
   component; render the first entry's glossary in a popup over the video.
6. **Decide dictionary delivery**: bundle one small JA dictionary as an asset for the
   spike (file load + unzip on device). Large-scale SQLite storage is Phase 6.

### Open questions to resolve while building
- **Hermes gaps**: confirm `Intl.Collator` (used by `Translator._stringComparer`) and
  any `Intl.Segmenter`/regex `\p{}` unicode property escapes work in this Hermes build
  (Phase 1 already found `Intl.Segmenter` word-granularity missing). Fallbacks may be
  needed.
- **Module format**: Yomitan uses ESM with `import('...').Type` JSDoc and `.js`
  extensions; Metro handles ESM but verify the extensioned relative imports resolve, or
  add a small rewrite step when vendoring.
- **Unzip on device**: pick an RN-friendly zip/inflate (e.g. `fflate`) for the
  term-bank loader.

### Exit criteria (restated from the plan)
Tapping a **conjugated Japanese word** in a real subtitle resolves to its **dictionary
entry** and shows a **correctly rendered definition popup** on the physical iPad.

---

## Regression guards (run after any change to the language layer / re-vendor)

Fast JS-side guards, no device needed. **One command:** `./scripts/yomifin-test.sh`
(runs both of the below; also re-run after bumping the Yomitan pin in
`utils/yomifin/yomitan/VENDOR.md`).

| Guard | Runner | What it locks down |
|---|---|---|
| **Deinflector smoke** | `scripts/yomifin-deinflect-smoke.sh` (node) | engine + JA rules reduce 12 conjugated single words to lemmas (好きでした→好き, 食べさせられた→食べる, 来られる→来る, …) |
| **Lookup integration** | `bun utils/yomifin/lookup.test.ts` | full pipeline: synthetic Yomitan **zip → termBankLoader → InMemoryDictionaryDatabase → Translator → lookup()**, on **complex sentences with trailing context** — verifies (a) multi-step deinflection chains and (b) forward-greedy boundaries stop in the right place (飲ませてくれなかった→飲ませて/飲む; 読んでいた本を借りて→読んでいた/読む) |
| **Structured content** | `bun utils/yomifin/structuredContent.test.ts` | pure renderer helpers (classify / group inline+block / list bullets / style→RN mapping) + walks **34k+ real JMdict structured-content nodes** without throwing |

Things these guards deliberately do NOT cover (validated elsewhere / later):
- **Hermes-only behavior** (`Intl.Collator`, unicode regex) — only provable on device.
- **Real dictionary data** (JMdict/Jitendex), incl. the noun/na-adjective copula path
  (好き) that needs real entry tags — needs a user-provided dictionary zip.
- **The RN structured-content popup** — needs the renderer port + device.

When adding lookup features, **add a case to `lookup.test.ts`** (keep sentences
complex and realistic, not toy single words) so the guard grows with the engine.
