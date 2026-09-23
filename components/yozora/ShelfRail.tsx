/*
 * Generic Yozora discovery rail: a titled horizontal strip of poster cards fed
 * by any () => Promise<TitleSummary[]> (discover sorts, shelf items, detail
 * recommendations). React Query caches per railKey so section/tab switches
 * don't refetch.
 */
import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { Text } from "@/components/common/Text";
import type { TitleLanguage } from "@/utils/yozora/display";
import type { TitleSummary } from "@/utils/yozora/types";
import TitleCard from "./TitleCard";

const POSTER_W = 118;

interface Props {
  railKey: string;
  title: string;
  fetchItems: () => Promise<TitleSummary[]>;
  titleLanguage: TitleLanguage;
  enabled?: boolean;
  /** "See all" swaps into the matching section/grid (optional). */
  onSeeAll?: () => void;
  /** Hide the rail entirely when it loads empty (default true). */
  hideWhenEmpty?: boolean;
}

export default function ShelfRail({
  railKey,
  title,
  fetchItems,
  titleLanguage,
  enabled = true,
  onSeeAll,
  hideWhenEmpty = true,
}: Props) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["yozora", "rail", railKey],
    queryFn: fetchItems,
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  if (data && data.length === 0 && hideWhenEmpty) return null;

  return (
    <View className='mb-6'>
      <Pressable
        className='flex-row items-center justify-between mb-2.5 pr-1'
        onPress={onSeeAll}
        disabled={!onSeeAll}
      >
        <Text className='text-white text-lg font-bold'>{title}</Text>
        {onSeeAll ? (
          <Text className='text-purple-400 text-xs'>See all ›</Text>
        ) : null}
      </Pressable>

      {isLoading ? (
        <View
          style={{ height: POSTER_W * 1.42 }}
          className='items-center justify-center'
        >
          <ActivityIndicator size='small' color='#888' />
        </View>
      ) : isError ? (
        <Pressable onPress={() => refetch()}>
          <Text className='text-red-400 text-xs'>
            Failed to load — tap to retry
          </Text>
        </Pressable>
      ) : (
        <FlatList
          horizontal
          data={data ?? []}
          keyExtractor={(m) => m.title_key}
          showsHorizontalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ width: 10 }} />}
          renderItem={({ item }) => (
            <TitleCard
              title={item}
              width={POSTER_W}
              titleLanguage={titleLanguage}
            />
          )}
        />
      )}
    </View>
  );
}
