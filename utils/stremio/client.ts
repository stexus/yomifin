/*
 * Stremio addon client — pure, RN-free, bun-testable (mirrors the utils/yomifin
 * pattern: no settings reads inside; addon URLs are passed in).
 *
 * Stremio addons are plain HTTP JSON APIs rooted at the manifest URL:
 *   {base}/manifest.json
 *   {base}/catalog/{type}/{id}.json            (+ optional /{extraProps} segment)
 *   {base}/meta/{type}/{id}.json
 *   {base}/stream/{type}/{id}.json
 *
 * MVP scope: debrid-resolved / plain-HTTP streams only (stream.url) — torrent
 * streams (infoHash) are filtered out, on purpose (see FEATURES.md item 1).
 */

// ---------------------------------------------------------------------------
// Types (subset of the Stremio addon protocol that the MVP consumes)
// ---------------------------------------------------------------------------

export interface StremioCatalogExtra {
  name: string;
  isRequired?: boolean;
  options?: string[];
}

export interface StremioCatalogRef {
  type: string;
  id: string;
  name?: string;
  extra?: StremioCatalogExtra[];
  /** Legacy alternative to `extra` */
  extraRequired?: string[];
  extraSupported?: string[];
}

export type StremioResource =
  | string
  | { name: string; types?: string[]; idPrefixes?: string[] };

export interface StremioManifest {
  id: string;
  version?: string;
  name: string;
  description?: string;
  resources: StremioResource[];
  types: string[];
  idPrefixes?: string[];
  catalogs?: StremioCatalogRef[];
}

export interface StremioMetaPreview {
  id: string;
  type: string;
  name?: string;
  poster?: string;
  posterShape?: string;
  description?: string;
  releaseInfo?: string;
  imdbRating?: string | number;
}

export interface StremioVideo {
  id: string;
  title?: string;
  name?: string;
  season?: number;
  episode?: number;
  number?: number;
  released?: string;
  thumbnail?: string;
  overview?: string;
}

export interface StremioMetaDetail extends StremioMetaPreview {
  background?: string;
  logo?: string;
  runtime?: string;
  genres?: string[];
  videos?: StremioVideo[];
}

export interface StremioSubtitle {
  id?: string;
  url: string;
  lang?: string;
}

export interface StremioStream {
  url?: string;
  ytId?: string;
  infoHash?: string;
  fileIdx?: number;
  externalUrl?: string;
  name?: string;
  title?: string;
  description?: string;
  subtitles?: StremioSubtitle[];
  behaviorHints?: {
    bingeGroup?: string;
    notWebReady?: boolean;
    filename?: string;
    videoSize?: number;
    proxyHeaders?: { request?: Record<string, string> };
  };
}

/** A stream annotated with which addon produced it (for the picker UI). */
export interface AddonStream {
  addonName: string;
  stream: StremioStream;
}

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

// ---------------------------------------------------------------------------
// URL building
// ---------------------------------------------------------------------------

/** `…/manifest.json` → addon base URL (no trailing slash). Throws if malformed. */
export function addonBaseUrl(manifestUrl: string): string {
  const trimmed = manifestUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(`Not an http(s) URL: ${manifestUrl}`);
  }
  if (!/\/manifest\.json$/i.test(trimmed)) {
    throw new Error(
      `Not a manifest URL (missing /manifest.json): ${manifestUrl}`,
    );
  }
  return trimmed.replace(/\/manifest\.json$/i, "");
}

/** Extra properties for a catalog request (`skip` paging, `search`, `genre`). */
export interface CatalogExtraProps {
  skip?: number;
  search?: string;
  genre?: string;
}

/**
 * Build a resource URL. Stremio ids routinely contain `:` (tt123:1:2) — they are
 * percent-encoded; the addon SDK decodes either form.
 */
export function resourceUrl(
  base: string,
  resource: "catalog" | "meta" | "stream" | "subtitles",
  type: string,
  id: string,
  extra?: CatalogExtraProps,
): string {
  const pairs: string[] = [];
  if (extra?.genre) pairs.push(`genre=${encodeURIComponent(extra.genre)}`);
  if (extra?.search) pairs.push(`search=${encodeURIComponent(extra.search)}`);
  if (extra?.skip) pairs.push(`skip=${encodeURIComponent(String(extra.skip))}`);
  const extraSeg = pairs.length > 0 ? `/${pairs.join("&")}` : "";
  return `${base}/${resource}/${encodeURIComponent(type)}/${encodeURIComponent(
    id,
  )}${extraSeg}.json`;
}

// ---------------------------------------------------------------------------
// Capability checks
// ---------------------------------------------------------------------------

function matchesPrefixes(id: string, prefixes?: string[]): boolean {
  if (!prefixes || prefixes.length === 0) return true;
  return prefixes.some((p) => id.startsWith(p));
}

/**
 * Does this addon serve `resource` for `type` (and optionally an id prefix)?
 * Resources may be plain strings (then manifest-level types/idPrefixes apply) or
 * objects with their own types/idPrefixes.
 */
export function manifestSupports(
  manifest: StremioManifest,
  resource: "catalog" | "meta" | "stream" | "subtitles",
  type: string,
  id?: string,
): boolean {
  for (const r of manifest.resources ?? []) {
    if (typeof r === "string") {
      if (r !== resource) continue;
      if (!(manifest.types ?? []).includes(type)) continue;
      if (id !== undefined && !matchesPrefixes(id, manifest.idPrefixes))
        continue;
      return true;
    }
    if (r.name !== resource) continue;
    const types = r.types ?? manifest.types ?? [];
    if (!types.includes(type)) continue;
    const prefixes = r.idPrefixes ?? manifest.idPrefixes;
    if (id !== undefined && !matchesPrefixes(id, prefixes)) continue;
    return true;
  }
  return false;
}

