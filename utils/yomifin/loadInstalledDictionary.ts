/*
 * Open the on-device combined dictionary database and expose it as a YomifinDictionary
 * for the player's lookup layer (DEVICE-ONLY: imports expo-sqlite via dictionaryStore).
 *
 * Replaces the old in-memory loadBundledDictionary path: opening the .db is instant (no
 * 170MB JSON parse, no ~300MB heap), and lookups are one indexed query (sub-ms). The
 * open handle is cached for the player screen's lifetime.
 */

import { dictionaryDbExists, openDictionaryDb } from "./dictionaryStore";
import { ensureSchema, makeSqlRunner } from "./expoSqlite";
import { YomifinDictionary } from "./lookup";
import { SqliteDictionaryDatabase } from "./SqliteDictionaryDatabase";

export interface LoadedDictionary {
  dict: YomifinDictionary;
  titles: string[];
}

let cached: LoadedDictionary | null = null;

/**
 * Returns the installed dictionary, or null if none has been imported yet (the UI then
 * prompts the user to add one). Cached after first successful open.
 */
export function loadInstalledDictionary(): LoadedDictionary | null {
  if (cached) return cached;
  if (!dictionaryDbExists()) return null;

  const db = openDictionaryDb();
  ensureSchema(db);
  const titles = db
    .getAllSync<{ title: string }>(
      "SELECT title FROM dictionaries ORDER BY title",
    )
    .map((r) => r.title);
  if (titles.length === 0) {
    db.closeSync();
    return null;
  }

  const dict = new YomifinDictionary(
    new SqliteDictionaryDatabase(makeSqlRunner(db)),
    {
      dictionaryNames: titles,
    },
  );
  cached = { dict, titles };
  return cached;
}

/** Drop the cached handle (e.g. after importing/removing a dictionary). */
export function resetInstalledDictionaryCache(): void {
  cached = null;
}
