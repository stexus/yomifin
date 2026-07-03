/*
 * Profiles — switchable { language, dictionary set, Anki config } bundles (JA/ZH).
 *
 * PURE (RN-free, bun-tested): callers pass the settings-shaped object in; nothing is
 * read from storage here. The design goal was "the current single-profile config
 * becomes the JA profile without migration": the LEGACY settings keys
 * (`yomifinDictionaryConfig`, `yomifinAnkiConfig`) remain the JA profile's fallback
 * storage, and the new `yomifinProfiles` map shadows them once a profile is edited.
 * ZH starts empty (all installed dictionaries enabled, default Anki config).
 *
 * Selection precedence (player): the subtitle/audio track's language tag maps to a
 * profile (profileIdForLanguageTag) and overrides the manually-selected
 * `yomifinActiveProfile`; default is JA.
 */

import type { AnkiConfig } from "./ankiConfig";
import type { DictionaryConfig } from "./dictionaryConfig";

export type ProfileId = "ja" | "zh";

export const PROFILE_IDS: ProfileId[] = ["ja", "zh"];

export const PROFILE_LABELS: Record<ProfileId, string> = {
  ja: "Japanese",
  zh: "Chinese",
};

/** Per-profile stored data (all optional — absent pieces resolve to defaults). */
export interface YomifinProfileData {
  dictionaryConfig?: DictionaryConfig;
  ankiConfig?: AnkiConfig | null;
}

/** The subset of the Settings shape this module reads (kept minimal to stay pure). */
export interface ProfileSettingsSource {
  yomifinActiveProfile?: ProfileId | null;
  yomifinProfiles?: Partial<Record<ProfileId, YomifinProfileData>> | null;
  /**
   * Per-title manual profile overrides (keyed by a stable per-series/item key the
   * players supply). Set by the in-player profile pill when the automatic
   * track-language selection is wrong; wins over the hint AND the manual default.
   */
  yomifinProfileOverrides?: Record<string, ProfileId> | null;
  /** LEGACY single-profile keys — the JA profile's fallback storage. */
  yomifinDictionaryConfig?: DictionaryConfig | null;
  yomifinAnkiConfig?: AnkiConfig | null;
}

export interface ResolvedProfile {
  id: ProfileId;
  /** ISO language fed to the Translator pipeline ("ja" | "zh"). */
  language: string;
  dictionaryConfig: DictionaryConfig;
  /** null = not configured → DEFAULT_ANKI_CONFIG applies downstream. */
  ankiConfig: AnkiConfig | null;
}

/** The manually-selected profile (Settings), defaulting to JA. */
export function activeProfileId(s: ProfileSettingsSource): ProfileId {
  const id = s.yomifinActiveProfile;
  return id === "zh" ? "zh" : "ja";
}

/**
 * Resolve one profile's data. JA falls back to the legacy single-profile keys when
 * the profile map has no (or partial) JA entry — so existing installs keep working
 * untouched, and the first edit through the profile-aware settings screens simply
 * starts shadowing the legacy keys.
 */
export function resolveProfile(
  s: ProfileSettingsSource,
  id: ProfileId,
): ResolvedProfile {
  const data = s.yomifinProfiles?.[id];
  const legacyDict = id === "ja" ? (s.yomifinDictionaryConfig ?? null) : null;
  const legacyAnki = id === "ja" ? (s.yomifinAnkiConfig ?? null) : null;
  return {
    id,
    language: id,
    dictionaryConfig: data?.dictionaryConfig ?? legacyDict ?? {},
    ankiConfig: data?.ankiConfig ?? legacyAnki ?? null,
  };
}

/**
 * The profile a lookup session actually uses. Precedence:
 *   1. per-title manual override (`yomifinProfileOverrides[overrideKey]`) — the
 *      user said the auto-selection was wrong for THIS series; remember it
 *   2. track-language hint (auto-select)
 *   3. the manually-active profile (Settings), default JA
 */
export function resolveEffectiveProfileId(
  s: ProfileSettingsSource,
  hint?: ProfileId | null,
  overrideKey?: string | null,
): ProfileId {
  const override = overrideKey
    ? s.yomifinProfileOverrides?.[overrideKey]
    : undefined;
  return override ?? hint ?? activeProfileId(s);
}

/**
 * Which profile a dictionary belongs to (Settings.yomifinDictionaryLanguages,
 * keyed by title). Unmapped = JA — so every pre-profiles install stays a JA
 * dictionary with zero migration.
 */
export function dictionaryProfile(
  map: Record<string, ProfileId> | null | undefined,
  title: string,
): ProfileId {
  return map?.[title] === "zh" ? "zh" : "ja";
}

/** Installed titles restricted to one profile's dictionaries (order preserved). */
export function titlesForProfile(
  titles: string[],
  map: Record<string, ProfileId> | null | undefined,
  id: ProfileId,
): string[] {
  return titles.filter((t) => dictionaryProfile(map, t) === id);
}

/**
 * Map a media-track language tag (Jellyfin `MediaStream.Language`, mpv `lang`) to a
 * profile. Returns null for unknown/absent tags so the caller falls back to the
 * manually-selected profile.
 */
export function profileIdForLanguageTag(
  tag: string | null | undefined,
): ProfileId | null {
  if (!tag) return null;
  const t = tag.trim().toLowerCase();
  // ISO 639-1/2/3 + BCP-47 prefixes (e.g. "zh-Hant", "ja-JP").
  if (t === "ja" || t === "jpn" || t === "jp" || t.startsWith("ja-"))
    return "ja";
  if (
    t === "zh" ||
    t === "zho" ||
    t === "chi" ||
    t === "cmn" ||
    t === "yue" ||
    t.startsWith("zh-")
  )
    return "zh";
  return null;
}

/**
 * Merge one profile's patch back into the stored profile map (what the settings
 * screens persist). Pure helper so the write shape stays consistent across screens.
 */
export function withProfileData(
  profiles: Partial<Record<ProfileId, YomifinProfileData>> | null | undefined,
  id: ProfileId,
  patch: Partial<YomifinProfileData>,
): Partial<Record<ProfileId, YomifinProfileData>> {
  return { ...(profiles ?? {}), [id]: { ...(profiles?.[id] ?? {}), ...patch } };
}
