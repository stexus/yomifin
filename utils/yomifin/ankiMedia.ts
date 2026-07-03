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
 *  - `sourceUrl` should be the STATIC/original stream (e.g. `?static=true`) so the
 *    throwaway handle's seek is a plain HTTP range request — never a transcode. Empty
 *    string => native falls back to the currently-playing URL (e.g. local/offline file).
 *
 * Media dedup (batch mining): filenames are CONTENT-DERIVED (mediaKey.ts) — mining
 * several words from one sentence shares one .m4a + one .jpg. An in-session
 * Map<key, Promise> also collapses concurrent/repeated captures of the same media to
 * a single native capture, so "[YOMIFIN MEDIA]" fires once per distinct frame/clip.
 *
 * Best-effort: any failure returns partial/empty media so the card still gets created.
 */
import { File, Paths } from "expo-file-system";
import { audioMediaKey, imageMediaKey } from "./mediaKey";

/** Frozen at tap time; drives the (later) capture. Times are seconds. */
export interface CaptureContext {
  cueStart: number;
  cueEnd: number;
  /** Playback position when the word was tapped (the frame to grab). */
  framePos: number;
}

/** The subset of the mpv player ref this module needs. */
export interface MediaCapturer {
  captureScreenshot: (
    path: string,
    sourceUrl: string,
    pos: number,
  ) => Promise<boolean>;
  extractAudio: (
    start: number,
    end: number,
    audioId: number,
    path: string,
    sourceUrl: string,
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
const CAPTURE_CACHE_MAX = 12;

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
      if (result === null) captureCache.delete(key); // allow retry after failure
      return result;
    },
    (e) => {
      captureCache.delete(key);
      throw e;
    },
  );
  if (captureCache.size >= CAPTURE_CACHE_MAX) {
    const oldest = captureCache.keys().next().value;
    if (oldest !== undefined) captureCache.delete(oldest);
  }
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
  sourceUrl: string,
  framePos: number,
): Promise<MediaFile | null> {
  let imgFile: File | null = null;
  try {
    const filename = `yomifin_${key}.jpg`;
    imgFile = new File(Paths.cache, filename);
    if (imgFile.exists) imgFile.delete();
    const ok = await player.captureScreenshot(
      plainPath(imgFile.uri),
      sourceUrl,
      framePos,
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
  sourceUrl: string,
  cueStart: number,
  cueEnd: number,
): Promise<MediaFile | null> {
  let audFile: File | null = null;
  try {
    const aid = await player.getCurrentAudioTrack().catch(() => 0);
    const filename = `yomifin_${key}.m4a`;
    audFile = new File(Paths.cache, filename);
    if (audFile.exists) audFile.delete();
    const ok = await player.extractAudio(
      cueStart,
      cueEnd,
      aid ?? 0,
      plainPath(audFile.uri),
      sourceUrl,
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
 * Capture frame + audio clip for one card. Call this on "+ Anki card" press (NOT on
 * tap). `ctx` is the tap-time snapshot (its cue range may have been widened by the
 * popup's multi-cue selection); `mediaId` is a stable identity for the playing item
 * (itemId) that keys the content-derived filenames; `sourceUrl` is the static/original
 * stream ("" => native uses the playing URL). `want` gates each capture on whether
 * some field template actually references it (Phase 8).
 */
export async function captureCardMedia(
  player: MediaCapturer,
  ctx: CaptureContext,
  mediaId: string,
  sourceUrl: string,
  want: MediaWant = { image: true, audio: true },
): Promise<CapturedMedia> {
  const out: CapturedMedia = {};
  const imgKey = imageMediaKey(mediaId, ctx.framePos);
  const audKey = audioMediaKey(mediaId, ctx.cueStart, ctx.cueEnd);
  console.log(
    `[YOMIFIN MEDIA] capture start keys={img:${imgKey},aud:${audKey}} want={img:${want.image},aud:${want.audio}} cue=[${ctx.cueStart.toFixed(2)},${ctx.cueEnd.toFixed(2)}] frame@${ctx.framePos.toFixed(2)} src=${sourceUrl ? "static" : "playing"}`,
  );

  // --- image (frame at tap position) ---
  if (want.image) {
    const img = await cached(imgKey, () =>
      captureImage(player, imgKey, sourceUrl, ctx.framePos),
    ).catch(() => null);
    if (img) {
      out.imageFilename = img.filename;
      out.imageBase64 = img.base64;
    }
  }

  // --- audio clip ([cueStart, cueEnd] of the SELECTED cue range) ---
  if (want.audio) {
    if (ctx.cueEnd > ctx.cueStart) {
      const aud = await cached(audKey, () =>
        captureAudio(player, audKey, sourceUrl, ctx.cueStart, ctx.cueEnd),
      ).catch(() => null);
      if (aud) {
        out.audioFilename = aud.filename;
        out.audioBase64 = aud.base64;
      }
    } else {
      console.warn(
        `[YOMIFIN MEDIA] skipping audio: invalid cue range [${ctx.cueStart},${ctx.cueEnd}]`,
      );
    }
  }

  console.log(
    `[YOMIFIN MEDIA] capture done: image=${!!out.imageFilename} audio=${!!out.audioFilename}`,
  );
  return out;
}
