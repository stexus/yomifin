/*
 * Online subtitles panel (jimaku.cc) + sync controls.
 *
 * A side panel (video stays visible — you can SEE the sync while nudging) that:
 *   1. searches jimaku entries (AniList id from the Jellyfin item when available,
 *      else free-text; both editable),
 *   2. lists an entry's files (episode-filtered) and downloads the chosen one to the
 *      cache (`yomifin_sub_*`, swept by cacheSweep after 24h — subs are re-downloadable),
 *   3. parses it (utils/yomifin/subtitleParse) and hands `{path, name, cues}` up to
 *      direct-player, which loads it into mpv + the cue store,
 *   4. once a sub is active, shows the sync section: auto-estimate (subSync.ts against
 *      the item's own text track) + manual ±nudges over mpv `sub-delay`.
 *
 * Everything network/FS lives here; the pure clients (jimaku.ts, subtitleParse.ts,
 * subSync.ts) stay RN-free. Mounted inside a YomifinErrorBoundary by direct-player.
 */
import { File, Paths } from "expo-file-system";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSettings } from "@/utils/atoms/settings";
import {
  isSubtitleFileName,
  type JimakuEntry,
  type JimakuFile,
  listJimakuFiles,
  searchJimakuEntries,
} from "@/utils/yomifin/jimaku";
import type { SubtitleCue } from "@/utils/yomifin/srt";
import type { OffsetEstimate } from "@/utils/yomifin/subSync";
import { parseSubtitleText } from "@/utils/yomifin/subtitleParse";

export interface LoadedOnlineSubtitle {
  /** file:// URI of the downloaded file (feed to mpv addSubtitleFile). */
  path: string;
  name: string;
  /** Parsed plain-text cues in the FILE's timeline ([] if unparseable). */
  cues: SubtitleCue[];
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Prefill for the free-text search (series/item name). */
  defaultQuery: string;
  /** Prefill for the episode filter (Jellyfin IndexNumber). */
  defaultEpisode?: number;
  /** AniList id from the item's ProviderIds (exact jimaku match when present). */
  anilistId?: number;
  /** Currently active online sub (owned by direct-player; null = none). */
  activeSubName: string | null;
  activeCueCount: number;
  /** Current sub delay in ms (owned by direct-player, applied via mpv sub-delay). */
  delayMs: number;
  onDelayChange: (ms: number) => void;
  /** Runs the offset estimate against the item's own track AND applies it. */
  onAutoSync: () => OffsetEstimate | null;
  onSubtitleLoaded: (sub: LoadedOnlineSubtitle) => void | Promise<void>;
}

const NUDGES_MS = [-500, -100, +100, +500];

