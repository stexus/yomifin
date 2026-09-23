/*
 * Shared episode thumbnail (Yozora detail episode rows): renders a still if one
 * is available, else a clean cover-tinted "EP n" placeholder (recent/upcoming
 * anime often have no still from any source).
 */
import { Image } from "expo-image";
import { View } from "react-native";
import { Text } from "@/components/common/Text";

interface Props {
  thumbnail?: string | null;
  episodeNumber: number;
  accentColor?: string;
  width?: number;
  height?: number;
}

export default function EpisodeThumbnail({
  thumbnail,
  episodeNumber,
  accentColor = "#3a3a3a",
  width = 96,
  height = 54,
}: Props) {
  if (thumbnail) {
    return (
      <Image
        source={{ uri: thumbnail }}
        style={{ width, height, borderRadius: 6, backgroundColor: "#1c1c1c" }}
        contentFit='cover'
        transition={120}
      />
    );
  }
  return (
    <View
      style={{
        width,
        height,
        borderRadius: 6,
        overflow: "hidden",
        backgroundColor: `${accentColor}33`,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{ color: accentColor }}
        className='text-[9px] font-semibold tracking-widest'
      >
        EP
      </Text>
      <Text className='text-neutral-200 text-lg font-bold leading-5'>
        {episodeNumber}
      </Text>
    </View>
  );
}
