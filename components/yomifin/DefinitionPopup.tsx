/*
 * Definition popup (Phase 6 pane model + Phase 7 dictionaries/theming/selection).
 *
 * A lookup result is presented as a stack of PANES — one per resolved headword (≈ one
 * `LookupEntry`), each carrying ALL of that headword's dictionary definitions. Only one
 * pane shows at a time; ◀ / ▶ cycle between them with an "n / m" index. The pane scrolls
 * internally for its own dictionaries. Tapping the backdrop dismisses.
 *
 * Phase 7 additions:
 *   - Theming: all colors come from a PopupTheme (light/dark/auto), no hardcoded dark.
 *   - Per-dictionary boundary: each dictionary's definitions render in a block with a
 *     subtle per-dict background tint + a quiet dict-name header, so boundaries are
 *     obvious without being loud.
 *   - Selection: tapping a dictionary block selects the whole block; tapping a single
 *     definition selects just that definition.
 *
 * Phase 8 additions:
 *   - SENSE-level selection: individual sense nodes inside one glossary item's
 *     structured-content tree (JMdict-style) are tappable (senses.ts + the renderer's
 *     selectable-node mode). Selection feeds the {popup-selection-text} marker.
 *   - Multi-sentence: a sentence strip shows the SELECTED CUE RANGE (default = the
 *     tapped cue) with "extend to previous/next line" affordances; {sentence} and
 *     {sentence-audio} span it.
 *   - Marker-gated capture: media capture / word-audio fetch run only if some field
 *     template actually references {picture} / {sentence-audio} / {audio}.
 *
 * Definitions-only scope: no pitch/frequency display.
 */
import { Ionicons } from "@expo/vector-icons";
import {
  type AudioPlayer,
  createAudioPlayer,
  setAudioModeAsync,
} from "expo-audio";
import { File, Paths } from "expo-file-system";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { toast } from "sonner-native";
import { addAnkiCard, flattenGloss } from "@/utils/yomifin/anki";
import { getAnkiConfig } from "@/utils/yomifin/ankiConfig";
import type { CapturedMedia, MediaWant } from "@/utils/yomifin/ankiMedia";
import {
  type CueRange,
  extendRange,
  rangeLength,
  rangeSpanSec,
  rangeText,
} from "@/utils/yomifin/cues";
import type { LookupResult } from "@/utils/yomifin/lookup";
import { collectMarkers } from "@/utils/yomifin/markers";
import type { ProfileId } from "@/utils/yomifin/profiles";
import {
  flattenSelectionText,
  type PopupSelection,
  selectionEquals,
} from "@/utils/yomifin/selection";
import {
  looksLikeMissedSenses,
  senseSegments,
  senseTargets,
  serializePath,
} from "@/utils/yomifin/senses";
import type { SubtitleCue } from "@/utils/yomifin/srt";
import { fetchWordAudioCached } from "@/utils/yomifin/wordAudio";
import { base64ToBytes } from "@/utils/yomifin/wordAudioSources";
import { getPopupTheme, type PopupTheme } from "./popupTheme";
import { StructuredContent } from "./StructuredContent";

interface Props {
  result: LookupResult;
  /** Active color theme (light/dark). Defaults to dark. */
  theme?: PopupTheme;
  /** title → accent hex, for the per-dictionary boundary tint. */
  dictTints?: Record<string, string>;
  /** Subtitle cue frozen at tap time — fallback sentence when there's no cue store. */
  sentence?: string;
  /**
   * Phase 4/8: resolves the in-flight media capture for this card. `want` gates each
   * capture on the field templates; `rangeSec` widens the audio to the selected cue
   * range (min start … max end).
   */
  getMedia?: (
    want: MediaWant,
    rangeSec?: { start: number; end: number },
  ) => Promise<CapturedMedia> | undefined;
  /** Phase 8 cue store: the item's full parsed track ([] = none/bitmap). */
  cues?: SubtitleCue[];
  /** Phase 8: selected cue range (anchored at tap; null = no anchor). */
  cueRange?: CueRange | null;
  /** Index of the tapped (anchor) cue; -1 when unknown. For {cloze-*} extension. */
  anchorIndex?: number;
  /** Sentence split around the tapped word within the ANCHOR cue ({cloze-*}). */
  cloze?: { prefix: string; body: string; suffix: string };
  /** Playing media item's title ({document-title}). */
  documentTitle?: string;
  /** Effective profile (JA/ZH) — selects the Anki config cards/word-audio use. */
  profileId?: ProfileId;
  onCueRangeChange?: (range: CueRange) => void;
  /** Phase 8: reset the range back to the single tapped cue. */
  onCueRangeReset?: () => void;
  onClose: () => void;
  /** Optional: tapping an internal dictionary cross-reference link. */
  onLinkPress?: (href: string) => void;
  /** Phase 5: which side the fixed popup is anchored to. */
  position?: "left" | "right";
  /** Current in-popup selection (consumed by the {popup-selection-text} marker). */
  onSelectionChange?: (selection: PopupSelection) => void;
}