/** Catalogs browsable without user input (no REQUIRED extra like `search`). */
export function browsableCatalogs(
  manifest: StremioManifest,
): StremioCatalogRef[] {
  return (manifest.catalogs ?? []).filter((c) => {
    const required = [
      ...(c.extra ?? []).filter((e) => e.isRequired).map((e) => e.name),
      ...(c.extraRequired ?? []),
    ];
    // `genre` etc. required → still skip for the MVP; only no-input catalogs.
    return required.length === 0;
  });
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 20_000;

async function fetchJson(
  url: string,
  fetchFn: FetchLike,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchManifest(
  manifestUrl: string,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
): Promise<StremioManifest> {
  // Validates the URL shape too (throws early on a non-manifest URL).
  addonBaseUrl(manifestUrl);
  const data = (await fetchJson(manifestUrl, fetchFn)) as StremioManifest;
  if (!data || typeof data !== "object" || !data.name || !data.resources) {
    throw new Error(`Invalid Stremio manifest at ${manifestUrl}`);
  }
  return data;
}

export async function fetchCatalog(
  manifestUrl: string,
  type: string,
  id: string,
  extra?: CatalogExtraProps,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
): Promise<StremioMetaPreview[]> {
  const url = resourceUrl(
    addonBaseUrl(manifestUrl),
    "catalog",
    type,
    id,
    extra,
  );
  const data = (await fetchJson(url, fetchFn)) as {
    metas?: StremioMetaPreview[];
  };
  return data?.metas ?? [];
}

export async function fetchMeta(
  manifestUrl: string,
  type: string,
  id: string,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
): Promise<StremioMetaDetail | null> {
  const url = resourceUrl(addonBaseUrl(manifestUrl), "meta", type, id);
  const data = (await fetchJson(url, fetchFn)) as { meta?: StremioMetaDetail };
  return data?.meta ?? null;
}

export async function fetchStreams(
  manifestUrl: string,
  type: string,
  id: string,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
): Promise<StremioStream[]> {
  const url = resourceUrl(addonBaseUrl(manifestUrl), "stream", type, id);
  const data = (await fetchJson(url, fetchFn)) as { streams?: StremioStream[] };
  return data?.streams ?? [];
}

export interface LoadedAddon {
  manifestUrl: string;
  manifest: StremioManifest;
}

/** First addon that claims meta support and returns one, in list order. */
export async function fetchMetaFromAddons(
  addons: LoadedAddon[],
  type: string,
  id: string,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
): Promise<StremioMetaDetail | null> {
  for (const a of addons) {
    if (!manifestSupports(a.manifest, "meta", type, id)) continue;
    try {
      const meta = await fetchMeta(a.manifestUrl, type, id, fetchFn);
      if (meta) return meta;
    } catch (e) {
      console.warn(
        `[STREMIO] meta from ${a.manifest.name} failed: ${(e as Error).message}`,
      );
    }
  }
  return null;
}

/** Streams from ALL addons that claim stream support, concatenated in list order. */
export async function fetchStreamsFromAddons(
  addons: LoadedAddon[],
  type: string,
  id: string,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
): Promise<AddonStream[]> {
  const results = await Promise.all(
    addons.map(async (a): Promise<AddonStream[]> => {
      if (!manifestSupports(a.manifest, "stream", type, id)) return [];
      try {
        const streams = await fetchStreams(a.manifestUrl, type, id, fetchFn);
        return streams.map((stream) => ({
          addonName: a.manifest.name,
          stream,
        }));
      } catch (e) {
        console.warn(
          `[STREMIO] streams from ${a.manifest.name} failed: ${(e as Error).message}`,
        );
        return [];
      }
    }),
  );
  return results.flat();
}

// ---------------------------------------------------------------------------
// Stream helpers
// ---------------------------------------------------------------------------

/** Direct-playable = has an http(s) `url`. Torrent (infoHash-only) streams are OUT. */
export function isPlayableStream(s: StremioStream): boolean {
  return typeof s.url === "string" && /^https?:\/\//i.test(s.url);
}

export function playableStreams(streams: AddonStream[]): AddonStream[] {
  return streams.filter((s) => isPlayableStream(s.stream));
}

/** Compact two-line label for the stream picker. */
export function streamLabel(s: StremioStream): {
  title: string;
  subtitle: string;
} {
  const title = (s.name ?? "Stream").replace(/\n+/g, " · ").trim();
  const subtitle = (s.title ?? s.description ?? s.behaviorHints?.filename ?? "")
    .replace(/\n+/g, " · ")
    .trim();
  return { title, subtitle };
}

/** Episode label: "S1E3 · Title" (falls back through the protocol's aliases). */
export function videoLabel(v: StremioVideo): string {
  const name = v.title ?? v.name ?? "";
  const ep = v.episode ?? v.number;
  const se =
    v.season !== undefined && ep !== undefined
      ? `S${v.season}E${ep}`
      : ep !== undefined
        ? `E${ep}`
        : "";
  return [se, name].filter(Boolean).join(" · ") || v.id;
}

/** Sort videos by (season, episode); specials (season 0) last. */
export function sortVideos(videos: StremioVideo[]): StremioVideo[] {
  return [...videos].sort((a, b) => {
    const sa = a.season ?? Number.MAX_SAFE_INTEGER;
    const sb = b.season ?? Number.MAX_SAFE_INTEGER;
    const saKey = sa === 0 ? Number.MAX_SAFE_INTEGER - 1 : sa;
    const sbKey = sb === 0 ? Number.MAX_SAFE_INTEGER - 1 : sb;
    if (saKey !== sbKey) return saKey - sbKey;
    return (a.episode ?? a.number ?? 0) - (b.episode ?? b.number ?? 0);
  });
}
