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
 *   wiktionary — Wikimedia Commons pronunciation files (File:Zh-你好.ogg et al) via
 *             the stable Special:FilePath redirect. The primary CHINESE source:
 *             real recordings, no scraping, 404 on miss. `lang` picks the filename
 *             prefix ("zh", "ja", "yue", …).
 *   azure-tts — Azure Speech synthesis (REST, needs region+key+voice). SYNTHESIZED,
 *             so by design it sits LAST in the order: it only runs when every
 *             recorded source missed ("TTS if word audio doesn't exist").
 *   custom  — user URL with {term}/{expression}/{reading} substitution (resilience).
 *             The response may be the audio itself OR Yomitan's custom-JSON schema
 *             ({"type":"audioSourceList","audioSources":[{url,…}]}).
 *
 * The RN-coupled fetch/hash/encode driver is wordAudio.ts; this module keeps the
 * testable parts (URL building, scrape extraction, JSON schema, SSML, base64).
 */

export type WordAudioSourceType =
  | "jpod101"
  | "jisho"
  | "wiktionary"
  | "azure-tts"
  | "custom";

export interface WordAudioSourceConfig {
  type: WordAudioSourceType;
  enabled: boolean;
  /** custom only: URL template with {term} / {expression} / {reading}. */
  url?: string;
  /** wiktionary only: Commons filename prefix ("zh", "ja", "yue", …). */
  lang?: string;
  /** azure-tts only: Azure Speech resource region (e.g. "eastasia"). */
  region?: string;
  /** azure-tts only: Azure Speech resource key. */
  key?: string;
  /** azure-tts only: voice name (e.g. "zh-CN-XiaoxiaoNeural"). */
  voice?: string;
}

/**
 * Per-language default source order. JA keeps the original jpod101/jisho pair;
 * ZH leads with Wiktionary/Commons recordings. Azure TTS is always LAST and
 * disabled until configured — synthesized audio is the everything-missed fallback.
 */
export function defaultWordAudioSources(
  language: string,
): WordAudioSourceConfig[] {
  if (language === "zh") {
    return [
      { type: "wiktionary", enabled: true, lang: "zh" },
      { type: "custom", enabled: false, url: "" },
      {
        type: "azure-tts",
        enabled: false,
        region: "",
        key: "",
        voice: "zh-CN-XiaoxiaoNeural",
      },
    ];
  }
  return [
    { type: "jpod101", enabled: true },
    { type: "jisho", enabled: true },
    { type: "wiktionary", enabled: false, lang: "ja" },
    { type: "custom", enabled: false, url: "" },
    {
      type: "azure-tts",
      enabled: false,
      region: "",
      key: "",
      voice: "ja-JP-NanamiNeural",
    },
  ];
}

/** Legacy alias — the JA defaults (kept for DEFAULT_ANKI_CONFIG stability). */
export const DEFAULT_WORD_AUDIO_SOURCES: WordAudioSourceConfig[] =
  defaultWordAudioSources("ja");

/**
 * Reconcile a STORED source list with the current defaults: keep the stored order
 * and settings verbatim, append any source type the stored list predates (e.g.
 * configs saved before wiktionary/azure-tts existed) with its default config.
 * Empty/absent stored list = the defaults.
 */
export function mergeWordAudioSources(
  stored: WordAudioSourceConfig[] | null | undefined,
  defaults: WordAudioSourceConfig[],
): WordAudioSourceConfig[] {
  const base = (stored ?? []).filter(
    (s) => s && typeof s === "object" && typeof s.type === "string",
  );
  if (base.length === 0) return defaults;
  const have = new Set(base.map((s) => s.type));
  return [...base, ...defaults.filter((d) => !have.has(d.type))];
}

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

// --- Wiktionary / Wikimedia Commons ----------------------------------------------------

/**
 * Diacritic → (base vowel, tone) map for pinyin tone marks (NFC precomposed —
 * normalizePinyinReading NFC-normalizes first).
 */
