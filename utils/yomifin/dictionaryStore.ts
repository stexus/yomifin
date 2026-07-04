/*
 * On-device dictionary store (DEVICE-ONLY: imports expo-sqlite + expo-file-system).
 *
 * One combined SQLite file (`yomifin-dictionaries.db`) in expo-sqlite's default database
 * directory holds ALL installed dictionaries (the `dictionaries` table lists them). This
 * file lives in the app's Documents container, so:
 *   - it PERSISTS across normal `expo run:ios` rebuilds (iOS keeps the data container on
 *     incremental reinstall), so you don't re-import while iterating; and
 *   - it's reachable over Finder file sharing (UIFileSharingEnabled) for manual backup /
 *     drop-in of a prebuilt .db.
 * Only a clean uninstall wipes it — and then re-adding a prebuilt .db is a fast copy.
 *
 * Two install paths:
 *   - importDictionaryZip(): pick a Yomitan .zip → chunked import with progress (minutes
 *     once per dictionary), via the SHARED importDictionary.ts.
 *   - importPrebuiltDb(): pick a .db built by scripts/build-dictionary-db.ts → copy into
 *     place (seconds). Best for the debug loop / restoring after an uninstall.
 */
import { Directory, File } from "expo-file-system";
import * as SQLite from "expo-sqlite";
import { ensureSchema, makeImportSink } from "./expoSqlite";
import {
  type ImportProgress,
  importDictionaryFromZip,
} from "./importDictionary";

const DB_NAME = "yomifin-dictionaries.db";

export interface InstalledDictionary {
  title: string;
  revision: string;
  termCount: number;
}

/** File handle for the combined dictionary database (may not exist yet). */
export function getDbFile(): File {
  return new File(SQLite.defaultDatabaseDirectory, DB_NAME);
}

export function dictionaryDbExists(): boolean {
  return getDbFile().exists;
}

/** Open the combined database (creates the file + dir on first open). */
export function openDictionaryDb(): SQLite.SQLiteDatabase {
  return SQLite.openDatabaseSync(DB_NAME);
}

/** Ensure the SQLite default directory exists before a raw file copy. */
function ensureDbDirectory(): void {
  try {
    new Directory(SQLite.defaultDatabaseDirectory).create({ idempotent: true });
  } catch {
    // already exists / created lazily by openDatabaseSync
  }
}

/** List installed dictionaries (empty if no db or no table yet). */
export function listInstalledDictionaries(): InstalledDictionary[] {
  if (!dictionaryDbExists()) return [];
  const db = openDictionaryDb();
  try {
    ensureSchema(db);
    return db.getAllSync<InstalledDictionary>(
      "SELECT title, revision, termCount FROM dictionaries ORDER BY title",
    );
  } catch {
    return [];
  } finally {
    db.closeSync();
  }
}

/**
 * Import a Yomitan dictionary .zip into the combined db (chunked, idempotent per title).
 * `onProgress` fires once per term bank for a progress bar.
 */
export async function importDictionaryZip(
  fileUri: string,
  onProgress?: (p: ImportProgress) => void,
  titleOverride?: string,
): Promise<InstalledDictionary> {
  const bytes = await new File(fileUri).bytes();
  const db = openDictionaryDb();
  ensureSchema(db);
  const { sink, finalize } = makeImportSink(db);
  try {
    const result = await importDictionaryFromZip(bytes, sink, {
      title: titleOverride,
      // Idempotent: re-importing a dictionary replaces its rows.
      onTitleResolved: (title) => {
        db.runSync("DELETE FROM terms WHERE dictionary = ?", [title]);
      },
      onProgress,
      // Let the UI thread breathe between banks so import never freezes the app.
      yieldToEventLoop: () => new Promise((r) => setTimeout(r, 0)),
    });
    db.runSync(
      "INSERT OR REPLACE INTO dictionaries (title, revision, termCount) VALUES (?, ?, ?)",
      [result.title, result.revision, result.termCount],
    );
    return result;
  } finally {
    finalize();
    db.closeSync();
  }
}

/**
 * Install a prebuilt .db (from scripts/build-dictionary-db.ts) by copying it into place.
 * REPLACES the current combined db. Fast (no parse) — ideal for the debug loop.
 */
export async function importPrebuiltDb(
  fileUri: string,
): Promise<InstalledDictionary[]> {
  const src = new File(fileUri);
  if (!src.exists) throw new Error("Selected file does not exist");
  ensureDbDirectory();
  const dest = getDbFile();
  if (dest.exists) dest.delete();
  src.copySync(dest);

  const list = listInstalledDictionaries();
  if (list.length === 0) {
    // Not a yomifin dictionary db (no dictionaries table / rows).
    if (dest.exists) dest.delete();
    throw new Error("Selected .db is not a yomifin dictionary database");
  }
  return list;
}

/**
 * Prepare the combined db for export (share sheet): checkpoint + truncate the WAL so
 * the single .db file contains every committed write (expo-sqlite runs in WAL mode;
 * sharing just the main file would otherwise silently drop recent imports), then
 * return its handle for Sharing.shareAsync.
 */
export function prepareDbForExport(): File {
  const f = getDbFile();
  if (!f.exists) throw new Error("No dictionary database to export yet");
  const db = openDictionaryDb();
  try {
    db.execSync("PRAGMA wal_checkpoint(TRUNCATE);");
  } catch (e) {
    console.warn("[YOMIFIN] wal checkpoint before export failed:", e);
  } finally {
    db.closeSync();
  }
  return f;
}

/** Remove one dictionary's rows (keeps the file + other dictionaries). */
export function removeDictionary(title: string): void {
  if (!dictionaryDbExists()) return;
  const db = openDictionaryDb();
  try {
    db.runSync("DELETE FROM terms WHERE dictionary = ?", [title]);
    db.runSync("DELETE FROM dictionaries WHERE title = ?", [title]);
  } finally {
    db.closeSync();
  }
}

/** Delete the entire combined dictionary database file. */
export function deleteAllDictionaries(): void {
  const f = getDbFile();
  if (f.exists) f.delete();
}
