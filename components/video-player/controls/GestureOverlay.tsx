/*
 * Video gesture layer — ONE react-native-gesture-handler composition for the whole
 * surface (rebuild of the old RN-responder implementation; see FEATURES §5 history).
 *
 * Gestures (Race(pan, Exclusive(doubleTap, singleTap))):
 *   - double tap      → seek ±yomifinDoubleTapSeconds (left half = back, right = fwd)
 *   - single tap      → toggle controls (waits ~250ms for double-tap disambiguation;
 *                       when double-tap seek is disabled it fires immediately)
 *   - pan             → horizontal flick = skip ±s (enableHorizontalSwipeSkip);
 *                       vertical drag = brightness (left) / volume (right); 15%
 *                       top/bottom exclusion zones (unchanged)
 *
 * Two-finger tap (→ toggle play/pause) is deliberately NOT an RNGH gesture: RNGH
 * cannot reliably RECOGNIZE multi-touch taps on iOS (see YOMIFIN_CONTEXT gotcha).
 * The sole detector is the native window-level UITapGestureRecognizer in
 * MpvPlayerView.swift (seam v2: its delegate allows simultaneous recognition, so
 * UIKit recognizer-prevention can't kill it when doubleTap activates — the v1
 * failure mode). direct-player handles the event: suppressTaps() + togglePlay(),
 * then bumps `twoFingerNonce`, which this component watches purely to show the
 * pause/play feedback bubble. The ONLY coupling between the two designs is
 * tapSuppression.ts: the same physical tap can also satisfy doubleTap/singleTap
 * below (RNGH counts touchesBegan EVENTS as taps), so their execution is grace-
 * delayed ~80ms and re-checks tapsSuppressed() at fire time. doubleTap's
 * maxDeltaX/Y(32) already rejects most two-finger taps (the centroid jumps by
 * half the finger separation when finger 2 lands); suppression catches the
 * close-fingers remainder.
 *
 * Hard-won constraint: NEVER mix RN touch responders (Pressable/onTouch*) with RNGH
 * over the player — two previous attempts died that way. The dim-when-controls-shown
 * background is now a plain View child of the single GestureDetector, so every touch
 * on the video surface flows through one recognizer tree in both control states.
 * Buttons/sliders render ABOVE this overlay and keep receiving their own touches.
 */
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Text } from "@/components/common/Text";
import { useHaptic } from "@/hooks/useHaptic";
import { useSettings } from "@/utils/atoms/settings";
import { useVolumeAndBrightness } from "./hooks/useVolumeAndBrightness";
import { tapsSuppressed } from "./tapSuppression";

// Grace delay before executing a recognized single/double tap: long enough for the
// native onTwoFingerTap event to cross the bridge and stamp suppression (fingers can
// lift up to a few tens of ms apart; bridge adds ~10ms), short enough to feel instant.
const GRACE_MS = 80;

