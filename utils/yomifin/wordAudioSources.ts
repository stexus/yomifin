/*
 * Phase 8 — word-audio ({audio} marker) source logic (pure, RN-free, bun-testable).
 *
 * Ports the SEMANTICS of Yomitan's audio sources (ext/js/media/audio-downloader.js),
 * not the file — upstream is welded to the extension stack (RequestBuilder,
 * SimpleDOMParser/parse5, browser TTS). Sources, tried in configured order until one
 * yields audio:
 *
 *   jpod101 — assets.languagepod101.com audiomp3.php?kanji=…&kana=… (Yomitan's
 *             primary JA source). Serves a KNOWN "no audio available" clip for missing
 *             words; detected by its SHA-256 (same digest Yomitan checks).
 *   jisho   — scrape jisho.org's search page for the <audio id="audio_term:reading">
 *             element's <source src>. Fallback when jpod101 lacks the word.
 *   custom  — user URL with {term}/{expression}/{reading} substitution (resilience).
 *             The response may be the audio itself OR Yomitan's custom-JSON schema
 *             ({"type":"audioSourceList","audioSources":[{url,…}]}).
 *
 * The RN-coupled fetch/hash/encode driver is wordAudio.ts; this module keeps the
 * testable parts (URL building, scrape extraction, JSON schema, base64).
 */

export type WordAudioSourceType = "jpod101" | "jisho" | "custom";

export interface WordAudioSourceConfig {
  type: WordAudioSourceType;
  enabled: boolean;
  /** custom only: URL template with {term} / {expression} / {reading}. */
  url?: string;
}

export const DEFAULT_WORD_AUDIO_SOURCES: WordAudioSourceConfig[] = [
  { type: "jpod101", enabled: true },
  { type: "jisho", enabled: true },
  { type: "custom", enabled: false, url: "" },
];

/** SHA-256 (hex) of jpod101's "no audio available" clip — same digest Yomitan checks. */
export const JPOD101_INVALID_AUDIO_SHA256 =
  "ae6398b5a27bc8c0a771df6c907ade794be15518174773c58c7c7ddd17098906";

/** Kana-only check (hiragana / katakana / prolonged sound mark / iteration marks). */
function isKanaOnly(s: string): boolean {
  return /^[\u3040-\u309f\u30a0-\u30ff\u30fc\u309d\u309e\u30fd\u30fe]+$/.test(
    s,
  );
}

/** Yomitan's jpod101 URL: kana-only terms send kana alone; else kanji + kana. */
export function jpod101Url(term: string, reading: string): string {
  const params = new URLSearchParams();
  if (reading === term && isKanaOnly(term)) {
    params.set("kana", term);
  } else {
    params.set("kanji", term);
    if (reading) params.set("kana", reading);
  }
  return `https://assets.languagepod101.com/dictionary/japanese/audiomp3.php?${params.toString()}`;
}

export function jishoSearchUrl(term: string): string {
  return `https://jisho.org/search/${encodeURIComponent(term)}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract the audio URL for term/reading from a jisho.org search page. Yomitan locates
 * the element `<audio id="audio_{term}:{reading}">`; we regex the same anchor and take
 * its first <source src>. Protocol-relative URLs are normalized to https.
 */
export function extractJishoAudioUrl(
  html: string,
  term: string,
  reading: string,
): string | null {
  const id = reading && reading !== term ? `${term}:${reading}` : term;
  const candidates = [
    `audio_${id}`,
    // Some entries key the audio element by kana only.
    reading ? `audio_${reading}` : "",
  ].filter(Boolean);
  for (const anchor of candidates) {
    const re = new RegExp(
      `<audio[^>]*\\bid="${escapeRegExp(anchor)}"[\\s\\S]{0,600}?<source[^>]*\\bsrc="([^"]+)"`,
      "i",
    );
    const m = re.exec(html);
    if (m) {
      const src = m[1];
      if (src.startsWith("//")) return `https:${src}`;
      if (src.startsWith("/")) return `https://jisho.org${src}`;
      return src;
    }
  }
  return null;
}

/** Substitute {term} / {expression} / {reading} into a custom URL template. */
export function customAudioUrl(
  template: string,
  term: string,
  reading: string,
): string {
  return template
    .replace(/\{term\}/g, encodeURIComponent(term))
    .replace(/\{expression\}/g, encodeURIComponent(term))
    .replace(/\{reading\}/g, encodeURIComponent(reading));
}

/**
 * Parse a Yomitan custom-JSON audio response into candidate URLs.
 * Accepts {"type":"audioSourceList","audioSources":[{url}|string,…]} and, for
 * resilience, a bare array of the same. Returns [] when the shape is unrecognized.
 */
export function parseCustomJsonAudio(body: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? (parsed as { audioSources?: unknown }).audioSources
      : undefined;
  if (!Array.isArray(list)) return [];
  const urls: string[] = [];
  for (const item of list) {
    if (typeof item === "string") urls.push(item);
    else if (item && typeof item === "object") {
      const url = (item as { url?: unknown }).url;
      if (typeof url === "string") urls.push(url);
    }
  }
  return urls;
}

/** Pick an Anki-friendly file extension from a Content-Type header. */
export function audioExtensionForMime(mime: string | null): string {
  const m = (mime ?? "").toLowerCase();
  if (m.includes("mp4") || m.includes("aac") || m.includes("m4a")) return "m4a";
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("wav")) return "wav";
  return "mp3";
}

const B64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Dependency-free base64 for fetched audio bytes (Hermes has no Buffer/btoa). */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    out +=
      i + 1 < bytes.length ? B64_ALPHABET[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? B64_ALPHABET[b2 & 63] : "=";
  }
  return out;
}

/** Inverse of bytesToBase64 (write fetched clips to disk for popup playback). */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const n0 = B64_ALPHABET.indexOf(clean[i]);
    const n1 = B64_ALPHABET.indexOf(clean[i + 1]);
    const n2 = i + 2 < clean.length ? B64_ALPHABET.indexOf(clean[i + 2]) : -1;
    const n3 = i + 3 < clean.length ? B64_ALPHABET.indexOf(clean[i + 3]) : -1;
    out[o++] = (n0 << 2) | (n1 >> 4);
    if (n2 >= 0) out[o++] = ((n1 & 15) << 4) | (n2 >> 2);
    if (n3 >= 0) out[o++] = ((n2 & 3) << 6) | n3;
  }
  return out.subarray(0, o);
}
