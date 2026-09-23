/*
 * Continue Watching rail (PRG-4): ONE global rail — the first row of every
 * Yozora section. Mixed kinds from GET /continue-watching:
 *   resume / next_up / sequel → tap resolves (auto-pick best cached) and plays;
 *   waiting → air countdown, links to detail.
 * Resolve failures fall back to the detail screen (its source picker shows the
 * honest error state).
 */
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { toast } from "sonner-native";
import { Text } from "@/components/common/Text";
import useRouter from "@/hooks/useAppRouter";
import type { YozoraClient } from "@/utils/yozora/api";
import { YozoraApiError } from "@/utils/yozora/api";
import {
  cwSubtitle,
  displayTitle,
  episodeLabel,
  jimakuTitle,
  progressFraction,
  type TitleLanguage,
} from "@/utils/yozora/display";
import type { ContinueWatchingItem } from "@/utils/yozora/types";
import { pushToPlayer } from "./playback";

const CARD_W = 224;
const CARD_H = 126;

interface Props {
  client: YozoraClient;
  titleLanguage: TitleLanguage;
  enabled?: boolean;
  /** Library section sets this: its Waiting list already shows waiting items,
   *  so the rail there hides them (they'd render twice otherwise). */
  excludeWaiting?: boolean;
}

export default function ContinueWatchingRail({
  client,
  titleLanguage,
  enabled = true,
  excludeWaiting = false,
}: Props) {
  const router = useRouter();
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["yozora", "continue-watching"],
    queryFn: () => client.continueWatching(),
    enabled,
    staleTime: 30 * 1000,
    refetchOnMount: "always",
  });

  const items = (data?.items ?? []).filter(
    (it) => !(excludeWaiting && it.kind === "waiting"),
  );
  if (!isLoading && items.length === 0) return null;

  const openDetail = (item: ContinueWatchingItem) =>
    router.push({
      pathname: "/(auth)/(tabs)/(yozora)/detail" as any,
      params: { key: item.title.title_key },
    });

  const onPress = async (item: ContinueWatchingItem) => {
    if (item.kind === "waiting") {
      openDetail(item);
      return;
    }
    const itemKey = `${item.title.title_key}:${item.episode ?? ""}`;
    if (resolvingKey) return;
    setResolvingKey(itemKey);
    try {
      const res = await client.resolve({
        title_key: item.title.title_key,
        episode: item.episode ?? undefined,
      });
      const name = displayTitle(item.title, titleLanguage);
      pushToPlayer(router, res, {
        titleKey: item.title.title_key,
        episode: item.episode,
        displayName: item.episode
          ? `${name} · ${episodeLabel(item.episode)}`
          : name,
        jimakuQuery: jimakuTitle(item.title),
        startPositionSec: item.kind === "resume" ? item.position_sec : 0,
      });
    } catch (e) {
      if (e instanceof YozoraApiError && e.code !== "NETWORK_ERROR") {
        // NOTHING_CACHED etc. → the detail screen's picker explains it.
        openDetail(item);
      } else {
        toast.error("Couldn't reach the Yozora server");
      }
    } finally {
      setResolvingKey(null);
    }
  };

  return (
    <View className='mb-6'>
      <Text className='text-white text-lg font-bold mb-2.5'>
        Continue Watching
      </Text>
      {isLoading ? (
        <View
          style={{ height: CARD_H }}
          className='items-center justify-center'
        >
          <ActivityIndicator size='small' color='#888' />
        </View>
      ) : (
        <FlatList
          horizontal
          data={items}
          keyExtractor={(it) =>
            `${it.kind}:${it.title.title_key}:${it.episode ?? ""}`
          }
          showsHorizontalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ width: 10 }} />}
          renderItem={({ item }) => {
            const frac =
              item.kind === "resume"
                ? progressFraction(item.position_sec, item.duration_sec)
                : null;
            const busy =
              resolvingKey === `${item.title.title_key}:${item.episode ?? ""}`;
            const img = item.title.backdrop_url ?? item.title.poster_url;
            // Split tap targets (user request 2026-07-15): the THUMBNAIL
            // resumes playback; the title/subtitle text opens the detail page
            // (long-press on the thumbnail still opens detail too).
            return (
              <View style={{ width: CARD_W }}>
                <Pressable
                  onPress={() => onPress(item)}
                  onLongPress={() => openDetail(item)}
                  style={{
                    width: CARD_W,
                    height: CARD_H,
                    borderRadius: 10,
                    overflow: "hidden",
                    backgroundColor: "#1c1c1c",
                  }}
                >
                  {img ? (
                    <Image
                      source={{ uri: img }}
                      style={{ width: "100%", height: "100%" }}
                      contentFit='cover'
                      transition={140}
                    />
                  ) : null}
                  {busy ? (
                    <View
                      style={{
                        position: "absolute",
                        inset: 0,
                        backgroundColor: "rgba(0,0,0,0.5)",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <ActivityIndicator color='#fff' />
                    </View>
                  ) : null}
                  {frac != null ? (
                    <View
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: 0,
                        height: 3,
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
                </Pressable>
                <Pressable onPress={() => openDetail(item)} hitSlop={6}>
                  <Text
                    className='text-neutral-100 text-xs font-medium mt-1.5'
                    numberOfLines={1}
                  >
                    {displayTitle(item.title, titleLanguage)}
                  </Text>
                  <Text
                    className='text-neutral-500 text-[11px] mt-0.5'
                    numberOfLines={1}
                  >
                    {cwSubtitle(item)}
                  </Text>
                </Pressable>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}
