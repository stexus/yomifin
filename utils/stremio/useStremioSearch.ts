/*
 * RN-side seam for Stremio search: debounced query across every configured
 * addon's searchable catalogs (movie/series). Pure logic lives in client.ts
 * (searchAddons); this only manages loading state + cancellation.
 */
import { useEffect, useRef, useState } from "react";
import { type StremioSearchHit, searchAddons } from "./client";
import { useStremioAddons } from "./useStremioAddons";

const SEARCH_TYPES = ["movie", "series"];

export interface StremioSearchState {
  hits: StremioSearchHit[];
  loading: boolean;
  /** No addons configured OR none expose a searchable movie/series catalog. */
  unavailable: boolean;
}

/**
 * Runs `query` (already debounced by the caller) against all ready addons.
 * `enabled` gates the whole thing (e.g. scope !== "jellyfin").
 */
export function useStremioSearch(
  query: string,
  enabled: boolean,
): StremioSearchState {
  const { addons } = useStremioAddons();
  const [hits, setHits] = useState<StremioSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const runId = useRef(0);

  const q = query.trim();

  useEffect(() => {
    if (!enabled || !q || addons.length === 0) {
      setHits([]);
      setLoading(false);
      return;
    }
    const id = ++runId.current;
    setLoading(true);
    searchAddons(addons, q, SEARCH_TYPES)
      .then((res) => {
        if (id === runId.current) setHits(res);
      })
      .catch((e) => {
        console.warn(`[STREMIO] search failed: ${e}`);
        if (id === runId.current) setHits([]);
      })
      .finally(() => {
        if (id === runId.current) setLoading(false);
      });
  }, [q, enabled, addons]);

  return {
    hits,
    loading,
    unavailable: enabled && addons.length === 0,
  };
}
