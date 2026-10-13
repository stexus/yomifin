import { Ionicons } from "@expo/vector-icons";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
} from "@gorhom/bottom-sheet";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { Slider } from "react-native-awesome-slider";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";
import { Text } from "@/components/common/Text";
import { Stepper } from "@/components/inputs/Stepper";
import type { OptionGroup } from "@/components/PlatformDropdown";
import { PLAYBACK_SPEEDS } from "@/components/PlaybackSpeedSelector";
import {
  OVERLAY_FONT_STEPS,
  OVERLAY_OFFSET_STEPS,
  OVERLAY_OUTLINE_STEPS,
  OVERLAY_WEIGHT_STEPS,
  PLAYER_CONTROLS_TIMEOUT_MS,
  SUBTITLE_SCALE_MAX,
  SUBTITLE_SCALE_MIN,
  SUBTITLE_SCALE_STEPS,
  SUBTITLE_SYNC_OFFSETS,
} from "@/constants/PlayerUI";
import { useSettings } from "@/utils/atoms/settings";
import { usePlayerInteraction } from "../PlayerInteraction";
import { PlayerMenuSheet } from "./PlayerMenuSheet";

const SubtitleScaleControl = ({
  onClose,
  onInteraction,
}: {
  onClose?: () => void;
  onInteraction?: () => void;
}) => {
  const { t } = useTranslation();
  const { settings, updateSettings, pluginSettings } = useSettings();
  const progress = useSharedValue(settings.subtitleSize);
  const minimumValue = useSharedValue(SUBTITLE_SCALE_MIN);
  const maximumValue = useSharedValue(SUBTITLE_SCALE_MAX);
  const disabled = pluginSettings?.subtitleSize?.locked === true;

  useEffect(() => {
    progress.value = settings.subtitleSize;
  }, [progress, settings.subtitleSize]);

  const updateSubtitleScale = useCallback(
    (value: number) => {
      const subtitleSize = Math.round(value * 10) / 10;
      progress.value = subtitleSize;
      updateSettings({ subtitleSize });
      onInteraction?.();
    },
    [onInteraction, progress, updateSettings],
  );

  return (
    <View className='px-6 pt-4 pb-6'>
      <View className='flex-row items-center justify-between mb-6'>
        <Text className='text-xl font-bold'>
          {t("player.menu.subtitle_scale")}
        </Text>
        <View className='flex-row items-center gap-3'>
          {Platform.OS === "android" && (
            <Text className='text-base text-neutral-300'>
              {settings.subtitleSize.toFixed(1)}×
            </Text>
          )}
          {onClose && (
            <TouchableOpacity
              onPress={onClose}
              className='h-8 w-8 items-center justify-center'
              accessibilityLabel={t("common.close")}
            >
              <Ionicons name='close-circle' size={24} color='#d4d4d4' />
            </TouchableOpacity>
          )}
        </View>
      </View>
      {Platform.OS === "android" ? (
        <View
          className={`flex-row items-center${disabled ? " opacity-50" : ""}`}
        >
          <Text className='text-sm'>A</Text>
          <View
            className='flex-1 mx-4'
            accessible
            accessibilityRole='adjustable'
            accessibilityLabel={t("player.menu.subtitle_scale")}
            accessibilityState={{ disabled }}
            accessibilityValue={{
              min: SUBTITLE_SCALE_MIN,
              max: SUBTITLE_SCALE_MAX,
              now: settings.subtitleSize,
              text: `${settings.subtitleSize.toFixed(1)}×`,
            }}
            accessibilityActions={[
              { name: "decrement" },
              { name: "increment" },
            ]}
            onAccessibilityAction={({ nativeEvent }) => {
              if (disabled) return;
              updateSubtitleScale(
                nativeEvent.actionName === "increment"
                  ? Math.min(SUBTITLE_SCALE_MAX, settings.subtitleSize + 0.1)
                  : Math.max(SUBTITLE_SCALE_MIN, settings.subtitleSize - 0.1),
              );
            }}
          >
            <Slider
              progress={progress}
              minimumValue={minimumValue}
              maximumValue={maximumValue}
              steps={SUBTITLE_SCALE_STEPS}
              forceSnapToStep
              disable={disabled}
              sliderHeight={6}
              thumbWidth={24}
              renderBubble={() => null}
              renderMark={() => null}
              onSlidingStart={onInteraction}
              onValueChange={updateSubtitleScale}
              containerStyle={{ borderRadius: 100 }}
              theme={{
                minimumTrackTintColor: "#fff",
                maximumTrackTintColor: "rgba(255,255,255,0.2)",
                disableMinTrackTintColor: "rgba(255,255,255,0.35)",
              }}
            />
          </View>
          <Text className='text-xl'>A</Text>
        </View>
      ) : (
        <View className='items-center'>
          <Stepper
            value={settings.subtitleSize}
            disabled={disabled}
            step={0.1}
            min={SUBTITLE_SCALE_MIN}
            max={SUBTITLE_SCALE_MAX}
            appendValue='×'
            formatValue={(value) => value.toFixed(1)}
            onUpdate={updateSubtitleScale}
          />
        </View>
      )}
    </View>
  );
};

