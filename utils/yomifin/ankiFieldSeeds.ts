/*
 * Phase 8 — field-template seeding heuristics (pure, RN-free, bun-testable).
 *
 * Split from ankiConfig.ts (which imports react-native-mmkv) so the heuristics can be
 * unit-tested under bun. Re-exported by ankiConfig.ts for app code.
 */

/**
 * Seed marker templates for a freshly-discovered note type's fields, by name
 * heuristics (first matching rule wins; unmatched fields stay ""). Existing
 * user-entered templates should be preserved by the caller — this only fills gaps.
 */
export function seedFieldTemplates(
  fieldNames: string[],
): Record<string, string> {
  const rules: Array<[RegExp, string]> = [
    [/sentence.?audio|audio.?sentence/i, "{sentence-audio}"],
    [
      /^(audio|word.?audio|expression.?audio|vocab.?audio|term.?audio)$/i,
      "{audio}",
    ],
    [/reading|furigana|kana|pinyin/i, "{reading}"],
    [/^(expression|word|term|vocab|vocabulary|front)$/i, "{expression}"],
    [/sentence|context/i, "{sentence}"],
    [/gloss|meaning|definition/i, "{glossary}"],
    [/picture|image|screenshot/i, "{picture}"],
  ];
  const out: Record<string, string> = {};
  for (const name of fieldNames) {
    const rule = rules.find(([re]) => re.test(name));
    out[name] = rule ? rule[1] : "";
  }
  return out;
}
