/*
 * Video gesture layer — unified design (FEATURES "all-native gesture surface" +
 * "drag-anywhere-to-seek, done right").
 *
 * TAPS are native. When the binary has the YomifinGestureSurface module
 * (modules/gesture-surface), ALL tap gestures — single tap (toggle controls),
 * double tap (±s seek, left/right half), two-finger tap (play/pause) — are one
 * UIKit recognizer tree on a native view mounted right here (above the video,
 * below buttons). UIKit's require(toFail:) does the disambiguation, so there are
 * NO grace delays, NO tapSuppression, NO twoFingerNonce on this path.
 *
 * PAN is an RNGH worklet — deliberately NOT native. Drag-anywhere-to-seek writes
 * SharedValues from a worklet onUpdate (UI thread, zero per-frame bridge traffic;
 * the reverted attempt 1 died on per-frame runOnJS). Taps and pans are disjoint by
 * UIKit semantics (movement fails taps; pan needs minDistance 10), so the native
 * tap tree and the RNGH pan coexist with no coupling.
 *
 * Pan modes (decided at activation, like before):
 *   - horizontal + yomifinDragSeekEnabled → SCRUB: pause, track finger
 *     (full width = full duration, like the seek bar), ScrubBubble preview
 *     (trickplay tile + UI-thread timestamp), commit seek exactly once on
 *     release/cancel, resume if it was playing.
 *   - horizontal, drag-seek off → legacy flick-to-skip ±s (enableHorizontalSwipeSkip).
 *   - vertical → brightness (left) / volume (right); 15% top/bottom exclusion zones.
 *
 * LEGACY FALLBACK (stale binary / Android): the previous shipped design — RNGH
 * Exclusive(doubleTap, singleTap) with the ~80ms suppression grace, plus the
 * MpvPlayerView window-level two-finger seam (v2) handled in direct-player, whose
 * `twoFingerNonce` prop still drives the feedback bubble. Old binaries still
 * contain that window recognizer; v3 binaries removed it, so exactly one
 * two-finger path is ever live. Delete the fallback once the surface is
 * device-verified everywhere.
 *
 * Hard-won constraint (unchanged): NEVER mix RN touch responders
 * (Pressable/onTouch*) with RNGH over the player, and dim via backgroundColor
 * rgba, NEVER via `opacity` (UIKit hit-testing ignores alpha ≤ 0.01 views).
 */
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  runOnJS,
  type SharedValue,
  useSharedValue,
} from "react-native-reanimated";
import { Text } from "@/components/common/Text";
import { useHaptic } from "@/hooks/useHaptic";
import {
  type GestureSurfaceTapEvent,
  GestureSurfaceView,
  gestureSurfaceVersion,
  isGestureSurfaceAvailable,
} from "@/modules/gesture-surface";
import { useSettings } from "@/utils/atoms/settings";
import { useVolumeAndBrightness } from "./hooks/useVolumeAndBrightness";
import {
  ScrubBubble,
  type ScrubTrickplayInfo,
  type ScrubTrickplayUrl,
} from "./ScrubBubble";
import { tapsSuppressed } from "./tapSuppression";

// LEGACY path only — grace delay before executing an RNGH-recognized single/double
// tap, long enough for the old binaries' window two-finger event to cross the bridge
// and stamp suppression. The native surface path needs none of this.
const GRACE_MS = 80;

// Double-tap inter-tap window (= single-tap latency while double-tap seek is on).
// UIKit's stock ~350ms was device-verified as sluggish; needs surface apiVersion ≥ 2
// (a v1 binary ignores the prop and keeps the stock window).
const DOUBLE_TAP_WINDOW_MS = 220;

// Pan mode constants shared between the worklet and JS (plain numbers: worklets
// capture primitives cheaply).
const MODE_NONE = 0;
const MODE_SCRUB = 1;
const MODE_FLICK = 2;
const MODE_BRIGHTNESS = 3;
const MODE_VOLUME = 4;

