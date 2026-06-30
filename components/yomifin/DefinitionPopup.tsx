/*
 * Phase 2 definition popup. Renders a YomifinDictionary lookup result over the video:
 * the resolved headword(s), reading, deinflection chain, and the glossary rendered via
 * the structured-content renderer. Tapping the backdrop dismisses it.
 *
 * Definitions-only scope (CONTEXT §3.10): no pitch/frequency display.
 */
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { toast } from "sonner-native";
import { addAnkiCard } from "@/utils/yomifin/anki";
import type { CapturedMedia } from "@/utils/yomifin/ankiMedia";
import type { LookupResult } from "@/utils/yomifin/lookup";
import { StructuredContent } from "./StructuredContent";

interface Props {
  result: LookupResult;
  /** Subtitle cue frozen at tap time — the Anki card's sentence (Phase 3). */
  sentence?: string;
  /** Phase 4: resolves the in-flight media capture (frame + audio) for this card. */
  getMedia?: () => Promise<CapturedMedia> | undefined;
  onClose: () => void;
  /** Optional: tapping an internal dictionary cross-reference link. */
  onLinkPress?: (href: string) => void;
}

export default function DefinitionPopup({
  result,
  sentence = "",
  getMedia,
  onClose,
  onLinkPress,
}: Props) {
  const hasEntries = result.entries.length > 0;
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  const handleAddCard = async () => {
    if (adding || added) return;
    setAdding(true);
    try {
      const media = getMedia ? await getMedia() : undefined;
      await addAnkiCard({ result, sentence, media });
      setAdded(true);
      toast.success("Card added to Anki");
    } catch (e) {
      toast.error((e as Error).message || "Failed to add card");
    } finally {
      setAdding(false);
    }
  };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents='box-none'>
      {/* backdrop */}
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.card} pointerEvents='box-none'>
        <View style={styles.cardInner}>
          {!hasEntries ? (
            <Text style={styles.noResult}>
              No dictionary entry for「{result.matchedText || "—"}」
            </Text>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
            >
              {result.entries.map((entry, ei) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: stable per result render
                <View key={ei} style={styles.entry}>
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
                  {entry.definitions.map((group, gi) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: stable per result render
                    <View key={gi} style={styles.defGroup}>
                      {entry.definitions.length > 1 ? (
                        <Text style={styles.dictName}>{group.dictionary}</Text>
                      ) : null}
                      {group.glossary.map((gloss, li) => (
                        <View
                          // biome-ignore lint/suspicious/noArrayIndexKey: stable per result render
                          key={li}
                          style={styles.gloss}
                        >
                          <StructuredContent
                            content={gloss}
                            onLinkPress={onLinkPress}
                          />
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              ))}
            </ScrollView>
          )}
          {hasEntries ? (
            <Pressable
              style={[styles.addBtn, added && styles.addBtnDone]}
              onPress={handleAddCard}
              disabled={adding || added}
              hitSlop={6}
            >
              {adding ? (
                <ActivityIndicator size='small' color='#fff' />
              ) : (
                <Text style={styles.addBtnText}>
                  {added ? "✓ Added" : "+ Anki card"}
                </Text>
              )}
            </Pressable>
          ) : null}
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8}>
            <Text style={styles.closeBtnText}>✕</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  card: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
  },
  cardInner: {
    width: "94%",
    maxWidth: 720,
    maxHeight: 340,
    marginBottom: 12,
    backgroundColor: "rgba(20,20,22,0.97)",
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.15)",
    paddingTop: 14,
    paddingBottom: 8,
    paddingHorizontal: 16,
  },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingRight: 24, paddingBottom: 8 },
  noResult: {
    color: "#bbb",
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
  term: { color: "white", fontSize: 28, fontWeight: "700" },
  reading: { color: "#9ecbff", fontSize: 18, marginLeft: 6 },
  wordClass: {
    color: "#aaa",
    fontSize: 13,
    marginLeft: 10,
    fontStyle: "italic",
  },
  inflection: { color: "#d6a35c", fontSize: 13, marginTop: 2, marginBottom: 4 },
  defGroup: { marginTop: 6 },
  dictName: { color: "#888", fontSize: 12, marginBottom: 2 },
  gloss: { marginTop: 2 },
  closeBtn: {
    position: "absolute",
    top: 6,
    right: 8,
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: { color: "#bbb", fontSize: 18, fontWeight: "600" },
  addBtn: {
    alignSelf: "flex-start",
    marginTop: 4,
    marginBottom: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#2d6cdf",
    minWidth: 110,
    alignItems: "center",
  },
  addBtnDone: { backgroundColor: "#3a7a3a" },
  addBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
