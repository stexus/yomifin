/*
 * OURS, not vendored (like language-descriptors.js): Chinese text preprocessors.
 *
 * Upstream Yomitan ships NO zh text preprocessors, which means no
 * simplified↔traditional folding — a query in one script can't match a dictionary
 * entry stored in the other (LOOKUP_FIDELITY §4 documented this divergence). This
 * processor closes that gap: every lookup candidate is expanded with its
 * character-level simplified and traditional conversions, so a tap on 汉语 finds a
 * 漢語-keyed entry and vice versa.
 *
 * Conversion data comes from the `chinese-simple2traditional` npm dep (MIT,
 * char-level tables, pure JS, no Hermes-hostile \p{} regex — same precedent as the
 * `kanji-processor` dep the JA pipeline uses). We deliberately do NOT enable its
 * phrase-"enhance" mode: char-level folding is what lookup needs, and the variant
 * map in translator.js dedupes no-op conversions for free.
 *
 * Processor shape matches this vendored Translator's text-processors contract:
 * `process(str) => string[]` (each element becomes a lookup variant).
 */

import { toSimplified, toTraditional } from "chinese-simple2traditional";

/** @type {import('language').TextProcessor} */
export const foldScriptVariants = {
  name: "Fold simplified/traditional variants",
  description: "汉语 ↔ 漢語 — match entries stored in either script",
  process: (str) => [str, toSimplified(str), toTraditional(str)],
};
