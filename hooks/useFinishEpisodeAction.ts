import { useCallback, useEffect, useRef } from "react";

/** Finishing an outgoing item must never navigate a newly opened player. */
export function useFinishEpisodeAction(
  itemId: string | null | undefined,
  finish: (() => Promise<boolean>) | undefined,
  advance: () => void,
) {
  const currentItem = useRef(itemId);
  currentItem.current = itemId;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(async () => {
    if (await finish?.()) {
      if (mounted.current && currentItem.current === itemId) advance();
    }
  }, [itemId, finish, advance]);
}