const PINYIN_TONE_MAP: Record<string, [string, number]> = {
  ā: ["a", 1],
  á: ["a", 2],
  ǎ: ["a", 3],
  à: ["a", 4],
  ē: ["e", 1],
  é: ["e", 2],
  ě: ["e", 3],
  è: ["e", 4],
  ī: ["i", 1],
  í: ["i", 2],
  ǐ: ["i", 3],
  ì: ["i", 4],
  ō: ["o", 1],
  ó: ["o", 2],
  ǒ: ["o", 3],
  ò: ["o", 4],
  ū: ["u", 1],
  ú: ["u", 2],
  ǔ: ["u", 3],
  ù: ["u", 4],
  ǖ: ["ü", 1],
  ǘ: ["ü", 2],
  ǚ: ["ü", 3],
  ǜ: ["ü", 4],
};

/**
 * Normalize a dictionary reading into Commons-style pinyin: NFC, lowercase,
 * separators (spaces / apostrophes / middle dots / hyphens) removed, u:/v → ü.
 * Returns "" when the reading doesn't look like pinyin at all (then only the
 * hanzi-named candidate is tried). CC-CEDICT's Yomitan readings are concatenated
 * diacritic pinyin ("nǐ", "māma") — exactly the dominant Commons naming.
 */