export default function DefinitionPopup({
  result,
  theme,
  dictTints = {},
  sentence = "",
  getMedia,
  cues = [],
  cueRange = null,
  anchorIndex = -1,
  cloze,
  documentTitle,
  profileId,
  onCueRangeChange,
  onCueRangeReset,
  onClose,
  onLinkPress,
  position = "right",
  onSelectionChange,
}: Props) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const t = theme ?? getPopupTheme("dark");
  const styles = useMemo(() => makeStyles(t), [t]);
  const hasEntries = result.entries.length > 0;
  const paneCount = result.entries.length;
  const [paneIndex, setPaneIndex] = useState(0);
  const [selection, setSelection] = useState<PopupSelection>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  // Manual trim fallback (✎): user-edited selection text. Overrides `selection` for
  // {popup-selection-text} — the universal escape hatch for layouts the sense
  // heuristics can't segment, or for arbitrary trims.
  const [customText, setCustomText] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // 🔊 word-audio playback (Feature: popup audio icon). Fetch is cached
  // (fetchWordAudioCached) so a later "+ Anki card" reuses the same clip/file.
  const [audioBusy, setAudioBusy] = useState(false);
  const audioPlayerRef = useRef<AudioPlayer | null>(null);
  useEffect(
    () => () => {
      audioPlayerRef.current?.remove();
      audioPlayerRef.current = null;
    },
    [],
  );

  const playWordAudio = async () => {
    if (!entry || audioBusy) return;
    setAudioBusy(true);
    try {
      const config = getAnkiConfig(profileId);
      const clip = await fetchWordAudioCached(
        config.wordAudioSources,
        entry.term,
        entry.reading,
      );
      if (!clip) {
        toast.error(`No word audio found for 「${entry.term}」`);
        return;
      }
      // Write the fetched clip to cache and play it (expo-audio needs a URI).
      const f = new File(Paths.cache, clip.filename);
      if (!f.exists) f.write(base64ToBytes(clip.base64));
      try {
        await setAudioModeAsync({ playsInSilentMode: true });
      } catch {
        // best-effort; keep playing with the current audio mode
      }
      audioPlayerRef.current?.remove();
      const player = createAudioPlayer(f.uri);
      audioPlayerRef.current = player;
      player.play();
    } catch (e) {
      toast.error((e as Error)?.message || "Word audio failed");
    } finally {
      setAudioBusy(false);
    }
  };

  // A new lookup (new result object) resets the cycler + selection + add-state.
  useEffect(() => {
    setPaneIndex(0);
    setSelection(null);
    setAdding(false);
    setAdded(false);
    setCustomText(null);
    setEditing(false);
  }, [result]);

  const select = (next: PopupSelection) => {
    setSelection((cur) => {
      const toggled = selectionEquals(cur, next) ? null : next;
      onSelectionChange?.(toggled);
      return toggled;
    });
  };

  const safeIndex = Math.min(paneIndex, Math.max(0, paneCount - 1));
  const entry = result.entries[safeIndex];
  const goPrev = () => setPaneIndex((i) => (i - 1 + paneCount) % paneCount);
  const goNext = () => setPaneIndex((i) => (i + 1) % paneCount);

  // Pane cycling by horizontal swipe anywhere on the popup. `.runOnJS(true)` (no
  // worklets — same pattern as GestureOverlay); the activation offsets keep vertical
  // scrolling and plain taps (selection Pressables) unaffected: the pan only
  // activates after a decisively horizontal drag.
  const swipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(paneCount > 1 && !editing)
        .runOnJS(true)
        .activeOffsetX([-32, 32])
        .failOffsetY([-24, 24])
        .onEnd((e) => {
          if (e.translationX <= -40) {
            setPaneIndex((i) => (i + 1) % paneCount);
          } else if (e.translationX >= 40) {
            setPaneIndex((i) => (i - 1 + paneCount) % paneCount);
          }
        }),
    [paneCount, editing],
  );

  // Phase 8: the card's sentence is the SELECTED CUE RANGE when the cue store has the
  // track; otherwise the single live cue frozen at tap time (bitmap/fetch-failure).
  const hasCueStore = cues.length > 0 && cueRange !== null;
  const displaySentence = hasCueStore ? rangeText(cues, cueRange) : sentence;
  const cueSpan = hasCueStore ? rangeLength(cueRange) : 1;

  // Phase 8: sense-level selection per glossary item of the active pane. Two tiers
  // (see senses.ts): STRUCTURAL paths (JMdict <li> senses) and, only when those are
  // absent, TEXTUAL segments (㊀㊁… / ①②… blob dictionaries). Pure tree walks.
  const senseMap = useMemo(() => {
    if (!entry) return [];
    return entry.definitions.map((group) =>
      group.glossary.map((item) => {
        const paths = senseTargets(item).map(serializePath);
        const segments = paths.length === 0 ? senseSegments(item) : [];
        if (
          paths.length === 0 &&
          segments.length === 0 &&
          looksLikeMissedSenses(item)
        ) {
          // Evidence for extending the heuristic — an unhandled dictionary layout.
          console.log(
            `[YOMIFIN SENSES] unsegmented multi-sense blob in "${group.dictionary}":`,
            JSON.stringify(item).slice(0, 600),
          );
        }
        return { paths, segments };
      }),
    );
  }, [entry]);

  // ✎ editor: prefill from (in priority order) the existing custom text, the current
  // selection's flattened text, or the pane's full glossary.
  const openEditor = (prefill?: string) => {
    setDraft(
      prefill ??
        customText ??
        ((selection ? flattenSelectionText(result, selection) : "") ||
          flattenGloss(entry)),
    );
    setEditing(true);
  };
  const commitEditor = () => {
    const trimmed = draft.trim();
    setCustomText(trimmed ? trimmed : null);
    setEditing(false);
  };

  // The add-card task runs detached: the user can close the popup / resume playback
  // while it finishes (toast reports the outcome). Guard state writes on unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleAddCard = async () => {
    if (adding || added) return;
    setAdding(true);
    // Let the spinner PAINT before any heavy work starts (device feedback: the
    // indication lagged behind the press).
    await new Promise((r) => setTimeout(r, 30));
    try {
      // Gate the expensive work on what the field templates actually reference.
      const config = getAnkiConfig(profileId);
      const markers = collectMarkers(config.fieldTemplates);
      const want: MediaWant = {
        image: markers.has("picture"),
        audio: markers.has("sentence-audio"),
      };
      // {cloze-*}: extend the anchor-cue split across the selected range.
      let cardCloze = cloze;
      if (
        cardCloze &&
        hasCueStore &&
        anchorIndex >= 0 &&
        rangeLength(cueRange) > 1
      ) {
        cardCloze = {
          prefix:
            (anchorIndex > cueRange.startIndex
              ? rangeText(cues, {
                  startIndex: cueRange.startIndex,
                  endIndex: anchorIndex - 1,
                })
              : "") + cardCloze.prefix,
          body: cardCloze.body,
          suffix:
            cardCloze.suffix +
            (anchorIndex < cueRange.endIndex
              ? rangeText(cues, {
                  startIndex: anchorIndex + 1,
                  endIndex: cueRange.endIndex,
                })
              : ""),
        };
      }
      // Capture + word audio have no data dependency — run them in parallel.
      const rangeSec = hasCueStore
        ? (rangeSpanSec(cues, cueRange) ?? undefined)
        : undefined;
      const [media, wordAudio] = await Promise.all([
        (want.image || want.audio) && getMedia
          ? getMedia(want, rangeSec)
          : Promise.resolve(undefined),
        markers.has("audio") && entry
          ? fetchWordAudioCached(
              config.wordAudioSources,
              entry.term,
              entry.reading,
            )
          : Promise.resolve(null),
      ]);
      await addAnkiCard({
        result,
        activeIndex: safeIndex,
        sentence: displaySentence,
        selection,
        customSelectionText: customText ?? undefined,
        cloze: cardCloze,
        documentTitle,
        media,
        wordAudio,
        profileId,
      });
      if (mountedRef.current) setAdded(true);
      toast.success("Card added to Anki");
    } catch (e) {
      toast.error((e as Error).message || "Failed to add card");
    } finally {
      if (mountedRef.current) setAdding(false);
    }
  };
  // Fixed-size box: ~1/3 of the screen wide, spanning almost the full height between
  // the safe-area insets. It never moves/resizes with content — it scrolls internally.
  const cardWidth = Math.max(340, Math.round(screenWidth / 3));
  const sideStyle =
    position === "left"
      ? { left: 16 + insets.left }
      : { right: 16 + insets.right };
  return (
    <View style={styles.root} pointerEvents='box-none'>
      {/* Note: the tap-outside-to-close backdrop lives in YomifinLookupLayer at a
          z-index BELOW the subtitle overlay, so tapping another word starts a new
          lookup instead of closing this one. */}
      <View
        style={[
          styles.card,
          sideStyle,
          {
            top: 16 + insets.top,
            bottom: 16 + insets.bottom,
            width: cardWidth,
          },
        ]}
      >
        <GestureDetector gesture={swipeGesture}>
          <View style={styles.cardInner}>
            {!hasEntries || !entry ? (
              <Text style={styles.noResult}>
                No dictionary entry for「{result.matchedText || "—"}」
              </Text>
            ) : editing ? (
              /* ✎ manual trim fallback: plain-text editor — native selection/editing
               works here because it IS plain text at this point (see Phase 8 notes:
               RN can't read selection back from styled Text). */
              <View style={styles.editorWrap}>
                <Text style={styles.editorTitle}>
                  Selection text for this card
                </Text>
                <TextInput
                  style={styles.editorInput}
                  value={draft}
                  onChangeText={setDraft}
                  multiline
                  autoFocus
                  autoCorrect={false}
                  textAlignVertical='top'
                  selectionColor={t.accent}
                />
                <View style={styles.editorBtns}>
                  <Pressable
                    style={styles.editorCancel}
                    onPress={() => setEditing(false)}
                    hitSlop={6}
                  >
                    <Text style={styles.editorCancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={styles.editorUse}
                    onPress={commitEditor}
                    hitSlop={6}
                  >
                    <Text style={styles.editorUseText}>Use this text</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
              >
                <View style={styles.entry}>
                  <View style={styles.headwordRow}>
                    <Text style={styles.term}>{entry.term}</Text>
                    {entry.reading && entry.reading !== entry.term ? (
                      <Text style={styles.reading}>【{entry.reading}】</Text>
                    ) : null}
                    {entry.wordClasses.length > 0 ? (
                      <Text style={styles.wordClass}>
                        {entry.wordClasses.join(" · ")}
                      </Text>
                    ) : null}
                    <Pressable
                      style={styles.audioBtn}
                      onPress={playWordAudio}
                      disabled={audioBusy}
                      hitSlop={8}
                    >
                      {audioBusy ? (
                        <ActivityIndicator size='small' color={t.reading} />
                      ) : (
                        <Ionicons
                          name='volume-medium'
                          size={20}
                          color={t.reading}
                        />
                      )}
                    </Pressable>
                    {/* Prominent pane index beside the headword (◀ ▶ also in footer;
                      swipe/edge-tap cycle too). */}
                    {paneCount > 1 ? (
                      <Text style={styles.paneIndexTop}>
                        {safeIndex + 1} / {paneCount}
                      </Text>
                    ) : null}
                  </View>
                  {entry.inflectionChain.length > 0 ? (
                    <Text style={styles.inflection}>
                      {entry.inflectionChain.join(" ← ")}
                    </Text>
                  ) : null}
                  {entry.definitions.map((group, gi) => {
                    const tint = dictTints[group.dictionary] ?? t.reading;
                    const dictSelected =
                      selection?.kind === "dictionary" &&
                      selection.paneIndex === safeIndex &&
                      selection.dictionary === group.dictionary;
                    return (
                      <Pressable
                        key={gi}
                        onPress={() =>
                          select({
                            kind: "dictionary",
                            paneIndex: safeIndex,
                            dictionary: group.dictionary,
                          })
                        }
                        onLongPress={() =>
                          openEditor(
                            flattenSelectionText(result, {
                              kind: "dictionary",
                              paneIndex: safeIndex,
                              dictionary: group.dictionary,
                            }),
                          )
                        }
                        style={[
                          styles.defGroup,
                          {
                            backgroundColor: t.tintBg(tint),
                            borderLeftColor: dictSelected
                              ? t.selectedBorder
                              : t.tintBorder(tint),
                            borderLeftWidth: dictSelected ? 4 : 3,
                          },
                          dictSelected && styles.blockSelected,
                        ]}
                      >
                        <Text style={[styles.dictName, { color: tint }]}>
                          {group.dictionary}
                        </Text>
                        {group.glossary.map((gloss, li) => {
                          const defSelected =
                            selection?.kind === "definition" &&
                            selection.paneIndex === safeIndex &&
                            selection.dictionary === group.dictionary &&
                            selection.glossIndex === li;
                          const senseSelected =
                            selection?.kind === "sense" &&
                            selection.paneIndex === safeIndex &&
                            selection.dictionary === group.dictionary &&
                            selection.glossIndex === li
                              ? serializePath(selection.path)
                              : null;
                          const info = senseMap[gi]?.[li];
                          return (
                            <Pressable
                              key={li}
                              onPress={() =>
                                select({
                                  kind: "definition",
                                  paneIndex: safeIndex,
                                  dictionary: group.dictionary,
                                  glossIndex: li,
                                })
                              }
                              onLongPress={() =>
                                openEditor(
                                  flattenSelectionText(result, {
                                    kind: "definition",
                                    paneIndex: safeIndex,
                                    dictionary: group.dictionary,
                                    glossIndex: li,
                                  }),
                                )
                              }
                              style={[
                                styles.gloss,
                                defSelected && styles.glossSelected,
                              ]}
                            >
                              {info && info.segments.length > 0 ? (
                                // Textual senses (blob dict): render each segment as its
                                // own tappable fragment (inner Pressable wins the tap).
                                info.segments.map((segment, si) => {
                                  const segSelected =
                                    selection?.kind === "segment" &&
                                    selection.paneIndex === safeIndex &&
                                    selection.dictionary === group.dictionary &&
                                    selection.glossIndex === li &&
                                    selection.segIndex === si;
                                  return (
                                    <Pressable
                                      key={si}
                                      onPress={() =>
                                        select({
                                          kind: "segment",
                                          paneIndex: safeIndex,
                                          dictionary: group.dictionary,
                                          glossIndex: li,
                                          segIndex: si,
                                        })
                                      }
                                      onLongPress={() =>
                                        openEditor(
                                          flattenSelectionText(result, {
                                            kind: "segment",
                                            paneIndex: safeIndex,
                                            dictionary: group.dictionary,
                                            glossIndex: li,
                                            segIndex: si,
                                          }),
                                        )
                                      }
                                      style={[
                                        styles.segment,
                                        segSelected && styles.glossSelected,
                                      ]}
                                    >
                                      <StructuredContent
                                        content={segment}
                                        color={t.text}
                                        linkColor={t.link}
                                        onLinkPress={onLinkPress}
                                      />
                                    </Pressable>
                                  );
                                })
                              ) : (
                                <StructuredContent
                                  content={gloss}
                                  color={t.text}
                                  linkColor={t.link}
                                  onLinkPress={onLinkPress}
                                  selectablePaths={info?.paths}
                                  selectedPath={senseSelected}
                                  onSelectPath={(path) =>
                                    select({
                                      kind: "sense",
                                      paneIndex: safeIndex,
                                      dictionary: group.dictionary,
                                      glossIndex: li,
                                      path,
                                    })
                                  }
                                  onLongPressPath={(path) =>
                                    openEditor(
                                      flattenSelectionText(result, {
                                        kind: "sense",
                                        paneIndex: safeIndex,
                                        dictionary: group.dictionary,
                                        glossIndex: li,
                                        path,
                                      }),
                                    )
                                  }
                                  selectedBg={t.selectedBg}
                                  selectedBorder={t.selectedBorder}
                                />
                              )}
                            </Pressable>
                          );
                        })}
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            )}
            {hasEntries && !editing && customText ? (
              <View style={styles.customRow}>
                <Text style={styles.customLabel} numberOfLines={1}>
                  ✎ {customText}
                </Text>
                <Pressable onPress={() => setCustomText(null)} hitSlop={8}>
                  <Text style={styles.customClear}>✕</Text>
                </Pressable>
              </View>
            ) : null}
            {hasEntries && !editing ? (
              <View style={styles.sentenceStrip}>
                <View style={styles.sentenceTextWrap}>
                  <Text style={styles.sentenceLabel}>
                    Sentence{cueSpan > 1 ? ` · ${cueSpan} lines` : ""}
                  </Text>
                  <Text style={styles.sentenceText} numberOfLines={3}>
                    {displaySentence || "—"}
                  </Text>
                </View>
                {hasCueStore && onCueRangeChange ? (
                  <View style={styles.sentenceBtns}>
                    {/* ↺ first so the ＋ buttons never shift position. */}
                    <Pressable
                      style={[
                        styles.extendBtn,
                        cueSpan <= 1 && styles.extendBtnDisabled,
                      ]}
                      hitSlop={6}
                      disabled={cueSpan <= 1}
                      onPress={onCueRangeReset}
                    >
                      <Text style={styles.extendBtnText}>↺</Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.extendBtn,
                        cueRange.startIndex <= 0 && styles.extendBtnDisabled,
                      ]}
                      hitSlop={6}
                      disabled={cueRange.startIndex <= 0}
                      onPress={() =>
                        onCueRangeChange(extendRange(cueRange, -1, cues.length))
                      }
                    >
                      <Text style={styles.extendBtnText}>‹＋</Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.extendBtn,
                        cueRange.endIndex >= cues.length - 1 &&
                          styles.extendBtnDisabled,
                      ]}
                      hitSlop={6}
                      disabled={cueRange.endIndex >= cues.length - 1}
                      onPress={() =>
                        onCueRangeChange(extendRange(cueRange, 1, cues.length))
                      }
                    >
                      <Text style={styles.extendBtnText}>＋›</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : null}
            {hasEntries && !editing ? (
              <View style={styles.footer}>
                {paneCount > 1 ? (
                  <View style={styles.cycler}>
                    <Pressable
                      style={styles.cycleBtn}
                      onPress={goPrev}
                      hitSlop={8}
                    >
                      <Text style={styles.cycleArrow}>◀</Text>
                    </Pressable>
                    <Text style={styles.cycleIndex}>
                      {safeIndex + 1} / {paneCount}
                    </Text>
                    <Pressable
                      style={styles.cycleBtn}
                      onPress={goNext}
                      hitSlop={8}
                    >
                      <Text style={styles.cycleArrow}>▶</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View />
                )}
                <View style={styles.footerRight}>
                  <Pressable
                    style={styles.editBtn}
                    onPress={() => openEditor()}
                    hitSlop={6}
                  >
                    <Text style={styles.editBtnText}>✎</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.addBtn, added && styles.addBtnDone]}
                    onPress={handleAddCard}
                    disabled={adding || added}
                    hitSlop={6}
                  >
                    {adding ? (
                      <ActivityIndicator size='small' color={t.accentText} />
                    ) : (
                      <Text style={styles.addBtnText}>
                        {added ? "✓ Added" : "+ Anki card"}
                      </Text>
                    )}
                  </Pressable>
                </View>
              </View>
            ) : null}
            {/* Edge-tap zones: thin strips along the popup's own left/right edges cycle
              panes (they sit over the card's padding gutters, above the ScrollView). */}
            {hasEntries && !editing && paneCount > 1 ? (
              <>
                <Pressable
                  style={[styles.edgeZone, styles.edgeZoneLeft]}
                  onPress={goPrev}
                />
                <Pressable
                  style={[styles.edgeZone, styles.edgeZoneRight]}
                  onPress={goNext}
                />
              </>
            ) : null}
            <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8}>
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          </View>
        </GestureDetector>
      </View>
    </View>
  );
}