export default function OnlineSubtitlesModal({
  visible,
  onClose,
  defaultQuery,
  defaultEpisode,
  anilistId,
  activeSubName,
  activeCueCount,
  delayMs,
  onDelayChange,
  onAutoSync,
  onSubtitleLoaded,
}: Props) {
  const { settings } = useSettings();
  const apiKey = settings.yomifinJimakuApiKey ?? "";

  const [query, setQuery] = useState(defaultQuery);
  const [episodeStr, setEpisodeStr] = useState(
    defaultEpisode !== undefined ? String(defaultEpisode) : "",
  );
  const [entries, setEntries] = useState<JimakuEntry[] | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<JimakuEntry | null>(null);
  const [files, setFiles] = useState<JimakuFile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // New item (query/episode prefills changed) → reset the browse state.
  useEffect(() => {
    setQuery(defaultQuery);
    setEpisodeStr(defaultEpisode !== undefined ? String(defaultEpisode) : "");
    setEntries(null);
    setSelectedEntry(null);
    setFiles(null);
    setError(null);
    setSyncMsg(null);
  }, [defaultQuery, defaultEpisode]);

  if (!visible) return null;

  const episode = /^\d+$/.test(episodeStr.trim())
    ? Number(episodeStr.trim())
    : undefined;

  const runSearch = async () => {
    setBusy(true);
    setError(null);
    setFiles(null);
    setSelectedEntry(null);
    try {
      // AniList id gives an exact hit; fall back to the free-text query.
      let found: JimakuEntry[] = [];
      if (anilistId !== undefined) {
        found = await searchJimakuEntries(apiKey, { anilistId });
      }
      if (found.length === 0 && query.trim()) {
        found = await searchJimakuEntries(apiKey, { query: query.trim() });
      }
      setEntries(found);
      if (found.length === 1) await openEntry(found[0]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openEntry = async (entry: JimakuEntry) => {
    setBusy(true);
    setError(null);
    try {
      setSelectedEntry(entry);
      const fs = await listJimakuFiles(apiKey, entry.id, episode);
      setFiles(fs);
    } catch (e) {
      setError((e as Error).message);
      setSelectedEntry(null);
    } finally {
      setBusy(false);
    }
  };

  const loadFile = async (file: JimakuFile) => {
    if (!isSubtitleFileName(file.name)) {
      setError(`"${file.name}" isn't a loadable subtitle (archive/font?)`);
      return;
    }
    setBusy(true);
    setError(null);
    setSyncMsg(null);
    try {
      const res = await fetch(file.url);
      if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
      const text = await res.text();
      const safe = `yomifin_sub_${file.name.replace(/[^\w.-]+/g, "_")}`;
      const f = new File(Paths.cache, safe);
      try {
        if (f.exists) f.delete();
      } catch {}
      f.write(text);
      const cues = parseSubtitleText(text, file.name);
      console.log(
        `[YOMIFIN SUBS] downloaded "${file.name}" → ${cues.length} cues`,
      );
      await onSubtitleLoaded({ path: f.uri, name: file.name, cues });
      if (cues.length === 0) {
        setError(
          "Loaded into the player, but the cue parse found nothing — multi-sentence cards/sync are off for this file.",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runAutoSync = () => {
    setSyncMsg(null);
    const est = onAutoSync();
    if (est) {
      setSyncMsg(
        `Aligned: ${fmtDelay(est.offsetMs)} (match ${(est.score * 100).toFixed(0)}%)`,
      );
    } else {
      setSyncMsg(
        "No confident match — needs the item's own text track as reference. Use the nudge buttons.",
      );
    }
  };

  return (
    <View style={styles.panel} pointerEvents='box-none'>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.headerText}>Online subtitles — jimaku.cc</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>

        {!apiKey ? (
          <Text style={styles.hint}>
            Set your jimaku.cc API key in Settings → Reader to search online
            subtitles.
          </Text>
        ) : (
          <ScrollView
            style={{ flexGrow: 0 }}
            keyboardShouldPersistTaps='handled'
          >
            {/* Active sub + sync section */}
            {activeSubName ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Active</Text>
                <Text style={styles.activeName} numberOfLines={2}>
                  {activeSubName}
                  {activeCueCount > 0 ? `  ·  ${activeCueCount} cues` : ""}
                </Text>
                <View style={styles.syncRow}>
                  <Pressable
                    style={styles.syncButton}
                    onPress={runAutoSync}
                    disabled={busy || activeCueCount === 0}
                  >
                    <Text style={styles.syncButtonText}>Auto sync</Text>
                  </Pressable>
                  <Pressable
                    style={styles.syncButton}
                    onPress={() => {
                      onDelayChange(0);
                      setSyncMsg(null);
                    }}
                  >
                    <Text style={styles.syncButtonText}>Reset</Text>
                  </Pressable>
                </View>
                <View style={styles.nudgeRow}>
                  {NUDGES_MS.slice(0, 2).map((n) => (
                    <NudgeButton
                      key={n}
                      label={fmtNudge(n)}
                      onPress={() => onDelayChange(delayMs + n)}
                    />
                  ))}
                  <Text style={styles.delayText}>{fmtDelay(delayMs)}</Text>
                  {NUDGES_MS.slice(2).map((n) => (
                    <NudgeButton
                      key={n}
                      label={fmtNudge(n)}
                      onPress={() => onDelayChange(delayMs + n)}
                    />
                  ))}
                </View>
                {syncMsg ? <Text style={styles.hint}>{syncMsg}</Text> : null}
              </View>
            ) : null}

            {/* Search */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Search</Text>
              <View style={styles.searchRow}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={query}
                  onChangeText={setQuery}
                  placeholder='Title…'
                  placeholderTextColor='#666'
                  autoCapitalize='none'
                  autoCorrect={false}
                />
                <TextInput
                  style={[styles.input, styles.episodeInput]}
                  value={episodeStr}
                  onChangeText={setEpisodeStr}
                  placeholder='Ep'
                  placeholderTextColor='#666'
                  keyboardType='number-pad'
                />
                <Pressable
                  style={styles.syncButton}
                  onPress={runSearch}
                  disabled={busy}
                >
                  <Text style={styles.syncButtonText}>Search</Text>
                </Pressable>
              </View>
              {anilistId !== undefined ? (
                <Text style={styles.hint}>AniList id {anilistId} detected</Text>
              ) : null}
            </View>

            {busy ? (
              <View style={styles.busyRow}>
                <ActivityIndicator size='small' color='#fff' />
              </View>
            ) : null}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            {/* Entry list */}
            {!selectedEntry && entries ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {entries.length === 0 ? "No entries found" : "Entries"}
                </Text>
                {entries.map((e) => (
                  <Pressable
                    key={e.id}
                    style={styles.rowItem}
                    onPress={() => openEntry(e)}
                    disabled={busy}
                  >
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {e.name}
                    </Text>
                    {e.japanese_name || e.english_name ? (
                      <Text style={styles.rowSub} numberOfLines={1}>
                        {e.japanese_name ?? e.english_name}
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ) : null}

            {/* File list */}
            {selectedEntry && files ? (
              <View style={styles.section}>
                <View style={styles.headerRow}>
                  <Text style={styles.sectionTitle} numberOfLines={1}>
                    {selectedEntry.name}
                    {episode !== undefined ? ` · ep ${episode}` : ""}
                  </Text>
                  <Pressable
                    onPress={() => {
                      setSelectedEntry(null);
                      setFiles(null);
                    }}
                    hitSlop={8}
                  >
                    <Text style={styles.closeText}>‹ back</Text>
                  </Pressable>
                </View>
                {files.length === 0 ? (
                  <Text style={styles.hint}>
                    No files{episode !== undefined ? " for this episode" : ""}.
                  </Text>
                ) : null}
                {files.map((f) => (
                  <Pressable
                    key={f.url}
                    style={styles.rowItem}
                    onPress={() => loadFile(f)}
                    disabled={busy}
                  >
                    <Text
                      style={[
                        styles.rowTitle,
                        !isSubtitleFileName(f.name) && styles.rowDisabled,
                      ]}
                      numberOfLines={1}
                    >
                      {f.name}
                    </Text>
                    {f.size ? (
                      <Text style={styles.rowSub}>
                        {(f.size / 1024).toFixed(0)} KB
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ) : null}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

function NudgeButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.nudgeButton} onPress={onPress} hitSlop={4}>
      <Text style={styles.syncButtonText}>{label}</Text>
    </Pressable>
  );
}

function fmtDelay(ms: number): string {
  const s = ms / 1000;
  return `${s >= 0 ? "+" : ""}${s.toFixed(2)}s`;
}

function fmtNudge(ms: number): string {
  return `${ms > 0 ? "+" : "−"}${Math.abs(ms) / 1000}`;
}

const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "flex-end",
    justifyContent: "center",
    zIndex: 20000, // above controls, below the definition popup (100000)
  },
  card: {
    width: 400,
    maxWidth: "55%",
    maxHeight: "92%",
    marginRight: 12,
    backgroundColor: "rgba(18,20,24,0.97)",
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
    padding: 14,
    gap: 8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  headerText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  closeText: { color: "#9ab", fontSize: 15, fontWeight: "700", padding: 2 },
  section: { marginTop: 10, gap: 6 },
  sectionTitle: {
    color: "#8fa3b8",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    flexShrink: 1,
  },
  searchRow: { flexDirection: "row", gap: 6, alignItems: "center" },
  input: {
    backgroundColor: "rgba(255,255,255,0.08)",
    color: "#fff",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  episodeInput: { width: 52, textAlign: "center" },
  rowItem: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.05)",
    marginTop: 4,
  },
  rowTitle: { color: "#eee", fontSize: 14, fontWeight: "600" },
  rowSub: { color: "#889", fontSize: 12, marginTop: 1 },
  rowDisabled: { color: "#667" },
  busyRow: { paddingVertical: 8, alignItems: "center" },
  errorText: { color: "#f99", fontSize: 13, marginTop: 6 },
  hint: { color: "#99a", fontSize: 12, marginTop: 4, lineHeight: 16 },
  activeName: { color: "#dfe6ee", fontSize: 13, fontWeight: "600" },
  syncRow: { flexDirection: "row", gap: 8, marginTop: 2 },
  syncButton: {
    backgroundColor: "#2b6cb0",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  syncButtonText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  nudgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  nudgeButton: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  delayText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    minWidth: 64,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
});
