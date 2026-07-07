/*
 * Infinite-scroll AniList results grid, driven by a live BrowseFilters object.
 * Rendered INLINE under the anime tab's persistent search/filter bar (AniList
 * style) — the bar stays put while this grid swaps its contents on filter change.
 *
 * Columns scale with screen width (target ~150px posters) so the iPad shows a
 * dense, consistent grid instead of a few giant posters.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AnimeCard from "@/components/anime/AnimeCard";
import { Text } from "@/components/common/Text";
import {
  type AnilistMediaPreview,
  type BrowseFilters,
  FORMAT_OPTIONS,
  fetchMediaPage,
  STATUS_OPTIONS,
  seasonLabel,
  type TitleLanguage,
} from "@/utils/anilist/client";

const H_PAD = 16;
const GAP = 10;
const TARGET_POSTER = 150;

/** Human summary of the active filters for the grid header line. */
function filterSummary(f: BrowseFilters): string {
  const parts: string[] = [];
  if (f.search?.trim()) parts.push(`“${f.search.trim()}”`);
  const yr =
    f.yearFrom || f.yearTo
      ? f.yearFrom === f.yearTo
        ? String(f.yearFrom)
        : `${f.yearFrom ?? "…"}–${f.yearTo ?? "…"}`
      : f.seasonYear
        ? String(f.seasonYear)
        : undefined;
  if (f.season || yr)
    parts.push(
      [f.season ? seasonLabel(f.season) : "", yr ?? ""]
        .filter(Boolean)
        .join(" "),
    );
  if (f.formats?.length) {
    const label = FORMAT_OPTIONS.find((o) => o.value === f.formats?.[0])?.label;
    if (label) parts.push(label);
  }
  if (f.status) {
    const label = STATUS_OPTIONS.find((o) => o.value === f.status)?.label;
    if (label) parts.push(label);
  }
  if (f.genres?.length) parts.push(f.genres.join(", "));
  if (f.tags?.length) parts.push(f.tags.join(", "));
  return parts.filter(Boolean).join(" · ");
}

interface Props {
  filters: BrowseFilters;
  titleLanguage: TitleLanguage;
}

export default function AnimeBrowseGrid({ filters, titleLanguage }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const columns = Math.max(
    3,
    Math.floor((width - H_PAD * 2 + GAP) / (TARGET_POSTER + GAP)),
  );
  const posterW = (width - H_PAD * 2 - GAP * (columns - 1)) / columns;

  const [metas, setMetas] = useState<AnilistMediaPreview[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(async (pageNum: number, f: BrowseFilters) => {
    try {
      const res = await fetchMediaPage(f, pageNum, 30);
      setHasNext(res.pageInfo.hasNextPage ?? false);
      setMetas((prev) => {
        if (pageNum === 1) return res.media;
        const seen = new Set(prev.map((m) => m.id));
        return [...prev, ...res.media.filter((m) => !seen.has(m.id))];
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  // Reset + reload whenever the filters change.
  useEffect(() => {
    setMetas([]);
    setPage(1);
    setHasNext(true);
    setLoading(true);
    setError(null);
    loadPage(1, filters);
  }, [filters, loadPage]);

  const onEndReached = () => {
    if (loading || loadingMore || !hasNext || metas.length === 0) return;
    const next = page + 1;
    setPage(next);
    setLoadingMore(true);
    loadPage(next, filters);
  };

  const summary = useMemo(() => filterSummary(filters), [filters]);

  if (loading) {
    return (
      <View className='flex-1 items-center justify-center'>
        <ActivityIndicator color='#aaa' />
      </View>
    );
  }
  if (error) {
    return (
      <View className='flex-1 items-center justify-center px-8'>
        <Text className='text-red-400 text-center'>{error}</Text>
      </View>
    );
  }

  return (
    <FlatList
      // Remount on column change so numColumns updates cleanly.
      key={columns}
      data={metas}
      numColumns={columns}
      keyExtractor={(m) => String(m.id)}
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
        <Text className='text-neutral-500 text-center mt-8'>
          No anime match these filters.
        </Text>
      }
      onEndReachedThreshold={1.5}
      onEndReached={onEndReached}
      ListFooterComponent={
        loadingMore ? (
          <ActivityIndicator color='#888' style={{ marginVertical: 20 }} />
        ) : null
      }
      renderItem={({ item }) => (
        <View style={{ marginBottom: 14 }}>
          <AnimeCard
            media={item}
            width={posterW}
            titleLanguage={titleLanguage}
          />
        </View>
      )}
    />
  );
}
