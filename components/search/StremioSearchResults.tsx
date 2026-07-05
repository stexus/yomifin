/*
 * Renders Stremio search hits (movie/series) as labeled horizontal shelves,
 * clearly badged as Stremio-sourced. Tapping routes into the existing Stremio
 * meta flow (which resolves debrid streams + the yomifin player).
 */
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Text } from "@/components/common/Text";
import { SourceBadge } from "@/components/search/SearchScopeSelector";
import useRouter from "@/hooks/useAppRouter";
import type { StremioSearchHit } from "@/utils/stremio/client";

const POSTER_W = 112;
const POSTER_H = 168;

function Shelf({ header, hits }: { header: string; hits: StremioSearchHit[] }) {
  const router = useRouter();
  if (hits.length === 0) return null;
  return (
    <>
      <Text className='font-bold text-lg px-4 mb-2'>{header}</Text>
      <FlashList
        horizontal
        data={hits}
        keyExtractor={(h) => h.meta.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }}
        ItemSeparatorComponent={() => <View style={{ width: 8 }} />}
        renderItem={({ item }) => (
          <Pressable
            style={{ width: POSTER_W }}
            onPress={() =>
              router.push({
                pathname: "/(auth)/(tabs)/(stremio)/meta" as any,
                params: {
                  type: item.meta.type ?? "series",
                  id: item.meta.id,
                  name: item.meta.name ?? "",
                },
              })
            }
          >
            <View>
              <Image
                source={{ uri: item.meta.poster }}
                style={{
                  width: POSTER_W,
                  height: POSTER_H,
                  borderRadius: 8,
                  backgroundColor: "#1c1c1c",
                }}
                contentFit='cover'
                transition={120}
              />
              <SourceBadge source='stremio' detail={item.addonName} />
            </View>
            <Text className='text-neutral-200 text-xs mt-1' numberOfLines={2}>
              {item.meta.name ?? item.meta.id}
            </Text>
            {item.meta.releaseInfo ? (
              <Text className='opacity-50 text-xs' numberOfLines={1}>
                {item.meta.releaseInfo}
              </Text>
            ) : null}
          </Pressable>
        )}
      />
    </>
  );
}

interface Props {
  hits: StremioSearchHit[];
  loading: boolean;
  unavailable: boolean;
}

export function StremioSearchResults({ hits, loading, unavailable }: Props) {
  const movies = hits.filter((h) => h.meta.type === "movie");
  const series = hits.filter((h) => h.meta.type !== "movie");

  if (unavailable) {
    return (
      <Text className='text-neutral-500 text-xs px-4 mt-2'>
        No Stremio addons with a searchable catalog are configured — add one in
        the Stremio tab.
      </Text>
    );
  }

  return (
    <View>
      {loading ? (
        <View className='flex-row items-center px-4 mb-2'>
          <ActivityIndicator size='small' color='#a855f7' />
          <Text className='text-neutral-500 text-xs ml-2'>
            Searching Stremio…
          </Text>
        </View>
      ) : null}
      <Shelf header='Stremio · Movies' hits={movies} />
      <Shelf header='Stremio · Series' hits={series} />
    </View>
  );
}
