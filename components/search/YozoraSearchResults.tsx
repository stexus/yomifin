/*
 * Renders Yozora search hits (mixed kinds from GET /search) as labeled
 * horizontal shelves, clearly badged as Yozora-sourced. Tapping routes into
 * the (yozora) detail flow (sources → resolve → yomifin player).
 */
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Text } from "@/components/common/Text";
import { SourceBadge } from "@/components/search/SearchScopeSelector";
import useRouter from "@/hooks/useAppRouter";
import { useSettings } from "@/utils/atoms/settings";
import { displayTitle } from "@/utils/yozora/display";
import type { TitleSummary } from "@/utils/yozora/types";

const POSTER_W = 112;
const POSTER_H = 168;

function Shelf({ header, hits }: { header: string; hits: TitleSummary[] }) {
  const router = useRouter();
  const { settings } = useSettings();
  const titleLanguage = settings?.anilistTitleLanguage ?? "romaji";
  if (hits.length === 0) return null;
  return (
    <>
      <Text className='font-bold text-lg px-4 mb-2'>{header}</Text>
      <FlashList
        horizontal
        data={hits}
        keyExtractor={(h) => h.title_key}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }}
        ItemSeparatorComponent={() => <View style={{ width: 8 }} />}
        renderItem={({ item }) => (
          <Pressable
            style={{ width: POSTER_W }}
            onPress={() =>
              router.push({
                pathname: "/(auth)/(tabs)/(yozora)/detail" as any,
                params: { key: item.title_key },
              })
            }
          >
            <View>
              <Image
                source={{ uri: item.poster_url ?? undefined }}
                style={{
                  width: POSTER_W,
                  height: POSTER_H,
                  borderRadius: 8,
                  backgroundColor: "#1c1c1c",
                }}
                contentFit='cover'
                transition={120}
              />
              <SourceBadge source='yozora' />
            </View>
            <Text className='text-neutral-200 text-xs mt-1' numberOfLines={2}>
              {displayTitle(item, titleLanguage)}
            </Text>
            {item.year ? (
              <Text className='opacity-50 text-xs' numberOfLines={1}>
                {item.year}
              </Text>
            ) : null}
          </Pressable>
        )}
      />
    </>
  );
}

interface Props {
  hits: TitleSummary[];
  loading: boolean;
  unavailable: boolean;
}

export function YozoraSearchResults({ hits, loading, unavailable }: Props) {
  const anime = hits.filter((h) => h.kind === "anime");
  const movies = hits.filter((h) => h.kind === "movie");
  const shows = hits.filter((h) => h.kind === "show");

  if (unavailable) {
    return (
      <Text className='text-neutral-500 text-xs px-4 mt-2'>
        Yozora isn't connected — add the server in Settings → Yozora.
      </Text>
    );
  }

  return (
    <View>
      {loading ? (
        <View className='flex-row items-center px-4 mb-2'>
          <ActivityIndicator size='small' color='#a855f7' />
          <Text className='text-neutral-500 text-xs ml-2'>
            Searching Yozora…
          </Text>
        </View>
      ) : null}
      <Shelf header='Yozora · Anime' hits={anime} />
      <Shelf header='Yozora · Movies' hits={movies} />
      <Shelf header='Yozora · Shows' hits={shows} />
    </View>
  );
}
