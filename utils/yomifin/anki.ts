/*
 * AnkiConnect client + card assembly (Phase 3 base, Phase 8 marker engine).
 *
 * Posts a single card to the 24/7 server's AnkiConnect via native fetch (no CORS in
 * React Native; the user must still set AnkiConnect `webBindAddress` so it's reachable
 * off-localhost).
 *
 * Phase 8: fields are no longer a hardcoded name map. Each configured note-type field
 * carries a MARKER TEMPLATE (utils/yomifin/markers.ts) rendered against a
 * MarkerContext assembled here from the active pane, the popup selection, the captured
 * media and the selected cue range. Glossary structured content is FLATTENED to plain
 * text (we never ship the RN tree to Anki).
 */

import { type AnkiConfig, getAnkiConfig } from "./ankiConfig";
import type { CapturedMedia } from "./ankiMedia";
import { furiganaHtml, furiganaPlain } from "./furigana";
import type { LookupResult } from "./lookup";
import { collectMarkers, type MarkerContext, renderTemplate } from "./markers";
import { flattenSelectionText, type PopupSelection } from "./selection";
import { normalizeGlossary, scToText } from "./structuredContent";
import type { WordAudioResult } from "./wordAudio";

/** Raw AnkiConnect response envelope. */
interface AnkiResponse {
  result: unknown;
  error: string | null;
}

/** Low-level AnkiConnect invoke. Throws on transport error or AnkiConnect `error`. */
export async function ankiInvoke<T = unknown>(
  url: string,
  action: string,
  params: unknown = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, version: 6, params }),
    });
  } catch (e) {
    throw new Error(
      `Can't reach Anki at ${url}. Is the server up and webBindAddress set? (${
        (e as Error).message
      })`,
    );
  }
  if (!res.ok) throw new Error(`AnkiConnect HTTP ${res.status}`);
  const json = (await res.json()) as AnkiResponse;
  if (json.error) throw new Error(json.error);
  return json.result as T;
}

// --- Runtime note-type discovery (Settings → Anki screen) -----------------------

export function fetchDeckNames(url: string): Promise<string[]> {
  return ankiInvoke<string[]>(url, "deckNames");
}

export function fetchModelNames(url: string): Promise<string[]> {
  return ankiInvoke<string[]>(url, "modelNames");
}

export function fetchModelFieldNames(
  url: string,
  modelName: string,
): Promise<string[]> {
  return ankiInvoke<string[]>(url, "modelFieldNames", { modelName });
}

// --- Card assembly ----------------------------------------------------------------

export { scToText }; // re-export (moved to structuredContent.ts in Phase 8)

/** Flatten ONE headword's glossary blocks into a single plain-text gloss. */
export function flattenGloss(
  entry: LookupResult["entries"][number] | undefined,
): string {
  if (!entry) return "";
  const lines: string[] = [];
  for (const group of entry.definitions) {
    for (const item of group.glossary) {
      const text = scToText(normalizeGlossary(item)).trim();
      if (text) lines.push(text);
    }
  }
  return lines.join("\n").trim();
}

/** Per-dictionary flattened glossaries for the active pane ({single-glossary:…}). */
function glossaryByDictionary(
  entry: LookupResult["entries"][number] | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!entry) return out;
  for (const group of entry.definitions) {
    const lines: string[] = [];
    for (const item of group.glossary) {
      const text = scToText(normalizeGlossary(item)).trim();
      if (text) lines.push(text);
    }
    out[group.dictionary] = lines.join("\n").trim();
  }
  return out;
}

/** Data captured at tap/press time and assembled into a note. */
export interface CardData {
  result: LookupResult;
  /** Which headword pane the user is viewing — the card mines this one. Default 0. */
  activeIndex?: number;
  /** The selected cue range joined (or the live cue when there's no cue store). */
  sentence: string;
  /** Current popup selection (dictionary block / definition / sense / segment). */
  selection?: PopupSelection;
  /**
   * Manual trim fallback: user-edited selection text (popup ✎ editor). When set it
   * OVERRIDES `selection` for the {popup-selection-text} marker — the escape hatch
   * for layouts the sense heuristics can't segment (e.g. gaiji-image markers) or for
   * arbitrary trims ("just these two clauses").
   */
  customSelectionText?: string;
  /** Sentence split around the tapped word, frozen at tap time ({cloze-*}). */
  cloze?: { prefix: string; body: string; suffix: string };
  /** Playing media item's title ({document-title}). */
  documentTitle?: string;
  /** Phase 4: optional on-device screenshot + sentence-audio clip. */
  media?: CapturedMedia;
  /** Phase 8: optional word audio for the {audio} marker. */
  wordAudio?: WordAudioResult | null;
}

