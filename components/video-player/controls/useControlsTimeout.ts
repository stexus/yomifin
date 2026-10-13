import { useCallback, useEffect, useRef } from "react";
import { createControlsTimer } from "./utils/controlsTimer";

interface UseControlsTimeoutProps {
  showControls: boolean;
  isSliding: boolean;
  episodeView: boolean;
  onHideControls: () => void;
  timeout?: number;
  disabled?: boolean;
}

export const useControlsTimeout = ({
  showControls,
  isSliding,
  episodeView,
  onHideControls,
  timeout = 10000,
  disabled = false,
}: UseControlsTimeoutProps) => {
  const latest = useRef({
    showControls,
    isSliding,
    episodeView,
    disabled,
    onHideControls,
    timeout,
  });
  latest.current = {
    showControls,
    isSliding,
    episodeView,
    disabled,
    onHideControls,
    timeout,
  };
  const timerRef = useRef<ReturnType<typeof createControlsTimer> | null>(null);
  if (!timerRef.current)
    timerRef.current = createControlsTimer(
      () => {
        const state = latest.current;
        return (
          state.showControls &&
          !state.disabled &&
          !state.isSliding &&
          !state.episodeView
        );
      },
      () => latest.current.onHideControls(),
      () => latest.current.timeout,
    );

  useEffect(() => {
    timerRef.current?.reset();
    return () => timerRef.current?.clear();
  }, [showControls, isSliding, episodeView, timeout, onHideControls, disabled]);

  const handleControlsInteraction = useCallback(() => {
    timerRef.current?.reset();
  }, []);

  return {
    handleControlsInteraction,
  };
};