function makeStyles(t: PopupTheme) {
  return StyleSheet.create({
    root: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 100000,
    },
    card: {
      position: "absolute",
    },
    cardInner: {
      flex: 1,
      width: "100%",
      backgroundColor: t.bg,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.cardBorder,
      paddingTop: 14,
      paddingBottom: 8,
      paddingHorizontal: 16,
    },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 6,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.divider,
    },
    sentenceStrip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 6,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.divider,
    },
    sentenceTextWrap: { flex: 1 },
    sentenceLabel: {
      color: t.subtle,
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 2,
    },
    sentenceText: { color: t.text, fontSize: 14, lineHeight: 19 },
    sentenceBtns: { flexDirection: "row", gap: 4 },
    customRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 6,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.divider,
    },
    customLabel: { flex: 1, color: t.reading, fontSize: 13 },
    customClear: { color: t.subtle, fontSize: 15, fontWeight: "600" },
    editorWrap: { flex: 1, paddingTop: 20 },
    editorTitle: {
      color: t.subtle,
      fontSize: 12,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 8,
    },
    editorInput: {
      flex: 1,
      color: t.text,
      fontSize: 15,
      lineHeight: 22,
      backgroundColor: t.selectedBg,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.divider,
      padding: 10,
    },
    editorBtns: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: 10,
      marginTop: 10,
    },
    editorCancel: { paddingHorizontal: 12, paddingVertical: 8 },
    editorCancelText: { color: t.subtle, fontSize: 15, fontWeight: "600" },
    editorUse: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: t.accent,
    },
    editorUseText: { color: t.accentText, fontSize: 15, fontWeight: "600" },
    footerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
    editBtn: {
      width: 38,
      height: 36,
      borderRadius: 10,
      backgroundColor: t.selectedBg,
      alignItems: "center",
      justifyContent: "center",
    },
    editBtnText: { color: t.reading, fontSize: 16, fontWeight: "600" },
    extendBtn: {
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: t.selectedBg,
      alignItems: "center",
      justifyContent: "center",
    },
    extendBtnText: { color: t.reading, fontSize: 15, fontWeight: "700" },
    extendBtnDisabled: { opacity: 0.35 },
    cycler: {
      flexDirection: "row",
      alignItems: "center",
    },
    cycleBtn: {
      width: 36,
      height: 30,
      alignItems: "center",
      justifyContent: "center",
    },
    cycleArrow: { color: t.reading, fontSize: 16, fontWeight: "700" },
    cycleIndex: {
      color: t.subtle,
      fontSize: 14,
      fontVariant: ["tabular-nums"],
      minWidth: 52,
      textAlign: "center",
    },
    scroll: { flex: 1 },
    scrollContent: { paddingRight: 24, paddingBottom: 8 },
    noResult: {
      color: t.subtle,
      fontSize: 16,
      paddingVertical: 12,
      paddingRight: 24,
    },
    entry: { marginBottom: 14 },
    headwordRow: {
      flexDirection: "row",
      alignItems: "baseline",
      flexWrap: "wrap",
    },
    term: { color: t.term, fontSize: 28, fontWeight: "700" },
    reading: { color: t.reading, fontSize: 18, marginLeft: 6 },
    wordClass: {
      color: t.subtle,
      fontSize: 13,
      marginLeft: 10,
      fontStyle: "italic",
    },
    audioBtn: {
      marginLeft: 10,
      width: 28,
      height: 24,
      alignItems: "center",
      justifyContent: "center",
      alignSelf: "center",
    },
    inflection: {
      color: t.inflection,
      fontSize: 13,
      marginTop: 2,
      marginBottom: 4,
    },
    defGroup: {
      marginTop: 8,
      borderRadius: 8,
      borderLeftWidth: 3,
      paddingVertical: 6,
      paddingHorizontal: 10,
    },
    blockSelected: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.selectedBorder,
    },
    dictName: {
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 4,
      opacity: 0.85,
    },
    gloss: {
      marginTop: 2,
      borderRadius: 6,
      paddingHorizontal: 4,
      paddingVertical: 2,
    },
    segment: {
      borderRadius: 5,
      paddingHorizontal: 2,
      paddingVertical: 1,
    },
    glossSelected: {
      backgroundColor: t.selectedBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.selectedBorder,
    },
    paneIndexTop: {
      marginLeft: "auto",
      color: t.reading,
      fontSize: 15,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
      backgroundColor: t.selectedBg,
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 3,
      overflow: "hidden",
      alignSelf: "center",
    },
    edgeZone: {
      position: "absolute",
      top: 56,
      bottom: 132,
      width: 24,
    },
    edgeZoneLeft: { left: 0 },
    edgeZoneRight: { right: 0 },
    closeBtn: {
      position: "absolute",
      top: 6,
      right: 8,
      width: 30,
      height: 30,
      alignItems: "center",
      justifyContent: "center",
    },
    closeBtnText: { color: t.subtle, fontSize: 18, fontWeight: "600" },
    addBtn: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: t.accent,
      minWidth: 110,
      alignItems: "center",
    },
    addBtnDone: { backgroundColor: "#3a7a3a" },
    addBtnText: { color: t.accentText, fontSize: 15, fontWeight: "600" },
  });
}
