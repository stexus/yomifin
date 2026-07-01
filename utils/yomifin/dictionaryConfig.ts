/*
 * Pure (RN-free, unit-tested) reconciliation of the user's per-dictionary preferences
 * against the set of dictionaries actually installed in the combined SQLite db.
 *
 * The INVENTORY (what's installed) lives in the `dictionaries` table (dictionaryStore).
 * The PREFERENCES (enabled / priority order / tint) live in the app settings atom
 * (`yomifinDictionaryConfig`, keyed by dictionary title). This module joins the two:
 *
 *   installed titles ⨝ config  →  ResolvedDictionary[]  (ordered by priority)
 *
 * Feeding the enabled titles IN PRIORITY ORDER into YomifinDictionary is all that's
 * needed for the vendored Yomitan Translator to order definition blocks by priority —
 * its enabledDictionaryMap uses each name's array index as the dictionary order, and it
 * simply omits dictionaries not in the map (that's the enable/disable filter). Lookup
 * stays ONE indexed SQL query regardless of how many dictionaries are enabled.
 */

/** One dictionary's persisted preferences (value of yomifinDictionaryConfig[title]). */
export interface DictionaryPref {
  enabled: boolean;
  /** priority order, 0 = highest */
  order: number;
  /** accent color (hex) for the per-dictionary boundary in the popup */
  tint: string;
}

export type DictionaryConfig = Record<string, DictionaryPref>;

/** An installed dictionary joined with its (resolved) preferences. */
export interface ResolvedDictionary {
  title: string;
  enabled: boolean;
  order: number;
  tint: string;
}

/**
 * A small, legible palette used to auto-assign tints. Values are mid-saturation hues
 * that stay subtle when composited at low alpha over the (dark) popup background.
 */
export const DICTIONARY_TINT_PALETTE: string[] = [
  "#6cb6ff", // blue
  "#7ed6a5", // green
  "#e0a45e", // amber
  "#c99bf0", // violet
  "#ef8fa6", // rose
  "#5fc9d6", // teal
  "#d6c65f", // gold
  "#8fa6ef", // indigo
  "#e08f6c", // terracotta
  "#9bd06c", // lime
];

/** Stable string hash (FNV-ish) so a dictionary's default tint never shifts. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic default tint for a dictionary title (stable across reorders). */
export function defaultTint(title: string): string {
  return DICTIONARY_TINT_PALETTE[
    hashString(title) % DICTIONARY_TINT_PALETTE.length
  ];
}

/**
 * Join installed dictionaries with saved preferences and return them in priority order.
 * - Configured dictionaries keep their saved `order` (and are sorted by it).
 * - Newly installed dictionaries (absent from config) default to enabled and are
 *   appended after the configured ones, in the order `installed` lists them.
 * - Tint falls back to a stable per-title default when unset.
 * Config entries whose dictionary is no longer installed are ignored.
 */
export function resolveDictionaryConfig(
  installed: string[],
  config: DictionaryConfig,
): ResolvedDictionary[] {
  const items = installed.map((title) => {
    const pref = config[title];
    return {
      title,
      enabled: pref?.enabled ?? true,
      order: pref?.order,
      tint: pref?.tint,
    };
  });

  const configured = items
    .filter((i) => typeof i.order === "number")
    .sort((a, b) => (a.order as number) - (b.order as number));
  const fresh = items.filter((i) => typeof i.order !== "number");

  return [...configured, ...fresh].map((it, idx) => ({
    title: it.title,
    enabled: it.enabled,
    order: idx,
    tint: it.tint ?? defaultTint(it.title),
  }));
}

/** Enabled dictionary titles in priority order — the list fed to YomifinDictionary. */
export function enabledTitlesInOrder(resolved: ResolvedDictionary[]): string[] {
  return resolved.filter((r) => r.enabled).map((r) => r.title);
}

/** title → tint lookup for the popup's per-dictionary boundary rendering. */
export function tintMap(
  resolved: ResolvedDictionary[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const r of resolved) map[r.title] = r.tint;
  return map;
}

/** Materialize a resolved list back into the persisted config shape (all titles). */
export function materializeConfig(
  resolved: ResolvedDictionary[],
): DictionaryConfig {
  const config: DictionaryConfig = {};
  for (const r of resolved) {
    config[r.title] = { enabled: r.enabled, order: r.order, tint: r.tint };
  }
  return config;
}
