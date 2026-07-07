/*
 * AniList-styled poster card: cover-forward, rounded, with a colored score pill
 * and a format/episode footer. Genre/cover-tinted border accent. Used by both the
 * horizontal shelves and the browse grid (width is passed in).
 */
import { Image } from "expo-image";
import { Pressable, View } from "react-native";
import { Text } from "@/components/common/Text";
import useRouter from "@/hooks/useAppRouter";
import {
  type AnilistMediaPreview,
  coverUrl,
  displayTitle,
  formatLabel,
  scoreColor,
  type TitleLanguage,
} from "@/utils/anilist/client";

interface Props {
  media: AnilistMediaPreview;
  width: number;
  titleLanguage?: TitleLanguage;
  /** Show the format · episodes footer line (default true). */
  showMeta?: boolean;
}

export function ScorePill({ score }: { score?: number | null }) {
  if (score == null) return null;
  return (
    <View
      style={{
        position: "absolute",
        top: 6,
        left: 6,
        backgroundColor: scoreColor(score),
        borderRadius: 6,
        paddingHorizontal: 6,
        paddingVertical: 2,
        flexDirection: "row",
        alignItems: "center",
      }}
    >
      <Text style={{ color: "white", fontSize: 11, fontWeight: "700" }}>
        {score}%
      </Text>
    </View>
  );
}

export default function AnimeCard({
  media,
  width,
  titleLanguage = "romaji",
  showMeta = true,
}: Props) {
  const router = useRouter();
  const height = width * 1.42;
  const accent = media.coverImage?.color ?? "#2a2a2a";

  return (
    <Pressable
      style={{ width }}
      onPress={() =>
        router.push({
          pathname: "/(auth)/(tabs)/(anime)/detail" as any,
          params: { id: String(media.id) },
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
          borderColor: `${accent}55`,
        }}
      >
        <Image
          source={{ uri: coverUrl(media) }}
          style={{ width: "100%", height: "100%" }}
          contentFit='cover'
          transition={140}
        />
        <ScorePill score={media.averageScore} />
      </View>
      <Text
        className='text-neutral-100 text-xs font-medium mt-1.5'
        numberOfLines={2}
        style={{ lineHeight: 15 }}
      >
        {displayTitle(media, titleLanguage)}
      </Text>
      {showMeta ? (
        <Text className='text-neutral-500 text-[11px] mt-0.5' numberOfLines={1}>
          {[
            formatLabel(media.format),
            media.episodes ? `${media.episodes} ep` : null,
            media.seasonYear ? String(media.seasonYear) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      ) : null}
    </Pressable>
  );
}
