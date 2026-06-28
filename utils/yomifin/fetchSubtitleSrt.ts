/**
 * Fetch ONE subtitle stream from Jellyfin as SRT *data* (Phase 1).
 *
 * We ask Jellyfin to deliver the chosen subtitle stream converted to SRT via the
 * standard Subtitles stream endpoint. This works for embedded subs too (the server
 * converts to SRT). We render this text ourselves; mpv's own subs are turned off.
 */

import type {
  MediaSourceInfo,
  MediaStream,
} from "@jellyfin/sdk/lib/generated-client";

/** Pick the subtitle stream to use: the chosen text sub, else the first text sub. */
export function pickTextSubtitleStream(
  mediaSource: MediaSourceInfo | null | undefined,
  preferredIndex: number,
): MediaStream | undefined {
  const textSubs =
    mediaSource?.MediaStreams?.filter(
      (s) => s.Type === "Subtitle" && s.IsTextSubtitleStream === true,
    ) ?? [];
  if (textSubs.length === 0) return undefined;
  return textSubs.find((s) => s.Index === preferredIndex) ?? textSubs[0];
}

/**
 * Build the Jellyfin "Stream.srt" URL for a subtitle stream.
 * Route: /Videos/{itemId}/{mediaSourceId}/Subtitles/{index}/{startTicks}/Stream.srt
 */
export function buildSrtUrl(
  basePath: string,
  itemId: string,
  mediaSourceId: string,
  subtitleIndex: number,
  accessToken: string,
): string {
  const base = basePath.replace(/\/+$/, "");
  return (
    `${base}/Videos/${itemId}/${mediaSourceId}/Subtitles/${subtitleIndex}/0/Stream.srt` +
    `?api_key=${encodeURIComponent(accessToken)}`
  );
}

/** Fetch the SRT text. Throws on non-2xx. */
export async function fetchSubtitleSrt(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Subtitle fetch failed: ${res.status} ${res.statusText}`);
  }
  return res.text();
}
