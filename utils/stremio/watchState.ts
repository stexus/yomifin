/*
 * Stremio watch-state / resume (FEATURES stremio post-MVP item).
 *
 * There is no server to report playback to, so position is persisted locally in
 * MMKV, keyed on the CONTENT identity (series/movie name + episode) — NOT the
 * stream URL, which is a debrid link that changes on every resolve. Near-complete
 * playback (>96%) clears the entry so a finished item restarts from 0.
 */
import { storage } from "@/utils/mmkv";
import { fnv1a } from "@/utils/yomifin/mediaKey";

const PREFIX = "stremio.watch.";
/** Don't bother persisting the first few seconds. */
const MIN_SAVE_SEC = 15;
/** Considered watched → clear state, next play starts over. */
const WATCHED_FRACTION = 0.96;

export interface StremioWatchState {
  positionSec: number;
  durationSec: number;
  updatedAt: number;
}

/** Stable storage key for a playback, or null when there's nothing to key on. */
export function stremioWatchKey(
  title: string | undefined,
  episode: string | undefined,
): string | null {
  const t = (title ?? "").trim();
  if (!t) return null;
  return `${PREFIX}${fnv1a(`${t}|${(episode ?? "").trim()}`)}`;
}

export function loadStremioWatchState(key: string): StremioWatchState | null {
  try {
    const raw = storage.getString(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.positionSec !== "number") return null;
    return parsed as StremioWatchState;
  } catch {
    return null;
  }
}

/**
 * Persist the current position (call throttled from onProgress + on unmount).
 * Applies the min-save and watched-clear thresholds internally.
 */
export function saveStremioWatchState(
  key: string,
  positionSec: number,
  durationSec: number,
): void {
  try {
    if (durationSec > 0 && positionSec / durationSec >= WATCHED_FRACTION) {
      storage.remove(key);
      return;
    }
    if (positionSec < MIN_SAVE_SEC) return;
    const state: StremioWatchState = {
      positionSec: Math.floor(positionSec),
      durationSec: Math.floor(durationSec),
      updatedAt: Date.now(),
    };
    storage.set(key, JSON.stringify(state));
  } catch {
    // best-effort — never let bookkeeping affect playback
  }
}

export function clearStremioWatchState(key: string): void {
  try {
    storage.remove(key);
  } catch {}
}
