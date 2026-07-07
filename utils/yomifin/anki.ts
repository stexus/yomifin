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
import type { ProfileId } from "./profiles";
import {
  flattenSelectionHtml,
  flattenSelectionText,
  type PopupSelection,
} from "./selection";
import {
  type GlossaryDefinition,
  glossaryDefinitionsToHtml,
  normalizeGlossary,
  type SCContent,
  scToText,
} from "./structuredContent";
import type { WordAudioResult } from "./wordAudio";

/** Raw AnkiConnect response envelope. */
interface AnkiResponse {
  result: unknown;
  error: string | null;
}

/** Low-level AnkiConnect invoke. Throws on transport error or AnkiConnect `error`. */
// Without an explicit timeout RN's fetch can hang ~60s on an unreachable host, which
// reads as a frozen UI in the settings pane / card add. Control actions get a short
// budget; media uploads (base64 jpg/m4a bodies) get a longer one.
const ANKI_TIMEOUT_MS = 4_000;
const ANKI_UPLOAD_TIMEOUT_MS = 15_000;

export async function ankiInvoke<T = unknown>(
  url: string,
  action: string,
  params: unknown = {},
  timeoutMs: number = ANKI_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, version: 6, params }),
      signal: controller.signal,
    });
  } catch (e) {
    const aborted = (e as Error).name === "AbortError";
    throw new Error(
      aborted
        ? `Anki at ${url} didn't answer within ${timeoutMs / 1000}s. Is the server up and webBindAddress set?`
        : `Can't reach Anki at ${url}. Is the server up and webBindAddress set? (${
            (e as Error).message
          })`,
    );
  } finally {
    clearTimeout(timer);
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

/**
 * Trigger a full AnkiConnect → AnkiWeb sync of the whole collection. Unlike the
 * card config this is profile-agnostic (any configured URL syncs everything), so
 * callers just pass a URL. The sync can take a while server-side, so give it the
 * longer upload budget rather than the 4s control timeout.
 */
export function syncAnki(url: string): Promise<void> {
  return ankiInvoke<void>(url, "sync", {}, ANKI_UPLOAD_TIMEOUT_MS);
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

/** One definition group → the shape the HTML renderer wants. */
function toGlossaryDefinition(
  group: LookupResult["entries"][number]["definitions"][number],
): GlossaryDefinition {
  return {
    dictionary: group.dictionary,
    tags: group.tags,
    items: group.glossary.map((item) => normalizeGlossary(item) as SCContent),
  };
}

/**
 * Yomitan-style rendered HTML for one headword's glossary ({glossary}, HTML mode):
 * ONE numbered <ol> across ALL definitions, each <li> prefixed <i>(tags, dict)</i> —
 * exact default-template shape (see glossaryDefinitionsToHtml).
 */
export function glossHtml(
  entry: LookupResult["entries"][number] | undefined,
): string {
  if (!entry) return "";
  return glossaryDefinitionsToHtml(entry.definitions.map(toGlossaryDefinition));
}

/** Per-dictionary flattened glossaries for the active pane ({single-glossary:…}). */
function glossaryByDictionary(
  entry: LookupResult["entries"][number] | undefined,
  html: boolean,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!entry) return out;
  // One dictionary can contribute SEVERAL definitions — aggregate, never overwrite.
  const byDict = new Map<
    string,
    LookupResult["entries"][number]["definitions"]
  >();
  for (const group of entry.definitions) {
    const arr = byDict.get(group.dictionary) ?? [];
    arr.push(group);
    byDict.set(group.dictionary, arr);
  }
  for (const [dictionary, groups] of byDict) {
    if (html) {
      // dictionaryTag:false = Yomitan's brief mode — the dictionary is implied by the
      // marker itself; multiple definitions still get the numbered <ol>.
      out[dictionary] = glossaryDefinitionsToHtml(
        groups.map(toGlossaryDefinition),
        { dictionaryTag: false },
      );
      continue;
    }
    const lines: string[] = [];
    for (const group of groups) {
      for (const item of group.glossary) {
        const text = scToText(normalizeGlossary(item)).trim();
        if (text) lines.push(text);
      }
    }
    out[dictionary] = lines.join("\n").trim();
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
  /**
   * Which profile's Anki config (deck/model/templates) the card targets — the
   * EFFECTIVE profile at lookup time (track-language override included). Omitted =
   * the manually-active profile.
   */
  profileId?: ProfileId;
  /**
   * One-off override: add the note even if Anki reports it as a duplicate of the
   * first field in the target deck (the popup's "Add anyway" path — lets a new
   * reading through on an existing expression). Independent of the persisted
   * AnkiConfig.allowDuplicate setting.
   */
  forceDuplicate?: boolean;
}

/**
 * Assemble the MarkerContext for one card (pure aside from the data passed in).
 * `html` switches {glossary}/{single-glossary:…}/{popup-selection-text} to Yomitan-
 * parity rendered HTML (AnkiConfig.htmlGlossary). The ✎ custom text is always plain
 * (the user typed it as plain text).
 */
export function buildMarkerContext(
  data: CardData,
  html = false,
): MarkerContext {
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
    glossary: html ? glossHtml(entry) : flattenGloss(entry),
    glossaryByDictionary: glossaryByDictionary(entry, html),
    selectionText:
      data.customSelectionText ??
      (data.selection
        ? html
          ? flattenSelectionHtml(data.result, data.selection)
          : flattenSelectionText(data.result, data.selection)
        : ""),
    conjugation: entry?.inflectionChain.join(" « ") ?? "",
    dictionary: entry?.definitions[0]?.dictionary ?? "",
    tags,
    documentTitle: data.documentTitle ?? "",
    audioRef: data.wordAudio ? `[sound:${data.wordAudio.filename}]` : "",
    sentenceAudioRef: m?.audioFilename ? `[sound:${m.audioFilename}]` : "",
    pictureRef: m?.imageFilename ? `<img src="${m.imageFilename}">` : "",
  };
}

/** The note-type field Anki checks duplicates against (the first configured one). */
export function firstFieldName(config: AnkiConfig): string {
  return Object.keys(config.fieldTemplates)[0] ?? "";
}

/** Render every configured field template through the marker engine. */
export function buildFields(
  config: AnkiConfig,
  data: CardData,
): Record<string, string> {
  const ctx = buildMarkerContext(data, config.htmlGlossary);
  const fields: Record<string, string> = {};
  for (const [field, template] of Object.entries(config.fieldTemplates)) {
    if (!template?.trim()) continue; // "" = leave field blank
    fields[field] = renderTemplate(template, ctx);
  }
  return fields;
}

/**
 * Store a base64 media file in Anki's collection (idempotent by filename). Media
 * filenames are content-derived (mediaKey.ts), so a batch of cards mined from the
 * same line reuses files — the session Set skips re-uploading identical payloads.
 */
const uploadedMedia = new Set<string>();

async function storeMedia(
  url: string,
  filename: string,
  base64: string,
): Promise<void> {
  const key = `${url}|${filename}`;
  if (uploadedMedia.has(key)) {
    console.log(
      `[YOMIFIN ANKI] media already uploaded this session: ${filename}`,
    );
    return;
  }
  await ankiInvoke(
    url,
    "storeMediaFile",
    { filename, data: base64 },
    ANKI_UPLOAD_TIMEOUT_MS,
  );
  uploadedMedia.add(key);
}

/**
 * Assemble the AnkiConnect note object (fields + deck-scoped duplicate options).
 * Shared by addAnkiCard and the duplicate probe so both agree on exactly what Anki
 * will see (same fields, same duplicateScope). `forceAllowDuplicate` overrides the
 * persisted setting for the "Add anyway" one-off.
 */
function buildNote(
  config: AnkiConfig,
  data: CardData,
  forceAllowDuplicate?: boolean,
) {
  return {
    deckName: config.deckName,
    modelName: config.modelName,
    fields: buildFields(config, data),
    tags: config.tags,
    options: {
      allowDuplicate: forceAllowDuplicate ?? config.allowDuplicate,
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
}

export type AnkiDuplicateStatus = "unique" | "duplicate" | "unknown";

/**
 * Ask Anki (without adding anything) whether this card would collide with an
 * existing note's FIRST FIELD in the target deck — the popup's live duplicate
 * indicator. Uses `canAddNotesWithErrorDetail` (exact addNote semantics incl. HTML
 * stripping) with allowDuplicate FORCED off so a dup is actually surfaced; falls
 * back to the older `canAddNotes` boolean action, and returns "unknown" when the
 * server is unreachable, misconfigured, or the first field renders empty (nothing
 * meaningful to check). Never throws.
 */
export async function checkAnkiDuplicate(
  data: CardData,
): Promise<AnkiDuplicateStatus> {
  const config = getAnkiConfig(data.profileId);
  if (!config.url || !config.deckName || !config.modelName) return "unknown";
  const fields = buildFields(config, data);
  const first = fields[firstFieldName(config)] ?? "";
  if (!first.trim()) return "unknown";
  const note = buildNote(config, data, false);
  try {
    const res = await ankiInvoke<
      Array<{ canAdd: boolean; error?: string | null }>
    >(config.url, "canAddNotesWithErrorDetail", { notes: [note] });
    const r = res?.[0];
    if (!r) return "unknown";
    if (r.canAdd) return "unique";
    return (r.error ?? "").toLowerCase().includes("duplicate")
      ? "duplicate"
      : "unique";
  } catch {
    // Older AnkiConnect: no canAddNotesWithErrorDetail. canAddNotes returns bare
    // booleans; false (with a non-empty first field, already guarded) is a dup.
    try {
      const res = await ankiInvoke<boolean[]>(config.url, "canAddNotes", {
        notes: [note],
      });
      return res?.[0] === false ? "duplicate" : "unique";
    } catch {
      return "unknown";
    }
  }
}

/**
 * Add one card to Anki. Resolves with the new note id on success; rejects with a
 * user-facing message (duplicate, missing deck/model, unreachable) on failure.
 */
export async function addAnkiCard(data: CardData): Promise<number> {
  const config = getAnkiConfig(data.profileId);
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
  const note = buildNote(config, data, data.forceDuplicate);
  const fields = note.fields;
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
