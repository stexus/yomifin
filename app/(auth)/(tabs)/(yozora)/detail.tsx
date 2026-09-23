/*
 * Yozora title detail — routed by canonical title_key (?key=anilist:207141 |
 * tmdb:movie:603 | tmdb:show:1396) and branching on `kind`:
 *   anime → absolute-numbered episodes, paginated ×20 (ANM-1), still_url
 *           thumbnails, relations rail;
 *   show  → season picker + per-season episode lists ("{s}:{e}" keys);
 *   movie → play button only.
 * Watched/in-progress styling comes from GET /titles/{key}/progress; long-press
 * an episode for PRG-5 mark watched/unwatched. Playback goes through the
 * SourceSheet (sources → resolve → yozora-player). ANM-5: a tmdb title with a
 * canonical_key redirects to the anilist key so identity/progress live there.
 */
import { Ionicons } from "@expo/vector-icons";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { toast } from "sonner-native";
import { Text } from "@/components/common/Text";
import EpisodeThumbnail from "@/components/media/EpisodeThumbnail";
import { Chip } from "@/components/yozora/FilterChips";
import SourceSheet, { type PlayTarget } from "@/components/yozora/SourceSheet";
import TitleCard, { ScorePill } from "@/components/yozora/TitleCard";
import useRouter from "@/hooks/useAppRouter";
import { useSettings } from "@/utils/atoms/settings";
import {
  displayTitle,
  episodeLabel,
  jimakuTitle,
  movieProgress,
  progressByEpisode,
  progressFraction,
  relativeAirTime,
  runtimeLabel,
} from "@/utils/yozora/display";
import { useYozora } from "@/utils/yozora/session";
import type {
  EpisodeSummary,
  ProgressEntry,
  TitleDetail,
} from "@/utils/yozora/types";

function EpisodeRow({
  ep,
  entry,
  accentColor,
  onPress,
  onLongPress,
  onSources,
}: {
  ep: EpisodeSummary;
  entry?: ProgressEntry;
  accentColor: string;
  onPress: () => void;
  onLongPress: () => void;
  /** Manual source picker even with auto-play on (list icon); omit to hide. */
  onSources?: () => void;
}) {
  const notAired = ep.aired === false;
  const watched = entry?.state === "watched";
  const frac =
    entry?.state === "in_progress"
      ? progressFraction(entry.position_sec, entry.duration_sec)
      : null;
  return (
    <Pressable
      className='flex-row items-center bg-neutral-900 rounded-xl p-2 mb-2'
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={notAired}
      style={{ opacity: notAired ? 0.45 : watched ? 0.6 : 1 }}
    >
      <View>
        <EpisodeThumbnail
          thumbnail={ep.still_url}
          episodeNumber={ep.number}
          accentColor={accentColor}
        />
        {frac != null ? (
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 3,
              borderBottomLeftRadius: 6,
              borderBottomRightRadius: 6,
              overflow: "hidden",
              backgroundColor: "rgba(255,255,255,0.25)",
            }}
          >
            <View
              style={{
                width: `${Math.round(frac * 100)}%`,
                height: "100%",
                backgroundColor: "#9334E9",
              }}
            />
          </View>
        ) : null}
      </View>
      <View className='flex-1 ml-3'>
        <Text className='text-white text-sm' numberOfLines={2}>
          {episodeLabel(ep.episode)}
        </Text>
        {ep.name && ep.name !== `Episode ${ep.number}` ? (
          <Text className='text-neutral-500 text-xs mt-0.5' numberOfLines={1}>
            {ep.name}
          </Text>
        ) : null}
        {notAired && ep.air_date ? (
          <Text className='text-neutral-600 text-xs mt-0.5'>
            Airs {ep.air_date}
          </Text>
        ) : null}
      </View>
      {onSources && !notAired ? (
        <Pressable onPress={onSources} hitSlop={8} className='p-1.5 mr-1'>
          <Ionicons name='list' size={20} color='#888' />
        </Pressable>
      ) : null}
      {watched ? (
        <Ionicons name='checkmark-circle' size={22} color='#22c55e' />
      ) : notAired ? (
        <Ionicons name='time-outline' size={22} color='#555' />
      ) : (
        <Ionicons name='play-circle' size={26} color='#c084fc' />
      )}
    </Pressable>
  );
}

