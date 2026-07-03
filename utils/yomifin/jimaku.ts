/*
 * jimaku.cc API client (pure, RN-free, bun-testable — fetch is injectable).
 *
 * jimaku.cc hosts Japanese subtitle files for anime/drama, indexed by AniList id.
 * Plain HTTP JSON API; every request carries the user's API key in `Authorization`
 * (create one at jimaku.cc → account settings; stored in
 * Settings.yomifinJimakuApiKey, entered under Settings → Reader).
 *
 *   GET /api/entries/search?query=…&anilist_id=…   → JimakuEntry[]
 *   GET /api/entries/{id}/files?episode=…          → JimakuFile[] (direct URLs)
 *
 * File downloads (the `url` field) are public and need no auth header.
 */

export interface JimakuEntry {
  id: number;
  /** Romaji / primary name. */
  name: string;
  english_name?: string | null;
  japanese_name?: string | null;
  anilist_id?: number | null;
  flags?: Record<string, boolean>;
}

export interface JimakuFile {
  /** Direct download URL (no auth needed). */
  url: string;
  name: string;
  size?: number;
  last_modified?: string;
}

/** Minimal fetch shape so tests can inject a fake. */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export const JIMAKU_BASE_URL = "https://jimaku.cc/api";

async function jimakuGet(
  apiKey: string,
  path: string,
  fetchFn: FetchLike,
): Promise<unknown> {
  if (!apiKey) throw new Error("jimaku API key not set (Settings → Reader)");
  const res = await fetchFn(`${JIMAKU_BASE_URL}${path}`, {
    headers: { Authorization: apiKey },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(`jimaku rejected the API key (HTTP ${res.status})`);
    }
    if (res.status === 429) {
      throw new Error("jimaku rate limit hit — wait a moment and retry");
    }
    throw new Error(`jimaku request failed (HTTP ${res.status})`);
  }
  return res.json();
}

/** Search entries by AniList id (exact) and/or free-text name query. */
export async function searchJimakuEntries(
  apiKey: string,
  opts: { query?: string; anilistId?: number },
  fetchFn: FetchLike = fetch as unknown as FetchLike,
): Promise<JimakuEntry[]> {
  const params = new URLSearchParams();
  if (opts.anilistId !== undefined)
    params.set("anilist_id", String(opts.anilistId));
  if (opts.query) params.set("query", opts.query);
  const qs = params.toString();
  const data = await jimakuGet(
    apiKey,
    `/entries/search${qs ? `?${qs}` : ""}`,
    fetchFn,
  );
  return Array.isArray(data) ? (data as JimakuEntry[]) : [];
}

/** List an entry's subtitle files, optionally filtered to one episode. */
export async function listJimakuFiles(
  apiKey: string,
  entryId: number,
  episode?: number,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
): Promise<JimakuFile[]> {
  const qs =
    episode !== undefined ? `?episode=${encodeURIComponent(episode)}` : "";
  const data = await jimakuGet(
    apiKey,
    `/entries/${encodeURIComponent(entryId)}/files${qs}`,
    fetchFn,
  );
  const files = Array.isArray(data) ? (data as JimakuFile[]) : [];
  // Subtitle-looking files first (archives etc. sink), then alphabetical.
  return files.sort((a, b) => {
    const sa = isSubtitleFileName(a.name) ? 0 : 1;
    const sb = isSubtitleFileName(b.name) ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name);
  });
}

/** Loadable-as-text subtitle formats (archives/fonts are listed but not loadable). */
export function isSubtitleFileName(name: string): boolean {
  return /\.(srt|ass|ssa|vtt|sub)$/i.test(name);
}
