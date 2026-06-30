/*
 * Phase 3 (Anki) — HARDCODED config seam.
 *
 * Per IMPLEMENTATION_PLAN.md Phase 3, step 3: deck/note-type/fields are hardcoded for
 * the first end-to-end test ("hardcode-to-prove first"). This is the single source of
 * truth so the later Anki settings screen (Phase 5 / plan §"Config") is a drop-in:
 * replace `getAnkiConfig()` with a read from the settings store, nothing else changes.
 *
 * EDIT THESE for your server before the first card test:
 *  - url:   AnkiConnect endpoint. Anki must have `webBindAddress` = 0.0.0.0 (or the
 *           LAN IP) so it's reachable off-localhost. No CORS concern from RN (native
 *           fetch bypasses the browser allow-list).
 *  - deck/model: must already exist in Anki.
 *  - fields: map the note-type's field NAMES to the data we send. Any field whose name
 *           is left blank ("") is skipped.
 */

export interface AnkiFieldMap {
  /** Field name for the headword/lemma (e.g. "Expression"). */
  expression: string;
  /** Field name for the reading/kana (e.g. "Reading"). "" to skip. */
  reading: string;
  /** Field name for the source subtitle sentence (e.g. "Sentence"). "" to skip. */
  sentence: string;
  /** Field name for a plain-text gloss (e.g. "Meaning"). "" to skip. */
  glossary: string;
  /** Field name for the sentence audio clip (e.g. "SentenceAudio"). "" to skip. */
  sentenceAudio: string;
  /** Field name for the screenshot image (e.g. "Picture"). "" to skip. */
  picture: string;
}

export interface AnkiConfig {
  url: string;
  deckName: string;
  modelName: string;
  fields: AnkiFieldMap;
  tags: string[];
  allowDuplicate: boolean;
}

// >>> HARDCODED — edit for your server/note-type. <<<
const HARDCODED: AnkiConfig = {
  url: "http://10.0.0.193:8765",
  deckName: "Testing",
  modelName: "Lapis-Jp",
  fields: {
    expression: "Expression",
    reading: "ExpressionReading",
    sentence: "Sentence",
    glossary: "Glossary",
    sentenceAudio: "SentenceAudio",
    picture: "Picture",
  },
  tags: ["yomifin"],
  allowDuplicate: false,
};

/**
 * Returns the active Anki config. Phase 3: always the hardcoded values above.
 * Phase 5: swap this body to read from the settings store.
 */
export function getAnkiConfig(): AnkiConfig {
  return HARDCODED;
}
