/*
 * Phase 2 layer: tappable subtitles + real Yomitan lookup + definition popup.
 *
 * Loads the bundled dictionary once, renders the tappable overlay from mpv's live
 * subtitle text, and on word tap runs the forward-greedy lookup and shows
 * DefinitionPopup.
 *
 * mpv-driven: the overlay text comes from mpv's `sub-text` (perfect sync, PGS-safe),
 * not from a re-fetched SRT + interpolation.
 */
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { loadInstalledDictionary } from "@/utils/yomifin/loadInstalledDictionary";
import type { LookupResult, YomifinDictionary } from "@/utils/yomifin/lookup";
import DefinitionPopup from "./DefinitionPopup";
import TappableSubtitleOverlay from "./TappableSubtitleOverlay";
import YomifinErrorBoundary from "./YomifinErrorBoundary";

interface Props {
  /** Current subtitle text from mpv (empty string = nothing showing). */
  text: string;
  /** Optional: pause playback while a definition is open (nice-to-have). */
  onLookupOpen?: () => void;
}

type DictStatus = "loading" | "ready" | "none" | "error";

export default function YomifinLookupLayer({ text, onLookupOpen }: Props) {
  const dictRef = useRef<YomifinDictionary | null>(null);
  const [status, setStatus] = useState<DictStatus>("loading");
  const [result, setResult] = useState<LookupResult | null>(null);
  const [busy, setBusy] = useState(false);

  // Open the installed dictionary db once for the player screen's lifetime. Opening is
  // instant (no parse); if none is installed yet, the overlay still shows text but taps
  // do nothing (status "none").
  useEffect(() => {
    try {
      const loaded = loadInstalledDictionary();
      if (loaded) {
        dictRef.current = loaded.dict;
        setStatus("ready");
      } else {
        setStatus("none");
      }
    } catch (err) {
      console.error("[YOMIFIN DICT] open failed:", err);
      setStatus("error");
    }
  }, []);

  const handleWordTap = async (input: string) => {
    const dict = dictRef.current;
    if (!dict || busy) return;
    setBusy(true);
    const t0 = Date.now();
    try {
      const r = await dict.lookup(input);
      console.log(
        `[YOMIFIN LOOKUP] "${r.matchedText}" (${r.entries.length} entries) in ${Date.now() - t0}ms`,
      );
      setResult(r);
      onLookupOpen?.();
    } catch (err) {
      console.error("[YOMIFIN LOOKUP] failed:", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TappableSubtitleOverlay
        text={text}
        onWordTap={status === "ready" ? handleWordTap : undefined}
      />
      {status === "loading" ? (
        <View style={styles.badge} pointerEvents='none'>
          <ActivityIndicator size='small' color='#fff' />
          <Text style={styles.badgeText}>Loading dictionary…</Text>
        </View>
      ) : null}
      {status === "none" ? (
        <View style={styles.badge} pointerEvents='none'>
          <Text style={styles.badgeText}>
            No dictionary installed — add one in Settings
          </Text>
        </View>
      ) : null}
      {status === "error" ? (
        <View style={styles.badge} pointerEvents='none'>
          <Text style={styles.badgeText}>Dictionary failed to load</Text>
        </View>
      ) : null}
      {result ? (
        <YomifinErrorBoundary label='popup'>
          <DefinitionPopup result={result} onClose={() => setResult(null)} />
        </YomifinErrorBoundary>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    top: 12,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    zIndex: 10000,
  },
  badgeText: { color: "#fff", fontSize: 13 },
});
