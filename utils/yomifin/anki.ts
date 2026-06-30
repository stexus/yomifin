/*
 * Phase 3 (Anki) — AnkiConnect client + card assembly.
 *
 * Posts a single sentence card to the 24/7 server's AnkiConnect via native fetch (no
 * CORS in React Native — the allow-list is a browser concern; the user must still set
 * AnkiConnect `webBindAddress` so it's reachable off-localhost). See plan Phase 3.
 *
 * Scope (MVP): sentence-only note — no audio/image (Phase 4). Glossary structured
 * content is FLATTENED to plain text here; we never ship the RN render tree to Anki.
 */

import { type AnkiConfig, getAnkiConfig } from "./ankiConfig";
import type { CapturedMedia } from "./ankiMedia";
import type { LookupResult } from "./lookup";
import { normalizeGlossary, type SCContent } from "./structuredContent";

/** Raw AnkiConnect response envelope. */
interface AnkiResponse {
  result: unknown;
  error: string | null;
}

/** Low-level AnkiConnect invoke. Throws on transport error or AnkiConnect `error`. */
async function invoke<T = unknown>(
  url: string,
  action: string,
  params: unknown,
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

/** Recursively flatten structured-content (or a plain string) to text. */
function scToText(node: SCContent): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(scToText).join("");
  // SCNode: recurse into content. Add a newline after list items / line breaks.
  const tag = (node as { tag?: string }).tag;
  const inner = scToText((node as { content?: SCContent }).content);
  if (tag === "br") return `${inner}\n`;
  if (tag === "li") return `${inner}\n`;
  return inner;
}

/** Flatten a lookup result's glossary blocks into a single plain-text gloss. */
function flattenGloss(result: LookupResult): string {
  const lines: string[] = [];
  for (const entry of result.entries) {
    for (const group of entry.definitions) {
      for (const item of group.glossary) {
        const text = scToText(normalizeGlossary(item)).trim();
        if (text) lines.push(text);
      }
    }
  }
  return lines.join("\n").trim();
}

/** Data captured at tap time and assembled into a note. */
export interface CardData {
  result: LookupResult;
  /** Full subtitle cue text, frozen at tap time. */
  sentence: string;
  /** Phase 4: optional on-device screenshot + audio clip. */
  media?: CapturedMedia;
}

/** Build the AnkiConnect `fields` object from config + card data. */
function buildFields(
  config: AnkiConfig,
  data: CardData,
): Record<string, string> {
  const entry = data.result.entries[0];
  const f = config.fields;
  const fields: Record<string, string> = {};
  if (f.expression)
    fields[f.expression] = entry?.term || data.result.matchedText || "";
  if (f.reading) fields[f.reading] = entry?.reading ?? "";
  if (f.sentence) fields[f.sentence] = data.sentence ?? "";
  if (f.glossary) fields[f.glossary] = flattenGloss(data.result);
  // Phase 4 media references (filenames are stored separately via storeMediaFile).
  const m = data.media;
  if (f.sentenceAudio && m?.audioFilename)
    fields[f.sentenceAudio] = `[sound:${m.audioFilename}]`;
  if (f.picture && m?.imageFilename)
    fields[f.picture] = `<img src="${m.imageFilename}">`;
  return fields;
}

/** Store a base64 media file in Anki's collection (idempotent by filename). */
async function storeMedia(
  url: string,
  filename: string,
  base64: string,
): Promise<void> {
  await invoke(url, "storeMediaFile", { filename, data: base64 });
}

/**
 * Add one sentence card to Anki. Resolves with the new note id on success; rejects
 * with a user-facing message (duplicate, missing deck/model, unreachable) on failure.
 */
export async function addAnkiCard(data: CardData): Promise<number> {
  const config = getAnkiConfig();
  // Upload media first so the field references resolve (best-effort: a media upload
  // failure shouldn't block a text card, so swallow and continue).
  const m = data.media;
  try {
    if (config.fields.sentenceAudio && m?.audioFilename && m.audioBase64)
      await storeMedia(config.url, m.audioFilename, m.audioBase64);
    if (config.fields.picture && m?.imageFilename && m.imageBase64)
      await storeMedia(config.url, m.imageFilename, m.imageBase64);
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
      `fields=[${Object.keys(fields).join(",")}] media={audio:${!!m?.audioFilename},image:${!!m?.imageFilename}}`,
  );
  try {
    const id = await invoke<number>(config.url, "addNote", { note });
    console.log(`[YOMIFIN ANKI] addNote ok id=${id}`);
    return id;
  } catch (e) {
    console.warn(`[YOMIFIN ANKI] addNote failed: ${(e as Error).message}`);
    throw e;
  }
}