interface Props {
  screenWidth: number;
  screenHeight: number;
  showControls: boolean;
  isPlaying: boolean;
  onToggleControls: () => void;
  /** Bumped by direct-player on every NATIVE two-finger tap (feedback bubble only). */
  twoFingerNonce?: number;
  /** Signed relative seek in seconds (double-tap seek). */
  onSeekRelative: (seconds: number) => void;
  onSkipForward: () => void;
  onSkipBackward: () => void;
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
}: Props) => {
  const { settings } = useSettings();
  const lightHaptic = useHaptic("light");

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

  // ---- gesture actions (plain JS; every gesture runs with .runOnJS(true)) ----------

  const doubleTapSeconds = settings.yomifinDoubleTapSeconds ?? 10;

  // Feedback bubble for the NATIVE two-finger tap (the toggle itself already happened
  // in direct-player; state updates are batched, so isPlaying is post-toggle here —
  // show the resulting state: paused → pause icon). No bubble while the controls are
  // up: the control pane's play/pause button already reflects the state change.
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

  // ---- pan bookkeeping (refs, not state: no re-render per move) ---------------------

  const panIgnoredRef = useRef(false);
  const panModeRef = useRef<"none" | "horizontal" | "vertical">("none");
  const panSideRef = useRef<"left" | "right">("left");
  const panStartRef = useRef({ x: 0, y: 0, t: 0 });

  // Mutable "latest" refs so the memoized gesture objects never hold stale closures.
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
    settings,
    screenWidth,
    screenHeight,
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
    settings,
    screenWidth,
    screenHeight,
  };

  // One recognizer tree, built once (enabled flags + refs keep it current). Rebuilding
  // gestures per render is what makes recognizers "fight"; avoid it.
  //
  // Suppression race (why the taps below are grace-delayed): a two-finger tap ALSO
  // satisfies these recognizers — RNGH's iOS RNTapHandler counts every touchesBegan
  // event as a "tap", so staggered fingers register as taps=2 (→ doubleTap) and
  // same-event fingers as taps=1 (→ singleTap). The native onTwoFingerTap recognizer
  // fires in the same instant, and whichever event crosses to JS first would win.
  // Deferring execution GRACE_MS (≫ bridge latency) lets the native handler stamp
  // suppressTaps() first, every time.
  const composedGesture = useMemo(() => {
    const doubleTapEnabled = doubleTapSeconds > 0;

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
        // finger-up — the suppression stamp has long arrived; fire immediately to
        // keep the tap snappy. With it disabled this fires AT finger-up, so it needs
        // the same grace delay as doubleTap (two fingers landing in one touchesBegan
        // register here as a single tap).
        if (doubleTapEnabled) fire();
        else setTimeout(fire, GRACE_MS);
      });

    const pan = Gesture.Pan()
      .maxPointers(1)
      .minDistance(10)
      .runOnJS(true)
      .onBegin((e) => {
        const a = actionsRef.current;
        // 15% top/bottom exclusion zones (system edges + slider area), as before.
        const topZone = a.screenHeight * 0.15;
        const bottomZone = a.screenHeight * 0.85;
        panIgnoredRef.current = e.y < topZone || e.y > bottomZone;
        panModeRef.current = "none";
        panStartRef.current = { x: e.x, y: e.y, t: Date.now() };
      })
      .onStart((e) => {
        if (panIgnoredRef.current) return;
        const a = actionsRef.current;
        const absX = Math.abs(e.translationX);
        const absY = Math.abs(e.translationY);
        if (absY > absX) {
          panModeRef.current = "vertical";
          const side =
            panStartRef.current.x < a.screenWidth / 2 ? "left" : "right";
          panSideRef.current = side;
          if (side === "left" && a.settings.enableLeftSideBrightnessSwipe) {
            a.lightHaptic();
            a.startBrightnessDrag(panStartRef.current.y);
          } else if (
            side === "right" &&
            a.settings.enableRightSideVolumeSwipe
          ) {
            a.lightHaptic();
            a.startVolumeDrag(panStartRef.current.y);
          }
        } else {
          panModeRef.current = "horizontal";
        }
      })
      .onUpdate((e) => {
        if (panIgnoredRef.current || panModeRef.current !== "vertical") return;
        const a = actionsRef.current;
        if (
          panSideRef.current === "left" &&
          a.settings.enableLeftSideBrightnessSwipe
        ) {
          a.updateBrightnessDrag(e.translationY);
        } else if (
          panSideRef.current === "right" &&
          a.settings.enableRightSideVolumeSwipe
        ) {
          a.updateVolumeDrag(e.translationY);
        }
      })
      .onEnd((e, success) => {
        if (panIgnoredRef.current) return;
        const a = actionsRef.current;
        if (panModeRef.current === "vertical") {
          if (panSideRef.current === "left") a.endBrightnessDrag();
          else a.endVolumeDrag();
          a.hideDragFeedback();
          return;
        }
        if (!success || panModeRef.current !== "horizontal") return;
        const duration = Date.now() - panStartRef.current.t;
        const absX = Math.abs(e.translationX);
        const absY = Math.abs(e.translationY);
        if (duration <= 800 && absX > absY && absX > 50) {
          if (e.translationX > 0) a.handleSkipForward();
          else a.handleSkipBackward();
        }
      })
      .onFinalize(() => {
        panModeRef.current = "none";
        panIgnoredRef.current = false;
      });

    return Gesture.Race(pan, Gesture.Exclusive(doubleTap, singleTap));
  }, [doubleTapSeconds]);

  return (
    <>
      {/* Single gesture surface for BOTH control states. When controls are up it doubles
          as the dim layer (style toggle, not conditional mount — remounting the detector
          mid-gesture breaks recognition).
          CRITICAL: dim via backgroundColor rgba, NEVER via the view's `opacity` — UIKit
          hit-testing ignores views with alpha ≤ 0.01, so `opacity: 0` makes the whole
          gesture layer untouchable once controls hide (this happened on device). */}
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
            backgroundColor: showControls
              ? `rgba(0,0,0,${settings.controlsDimOpacity ?? 0.4})`
              : "transparent",
          }}
        />
      </GestureDetector>

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
