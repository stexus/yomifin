/*
 * RN-side seam for Yozora search in the unified search screen: runs the
 * (caller-debounced) query against GET /search (server-side TMDB + AniList,
 * mixed kinds, deduped by title_key server-side). Replaced the old client-side
 * addon search fan-out (migration plan Phase 4).
 */
import { useEffect, useRef, useState } from "react";
import { useYozora } from "./session";
import type { TitleSummary } from "./types";

export interface YozoraSearchState {
  hits: TitleSummary[];
  loading: boolean;
  /** No Yozora session configured (Settings → Yozora). */
  unavailable: boolean;
}

/**
 * Runs `query` (already debounced by the caller) against the Yozora server.
 * `enabled` gates the whole thing (e.g. scope !== "jellyfin").
 */
export function useYozoraSearch(
  query: string,
  enabled: boolean,
): YozoraSearchState {
  const { client, connected } = useYozora();
  const [hits, setHits] = useState<TitleSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const runId = useRef(0);

  const q = query.trim();

  useEffect(() => {
    if (!enabled || !q || !connected) {
      setHits([]);
      setLoading(false);
      return;
    }
    const id = ++runId.current;
    setLoading(true);
    client
      .search(q)
      .then((res) => {
        if (id === runId.current) setHits(res.items);
      })
      .catch((e) => {
        console.warn(`[YOZORA] search failed: ${e}`);
        if (id === runId.current) setHits([]);
      })
      .finally(() => {
        if (id === runId.current) setLoading(false);
      });
    return () => {
      ++runId.current;
    };
  }, [q, enabled, connected, client]);

  return {
    hits,
    loading,
    unavailable: enabled && !connected,
  };
}
