import { debounce } from "lodash";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SharedValue } from "react-native-reanimated";
import { msToTicks } from "@/utils/time";
import { CONTROLS_CONSTANTS } from "../constants";

interface UseVideoSliderProps {
  progress: SharedValue<number>;
  isSeeking: SharedValue<boolean>;
  isPlaying: boolean;
  seek: (value: number) => void;
  play: () => void;
  pause: () => void;
  calculateTrickplayUrl: (progressInTicks: number) => void;
  showControls: boolean;
}
const sliderTime = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return {
    hours: Math.floor(seconds / 3600),
    minutes: Math.floor(seconds / 60) % 60,
    seconds: seconds % 60,
  };
};

/** Slider UI consumes milliseconds; the source adapter handles native conversion. */
export function useVideoSlider({
  progress,
  isSeeking,
  isPlaying,
  seek,
  play,
  pause,
  calculateTrickplayUrl,
  showControls,
}: UseVideoSliderProps) {
  const [isSliding, setIsSliding] = useState(false);
  const [time, setTime] = useState(sliderTime(0));
  const wasPlayingRef = useRef(false);
  const handleSliderChange = useMemo(
    () =>
      debounce((value: number) => {
        calculateTrickplayUrl(msToTicks(value));
        setTime(sliderTime(value));
      }, CONTROLS_CONSTANTS.SLIDER_DEBOUNCE_MS),
    [calculateTrickplayUrl],
  );
  useEffect(() => () => handleSliderChange.cancel(), [handleSliderChange]);

  const handleSliderStart = useCallback(() => {
    if (!showControls) return;
    wasPlayingRef.current = isPlaying;
    isSeeking.value = true;
    setIsSliding(true);
    setTime(sliderTime(progress.value));
    pause();
  }, [showControls, isPlaying, pause, progress, isSeeking]);
  const handleSliderComplete = useCallback(
    (value: number) => {
      handleSliderChange.cancel();
      setIsSliding(false);
      const target = Math.max(0, Math.floor(value));
      progress.value = target;
      seek(target);
      isSeeking.value = false;
      if (wasPlayingRef.current) play();
    },
    [handleSliderChange, seek, play, progress, isSeeking],
  );
  const seekTo = useCallback(
    (value: number) => {
      const target = Math.max(0, Math.floor(value));
      progress.value = target;
      seek(target);
      // A chapter tap must not inherit a previous slider gesture's resume state.
      if (isPlaying) play();
    },
    [seek, play, progress, isPlaying],
  );
  return {
    isSliding,
    time,
    handleSliderStart,
    handleSliderComplete,
    handleSliderChange,
    seekTo,
  };
}
