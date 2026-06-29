/*
 * Loads the bundled Yomitan dictionary asset into an in-memory YomifinDictionary.
 *
 * MVP path (PHASE2_YOMITAN.md): one dictionary, loaded crudely into memory. The .zip
 * is bundled as a binary asset (metro.config.js adds 'zip' to assetExts); we resolve
 * it via expo-asset, read the bytes via expo-file-system, then unzip + index.
 *
 * ⚠️ Device note: the full JMdict is ~523k terms / ~300MB heap. Acceptable for the MVP
 * gate but the main device risk for this phase; Phase 6 replaces this with SQLite.
 */
import { Asset } from "expo-asset";
import { File } from "expo-file-system";
import { InMemoryDictionaryDatabase } from "./InMemoryDictionaryDatabase";
import { YomifinDictionary } from "./lookup";
import { type LoadResult, loadDictionaryFromZip } from "./termBankLoader";

export interface BundledDictionary {
  dict: YomifinDictionary;
  info: LoadResult;
  /** wall-clock ms the load took (unzip + index), for logging/telemetry */
  loadMs: number;
}

export async function loadBundledDictionary(
  language = "ja",
): Promise<BundledDictionary> {
  const t0 = Date.now();

  // Bundled binary asset → local file URI.
  const asset = Asset.fromModule(
    require("../../assets/dictionaries/JMdict.zip"),
  );
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;

  // Read raw bytes and unzip + index.
  const buffer = await new File(uri).arrayBuffer();
  const db = new InMemoryDictionaryDatabase();
  const info = loadDictionaryFromZip(new Uint8Array(buffer), db);

  const dict = new YomifinDictionary(db, {
    dictionaryNames: [info.title],
    language,
  });
  const loadMs = Date.now() - t0;
  console.log(
    `[YOMIFIN DICT] loaded "${info.title}" — ${info.termCount} terms from ${info.termBankFiles} banks in ${loadMs}ms`,
  );
  return { dict, info, loadMs };
}
