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
 *   - Selection scaffolding (for Phase 8): tapping a dictionary block selects the whole
 *     block; tapping a single definition selects just that definition. The selected
 *     target is highlighted. `onSelectionChange` surfaces it (unconsumed this phase).
 *
 * Definitions-only scope (CONTEXT §3.10): no pitch/frequency display.
 */
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { toast } from "sonner-native";
import { addAnkiCard } from "@/utils/yomifin/anki";
import type { CapturedMedia } from "@/utils/yomifin/ankiMedia";
import type { LookupResult } from "@/utils/yomifin/lookup";
import {
  type PopupSelection,
  selectionEquals,
} from "@/utils/yomifin/selection";
import { getPopupTheme, type PopupTheme } from "./popupTheme";
import { StructuredContent } from "./StructuredContent";

interface Props {
  result: LookupResult;
  /** Active color theme (light/dark). Defaults to dark. */
  theme?: PopupTheme;
  /** title → accent hex, for the per-dictionary boundary tint. */
  dictTints?: Record<string, string>;
  /** Subtitle cue frozen at tap time — the Anki card's sentence (Phase 3). */
  sentence?: string;
  /** Phase 4: resolves the in-flight media capture (frame + audio) for this card. */
  getMedia?: () => Promise<CapturedMedia> | undefined;
  onClose: () => void;
  /** Optional: tapping an internal dictionary cross-reference link. */
  onLinkPress?: (href: string) => void;
  /** Phase 5: which side the fixed popup is anchored to. */
  position?: "left" | "right";
  /** Phase 7→8 scaffolding: current in-popup selection (Anki consumption is Phase 8). */
  onSelectionChange?: (selection: PopupSelection) => void;
}

export default function DefinitionPopup({
  result,
  theme,
  dictTints = {},
  sentence = "",
  getMedia,
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

  // A new lookup (new result object) resets the cycler + selection + add-state.
  useEffect(() => {
    setPaneIndex(0);
    setSelection(null);
    setAdding(false);
    setAdded(false);
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

  const handleAddCard = async () => {
    if (adding || added) return;
    setAdding(true);
    try {
      const media = getMedia ? await getMedia() : undefined;
      await addAnkiCard({ result, activeIndex: safeIndex, sentence, media });
      setAdded(true);
      toast.success("Card added to Anki");
    } catch (e) {
      toast.error((e as Error).message || "Failed to add card");
    } finally {
      setAdding(false);
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
        <View style={styles.cardInner}>
          {!hasEntries || !entry ? (
            <Text style={styles.noResult}>
              No dictionary entry for「{result.matchedText || "—"}」
            </Text>
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
                            style={[
                              styles.gloss,
                              defSelected && styles.glossSelected,
                            ]}
                          >
                            <StructuredContent
                              content={gloss}
                              color={t.text}
                              linkColor={t.link}
                              onLinkPress={onLinkPress}
                            />
                          </Pressable>
                        );
                      })}
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          )}
          {hasEntries ? (
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
          ) : null}
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8}>
            <Text style={styles.closeBtnText}>✕</Text>
          </Pressable>
        </View>
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
    glossSelected: {
      backgroundColor: t.selectedBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.selectedBorder,
    },
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
