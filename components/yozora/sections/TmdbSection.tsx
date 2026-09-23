/*
 * Movies / Shows sections (Phase 2b): the same shelves ⇄ grid skeleton as the
 * Anime section with TMDB vocabulary (GET /discover/movies|shows, TMDB genre
 * constants). One component, parameterized by kind.
 */
import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/common/Text";
import type { YozoraClient } from "@/utils/yozora/api";
import type { TitleLanguage } from "@/utils/yozora/display";
import {
  hasActiveTmdbFilters,
  type TmdbFilters,
  tmdbFilterSummary,
  toDiscoverQuery,
} from "@/utils/yozora/filters";
import {
  type DiscoverQuery,
  type DiscoverSort,
  type Paginated,
  type TitleSummary,
  TMDB_MOVIE_GENRES,
  TMDB_TV_GENRES,
} from "@/utils/yozora/types";
import BrowseGrid from "../BrowseGrid";
import ContinueWatchingRail from "../ContinueWatchingRail";
import ShelfRail from "../ShelfRail";
import TmdbFilterModal from "../TmdbFilterModal";

const SHELF_PRESETS: { key: string; title: string; sort: DiscoverSort }[] = [
  { key: "trending", title: "Trending Now", sort: "trending" },
  { key: "popular", title: "Popular", sort: "popularity" },
  { key: "rating", title: "Top Rated", sort: "rating" },
  { key: "newest", title: "New Releases", sort: "newest" },
];

interface Props {
  kind: "movies" | "shows";
  client: YozoraClient;
  titleLanguage: TitleLanguage;
}

export default function TmdbSection({ kind, client, titleLanguage }: Props) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [browse, setBrowse] = useState<TmdbFilters | null>(null);

  const genreVocab = kind === "movies" ? TMDB_MOVIE_GENRES : TMDB_TV_GENRES;
  const discover = (q: DiscoverQuery): Promise<Paginated<TitleSummary>> =>
    kind === "movies" ? client.discoverMovies(q) : client.discoverShows(q);

  const submitSearch = () => {
    const q = query.trim();
    setBrowse((prev) => {
      if (!q) {
        const next = { ...(prev ?? {}), q: undefined };
        return hasActiveTmdbFilters(next) ? next : null;
      }
      // TMDB search ignores filters server-side — keep the model honest.
      return { q };
    });
  };

  const clearSearch = () => {
    setQuery("");
    setBrowse((prev) => {
      if (!prev) return null;
      const next = { ...prev, q: undefined };
      return hasActiveTmdbFilters(next) ? next : null;
    });
  };

  const gridKey = useMemo(
    () =>
      browse ? `${kind}:${JSON.stringify(toDiscoverQuery(browse, 0))}` : "",
    [browse, kind],
  );

  return (
    <View className='flex-1'>
      <View className='px-4 pb-3'>
        <View className='flex-row items-center'>
          <View className='flex-1 flex-row items-center bg-neutral-900 rounded-xl px-3 mr-2'>
            <Ionicons name='search' size={16} color='#888' />
            <TextInput
              className='flex-1 text-white px-2 py-2.5 text-sm'
              placeholder={
                kind === "movies" ? "Search movies…" : "Search shows…"
              }
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

        {browse ? (
          <Pressable
            className='flex-row items-center mt-3'
            onPress={() => {
              setQuery("");
              setBrowse(null);
            }}
            hitSlop={8}
          >
            <Ionicons name='chevron-back' size={16} color='#c084fc' />
            <Text className='text-purple-300 text-sm ml-0.5'>Discover</Text>
          </Pressable>
        ) : null}
      </View>

      {browse ? (
        <BrowseGrid
          gridKey={gridKey}
          fetchPage={(page) => discover(toDiscoverQuery(browse, page))}
          titleLanguage={titleLanguage}
          summary={tmdbFilterSummary(browse, genreVocab)}
          emptyText={`No ${kind} match these filters.`}
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
              key={`${kind}-${p.key}`}
              railKey={`${kind}-${p.key}`}
              title={p.title}
              fetchItems={() => discover({ sort: p.sort }).then((r) => r.items)}
              titleLanguage={titleLanguage}
              onSeeAll={() => setBrowse({ sort: p.sort })}
              hideWhenEmpty={false}
            />
          ))}
        </ScrollView>
      )}

      <TmdbFilterModal
        visible={filterOpen}
        initial={browse ?? {}}
        genreVocab={genreVocab}
        onApply={(f) => {
          setFilterOpen(false);
          setQuery("");
          setBrowse(hasActiveTmdbFilters(f) || f.sort ? f : null);
        }}
        onClose={() => setFilterOpen(false)}
      />
    </View>
  );
}