interface Props {
  screenWidth: number;
  screenHeight: number;
  showControls: boolean;
  isPlaying: boolean;
  onToggleControls: () => void;
  /** LEGACY binaries: bumped by the player on every window-seam two-finger tap. */
  twoFingerNonce?: number;
  /** Signed relative seek in seconds (double-tap seek). */
  onSeekRelative: (seconds: number) => void;
  onSkipForward: () => void;
  onSkipBackward: () => void;
  /** Two-finger tap → play/pause (native gesture-surface path). */
  onTogglePlay?: () => void;
  /**
   * Legacy full-screen dim behind the controls. Both players now use
   * ControlsScrims instead (no dim) and leave this false; kept for opt-in reuse.
   */
  dimWhenControlsShown?: boolean;
  // ---- drag-anywhere-to-seek (all optional; absent = flick-skip only) ----
  /** Player progress in ms — written live during a scrub (slider tracks free). */
  progress?: SharedValue<number>;
  /** Duration in ms. */
  max?: SharedValue<number>;
  /** Set true during a scrub so progress events don't fight the drag. */
  isSeeking?: SharedValue<boolean>;
  /** Pause + remember was-playing. Called once at scrub activation. */
  onScrubStart?: () => void;
  /** Throttled (~120ms) preview position, ms → trickplay tile prefetch. */
  onScrubPreview?: (ms: number) => void;
  /** Commit: seek to ms + resume if was playing. Called exactly once. */
  onScrubEnd?: (ms: number) => void;
  trickPlayUrl?: ScrubTrickplayUrl | null;
  trickplayInfo?: ScrubTrickplayInfo | null;
}

interface FeedbackState {
  visible: boolean;
  icon: string;
  text: string;
  side?: "left" | "right";
}

