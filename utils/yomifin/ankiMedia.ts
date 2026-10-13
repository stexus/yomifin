/*
 * Phase 4 (Anki quality cards) — on-device media capture.
 *
 * Captures a screenshot (frame at the tapped moment) and an audio clip ([cueStart,
 * cueEnd] of the source) using the native mpv seams (MPVKit-bundled ffmpeg + the
 * software render API, no server). Reads the resulting files to base64 for AnkiConnect.
 *
 * Cost control:
 *  - Capture runs ONLY when the user presses "+ Anki card", never on every lookup tap.
 *  - The cue + frame position are FROZEN at tap time (CaptureContext) so the capture is
 *    correct even though it runs later, and so it can seek a throwaway handle to exactly
 *    that spot.
 *  - The source URL and headers are explicit, including for offline files. Capture
 *    never falls back to the live player's source after Add has been pressed.
 *
 * Media dedup (batch mining): filenames are CONTENT-DERIVED (mediaKey.ts) — mining
 * several words from one sentence shares one .m4a + one .jpg. An in-session
 * Map<key, Promise> also collapses concurrent/repeated captures of the same media to
 * a single native capture, so "[YOMIFIN MEDIA]" fires once per distinct frame/clip.
 *
 * Best-effort: any failure returns partial/empty media so the card still gets created.
 */
import { File, Paths } from "expo-file-system";
import { CARD_CAPTURE_CACHE_MAX } from "@/constants/Mining";
import { audioMediaKey, imageMediaKey } from "./mediaKey";

export interface CaptureSource {
  /** Includes provider/server, item, and source/version identity (not just title). */
  id: string;
  url: string;
  headers: Record<string, string>;
}

/** Frozen at tap time; drives the (later) capture. Times are seconds. */
export interface CaptureContext {
  cueStart: number;
  cueEnd: number;
  /** Playback position when the word was tapped (the frame to grab). */
  framePos: number;
  source: CaptureSource;
}

/** The subset of the mpv player ref this module needs. */
export interface MediaCapturer {
  captureScreenshot: (
    path: string,
    sourceUrl: string,
    pos: number,
    headers: Record<string, string>,
  ) => Promise<boolean>;
  extractAudio: (
    start: number,
    end: number,
    audioId: number,
    path: string,
    sourceUrl: string,
    headers: Record<string, string>,
  ) => Promise<boolean>;
  getCurrentAudioTrack: () => Promise<number>;
}

export interface CapturedMedia {
  imageFilename?: string;
  imageBase64?: string;
  audioFilename?: string;
  audioBase64?: string;
}

/** Which media the card's field templates actually reference (Phase 8 gating). */
export interface MediaWant {
  image: boolean;
  audio: boolean;
}

