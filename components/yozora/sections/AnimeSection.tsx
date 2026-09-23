/*
 * Anime section — the old AniList-style tab near-verbatim, rewired to
 * GET /discover/anime: a PERSISTENT top bar (search + Filter + title toggle)
 * stays pinned; below is either the Discover shelves (default; CW rail first)
 * or, the moment a search/filter/"See all" is active, an inline
 * infinite-scroll grid that swaps in place.
 */
import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/common/Text";
import type { YozoraClient } from "@/utils/yozora/api";
import type { TitleLanguage } from "@/utils/yozora/display";
import {
  type AnimeFilters,
  animeFilterSummary,
  hasActiveAnimeFilters,
  toAnimeQuery,
} from "@/utils/yozora/filters";
import type { AnimeDiscoverSort } from "@/utils/yozora/types";
import AnimeFilterModal from "../AnimeFilterModal";
import BrowseGrid from "../BrowseGrid";
import ContinueWatchingRail from "../ContinueWatchingRail";
import ShelfRail from "../ShelfRail";
import TitleLanguageToggle from "../TitleLanguageToggle";

const SHELF_PRESETS: {
  key: string;
  title: string;
  sort: AnimeDiscoverSort;
}[] = [
  { key: "anime-trending", title: "Trending Now", sort: "trending" },
  { key: "anime-popular", title: "All-Time Popular", sort: "popularity" },
  { key: "anime-rating", title: "Top Rated", sort: "rating" },
  { key: "anime-airing", title: "Airing Schedule", sort: "airing" },
];

interface Props {
  client: YozoraClient;
  titleLanguage: TitleLanguage;
}

export default function AnimeSection({ client, titleLanguage }: Props) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  // null → Discover shelves; non-null → inline filter grid.
  const [browse, setBrowse] = useState<AnimeFilters | null>(null);

  const submitSearch = () => {
    const q = query.trim();
    setBrowse((prev) => {
      const base = prev ?? {};
      if (!q) {
        const next = { ...base, q: undefined };
        return hasActiveAnimeFilters(next) ? next : null;
      }
      return { ...base, q };
    });
  };

  const clearSearch = () => {
    setQuery("");
    setBrowse((prev) => {
      if (!prev) return null;
      const next = { ...prev, q: undefined };
      return hasActiveAnimeFilters(next) ? next : null;
    });
  };

  const backToDiscover = () => {
    setQuery("");
    setBrowse(null);
  };

  const activeFilters = browse ?? {};
  const gridKey = useMemo(
    () => (browse ? `anime:${JSON.stringify(toAnimeQuery(browse, 0))}` : ""),
    [browse],
  );

  return (
    <View className='flex-1'>
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
        <BrowseGrid
          gridKey={gridKey}
          fetchPage={(page) => client.discoverAnime(toAnimeQuery(browse, page))}
          titleLanguage={titleLanguage}
          summary={animeFilterSummary(browse)}
          emptyText='No anime match these filters.'
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
          <ContinueWatchingRail client={client} titleLanguage={titleLanguage} />
          {SHELF_PRESETS.map((p) => (
            <ShelfRail
              key={p.key}
              railKey={p.key}
              title={p.title}
              fetchItems={() =>
                client.discoverAnime({ sort: p.sort }).then((r) => r.items)
              }
              titleLanguage={titleLanguage}
              onSeeAll={() => setBrowse({ sort: p.sort })}
              hideWhenEmpty={false}
            />
          ))}
        </ScrollView>
      )}

      <AnimeFilterModal
        visible={filterOpen}
        initial={activeFilters}
        onApply={(f) => {
          setFilterOpen(false);
          setQuery(f.q ?? "");
          setBrowse(hasActiveAnimeFilters(f) || f.sort ? f : null);
        }}
        onClose={() => setFilterOpen(false)}
      />
    </View>
  );
}
