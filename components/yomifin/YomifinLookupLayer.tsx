/*
 * Phase 2 layer: tappable subtitles + real Yomitan lookup + definition popup.
 *
 * Loads the bundled dictionary once (in-memory), renders Phase 1's
 * TappableSubtitleOverlay, and on word tap runs the forward-greedy lookup and shows
 * DefinitionPopup. Container-agnostic: this is the overlay container adopted in Phase 0.
 *
 * Drop-in replacement for TappableSubtitleOverlay in the player; it forwards the same
 * subtitle/sync props through.
 */
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import { loadBundledDictionary } from "@/utils/yomifin/loadBundledDictionary";
import type { LookupResult, YomifinDictionary } from "@/utils/yomifin/lookup";
import type { SubtitleCue } from "@/utils/yomifin/srt";
import DefinitionPopup from "./DefinitionPopup";
import TappableSubtitleOverlay from "./TappableSubtitleOverlay";

interface Props {
  cues: SubtitleCue[];
  progressMs: SharedValue<number>;
  isPlaying: boolean;
  speed: number;
  /** Optional: pause playback while a definition is open (nice-to-have). */
  onLookupOpen?: () => void;
}

type DictStatus = "loading" | "ready" | "error";

export default function YomifinLookupLayer({
  cues,
  progressMs,
  isPlaying,
  speed,
  onLookupOpen,
}: Props) {
  const dictRef = useRef<YomifinDictionary | null>(null);
  const [status, setStatus] = useState<DictStatus>("loading");
  const [result, setResult] = useState<LookupResult | null>(null);
  const [busy, setBusy] = useState(false);

  // Load the dictionary once for the lifetime of the player screen.
  useEffect(() => {
    let cancelled = false;
    loadBundledDictionary("ja")
      .then(({ dict }) => {
        if (cancelled) return;
        dictRef.current = dict;
        setStatus("ready");
      })
      .catch((err) => {
        console.error("[YOMIFIN DICT] load failed:", err);
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
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
        cues={cues}
        progressMs={progressMs}
        isPlaying={isPlaying}
        speed={speed}
        onWordTap={status === "ready" ? handleWordTap : undefined}
      />
      {status === "loading" ? (
        <View style={styles.badge} pointerEvents='none'>
          <ActivityIndicator size='small' color='#fff' />
          <Text style={styles.badgeText}>Loading dictionary…</Text>
        </View>
      ) : null}
      {status === "error" ? (
        <View style={styles.badge} pointerEvents='none'>
          <Text style={styles.badgeText}>Dictionary failed to load</Text>
        </View>
      ) : null}
      {result ? (
        <DefinitionPopup result={result} onClose={() => setResult(null)} />
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
