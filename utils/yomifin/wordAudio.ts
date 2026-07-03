/*
 * Phase 8 — word-audio driver for the {audio} marker (RN-coupled: fetch + expo-crypto).
 *
 * Tries the configured sources in order (see wordAudioSources.ts for the pure logic /
 * provenance) until one yields a plausible audio clip. Best-effort by design: any
 * failure returns null and the card is still created ({audio} renders "").
 *
 * Called ONLY from the "+ Anki card" press, and only when some field template actually
 * uses {audio} (gated via collectMarkers) — ordinary lookups never hit the network.
 */
import * as Crypto from "expo-crypto";
import { wordAudioKey } from "./mediaKey";
import {
  audioExtensionForMime,
  bytesToBase64,
  customAudioUrl,
  extractJishoAudioUrl,
  JPOD101_INVALID_AUDIO_SHA256,
  jishoSearchUrl,
  jpod101Url,
  parseCustomJsonAudio,
  type WordAudioSourceConfig,
} from "./wordAudioSources";

export interface WordAudioResult {
  /** Anki media filename — content-derived (term+reading), so the same word always
   * maps to the same file and `storeMediaFile` stays idempotent across cards. */
  filename: string;
  base64: string;
}

const FETCH_TIMEOUT_MS = 8000;
/** Bodies smaller than this are error pages / empty clips, not audio. */
const MIN_AUDIO_BYTES = 256;

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Fetch one candidate URL as audio bytes; null if it doesn't look like audio. */
async function fetchAudioBytes(
  url: string,
  checkJpodSentinel: boolean,
): Promise<{ bytes: Uint8Array; mime: string | null } | null> {
  const res = await fetchWithTimeout(url);
  if (!res.ok) return null;
  const mime = res.headers.get("content-type");
  const buf = await res.arrayBuffer();
  if (buf.byteLength < MIN_AUDIO_BYTES) return null;
  if ((mime ?? "").toLowerCase().includes("text/html")) return null;
  if (checkJpodSentinel) {
    // expo-crypto's native digest requires a TypedArray — a raw ArrayBuffer throws
    // ArgumentCastException (NotTypedArrayException) on-device.
    const digest = await Crypto.digest(
      Crypto.CryptoDigestAlgorithm.SHA256,
      new Uint8Array(buf),
    );
    if (toHex(digest) === JPOD101_INVALID_AUDIO_SHA256) return null;
  }
  return { bytes: new Uint8Array(buf), mime };
}

/** Candidate audio URLs for one source (may itself require a network hop). */
async function candidateUrls(
  source: WordAudioSourceConfig,
  term: string,
  reading: string,
): Promise<string[]> {
  switch (source.type) {
    case "jpod101":
      return [jpod101Url(term, reading)];
    case "jisho": {
      const page = await fetchWithTimeout(jishoSearchUrl(term));
      if (!page.ok) return [];
      const url = extractJishoAudioUrl(await page.text(), term, reading);
      return url ? [url] : [];
    }
    case "custom": {
      const template = source.url?.trim();
      if (!template) return [];
      const url = customAudioUrl(template, term, reading);
      // The custom endpoint may answer with audio directly OR with Yomitan's
      // audioSourceList JSON. Probe once and branch on content-type.
      const res = await fetchWithTimeout(url);
      if (!res.ok) return [];
      const mime = (res.headers.get("content-type") ?? "").toLowerCase();
      if (mime.includes("json")) return parseCustomJsonAudio(await res.text());
      // Direct audio: re-fetch through the common path (cheap; keeps one validator).
      return [url];
    }
    default:
      return [];
  }
}

/**
 * Try the enabled sources in order; return the first valid clip, or null.
 * The filename is content-derived (term+reading hash) so repeated fetches of the
 * same word reference the SAME Anki media file.
 */
export async function fetchWordAudio(
  sources: WordAudioSourceConfig[],
  term: string,
  reading: string,
): Promise<WordAudioResult | null> {
  if (!term) return null;
  for (const source of sources) {
    if (!source.enabled) continue;
    try {
      const urls = await candidateUrls(source, term, reading);
      for (const url of urls) {
        const audio = await fetchAudioBytes(url, source.type === "jpod101");
        if (!audio) continue;
        const ext = audioExtensionForMime(audio.mime);
        const result: WordAudioResult = {
          filename: `yomifin_word_${wordAudioKey(term, reading)}.${ext}`,
          base64: bytesToBase64(audio.bytes),
        };
        console.log(
          `[YOMIFIN AUDIO] word audio via ${source.type}: ${audio.bytes.length} bytes -> ${result.filename}`,
        );
        return result;
      }
      console.log(`[YOMIFIN AUDIO] ${source.type}: no audio for "${term}"`);
    } catch (e) {
      console.warn(
        `[YOMIFIN AUDIO] ${source.type} failed: ${(e as Error)?.message ?? e}`,
      );
    }
  }
  return null;
}

// --- Session cache -------------------------------------------------------------------
// The popup's 🔊 button and "+ Anki card" both need the clip; fetch once, reuse. Only
// SUCCESSFUL fetches are cached (a transient network failure shouldn't stick), and the
// key includes the source config so toggling sources invalidates naturally.

const wordAudioCache = new Map<string, Promise<WordAudioResult | null>>();
const WORD_AUDIO_CACHE_MAX = 32;

export function fetchWordAudioCached(
  sources: WordAudioSourceConfig[],
  term: string,
  reading: string,
): Promise<WordAudioResult | null> {
  const key = `${wordAudioKey(term, reading)}|${JSON.stringify(
    sources.map((s) => (s.enabled ? `${s.type}:${s.url ?? ""}` : "")),
  )}`;
  const hit = wordAudioCache.get(key);
  if (hit) return hit;
  const task = fetchWordAudio(sources, term, reading).then(
    (result) => {
      if (result === null) wordAudioCache.delete(key); // allow retry
      return result;
    },
    (e) => {
      wordAudioCache.delete(key);
      throw e;
    },
  );
  if (wordAudioCache.size >= WORD_AUDIO_CACHE_MAX) {
    const oldest = wordAudioCache.keys().next().value;
    if (oldest !== undefined) wordAudioCache.delete(oldest);
  }
  wordAudioCache.set(key, task);
  return task;
}
