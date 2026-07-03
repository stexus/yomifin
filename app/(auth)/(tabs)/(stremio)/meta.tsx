/*
 * Stremio meta detail: poster/description, episode list (series), and the stream
 * picker (aggregated across all configured addons; debrid/HTTP streams only).
 * Picking a stream routes to the minimal Stremio player.
 */
import { Image } from "expo-image";
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
import { Text } from "@/components/common/Text";
import useRouter from "@/hooks/useAppRouter";
import {
  type AddonStream,
  fetchMetaFromAddons,
  fetchStreamsFromAddons,
  playableStreams,
  type StremioMetaDetail,
  type StremioVideo,
  sortVideos,
  streamLabel,
  videoLabel,
} from "@/utils/stremio/client";
import { useStremioAddons } from "@/utils/stremio/useStremioAddons";

export default function StremioMetaPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { type, id, name } = useLocalSearchParams<{
    type: string;
    id: string;
    name?: string;
  }>();
  const { addons, loading: addonsLoading } = useStremioAddons();

  const [meta, setMeta] = useState<StremioMetaDetail | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);

  // Stream picker state: which video id we're resolving (meta id for movies).
  const [pickFor, setPickFor] = useState<{
    videoId: string;
    title: string;
  } | null>(null);
  const [streams, setStreams] = useState<AddonStream[] | null>(null);

  useEffect(() => {
    if (addonsLoading || !type || !id) return;
    let cancelled = false;
    setMetaLoading(true);
    fetchMetaFromAddons(addons, type, id)
      .then((m) => {
        if (!cancelled) setMeta(m);
      })
      .catch((e) => console.warn(`[STREMIO] meta failed: ${e}`))
      .finally(() => {
        if (!cancelled) setMetaLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [addons, addonsLoading, type, id]);

  const videos = useMemo(
    () => (meta?.videos ? sortVideos(meta.videos) : []),
    [meta?.videos],
  );
  const isSeries = videos.length > 0;

  const openStreams = (videoId: string, title: string) => {
    setPickFor({ videoId, title });
    setStreams(null);
    fetchStreamsFromAddons(addons, type ?? "movie", videoId)
      .then((all) => setStreams(playableStreams(all)))
      .catch((e) => {
        console.warn(`[STREMIO] streams failed: ${e}`);
        setStreams([]);
      });
  };

  const playStream = (s: AddonStream) => {
    if (!s.stream.url || !pickFor) return;
    const subs = (s.stream.subtitles ?? [])
      .filter((x) => /^https?:\/\//i.test(x.url))
      .map((x) => x.url);
    setPickFor(null);
    router.push({
      pathname: "/(auth)/player/stremio-player" as any,
      params: {
        url: s.stream.url,
        title: pickFor.title,
        subtitleUrls: subs.length > 0 ? JSON.stringify(subs) : "",
      },
    });
  };

  const displayName = meta?.name ?? name ?? id ?? "";

  return (
    <View className='flex-1 bg-black'>
      <Stack.Screen options={{ headerTitle: displayName }} />
      {metaLoading || addonsLoading ? (
        <View className='flex-1 items-center justify-center'>
          <ActivityIndicator color='#aaa' />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingTop: insets.top + 56,
            paddingBottom: insets.bottom + 96,
            paddingHorizontal: 16,
          }}
          contentInsetAdjustmentBehavior='automatic'
        >
          <View className='flex-row mb-4'>
            <Image
              source={{ uri: meta?.poster }}
              style={{
                width: 110,
                height: 165,
                borderRadius: 8,
                backgroundColor: "#1c1c1c",
              }}
              contentFit='cover'
            />
            <View className='flex-1 ml-4'>
              <Text className='text-white text-xl font-bold' numberOfLines={3}>
                {displayName}
              </Text>
              <Text className='text-neutral-400 text-xs mt-1'>
                {[
                  meta?.releaseInfo,
                  meta?.runtime,
                  (meta?.genres ?? []).join(", "),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              {!isSeries ? (
                <Pressable
                  className='bg-purple-600 rounded-xl px-5 py-3 mt-4 self-start'
                  onPress={() => openStreams(id ?? "", displayName)}
                >
                  <Text className='text-white font-bold'>▶ Play</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
          {meta?.description ? (
            <Text className='text-neutral-300 text-sm mb-6'>
              {meta.description}
            </Text>
          ) : null}
          {!meta ? (
            <Text className='text-neutral-400 mb-6'>
              No metadata found from the configured addons for this item — check
              the Stremio tab's addon list.
            </Text>
          ) : null}
          {isSeries ? (
            <View>
              <Text className='text-white text-lg font-bold mb-2'>
                Episodes
              </Text>
              {videos.map((v: StremioVideo) => (
                <Pressable
                  key={v.id}
                  className='bg-neutral-900 rounded-xl px-4 py-3 mb-2'
                  onPress={() =>
                    openStreams(v.id, `${displayName} - ${videoLabel(v)}`)
                  }
                >
                  <Text className='text-white text-sm'>{videoLabel(v)}</Text>
                  {v.overview ? (
                    <Text
                      className='text-neutral-500 text-xs mt-1'
                      numberOfLines={2}
                    >
                      {v.overview}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}

      {/* Stream picker */}
      <Modal
        visible={pickFor !== null}
        transparent
        animationType='slide'
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
              ? "Resolving streams…"
              : `${streams.length} playable stream${streams.length === 1 ? "" : "s"} (torrent-only results hidden)`}
          </Text>
          {streams === null ? (
            <ActivityIndicator color='#aaa' style={{ marginVertical: 24 }} />
          ) : (
            <FlatList
              data={streams}
              keyExtractor={(_s, i) => String(i)}
              renderItem={({ item }) => {
                const l = streamLabel(item.stream);
                return (
                  <Pressable
                    className='bg-neutral-800 rounded-xl px-4 py-3 mb-2'
                    onPress={() => playStream(item)}
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
