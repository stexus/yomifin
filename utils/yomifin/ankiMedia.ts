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
 * Best-effort: any failure returns partial/empty media so the card still gets created.
 */
import { File, Paths } from "expo-file-system";

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

/** Native file paths want a plain path, not a `file://` URI. */
function plainPath(uri: string): string {
  return uri.replace(/^file:\/\//, "");
}

/**
 * Capture frame + audio clip for one card. Call this on "+ Anki card" press (NOT on
 * tap). `ctx` is the tap-time snapshot; `sourceUrl` is the static/original stream
 * ("" => native uses the playing URL); `baseName` is unique per card.
 */
export async function captureCardMedia(
  player: MediaCapturer,
  ctx: CaptureContext,
  baseName: string,
  sourceUrl: string,
): Promise<CapturedMedia> {
  const out: CapturedMedia = {};
  console.log(
    `[YOMIFIN MEDIA] capture start base=${baseName} cue=[${ctx.cueStart.toFixed(2)},${ctx.cueEnd.toFixed(2)}] frame@${ctx.framePos.toFixed(2)} src=${sourceUrl ? "static" : "playing"}`,
  );

  // --- image (frame at tap position) ---
  try {
    const imgFile = new File(Paths.cache, `${baseName}.jpg`);
    const ok = await player.captureScreenshot(
      plainPath(imgFile.uri),
      sourceUrl,
      ctx.framePos,
    );
    if (ok && imgFile.exists) {
      out.imageBase64 = await imgFile.base64();
      out.imageFilename = `yomifin_${baseName}.jpg`;
      console.log(
        `[YOMIFIN MEDIA] screenshot ok: ${out.imageBase64.length} b64 chars -> ${out.imageFilename}`,
      );
    } else {
      console.warn(
        `[YOMIFIN MEDIA] screenshot produced no image (native returned ${ok}, exists=${imgFile.exists}). Check native [captureScreenshot] logs.`,
      );
    }
    if (imgFile.exists) imgFile.delete();
  } catch (e) {
    console.warn(
      `[YOMIFIN MEDIA] screenshot failed: ${(e as Error)?.message ?? e}`,
    );
  }

  // --- audio clip ([cueStart, cueEnd] of source) ---
  try {
    if (ctx.cueEnd > ctx.cueStart) {
      const aid = await player.getCurrentAudioTrack().catch(() => 0);
      const audFile = new File(Paths.cache, `${baseName}.m4a`);
      const ok = await player.extractAudio(
        ctx.cueStart,
        ctx.cueEnd,
        aid ?? 0,
        plainPath(audFile.uri),
        sourceUrl,
      );
      if (ok && audFile.exists) {
        out.audioBase64 = await audFile.base64();
        out.audioFilename = `yomifin_${baseName}.m4a`;
        console.log(
          `[YOMIFIN MEDIA] audio ok (aid=${aid}): ${out.audioBase64.length} b64 chars -> ${out.audioFilename}`,
        );
      } else {
        console.warn(
          `[YOMIFIN MEDIA] audio produced no clip (native returned ${ok}, exists=${audFile.exists}).`,
        );
      }
      if (audFile.exists) audFile.delete();
    } else {
      console.warn(
        `[YOMIFIN MEDIA] skipping audio: invalid cue range [${ctx.cueStart},${ctx.cueEnd}]`,
      );
    }
  } catch (e) {
    console.warn(
      `[YOMIFIN MEDIA] audio extraction failed: ${(e as Error)?.message ?? e}`,
    );
  }

  console.log(
    `[YOMIFIN MEDIA] capture done: image=${!!out.imageFilename} audio=${!!out.audioFilename}`,
  );
  return out;
}
