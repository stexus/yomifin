/*
 * AniList detail: banner-backed hero (cover, colored score pill, tags, studios),
 * description, episode list, relations + recommendations ("infinite discovery").
 *
 * PLAYBACK: episode/movie tap → resolve the AniList id to a kitsu id (arm bridge,
 * MMKV-cached) → `kitsu:<id>:<episode>` → existing fetchStreamsFromAddons → the
 * existing stremio-player (which handles debrid playback + the full yomifin
 * mining pipeline). jimaku gets the RAW AniList id. kitsu is episode-aligned with
 * AniList by construction; imdb is a movies-only fallback (see mapping.ts).
 */
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AnimeCard, { ScorePill } from "@/components/anime/AnimeCard";
import { Text } from "@/components/common/Text";
import EpisodeThumbnail from "@/components/media/EpisodeThumbnail";
import useRouter from "@/hooks/useAppRouter";
import {
  type AnilistMediaDetail,
  type AnilistMediaPreview,
  airedEpisodeCount,
  cleanEpisodeTitle,
  coverUrl,
  displayTitle,
  episodeStreamMap,
  fetchMediaDetail,
  formatLabel,
  isSingleVideo,
  jimakuTitle,
  seasonLabel,
  stripDescription,
} from "@/utils/anilist/client";
import { resolvePlaybackTarget } from "@/utils/anilist/mapping";
import { resolveAnilistIdMap } from "@/utils/anilist/useAnilistIdMap";
import { useSettings } from "@/utils/atoms/settings";
import {
  type AddonStream,
  episodeThumbnailMap,
  fetchMetaFromAddons,
  fetchStreamsFromAddons,
  playableStreams,
  streamLabel,
} from "@/utils/stremio/client";
import { useStremioAddons } from "@/utils/stremio/useStremioAddons";

interface StreamTarget {
  episode?: number;
  title: string;
  singleVideo: boolean;
}

