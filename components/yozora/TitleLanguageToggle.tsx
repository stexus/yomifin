/*
 * Compact Romaji / English / Native title-language switch, wired to
 * Settings.anilistTitleLanguage (same key the old anime tab used — Phase 4
 * may rename it) so every Yozora surface reflects the choice immediately.
 * jimaku search is unaffected — it always uses the romaji/native title.
 */
import { Pressable, View } from "react-native";
import { Text } from "@/components/common/Text";
import { useSettings } from "@/utils/atoms/settings";
import type { TitleLanguage } from "@/utils/yozora/display";

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
