/*
 * PlayerStatusBar — custom OSD toolbar at the very top of the player (senplayer-style).
 *
 * Two visibility tiers:
 *   - REGULAR PLAYBACK (controls hidden): a subtle, configurable subset — by default
 *     just the clock + battery (Settings → Player UI). Gated by
 *     `playerStatusBarDuringPlayback`.
 *   - CONTROLS UP: the full bar — clock + date + wifi/connection + stream throughput +
 *     battery on the sides, and the current playback title centered.
 *
 * It's mounted independently of the fade-in/out control pane (it must be able to show
 * during playback), and cross-fades its own contents when the controls toggle.
 */
import { Ionicons } from "@expo/vector-icons";
import { type FC, useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Text } from "@/components/common/Text";
import { useControlsSafeAreaInsets } from "@/hooks/useControlsSafeAreaInsets";
import type { TechnicalInfo } from "@/modules/mpv-player";
import { useSettings } from "@/utils/atoms/settings";
import { useSystemStatus } from "./hooks/useSystemStatus";

interface Props {
  title: string;
  showControls: boolean;
  getTechnicalInfo?: () => Promise<TechnicalInfo>;
}

const TEXT_SHADOW = {
  textShadowColor: "rgba(0,0,0,0.85)",
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 3,
} as const;

function batteryIcon(
  level: number | null,
  charging: boolean,
): keyof typeof Ionicons.glyphMap {
  if (charging) return "battery-charging";
  if (level == null) return "battery-half";
  if (level <= 0.1) return "battery-dead";
  if (level >= 0.95) return "battery-full";
  return "battery-half";
}

function netIcon(netType: string): keyof typeof Ionicons.glyphMap {
  if (netType === "wifi") return "wifi";
  if (netType === "cellular") return "cellular";
  if (netType === "none") return "cloud-offline";
  return "globe-outline";
}

export const PlayerStatusBar: FC<Props> = ({
  title,
  showControls,
  getTechnicalInfo,
}) => {
  const { settings } = useSettings();
  const insets = useControlsSafeAreaInsets();

  const showNetwork = settings.playerStatusShowNetwork || showControls;
  const {
    clock,
    date,
    batteryLevel,
    batteryCharging,
    netType,
    throughputKbps,
  } = useSystemStatus({
    hour12: settings.playerClock12Hour ?? true,
    // Only poll the bitrate when the network item is actually visible.
    needsThroughput:
      showNetwork && (settings.playerStatusShowNetwork || showControls),
    getTechnicalInfo,
  });

  // Per-item visibility: everything shows while controls are up; during playback only
  // the enabled subset shows (and only if the persistent bar is enabled at all).
  const persistent = settings.playerStatusBarDuringPlayback ?? true;
  const showClock =
    showControls || (persistent && settings.playerStatusShowClock);
  const showDate =
    showControls || (persistent && settings.playerStatusShowDate);
  const showBattery =
    showControls || (persistent && settings.playerStatusShowBattery);
  const showWifi =
    showControls || (persistent && settings.playerStatusShowWifi);
  const showThroughput =
    showControls || (persistent && settings.playerStatusShowNetwork);

  // Contents fade with the controls; during playback they render at reduced opacity
  // (subtle), full opacity when the controls come up.
  const targetOpacity = showControls ? 1 : 0.55;
  const opacity = useSharedValue(targetOpacity);
  useEffect(() => {
    opacity.value = withTiming(targetOpacity, { duration: 250 });
  }, [opacity, targetOpacity]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const anyLeft = showClock || showDate;
  const anyRight = showWifi || showThroughput || showBattery;

  // Nothing to show at all (persistent bar off during playback).
  if (!showControls && !persistent) return null;
  if (!anyLeft && !anyRight && !showControls) return null;

  const throughputText =
    throughputKbps != null
      ? throughputKbps >= 1024
        ? `${(throughputKbps / 1024).toFixed(1)} MB/s`
        : `${Math.round(throughputKbps)} KB/s`
      : null;

  return (
    <View
      pointerEvents='none'
      style={[
        styles.container,
        {
          top: insets.top,
          left: insets.left + 12,
          right: insets.right + 12,
        },
      ]}
    >
      <Animated.View style={[styles.row, fadeStyle]}>
        {/* LEFT: clock + date */}
        <View style={styles.side}>
          {showClock ? (
            <Text style={[styles.clock, TEXT_SHADOW]}>{clock}</Text>
          ) : null}
          {showDate ? (
            <Text style={[styles.date, TEXT_SHADOW]}>{date}</Text>
          ) : null}
        </View>

        {/* CENTER: playback title (controls up only) */}
        <View style={styles.center}>
          {showControls && title ? (
            <Text numberOfLines={1} style={[styles.title, TEXT_SHADOW]}>
              {title}
            </Text>
          ) : null}
        </View>

        {/* RIGHT: wifi + throughput + battery */}
        <View style={[styles.side, styles.sideRight]}>
          {showWifi ? (
            <Ionicons
              name={netIcon(netType)}
              size={15}
              color='white'
              style={styles.icon}
            />
          ) : null}
          {showThroughput && throughputText ? (
            <Text style={[styles.meta, TEXT_SHADOW]}>{throughputText}</Text>
          ) : null}
          {showBattery ? (
            <View style={styles.battery}>
              {batteryLevel != null ? (
                <Text style={[styles.meta, TEXT_SHADOW]}>
                  {Math.round(batteryLevel * 100)}%
                </Text>
              ) : null}
              <Ionicons
                name={batteryIcon(batteryLevel, batteryCharging)}
                size={18}
                color='white'
                style={styles.icon}
              />
            </View>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    zIndex: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    height: 34,
  },
  side: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 90,
  },
  sideRight: {
    justifyContent: "flex-end",
  },
  center: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 12,
  },
  clock: {
    color: "white",
    fontSize: 13,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  date: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 13,
    fontWeight: "500",
  },
  title: {
    color: "white",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  meta: {
    color: "white",
    fontSize: 13,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  battery: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  icon: {},
});
