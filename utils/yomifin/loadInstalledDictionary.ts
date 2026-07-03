/*
 * Open the on-device combined dictionary database and expose it as a YomifinDictionary
 * for the player's lookup layer (DEVICE-ONLY: imports expo-sqlite via dictionaryStore).
 *
 * Replaces the old in-memory loadBundledDictionary path: opening the .db is instant (no
 * 170MB JSON parse, no ~300MB heap), and lookups are one indexed query (sub-ms). The
 * open handle is cached for the player screen's lifetime.
 */

import type * as SQLite from "expo-sqlite";
import { dictionaryDbExists, openDictionaryDb } from "./dictionaryStore";
import { ensureSchema, makeSqlRunner } from "./expoSqlite";
import { YomifinDictionary } from "./lookup";
import { SqliteDictionaryDatabase } from "./SqliteDictionaryDatabase";

export interface LoadedDictionary {
  dict: YomifinDictionary;
  titles: string[];
}

/** Lookup knobs threaded from settings/profile (utils/yomifin stays pure — passed in). */
export interface LoadDictionaryOptions {
  /** Translator language ("ja" | "zh") — the active profile's language. */
  language?: string;
  /** Max entries (≈ popup panes) per lookup. */
  maxResults?: number;
}

/** Cached dict + the open handle backing it, so we can close it on reconfigure/reset. */
let cached:
  | (LoadedDictionary & { db: SQLite.SQLiteDatabase; optsKey: string })
  | null = null;

/**
 * Returns the installed dictionary, or null if none has been imported yet (the UI then
 * prompts the user to add one). Cached after first successful open.
 *
 * `orderedEnabledTitles` (Phase 7): the enabled dictionaries IN PRIORITY ORDER, from
 * the user's dictionary config. When given, only those titles are searched and their
 * order sets the definition-block priority (the vendored Translator sorts by the
 * dictionary's index in this list). When omitted (or empty), falls back to ALL installed
 * dictionaries alphabetically. The cache invalidates if the requested list, the
 * language, or any lookup knob changes.
 */
export function loadInstalledDictionary(
  orderedEnabledTitles?: string[],
  options?: LoadDictionaryOptions,
): LoadedDictionary | null {
  if (!dictionaryDbExists()) return null;

  const db = openDictionaryDb();
  ensureSchema(db);
  const installed = db
    .getAllSync<{ title: string }>(
      "SELECT title FROM dictionaries ORDER BY title",
    )
    .map((r) => r.title);
  if (installed.length === 0) {
    db.closeSync();
    return null;
  }

  // Restrict to the requested (installed ∩ enabled) titles in the requested order;
  // fall back to all-installed-alphabetical when no preference was supplied.
  const installedSet = new Set(installed);
  const titles =
    orderedEnabledTitles && orderedEnabledTitles.length > 0
      ? orderedEnabledTitles.filter((t) => installedSet.has(t))
      : installed;
  if (titles.length === 0) {
    db.closeSync();
    return null;
  }

  const optsKey = `${options?.language ?? "ja"}|${options?.maxResults ?? ""}`;
  if (
    cached &&
    cached.optsKey === optsKey &&
    sameTitles(cached.titles, titles)
  ) {
    db.closeSync();
    return cached;
  }

  // Config changed → the previous cached dict's handle is now stale; close it before
  // replacing so we don't leak an open SQLite handle per reconfigure.
  cached?.db.closeSync();

  const dict = new YomifinDictionary(
    new SqliteDictionaryDatabase(makeSqlRunner(db)),
    {
      dictionaryNames: titles,
      language: options?.language,
      maxResults: options?.maxResults,
    },
  );
  cached = { dict, titles, db, optsKey };
  return cached;
}

function sameTitles(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Drop the cached handle (e.g. after importing/removing a dictionary). */
export function resetInstalledDictionaryCache(): void {
  cached?.db.closeSync();
  cached = null;
}
