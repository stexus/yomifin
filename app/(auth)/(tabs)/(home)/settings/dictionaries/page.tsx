/*
 * Yomifin dictionary management.
 *
 * Add dictionaries two ways:
 *   - Import a Yomitan .zip (the same file you feed Yomitan): chunked on-device build
 *     into SQLite with a progress bar. Slow once per dictionary; instant forever after.
 *   - Import a prebuilt .db (from scripts/build-dictionary-db.ts): a fast file copy —
 *     ideal for the debug loop / restoring after an app uninstall.
 *
 * Profiles: preferences are PER-PROFILE (JA/ZH — utils/yomifin/profiles.ts). The
 * segmented control at the top switches the active profile; the inventory (installed
 * dictionaries) is shared, but enable/order/tint apply to the profile being edited.
 * JA reads through to the legacy `yomifinDictionaryConfig` key until first edited.
 *
 * Phase 7 — per-dictionary configuration (persisted per profile, keyed by title):
 *   - enable/disable  → disabled dicts are excluded from lookups
 *   - priority order  → drag to reorder; definition blocks in the popup follow this
 *   - tint            → per-dict accent color (tap the swatch to cycle the palette)
 * The SQLite `dictionaries` table remains the pure inventory; preferences live in
 * settings. Lookup stays one indexed query regardless of how many are enabled.
 */
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  Switch,
  Text,
  View,
} from "react-native";
import DraggableFlatList, {
  type RenderItemParams,
  ScaleDecorator,
} from "react-native-draggable-flatlist";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSettings } from "@/utils/atoms/settings";
import {
  DICTIONARY_TINT_PALETTE,
  materializeConfig,
  type ResolvedDictionary,
  resolveDictionaryConfig,
} from "@/utils/yomifin/dictionaryConfig";
import {
  deleteAllDictionaries,
  type InstalledDictionary,
  importDictionaryZip,
  importPrebuiltDb,
  listInstalledDictionaries,
  removeDictionary,
} from "@/utils/yomifin/dictionaryStore";
import { resetInstalledDictionaryCache } from "@/utils/yomifin/loadInstalledDictionary";
import {
  activeProfileId,
  PROFILE_IDS,
  PROFILE_LABELS,
  resolveProfile,
  titlesForProfile,
  withProfileData,
} from "@/utils/yomifin/profiles";

interface DictRow extends ResolvedDictionary {
  termCount: number;
}

