/*
 * Yozora poster card for a TitleSummary (anime/movie/show alike): cover-forward,
 * rounded, AniList-style score pill, format/year footer. Routes to the yozora
 * detail screen by canonical title_key. Used by rails and grids (width passed in).
 */
import { Image } from "expo-image";
import { Pressable, View } from "react-native";
import { Text } from "@/components/common/Text";
import useRouter from "@/hooks/useAppRouter";
import {
  displayTitle,
  ratingPercent,
  scoreColor,
  type TitleLanguage,
} from "@/utils/yozora/display";
import type { TitleSummary } from "@/utils/yozora/types";

export function ScorePill({ rating }: { rating?: number | null }) {
  const pct = ratingPercent(rating);
  if (pct == null) return null;
  return (
    <View
      style={{
        position: "absolute",
        top: 6,
        left: 6,
        backgroundColor: scoreColor(pct),
        borderRadius: 6,
        paddingHorizontal: 6,
        paddingVertical: 2,
      }}
    >
      <Text style={{ color: "white", fontSize: 11, fontWeight: "700" }}>
        {pct}%
      </Text>
    </View>
  );
}

interface Props {
  title: TitleSummary;
  width: number;
  titleLanguage?: TitleLanguage;
  /** Show the year/kind footer line (default true). */
  showMeta?: boolean;
}

export default function TitleCard({
  title,
  width,
  titleLanguage = "romaji",
  showMeta = true,
}: Props) {
  const router = useRouter();
  const height = width * 1.42;

  return (
    <Pressable
      style={{ width }}
      onPress={() =>
        router.push({
          pathname: "/(auth)/(tabs)/(yozora)/detail" as any,
          params: { key: title.title_key },
        })
      }
    >
      <View
        style={{
          width,
          height,
          borderRadius: 10,
          overflow: "hidden",
          backgroundColor: "#1c1c1c",
          borderWidth: 1,
          borderColor: "#2a2a2a",
        }}
      >
        {title.poster_url ? (
          <Image
            source={{ uri: title.poster_url }}
            style={{ width: "100%", height: "100%" }}
            contentFit='cover'
            transition={140}
          />
        ) : (
          <View className='flex-1 items-center justify-center px-2'>
            <Text className='text-neutral-600 text-xs text-center'>
              {displayTitle(title, titleLanguage)}
            </Text>
          </View>
        )}
        <ScorePill rating={title.rating} />
      </View>
      <Text
        className='text-neutral-100 text-xs font-medium mt-1.5'
        numberOfLines={2}
        style={{ lineHeight: 15 }}
      >
        {displayTitle(title, titleLanguage)}
      </Text>
      {showMeta ? (
        <Text className='text-neutral-500 text-[11px] mt-0.5' numberOfLines={1}>
          {[
            title.kind === "anime"
              ? "Anime"
              : title.kind === "movie"
                ? "Movie"
                : "Show",
            title.year ? String(title.year) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      ) : null}
    </Pressable>
  );
}