/** Native file paths want a plain path, not a `file://` URI. */
function plainPath(uri: string): string {
  return uri.replace(/^file:\/\//, "");
}

interface MediaFile {
  filename: string;
  base64: string;
}

// In-session capture cache: media key → in-flight/settled capture. Successful results
// stay cached (base64 reused verbatim for the next card off the same line); failures
// are evicted so a retry re-captures. Bounded so a long session can't hoard base64.
const captureCache = new Map<string, Promise<MediaFile | null>>();
const pendingCaptures = new Set<string>();

function cached(
  key: string,
  produce: () => Promise<MediaFile | null>,
): Promise<MediaFile | null> {
  const hit = captureCache.get(key);
  if (hit) {
    console.log(`[YOMIFIN MEDIA] cache hit ${key}`);
    return hit;
  }
  const task = produce().then(
    (result) => {
      pendingCaptures.delete(key);
      if (result === null) captureCache.delete(key); // allow retry after failure
      // Never evict in-flight captures: another lookup would start a second writer
      // to the same temp file. Bound settled results without duplicating native work.
      for (const candidate of captureCache.keys()) {
        if (captureCache.size <= CARD_CAPTURE_CACHE_MAX) break;
        if (!pendingCaptures.has(candidate)) captureCache.delete(candidate);
      }
      return result;
    },
    (e) => {
      pendingCaptures.delete(key);
      captureCache.delete(key);
      throw e;
    },
  );
  pendingCaptures.add(key);
  captureCache.set(key, task);
  return task;
}

/** Best-effort temp-file delete (a leaked temp is also caught by the cache sweep). */
function tryDelete(file: File | null): void {
  try {
    if (file?.exists) file.delete();
  } catch {
    // ignore — sweepYomifinCacheFiles reclaims it later
  }
}

async function captureImage(
  player: MediaCapturer,
  key: string,
  source: CaptureSource,
  framePos: number,
): Promise<MediaFile | null> {
  let imgFile: File | null = null;
  try {
    const filename = `yomifin_${key}.jpg`;
    imgFile = new File(Paths.cache, filename);
    if (imgFile.exists) imgFile.delete();
    const ok = await player.captureScreenshot(
      plainPath(imgFile.uri),
      source.url,
      framePos,
      source.headers,
    );
    if (ok && imgFile.exists) {
      const base64 = await imgFile.base64();
      console.log(
        `[YOMIFIN MEDIA] screenshot ok: ${base64.length} b64 chars -> ${filename}`,
      );
      return { filename, base64 };
    }
    console.warn(
      `[YOMIFIN MEDIA] screenshot produced no image (native returned ${ok}, exists=${imgFile.exists}). Check native [captureScreenshot] logs.`,
    );
  } catch (e) {
    console.warn(
      `[YOMIFIN MEDIA] screenshot failed: ${(e as Error)?.message ?? e}`,
    );
  } finally {
    tryDelete(imgFile);
  }
  return null;
}

async function captureAudio(
  player: MediaCapturer,
  key: string,
  source: CaptureSource,
  cueStart: number,
  cueEnd: number,
  aid: number,
): Promise<MediaFile | null> {
  let audFile: File | null = null;
  try {
    const filename = `yomifin_${key}.m4a`;
    audFile = new File(Paths.cache, filename);
    if (audFile.exists) audFile.delete();
    const ok = await player.extractAudio(
      cueStart,
      cueEnd,
      aid,
      plainPath(audFile.uri),
      source.url,
      source.headers,
    );
    if (ok && audFile.exists) {
      const base64 = await audFile.base64();
      console.log(
        `[YOMIFIN MEDIA] audio ok (aid=${aid}): ${base64.length} b64 chars -> ${filename}`,
      );
      return { filename, base64 };
    }
    console.warn(
      `[YOMIFIN MEDIA] audio produced no clip (native returned ${ok}, exists=${audFile.exists}).`,
    );
  } catch (e) {
    console.warn(
      `[YOMIFIN MEDIA] audio extraction failed: ${(e as Error)?.message ?? e}`,
    );
  } finally {
    tryDelete(audFile);
  }
  return null;
}

/**
 * Prepare synchronously on Add, BEFORE yielding to paint the spinner. Copy all
 * inputs and start the audio-track read now, rather than after screenshot capture.
 * The returned function does the expensive work later using only these inputs.
 * `audioId` identifies a track in the supplied source: undefined reads the player's
 * selection; null skips audio when that selection cannot be mapped safely.
 */
export function prepareCardMedia(
  player: MediaCapturer,
  ctx: CaptureContext,
  want: MediaWant = { image: true, audio: true },
  audioId?: number | null,
): () => Promise<CapturedMedia> {
  const snapshot = {
    ...ctx,
    source: { ...ctx.source, headers: { ...ctx.source.headers } },
  };
  const requested = { ...want };
  const track =
    !want.audio || audioId === null
      ? Promise.resolve(null)
      : audioId !== undefined
        ? Promise.resolve(audioId)
        : player.getCurrentAudioTrack().catch(() => null);
  return async () => captureCardMedia(player, snapshot, requested, await track);
}

async function captureCardMedia(
  player: MediaCapturer,
  ctx: CaptureContext,
  want: MediaWant,
  audioId: number | null,
): Promise<CapturedMedia> {
  const out: CapturedMedia = {};
  if (!ctx.source.url) return out;
  const imgKey = imageMediaKey(ctx.source.id, ctx.framePos);
  const audKey = audioMediaKey(
    ctx.source.id,
    ctx.cueStart,
    ctx.cueEnd,
    audioId ?? 0,
  );
  console.log(
    `[YOMIFIN MEDIA] capture start keys={img:${imgKey},aud:${audKey}} want={img:${want.image},aud:${want.audio}} cue=[${ctx.cueStart.toFixed(2)},${ctx.cueEnd.toFixed(2)}] frame@${ctx.framePos.toFixed(2)} aid=${audioId}`,
  );

  // --- image (frame at tap position) ---
  if (want.image) {
    const img = await cached(imgKey, () =>
      captureImage(player, imgKey, ctx.source, ctx.framePos),
    ).catch(() => null);
    if (img) {
      out.imageFilename = img.filename;
      out.imageBase64 = img.base64;
    }
  }

  // --- audio clip ([cueStart, cueEnd] of the SELECTED cue range) ---
  if (want.audio) {
    if (ctx.cueEnd > ctx.cueStart && audioId !== null && audioId > 0) {
      const aud = await cached(audKey, () =>
        captureAudio(
          player,
          audKey,
          ctx.source,
          ctx.cueStart,
          ctx.cueEnd,
          audioId,
        ),
      ).catch(() => null);
      if (aud) {
        out.audioFilename = aud.filename;
        out.audioBase64 = aud.base64;
      }
    } else {
      console.warn(
        `[YOMIFIN MEDIA] skipping audio: unknown track or invalid cue range [${ctx.cueStart},${ctx.cueEnd}]`,
      );
    }
  }

  console.log(
    `[YOMIFIN MEDIA] capture done: image=${!!out.imageFilename} audio=${!!out.audioFilename}`,
  );
  return out;
}
