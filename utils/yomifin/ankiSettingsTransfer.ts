/*
 * Export / import of the per-profile Anki settings as a versioned JSON document
 * (Settings → Anki "Backup" section). PURE (RN-free, bun-tested): callers pass the
 * settings-shaped object in and persist the returned profile map themselves.
 *
 * Export contains the RAW stored AnkiConfig per profile (JA's legacy-key fallback
 * included via resolveProfile) — possibly partial; getAnkiConfig() already defaults
 * per-key on read, so importing a partial config is safe. The Azure TTS key rides
 * along on purpose: the whole point is cloning a working setup onto a fresh install.
 */

import type { AnkiConfig } from "./ankiConfig";
import {
  PROFILE_IDS,
  type ProfileId,
  type ProfileSettingsSource,
  resolveProfile,
  withProfileData,
  type YomifinProfileData,
} from "./profiles";

export const ANKI_SETTINGS_EXPORT_TYPE = "yomifin-anki-settings";
export const ANKI_SETTINGS_EXPORT_VERSION = 1;

export interface AnkiSettingsExport {
  type: typeof ANKI_SETTINGS_EXPORT_TYPE;
  version: typeof ANKI_SETTINGS_EXPORT_VERSION;
  exportedAt: string;
  profiles: Partial<Record<ProfileId, AnkiConfig>>;
}

/** Snapshot every configured profile's Anki config (unconfigured profiles omitted). */
export function buildAnkiSettingsExport(
  settings: ProfileSettingsSource,
  now: Date = new Date(),
): AnkiSettingsExport {
  const profiles: Partial<Record<ProfileId, AnkiConfig>> = {};
  for (const id of PROFILE_IDS) {
    const cfg = resolveProfile(settings, id).ankiConfig;
    if (cfg) profiles[id] = cfg;
  }
  return {
    type: ANKI_SETTINGS_EXPORT_TYPE,
    version: ANKI_SETTINGS_EXPORT_VERSION,
    exportedAt: now.toISOString(),
    profiles,
  };
}

export function serializeAnkiSettings(
  settings: ProfileSettingsSource,
  now?: Date,
): string {
  return JSON.stringify(buildAnkiSettingsExport(settings, now), null, 2);
}

/**
 * Parse + validate an export document. Throws with a human-readable message on
 * anything unrecognized (surfaced as a toast). Unknown profile keys are dropped.
 */
export function parseAnkiSettingsExport(
  json: string,
): Partial<Record<ProfileId, AnkiConfig>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Not a yomifin Anki settings export");
  const obj = parsed as Record<string, unknown>;
  if (obj.type !== ANKI_SETTINGS_EXPORT_TYPE)
    throw new Error("Not a yomifin Anki settings export");
  if (
    typeof obj.version !== "number" ||
    obj.version > ANKI_SETTINGS_EXPORT_VERSION
  )
    throw new Error(`Unsupported export version: ${String(obj.version)}`);
  const rawProfiles = obj.profiles;
  if (!rawProfiles || typeof rawProfiles !== "object")
    throw new Error("Export contains no profiles");
  const out: Partial<Record<ProfileId, AnkiConfig>> = {};
  for (const id of PROFILE_IDS) {
    const cfg = (rawProfiles as Record<string, unknown>)[id];
    if (cfg && typeof cfg === "object" && !Array.isArray(cfg))
      out[id] = cfg as AnkiConfig;
  }
  if (Object.keys(out).length === 0)
    throw new Error("Export contains no profile settings");
  return out;
}

/**
 * Merge imported per-profile configs into the stored profile map (other profile
 * data — dictionary config — untouched; profiles absent from the import untouched).
 */
export function applyAnkiSettingsImport(
  profiles: Partial<Record<ProfileId, YomifinProfileData>> | null | undefined,
  imported: Partial<Record<ProfileId, AnkiConfig>>,
): Partial<Record<ProfileId, YomifinProfileData>> {
  let next = profiles ?? {};
  for (const id of PROFILE_IDS) {
    const cfg = imported[id];
    if (cfg) next = withProfileData(next, id, { ankiConfig: cfg });
  }
  return next;
}
