/*
 * Library section (PRG-10): the derived viewing state — Continue Watching +
 * Waiting (GET /library) followed by paginated History (GET /library/history)
 * with hide/unhide (PRG-9, long-press). No manual watchlist exists; everything
 * is computed server-side from progress.
 */
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Image } from "expo-image";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { toast } from "sonner-native";
import { Text } from "@/components/common/Text";
import useRouter from "@/hooks/useAppRouter";
import type { YozoraClient } from "@/utils/yozora/api";
import {
  cwSubtitle,
  displayTitle,
  type TitleLanguage,
} from "@/utils/yozora/display";
import type { LibraryHistoryItem } from "@/utils/yozora/types";
import ContinueWatchingRail from "../ContinueWatchingRail";

interface Props {
  client: YozoraClient;
  titleLanguage: TitleLanguage;
}

export default function LibrarySection({ client, titleLanguage }: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const library = useQuery({
    queryKey: ["yozora", "library"],
    queryFn: () => client.library(),
    refetchOnMount: "always",
    staleTime: 30 * 1000,
  });

  const history = useInfiniteQuery({
    queryKey: ["yozora", "library-history"],
    queryFn: ({ pageParam }) => client.libraryHistory(pageParam as number),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.has_more ? last.page + 1 : undefined),
    staleTime: 30 * 1000,
  });

  const historyItems = (history.data?.pages ?? []).flatMap((p) => p.items);

  const openDetail = (titleKey: string) =>
    router.push({
      pathname: "/(auth)/(tabs)/(yozora)/detail" as any,
      params: { key: titleKey },
    });

  const onLongPressHistory = (item: LibraryHistoryItem) => {
    Alert.alert(
      displayTitle(item.title, titleLanguage),
      undefined,
      [
        {
          text: item.hidden
            ? "Unhide from Continue Watching"
            : "Hide from Continue Watching",
          onPress: async () => {
            try {
              if (item.hidden) await client.unhideTitle(item.title.title_key);
              else await client.hideTitle(item.title.title_key);
              queryClient.invalidateQueries({ queryKey: ["yozora"] });
            } catch {
              toast.error("Failed to update");
            }
          },
        },
        { text: "Cancel", style: "cancel" },
      ],
      { cancelable: true },
    );
  };

  return (
    <ScrollView
      className='flex-1'
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingBottom: insets.bottom + 96,
      }}
    >
      <ContinueWatchingRail
        client={client}
        titleLanguage={titleLanguage}
        excludeWaiting
      />

      {/* Waiting (caught up, next episode has a known air date) */}
      {(library.data?.waiting ?? []).length > 0 ? (
        <View className='mb-6'>
          <Text className='text-white text-lg font-bold mb-2.5'>Waiting</Text>
          {(library.data?.waiting ?? []).map((item) => (
            <Pressable
              key={`${item.title.title_key}:${item.episode ?? ""}`}
              className='flex-row items-center bg-neutral-900 rounded-xl p-2 mb-2'
              onPress={() => openDetail(item.title.title_key)}
            >
              <View
                style={{
                  width: 44,
                  height: 62,
                  borderRadius: 6,
                  overflow: "hidden",
                  backgroundColor: "#1c1c1c",
                }}
              >
                {item.title.poster_url ? (
                  <Image
                    source={{ uri: item.title.poster_url }}
                    style={{ width: "100%", height: "100%" }}
                    contentFit='cover'
                  />
                ) : null}
              </View>
              <View className='flex-1 ml-3'>
                <Text className='text-white text-sm' numberOfLines={1}>
                  {displayTitle(item.title, titleLanguage)}
                </Text>
                <Text className='text-neutral-500 text-xs mt-0.5'>
                  {cwSubtitle(item)}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* History */}
      <Text className='text-white text-lg font-bold mb-2.5'>History</Text>
      {history.isLoading ? (
        <ActivityIndicator color='#888' style={{ marginVertical: 20 }} />
      ) : historyItems.length === 0 ? (
        <Text className='text-neutral-500 text-sm'>
          Nothing here yet — finished and stopped titles land here.
        </Text>
      ) : (
        <>
          {historyItems.map((item) => (
            <Pressable
              key={item.title.title_key}
              className='flex-row items-center bg-neutral-900 rounded-xl p-2 mb-2'
              onPress={() => openDetail(item.title.title_key)}
              onLongPress={() => onLongPressHistory(item)}
            >
              <View
                style={{
                  width: 44,
                  height: 62,
                  borderRadius: 6,
                  overflow: "hidden",
                  backgroundColor: "#1c1c1c",
                }}
              >
                {item.title.poster_url ? (
                  <Image
                    source={{ uri: item.title.poster_url }}
                    style={{ width: "100%", height: "100%" }}
                    contentFit='cover'
                  />
                ) : null}
              </View>
              <View className='flex-1 ml-3'>
                <Text className='text-white text-sm' numberOfLines={1}>
                  {displayTitle(item.title, titleLanguage)}
                </Text>
                <Text className='text-neutral-500 text-xs mt-0.5'>
                  {item.state === "finished" ? "Finished" : "Stopped"}
                  {item.hidden ? " · hidden" : ""}
                </Text>
              </View>
            </Pressable>
          ))}
          {history.hasNextPage ? (
            <Pressable
              className='bg-neutral-900 rounded-xl py-3 items-center mt-1'
              onPress={() => history.fetchNextPage()}
              disabled={history.isFetchingNextPage}
            >
              {history.isFetchingNextPage ? (
                <ActivityIndicator size='small' color='#888' />
              ) : (
                <Text className='text-purple-300 text-sm'>Load more</Text>
              )}
            </Pressable>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
