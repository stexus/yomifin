# Vendored Yomitan core — provenance & re-vendor procedure

These files are **snapshotted (vendored) from Yomitan**, not consumed as a package
(Yomitan ships only as a browser extension; there is nothing to `npm update`). Keep
them as close to upstream as possible so re-vendoring stays a cheap diff. See
`../../../docs/yomifin/archive/PHASE2_YOMITAN.md` for the extraction map and rationale.

## Upstream source

- Repo: https://github.com/yomidevs/yomitan
- Pinned commit: **`d9c3c4d09e6ccf62f4e0fa3cd32abef17b5b4084`** (2026-06-16)

All files are **flattened** into this one directory, so subdir/parent import prefixes
(`../core/`, `../general/`, `./ja/`, `./ko/`, `./zh/`, `../CJK-util.js`) are rewritten
to `./`. That is the ONLY change to the copied files unless noted.

### Deinflector
| Vendored file | Upstream path (`ext/js/`) | Local modifications |
|---|---|---|
| `language-transformer.js` | `language/language-transformer.js` | flatten imports (`../core/log.js`→`./log.js`) |
| `language-transforms.js` | `language/language-transforms.js` | none |
| `japanese-transforms.js` | `language/ja/japanese-transforms.js` | flatten imports |

### Translator (lookup) graph
| Vendored file | Upstream path (`ext/js/`) | Local modifications |
|---|---|---|
| `translator.js` | `language/translator.js` | flatten imports only |
| `languages.js` | `language/languages.js` | none |
| `multi-language-transformer.js` | `language/multi-language-transformer.js` | none |
| `text-processors.js` | `language/text-processors.js` | none |
| `regex-util.js` | `general/regex-util.js` | none |
| `safe-performance.js` | `core/safe-performance.js` | none (imports `./log.js`) |
| `CJK-util.js` | `language/CJK-util.js` | none |
| `japanese.js` | `language/ja/japanese.js` | flatten imports |
| `japanese-text-preprocessors.js` | `language/ja/japanese-text-preprocessors.js` | flatten imports (`../../../lib/kanji-processor.js`→`./kanji-processor.js`) |
| `japanese-wanakana.js` | `language/ja/japanese-wanakana.js` | none (imports already `./`) |
| `japanese-kana-romaji-dicts.js` | `language/ja/japanese-kana-romaji-dicts.js` | none (pure data) |
| `kanji-processor.js` | `dev/lib/kanji-processor.js` | none (`export * from "kanji-processor"`; the npm dep is in `package.json`) |
| `korean.js` | `language/ko/korean.js` | flatten imports |
| `chinese.js` | `language/zh/chinese.js` | flatten imports |

### Ours (not copied)
| File | Purpose |
|---|---|
| `log.js` | minimal console-backed stub replacing `core/log.js` (upstream pulls in EventDispatcher + ExtensionError) |
| `language-descriptors.js` | **trimmed** to JA+ZH (upstream registers ~50 languages, some with Hermes-hostile `\p{}` regex). The JA `textPreprocessors` are wired to Yomitan's REAL upstream object (`japanese-text-preprocessors.js`, vendored above), so matching fidelity (emphatic collapse あっさり→あさり→漁る, width/kana folding, kanji variants) is upstream's, not re-implemented. ZH preprocessors stay empty until Chinese parity. See header comment |
| `deinflect-smoke.test.mjs` | deinflector regression test (run via `../../../scripts/yomifin-deinflect-smoke.sh`) |

Also ours, one level up in `utils/yomifin/`: `InMemoryDictionaryDatabase.ts` (storage
swap) and `lookup.test.ts` (Translator+DB integration test, run `bun utils/yomifin/lookup.test.ts`).

**Matching fidelity vs. Yomitan** — for the audit of *why our lookup can't silently miss a
word Yomitan would find* (which DB seams the Translator calls, which we stub and why that's
safe, and the known config-level divergences like `maxScanLength` and ZH having no text
preprocessors), see `../LOOKUP_FIDELITY.md`. Re-run that audit's `rg` check if you
re-vendor and the Translator's `this._database.*` call set changes.

## Re-vendor procedure

1. `cd yomitan && git pull` (the upstream clone is gitignored at repo root).
2. Re-copy the files in the tables above, re-apply the import-path flattening
   (subdir/parent prefixes → `./`). Leave `log.js` and `language-descriptors.js`
   (ours) alone unless the descriptor shape changed upstream.
3. Bump the pinned commit above. If upstream adds/removes a JA text preprocessor,
   mirror the `import { … } from './japanese-text-preprocessors.js'` list and the
   `textPreprocessors: { … }` object in `language-descriptors.js`. If upstream bumps
   `kanji-processor`, bump it in the app's `package.json` too.
4. `./scripts/yomifin-deinflect-smoke.sh` AND `bun utils/yomifin/lookup.test.ts`
   — both must stay green (regression guards). The lookup test includes the
   あっさり⇒漁る emphatic-collapse case that proves the preprocessors stay wired.

## Maintenance notes

- These files are **excluded from biome** (`biome.json`) so formatting never drifts
  from upstream — that is what keeps the diff minimal.
- The deinflector is near-zero maintenance; `japanese-transforms.js` only gains
  occasional rule additions upstream. Update opportunistically, not continuously.