function relationLabel(t?: string | null): string {
  if (!t) return "";
  return t
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AnimeDetailPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const anilistId = Number(id);
  const { settings } = useSettings();
  const { addons, loading: addonsLoading } = useStremioAddons();
  const titleLanguage = settings?.anilistTitleLanguage ?? "romaji";
  const autoPlayFirst = settings?.stremioAutoPlayFirstStream ?? false;

  const [media, setMedia] = useState<AnilistMediaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [descExpanded, setDescExpanded] = useState(false);

  // Stream picker state.
  const [pickFor, setPickFor] = useState<StreamTarget | null>(null);
  const [streams, setStreams] = useState<AddonStream[] | null>(null);
  const [resolveNote, setResolveNote] = useState<string | null>(null);

  // Episode-thumbnail FALLBACK from Stremio meta (arm imdb id + thetvdb-season):
  // AniList's own streamingEpisodes are often empty for recent/upcoming shows, so
  // we backfill per-episode stills from aiometadata's TVDB-rich imdb meta.
  const [stremioThumbs, setStremioThumbs] = useState<Map<number, string>>(
    () => new Map(),
  );

  useEffect(() => {
    if (!anilistId) return;
    let cancelled = false;
    setLoading(true);
    fetchMediaDetail(anilistId)
      .then((m) => {
        if (!cancelled) setMedia(m);
      })
      .catch((e) => console.warn(`[ANILIST] detail failed: ${e}`))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [anilistId]);

  const name = media ? displayTitle(media, titleLanguage) : "";
  const singleVideo = media ? isSingleVideo(media) : false;
  const episodeCount = media ? airedEpisodeCount(media) : 0;

  // Visible tags: hide spoilers + adult by default; top by rank.
  const tags = useMemo(
    () =>
      (media?.tags ?? [])
        .filter((t) => !t.isMediaSpoiler && !t.isAdult)
        .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
        .slice(0, 10),
    [media?.tags],
  );

  const relations = useMemo(
    () =>
      (media?.relations?.edges ?? [])
        .filter((e) => e.node && e.node.type === "ANIME")
        .filter((e) =>
          [
            "SEQUEL",
            "PREQUEL",
            "SIDE_STORY",
            "PARENT",
            "ALTERNATIVE",
            "SPIN_OFF",
          ].includes(e.relationType ?? ""),
        ),
    [media?.relations],
  );

  const recommendations = useMemo(
    () =>
      (media?.recommendations?.nodes ?? [])
        .map((n) => n.mediaRecommendation)
        .filter((m): m is AnilistMediaPreview => !!m),
    [media?.recommendations],
  );

  // Episode NUMBER → streamingEpisode metadata (thumbnail/title). Parsed by
  // number (AniList's array is unordered + often sparse), so upcoming/newly-
  // airing shows just fall through to the numbered placeholder gracefully.
  const epMap = useMemo(
    () => episodeStreamMap(media?.streamingEpisodes),
    [media?.streamingEpisodes],
  );
  const accentColor = media?.coverImage?.color ?? "#3a3a3a";

  // Backfill episode stills from Stremio (aiometadata) meta when AniList lacks
  // them. Runs once the AniList detail + addons are ready and the title is a
  // series with an imdb mapping. TVDB-numbered → scope to arm's thetvdb-season
  // (best-effort; thumbnails only, playback stays kitsu-aligned).
  useEffect(() => {
    if (!media || singleVideo || addonsLoading || addons.length === 0) return;
    let cancelled = false;
    (async () => {
      const idMap = await resolveAnilistIdMap(anilistId);
      if (!idMap?.imdb || cancelled) return;
      const meta = await fetchMetaFromAddons(addons, "series", idMap.imdb);
      if (cancelled || !meta?.videos) return;
      const map = episodeThumbnailMap(
        meta.videos,
        idMap["thetvdb-season"] ?? undefined,
      );
      if (map.size > 0) setStremioThumbs(map);
    })().catch((e) => console.warn(`[ANILIST] thumb fallback failed: ${e}`));
    return () => {
      cancelled = true;
    };
  }, [media, singleVideo, addons, addonsLoading, anilistId]);

  const playStream = (s: AddonStream, target: StreamTarget) => {
    if (!s.stream.url) return;
    const subs = (s.stream.subtitles ?? [])
      .filter((x) => /^https?:\/\//i.test(x.url))
      .map((x) => x.url);
    setPickFor(null);
    router.push({
      pathname: "/(auth)/player/stremio-player" as any,
      params: {
        url: s.stream.url,
        title: target.title,
        // jimaku prefills: romaji/native series name (raw AniList id preferred).
        query: media ? jimakuTitle(media) : name,
        episode: target.episode !== undefined ? String(target.episode) : "",
        anilistId: String(anilistId),
        subtitleUrls: subs.length > 0 ? JSON.stringify(subs) : "",
      },
    });
  };

  const openStreams = async (target: StreamTarget) => {
    setPickFor(target);
    setStreams(null);
    setResolveNote(null);
    try {
      const idMap = await resolveAnilistIdMap(anilistId);
      const pt = resolvePlaybackTarget(idMap, {
        episode: target.episode,
        singleVideo: target.singleVideo,
      });
      if (!pt) {
        setResolveNote(
          "This title has no kitsu mapping — playback isn't available through the configured addons.",
        );
        setStreams([]);
        return;
      }
      if (pt.source === "imdb") {
        setResolveNote("No kitsu id — using the imdb fallback (movie).");
      }
      // Try each candidate content type; unsupported types return nothing.
      const merged: AddonStream[] = [];
      const seenUrls = new Set<string>();
      for (const type of pt.types) {
        const all = await fetchStreamsFromAddons(addons, type, pt.streamId);
        for (const s of playableStreams(all)) {
          const key = s.stream.url ?? "";
          if (seenUrls.has(key)) continue;
          seenUrls.add(key);
          merged.push(s);
        }
      }
      if (autoPlayFirst && merged.length > 0) {
        playStream(merged[0], target);
        return;
      }
      setStreams(merged);
    } catch (e) {
      console.warn(`[ANILIST] stream resolve failed: ${e}`);
      setStreams([]);
    }
  };

  return (
    <View className='flex-1 bg-black'>
      <Stack.Screen options={{ headerTitle: "" }} />
      {loading ? (
        <View className='flex-1 items-center justify-center'>
          <ActivityIndicator color='#aaa' />
        </View>
      ) : !media ? (
        <View className='flex-1 items-center justify-center px-8'>
          <Text className='text-neutral-400 text-center'>
            Couldn't load this title from AniList.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
          contentInsetAdjustmentBehavior='never'
          showsVerticalScrollIndicator={false}
        >
          {/* Banner hero */}
          <View style={{ height: 240 }}>
            {media.bannerImage ? (
              <Image
                source={{ uri: media.bannerImage }}
                style={{ width: "100%", height: "100%" }}
                contentFit='cover'
              />
            ) : (
              <View
                style={{
                  width: "100%",
                  height: "100%",
                  backgroundColor: media.coverImage?.color ?? "#1a1a1a",
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
                <Image
                  source={{ uri: coverUrl(media) }}
                  style={{ width: "100%", height: "100%" }}
                  contentFit='cover'
                />
                <ScorePill score={media.averageScore} />
              </View>
              <View className='flex-1 ml-3 justify-end'>
                <Text
                  className='text-white text-xl font-bold'
                  numberOfLines={3}
                >
                  {name}
                </Text>
                <Text className='text-neutral-400 text-xs mt-1'>
                  {[
                    formatLabel(media.format),
                    seasonLabel(media.season, media.seasonYear),
                    media.episodes ? `${media.episodes} ep` : null,
                    media.studios?.nodes?.[0]?.name,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
                {singleVideo ? (
                  <Pressable
                    className='bg-purple-600 rounded-xl px-5 py-2.5 mt-3 self-start flex-row items-center'
                    onPress={() =>
                      openStreams({ title: name, singleVideo: true })
                    }
                  >
                    <Ionicons name='play' size={16} color='white' />
                    <Text className='text-white font-bold ml-1.5'>Play</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            {/* Genre + tag chips */}
            {(media.genres?.length || tags.length) > 0 ? (
              <View className='flex-row flex-wrap mt-4'>
                {(media.genres ?? []).map((g) => (
                  <View
                    key={g}
                    className='bg-neutral-800 rounded-full px-2.5 py-1 mr-2 mb-2'
                  >
                    <Text className='text-neutral-200 text-xs'>{g}</Text>
                  </View>
                ))}
                {tags.map((t) => (
                  <View
                    key={t.name}
                    className='rounded-full px-2.5 py-1 mr-2 mb-2'
                    style={{ backgroundColor: "#2a2233" }}
                  >
                    <Text className='text-purple-300 text-xs'>
                      {t.name}
                      {t.rank ? ` ${t.rank}%` : ""}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Description */}
            {media.description ? (
              <Pressable
                onPress={() => setDescExpanded((e) => !e)}
                className='mt-3'
              >
                <Text
                  className='text-neutral-300 text-sm'
                  numberOfLines={descExpanded ? undefined : 4}
                  style={{ lineHeight: 20 }}
                >
                  {stripDescription(media.description)}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {/* Episodes */}
          {!singleVideo && episodeCount > 0 ? (
            <View className='px-4 mt-6'>
              <Text className='text-white text-lg font-bold mb-2'>
                Episodes ({episodeCount})
              </Text>
              {Array.from({ length: episodeCount }, (_, i) => i + 1).map(
                (n) => {
                  const se = epMap.get(n);
                  const epName = cleanEpisodeTitle(se?.title);
                  // AniList still first, then the Stremio (TVDB) fallback.
                  const thumb = se?.thumbnail ?? stremioThumbs.get(n);
                  return (
                    <Pressable
                      key={n}
                      className='flex-row items-center bg-neutral-900 rounded-xl p-2 mb-2'
                      onPress={() =>
                        openStreams({
                          episode: n,
                          title: `${name} · Episode ${n}`,
                          singleVideo: false,
                        })
                      }
                    >
                      <EpisodeThumbnail
                        thumbnail={thumb}
                        episodeNumber={n}
                        accentColor={accentColor}
                      />
                      <View className='flex-1 ml-3'>
                        <Text className='text-white text-sm' numberOfLines={2}>
                          Episode {n}
                        </Text>
                        {epName ? (
                          <Text
                            className='text-neutral-500 text-xs mt-0.5'
                            numberOfLines={1}
                          >
                            {epName}
                          </Text>
                        ) : null}
                      </View>
                      <Ionicons name='play-circle' size={26} color='#c084fc' />
                    </Pressable>
                  );
                },
              )}
            </View>
          ) : null}

          {/* Relations */}
          {relations.length > 0 ? (
            <View className='mt-6'>
              <Text className='text-white text-lg font-bold mb-2 px-4'>
                Related
              </Text>
              <FlatList
                horizontal
                data={relations}
                keyExtractor={(e) => String(e.node.id)}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16 }}
                ItemSeparatorComponent={() => <View style={{ width: 10 }} />}
                renderItem={({ item }) => (
                  <View style={{ width: 110 }}>
                    <Text
                      className='text-purple-300 text-[10px] mb-1'
                      numberOfLines={1}
                    >
                      {relationLabel(item.relationType)}
                    </Text>
                    <AnimeCard
                      media={item.node}
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
          {recommendations.length > 0 ? (
            <View className='mt-6'>
              <Text className='text-white text-lg font-bold mb-2 px-4'>
                Recommendations
              </Text>
              <FlatList
                horizontal
                data={recommendations}
                keyExtractor={(m) => String(m.id)}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16 }}
                ItemSeparatorComponent={() => <View style={{ width: 10 }} />}
                renderItem={({ item }) => (
                  <AnimeCard
                    media={item}
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

      {/* Stream picker (mirrors the Stremio meta picker) */}
      <Modal
        visible={pickFor !== null}
        transparent
        animationType='slide'
        supportedOrientations={[
          "portrait",
          "portrait-upside-down",
          "landscape",
          "landscape-left",
          "landscape-right",
        ]}
        onRequestClose={() => setPickFor(null)}
      >
        <Pressable
          className='flex-1 bg-black/60'
          onPress={() => setPickFor(null)}
        />
        <View
          className='bg-neutral-900 rounded-t-2xl px-4 pt-4'
          style={{ maxHeight: "70%", paddingBottom: insets.bottom + 16 }}
        >
          <Text className='text-white font-bold mb-1' numberOfLines={1}>
            {pickFor?.title}
          </Text>
          <Text className='text-neutral-500 text-xs mb-3'>
            {streams === null
              ? addonsLoading
                ? "Loading addons…"
                : "Resolving streams…"
              : resolveNote
                ? resolveNote
                : `${streams.length} playable stream${streams.length === 1 ? "" : "s"} (torrent-only results hidden)`}
          </Text>
          {streams === null ? (
            <ActivityIndicator color='#aaa' style={{ marginVertical: 24 }} />
          ) : (
            <FlatList
              data={streams}
              keyExtractor={(_s, i) => String(i)}
              ListEmptyComponent={
                resolveNote ? null : (
                  <Text className='text-neutral-500 text-sm py-4'>
                    No playable streams found.
                  </Text>
                )
              }
              renderItem={({ item }) => {
                const l = streamLabel(item.stream);
                return (
                  <Pressable
                    className='bg-neutral-800 rounded-xl px-4 py-3 mb-2'
                    onPress={() => pickFor && playStream(item, pickFor)}
                  >
                    <Text className='text-white text-sm' numberOfLines={2}>
                      {l.title}
                    </Text>
                    {l.subtitle ? (
                      <Text
                        className='text-neutral-400 text-xs mt-1'
                        numberOfLines={3}
                      >
                        {l.subtitle}
                      </Text>
                    ) : null}
                    <Text className='text-neutral-600 text-xs mt-1'>
                      via {item.addonName}
                      {(item.stream.subtitles?.length ?? 0) > 0
                        ? ` · ${item.stream.subtitles?.length} subs`
                        : ""}
                    </Text>
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}
