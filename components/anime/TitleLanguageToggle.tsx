/*
 * Compact Romaji / English / Native title-language switch (AniList-style), wired
 * straight to Settings.anilistTitleLanguage so every anime surface (shelves,
 * grid, detail) reflects the choice immediately. jimaku search is unaffected — it
 * always uses the romaji/native title (see jimakuTitle).
 */
import { Pressable, View } from "react-native";
import { Text } from "@/components/common/Text";
import type { TitleLanguage } from "@/utils/anilist/client";
import { useSettings } from "@/utils/atoms/settings";

const OPTIONS: { value: TitleLanguage; label: string }[] = [
  { value: "romaji", label: "Romaji" },
  { value: "english", label: "English" },
  { value: "native", label: "日本語" },
];

export default function TitleLanguageToggle() {
  const { settings, updateSettings } = useSettings();
  const value = settings?.anilistTitleLanguage ?? "romaji";

  return (
    <View className='flex-row items-center bg-neutral-900 rounded-full p-0.5 self-start'>
      {OPTIONS.map((o) => {
        const active = value === o.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => updateSettings({ anilistTitleLanguage: o.value })}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 5,
              borderRadius: 999,
              backgroundColor: active ? "#9334E9" : "transparent",
            }}
          >
            <Text
              style={{
                color: active ? "white" : "#999",
                fontSize: 12,
                fontWeight: active ? "700" : "500",
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
