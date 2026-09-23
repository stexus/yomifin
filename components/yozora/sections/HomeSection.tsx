/*
 * Yozora Home section (mirrors the web shell's landing, WEB-1): pure
 * client-side composition — Continue Watching rail first, then a hardcoded
 * rail-config array of discovery rails (anime + movies + shows), then addon
 * shelf rails from GET /shelves. "See all →" activates the matching section
 * chip. A future server-side home-config replaces the array, no restructure.
 */
import { useQuery } from "@tanstack/react-query";
import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { YozoraClient } from "@/utils/yozora/api";
import type { TitleLanguage } from "@/utils/yozora/display";
import ContinueWatchingRail from "../ContinueWatchingRail";
import ShelfRail from "../ShelfRail";
import type { YozoraSection } from "./sections";

interface Props {
  client: YozoraClient;
  titleLanguage: TitleLanguage;
  onGoToSection: (section: YozoraSection) => void;
}

export default function HomeSection({
  client,
  titleLanguage,
  onGoToSection,
}: Props) {
  const insets = useSafeAreaInsets();

  // The rail config: plain array in code (decided 2026-07-12).
  const rails: {
    key: string;
    title: string;
    section: YozoraSection;
    fetch: () => Promise<import("@/utils/yozora/types").TitleSummary[]>;
  }[] = [
    {
      key: "home-anime-trending",
      title: "Trending anime",
      section: "anime",
      fetch: () =>
        client.discoverAnime({ sort: "trending" }).then((r) => r.items),
    },
    {
      key: "home-anime-airing",
      title: "Airing soon",
      section: "anime",
      fetch: () =>
        client.discoverAnime({ sort: "airing" }).then((r) => r.items),
    },
    {
      key: "home-movies-trending",
      title: "Trending movies",
      section: "movies",
      fetch: () =>
        client.discoverMovies({ sort: "trending" }).then((r) => r.items),
    },
    {
      key: "home-shows-trending",
      title: "Trending shows",
      section: "shows",
      fetch: () =>
        client.discoverShows({ sort: "trending" }).then((r) => r.items),
    },
    {
      key: "home-shows-top",
      title: "Top-rated shows",
      section: "shows",
      fetch: () =>
        client.discoverShows({ sort: "rating" }).then((r) => r.items),
    },
  ];

  // Addon shelf rails (ADN-6) appended after the discovery rails.
  const shelves = useQuery({
    queryKey: ["yozora", "shelves"],
    queryFn: () => client.shelves(),
    staleTime: 10 * 60 * 1000,
  });

  return (
    <ScrollView
      className='flex-1'
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingBottom: insets.bottom + 96,
      }}
      keyboardShouldPersistTaps='handled'
    >
      <ContinueWatchingRail client={client} titleLanguage={titleLanguage} />
      {rails.map((r) => (
        <ShelfRail
          key={r.key}
          railKey={r.key}
          title={r.title}
          fetchItems={r.fetch}
          titleLanguage={titleLanguage}
          onSeeAll={() => onGoToSection(r.section)}
        />
      ))}
      {(shelves.data?.items ?? []).map((shelf) => (
        <ShelfRail
          key={`shelf-${shelf.id}`}
          railKey={`shelf-${shelf.id}`}
          title={shelf.name}
          fetchItems={() => client.shelfItems(shelf.id).then((r) => r.items)}
          titleLanguage={titleLanguage}
        />
      ))}
    </ScrollView>
  );
}
