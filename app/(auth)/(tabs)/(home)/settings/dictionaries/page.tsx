/*
 * Yomifin dictionary management.
 *
 * Add dictionaries two ways:
 *   - Import a Yomitan .zip (the same file you feed Yomitan): chunked on-device build
 *     into SQLite with a progress bar. Slow once per dictionary; instant forever after.
 *   - Import a prebuilt .db (from scripts/build-dictionary-db.ts): a fast file copy —
 *     ideal for the debug loop / restoring after an app uninstall.
 *
 * The combined db lives in the app's Documents container, so it survives normal app
 * rebuilds (no re-import while iterating).
 */
import * as DocumentPicker from "expo-document-picker";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  deleteAllDictionaries,
  type InstalledDictionary,
  importDictionaryZip,
  importPrebuiltDb,
  listInstalledDictionaries,
  removeDictionary,
} from "@/utils/yomifin/dictionaryStore";
import { resetInstalledDictionaryCache } from "@/utils/yomifin/loadInstalledDictionary";

export default function DictionariesPage() {
  const insets = useSafeAreaInsets();
  const [installed, setInstalled] = useState<InstalledDictionary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    pct: number;
    terms: number;
  } | null>(null);

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

  const importZip = useCallback(async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      setBusy("Importing dictionary…");
      setProgress({ pct: 0, terms: 0 });
      const result = await importDictionaryZip(asset.uri, (p) => {
        setProgress({
          pct: Math.round((p.bank / p.totalBanks) * 100),
          terms: p.terms,
        });
      });
      Alert.alert(
        "Dictionary imported",
        `${result.title}: ${result.termCount.toLocaleString()} terms.`,
      );
      refresh();
    } catch (e) {
      console.error("[YOMIFIN] zip import failed:", e);
      Alert.alert("Import failed", String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }, [refresh]);

  const importDb = useCallback(async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      setBusy("Copying database…");
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

  return (
    <ScrollView
      contentInsetAdjustmentBehavior='automatic'
      contentContainerStyle={{
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
    >
      <View
        className='p-4 flex flex-col'
        style={{ paddingTop: Platform.OS === "android" ? 10 : 0, gap: 16 }}
      >
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

        <View style={{ gap: 8 }}>
          <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>
            Installed dictionaries
          </Text>
          {installed.length === 0 ? (
            <Text style={{ color: "#888" }}>
              None yet. Import a Yomitan .zip or a prebuilt .db below.
            </Text>
          ) : (
            installed.map((d) => (
              <View
                key={d.title}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  backgroundColor: "rgba(255,255,255,0.06)",
                  borderRadius: 10,
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                }}
              >
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={{ color: "#fff", fontWeight: "600" }}>
                    {d.title}
                  </Text>
                  <Text style={{ color: "#888", fontSize: 12 }}>
                    {d.termCount.toLocaleString()} terms
                  </Text>
                </View>
                <Pressable
                  onPress={() => confirmRemove(d.title)}
                  disabled={!!busy}
                >
                  <Text style={{ color: "#ff6b6b", fontWeight: "600" }}>
                    Remove
                  </Text>
                </Pressable>
              </View>
            ))
          )}
        </View>

        <View style={{ gap: 10 }}>
          <Button
            label='Import dictionary (.zip)'
            onPress={importZip}
            disabled={!!busy}
          />
          <Button
            label='Import prebuilt database (.db)'
            onPress={importDb}
            disabled={!!busy}
          />
          {installed.length > 0 ? (
            <Button
              label='Delete all'
              onPress={confirmDeleteAll}
              disabled={!!busy}
              destructive
            />
          ) : null}
        </View>

        <Text style={{ color: "#666", fontSize: 12, lineHeight: 18 }}>
          The .zip is the same file you import into Yomitan. A prebuilt .db
          (built with scripts/build-dictionary-db.ts) imports in seconds and is
          best for restoring after reinstalling the app. Dictionaries persist
          across normal app rebuilds.
        </Text>
      </View>
    </ScrollView>
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
