/*
 * Phase 8 — Yomitan-style field marker engine (pure, RN-free, bun-testable).
 *
 * A note-type field's value is a TEMPLATE STRING of `{marker}` tokens rendered against
 * a MarkerContext assembled at card time (active pane + popup selection + captured
 * media + selected cue range). This kills the hardcoded field map: `buildFields`
 * renders every configured field template through `renderTemplate`.
 *
 * Supported markers:
 *   {expression} {word}          headword of the active pane
 *   {reading}                    reading/kana of the active pane
 *   {furigana}                   headword as HTML ruby (読む → <ruby>読<rt>よ</rt>…)
 *   {furigana-plain}             headword in Anki furigana syntax (読[よ]む)
 *   {sentence}                   selected cue range joined (default 1 cue)
 *   {cloze-prefix} {cloze-body} {cloze-suffix}
 *                                the sentence split around the tapped word
 *   {glossary}                   full flattened glossary of the active pane
 *   {single-glossary:DICT}       only that dictionary's glossary (also accepts
 *                                {single-glossary-DICT}, Yomitan's spelling)
 *   {popup-selection-text}       the flattened popup selection (or the ✎-edited
 *   {selection} {selection-text} text); EMPTY when nothing is selected
 *   {conjugation}                deinflection chain (食べさせられた → causative « …)
 *   {dictionary}                 name of the pane's highest-priority dictionary
 *   {tags}                       the pane's dictionary tags, joined
 *   {document-title}             the playing media item's title
 *   {audio}                      word-audio [sound:…] ref ("" if unavailable)
 *   {sentence-audio}             sentence clip [sound:…] ref over the cue range
 *   {picture}                    captured frame <img> ref
 *
 * Yomitan-parity note: this is the portable subset of Yomitan's marker set. The
 * pitch/frequency markers are out of scope (definitions-only scope), and
 * Yomitan's full Handlebars template system is NOT vendored — it runs in an offscreen
 * iframe with DOM access (HTML structured-content generation, media provider), which
 * doesn't lift into Hermes/RN cheaply. Revisit only if conditional templates become a
 * real need.
 *
 * Unknown markers are left VERBATIM in the output so a typo is visible on the card
 * instead of silently vanishing.
 */

export interface MarkerContext {
  expression: string;
  reading: string;
  /** HTML ruby form of the headword ({furigana}). */
  furigana: string;
  /** Anki furigana syntax ({furigana-plain}, e.g. "読[よ]む"). */
  furiganaPlain: string;
  /** Selected cue range joined to one string (single live cue when no store). */
  sentence: string;
  /** Sentence split around the tapped word ({cloze-*}). */
  clozePrefix: string;
  clozeBody: string;
  clozeSuffix: string;
  /** Full flattened glossary of the active pane (all enabled dictionaries). */
  glossary: string;
  /** dictionary title → flattened glossary text, for {single-glossary:…}. */
  glossaryByDictionary: Record<string, string>;
  /** Flattened popup selection (or ✎-edited text); "" = nothing selected. */
  selectionText: string;
  /** Deinflection chain, «-joined ({conjugation}). */
  conjugation: string;
  /** The pane's highest-priority dictionary name ({dictionary}). */
  dictionary: string;
  /** The pane's dictionary tags, joined ({tags}). */
  tags: string;
  /** Playing media item's title ({document-title}). */
  documentTitle: string;
  /** "[sound:…]" for the word audio, or "". */
  audioRef: string;
  /** "[sound:…]" for the sentence clip, or "". */
  sentenceAudioRef: string;
  /** "<img src=…>" for the captured frame, or "". */
  pictureRef: string;
}

export function emptyMarkerContext(): MarkerContext {
  return {
    expression: "",
    reading: "",
    furigana: "",
    furiganaPlain: "",
    sentence: "",
    clozePrefix: "",
    clozeBody: "",
    clozeSuffix: "",
    glossary: "",
    glossaryByDictionary: {},
    selectionText: "",
    conjugation: "",
    dictionary: "",
    tags: "",
    documentTitle: "",
    audioRef: "",
    sentenceAudioRef: "",
    pictureRef: "",
  };
}

const TOKEN_RE = /\{([^{}]+)\}/g;

/** Parse "single-glossary:Name" / "single-glossary-Name" → "Name" (null if not one). */
function singleGlossaryName(token: string): string | null {
  const m = /^single-glossary[:-](.+)$/.exec(token);
  return m ? m[1].trim() : null;
}

/** Resolve a dictionary name against the context map: exact, then case-insensitive. */
function resolveSingleGlossary(
  name: string,
  map: Record<string, string>,
): string | null {
  if (Object.hasOwn(map, name)) return map[name];
  const lower = name.toLowerCase();
  for (const key of Object.keys(map)) {
    if (key.toLowerCase() === lower) return map[key];
  }
  return null;
}

/**
 * Substitute all `{marker}` tokens in `template` against `ctx`.
 * Unknown markers stay verbatim (visible typo > silent drop).
 */
export function renderTemplate(template: string, ctx: MarkerContext): string {
  return template.replace(TOKEN_RE, (raw, token: string) => {
    const t = token.trim();
    switch (t) {
      case "expression":
      case "word":
        return ctx.expression;
      case "reading":
        return ctx.reading;
      case "furigana":
        return ctx.furigana;
      case "furigana-plain":
        return ctx.furiganaPlain;
      case "sentence":
        return ctx.sentence;
      case "cloze-prefix":
        return ctx.clozePrefix;
      case "cloze-body":
        return ctx.clozeBody;
      case "cloze-suffix":
        return ctx.clozeSuffix;
      case "glossary":
        return ctx.glossary;
      case "conjugation":
        return ctx.conjugation;
      case "dictionary":
        return ctx.dictionary;
      case "tags":
        return ctx.tags;
      case "document-title":
        return ctx.documentTitle;
      case "audio":
        return ctx.audioRef;
      case "sentence-audio":
        return ctx.sentenceAudioRef;
      case "picture":
        return ctx.pictureRef;
      // Empty when nothing is selected — do NOT fall back to the glossary (device
      // feedback: fallback silently duplicated {glossary} on every card).
      case "popup-selection-text":
      case "selection":
      case "selection-text":
        return ctx.selectionText;
      default: {
        const dict = singleGlossaryName(t);
        if (dict !== null) {
          const gloss = resolveSingleGlossary(dict, ctx.glossaryByDictionary);
          // Known marker, unknown dictionary → empty (the dict may be uninstalled).
          return gloss ?? "";
        }
        return raw; // unknown marker: leave verbatim
      }
    }
  });
}

/**
 * Canonical marker names used across a set of field templates. `single-glossary:X`
 * collapses to "single-glossary". Used to gate expensive work (media capture, word
 * audio) on whether any field actually references it.
 */
export function collectMarkers(
  fieldTemplates: Record<string, string>,
): Set<string> {
  const out = new Set<string>();
  for (const template of Object.values(fieldTemplates)) {
    if (!template) continue;
    for (const m of template.matchAll(TOKEN_RE)) {
      const t = m[1].trim();
      out.add(singleGlossaryName(t) !== null ? "single-glossary" : t);
    }
  }
  return out;
}