export const AndroidSubtitleScaleOverlay = ({
  visible,
  onClose,
  onBackgroundPress,
}: {
  visible: boolean;
  onClose: () => void;
  onBackgroundPress: () => void;
}) => {
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const resetTimeout = useCallback(() => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(onClose, PLAYER_CONTROLS_TIMEOUT_MS);
  }, [onClose]);

  useEffect(() => {
    if (visible) resetTimeout();
    return () => clearTimeout(timeoutRef.current);
  }, [resetTimeout, visible]);

  return (
    <Modal
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      visible={visible}
      animationType='fade'
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={styles.subtitleScaleModal}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onBackgroundPress}
        />
        <View style={styles.subtitleScaleOverlay}>
          <SubtitleScaleControl
            onClose={onClose}
            onInteraction={resetTimeout}
          />
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
};

export interface PlayerMenuTrack {
  id: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}

export interface PlayerMenuProps {
  variant: "menu" | "subtitles" | "audio";
  tracks?: PlayerMenuTrack[];
  qualityOptions?: OptionGroup["options"];
  playbackSpeed?: number;
  onSetSpeed?: (speed: number) => void;
  showTechnicalInfo?: boolean;
  onToggleTechnicalInfo?: () => void;
  onOnlineSubtitles?: () => void;
  onlineSubtitleLabel?: string;
  subtitleDelay?: number;
  onSubtitleDelayChange?: (seconds: number) => void;
  canScaleSubtitles?: boolean;
}

