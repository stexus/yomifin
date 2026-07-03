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
 * NOTE: the JA textPreprocessors are Yomitan's REAL upstream object, vendored as-is
 * (`japanese-text-preprocessors.js`) — not re-implemented here — so re-vendoring stays a
 * cheap diff. This gives full matching fidelity: emphatic collapsing (あっさり → あさり →
 * 漁る), half/full-width, hiragana↔katakana, romaji→kana, CJK-compat, and kanji-variant
 * folding (萬 → 万, via the tiny `kanji-processor` npm dep). All are Hermes-safe (no \p{}).
 * ZH gets OUR simplified↔traditional folding preprocessor (chinese-text-preprocessors.js,
 * also ours) so either script matches entries stored in the other.
 *
 * Re-vendor note: this file is OURS, not copied — when bumping the upstream pin,
 * re-check that the descriptor shape (fields consumed by languages.js) still matches.
 */

import {normalizePinyin, isStringPartiallyChinese} from './chinese.js';
import {foldScriptVariants} from './chinese-text-preprocessors.js';
import {japaneseTransforms} from './japanese-transforms.js';
import {isStringPartiallyJapanese} from './japanese.js';
import {
    alphabeticToHiragana,
    alphanumericWidthVariants,
    collapseEmphaticSequences,
    convertHalfWidthCharacters,
    convertHiraganaToKatakana,
    normalizeCJKCompatibilityCharacters,
    normalizeCombiningCharacters,
    standardizeKanji,
} from './japanese-text-preprocessors.js';

/** @type {import('language-descriptors').LanguageDescriptorAny[]} */
const languageDescriptors = [
    {
        iso: 'ja',
        iso639_3: 'jpn',
        name: 'Japanese',
        exampleText: '読め',
        isTextLookupWorthy: isStringPartiallyJapanese,
        textPreprocessors: {
            convertHalfWidthCharacters,
            alphabeticToHiragana,
            alphanumericWidthVariants,
            convertHiraganaToKatakana,
            collapseEmphaticSequences,
            normalizeCombiningCharacters,
            normalizeCJKCompatibilityCharacters,
            standardizeKanji,
        },
        languageTransforms: japaneseTransforms,
    },
    {
        iso: 'zh',
        iso639_3: 'zho',
        name: 'Chinese',
        exampleText: '读',
        isTextLookupWorthy: isStringPartiallyChinese,
        readingNormalizer: normalizePinyin,
        textPreprocessors: {
            foldScriptVariants,
        },
    },
];

/** @type {Map<string, import('language-descriptors').LanguageDescriptorAny>} */
export const languageDescriptorMap = new Map();
for (const languageDescriptor of languageDescriptors) {
    languageDescriptorMap.set(languageDescriptor.iso, languageDescriptor);
}
