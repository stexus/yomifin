/*
 * Shared "resolved → player" push for every Yozora play entry point (detail
 * source picker, auto-play, Continue Watching rail). Keeps the player param
 * contract in ONE place: the player needs the CDN url plus enough identity
 * ({title_key, episode, info_hash, expires_at}) for PRG-1 progress ticks and
 * SHIM-7-style re-resolve on expiry.
 */
import type useRouter from "@/hooks/useAppRouter";
import type { ResolveResponse } from "@/utils/yozora/types";

export interface PlayContext {
  titleKey: string;
  /** Canonical episode encoding ("12" anime / "2:5" show); absent for movies. */
  episode?: string | null;
  /** Player title bar text, e.g. "Frieren · Episode 12". */
  displayName: string;
  /** Bare series/movie name for jimaku search prefill (romaji preferred). */
  jimakuQuery?: string;
  /** Server resume position (seconds); 0/undefined = from the start. */
  startPositionSec?: number;
}

export function pushToPlayer(
  router: ReturnType<typeof useRouter>,
  res: ResolveResponse,
  ctx: PlayContext,
): void {
  router.push({
    pathname: "/(auth)/player/yozora-player" as any,
    params: {
      url: res.url,
      expiresAt: res.expires_at ?? "",
      infoHash: res.info_hash,
      titleKey: ctx.titleKey,
      episode: ctx.episode ?? "",
      title: ctx.displayName,
      query: ctx.jimakuQuery ?? "",
      startPosition:
        ctx.startPositionSec && ctx.startPositionSec > 0
          ? String(Math.floor(ctx.startPositionSec))
          : "",
    },
  });
}
