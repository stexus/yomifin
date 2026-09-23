/*
 * Infinite-scroll Yozora results grid, driven by any (page) => Paginated
 * fetcher (anime/movie/show discover, search). Rendered INLINE under a
 * section's persistent search/filter bar — the bar stays put while this grid
 * swaps contents on filter change (gridKey identifies the active filter set).
 *
 * Columns scale with screen width (target ~150px posters), same as the old
 * AnimeBrowseGrid.
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/common/Text";
import type { TitleLanguage } from "@/utils/yozora/display";
import type { Paginated, TitleSummary } from "@/utils/yozora/types";
import TitleCard from "./TitleCard";

const H_PAD = 16;
const GAP = 10;
const TARGET_POSTER = 150;

interface Props {
  /** Identifies the active filter set (query cache key + reset trigger). */
  gridKey: string;
  fetchPage: (page: number) => Promise<Paginated<TitleSummary>>;
  titleLanguage: TitleLanguage;
  /** Human filter-summary header line (optional). */
  summary?: string;
  emptyText?: string;
}

export default function BrowseGrid({
  gridKey,
  fetchPage,
  titleLanguage,
  summary,
  emptyText = "No titles match these filters.",
}: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const columns = Math.max(
    3,
    Math.floor((width - H_PAD * 2 + GAP) / (TARGET_POSTER + GAP)),
  );
  const posterW = (width - H_PAD * 2 - GAP * (columns - 1)) / columns;

  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["yozora", "grid", gridKey],
    queryFn: ({ pageParam }) => fetchPage(pageParam as number),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.has_more ? last.page + 1 : undefined),
    staleTime: 60 * 1000,
  });

  const metas = useMemo(() => {
    const seen = new Set<string>();
    const out: TitleSummary[] = [];
    for (const page of data?.pages ?? []) {
      for (const t of page.items) {
        if (seen.has(t.title_key)) continue;
        seen.add(t.title_key);
        out.push(t);
      }
    }
    return out;
  }, [data]);

  if (isLoading) {
    return (
      <View className='flex-1 items-center justify-center'>
        <ActivityIndicator color='#aaa' />
      </View>
    );
  }
  if (isError) {
    return (
      <View className='flex-1 items-center justify-center px-8'>
        <Text className='text-red-400 text-center'>
          {(error as Error)?.message ?? "Failed to load."}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      // Remount on column change so numColumns updates cleanly.
      key={columns}
      data={metas}
      numColumns={columns}
      keyExtractor={(m) => m.title_key}
      contentContainerStyle={{
        paddingHorizontal: H_PAD,
        paddingBottom: insets.bottom + 96,
      }}
      columnWrapperStyle={{ gap: GAP }}
      keyboardShouldPersistTaps='handled'
      keyboardDismissMode='on-drag'
      ListHeaderComponent={
        summary ? (
          <Text
            className='text-neutral-400 text-xs mb-3 mt-1'
            numberOfLines={2}
          >
            {summary}
          </Text>
        ) : null
      }
      ListEmptyComponent={
        <Text className='text-neutral-500 text-center mt-8'>{emptyText}</Text>
      }
      onEndReachedThreshold={1.5}
      onEndReached={() => {
        if (hasNextPage && !isFetchingNextPage) fetchNextPage();
      }}
      ListFooterComponent={
        isFetchingNextPage ? (
          <ActivityIndicator color='#888' style={{ marginVertical: 20 }} />
        ) : null
      }
      renderItem={({ item }) => (
        <View style={{ marginBottom: 14 }}>
          <TitleCard
            title={item}
            width={posterW}
            titleLanguage={titleLanguage}
          />
        </View>
      )}
    />
  );
}
