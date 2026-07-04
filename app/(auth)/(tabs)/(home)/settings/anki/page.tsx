/*
 * Yomifin "Anki" settings — Phase 8 runtime card configuration.
 *
 * Kills the hardcoded field map: connect to AnkiConnect, pick deck + note type from
 * the server's real lists (deckNames / modelNames), see the note type's REAL fields
 * (modelFieldNames), and assign each field a Yomitan-style MARKER TEMPLATE. Templates
 * are rendered at card time by utils/yomifin/markers.ts.
 *
 * Profiles: the config is PER-PROFILE (JA/ZH — utils/yomifin/profiles.ts); the
 * segmented control at the top switches the active profile and reloads its config.
 * Persists to Settings.yomifinProfiles[profile].ankiConfig; getAnkiConfig(profile)
 * reads it (JA falls back to the legacy yomifinAnkiConfig key) and defaults per-key.
 */
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
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
import {
  applyAnkiSettingsImport,
  parseAnkiSettingsExport,
  serializeAnkiSettings,
} from "@/utils/yomifin/ankiSettingsTransfer";
import { listInstalledDictionaries } from "@/utils/yomifin/dictionaryStore";
import {
  activeProfileId,
  PROFILE_IDS,
  PROFILE_LABELS,
  titlesForProfile,
  withProfileData,
} from "@/utils/yomifin/profiles";
import {
  defaultWordAudioSources,
  mergeWordAudioSources,
  type WordAudioSourceConfig,
} from "@/utils/yomifin/wordAudioSources";

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
  [
    "{audio}",
    "word audio (jpod101 / jisho / Wiktionary recordings / Azure TTS / custom URL)",
  ],
  ["{sentence-audio}", "audio clip spanning the selected line(s)"],
  ["{picture}", "captured video frame"],
];

