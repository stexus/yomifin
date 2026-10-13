import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { type FC, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, TouchableOpacity, View } from "react-native";
import { useControlsSafeAreaInsets } from "@/hooks/useControlsSafeAreaInsets";
import { useHaptic } from "@/hooks/useHaptic";
import { useOrientation } from "@/hooks/useOrientation";
import { OrientationLock } from "@/packages/expo-screen-orientation";
import { HEADER_LAYOUT, ICON_SIZES } from "./constants";
import { shouldShowPlayerMenu } from "./utils/shouldShowPlayerMenu";
import { ZoomToggle } from "./ZoomToggle";

interface HeaderControlsProps {
  showControls: boolean;
  onClose: () => void;
  menu: React.ReactNode;
  startPictureInPicture?: () => Promise<void>;
  switchOnEpisodeMode?: () => void;
  isZoomedToFill?: boolean;
  onZoomToggle?: () => void;
  leftSlot?: React.ReactNode;
}

export const HeaderControls: FC<HeaderControlsProps> = ({
  showControls,
  onClose,
  menu,
  startPictureInPicture,
  switchOnEpisodeMode,
  isZoomedToFill = false,
  onZoomToggle,
  leftSlot,
}) => {
  const { t } = useTranslation();
  const insets = useControlsSafeAreaInsets();
  const lightHapticFeedback = useHaptic("light");
  const { orientation, lockOrientation } = useOrientation();
  const [isTogglingOrientation, setIsTogglingOrientation] = useState(false);

  const toggleOrientation = useCallback(async () => {
    if (isTogglingOrientation) return;

    setIsTogglingOrientation(true);
    lightHapticFeedback();

    try {
      const isPortrait =
        orientation === OrientationLock.PORTRAIT_UP ||
        orientation === OrientationLock.PORTRAIT_DOWN;

      await lockOrientation(
        isPortrait ? OrientationLock.LANDSCAPE : OrientationLock.PORTRAIT_UP,
      );
    } finally {
      setIsTogglingOrientation(false);
    }
  }, [
    orientation,
    lockOrientation,
    isTogglingOrientation,
    lightHapticFeedback,
  ]);

  return (
    <View
      style={[
        {
          position: "absolute",
          // Sits BELOW the custom OSD status bar (clock/battery row).
          top: insets.top + 38,
          left: insets.left,
          right: insets.right,
          padding: HEADER_LAYOUT.CONTAINER_PADDING,
        },
      ]}
      pointerEvents={showControls ? "auto" : "none"}
      className='flex flex-row justify-between'
    >
      <View
        className='mr-auto flex flex-row items-center'
        pointerEvents='box-none'
      >
        {shouldShowPlayerMenu({ isTV: Platform.isTV }) && (
          <View pointerEvents='auto'>{menu}</View>
        )}
        {leftSlot ? (
          <View pointerEvents='auto' style={{ marginLeft: 8 }}>
            {leftSlot}
          </View>
        ) : null}
      </View>

      <View className='flex flex-row items-center space-x-2'>
        {/* Rotate toggle is Android-only: iOS does not reliably rotate the
            player back to portrait programmatically. */}
        {Platform.OS === "android" && (
          <TouchableOpacity
            onPress={toggleOrientation}
            disabled={isTogglingOrientation}
            className='aspect-square flex flex-col rounded-xl items-center justify-center p-2'
            accessibilityLabel={t("accessibility.toggle_orientation")}
            accessibilityHint={t("accessibility.toggle_orientation_hint")}
          >
            <MaterialIcons
              name='screen-rotation'
              size={ICON_SIZES.HEADER}
              color='white'
              style={{ opacity: isTogglingOrientation ? 0.5 : 1 }}
            />
          </TouchableOpacity>
        )}
        {!Platform.isTV && startPictureInPicture && (
          <TouchableOpacity
            accessibilityLabel={t("player.controls.picture_in_picture")}
            onPress={startPictureInPicture}
            className='aspect-square flex flex-col rounded-xl items-center justify-center p-2'
          >
            <MaterialIcons
              name='picture-in-picture'
              size={ICON_SIZES.HEADER}
              color='white'
            />
          </TouchableOpacity>
        )}
        {switchOnEpisodeMode && (
          <TouchableOpacity
            accessibilityLabel={t("player.controls.episodes")}
            onPress={switchOnEpisodeMode}
            className='aspect-square flex flex-col rounded-xl items-center justify-center p-2'
          >
            <Ionicons name='list' size={ICON_SIZES.HEADER} color='white' />
          </TouchableOpacity>
        )}
        {/* Prev/next EPISODE moved to the bottom control cluster (senplayer layout). */}
        {/* MPV Zoom Toggle */}
        {onZoomToggle && (
          <ZoomToggle isZoomedToFill={isZoomedToFill} onToggle={onZoomToggle} />
        )}
        <TouchableOpacity
          accessibilityLabel={t("common.close")}
          onPress={onClose}
          className='aspect-square flex flex-col rounded-xl items-center justify-center p-2'
        >
          <Ionicons name='close' size={ICON_SIZES.HEADER} color='white' />
        </TouchableOpacity>
      </View>
    </View>
  );
};
