/*
 * The Yozora tab (docs/yomifin/YOZORA_MIGRATION_PLAN.md Phase 2): the whole
 * on-demand streaming client as ONE tab. A pinned section chip row
 * (Home · Anime · Movies · Shows · Library) swaps the body in place — the
 * same pattern as the old anime tab's pinned bar, NOT nested native tabs.
 * Default = Home; chip choice is plain session state (no persistence).
 * Every section requires a connected Yozora session (DisconnectedGate).
 */
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import DisconnectedGate from "@/components/yozora/DisconnectedGate";
import { Chip } from "@/components/yozora/FilterChips";
import AnimeSection from "@/components/yozora/sections/AnimeSection";
import HomeSection from "@/components/yozora/sections/HomeSection";
import LibrarySection from "@/components/yozora/sections/LibrarySection";
import {
  SECTIONS,
  type YozoraSection,
} from "@/components/yozora/sections/sections";
import TmdbSection from "@/components/yozora/sections/TmdbSection";
import { useSettings } from "@/utils/atoms/settings";
import { useYozora } from "@/utils/yozora/session";

export default function YozoraHome() {
  const insets = useSafeAreaInsets();
  const { settings } = useSettings();
  const { client } = useYozora();
  const titleLanguage = settings?.anilistTitleLanguage ?? "romaji";
  const [section, setSection] = useState<YozoraSection>("home");

  return (
    <View className='flex-1 bg-black' style={{ paddingTop: insets.top + 52 }}>
      <DisconnectedGate>
        {/* Pinned section chip row */}
        <View className='pb-2'>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16 }}
          >
            {SECTIONS.map((s) => (
              <Chip
                key={s.key}
                label={s.label}
                active={section === s.key}
                onPress={() => setSection(s.key)}
              />
            ))}
          </ScrollView>
        </View>

        {section === "home" ? (
          <HomeSection
            client={client}
            titleLanguage={titleLanguage}
            onGoToSection={setSection}
          />
        ) : section === "anime" ? (
          <AnimeSection client={client} titleLanguage={titleLanguage} />
        ) : section === "movies" ? (
          <TmdbSection
            kind='movies'
            client={client}
            titleLanguage={titleLanguage}
          />
        ) : section === "shows" ? (
          <TmdbSection
            kind='shows'
            client={client}
            titleLanguage={titleLanguage}
          />
        ) : (
          <LibrarySection client={client} titleLanguage={titleLanguage} />
        )}
      </DisconnectedGate>
    </View>
  );
}