export default function DictionariesPage() {
  const insets = useSafeAreaInsets();
  const { settings, updateSettings } = useSettings();
  const [installed, setInstalled] = useState<InstalledDictionary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    pct: number;
    terms: number;
    /** which file of how many, when importing several at once */
    file?: number;
    totalFiles?: number;
  } | null>(null);

  const profileId = activeProfileId(settings);
  const otherProfile = profileId === "ja" ? "zh" : "ja";
  const config = resolveProfile(settings, profileId).dictionaryConfig;
  // Dictionary → profile membership (unmapped = ja). Only the active profile's
  // dictionaries are listed — the rest live under the other profile's tab.
  const dictLanguages = settings.yomifinDictionaryLanguages ?? {};

  const rows = useMemo<DictRow[]>(() => {
    const mine = titlesForProfile(
      installed.map((d) => d.title),
      dictLanguages,
      profileId,
    );
    const resolved = resolveDictionaryConfig(mine, config);
    return resolved.map((r) => ({
      ...r,
      termCount: installed.find((d) => d.title === r.title)?.termCount ?? 0,
    }));
  }, [
    installed,
    JSON.stringify(config),
    JSON.stringify(dictLanguages),
    profileId,
  ]);

  const hiddenCount = installed.length - rows.length;

  // Move a dictionary to the other profile (it disappears from this list and shows
  // up under the other profile's tab).
  const moveToOtherProfile = useCallback(
    (title: string) => {
      updateSettings({
        yomifinDictionaryLanguages: {
          ...(settings.yomifinDictionaryLanguages ?? {}),
          [title]: otherProfile,
        },
      });
      resetInstalledDictionaryCache();
    },
    [updateSettings, settings.yomifinDictionaryLanguages, otherProfile],
  );

  const refresh = useCallback(() => {
    try {
      setInstalled(listInstalledDictionaries());
    } catch (e) {
      console.error("[YOMIFIN] list dictionaries failed:", e);
    }
    resetInstalledDictionaryCache();
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const commit = useCallback(
    (next: ResolvedDictionary[]) => {
      updateSettings({
        yomifinProfiles: withProfileData(settings.yomifinProfiles, profileId, {
          dictionaryConfig: materializeConfig(next),
        }),
      });
      resetInstalledDictionaryCache();
    },
    [updateSettings, settings.yomifinProfiles, profileId],
  );

  const onReorder = useCallback(
    (data: DictRow[]) => {
      commit(data.map((r, i) => ({ ...r, order: i })));
    },
    [commit],
  );

  const toggleEnabled = useCallback(
    (title: string) => {
      commit(
        rows.map((r) =>
          r.title === title ? { ...r, enabled: !r.enabled } : r,
        ),
      );
    },
    [rows, commit],
  );

  const cycleTint = useCallback(
    (title: string) => {
      commit(
        rows.map((r) => {
          if (r.title !== title) return r;
          const idx = DICTIONARY_TINT_PALETTE.indexOf(r.tint);
          const next =
            DICTIONARY_TINT_PALETTE[(idx + 1) % DICTIONARY_TINT_PALETTE.length];
          return { ...r, tint: next };
        }),
      );
    },
    [rows, commit],
  );

  const importZip = useCallback(async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (res.canceled || !res.assets?.length) return;
      const assets = res.assets;
      const imported: string[] = [];
      const failed: string[] = [];
      // New imports belong to the profile you imported them under.
      const assignedTitles: string[] = [];
      // Keep the screen awake so a long multi-dictionary import isn't interrupted.
      await activateKeepAwakeAsync("yomifin-import");
      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        setBusy(
          assets.length > 1
            ? `Importing ${i + 1}/${assets.length}…`
            : "Importing dictionary…",
        );
        setProgress({
          pct: 0,
          terms: 0,
          file: i + 1,
          totalFiles: assets.length,
        });
        try {
          const result = await importDictionaryZip(asset.uri, (p) => {
            setProgress({
              pct: Math.round((p.bank / p.totalBanks) * 100),
              terms: p.terms,
              file: i + 1,
              totalFiles: assets.length,
            });
          });
          imported.push(
            `${result.title} (${result.termCount.toLocaleString()} terms)`,
          );
          assignedTitles.push(result.title);
        } catch (e) {
          console.error("[YOMIFIN] zip import failed:", asset.name, e);
          failed.push(asset.name ?? "(unnamed)");
        }
        refresh();
      }
      if (assignedTitles.length > 0) {
        updateSettings({
          yomifinDictionaryLanguages: {
            ...(settings.yomifinDictionaryLanguages ?? {}),
            ...Object.fromEntries(assignedTitles.map((t) => [t, profileId])),
          },
        });
      }
      Alert.alert(
        failed.length === 0 ? "Dictionaries imported" : "Import finished",
        [
          imported.length ? `Imported:\n• ${imported.join("\n• ")}` : "",
          failed.length ? `Failed:\n• ${failed.join("\n• ")}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
    } catch (e) {
      console.error("[YOMIFIN] zip import failed:", e);
      Alert.alert("Import failed", String(e instanceof Error ? e.message : e));
    } finally {
      deactivateKeepAwake("yomifin-import");
      setBusy(null);
      setProgress(null);
    }
  }, [refresh, updateSettings, settings.yomifinDictionaryLanguages, profileId]);

  const importDb = useCallback(async () => {
    try {
      // Single-select on purpose: a prebuilt .db REPLACES the whole combined db
      // (it's a file copy, not a merge), so multi-select would only leave the last.
      const res = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      setBusy("Copying database…");
      await activateKeepAwakeAsync("yomifin-import");
      const list = await importPrebuiltDb(res.assets[0].uri);
      Alert.alert(
        "Database imported",
        `${list.length} dictionar${list.length === 1 ? "y" : "ies"} ready.`,
      );
      refresh();
    } catch (e) {
      console.error("[YOMIFIN] db import failed:", e);
      Alert.alert("Import failed", String(e instanceof Error ? e.message : e));
    } finally {
      deactivateKeepAwake("yomifin-import");
      setBusy(null);
    }
  }, [refresh]);

  const confirmRemove = useCallback(
    (title: string) => {
      Alert.alert("Remove dictionary", `Remove "${title}"?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            try {
              removeDictionary(title);
            } catch (e) {
              console.error("[YOMIFIN] remove failed:", e);
            }
            refresh();
          },
        },
      ]);
    },
    [refresh],
  );

  const confirmDeleteAll = useCallback(() => {
    Alert.alert(
      "Delete all dictionaries",
      "Delete the entire dictionary database?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete all",
          style: "destructive",
          onPress: () => {
            try {
              deleteAllDictionaries();
            } catch (e) {
              console.error("[YOMIFIN] delete all failed:", e);
            }
            refresh();
          },
        },
      ],
    );
  }, [refresh]);

  const renderItem = useCallback(
    ({ item, drag, isActive }: RenderItemParams<DictRow>) => (
      <ScaleDecorator>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            backgroundColor: isActive
              ? "rgba(255,255,255,0.12)"
              : "rgba(255,255,255,0.06)",
            borderRadius: 10,
            paddingVertical: 12,
            paddingHorizontal: 12,
            marginBottom: 8,
            borderLeftWidth: 4,
            borderLeftColor: item.enabled ? item.tint : "transparent",
            opacity: item.enabled ? 1 : 0.5,
          }}
        >
          <Pressable
            onPressIn={drag}
            disabled={isActive}
            hitSlop={8}
            style={{ paddingRight: 2 }}
          >
            <Ionicons name='reorder-three' size={22} color='#888' />
          </Pressable>

          {/* Tint swatch — tap to cycle the palette. */}
          <Pressable
            onPress={() => cycleTint(item.title)}
            hitSlop={8}
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              backgroundColor: item.tint,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.25)",
            }}
          />

          <View style={{ flex: 1, paddingRight: 4 }}>
            <Text style={{ color: "#fff", fontWeight: "600" }}>
              {item.title}
            </Text>
            <Text style={{ color: "#888", fontSize: 12 }}>
              {item.termCount.toLocaleString()} terms
              {item.enabled ? "" : " · disabled"}
            </Text>
          </View>

          {/* Move to the other profile (JA↔ZH) — the row leaves this list. */}
          <Pressable
            onPress={() => moveToOtherProfile(item.title)}
            disabled={!!busy}
            hitSlop={6}
            style={{
              backgroundColor: "rgba(255,255,255,0.08)",
              borderRadius: 8,
              paddingHorizontal: 8,
              paddingVertical: 5,
            }}
          >
            <Text style={{ color: "#aaa", fontSize: 11, fontWeight: "700" }}>
              → {otherProfile.toUpperCase()}
            </Text>
          </Pressable>

          <Switch
            value={item.enabled}
            onValueChange={() => toggleEnabled(item.title)}
            disabled={!!busy}
          />

          <Pressable
            onPress={() => confirmRemove(item.title)}
            disabled={!!busy}
            hitSlop={6}
          >
            <Ionicons name='trash-outline' size={20} color='#ff6b6b' />
          </Pressable>
        </View>
      </ScaleDecorator>
    ),
    [
      busy,
      cycleTint,
      toggleEnabled,
      confirmRemove,
      moveToOtherProfile,
      otherProfile,
    ],
  );

  const header = (
    <View style={{ gap: 16 }}>
      {busy ? (
        <View
          style={{
            backgroundColor: "rgba(255,255,255,0.06)",
            borderRadius: 12,
            padding: 16,
            gap: 8,
            alignItems: "center",
          }}
        >
          <ActivityIndicator color='#fff' />
          <Text style={{ color: "#fff", fontWeight: "600" }}>{busy}</Text>
          {progress ? (
            <>
              <Text style={{ color: "#bbb" }}>
                {progress.totalFiles && progress.totalFiles > 1
                  ? `File ${progress.file}/${progress.totalFiles} · `
                  : ""}
                {progress.pct}% · {progress.terms.toLocaleString()} terms
              </Text>
              <View
                style={{
                  height: 6,
                  width: "100%",
                  backgroundColor: "rgba(255,255,255,0.15)",
                  borderRadius: 3,
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    height: 6,
                    width: `${progress.pct}%`,
                    backgroundColor: "#6cb6ff",
                  }}
                />
              </View>
              <Text
                style={{ color: "#888", fontSize: 12, textAlign: "center" }}
              >
                Keep this screen open. This runs once per dictionary.
              </Text>
            </>
          ) : null}
        </View>
      ) : null}

      {/* Profile switcher — selects the ACTIVE profile app-wide; the list below edits
          that profile's enable/order/tint. */}
      <View style={{ gap: 6 }}>
        <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>
          Profile
        </Text>
        <Text style={{ color: "#888", fontSize: 12 }}>
          Enable/priority/tint below apply to this profile. The player
          auto-switches profile from the playing track's language.
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {PROFILE_IDS.map((pid) => (
            <Pressable
              key={pid}
              onPress={() => {
                updateSettings({ yomifinActiveProfile: pid });
                resetInstalledDictionaryCache();
              }}
              style={{
                backgroundColor:
                  pid === profileId ? "#6cb6ff" : "rgba(255,255,255,0.08)",
                borderRadius: 16,
                paddingHorizontal: 14,
                paddingVertical: 7,
              }}
            >
              <Text
                style={{
                  color: pid === profileId ? "#001" : "#ddd",
                  fontWeight: pid === profileId ? "700" : "400",
                  fontSize: 13,
                }}
              >
                {PROFILE_LABELS[pid]}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={{ gap: 4 }}>
        <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>
          Installed dictionaries
        </Text>
        {rows.length === 0 ? (
          <Text style={{ color: "#888" }}>
            None in this profile yet. Import a Yomitan .zip below (it joins the{" "}
            {PROFILE_LABELS[profileId]} profile)
            {hiddenCount > 0
              ? ` — ${hiddenCount} dictionar${hiddenCount === 1 ? "y is" : "ies are"} in the other profile`
              : ""}
            .
          </Text>
        ) : (
          <Text style={{ color: "#888", fontSize: 12 }}>
            Drag to set priority · toggle to enable · tap the swatch to recolor
            · → moves to the other profile
            {hiddenCount > 0 ? ` · ${hiddenCount} in the other profile` : ""}.
          </Text>
        )}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      {/* Scrollable / draggable list of installed dictionaries. */}
      <DraggableFlatList
        data={rows}
        keyExtractor={(item) => item.title}
        renderItem={renderItem}
        onDragEnd={({ data }) => onReorder(data)}
        activationDistance={12}
        contentInsetAdjustmentBehavior='automatic'
        containerStyle={{ flex: 1 }}
        ListHeaderComponent={header}
        contentContainerStyle={{
          padding: 16,
          paddingTop: Platform.OS === "android" ? 10 : 16,
          paddingLeft: 16 + insets.left,
          paddingRight: 16 + insets.right,
          gap: 8,
        }}
      />

      {/* Fixed action bar — stays put, not part of the scroll. */}
      <View
        style={{
          gap: 10,
          paddingTop: 12,
          paddingBottom: 12 + insets.bottom,
          paddingLeft: 16 + insets.left,
          paddingRight: 16 + insets.right,
          borderTopWidth: 1,
          borderTopColor: "rgba(255,255,255,0.12)",
          backgroundColor: "#0a0a0a",
        }}
      >
        <Button
          label='Import dictionaries (.zip)'
          onPress={importZip}
          disabled={!!busy}
        />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button label='Import .db' onPress={importDb} disabled={!!busy} />
          </View>
          {rows.length > 0 ? (
            <View style={{ flex: 1 }}>
              <Button
                label='Delete all'
                onPress={confirmDeleteAll}
                disabled={!!busy}
                destructive
              />
            </View>
          ) : null}
        </View>
        <Text style={{ color: "#666", fontSize: 11, lineHeight: 16 }}>
          Pick one or more Yomitan .zip files (same files you feed Yomitan). A
          prebuilt .db imports in seconds and replaces the whole set — best for
          restoring after a reinstall.
        </Text>
      </View>
    </View>
  );
}

function Button({
  label,
  onPress,
  disabled,
  destructive,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        backgroundColor: destructive ? "rgba(255,107,107,0.15)" : "#6cb6ff",
        opacity: disabled ? 0.4 : 1,
        borderRadius: 10,
        paddingVertical: 14,
        alignItems: "center",
      }}
    >
      <Text
        style={{
          color: destructive ? "#ff6b6b" : "#001",
          fontWeight: "700",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
