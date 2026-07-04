import type { StyleProp, ViewStyle } from "react-native";

export interface OutlinedTextViewProps {
  /** Text to render (may contain \n). */
  text: string;
  /** Font size in pt. */
  fontSize?: number;
  /** CSS-style numeric weight (600 = semibold). */
  fontWeight?: number;
  /** Fixed line height in pt (0/omitted = font default). */
  lineHeight?: number;
  /** Outline thickness in pt, drawn fully OUTSIDE the glyph edge (0 = none). */
  strokeWidth?: number;
  /** Fill color (default white). */
  textColor?: string;
  /** Outline color (default black). */
  strokeColor?: string;
  /** Tap on a glyph → character index into `text` (taps off-glyph are dropped). */
  onCharacterTap?: (e: { nativeEvent: { index: number } }) => void;
  /** Reports the laid-out text height (pt) for the given width; fires on change. */
  onMeasured?: (e: { nativeEvent: { height: number } }) => void;
  style?: StyleProp<ViewStyle>;
}
