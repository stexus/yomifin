/*
 * TRIMMED, LOCAL replacement for Yomitan's language/language-descriptors.js.
 *
 * Upstream registers ~50 languages, pulling every language's transforms/processors
 * into the bundle (and some use Hermes-unfriendly \p{} regex). For yomifin we only
 * need Japanese (now) and Chinese (later), so this file registers just those two and
 * keeps the rest of the vendored Translator graph pristine — `languages.js`,
 * `multi-language-transformer.js`, and `translator.js` are unmodified and consume
 * `languageDescriptorMap` from here unchanged.
 *
 * NOTE: textPreprocessors are intentionally EMPTY for now. Upstream's JA preprocessors
 * (width/kana/kanji normalization) pull in wanakana + a 618-line romaji table + the
 * external `kanji-processor` npm package. They are a fidelity enhancement, not the
 * lookup gate, and can be added back additively later (see PHASE2_YOMITAN.md). With
 * empty preprocessors the Translator simply looks up the raw (deinflected) text.
 *
 * Re-vendor note: this file is OURS, not copied — when bumping the upstream pin,
 * re-check that the descriptor shape (fields consumed by languages.js) still matches.
 */

import {normalizePinyin, isStringPartiallyChinese} from './chinese.js';
import {japaneseTransforms} from './japanese-transforms.js';
import {isStringPartiallyJapanese} from './japanese.js';

/** @type {import('language-descriptors').LanguageDescriptorAny[]} */
const languageDescriptors = [
    {
        iso: 'ja',
        iso639_3: 'jpn',
        name: 'Japanese',
        exampleText: '読め',
        isTextLookupWorthy: isStringPartiallyJapanese,
        textPreprocessors: {},
        languageTransforms: japaneseTransforms,
    },
    {
        iso: 'zh',
        iso639_3: 'zho',
        name: 'Chinese',
        exampleText: '读',
        isTextLookupWorthy: isStringPartiallyChinese,
        readingNormalizer: normalizePinyin,
        textPreprocessors: {},
    },
];

/** @type {Map<string, import('language-descriptors').LanguageDescriptorAny>} */
export const languageDescriptorMap = new Map();
for (const languageDescriptor of languageDescriptors) {
    languageDescriptorMap.set(languageDescriptor.iso, languageDescriptor);
}