export function normalizePinyinReading(reading: string): string {
  const s = (reading ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s'’·-]/g, "")
    .replace(/u:/g, "ü")
    .replace(/v/g, "ü");
  if (!s) return "";
  for (const ch of s) {
    if (!/[a-z0-9ü]/.test(ch) && !PINYIN_TONE_MAP[ch]) return "";
  }
  return s;
}

/**
 * Numbered form of a SINGLE-syllable diacritic pinyin reading ("mǎ" → "ma3") —
 * Commons also hosts an older `Zh-hao3.ogg`-style set. Multi-syllable readings
 * return null (placing per-syllable digits would need full pinyin segmentation;
 * the diacritic-named files cover those). Single syllable ≈ exactly one tone mark
 * and one contiguous vowel group.
 */
export function numberedPinyinSyllable(p: string): string | null {
  let tone = 0;
  let marks = 0;
  let base = "";
  for (const ch of p) {
    const hit = PINYIN_TONE_MAP[ch];
    if (hit) {
      marks++;
      tone = hit[1];
      base += hit[0];
    } else base += ch;
  }
  if (marks !== 1) return null;
  if (!/^[a-zü]+$/.test(base) || base.length > 6) return null;
  if ((base.match(/[aeiouü]+/g) ?? []).length !== 1) return null;
  return `${base}${tone}`;
}

function commonsFilePathUrl(name: string): string {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}`;
}

/**
 * Candidate Commons FILE NAMES for a term.
 *
 * NAMING (verified against the live Commons inventory 2026-07-03): Chinese files
 * are named by PINYIN, not hanzi — `Zh-nǐ.ogg`, `Zh-māma.ogg`, `Zh-xièxie.ogg`
 * (concatenated lowercase diacritic pinyin, i.e. the CC-CEDICT reading verbatim),
 * plus an older single-syllable numbered set (`Zh-hao3.ogg`, `Zh-ma3.ogg`) and a
 * handful of hanzi-named encyclopedic phrases. Both .ogg and .oga exist. JA-style
 * languages keep term/kana naming (`Ja-猫.oga`).
 */
export function wiktionaryFileNames(
  lang: string,
  term: string,
  reading: string,
): string[] {
  const prefix = (lang || "zh").trim();
  const names: string[] = [];
  if (prefix.toLowerCase() === "zh") {
    const p = normalizePinyinReading(reading);
    if (p) {
      names.push(`${p}.ogg`, `${p}.oga`);
      const numbered = numberedPinyinSyllable(p);
      if (numbered && numbered !== p) names.push(`${numbered}.ogg`);
    }
    // Hanzi-named files exist only for a few long phrases — cheap last resort.
    if (term) names.push(`${term}.ogg`);
  } else {
    if (term) names.push(`${term}.ogg`, `${term}.oga`);
    if (reading && reading !== term)
      names.push(`${reading}.ogg`, `${reading}.oga`);
  }
  return names.map((n) => `${prefix}-${n}`);
}

/**
 * FALLBACK candidate URLs: blind Special:FilePath probes (redirect to the upload;
 * 404 = miss). Only used when the imageinfo API query fails — probing generates a
 * 404 per missing candidate and Wikimedia rate-limits 404 storms aggressively
 * (observed live: repeated probing → 429s on upload.wikimedia.org).
 */
export function wiktionaryAudioUrls(
  lang: string,
  term: string,
  reading: string,
): string[] {
  return wiktionaryFileNames(lang, term, reading).map(commonsFilePathUrl);
}

/**
 * ONE imageinfo API query resolving ALL candidate names to their upload URLs
 * (the preferred path: a complete miss costs a single 200 API response instead
 * of a train of 404s).
 */
export function commonsImageInfoUrl(names: string[]): string {
  const titles = names.map((n) => `File:${n}`).join("|");
  return `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url&titles=${encodeURIComponent(titles)}`;
}

/**
 * Parse the imageinfo response into existing upload URLs, in CANDIDATE order
 * (the API's `pages` map is keyed by pageid — order is meaningless; `normalized`
 * maps our requested titles to MediaWiki's, e.g. "File:zh-nǐ.ogg" → "File:Zh-nǐ.ogg").
 * Unrecognized shapes return [] (caller falls back to Special:FilePath probing).
 */
export function parseCommonsImageInfo(body: string, names: string[]): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const query = (parsed as { query?: unknown } | null)?.query as
    | {
        normalized?: Array<{ from?: unknown; to?: unknown }>;
        pages?: Record<
          string,
          { title?: unknown; imageinfo?: Array<{ url?: unknown }> }
        >;
      }
    | undefined;
  if (!query || typeof query !== "object") return [];
  const normalized = new Map<string, string>();
  if (Array.isArray(query.normalized)) {
    for (const n of query.normalized) {
      if (typeof n?.from === "string" && typeof n?.to === "string")
        normalized.set(n.from, n.to);
    }
  }
  const urlByTitle = new Map<string, string>();
  if (query.pages && typeof query.pages === "object") {
    for (const page of Object.values(query.pages)) {
      const url = page?.imageinfo?.[0]?.url;
      if (typeof page?.title === "string" && typeof url === "string")
        urlByTitle.set(page.title, url);
    }
  }
  const out: string[] = [];
  for (const name of names) {
    const from = `File:${name}`;
    const url = urlByTitle.get(normalized.get(from) ?? from);
    if (url) out.push(url);
  }
  return out;
}

// --- Azure TTS (synthesized fallback) --------------------------------------------------

/** Output format requested from Azure — mp3 keeps Anki/expo-audio happy. */
export const AZURE_TTS_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

export function azureTtsUrl(region: string): string {
  return `https://${region.trim()}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

/** BCP-47 lang implied by an Azure voice name ("zh-CN-XiaoxiaoNeural" → "zh-CN"). */
export function azureVoiceLang(voice: string): string {
  const m = /^([a-zA-Z]{2,3}-[a-zA-Z]{2,4})-/.exec(voice.trim());
  return m ? m[1] : "en-US";
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** SSML body for the Azure TTS REST endpoint. */
export function azureTtsSsml(voice: string, text: string): string {
  const v = voice.trim();
  return `<speak version='1.0' xml:lang='${azureVoiceLang(v)}'><voice name='${escapeXml(
    v,
  )}'>${escapeXml(text)}</voice></speak>`;
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
