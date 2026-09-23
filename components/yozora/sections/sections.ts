/** The Yozora tab's internal section switcher (chips, not more tabs). */
export type YozoraSection = "home" | "anime" | "movies" | "shows" | "library";

export const SECTIONS: { key: YozoraSection; label: string }[] = [
  { key: "home", label: "Home" },
  { key: "anime", label: "Anime" },
  { key: "movies", label: "Movies" },
  { key: "shows", label: "Shows" },
  { key: "library", label: "Library" },
];