/** Only plain menu data crosses this boundary; track selection stays with the source. */
export const PlayerMenu = memo(function PlayerMenu({
  variant,
  tracks,
  qualityOptions,
  playbackSpeed = 1,
  onSetSpeed,
  showTechnicalInfo,
  onToggleTechnicalInfo,
  onOnlineSubtitles,
  onlineSubtitleLabel,
  subtitleDelay = 0,
  onSubtitleDelayChange,
  canScaleSubtitles = false,
}: PlayerMenuProps) {
  const { settings, updateSettings, pluginSettings } = useSettings();
  const { t } = useTranslation();
  const { setPanelOpen } = usePlayerInteraction();
  const subtitleScaleModalRef = useRef<BottomSheetModal>(null);
  const [showSubtitleScale, setShowSubtitleScale] = useState(false);
  const openSubtitleScale = useCallback(() => {
    setPanelOpen("subtitle-scale", true);
    if (Platform.OS === "android") setShowSubtitleScale(true);
    else subtitleScaleModalRef.current?.present();
  }, [setPanelOpen]);
  const closeSubtitleScale = useCallback(() => {
    setShowSubtitleScale(false);
    setPanelOpen("subtitle-scale", false);
  }, [setPanelOpen]);
  const onMenuOpenChange = useCallback(
    (open: boolean) => {
      setPanelOpen(`menu-${variant}`, open);
    },
    [setPanelOpen, variant],
  );
  useEffect(
    () => () => {
      setPanelOpen(`menu-${variant}`, false);
      if (variant === "subtitles") setPanelOpen("subtitle-scale", false);
    },
    [setPanelOpen, variant],
  );
  const renderSubtitleScaleBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
      />
    ),
    [],
  );
  const optionGroups = useMemo<OptionGroup[]>(() => {
    const groups: OptionGroup[] = [];
    if (variant === "audio" || variant === "subtitles") {
      if (tracks?.length)
        groups.push({
          title: t(
            variant === "audio" ? "common.audio" : "player.menu.subtitles",
          ),
          options: tracks.map((track) => ({
            type: "radio",
            label: track.label,
            value: track.id,
            selected: track.selected,
            disabled: track.disabled,
            onPress: track.onSelect,
          })),
        });
      if (variant === "audio") return groups;
      if (canScaleSubtitles)
        groups.push({
          title: t("player.menu.subtitle_scale"),
          options: [
            {
              type: "action",
              label: `${settings.subtitleSize.toFixed(1)}×`,
              disabled: pluginSettings?.subtitleSize?.locked,
              onPress: openSubtitleScale,
            },
          ],
        });
      groups.push(
        {
          title: t("player.controls.subtitle_text_size"),
          options: OVERLAY_FONT_STEPS.map((value) => ({
            type: "radio",
            label: String(value),
            value,
            selected: settings.yomifinSubtitleFontSize === value,
            onPress: () => updateSettings({ yomifinSubtitleFontSize: value }),
          })),
        },
        {
          title: t("player.controls.subtitle_weight"),
          options: OVERLAY_WEIGHT_STEPS.map(({ label, value }) => ({
            type: "radio",
            label,
            value,
            selected: settings.yomifinSubtitleWeight === value,
            onPress: () => updateSettings({ yomifinSubtitleWeight: value }),
          })),
        },
        {
          title: t("player.controls.subtitle_outline"),
          options: OVERLAY_OUTLINE_STEPS.map((value) => ({
            type: "radio",
            label: value[0].toUpperCase() + value.slice(1),
            value,
            selected: settings.yomifinSubtitleOutline === value,
            onPress: () => updateSettings({ yomifinSubtitleOutline: value }),
          })),
        },
        {
          title: t("player.controls.subtitle_position"),
          options: OVERLAY_OFFSET_STEPS.map((value) => ({
            type: "radio",
            label: String(value),
            value,
            selected: settings.yomifinSubtitleBottomOffset === value,
            onPress: () =>
              updateSettings({ yomifinSubtitleBottomOffset: value }),
          })),
        },
      );
      if (onOnlineSubtitles)
        groups.push({
          options: [
            {
              type: "action",
              label:
                onlineSubtitleLabel || t("player.controls.online_subtitles"),
              onPress: onOnlineSubtitles,
            },
          ],
        });
      if (onSubtitleDelayChange)
        groups.push({
          title: t("player.subtitle_sync"),
          options: SUBTITLE_SYNC_OFFSETS.map((seconds) => ({
            type: "radio",
            label: `${seconds > 0 ? "+" : ""}${seconds} s`,
            value: seconds,
            selected: subtitleDelay === seconds,
            onPress: () => onSubtitleDelayChange(seconds),
          })),
        });
      return groups;
    }
    if (qualityOptions?.length)
      groups.push({ title: t("player.menu.quality"), options: qualityOptions });
    if (onSetSpeed)
      groups.push({
        title: t("player.menu.speed"),
        options: PLAYBACK_SPEEDS.map((speed) => ({
          type: "radio",
          label: speed.label,
          value: speed.value,
          selected: playbackSpeed === speed.value,
          onPress: () => onSetSpeed(speed.value),
        })),
      });
    if (onToggleTechnicalInfo)
      groups.push({
        options: [
          {
            type: "action",
            label: t(
              showTechnicalInfo
                ? "player.menu.hide_technical_info"
                : "player.menu.show_technical_info",
            ),
            onPress: onToggleTechnicalInfo,
          },
        ],
      });
    return groups;
  }, [
    variant,
    tracks,
    qualityOptions,
    playbackSpeed,
    onSetSpeed,
    showTechnicalInfo,
    onToggleTechnicalInfo,
    onOnlineSubtitles,
    onlineSubtitleLabel,
    subtitleDelay,
    onSubtitleDelayChange,
    canScaleSubtitles,
    settings.subtitleSize,
    settings.yomifinSubtitleFontSize,
    settings.yomifinSubtitleWeight,
    settings.yomifinSubtitleOutline,
    settings.yomifinSubtitleBottomOffset,
    pluginSettings?.subtitleSize?.locked,
    updateSettings,
    openSubtitleScale,
    t,
  ]);
  const title = t(
    variant === "subtitles"
      ? "player.menu.subtitles"
      : variant === "audio"
        ? "common.audio"
        : "player.menu.playback_options",
  );
  const trigger = useMemo(
    () => (
      <View
        accessibilityLabel={title}
        className='aspect-square flex flex-col rounded-xl items-center justify-center p-2'
      >
        <Ionicons
          name={
            variant === "subtitles"
              ? "chatbox-ellipses"
              : variant === "audio"
                ? "volume-high"
                : "ellipsis-horizontal"
          }
          size={variant === "menu" ? 24 : 20}
          color='white'
        />
      </View>
    ),
    [variant, title],
  );
  if (Platform.isTV || !optionGroups.length) return null;
  return (
    <>
      <PlayerMenuSheet
        title={title}
        groups={optionGroups}
        trigger={trigger}
        onOpenChange={onMenuOpenChange}
      />
      {variant === "subtitles" &&
        (Platform.OS === "android" ? (
          <AndroidSubtitleScaleOverlay
            visible={showSubtitleScale}
            onClose={closeSubtitleScale}
            onBackgroundPress={closeSubtitleScale}
          />
        ) : (
          <BottomSheetModal
            ref={subtitleScaleModalRef}
            enableDynamicSizing
            enablePanDownToClose
            stackBehavior='push'
            onDismiss={closeSubtitleScale}
            backdropComponent={renderSubtitleScaleBackdrop}
            backgroundStyle={{ backgroundColor: "#171717" }}
            handleIndicatorStyle={{ backgroundColor: "white" }}
          >
            <SubtitleScaleControl />
          </BottomSheetModal>
        ))}
    </>
  );
});

const styles = StyleSheet.create({
  subtitleScaleModal: {
    flex: 1,
    alignItems: "center",
    paddingTop: 64,
    backgroundColor: "rgba(0,0,0,0.15)",
  },
  subtitleScaleOverlay: {
    width: "50%",
    maxWidth: 520,
    minWidth: 360,
    borderRadius: 16,
    backgroundColor: "rgba(23,23,23,0.94)",
    elevation: 12,
  },
});
