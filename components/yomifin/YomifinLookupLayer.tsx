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
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSettings } from "@/utils/atoms/settings";
import type { CaptureContext, CapturedMedia } from "@/utils/yomifin/ankiMedia";
import {
  enabledTitlesInOrder,
  resolveDictionaryConfig,
  tintMap,
} from "@/utils/yomifin/dictionaryConfig";
import { listInstalledDictionaries } from "@/utils/yomifin/dictionaryStore";
import { loadInstalledDictionary } from "@/utils/yomifin/loadInstalledDictionary";
import type { LookupResult, YomifinDictionary } from "@/utils/yomifin/lookup";
import DefinitionPopup from "./DefinitionPopup";
import { getPopupTheme } from "./popupTheme";
import TappableSubtitleOverlay from "./TappableSubtitleOverlay";
import YomifinErrorBoundary from "./YomifinErrorBoundary";

interface Props {
  /** Current subtitle text from mpv (empty string = nothing showing). */
  text: string;
  /** Optional: pause playback while a definition is open (nice-to-have). */
  onLookupOpen?: () => void;
  /** Phase 5: called when the definition popup closes (resume playback). */
  onLookupClose?: () => void;
  /** Phase 5: which side to anchor the fixed popup. */
  popupPosition?: "left" | "right";
  /**
   * Phase 4 — cheap, called at TAP: snapshot the cue range + frame position so the
   * (later) media capture matches the tapped moment. No decoding/seeking here.
   */
  onSnapshotCard?: () => CaptureContext;
  /**
   * Phase 4 — expensive, called only on "+ Anki card" PRESS: grab the frame + audio
   * clip for the frozen snapshot. Kept off the tap path so ordinary lookups cost
   * nothing (no per-tap seek/decode).
   */
  onCaptureMedia?: (
    ctx: CaptureContext,
    baseName: string,
  ) => Promise<CapturedMedia>;
}

type DictStatus = "loading" | "ready" | "none" | "error";

export default function YomifinLookupLayer({
  text,
  onLookupOpen,
  onLookupClose,
  popupPosition = "right",
  onSnapshotCard,
  onCaptureMedia,
}: Props) {
  const { settings } = useSettings();
  const dictConfig = settings.yomifinDictionaryConfig ?? {};
  const theme = useMemo(
    () => getPopupTheme(settings.yomifinPopupTheme),
    [settings.yomifinPopupTheme],
  );
  const dictRef = useRef<YomifinDictionary | null>(null);
  const [status, setStatus] = useState<DictStatus>("loading");
  const [tints, setTints] = useState<Record<string, string>>({});
  const [result, setResult] = useState<LookupResult | null>(null);
  // Subtitle cue text frozen at tap time (Phase 3: the card's sentence), so it stays
  // correct even if playback advances while the popup is open.
  const [sentence, setSentence] = useState("");
  const [busy, setBusy] = useState(false);
  // Frozen at tap (cheap); the actual capture runs only if "+ Anki card" is pressed.
  const cardCtxRef = useRef<CaptureContext | null>(null);
  const cardBaseRef = useRef<string>("");

  // Open the installed dictionary db once for the player screen's lifetime. Opening is
  // instant (no parse); if none is installed yet, the overlay still shows text but taps
  // do nothing (status "none").
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the config changes
  useEffect(() => {
    try {
      const installed = listInstalledDictionaries().map((d) => d.title);
      const resolved = resolveDictionaryConfig(installed, dictConfig);
      setTints(tintMap(resolved));
      const loaded = loadInstalledDictionary(enabledTitlesInOrder(resolved));
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
  }, [JSON.stringify(dictConfig)]);

  // Close + resume (used by both the ✕ button and the tap-outside backdrop).
  const closeLookup = () => {
    setResult(null);
    onLookupClose?.();
  };

  const handleWordTap = async (input: string) => {
    const dict = dictRef.current;
    if (!dict || busy) return;
    // Freeze the current cue at tap time for the Anki card.
    setSentence(text);
    setBusy(true);
    const t0 = Date.now();
    try {
      const r = await dict.lookup(input);
      console.log(
        `[YOMIFIN LOOKUP] "${r.matchedText}" (${r.entries.length} entries) in ${Date.now() - t0}ms`,
      );
      setResult(r);
      onLookupOpen?.();
      // Cheap snapshot only — the expensive capture is deferred to the add-card press
      // so that ordinary lookups never trigger a seek/decode.
      cardCtxRef.current = onSnapshotCard?.() ?? null;
      cardBaseRef.current = `card_${Date.now()}`;
    } catch (err) {
      console.error("[YOMIFIN LOOKUP] failed:", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Tap-outside-to-close backdrop. Sits BELOW the subtitle overlay (zIndex 9999)
          so tapping another word runs a new lookup rather than closing; taps anywhere
          else dismiss + resume. Only mounted while a definition is open. */}
      {result ? (
        <Pressable style={styles.backdrop} onPress={closeLookup} />
      ) : null}
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
          <DefinitionPopup
            key={cardBaseRef.current}
            result={result}
            theme={theme}
            dictTints={tints}
            sentence={sentence}
            getMedia={() => {
              const ctx = cardCtxRef.current;
              return ctx && onCaptureMedia
                ? onCaptureMedia(ctx, cardBaseRef.current)
                : undefined;
            }}
            position={popupPosition}
            onClose={closeLookup}
          />
        </YomifinErrorBoundary>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9990,
  },
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
