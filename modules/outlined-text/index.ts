// Outlined Text — TextKit-stroked subtitle text with per-character tap hit-testing
// (yomifin tappable subtitle overlay; iOS/tvOS only, JS fallback elsewhere).

export type { OutlinedTextViewProps } from "./src/OutlinedText.types";
export {
  default as OutlinedTextView,
  isOutlinedTextAvailable,
  logOutlinedTextStatus,
} from "./src/OutlinedTextView";
