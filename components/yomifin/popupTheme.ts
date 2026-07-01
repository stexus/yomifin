/*
 * Small theme object for the definition popup + structured-content renderer.
 *
 * Replaces the previously-hardcoded dark colors in DefinitionPopup/StructuredContent so
 * the popup can honor a light/dark/auto setting (yomifinPopupTheme). The app currently
 * forces a global dark color scheme (app/_layout.tsx: Appearance.setColorScheme("dark")),
 * so "auto" resolves to dark for now — a light theme is provided for the future.
 *
 * Per-dictionary tints derive from the ACTIVE theme: a dictionary's accent hex is
 * composited at low alpha over the theme background (`tintBg`) for a subtle block
 * boundary, with a slightly stronger left edge (`tintBorder`).
 */

export type PopupThemeMode = "light" | "dark" | "auto";

export interface PopupTheme {
  /** popup card background */
  bg: string;
  /** card / hairline border */
  cardBorder: string;
  /** primary body text */
  text: string;
  /** headword */
  term: string;
  /** reading + arrows/accents */
  reading: string;
  /** secondary text (index, dict name) */
  subtle: string;
  /** tertiary / hint text */
  faint: string;
  /** inflection chain */
  inflection: string;
  /** links */
  link: string;
  /** divider lines */
  divider: string;
  /** selected block background + border */
  selectedBg: string;
  selectedBorder: string;
  /** primary action button */
  accent: string;
  accentText: string;
  /** per-dict block tint from an accent hex */
  tintBg: (hex: string) => string;
  tintBorder: (hex: string) => string;
}

/** #rrggbb → "rgba(r,g,b,a)". Falls back to the raw string if not parseable. */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}

const DARK: PopupTheme = {
  bg: "rgba(20,20,22,0.97)",
  cardBorder: "rgba(255,255,255,0.15)",
  text: "#e5e5e5",
  term: "#ffffff",
  reading: "#9ecbff",
  subtle: "#aaaaaa",
  faint: "#888888",
  inflection: "#d6a35c",
  link: "#6cb6ff",
  divider: "rgba(255,255,255,0.12)",
  selectedBg: "rgba(108,182,255,0.16)",
  selectedBorder: "rgba(108,182,255,0.6)",
  accent: "#2d6cdf",
  accentText: "#ffffff",
  tintBg: (hex) => hexToRgba(hex, 0.1),
  tintBorder: (hex) => hexToRgba(hex, 0.55),
};

const LIGHT: PopupTheme = {
  bg: "rgba(250,250,252,0.98)",
  cardBorder: "rgba(0,0,0,0.15)",
  text: "#1c1c1e",
  term: "#000000",
  reading: "#1d64c9",
  subtle: "#555555",
  faint: "#888888",
  inflection: "#a8702a",
  link: "#1d64c9",
  divider: "rgba(0,0,0,0.12)",
  selectedBg: "rgba(29,100,201,0.12)",
  selectedBorder: "rgba(29,100,201,0.6)",
  accent: "#2d6cdf",
  accentText: "#ffffff",
  tintBg: (hex) => hexToRgba(hex, 0.16),
  tintBorder: (hex) => hexToRgba(hex, 0.6),
};

/** Resolve a theme mode to a concrete theme. "auto" → dark (app is dark-only for now). */
export function getPopupTheme(mode: PopupThemeMode | undefined): PopupTheme {
  return mode === "light" ? LIGHT : DARK;
}
