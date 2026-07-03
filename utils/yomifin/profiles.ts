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