/** Assemble the MarkerContext for one card (pure aside from the data passed in). */
export function buildMarkerContext(data: CardData): MarkerContext {
  const entry = data.result.entries[data.activeIndex ?? 0];
  const m = data.media;
  const expression = entry?.term || data.result.matchedText || "";
  const reading = entry?.reading ?? "";
  const sentence = data.sentence ?? "";
  // Cloze: prefer the tap-time split; else a naive first-occurrence fallback.
  let cloze = data.cloze;
  if (!cloze) {
    const matched = data.result.matchedText ?? "";
    const at = matched ? sentence.indexOf(matched) : -1;
    cloze =
      at >= 0
        ? {
            prefix: sentence.slice(0, at),
            body: matched,
            suffix: sentence.slice(at + matched.length),
          }
        : { prefix: "", body: matched, suffix: "" };
  }
  const tags = [
    ...new Set(entry?.definitions.flatMap((g) => g.tags) ?? []),
  ].join(", ");
  return {
    expression,
    reading,
    furigana: furiganaHtml(expression, reading),
    furiganaPlain: furiganaPlain(expression, reading),
    sentence,
    clozePrefix: cloze.prefix,
    clozeBody: cloze.body,
    clozeSuffix: cloze.suffix,
    glossary: flattenGloss(entry),
    glossaryByDictionary: glossaryByDictionary(entry),
    selectionText:
      data.customSelectionText ??
      (data.selection ? flattenSelectionText(data.result, data.selection) : ""),
    conjugation: entry?.inflectionChain.join(" « ") ?? "",
    dictionary: entry?.definitions[0]?.dictionary ?? "",
    tags,
    documentTitle: data.documentTitle ?? "",
    audioRef: data.wordAudio ? `[sound:${data.wordAudio.filename}]` : "",
    sentenceAudioRef: m?.audioFilename ? `[sound:${m.audioFilename}]` : "",
    pictureRef: m?.imageFilename ? `<img src="${m.imageFilename}">` : "",
  };
}

/** Render every configured field template through the marker engine. */
export function buildFields(
  config: AnkiConfig,
  data: CardData,
): Record<string, string> {
  const ctx = buildMarkerContext(data);
  const fields: Record<string, string> = {};
  for (const [field, template] of Object.entries(config.fieldTemplates)) {
    if (!template?.trim()) continue; // "" = leave field blank
    fields[field] = renderTemplate(template, ctx);
  }
  return fields;
}

/** Store a base64 media file in Anki's collection (idempotent by filename). */
async function storeMedia(
  url: string,
  filename: string,
  base64: string,
): Promise<void> {
  await ankiInvoke(url, "storeMediaFile", { filename, data: base64 });
}

/**
 * Add one card to Anki. Resolves with the new note id on success; rejects with a
 * user-facing message (duplicate, missing deck/model, unreachable) on failure.
 */
export async function addAnkiCard(data: CardData): Promise<number> {
  const config = getAnkiConfig();
  const markers = collectMarkers(config.fieldTemplates);
  // Upload media first so the field references resolve — but only media a template
  // actually references (best-effort: a media upload failure shouldn't block a text
  // card, so swallow and continue).
  const m = data.media;
  try {
    if (markers.has("sentence-audio") && m?.audioFilename && m.audioBase64)
      await storeMedia(config.url, m.audioFilename, m.audioBase64);
    if (markers.has("picture") && m?.imageFilename && m.imageBase64)
      await storeMedia(config.url, m.imageFilename, m.imageBase64);
    if (markers.has("audio") && data.wordAudio)
      await storeMedia(
        config.url,
        data.wordAudio.filename,
        data.wordAudio.base64,
      );
  } catch (e) {
    console.warn("[YOMIFIN ANKI] storeMediaFile failed:", e);
  }
  const fields = buildFields(config, data);
  const note = {
    deckName: config.deckName,
    modelName: config.modelName,
    fields,
    tags: config.tags,
    options: {
      allowDuplicate: config.allowDuplicate,
      // Scope duplicate detection to the TARGET DECK only. Anki's default scope is the
      // whole collection (any note of this model), which falsely flags a word as a
      // "duplicate" when it exists in some OTHER deck (e.g. an old mining deck) but not
      // in this one. Deck scope matches user intent: "is this card already in my deck?"
      duplicateScope: "deck",
      duplicateScopeOptions: {
        deckName: config.deckName,
        checkChildren: false,
        checkAllModels: false,
      },
    },
  };
  console.log(
    `[YOMIFIN ANKI] addNote deck="${config.deckName}" model="${config.modelName}" ` +
      `fields=[${Object.keys(fields).join(",")}] media={audio:${!!m?.audioFilename},image:${!!m?.imageFilename},word:${!!data.wordAudio}} ` +
      `selection=${data.customSelectionText ? "custom" : (data.selection?.kind ?? "none")}`,
  );
  try {
    const id = await ankiInvoke<number>(config.url, "addNote", { note });
    console.log(`[YOMIFIN ANKI] addNote ok id=${id}`);
    return id;
  } catch (e) {
    console.warn(`[YOMIFIN ANKI] addNote failed: ${(e as Error).message}`);
    throw e;
  }
}