export const GestureOverlay = ({
  screenWidth,
  screenHeight,
  showControls,
  isPlaying,
  onToggleControls,
  twoFingerNonce,
  onSeekRelative,
  onSkipForward,
  onSkipBackward,
  onTogglePlay,
  progress,
  max,
  isSeeking,
  onScrubStart,
  onScrubPreview,
  onScrubEnd,
  trickPlayUrl,
  trickplayInfo,
  dimWhenControlsShown = false,
}: Props) => {
  const { settings } = useSettings();
  const lightHaptic = useHaptic("light");

  const surfaceActive = isGestureSurfaceAvailable && GestureSurfaceView != null;
  useEffect(() => {
    console.log(
      surfaceActive
        ? `[GESTURE] native gesture surface: PRESENT v${gestureSurfaceVersion()} (unified UIKit taps; RNGH owns pan only${
            gestureSurfaceVersion() >= 2
              ? ""
              : "; v1 — stock ~350ms double-tap window, rebuild for the snappier single tap"
          })`
        : "[GESTURE] native gesture surface: MISSING — legacy RNGH taps + window two-finger seam in effect. Rebuild (`just local`/`just remote`) to unify.",
    );
  }, [surfaceActive]);

  const [feedback, setFeedback] = useState<FeedbackState>({
    visible: false,
    icon: "",
    text: "",
  });
  const [fadeAnim] = useState(new Animated.Value(0));
  const isDraggingRef = useRef(false);
  const hideScheduledRef = useRef(false);
  const hideTimeoutRef = useRef<number | null>(null);
  const lastUpdateTime = useRef(0);

  const showFeedback = useCallback(
    (
      icon: string,
      text: string,
      side?: "left" | "right",
      isDuringDrag = false,
    ) => {
      requestAnimationFrame(() => {
        setFeedback({ visible: true, icon, text, side });

        if (!isDuringDrag) {
          hideScheduledRef.current = false;
          Animated.sequence([
            Animated.timing(fadeAnim, {
              toValue: 1,
              duration: 200,
              useNativeDriver: true,
            }),
            Animated.delay(1000),
            Animated.timing(fadeAnim, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }),
          ]).start(() => {
            requestAnimationFrame(() => {
              setFeedback((prev) => ({ ...prev, visible: false }));
            });
          });
        } else if (!isDraggingRef.current && !hideScheduledRef.current) {
          // Cancel any pending hide from a previous drag
          if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current);
            hideTimeoutRef.current = null;
          }
          hideScheduledRef.current = false;
          isDraggingRef.current = true;
          fadeAnim.stopAnimation();
          fadeAnim.setValue(1);
        }
      });
    },
    [fadeAnim],
  );

  const hideDragFeedback = useCallback(() => {
    isDraggingRef.current = false;
    hideScheduledRef.current = true;
    hideTimeoutRef.current = setTimeout(() => {
      fadeAnim.stopAnimation();
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        requestAnimationFrame(() => {
          setFeedback((prev) => ({ ...prev, visible: false }));
          hideScheduledRef.current = false;
        });
      });
    }, 100) as unknown as number;
  }, [fadeAnim]);

  const {
    startVolumeDrag,
    updateVolumeDrag,
    endVolumeDrag,
    startBrightnessDrag,
    updateBrightnessDrag,
    endBrightnessDrag,
  } = useVolumeAndBrightness({
    onVolumeChange: (volume: number) => {
      const now = Date.now();
      if (now - lastUpdateTime.current < 50) return; // 50ms throttle
      lastUpdateTime.current = now;
      requestAnimationFrame(() => {
        showFeedback("volume-high", `${volume}%`, "right", true);
      });
    },
    onBrightnessChange: (brightness: number) => {
      const now = Date.now();
      if (now - lastUpdateTime.current < 50) return; // 50ms throttle
      lastUpdateTime.current = now;
      requestAnimationFrame(() => {
        showFeedback("sunny", `${brightness}%`, "left", true);
      });
    },
  });

  // ---- gesture actions (plain JS; called from worklets via runOnJS) ---------------

  const doubleTapSeconds = settings.yomifinDoubleTapSeconds ?? 10;
  const dragSeekEnabled =
    (settings.yomifinDragSeekEnabled ?? true) &&
    !!progress &&
    !!max &&
    !!onScrubEnd;

  // Feedback bubble for the LEGACY window-seam two-finger tap (the toggle already
  // happened in the player; state updates are batched, so isPlaying is post-toggle
  // here — show the resulting state). No bubble while controls are up.
  const lastTwoFingerNonceRef = useRef(twoFingerNonce ?? 0);
  useEffect(() => {
    const nonce = twoFingerNonce ?? 0;
    if (nonce === lastTwoFingerNonceRef.current) return;
    lastTwoFingerNonceRef.current = nonce;
    if (showControls) return;
    showFeedback(isPlaying ? "play" : "pause", "");
  }, [twoFingerNonce, isPlaying, showControls, showFeedback]);

  const handleDoubleTap = useCallback(
    (x: number) => {
      if (doubleTapSeconds <= 0) return;
      console.log(
        "[GESTURE] double-tap seek",
        x >= screenWidth / 2 ? "+" : "-",
      );
      lightHaptic();
      const forward = x >= screenWidth / 2;
      onSeekRelative(forward ? doubleTapSeconds : -doubleTapSeconds);
      // No bubble while controls are up (the progress bar shows the jump).
      if (!showControls)
        showFeedback(
          forward ? "play-forward" : "play-back",
          `${forward ? "+" : "-"}${doubleTapSeconds}s`,
          forward ? "right" : "left",
        );
    },
    [
      doubleTapSeconds,
      lightHaptic,
      screenWidth,
      onSeekRelative,
      showControls,
      showFeedback,
    ],
  );

  const handleSkipForward = useCallback(() => {
    if (!settings.enableHorizontalSwipeSkip) return;
    lightHaptic();
    requestAnimationFrame(() => {
      onSkipForward();
      if (!showControls)
        showFeedback("play-forward", `+${settings.forwardSkipTime}s`);
    });
  }, [
    settings.enableHorizontalSwipeSkip,
    settings.forwardSkipTime,
    lightHaptic,
    onSkipForward,
    showControls,
    showFeedback,
  ]);

  const handleSkipBackward = useCallback(() => {
    if (!settings.enableHorizontalSwipeSkip) return;
    lightHaptic();
    requestAnimationFrame(() => {
      onSkipBackward();
      if (!showControls)
        showFeedback("play-back", `-${settings.rewindSkipTime}s`);
    });
  }, [
    settings.enableHorizontalSwipeSkip,
    settings.rewindSkipTime,
    lightHaptic,
    onSkipBackward,
    showControls,
    showFeedback,
  ]);

  // Mutable "latest" refs so stable JS bridge functions never hold stale closures.
  const actionsRef = useRef({
    onToggleControls,
    handleDoubleTap,
    handleSkipForward,
    handleSkipBackward,
    startVolumeDrag,
    updateVolumeDrag,
    endVolumeDrag,
    startBrightnessDrag,
    updateBrightnessDrag,
    endBrightnessDrag,
    hideDragFeedback,
    lightHaptic,
    showFeedback,
    settings,
    showControls,
    isPlaying,
    onTogglePlay,
    onScrubStart,
    onScrubPreview,
    onScrubEnd,
  });
  actionsRef.current = {
    onToggleControls,
    handleDoubleTap,
    handleSkipForward,
    handleSkipBackward,
    startVolumeDrag,
    updateVolumeDrag,
    endVolumeDrag,
    startBrightnessDrag,
    updateBrightnessDrag,
    endBrightnessDrag,
    hideDragFeedback,
    lightHaptic,
    showFeedback,
    settings,
    showControls,
    isPlaying,
    onTogglePlay,
    onScrubStart,
    onScrubPreview,
    onScrubEnd,
  };

  // ---- native surface tap handlers (no suppression, no grace delays) --------------

  const handleSurfaceSingleTap = useCallback(() => {
    console.log("[GESTURE] single tap (native) → toggle controls");
    actionsRef.current.onToggleControls();
  }, []);

  const handleSurfaceDoubleTap = useCallback((e: GestureSurfaceTapEvent) => {
    actionsRef.current.handleDoubleTap(e.nativeEvent?.x ?? 0);
  }, []);

  const handleSurfaceTwoFingerTap = useCallback(() => {
    const a = actionsRef.current;
    if (!(a.settings.yomifinTwoFingerTapPause ?? true)) return;
    if (!a.onTogglePlay) return;
    console.log("[GESTURE] two-finger tap (native surface) → toggle play");
    a.onTogglePlay();
    // isPlaying here is PRE-toggle: show the RESULTING state (pausing → pause icon),
    // matching the legacy nonce path. No bubble while controls are up.
    if (!a.showControls) a.showFeedback(a.isPlaying ? "pause" : "play", "");
  }, []);

  // ---- worklet↔JS bridges for the pan (stable forever; read latest via ref) --------

  const jsVerticalStart = useCallback((side: "left" | "right", y: number) => {
    const a = actionsRef.current;
    a.lightHaptic();
    if (side === "left") a.startBrightnessDrag(y);
    else a.startVolumeDrag(y);
  }, []);
  const jsVerticalUpdate = useCallback(
    (side: "left" | "right", translationY: number) => {
      const a = actionsRef.current;
      if (side === "left") a.updateBrightnessDrag(translationY);
      else a.updateVolumeDrag(translationY);
    },
    [],
  );
  const jsVerticalEnd = useCallback((side: "left" | "right") => {
    const a = actionsRef.current;
    if (side === "left") a.endBrightnessDrag();
    else a.endVolumeDrag();
    a.hideDragFeedback();
  }, []);
  const jsFlick = useCallback((direction: number) => {
    const a = actionsRef.current;
    if (direction > 0) a.handleSkipForward();
    else a.handleSkipBackward();
  }, []);
  const jsScrubStart = useCallback(() => {
    const a = actionsRef.current;
    a.lightHaptic();
    a.onScrubStart?.();
  }, []);
  const jsScrubPreview = useCallback((ms: number) => {
    actionsRef.current.onScrubPreview?.(ms);
  }, []);
  const jsScrubEnd = useCallback((ms: number) => {
    console.log(`[GESTURE] drag-seek commit → ${Math.round(ms / 1000)}s`);
    actionsRef.current.onScrubEnd?.(ms);
  }, []);

  // ---- pan bookkeeping (SharedValues: the pan callbacks are WORKLETS) --------------

  const panIgnored = useSharedValue(0);
  const panMode = useSharedValue(MODE_NONE);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  const panStartT = useSharedValue(0);
  const scrubStartMs = useSharedValue(0);
  const scrubMs = useSharedValue(0);
  const scrubActive = useSharedValue(0);
  const lastPreviewT = useSharedValue(0);

  // One recognizer tree. Rebuilt only when a captured setting/dimension changes
  // (rebuilding per render is what makes recognizers "fight"; avoid it).
  const composedGesture = useMemo(() => {
    const doubleTapEnabled = doubleTapSeconds > 0;
    const screenW = screenWidth;
    const screenH = screenHeight;
    const scrubEnabled = dragSeekEnabled;
    const brightnessEnabled = settings.enableLeftSideBrightnessSwipe === true;
    const volumeEnabled = settings.enableRightSideVolumeSwipe === true;
    const progressSv = progress;
    const maxSv = max;
    const seekingSv = isSeeking;

    const pan = Gesture.Pan()
      .maxPointers(1)
      .minDistance(10)
      .onBegin((e) => {
        "worklet";
        // 15% top/bottom exclusion zones (system edges + slider area), as before.
        panIgnored.value = e.y < screenH * 0.15 || e.y > screenH * 0.85 ? 1 : 0;
        panMode.value = MODE_NONE;
        panStartX.value = e.x;
        panStartY.value = e.y;
        panStartT.value = Date.now();
      })
      .onStart((e) => {
        "worklet";
        if (panIgnored.value) return;
        const absX = Math.abs(e.translationX);
        const absY = Math.abs(e.translationY);
        if (absY > absX) {
          const side = panStartX.value < screenW / 2 ? "left" : "right";
          if (side === "left" && brightnessEnabled) {
            panMode.value = MODE_BRIGHTNESS;
            runOnJS(jsVerticalStart)("left", panStartY.value);
          } else if (side === "right" && volumeEnabled) {
            panMode.value = MODE_VOLUME;
            runOnJS(jsVerticalStart)("right", panStartY.value);
          }
        } else if (scrubEnabled && progressSv && maxSv && maxSv.value > 0) {
          panMode.value = MODE_SCRUB;
          scrubStartMs.value = progressSv.value;
          scrubMs.value = progressSv.value;
          scrubActive.value = 1;
          lastPreviewT.value = 0;
          if (seekingSv) seekingSv.value = true;
          runOnJS(jsScrubStart)();
          runOnJS(jsScrubPreview)(progressSv.value);
        } else {
          panMode.value = MODE_FLICK;
        }
      })
      .onUpdate((e) => {
        "worklet";
        if (panIgnored.value) return;
        const mode = panMode.value;
        if (mode === MODE_SCRUB && progressSv && maxSv) {
          // Seek-bar mapping: full screen width = full duration.
          const dur = maxSv.value;
          const next = Math.min(
            dur,
            Math.max(0, scrubStartMs.value + (e.translationX / screenW) * dur),
          );
          scrubMs.value = next;
          progressSv.value = next; // slider + time display track live, UI thread
          const now = Date.now();
          if (now - lastPreviewT.value >= 120) {
            lastPreviewT.value = now;
            runOnJS(jsScrubPreview)(next); // throttled trickplay tile prefetch
          }
        } else if (mode === MODE_BRIGHTNESS) {
          runOnJS(jsVerticalUpdate)("left", e.translationY);
        } else if (mode === MODE_VOLUME) {
          runOnJS(jsVerticalUpdate)("right", e.translationY);
        }
      })
      .onEnd((e, success) => {
        "worklet";
        if (panIgnored.value) return;
        if (panMode.value !== MODE_FLICK || !success) return;
        const duration = Date.now() - panStartT.value;
        const absX = Math.abs(e.translationX);
        const absY = Math.abs(e.translationY);
        if (duration <= 800 && absX > absY && absX > 50) {
          runOnJS(jsFlick)(e.translationX > 0 ? 1 : -1);
        }
      })
      .onFinalize(() => {
        "worklet";
        // Exactly-once, cancel-safe lifecycle end for every mode.
        const mode = panMode.value;
        panMode.value = MODE_NONE;
        panIgnored.value = 0;
        if (mode === MODE_SCRUB) {
          scrubActive.value = 0;
          if (seekingSv) seekingSv.value = false;
          // Commit on release AND on system cancellation: the preview already moved
          // the visible position, so seeking there is the least surprising outcome —
          // and the JS side always resumes playback if it paused it.
          runOnJS(jsScrubEnd)(scrubMs.value);
        } else if (mode === MODE_BRIGHTNESS) {
          runOnJS(jsVerticalEnd)("left");
        } else if (mode === MODE_VOLUME) {
          runOnJS(jsVerticalEnd)("right");
        }
      });

    // Unified path: the native surface owns every tap — RNGH owns ONLY the pan.
    if (surfaceActive) return pan;

    // ---- LEGACY tap tree (stale binary / Android) --------------------------------
    // Suppression race (why these are grace-delayed): a two-finger tap ALSO
    // satisfies these recognizers — RNGH's iOS RNTapHandler counts every
    // touchesBegan event as a "tap". The old binaries' window recognizer fires in
    // the same instant; deferring execution GRACE_MS lets its suppressTaps() stamp
    // land first, every time.
    const doubleTap = Gesture.Tap()
      .enabled(doubleTapEnabled)
      .numberOfTaps(2)
      .maxDuration(250)
      .maxDelay(280)
      .maxDeltaX(32)
      .maxDeltaY(32)
      .runOnJS(true)
      .onEnd((e, success) => {
        if (!success) return;
        const x = e.x; // copy: the event object may be recycled before the timeout
        setTimeout(() => {
          if (!tapsSuppressed()) actionsRef.current.handleDoubleTap(x);
        }, GRACE_MS);
      });

    const singleTap = Gesture.Tap()
      .numberOfTaps(1)
      .maxDuration(300)
      .runOnJS(true)
      .onEnd((_e, success) => {
        if (!success) return;
        const fire = () => {
          if (tapsSuppressed()) return;
          console.log("[GESTURE] single tap → toggle controls");
          actionsRef.current.onToggleControls();
        };
        // With double-tap seek enabled, Exclusive already delays this ~280ms past
        // finger-up — the suppression stamp has long arrived; fire immediately.
        if (doubleTapEnabled) fire();
        else setTimeout(fire, GRACE_MS);
      });

    return Gesture.Race(pan, Gesture.Exclusive(doubleTap, singleTap));
  }, [
    doubleTapSeconds,
    dragSeekEnabled,
    surfaceActive,
    screenWidth,
    screenHeight,
    settings.enableLeftSideBrightnessSwipe,
    settings.enableRightSideVolumeSwipe,
    progress,
    max,
    isSeeking,
    // Stable-forever bridges + SharedValues (listed for lint completeness):
    jsVerticalStart,
    jsVerticalUpdate,
    jsVerticalEnd,
    jsFlick,
    jsScrubStart,
    jsScrubPreview,
    jsScrubEnd,
    panIgnored,
    panMode,
    panStartX,
    panStartY,
    panStartT,
    scrubStartMs,
    scrubMs,
    scrubActive,
    lastPreviewT,
  ]);

  return (
    <>
      {/* Single gesture surface for BOTH control states. Both players pass no dim
          (ControlsScrims draws subtle top/bottom gradients while controls are up);
          dimWhenControlsShown remains as a legacy opt-in.
          CRITICAL: keep it `transparent`, NEVER `opacity: 0` — UIKit hit-testing
          ignores views with alpha ≤ 0.01, which would make the whole gesture layer
          untouchable (this happened on device). */}
      <GestureDetector gesture={composedGesture}>
        <View
          collapsable={false}
          style={{
            position: "absolute",
            width: screenWidth,
            height: screenHeight,
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            backgroundColor:
              dimWhenControlsShown && showControls
                ? `rgba(0,0,0,${settings.controlsDimOpacity ?? 0.4})`
                : "transparent",
          }}
        >
          {surfaceActive && GestureSurfaceView ? (
            <GestureSurfaceView
              style={{ flex: 1 }}
              doubleTapEnabled={doubleTapSeconds > 0}
              doubleTapMaxIntervalMs={DOUBLE_TAP_WINDOW_MS}
              onSingleTap={handleSurfaceSingleTap}
              onDoubleTap={handleSurfaceDoubleTap}
              onTwoFingerTap={handleSurfaceTwoFingerTap}
            />
          ) : null}
        </View>
      </GestureDetector>

      {/* Drag-anywhere scrub preview (SharedValue-driven; renders nothing until a
          scrub activates). */}
      {dragSeekEnabled ? (
        <ScrubBubble
          active={scrubActive}
          scrubMs={scrubMs}
          startMs={scrubStartMs}
          max={max ?? scrubMs}
          trickPlayUrl={trickPlayUrl ?? null}
          trickplayInfo={trickplayInfo ?? null}
        />
      ) : null}

      {/* Feedback overlay */}
      {feedback.visible && (
        <Animated.View
          // Full-width row + justifyContent so the bubble is truly centered whatever
          // its width (the old left:"50%" + translateX:-50 hack assumed a 100px
          // bubble and sat icon-only bubbles left of center).
          style={{
            position: "absolute",
            top: "50%",
            left: 0,
            right: 0,
            transform: [{ translateY: -25 }],
            flexDirection: "row",
            justifyContent:
              feedback.side === "left"
                ? "flex-start"
                : feedback.side === "right"
                  ? "flex-end"
                  : "center",
            paddingHorizontal: "18%",
            opacity: fadeAnim,
            zIndex: 20,
          }}
          pointerEvents='none'
        >
          <View
            style={{
              backgroundColor: "rgba(0, 0, 0, 0.8)",
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderRadius: 8,
              flexDirection: "row",
              alignItems: "center",
            }}
          >
            <Ionicons
              name={feedback.icon as any}
              size={24}
              color='white'
              style={feedback.text ? { marginRight: 8 } : undefined}
            />
            {feedback.text ? (
              <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>
                {feedback.text}
              </Text>
            ) : null}
          </View>
        </Animated.View>
      )}
    </>
  );
};
