import { requireNativeView, requireOptionalNativeModule } from "expo";
import type * as React from "react";
import { Platform } from "react-native";

import type { OutlinedTextViewProps } from "./OutlinedText.types";

/**
 * Native TextKit-stroked text view (yomifin subtitle overlay). iOS/tvOS only —
 * null when the platform (or a stale binary that predates the module) doesn't
 * provide it; callers MUST fall back to RN rendering in that case.
 *
 * Availability gate: `requireOptionalNativeModule`, NOT try/catch around
 * `requireNativeView` — on the New Architecture requireNativeView doesn't throw
 * for a missing module, it returns a component that renders Fabric's
 * "Unimplemented component: ViewManagerAdapter_OutlinedText" placeholder at
 * runtime (observed on device on a stale binary).
 */
let NativeOutlinedTextView: React.ComponentType<OutlinedTextViewProps> | null =
  null;

if (Platform.OS === "ios") {
  try {
    const nativeModule = requireOptionalNativeModule("OutlinedText");
    if (nativeModule != null) {
      NativeOutlinedTextView =
        requireNativeView<OutlinedTextViewProps>("OutlinedText");
    }
  } catch {
    NativeOutlinedTextView = null;
  }
  // Repo convention: stale binaries must be provable from Metro logs.
  console.log(
    NativeOutlinedTextView
      ? "[YOMIFIN OUTLINE] native OutlinedText view: PRESENT"
      : "[YOMIFIN OUTLINE] native OutlinedText view: MISSING — stale binary (run `just local` / `just remote`); using the JS stacked-copies fallback",
  );
}

/** Whether the native outlined-text view exists in the running binary. */
export function isOutlinedTextAvailable(): boolean {
  return NativeOutlinedTextView !== null;
}

export default NativeOutlinedTextView;
