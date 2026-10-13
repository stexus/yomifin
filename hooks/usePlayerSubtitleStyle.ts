import { type RefObject, useEffect } from "react";
import { PixelRatio, Platform, useWindowDimensions } from "react-native";
import { useSettings } from "@/utils/atoms/settings";
import {
  getEffectiveSubtitleMarginY,
  getEffectiveSubtitleScale,
} from "@/utils/subtitles";
import {
  applySubtitleStyle,
  buildSubtitleStyle,
  type SubtitleStyleTarget,
} from "@/utils/subtitles/subtitleStyle";

/** Apply the same native subtitle scale and placement on either source. */
export function usePlayerSubtitleStyle({
  playerRef,
  ready,
  videoWidth,
  videoHeight,
  zoomed = false,
  playerType = "mpv",
}: {
  playerRef: RefObject<SubtitleStyleTarget | null>;
  ready: boolean;
  videoWidth?: number | null;
  videoHeight?: number | null;
  zoomed?: boolean;
  playerType?: "mpv" | "exoplayer";
}) {
  const { settings } = useSettings();
  const { width, height } = useWindowDimensions();
  useEffect(() => {
    if (!ready || !playerRef.current) return;
    const margin =
      settings.subtitleMarginY === undefined
        ? undefined
        : getEffectiveSubtitleMarginY(settings.subtitleMarginY);
    const scale = getEffectiveSubtitleScale(
      settings.subtitleSize,
      videoWidth,
      videoHeight,
      width * PixelRatio.get(),
      height * PixelRatio.get(),
      zoomed && height > width ? "cover" : "contain",
      playerType,
    );
    void applySubtitleStyle(
      playerRef.current,
      buildSubtitleStyle(settings, {
        scale,
        marginY:
          margin !== undefined &&
          Platform.OS === "android" &&
          !Platform.isTV &&
          height > width
            ? Math.round(margin * 0.7)
            : margin,
      }),
    ).catch((error) =>
      console.warn("Failed to apply player subtitle settings", error),
    );
  }, [
    ready,
    playerRef,
    settings,
    videoWidth,
    videoHeight,
    width,
    height,
    zoomed,
    playerType,
  ]);
}
