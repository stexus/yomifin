/*
 * Discover-style shelf for one Stremio catalog: header ("TMDB Popular · movie",
 * "See all ›") + a horizontal poster strip of the first page's items.
 *
 * Results are cached module-level so switching tabs doesn't refetch every shelf.
 */
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { Text } from "@/components/common/Text";
import useRouter from "@/hooks/useAppRouter";
import { fetchCatalog, type StremioMetaPreview } from "@/utils/stremio/client";

const shelfCache = new Map<string, StremioMetaPreview[]>();

const POSTER_W = 104;
const POSTER_H = 156;
const SHELF_LIMIT = 20;

interface Props {
  manifestUrl: string;
  type: string;
  id: string;
  name: string;
}

export default function CatalogShelf({ manifestUrl, type, id, name }: Props) {
  const router = useRouter();
  const cacheKey = `${manifestUrl}|${type}|${id}`;
  const [metas, setMetas] = useState<StremioMetaPreview[] | null>(
    () => shelfCache.get(cacheKey) ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (shelfCache.has(cacheKey)) {
      setMetas(shelfCache.get(cacheKey) ?? []);
      return;
    }
    let cancelled = false;
    setError(null);
    fetchCatalog(manifestUrl, type, id)
      .then((page) => {
        const trimmed = page.slice(0, SHELF_LIMIT);
        shelfCache.set(cacheKey, trimmed);
        if (!cancelled) setMetas(trimmed);
      })
      .catch((e) => {
        console.warn(`[STREMIO] shelf ${type}/${id} failed: ${e}`);
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, manifestUrl, type, id, nonce]);

  const openAll = () =>
    router.push({
      pathname: "/(auth)/(tabs)/(stremio)/catalog" as any,
      params: { manifestUrl, type, id, name },
    });

  return (
    <View className='mb-5'>
      <Pressable
        className='flex-row items-center justify-between mb-2 pr-1'
        onPress={openAll}
      >
        <View className='flex-row items-baseline'>
          <Text className='text-white text-base font-bold mr-2'>{name}</Text>
          <Text className='text-neutral-500 text-xs'>{type}</Text>
        </View>
        <Text className='text-purple-400 text-xs'>See all ›</Text>
      </Pressable>

      {metas === null && !error ? (
        <View
          style={{ height: POSTER_H }}
          className='items-center justify-center'
        >
          <ActivityIndicator size='small' color='#888' />
        </View>
      ) : null}

      {error ? (
        <Pressable onPress={() => setNonce((n) => n + 1)}>
          <Text className='text-red-400 text-xs'>
            Failed to load — tap to retry ({error})
          </Text>
        </Pressable>
      ) : null}

      {metas !== null && metas.length === 0 && !error ? (
        <Text className='text-neutral-500 text-xs'>Empty catalog</Text>
      ) : null}

      {metas !== null && metas.length > 0 ? (
        <FlatList
          horizontal
          data={metas}
          keyExtractor={(m) => m.id}
          showsHorizontalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ width: 8 }} />}
          renderItem={({ item }) => (
            <Pressable
              style={{ width: POSTER_W }}
              onPress={() =>
                router.push({
                  pathname: "/(auth)/(tabs)/(stremio)/meta" as any,
                  params: {
                    type: item.type ?? type,
                    id: item.id,
                    name: item.name ?? "",
                  },
                })
              }
            >
              <Image
                source={{ uri: item.poster }}
                style={{
                  width: POSTER_W,
                  height: POSTER_H,
                  borderRadius: 8,
                  backgroundColor: "#1c1c1c",
                }}
                contentFit='cover'
                transition={120}
              />
              <Text className='text-neutral-300 text-xs mt-1' numberOfLines={1}>
                {item.name ?? item.id}
              </Text>
            </Pressable>
          )}
        />
      ) : null}
    </View>
  );
}
