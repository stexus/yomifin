/*
 * AniList discovery shelf: a titled horizontal strip of poster cards for one
 * shelf preset (Trending / Popular This Season / …). Results are cached
 * module-level (AniList is rate-throttled) so tab switches don't refetch.
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { Text } from "@/components/common/Text";
import {
  type AnilistMediaPreview,
  type BrowseFilters,
  fetchMediaList,
  type TitleLanguage,
} from "@/utils/anilist/client";
import AnimeCard from "./AnimeCard";

const shelfCache = new Map<string, AnilistMediaPreview[]>();

const POSTER_W = 118;
const SHELF_LIMIT = 24;

interface Props {
  shelfKey: string;
  title: string;
  filters: BrowseFilters;
  titleLanguage: TitleLanguage;
  /** "See all" swaps the tab into the inline filter grid (see the anime home). */
  onSeeAll: () => void;
}

export default function AnimeShelf({
  shelfKey,
  title,
  filters,
  titleLanguage,
  onSeeAll,
}: Props) {
  const [metas, setMetas] = useState<AnilistMediaPreview[] | null>(
    () => shelfCache.get(shelfKey) ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (shelfCache.has(shelfKey)) {
      setMetas(shelfCache.get(shelfKey) ?? []);
      return;
    }
    let cancelled = false;
    setError(null);
    fetchMediaList(filters, SHELF_LIMIT)
      .then((list) => {
        shelfCache.set(shelfKey, list);
        if (!cancelled) setMetas(list);
      })
      .catch((e) => {
        console.warn(`[ANILIST] shelf ${shelfKey} failed: ${e}`);
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [shelfKey, filters, nonce]);

  return (
    <View className='mb-6'>
      <Pressable
        className='flex-row items-center justify-between mb-2.5 pr-1'
        onPress={onSeeAll}
      >
        <Text className='text-white text-lg font-bold'>{title}</Text>
        <Text className='text-purple-400 text-xs'>See all ›</Text>
      </Pressable>

      {metas === null && !error ? (
        <View
          style={{ height: POSTER_W * 1.42 }}
          className='items-center justify-center'
        >
          <ActivityIndicator size='small' color='#888' />
        </View>
      ) : null}

      {error ? (
        <Pressable onPress={() => setNonce((n) => n + 1)}>
          <Text className='text-red-400 text-xs'>
            Failed to load — tap to retry
          </Text>
        </Pressable>
      ) : null}

      {metas !== null && metas.length > 0 ? (
        <FlatList
          horizontal
          data={metas}
          keyExtractor={(m) => String(m.id)}
          showsHorizontalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ width: 10 }} />}
          renderItem={({ item }) => (
            <AnimeCard
              media={item}
              width={POSTER_W}
              titleLanguage={titleLanguage}
            />
          )}
        />
      ) : null}
    </View>
  );
}