export default function YozoraDetailPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { key } = useLocalSearchParams<{ key: string }>();
  const titleKey = key ?? "";
  const { client, connected } = useYozora();
  const { settings } = useSettings();
  const titleLanguage = settings?.anilistTitleLanguage ?? "romaji";
  const autoPlay = settings?.yozoraAutoPlay ?? false;

  const [descExpanded, setDescExpanded] = useState(false);
  const [playTarget, setPlayTarget] = useState<PlayTarget | null>(null);
  const closeSourceSheet = useCallback(() => setPlayTarget(null), []);
  const [season, setSeason] = useState<number | null>(null);

  const detailQ = useQuery({
    queryKey: ["yozora", "detail", titleKey],
    queryFn: () => client.titleDetail(titleKey),
    enabled: connected && !!titleKey,
    staleTime: 10 * 60 * 1000,
  });
  const detail: TitleDetail | undefined = detailQ.data;

  // ANM-5: redirect to the canonical anilist key (identity/progress live there).
  useEffect(() => {
    if (detail?.canonical_key && detail.canonical_key !== titleKey) {
      router.replace({
        pathname: "/(auth)/(tabs)/(yozora)/detail" as any,
        params: { key: detail.canonical_key },
      });
    }
  }, [detail?.canonical_key, titleKey, router]);

  const progressQ = useQuery({
    queryKey: ["yozora", "progress", titleKey],
    queryFn: () => client.titleProgress(titleKey),
    enabled: connected && !!titleKey,
    staleTime: 15 * 1000,
    refetchOnMount: "always",
  });
  // Coming back from the player must reflect fresh positions.
  useFocusEffect(
    useCallback(() => {
      progressQ.refetch();
    }, [progressQ.refetch]),
  );

  const epProgress = useMemo(
    () => progressByEpisode(progressQ.data?.items ?? []),
    [progressQ.data],
  );

  const kind = detail?.kind;
  const isAnime = kind === "anime";
  const isShow = kind === "show";
  const isMovie = kind === "movie";

  // Anime: absolute episodes, pages of 20 (ANM-1).
  const episodesQ = useInfiniteQuery({
    queryKey: ["yozora", "episodes", titleKey],
    queryFn: ({ pageParam }) =>
      client.episodes(titleKey, { page: pageParam as number }),
    initialPageParam: 1,
    getNextPageParam: (last) => {
      const page = last.page ?? 1;
      const size = last.page_size ?? 20;
      if (last.total != null)
        return page * size < last.total ? page + 1 : undefined;
      return last.episodes.length >= size ? page + 1 : undefined;
    },
    enabled: connected && isAnime,
    staleTime: 5 * 60 * 1000,
  });
  const animeEpisodes = useMemo(
    () => (episodesQ.data?.pages ?? []).flatMap((p) => p.episodes),
    [episodesQ.data],
  );
  const episodeTotal = episodesQ.data?.pages?.[0]?.total ?? null;

  // Shows: default to the first real season once the detail arrives.
  const seasons = detail?.seasons ?? null;
  useEffect(() => {
    if (isShow && season == null && seasons?.length) {
      const first = seasons.find((s) => s.season > 0) ?? seasons[0];
      setSeason(first.season);
    }
  }, [isShow, season, seasons]);

  const seasonEpisodesQ = useQuery({
    queryKey: ["yozora", "episodes", titleKey, season],
    queryFn: () => client.episodes(titleKey, { season: season ?? 1 }),
    enabled: connected && isShow && season != null,
    staleTime: 5 * 60 * 1000,
  });

  const name = detail ? displayTitle(detail, titleLanguage) : "";
  const jimaku = detail ? jimakuTitle(detail) : "";
  const accentColor = "#7c3aed";
  const movieEntry = movieProgress(progressQ.data?.items ?? []);

  const invalidateProgress = () => {
    queryClient.invalidateQueries({
      queryKey: ["yozora", "progress", titleKey],
    });
    queryClient.invalidateQueries({
      queryKey: ["yozora", "continue-watching"],
    });
    queryClient.invalidateQueries({ queryKey: ["yozora", "library"] });
  };

  const toggleWatched = (
    episode: string | undefined,
    entry?: ProgressEntry,
  ) => {
    const watched = entry?.state === "watched";
    Alert.alert(
      episode ? episodeLabel(episode) : name,
      undefined,
      [
        {
          text: watched ? "Mark unwatched" : "Mark watched",
          onPress: async () => {
            try {
              if (watched) await client.markUnwatched(titleKey, episode);
              else await client.markWatched(titleKey, episode);
              invalidateProgress();
            } catch {
              toast.error("Failed to update watched state");
            }
          },
        },
        { text: "Cancel", style: "cancel" },
      ],
      { cancelable: true },
    );
  };

  const playEpisode = (ep: EpisodeSummary, forcePicker = false) => {
    const entry = epProgress.get(ep.episode);
    setPlayTarget({
      episode: ep.episode,
      displayName: `${name} · ${episodeLabel(ep.episode)}`,
      startPositionSec: entry?.state === "in_progress" ? entry.position_sec : 0,
      forcePicker,
    });
  };

  const metaLine = detail
    ? [
        isAnime ? (detail.format ?? "Anime") : isMovie ? "Movie" : "Show",
        isAnime
          ? detail.season_label
          : detail.year
            ? String(detail.year)
            : null,
        isAnime && detail.episodes_total ? `${detail.episodes_total} ep` : null,
        runtimeLabel(detail.runtime_min) || null,
        isAnime ? detail.studios?.[0] : detail.status,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <View className='flex-1 bg-black'>
      <Stack.Screen options={{ headerTitle: "" }} />
      {detailQ.isLoading ? (
        <View className='flex-1 items-center justify-center'>
          <ActivityIndicator color='#aaa' />
        </View>
      ) : !detail ? (
        <View className='flex-1 items-center justify-center px-8'>
          <Text className='text-neutral-400 text-center mb-4'>
            Couldn't load this title from Yozora.
          </Text>
          <Pressable
            className='bg-neutral-800 rounded-xl px-5 py-3'
            onPress={() => detailQ.refetch()}
          >
            <Text className='text-white font-bold'>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
          contentInsetAdjustmentBehavior='never'
          showsVerticalScrollIndicator={false}
        >
          {/* Banner hero */}
          <View style={{ height: 240 }}>
            {detail.backdrop_url ? (
              <Image
                source={{ uri: detail.backdrop_url }}
                style={{ width: "100%", height: "100%" }}
                contentFit='cover'
              />
            ) : (
              <View
                style={{
                  width: "100%",
                  height: "100%",
                  backgroundColor: "#1a1a1a",
                }}
              />
            )}
            <LinearGradient
              colors={["rgba(0,0,0,0.2)", "rgba(0,0,0,0.55)", "#000"]}
              locations={[0, 0.6, 1]}
              style={{ position: "absolute", inset: 0 }}
            />
          </View>

          <View className='px-4' style={{ marginTop: -80 }}>
            <View className='flex-row'>
              <View
                style={{
                  width: 120,
                  height: 170,
                  borderRadius: 10,
                  overflow: "hidden",
                  backgroundColor: "#1c1c1c",
                }}
              >
                {detail.poster_url ? (
                  <Image
                    source={{ uri: detail.poster_url }}
                    style={{ width: "100%", height: "100%" }}
                    contentFit='cover'
                  />
                ) : null}
                <ScorePill rating={detail.rating} />
              </View>
              <View className='flex-1 ml-3 justify-end'>
                <Text
                  className='text-white text-xl font-bold'
                  numberOfLines={3}
                >
                  {name}
                </Text>
                <Text className='text-neutral-400 text-xs mt-1'>
                  {metaLine}
                </Text>
                {isMovie ? (
                  <Pressable
                    className='bg-purple-600 rounded-xl px-5 py-2.5 mt-3 self-start flex-row items-center'
                    onPress={() =>
                      setPlayTarget({
                        displayName: name,
                        startPositionSec:
                          movieEntry?.state === "in_progress"
                            ? movieEntry.position_sec
                            : 0,
                      })
                    }
                    onLongPress={() =>
                      toggleWatched(undefined, movieEntry ?? undefined)
                    }
                  >
                    <Ionicons name='play' size={16} color='white' />
                    <Text className='text-white font-bold ml-1.5'>
                      {movieEntry?.state === "in_progress"
                        ? "Resume"
                        : movieEntry?.state === "watched"
                          ? "Watch again"
                          : "Play"}
                    </Text>
                  </Pressable>
                ) : null}
                {isMovie && autoPlay ? (
                  <Pressable
                    className='bg-neutral-800 rounded-xl px-4 py-2.5 mt-2 self-start flex-row items-center'
                    onPress={() =>
                      setPlayTarget({
                        displayName: name,
                        startPositionSec:
                          movieEntry?.state === "in_progress"
                            ? movieEntry.position_sec
                            : 0,
                        forcePicker: true,
                      })
                    }
                  >
                    <Ionicons name='list' size={16} color='#ccc' />
                    <Text className='text-neutral-200 font-semibold ml-1.5'>
                      Sources
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            {/* Genre chips */}
            {detail.genres.length > 0 ? (
              <View className='flex-row flex-wrap mt-4'>
                {detail.genres.map((g) => (
                  <View
                    key={g.name}
                    className='bg-neutral-800 rounded-full px-2.5 py-1 mr-2 mb-2'
                  >
                    <Text className='text-neutral-200 text-xs'>{g.name}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Next airing */}
            {detail.next_airing ? (
              <View className='bg-neutral-900 rounded-xl px-3 py-2 mt-2 self-start'>
                <Text className='text-purple-300 text-xs'>
                  Ep {detail.next_airing.episode} ·{" "}
                  {relativeAirTime(detail.next_airing.airs_at)}
                </Text>
              </View>
            ) : null}

            {/* Overview */}
            {detail.overview ? (
              <Pressable
                onPress={() => setDescExpanded((e) => !e)}
                className='mt-3'
              >
                <Text
                  className='text-neutral-300 text-sm'
                  numberOfLines={descExpanded ? undefined : 4}
                  style={{ lineHeight: 20 }}
                >
                  {detail.overview}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {/* Anime episodes (absolute, paginated ×20) */}
          {isAnime ? (
            <View className='px-4 mt-6'>
              <Text className='text-white text-lg font-bold mb-2'>
                Episodes{episodeTotal ? ` (${episodeTotal})` : ""}
              </Text>
              {episodesQ.isLoading ? (
                <ActivityIndicator
                  color='#888'
                  style={{ marginVertical: 16 }}
                />
              ) : animeEpisodes.length === 0 ? (
                <Text className='text-neutral-500 text-sm'>
                  No episodes listed yet.
                </Text>
              ) : (
                <>
                  {animeEpisodes.map((ep) => (
                    <EpisodeRow
                      key={ep.episode}
                      ep={ep}
                      entry={epProgress.get(ep.episode)}
                      accentColor={accentColor}
                      onPress={() => playEpisode(ep)}
                      onLongPress={() =>
                        toggleWatched(ep.episode, epProgress.get(ep.episode))
                      }
                      onSources={
                        autoPlay ? () => playEpisode(ep, true) : undefined
                      }
                    />
                  ))}
                  {episodesQ.hasNextPage ? (
                    <Pressable
                      className='bg-neutral-900 rounded-xl py-3 items-center'
                      onPress={() => episodesQ.fetchNextPage()}
                      disabled={episodesQ.isFetchingNextPage}
                    >
                      {episodesQ.isFetchingNextPage ? (
                        <ActivityIndicator size='small' color='#888' />
                      ) : (
                        <Text className='text-purple-300 text-sm'>
                          Load more episodes
                        </Text>
                      )}
                    </Pressable>
                  ) : null}
                </>
              )}
            </View>
          ) : null}

          {/* Show seasons + episodes */}
          {isShow && seasons?.length ? (
            <View className='px-4 mt-6'>
              <Text className='text-white text-lg font-bold mb-2'>Seasons</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                className='mb-3'
              >
                {seasons.map((s) => (
                  <Chip
                    key={s.season}
                    label={s.name || `Season ${s.season}`}
                    active={season === s.season}
                    onPress={() => setSeason(s.season)}
                  />
                ))}
              </ScrollView>
              {seasonEpisodesQ.isLoading ? (
                <ActivityIndicator
                  color='#888'
                  style={{ marginVertical: 16 }}
                />
              ) : (
                (seasonEpisodesQ.data?.episodes ?? []).map((ep) => (
                  <EpisodeRow
                    key={ep.episode}
                    ep={ep}
                    entry={epProgress.get(ep.episode)}
                    accentColor={accentColor}
                    onPress={() => playEpisode(ep)}
                    onLongPress={() =>
                      toggleWatched(ep.episode, epProgress.get(ep.episode))
                    }
                    onSources={
                      autoPlay ? () => playEpisode(ep, true) : undefined
                    }
                  />
                ))
              )}
            </View>
          ) : null}

          {/* Relations (anime) */}
          {(detail.relations ?? []).length > 0 ? (
            <View className='mt-6'>
              <Text className='text-white text-lg font-bold mb-2 px-4'>
                Related
              </Text>
              <FlatList
                horizontal
                data={detail.relations}
                keyExtractor={(e, i) => `${e.title.title_key}-${i}`}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16 }}
                ItemSeparatorComponent={() => <View style={{ width: 10 }} />}
                renderItem={({ item }) => (
                  <View style={{ width: 110 }}>
                    <Text
                      className='text-purple-300 text-[10px] mb-1'
                      numberOfLines={1}
                    >
                      {item.relation}
                    </Text>
                    <TitleCard
                      title={item.title}
                      width={110}
                      titleLanguage={titleLanguage}
                      showMeta={false}
                    />
                  </View>
                )}
              />
            </View>
          ) : null}

          {/* Recommendations */}
          {detail.recommendations.length > 0 ? (
            <View className='mt-6'>
              <Text className='text-white text-lg font-bold mb-2 px-4'>
                Recommendations
              </Text>
              <FlatList
                horizontal
                data={detail.recommendations}
                keyExtractor={(m) => m.title_key}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16 }}
                ItemSeparatorComponent={() => <View style={{ width: 10 }} />}
                renderItem={({ item }) => (
                  <TitleCard
                    title={item}
                    width={110}
                    titleLanguage={titleLanguage}
                    showMeta={false}
                  />
                )}
              />
            </View>
          ) : null}
        </ScrollView>
      )}

      {/* Source picker → resolve → player */}
      <SourceSheet
        target={playTarget}
        titleKey={titleKey}
        jimakuQuery={jimaku}
        autoPlay={autoPlay}
        client={client}
        onClose={closeSourceSheet}
      />
    </View>
  );
}
