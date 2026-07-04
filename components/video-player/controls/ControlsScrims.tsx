/*
 * ControlsScrims — subtle top + bottom gradient scrims for legibility, shown ONLY
 * while the control pane is up. There is deliberately no full-screen dim during
 * regular playback (the reworked controls no longer sit over the center of the
 * video), so nothing obscures playback by default.
 *
 * pointerEvents='none' throughout — the gesture surface underneath must keep
 * receiving taps/pans.
 */
import { LinearGradient } from "expo-linear-gradient";
import type { FC } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

interface Props {
  showControls: boolean;
}

export const ControlsScrims: FC<Props> = ({ showControls }) => {
  const opacity = useSharedValue(showControls ? 1 : 0);
  opacity.value = withTiming(showControls ? 1 : 0, { duration: 250 });
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      pointerEvents='none'
      style={[StyleSheet.absoluteFill, style]}
    >
      <LinearGradient
        colors={["rgba(0,0,0,0.6)", "transparent"]}
        style={styles.top}
      />
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.75)"]}
        style={styles.bottom}
      />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  top: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 140,
  },
  bottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 220,
  },
});
