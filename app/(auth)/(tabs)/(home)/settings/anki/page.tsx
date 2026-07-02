/*
 * Yomifin "Anki" settings — Phase 8 runtime card configuration.
 *
 * Kills the hardcoded field map: connect to AnkiConnect, pick deck + note type from
 * the server's real lists (deckNames / modelNames), see the note type's REAL fields
 * (modelFieldNames), and assign each field a Yomitan-style MARKER TEMPLATE. Templates
 * are rendered at card time by utils/yomifin/markers.ts.
 *
 * Persists to Settings.yomifinAnkiConfig; getAnkiConfig() (utils/yomifin/ankiConfig.ts)
 * reads it and falls back to the seeded defaults when unset.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { toast } from "sonner-native";
import { useSettings } from "@/utils/atoms/settings";
import {
  fetchDeckNames,
  fetchModelFieldNames,
  fetchModelNames,
} from "@/utils/yomifin/anki";
import {
  type AnkiConfig,
  DEFAULT_ANKI_CONFIG,
  getAnkiConfig,
  seedFieldTemplates,
} from "@/utils/yomifin/ankiConfig";
import { listInstalledDictionaries } from "@/utils/yomifin/dictionaryStore";
import type { WordAudioSourceConfig } from "@/utils/yomifin/wordAudioSources";

const MARKER_HELP: Array<[string, string]> = [
  ["{expression}", "headword of the active pane"],
  ["{reading}", "reading / kana"],
  ["{furigana}", "headword as HTML ruby (読む → ruby-annotated)"],
  ["{furigana-plain}", "Anki furigana syntax (読[よ]む)"],
  ["{sentence}", "selected subtitle line(s) — extendable in the popup"],
  ["{cloze-prefix}", "sentence before the tapped word"],
  ["{cloze-body}", "the tapped word as it appeared"],
  ["{cloze-suffix}", "sentence after the tapped word"],
  ["{glossary}", "full glossary (all enabled dictionaries)"],
  ["{single-glossary:DICT}", "only that dictionary's glossary"],
  [
    "{popup-selection-text}",
    "the tapped block / definition / sense, or ✎-edited text; empty when nothing is selected",
  ],
  ["{conjugation}", "deinflection chain"],
  ["{dictionary}", "highest-priority dictionary name"],
  ["{tags}", "dictionary tags"],
  ["{document-title}", "the video's title"],
  ["{audio}", "word audio (jpod101 / jisho / custom URL)"],
  ["{sentence-audio}", "audio clip spanning the selected line(s)"],
  ["{picture}", "captured video frame"],
];

export default function AnkiSettingsPage() {
  const insets = useSafeAreaInsets();
  const { updateSettings } = useSettings();

  // Local working copy; every change persists immediately (like the other pages).
  const [config, setConfig] = useState<AnkiConfig>(() => getAnkiConfig());
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [decks, setDecks] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [loadingFields, setLoadingFields] = useState(false);
  const [tagsText, setTagsText] = useState(config.tags.join(", "));
  // Which field's marker picker is open ({…} button next to each template input).
  const [markerPickerField, setMarkerPickerField] = useState<string | null>(
    null,
  );

  // All insertable markers: the static set + a {single-glossary:…} per installed
  // dictionary (so the user never types a dictionary title by hand).
  const insertableMarkers = useMemo(() => {
    const base = MARKER_HELP.map(([m]) => m).filter(
      (m) => m !== "{single-glossary:DICT}",
    );
    let dicts: string[] = [];
    try {
      dicts = listInstalledDictionaries().map(
        (d) => `{single-glossary:${d.title}}`,
      );
    } catch {
      // no dictionary db yet — fine, just omit
    }
    return [...base, ...dicts];
  }, []);

  const persist = useCallback(
    (next: AnkiConfig) => {
      setConfig(next);
      updateSettings({ yomifinAnkiConfig: next });
    },
    [updateSettings],
  );

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const [d, m] = await Promise.all([
        fetchDeckNames(config.url),
        fetchModelNames(config.url),
      ]);
      setDecks(d);
      setModels(m);
      setConnected(true);
      toast.success(`Connected — ${d.length} decks, ${m.length} note types`);
    } catch (e) {
      setConnected(false);
      toast.error((e as Error).message || "Connection failed");
    } finally {
      setConnecting(false);
    }
  }, [config.url]);

  // Load the chosen model's REAL fields; seed templates for fields we haven't seen,
  // preserving anything the user already typed for this model.
  const loadFields = useCallback(
    async (modelName: string, current: AnkiConfig) => {
      setLoadingFields(true);
      try {
        const names = await fetchModelFieldNames(current.url, modelName);
        const seeded = seedFieldTemplates(names);
        const fieldTemplates: Record<string, string> = {};
        for (const name of names) {
          fieldTemplates[name] =
            current.modelName === modelName &&
            current.fieldTemplates[name] !== undefined
              ? current.fieldTemplates[name]
              : seeded[name];
        }
        persist({ ...current, modelName, fieldTemplates });
      } catch (e) {
        toast.error((e as Error).message || "Couldn't load note-type fields");
      } finally {
        setLoadingFields(false);
      }
    },
    [persist],
  );

  // If the stored model matches, refresh its field list on connect (fields may have
  // been added/renamed in Anki since last time). Deps intentionally only [connected].
  useEffect(() => {
    if (connected && config.modelName && models.includes(config.modelName)) {
      loadFields(config.modelName, config);
    }
  }, [connected]);

  const fieldNames = useMemo(
    () => Object.keys(config.fieldTemplates),
    [config.fieldTemplates],
  );

  const setSource = (
    type: WordAudioSourceConfig["type"],
    patch: Partial<WordAudioSourceConfig>,
  ) => {
    const sources = config.wordAudioSources.map((s) =>
      s.type === type ? { ...s, ...patch } : s,
    );
    persist({ ...config, wordAudioSources: sources });
  };
  const sourceOf = (type: WordAudioSourceConfig["type"]) =>
    config.wordAudioSources.find((s) => s.type === type);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior='automatic'
      contentContainerStyle={{
        paddingLeft: insets.left,
        paddingRight: insets.right,
        paddingBottom: 32,
      }}
    >
      <View
        className='p-4 flex flex-col'
        style={{ paddingTop: Platform.OS === "android" ? 10 : 0, gap: 22 }}
      >
        {/* Connection */}
        <View style={{ gap: 8 }}>
          <Text style={styles.title}>AnkiConnect</Text>
          <Text style={styles.subtitle}>
            The AnkiConnect endpoint on your always-on server. Anki needs
            webBindAddress = 0.0.0.0 to be reachable from the iPad.
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={config.url}
              onChangeText={(url) => persist({ ...config, url })}
              autoCapitalize='none'
              autoCorrect={false}
              keyboardType='url'
              placeholder='http://192.168.1.10:8765'
              placeholderTextColor='#666'
            />
            <Pressable
              style={styles.button}
              onPress={connect}
              disabled={connecting}
            >
              {connecting ? (
                <ActivityIndicator size='small' color='#001' />
              ) : (
                <Text style={styles.buttonText}>
                  {connected ? "Refresh" : "Connect"}
                </Text>
              )}
            </Pressable>
          </View>
        </View>

        {/* Deck */}
        <View style={{ gap: 8 }}>
          <Text style={styles.title}>Deck</Text>
          {decks.length === 0 ? (
            <Text style={styles.subtitle}>
              Current: {config.deckName || "—"} (connect to pick from the
              server's decks)
            </Text>
          ) : (
            <View style={styles.chipWrap}>
              {decks.map((d) => (
                <Chip
                  key={d}
                  label={d}
                  active={d === config.deckName}
                  onPress={() => persist({ ...config, deckName: d })}
                />
              ))}
            </View>
          )}
        </View>

        {/* Note type */}
        <View style={{ gap: 8 }}>
          <Text style={styles.title}>Note type</Text>
          {models.length === 0 ? (
            <Text style={styles.subtitle}>
              Current: {config.modelName || "—"} (connect to pick from the
              server's note types)
            </Text>
          ) : (
            <View style={styles.chipWrap}>
              {models.map((m) => (
                <Chip
                  key={m}
                  label={m}
                  active={m === config.modelName}
                  onPress={() => loadFields(m, config)}
                />
              ))}
            </View>
          )}
        </View>

        {/* Fields */}
        <View style={{ gap: 8 }}>
          <Text style={styles.title}>Fields</Text>
          <Text style={styles.subtitle}>
            Each field of「{config.modelName || "—"}」gets a marker template.
            Leave a field empty to skip it.
          </Text>
          {loadingFields ? (
            <ActivityIndicator size='small' color='#888' />
          ) : null}
          {fieldNames.map((name, i) => (
            <View key={name} style={{ gap: 3 }}>
              <Text style={styles.fieldName}>
                {name}
                {i === 0 ? (
                  <Text style={styles.firstFieldHint}>
                    {"   "}(Anki checks duplicates against this field)
                  </Text>
                ) : null}
              </Text>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={config.fieldTemplates[name]}
                  onChangeText={(tpl) =>
                    persist({
                      ...config,
                      fieldTemplates: { ...config.fieldTemplates, [name]: tpl },
                    })
                  }
                  autoCapitalize='none'
                  autoCorrect={false}
                  placeholder='e.g. {expression} or leave empty'
                  placeholderTextColor='#666'
                />
                <Pressable
                  style={[
                    styles.markerToggle,
                    markerPickerField === name && styles.markerToggleActive,
                  ]}
                  onPress={() =>
                    setMarkerPickerField((cur) => (cur === name ? null : name))
                  }
                  hitSlop={6}
                >
                  <Text
                    style={[
                      styles.markerToggleText,
                      markerPickerField === name &&
                        styles.markerToggleTextActive,
                    ]}
                  >
                    {"{…}"}
                  </Text>
                </Pressable>
              </View>
              {markerPickerField === name ? (
                <View style={styles.chipWrap}>
                  {insertableMarkers.map((marker) => (
                    <Pressable
                      key={marker}
                      style={styles.markerChip}
                      onPress={() =>
                        persist({
                          ...config,
                          fieldTemplates: {
                            ...config.fieldTemplates,
                            [name]:
                              (config.fieldTemplates[name] ?? "") + marker,
                          },
                        })
                      }
                    >
                      <Text style={styles.markerChipText}>{marker}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          ))}
        </View>

        {/* Tags + duplicates */}
        <View style={{ gap: 8 }}>
          <Text style={styles.title}>Tags</Text>
          <TextInput
            style={styles.input}
            value={tagsText}
            onChangeText={(text) => {
              setTagsText(text);
              persist({
                ...config,
                tags: text
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              });
            }}
            autoCapitalize='none'
            autoCorrect={false}
            placeholder='yomifin, mining'
            placeholderTextColor='#666'
          />
        </View>
        <Row
          title='Allow duplicates'
          subtitle='Add the card even if the deck already has a note with the same first field.'
        >
          <Switch
            value={config.allowDuplicate}
            onValueChange={(v) => persist({ ...config, allowDuplicate: v })}
          />
        </Row>

        {/* Word audio sources */}
        <View style={{ gap: 8 }}>
          <Text style={styles.title}>Word audio ({"{audio}"})</Text>
          <Text style={styles.subtitle}>
            Sources are tried in order until one has audio for the word.
          </Text>
          <Row title='JapanesePod101'>
            <Switch
              value={sourceOf("jpod101")?.enabled ?? false}
              onValueChange={(v) => setSource("jpod101", { enabled: v })}
            />
          </Row>
          <Row title='Jisho.org'>
            <Switch
              value={sourceOf("jisho")?.enabled ?? false}
              onValueChange={(v) => setSource("jisho", { enabled: v })}
            />
          </Row>
          <Row
            title='Custom URL'
            subtitle='Template with {term} / {reading}. May return audio directly or Yomitan-style audioSourceList JSON.'
          >
            <Switch
              value={sourceOf("custom")?.enabled ?? false}
              onValueChange={(v) => setSource("custom", { enabled: v })}
            />
          </Row>
          <TextInput
            style={styles.input}
            value={sourceOf("custom")?.url ?? ""}
            onChangeText={(url) => setSource("custom", { url })}
            autoCapitalize='none'
            autoCorrect={false}
            keyboardType='url'
            placeholder='https://example.com/audio?kanji={term}&kana={reading}'
            placeholderTextColor='#666'
          />
        </View>

        {/* Marker reference */}
        <View style={{ gap: 6 }}>
          <Text style={styles.title}>Markers</Text>
          {MARKER_HELP.map(([marker, desc]) => (
            <View key={marker} style={{ flexDirection: "row", gap: 8 }}>
              <Text style={styles.marker}>{marker}</Text>
              <Text style={[styles.subtitle, { flex: 1 }]}>{desc}</Text>
            </View>
          ))}
          <Text style={[styles.subtitle, { marginTop: 4 }]}>
            Unknown markers are left as-is on the card so typos are visible.
          </Text>
        </View>

        {/* Reset */}
        <Pressable
          style={styles.resetBtn}
          onPress={() => {
            persist(DEFAULT_ANKI_CONFIG);
            setTagsText(DEFAULT_ANKI_CONFIG.tags.join(", "));
            toast.success("Anki settings reset to defaults");
          }}
        >
          <Text style={styles.resetBtnText}>Reset to defaults</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Row({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {children}
    </View>
  );
}

const styles = {
  title: { color: "#fff", fontSize: 16, fontWeight: "700" as const },
  subtitle: { color: "#888", fontSize: 13, lineHeight: 18, marginTop: 2 },
  input: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#fff",
    fontSize: 14,
  },
  button: {
    backgroundColor: "#6cb6ff",
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    minWidth: 90,
  },
  buttonText: { color: "#001", fontWeight: "700" as const, fontSize: 14 },
  chipWrap: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 8,
  },
  chip: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipActive: { backgroundColor: "#6cb6ff" },
  chipText: { color: "#ddd", fontSize: 13 },
  chipTextActive: { color: "#001", fontWeight: "700" as const },
  markerToggle: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 10,
    paddingHorizontal: 12,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  markerToggleActive: { backgroundColor: "#6cb6ff" },
  markerToggleText: {
    color: "#6cb6ff",
    fontSize: 14,
    fontWeight: "700" as const,
  },
  markerToggleTextActive: { color: "#001" },
  markerChip: {
    backgroundColor: "rgba(108,182,255,0.12)",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  markerChipText: {
    color: "#6cb6ff",
    fontSize: 12,
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
  },
  fieldName: { color: "#bbb", fontSize: 13, fontWeight: "600" as const },
  firstFieldHint: { color: "#777", fontSize: 12, fontWeight: "400" as const },
  marker: {
    color: "#6cb6ff",
    fontSize: 13,
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
  },
  resetBtn: {
    alignSelf: "flex-start" as const,
    backgroundColor: "rgba(255,80,80,0.15)",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  resetBtnText: { color: "#ff8080", fontSize: 14, fontWeight: "600" as const },
};
