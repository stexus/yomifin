/*
 * YOMIFIN unified native gesture surface (iOS).
 *
 * One UIKit tap-recognizer tree (single / double / two-finger) rendered where
 * GestureOverlay's dim View sits. See ios/GestureSurfaceView.swift for the full
 * design rationale (why taps are native and why PAN stays an RNGH worklet).
 *
 * Availability is a SYNCHRONOUS probe (requireOptionalNativeModule): a stale
 * binary — or Android, where the module isn't built — yields null and
 * GestureOverlay falls back to the legacy RNGH tap tree + the MpvPlayerView
 * window two-finger seam (still present in old binaries), i.e. exactly the
 * previously-shipped behavior.
 */
import { requireNativeView, requireOptionalNativeModule } from "expo";
import type * as React from "react";
import type { StyleProp, ViewStyle } from "react-native";

export interface GestureSurfaceTapEvent {
  nativeEvent: { x: number; y: number };
}

export interface GestureSurfaceViewProps {
  style?: StyleProp<ViewStyle>;
  /** Wires/unwires the doubleTap require(toFail:) chain natively. */
  doubleTapEnabled?: boolean;
  /**
   * Inter-tap window for double-tap recognition (= single-tap latency while
   * double-tap seek is on). Native default 220ms; UIKit's stock window (~350ms)
   * was device-verified as sluggish. Requires apiVersion ≥ 2 (silently ignored
   * by a v1 binary — which then keeps the stock window).
   */
  doubleTapMaxIntervalMs?: number;
  onSingleTap?: (event: GestureSurfaceTapEvent) => void;
  onDoubleTap?: (event: GestureSurfaceTapEvent) => void;
  onTwoFingerTap?: () => void;
}

const nativeModule = requireOptionalNativeModule<{ apiVersion(): number }>(
  "YomifinGestureSurface",
);

/**
 * 0 = module absent (stale binary / Android); v1 = stock ~350ms double-tap window;
 * v2 = configurable window. See GestureSurfaceModule.swift.
 */
export function gestureSurfaceVersion(): number {
  try {
    return nativeModule?.apiVersion() ?? 0;
  } catch {
    return 0;
  }
}

export const isGestureSurfaceAvailable = gestureSurfaceVersion() >= 1;

let nativeView: React.ComponentType<GestureSurfaceViewProps> | null = null;
if (isGestureSurfaceAvailable) {
  try {
    nativeView = requireNativeView<GestureSurfaceViewProps>(
      "YomifinGestureSurface",
    );
  } catch {
    nativeView = null;
  }
}

export const GestureSurfaceView = nativeView;
