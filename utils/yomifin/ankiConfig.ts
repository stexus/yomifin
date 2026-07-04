/*
 * Phase 8 — RUNTIME Anki config (supersedes the Phase 3 hardcoded seam).
 *
 * `getAnkiConfig()` is still the single seam everything downstream goes through
 * (STATUS promised this), but it now reads the settings store
 * (`Settings.yomifinAnkiConfig`, written by Settings → Anki). Fields are no longer a
 * hardcoded name map: the note type is chosen at runtime (AnkiConnect `modelNames` /
 * `modelFieldNames`) and each discovered field carries a MARKER TEMPLATE rendered by
 * utils/yomifin/markers.ts at card time. The old hardcoded map survives only as the
 * DEFAULT the settings screen seeds.
 */
import { storage } from "@/utils/mmkv";
import { seedFieldTemplates } from "./ankiFieldSeeds";
import {
  activeProfileId,
  type ProfileId,
  type ProfileSettingsSource,
  resolveProfile,
} from "./profiles";
import {
  DEFAULT_WORD_AUDIO_SOURCES,
  defaultWordAudioSources,
  mergeWordAudioSources,
  type WordAudioSourceConfig,
} from "./wordAudioSources";

export { seedFieldTemplates };

export interface AnkiConfig {
  /** AnkiConnect endpoint (Anki needs webBindAddress=0.0.0.0 to be reachable). */
  url: string;
  deckName: string;
  modelName: string;
  /**
   * Note-type field name → marker template (e.g. "Expression" → "{expression}").
   * "" = leave that field blank. Rendered by renderTemplate() at card time.
   */
  fieldTemplates: Record<string, string>;
  tags: string[];
  allowDuplicate: boolean;
  /**
   * Ship Yomitan-style rendered HTML for {glossary} / {single-glossary:…} /
   * {popup-selection-text} (structured content → <div class="yomitan-glossary">…)
   * instead of flattened plain text.
   */
  htmlGlossary: boolean;
  /** Ordered sources for the {audio} (word audio) marker. */
  wordAudioSources: WordAudioSourceConfig[];
}

/**
 * Default config — the old Phase 3 hardcoded values, expressed as templates. This is
 * what the settings screen seeds on first open; it also keeps a fresh install working
 * against the original test deck without any setup.
 */
export const DEFAULT_ANKI_CONFIG: AnkiConfig = {
  url: "http://10.0.0.193:8765",
  deckName: "Testing",
  modelName: "Lapis-Jp",
  fieldTemplates: {
    Expression: "{expression}",
    ExpressionReading: "{reading}",
    Sentence: "{sentence}",
    Glossary: "{glossary}",
    SentenceAudio: "{sentence-audio}",
    Picture: "{picture}",
  },
  tags: ["yomifin"],
  allowDuplicate: false,
  htmlGlossary: false,
  wordAudioSources: DEFAULT_WORD_AUDIO_SOURCES,
};

/**
 * Returns the active Anki config: the settings-stored one, defaulted per-key so a
 * partially-configured store still yields something usable. Imperative mmkv read
 * (same "settings" blob the jotai atom persists) so non-React code can call it.
 *
 * Profiles: `profileId` selects which profile's config to read (the popup threads
 * the EFFECTIVE profile — track-language override included); omitted = the
 * manually-active profile. JA falls back to the legacy `yomifinAnkiConfig` key
 * (profiles.ts no-migration design).
 */
export function getAnkiConfig(profileId?: ProfileId): AnkiConfig {
  try {
    const raw = storage.getString("settings");
    const settings = raw
      ? (JSON.parse(raw) as ProfileSettingsSource)
      : ({} as ProfileSettingsSource);
    const id = profileId ?? activeProfileId(settings);
    const stored = resolveProfile(settings, id)
      .ankiConfig as Partial<AnkiConfig> | null;
    // Word-audio defaults are per-language (ZH leads with Wiktionary recordings);
    // stored lists get new source types appended so old configs pick them up.
    const audioDefaults = defaultWordAudioSources(id);
    if (!stored)
      return { ...DEFAULT_ANKI_CONFIG, wordAudioSources: audioDefaults };
    return {
      ...DEFAULT_ANKI_CONFIG,
      ...stored,
      fieldTemplates:
        stored.fieldTemplates ?? DEFAULT_ANKI_CONFIG.fieldTemplates,
      tags: stored.tags ?? DEFAULT_ANKI_CONFIG.tags,
      wordAudioSources: mergeWordAudioSources(
        stored.wordAudioSources,
        audioDefaults,
      ),
    };
  } catch (e) {
    console.warn("[YOMIFIN ANKI] config read failed, using defaults:", e);
    return DEFAULT_ANKI_CONFIG;
  }
}
