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

/** Draw-implementation version the RUNNING BINARY carries (see the Swift module). */
export const EXPECTED_RENDER_VERSION = 5;
let nativeRenderVersion = 0;

if (Platform.OS === "ios") {
  try {
    const nativeModule = requireOptionalNativeModule<{
      renderVersion?: number;
    }>("OutlinedText");
    if (nativeModule != null) {
      nativeRenderVersion = nativeModule.renderVersion ?? 1;
      NativeOutlinedTextView =
        requireNativeView<OutlinedTextViewProps>("OutlinedText");
    }
  } catch {
    NativeOutlinedTextView = null;
  }
}

/**
 * Repo convention: stale binaries must be provable from Metro logs, and probes
 * must fire at PLAYER time, not module-load time (boot-time logs get missed —
 * observed: user saw only the [GESTURE] mount-effect probes). Called from the
 * overlay's mount effect, once per player screen.
 *
 * A PRESENT-but-old module is the treacherous case: JS prop changes (widths,
 * weight) take effect while draw-code fixes silently don't.
 */
export function logOutlinedTextStatus(): void {
  if (Platform.OS !== "ios") return;
  console.log(
    NativeOutlinedTextView
      ? nativeRenderVersion >= EXPECTED_RENDER_VERSION
        ? `[YOMIFIN OUTLINE] native OutlinedText view: PRESENT, render v${nativeRenderVersion} (current)`
        : `[YOMIFIN OUTLINE] native OutlinedText view: PRESENT but render v${nativeRenderVersion} — STALE binary (JS expects v${EXPECTED_RENDER_VERSION}: bottom-aligned draw). Run \`just local\` / \`just remote\` and verify the install replaced the app.`
      : "[YOMIFIN OUTLINE] native OutlinedText view: MISSING — stale binary (run `just local` / `just remote`); using the JS stacked-copies fallback",
  );
}

/** Whether the native outlined-text view exists in the running binary. */
export function isOutlinedTextAvailable(): boolean {
  return NativeOutlinedTextView !== null;
}

export default NativeOutlinedTextView;
