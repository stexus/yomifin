/*
 * RN-side seam for the pure AniList → playback-id bridge (mapping.ts): resolves
 * an AniList id to { kitsu, imdb, … } via arm.haglund.dev, cached in MMKV so the
 * arm round-trip happens at most once per title (arm is rate-throttled too).
 *
 * Also exposes an imperative resolver for the play path (episode tap) that reuses
 * the same cache without a hook.
 */
import { useEffect, useState } from "react";
import { storage } from "@/utils/mmkv";
import { type AnilistIdMap, fetchIdMap } from "./mapping";

const PREFIX = "anilist.idmap.";
/** arm maps are static enough to cache for a long time; refresh monthly. */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface CachedIdMap {
  map: AnilistIdMap | null;
  fetchedAt: number;
}

function readCache(anilistId: number): CachedIdMap | null {
  try {
    const raw = storage.getString(`${PREFIX}${anilistId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedIdMap;
    if (typeof parsed?.fetchedAt !== "number") return null;
    if (Date.now() - parsed.fetchedAt > TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(anilistId: number, map: AnilistIdMap | null): void {
  try {
    const entry: CachedIdMap = { map, fetchedAt: Date.now() };
    storage.set(`${PREFIX}${anilistId}`, JSON.stringify(entry));
  } catch {
    // best-effort cache
  }
}

/**
 * Imperative resolver (for the play path): returns the cached id-map or fetches
 * + caches it. Negative results (null) are cached too so a genuinely unmapped id
 * doesn't re-hit arm on every episode tap.
 */
export async function resolveAnilistIdMap(
  anilistId: number,
): Promise<AnilistIdMap | null> {
  const cached = readCache(anilistId);
  if (cached) return cached.map;
  try {
    const map = await fetchIdMap(anilistId);
    writeCache(anilistId, map);
    return map;
  } catch (e) {
    console.warn(`[ANILIST] id-map failed for ${anilistId}: ${e}`);
    return null;
  }
}

/** Hook variant: resolves the id-map for a detail screen (loading/error states). */
export function useAnilistIdMap(anilistId?: number): {
  idMap: AnilistIdMap | null;
  loading: boolean;
} {
  const [idMap, setIdMap] = useState<AnilistIdMap | null>(() =>
    anilistId ? (readCache(anilistId)?.map ?? null) : null,
  );
  const [loading, setLoading] = useState(!!anilistId);

  useEffect(() => {
    if (!anilistId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const cached = readCache(anilistId);
    if (cached) {
      setIdMap(cached.map);
      setLoading(false);
      return;
    }
    setLoading(true);
    resolveAnilistIdMap(anilistId)
      .then((m) => {
        if (!cancelled) setIdMap(m);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [anilistId]);

  return { idMap, loading };
}
