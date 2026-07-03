/*
 * Disk-cache hygiene for yomifin's transient files (device-coupled: expo-file-system).
 *
 * Everything yomifin writes to Paths.cache is prefixed `yomifin_`:
 *   - capture temps (`yomifin_<key>.jpg/.m4a`) — deleted right after the base64 read,
 *     but a crash/throw mid-read can leak one;
 *   - 🔊 word-audio clips (`yomifin_word_<key>.<ext>`) — intentionally kept so replay
 *     within a session is instant, which would otherwise accumulate forever.
 *
 * sweepYomifinCacheFiles() deletes yomifin_* files older than MAX_AGE (default 24h) —
 * old enough that nothing legitimate is still in flight, young enough that the cache
 * dir stays a few MB at most. Called once per player-screen mount (cheap directory
 * scan). iOS may additionally purge Paths.cache under storage pressure; this sweep
 * just makes sure we never depend on that.
 */
import { Directory, File, Paths } from "expo-file-system";

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

/** Delete stale yomifin_* files from the cache dir. Best-effort; never throws. */
export function sweepYomifinCacheFiles(
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): void {
  try {
    const now = Date.now();
    let removed = 0;
    let bytes = 0;
    for (const entry of new Directory(Paths.cache).list()) {
      try {
        if (!(entry instanceof File)) continue;
        if (!entry.name.startsWith("yomifin_")) continue;
        const modified = entry.lastModified;
        // No timestamp readable → treat as stale (it's a transient file by contract).
        if (modified !== null && now - modified < maxAgeMs) continue;
        bytes += entry.size ?? 0;
        entry.delete();
        removed++;
      } catch {
        // one bad entry shouldn't stop the sweep
      }
    }
    if (removed > 0) {
      console.log(
        `[YOMIFIN CACHE] swept ${removed} stale file(s), ${(bytes / 1024).toFixed(0)}KB freed`,
      );
    }
  } catch (e) {
    console.warn(`[YOMIFIN CACHE] sweep failed: ${(e as Error)?.message ?? e}`);
  }
}
