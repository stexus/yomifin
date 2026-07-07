/*
 * AniList discovery tab — AniList-style single screen. A PERSISTENT top bar
 * (search + Filter button + title toggle) stays pinned; the area below is either
 * the Discover shelves (default) or, the moment a search/filter/"See all" is
 * active, an inline infinite-scroll results grid that swaps in place. No separate
 * "browse" screen. Playback still routes through the detail screen → Stremio
 * debrid + yomifin pipeline.
 */
import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AnimeBrowseGrid from "@/components/anime/AnimeBrowseGrid";
import AnimeFilterModal from "@/components/anime/AnimeFilterModal";
import AnimeShelf from "@/components/anime/AnimeShelf";
import TitleLanguageToggle from "@/components/anime/TitleLanguageToggle";
import { Text } from "@/components/common/Text";
import { type BrowseFilters, shelfPresets } from "@/utils/anilist/client";
import { useSettings } from "@/utils/atoms/settings";

const DEFAULT_FILTERS: BrowseFilters = { sort: ["POPULARITY_DESC"] };

/** True when anything narrows the results (→ show grid instead of shelves). */
function hasActiveFilters(f: BrowseFilters): boolean {
  return Boolean(
    f.search?.trim() ||
      f.season ||
      f.seasonYear ||
      f.yearFrom ||
      f.yearTo ||
      f.status ||
      f.genres?.length ||
      f.tags?.length ||
      f.formats?.length,
  );
}

export default function AnimeHome() {
  const insets = useSafeAreaInsets();
  const { settings } = useSettings();
  const titleLanguage = settings?.anilistTitleLanguage ?? "romaji";
  const presets = useMemo(() => shelfPresets(), []);

  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  // null → Discover shelves; non-null → inline filter grid.
  const [browse, setBrowse] = useState<BrowseFilters | null>(null);

  const submitSearch = () => {
    const q = query.trim();
    setBrowse((prev) => {
      const base = prev ?? {};
      if (!q) {
        const next = { ...base, search: undefined, sort: ["POPULARITY_DESC"] };
        return hasActiveFilters(next) ? next : null;
      }
      return { ...base, search: q, sort: ["SEARCH_MATCH"] };
    });
  };

  const clearSearch = () => {
    setQuery("");
    setBrowse((prev) => {
      if (!prev) return null;
      const next = { ...prev, search: undefined, sort: ["POPULARITY_DESC"] };
      return hasActiveFilters(next) ? next : null;
    });
  };

  const backToDiscover = () => {
    setQuery("");
    setBrowse(null);
  };

  const activeFilters = browse ?? DEFAULT_FILTERS;

  return (
    <View className='flex-1 bg-black' style={{ paddingTop: insets.top + 52 }}>
      {/* Persistent bar: search + Filter + title language */}
      <View className='px-4 pb-3'>
        <View className='flex-row items-center'>
          <View className='flex-1 flex-row items-center bg-neutral-900 rounded-xl px-3 mr-2'>
            <Ionicons name='search' size={16} color='#888' />
            <TextInput
              className='flex-1 text-white px-2 py-2.5 text-sm'
              placeholder='Search anime…'
              placeholderTextColor='#777'
              autoCapitalize='none'
              autoCorrect={false}
              returnKeyType='search'
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={submitSearch}
            />
            {query.length > 0 ? (
              <Pressable onPress={clearSearch} hitSlop={8}>
                <Ionicons name='close-circle' size={16} color='#666' />
              </Pressable>
            ) : null}
          </View>
          <Pressable
            className='bg-neutral-900 rounded-xl px-3 py-2.5 flex-row items-center'
            onPress={() => setFilterOpen(true)}
          >
            <Ionicons name='filter' size={18} color='#c084fc' />
            <Text className='text-purple-300 text-sm ml-1'>Filter</Text>
          </Pressable>
        </View>

        <View className='flex-row items-center justify-between mt-3'>
          {browse ? (
            <Pressable
              className='flex-row items-center'
              onPress={backToDiscover}
              hitSlop={8}
            >
              <Ionicons name='chevron-back' size={16} color='#c084fc' />
              <Text className='text-purple-300 text-sm ml-0.5'>Discover</Text>
            </Pressable>
          ) : (
            <Text className='text-neutral-500 text-xs'>Titles</Text>
          )}
          <TitleLanguageToggle />
        </View>
      </View>

      {browse ? (
        <AnimeBrowseGrid
          filters={activeFilters}
          titleLanguage={titleLanguage}
        />
      ) : (
        <ScrollView
          className='flex-1'
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: insets.bottom + 96,
          }}
          keyboardShouldPersistTaps='handled'
        >
          {presets.map((p) => (
            <AnimeShelf
              key={p.key}
              shelfKey={p.key}
              title={p.title}
              filters={p.filters}
              titleLanguage={titleLanguage}
              onSeeAll={() => setBrowse(p.filters)}
            />
          ))}
        </ScrollView>
      )}

      <AnimeFilterModal
        visible={filterOpen}
        initial={activeFilters}
        onApply={(f) => {
          setFilterOpen(false);
          setQuery(f.search ?? "");
          setBrowse(f);
        }}
        onClose={() => setFilterOpen(false)}
      />
    </View>
  );
}
