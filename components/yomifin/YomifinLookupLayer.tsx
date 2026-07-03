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
import { useAtom, useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSettings } from "@/utils/atoms/settings";
import {
  yomifinCueRangeAtom,
  yomifinCuesAtom,
} from "@/utils/atoms/yomifinCueStore";
import type {
  CaptureContext,
  CapturedMedia,
  MediaWant,
} from "@/utils/yomifin/ankiMedia";
import { sweepYomifinCacheFiles } from "@/utils/yomifin/cacheSweep";
import { findCueIndexByTime } from "@/utils/yomifin/cues";
import {
  enabledTitlesInOrder,
  resolveDictionaryConfig,
  tintMap,
} from "@/utils/yomifin/dictionaryConfig";
import { listInstalledDictionaries } from "@/utils/yomifin/dictionaryStore";
import { loadInstalledDictionary } from "@/utils/yomifin/loadInstalledDictionary";
import type { LookupResult, YomifinDictionary } from "@/utils/yomifin/lookup";
import {
  PROFILE_LABELS,
  type ProfileId,
  resolveEffectiveProfileId,
  resolveProfile,
  titlesForProfile,
} from "@/utils/yomifin/profiles";
// NOTE: the profile INDICATOR/SWITCH pill lives in the players' top bars
// (components/yomifin/ProfilePill.tsx), fed the same profileKey/languageHint.
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
   * nothing (no per-tap seek/decode). Filenames are content-derived inside the
   * capture layer (media dedup), so no per-card base name is threaded through.
   */
  onCaptureMedia?: (
    ctx: CaptureContext,
    want: MediaWant,
  ) => Promise<CapturedMedia>;
  /** Playing media item's title, for the {document-title} marker. */
  documentTitle?: string;
  /**
   * Profile auto-select: the playing track's language mapped to a profile
   * (profileIdForLanguageTag in direct-player). Overrides the manually-active
   * profile; null/undefined = fall back to Settings.
   */
  languageHint?: ProfileId | null;
  /**
   * Stable per-title key (Jellyfin SeriesId/ItemId, Stremio series name) under
   * which a manual profile switch (the pill) is remembered. Without it the pill
   * still works but only flips the app-wide active profile.
   */
  profileKey?: string;
}

type DictStatus = "loading" | "ready" | "none" | "error";

export default function YomifinLookupLayer({
  text,
  onLookupOpen,
  onLookupClose,
  popupPosition = "right",
  onSnapshotCard,
  onCaptureMedia,
  documentTitle,
  languageHint,
  profileKey,
}: Props) {
  const { settings } = useSettings();
  // Profiles (JA/ZH bundles): per-title manual override (pill in the players' top
  // bars) > track-language hint > manual default. The resolved profile supplies the
  // dictionary set AND the Translator language; the same id threads to the popup so
  // cards target that profile's Anki config.
  const profileId: ProfileId = resolveEffectiveProfileId(
    settings,
    languageHint,
    profileKey,
  );
  const dictConfig = resolveProfile(settings, profileId).dictionaryConfig;
  const dictLanguages = settings.yomifinDictionaryLanguages ?? {};
  const maxResults = settings.yomifinMaxResults ?? 32;
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
  // Phase 8 cue store: full parsed track (direct-player fills it) + the selected cue
  // range for the in-flight card (anchored at tap; extended from the popup).
  const cues = useAtomValue(yomifinCuesAtom);
  const [cueRange, setCueRange] = useAtom(yomifinCueRangeAtom);
  // The tapped cue's index — kept so the popup's ↺ button can reset an over-extended
  // range back to the single anchor line.
  const cueAnchorRef = useRef<number>(-1);
  // Sentence split around the tapped word, frozen at tap time ({cloze-*} markers).
  const clozeRef = useRef<{ prefix: string; body: string; suffix: string }>({
    prefix: "",
    body: "",
    suffix: "",
  });
  const [busy, setBusy] = useState(false);
  // Frozen at tap (cheap); the actual capture runs only if "+ Anki card" is pressed.
  const cardCtxRef = useRef<CaptureContext | null>(null);
  const cardBaseRef = useRef<string>("");

  // Disk-cache hygiene: once per player screen, delete stale yomifin_* cache files
  // (🔊 word-audio clips kept for replay + any capture temp leaked by a crash).
  useEffect(() => {
    sweepYomifinCacheFiles();
  }, []);

  // Open the installed dictionary db once for the player screen's lifetime. Opening is
  // instant (no parse); if none is installed yet, the overlay still shows text but taps
  // do nothing (status "none").
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the config changes
  useEffect(() => {
    try {
      // Only the ACTIVE profile's dictionaries participate — a zh dictionary must
      // never show up (or match) in a ja lookup and vice versa.
      const installed = titlesForProfile(
        listInstalledDictionaries().map((d) => d.title),
        dictLanguages,
        profileId,
      );
      const resolved = resolveDictionaryConfig(installed, dictConfig);
      setTints(tintMap(resolved));
      const loaded = loadInstalledDictionary(enabledTitlesInOrder(resolved), {
        language: profileId,
        maxResults,
      });
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
  }, [
    JSON.stringify(dictConfig),
    JSON.stringify(dictLanguages),
    profileId,
    maxResults,
  ]);

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
      // Cloze split: `input` is the cue text from the tapped token to the end of the
      // line (a strict suffix of `text`), and the lookup decided the match length.
      const tapAt = text.length - input.length;
      clozeRef.current = {
        prefix: text.slice(0, tapAt).replace(/\n+/g, ""),
        body: input.slice(0, r.matchedLength).replace(/\n+/g, ""),
        suffix: input.slice(r.matchedLength).replace(/\n+/g, ""),
      };
      // Cheap snapshot only — the expensive capture is deferred to the add-card press
      // so that ordinary lookups never trigger a seek/decode.
      const ctx = onSnapshotCard?.() ?? null;
      cardCtxRef.current = ctx;
      cardBaseRef.current = `card_${Date.now()}`;
      // Anchor the selected cue range at the tapped cue (span 1). -1 = no match
      // (bitmap track / fetch failure) → popup degrades to the single live cue.
      const anchor = ctx
        ? findCueIndexByTime(cues, ctx.cueStart, ctx.cueEnd)
        : -1;
      cueAnchorRef.current = anchor;
      setCueRange(
        anchor >= 0 ? { startIndex: anchor, endIndex: anchor } : null,
      );
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
        fontSize={settings.yomifinSubtitleFontSize ?? 32}
        outline={settings.yomifinSubtitleOutline ?? "normal"}
        bottomOffset={settings.yomifinSubtitleBottomOffset ?? 64}
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
            No {PROFILE_LABELS[profileId]} dictionary — add/assign one in
            Settings
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
            cues={cues}
            cueRange={cueRange}
            anchorIndex={cueAnchorRef.current}
            cloze={clozeRef.current}
            documentTitle={documentTitle}
            profileId={profileId}
            onCueRangeChange={setCueRange}
            onCueRangeReset={() => {
              const anchor = cueAnchorRef.current;
              if (anchor >= 0)
                setCueRange({ startIndex: anchor, endIndex: anchor });
            }}
            getMedia={(want, rangeSec) => {
              const ctx = cardCtxRef.current;
              if (!ctx || !onCaptureMedia) return undefined;
              // Widen the audio clip to the selected cue range (multi-sentence card).
              const merged = rangeSec
                ? { ...ctx, cueStart: rangeSec.start, cueEnd: rangeSec.end }
                : ctx;
              return onCaptureMedia(merged, want);
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