export default function AnkiSettingsPage() {
  const insets = useSafeAreaInsets();
  const { settings, updateSettings } = useSettings();
  const profileId = activeProfileId(settings);

  // Local working copy; every change persists immediately (like the other pages).
  const [config, setConfig] = useState<AnkiConfig>(() =>
    getAnkiConfig(profileId),
  );
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
  // dictionary OF THIS PROFILE (so the user never types a dictionary title by hand).
  const insertableMarkers = useMemo(() => {
    const base = MARKER_HELP.map(([m]) => m).filter(
      (m) => m !== "{single-glossary:DICT}",
    );
    let dicts: string[] = [];
    try {
      dicts = titlesForProfile(
        listInstalledDictionaries().map((d) => d.title),
        settings.yomifinDictionaryLanguages ?? {},
        profileId,
      ).map((t) => `{single-glossary:${t}}`);
    } catch {
      // no dictionary db yet — fine, just omit
    }
    return [...base, ...dicts];
  }, [profileId, settings.yomifinDictionaryLanguages]);

  const persist = useCallback(
    (next: AnkiConfig) => {
      setConfig(next);
      updateSettings({
        yomifinProfiles: withProfileData(settings.yomifinProfiles, profileId, {
          ankiConfig: next,
        }),
      });
    },
    [updateSettings, settings.yomifinProfiles, profileId],
  );

  // Switching profile reloads that profile's stored config and drops the
  // connection-derived lists (the other profile may target another deck/server).
  const switchProfile = useCallback(
    (pid: (typeof PROFILE_IDS)[number]) => {
      if (pid === profileId) return;
      updateSettings({ yomifinActiveProfile: pid });
      const next = getAnkiConfig(pid);
      setConfig(next);
      setTagsText(next.tags.join(", "));
      setConnected(false);
      setDecks([]);
      setModels([]);
      setMarkerPickerField(null);
    },
    [profileId, updateSettings],
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
    // getAnkiConfig() already merges missing source types in, but be defensive:
    // append (from the profile's defaults) if the stored list predates this type.
    const exists = config.wordAudioSources.some((s) => s.type === type);
    const sources = exists
      ? config.wordAudioSources.map((s) =>
          s.type === type ? { ...s, ...patch } : s,
        )
      : [
          ...config.wordAudioSources,
          {
            ...(defaultWordAudioSources(profileId).find(
              (d) => d.type === type,
            ) ?? { type, enabled: false }),
            ...patch,
          },
        ];
    persist({ ...config, wordAudioSources: sources });
  };
  const sourceOf = (type: WordAudioSourceConfig["type"]) =>
    config.wordAudioSources.find((s) => s.type === type);

  // --- Backup: export / import ALL profiles' Anki settings as JSON ------------------
  const exportSettings = useCallback(async () => {
    try {
      const json = serializeAnkiSettings(settings);
      const f = new File(Paths.cache, "yomifin-anki-settings.json");
      if (f.exists) f.delete();
      f.write(json);
      await Sharing.shareAsync(f.uri, {
        mimeType: "application/json",
        dialogTitle: "Export Anki settings",
      });
    } catch (e) {
      toast.error((e as Error)?.message || "Export failed");
    }
  }, [settings]);

  const importSettings = useCallback(async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const text = await new File(res.assets[0].uri).text();
      const imported = parseAnkiSettingsExport(text);
      updateSettings({
        yomifinProfiles: applyAnkiSettingsImport(
          settings.yomifinProfiles,
          imported,
        ),
      });
      // Refresh the visible working copy from the imported data (getAnkiConfig
      // semantics: default per-key, merge word-audio sources).
      const mine = imported[profileId];
      if (mine) {
        const next: AnkiConfig = {
          ...DEFAULT_ANKI_CONFIG,
          ...mine,
          fieldTemplates:
            mine.fieldTemplates ?? DEFAULT_ANKI_CONFIG.fieldTemplates,
          tags: mine.tags ?? DEFAULT_ANKI_CONFIG.tags,
          wordAudioSources: mergeWordAudioSources(
            mine.wordAudioSources,
            defaultWordAudioSources(profileId),
          ),
        };
        setConfig(next);
        setTagsText(next.tags.join(", "));
        setConnected(false);
        setDecks([]);
        setModels([]);
      }
      toast.success(
        `Imported Anki settings (${Object.keys(imported)
          .map((id) => id.toUpperCase())
          .join(", ")})`,
      );
    } catch (e) {
      toast.error((e as Error)?.message || "Import failed");
    }
  }, [settings.yomifinProfiles, profileId, updateSettings]);

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
        {/* Profile */}
        <View style={{ gap: 8 }}>
          <Text style={styles.title}>Profile</Text>
          <Text style={styles.subtitle}>
            Deck, note type, field templates and word-audio sources below belong
            to this profile. The player auto-switches profile from the playing
            track's language.
          </Text>
          <View style={styles.chipWrap}>
            {PROFILE_IDS.map((pid) => (
              <Chip
                key={pid}
                label={PROFILE_LABELS[pid]}
                active={pid === profileId}
                onPress={() => switchProfile(pid)}
              />
            ))}
          </View>
        </View>

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
        <Row
          title='HTML glossary'
          subtitle='Ship Yomitan-style rendered HTML for {glossary}, {single-glossary:…} and {popup-selection-text} (lists, ruby, styling) instead of plain text.'
        >
          <Switch
            value={config.htmlGlossary}
            onValueChange={(v) => persist({ ...config, htmlGlossary: v })}
          />
        </Row>

        {/* Word audio sources */}
        <View style={{ gap: 8 }}>
          <Text style={styles.title}>Word audio ({"{audio}"})</Text>
          <Text style={styles.subtitle}>
            Sources are tried in order until one has audio for the word. Azure
            TTS is tried last — synthesized audio only when no recording exists.
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
            title='Wiktionary (Wikimedia Commons)'
            subtitle={`Recorded pronunciations (${sourceOf("wiktionary")?.lang ?? profileId}-….ogg files). The main Chinese source.`}
          >
            <Switch
              value={sourceOf("wiktionary")?.enabled ?? false}
              onValueChange={(v) => setSource("wiktionary", { enabled: v })}
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
          <Row
            title='Azure TTS'
            subtitle='Synthesized fallback via Azure Speech (needs a Speech resource: region + key + voice). Always tried after the recorded sources.'
          >
            <Switch
              value={sourceOf("azure-tts")?.enabled ?? false}
              onValueChange={(v) => setSource("azure-tts", { enabled: v })}
            />
          </Row>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={sourceOf("azure-tts")?.region ?? ""}
              onChangeText={(region) => setSource("azure-tts", { region })}
              autoCapitalize='none'
              autoCorrect={false}
              placeholder='region (e.g. eastasia)'
              placeholderTextColor='#666'
            />
            <TextInput
              style={[styles.input, { flex: 2 }]}
              value={sourceOf("azure-tts")?.voice ?? ""}
              onChangeText={(voice) => setSource("azure-tts", { voice })}
              autoCapitalize='none'
              autoCorrect={false}
              placeholder='voice (e.g. zh-CN-XiaoxiaoNeural)'
              placeholderTextColor='#666'
            />
          </View>
          <TextInput
            style={styles.input}
            value={sourceOf("azure-tts")?.key ?? ""}
            onChangeText={(key) => setSource("azure-tts", { key })}
            autoCapitalize='none'
            autoCorrect={false}
            secureTextEntry
            placeholder='Azure Speech resource key'
            placeholderTextColor='#666'
          />
        </View>

        {/* Backup — export/import EVERY profile's Anki settings as JSON. */}
        <View style={{ gap: 8 }}>
          <Text style={styles.title}>Backup</Text>
          <Text style={styles.subtitle}>
            Export all profiles' Anki settings (server, deck, note type, field
            templates, word-audio sources) as a JSON file — import it on another
            install to clone this setup.
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              style={[styles.button, { paddingVertical: 10 }]}
              onPress={exportSettings}
            >
              <Text style={styles.buttonText}>Export</Text>
            </Pressable>
            <Pressable
              style={[styles.button, { paddingVertical: 10 }]}
              onPress={importSettings}
            >
              <Text style={styles.buttonText}>Import</Text>
            </Pressable>
          </View>
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
            // Word-audio defaults are per-language (ZH leads with Wiktionary).
            const next = {
              ...DEFAULT_ANKI_CONFIG,
              wordAudioSources: defaultWordAudioSources(profileId),
            };
            persist(next);
            setTagsText(next.tags.join(", "));
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
