import { profileIdForLanguageTag } from "@/utils/yomifin/profiles";

/** UI time values are milliseconds; native players report seconds. */
export function clampPositionMs(
  positionMs: number,
  durationMs: number,
): number {
  const position = Number.isFinite(positionMs) ? Math.max(0, positionMs) : 0;
  return durationMs > 0 && Number.isFinite(durationMs)
    ? Math.min(position, durationMs)
    : position;
}

export function bufferedPositionMs(
  positionSec: number,
  cacheSec: number,
  durationSec: number,
): number {
  const position = Number.isFinite(positionSec) ? Math.max(0, positionSec) : 0;
  const cache = Number.isFinite(cacheSec) ? Math.max(0, cacheSec) : 0;
  return clampPositionMs((position + cache) * 1000, durationSec * 1000);
}

export function playerTitle(item: {
  Name?: string | null;
  Type?: string | null;
  SeriesName?: string | null;
  ParentIndexNumber?: number | null;
  IndexNumber?: number | null;
}): string {
  if (item.Type !== "Episode") return item.Name ?? "";
  const season = item.ParentIndexNumber;
  const episode = item.IndexNumber;
  const code =
    episode == null
      ? null
      : `${season == null ? "" : `S${String(season).padStart(2, "0")}`}E${String(episode).padStart(2, "0")}`;
  return [item.SeriesName, code, item.Name].filter(Boolean).join("  ·  ");
}

export function nativeTrackLabel(track: {
  id: number;
  title?: string;
  lang?: string;
  codec?: string;
}): string {
  const parts = [
    track.lang,
    track.title?.trim(),
    track.codec?.toUpperCase(),
  ].filter((part): part is string => Boolean(part));
  return [...new Set(parts)].join(" · ") || `Track ${track.id}`;
}

export function playerProfileHint({
  externalSubtitle,
  subtitleLanguage,
  audioLanguage,
}: {
  externalSubtitle?: { language?: string } | null;
  subtitleLanguage?: string | null;
  audioLanguage?: string | null;
}) {
  // An unknown external language uses the reader's chosen profile. Audio can
  // be a different language from the downloaded text the user is reading.
  if (externalSubtitle)
    return profileIdForLanguageTag(externalSubtitle.language);
  return (
    profileIdForLanguageTag(subtitleLanguage) ??
    profileIdForLanguageTag(audioLanguage)
  );
}
