/*
 * Stremio catalog grid: posters for one addon catalog, paged via the `skip` extra.
 */
import { Image } from "expo-image";
import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/common/Text";
import useRouter from "@/hooks/useAppRouter";
import { fetchCatalog, type StremioMetaPreview } from "@/utils/stremio/client";

const COLUMNS = 3;

export default function StremioCatalogPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { manifestUrl, type, id, name } = useLocalSearchParams<{
    manifestUrl: string;
    type: string;
    id: string;
    name?: string;
  }>();

  const [metas, setMetas] = useState<StremioMetaPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [endReached, setEndReached] = useState(false);

  const loadPage = useCallback(
    async (skip: number) => {
      if (!manifestUrl || !type || !id) return;
      try {
        const page = await fetchCatalog(
          manifestUrl,
          type,
          id,
          skip > 0 ? { skip } : undefined,
        );
        if (page.length === 0) setEndReached(true);
        setMetas((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          return [...prev, ...page.filter((m) => !seen.has(m.id))];
        });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [manifestUrl, type, id],
  );

  useEffect(() => {
    setMetas([]);
    setLoading(true);
    setError(null);
    setEndReached(false);
    loadPage(0);
  }, [loadPage]);

  const posterW = (width - 16 * 2 - 8 * (COLUMNS - 1)) / COLUMNS;
  const posterH = posterW * 1.5;

  return (
    <View className='flex-1 bg-black'>
      <Stack.Screen options={{ headerTitle: name ?? id ?? "Catalog" }} />
      {loading ? (
        <View className='flex-1 items-center justify-center'>
          <ActivityIndicator color='#aaa' />
        </View>
      ) : error ? (
        <View className='flex-1 items-center justify-center px-8'>
          <Text className='text-red-400 text-center'>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={metas}
          numColumns={COLUMNS}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{
            paddingTop: insets.top + 56,
            paddingBottom: insets.bottom + 96,
            paddingHorizontal: 16,
          }}
          columnWrapperStyle={{ gap: 8 }}
          onEndReachedThreshold={1.5}
          onEndReached={() => {
            if (!endReached && metas.length > 0) loadPage(metas.length);
          }}
          renderItem={({ item }) => (
            <Pressable
              style={{ width: posterW, marginBottom: 14 }}
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
                  width: posterW,
                  height: posterH,
                  borderRadius: 8,
                  backgroundColor: "#1c1c1c",
                }}
                contentFit='cover'
                transition={120}
              />
              <Text className='text-neutral-200 text-xs mt-1' numberOfLines={2}>
                {item.name ?? item.id}
              </Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
