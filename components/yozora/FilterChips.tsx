/*
 * Shared chip + section primitives for the Yozora filter modals and the tab's
 * section switcher (same visual language as the old anime filter sheet).
 */
import type React from "react";
import { Pressable, View } from "react-native";
import { Text } from "@/components/common/Text";

export function Chip({
  label,
  active,
  onPress,
  disabled,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 999,
        marginRight: 8,
        marginBottom: 8,
        backgroundColor: active ? "#9334E9" : "#232323",
        borderWidth: 1,
        borderColor: active ? "#9334E9" : "#333",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text
        style={{
          color: active ? "white" : "#bbb",
          fontSize: 13,
          fontWeight: active ? "600" : "400",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View className='mb-4'>
      <View className='flex-row items-baseline mb-2'>
        <Text className='text-neutral-400 text-xs font-semibold uppercase'>
          {title}
        </Text>
        {hint ? (
          <Text className='text-neutral-600 text-[11px] ml-2 lowercase'>
            {hint}
          </Text>
        ) : null}
      </View>
      <View className='flex-row flex-wrap'>{children}</View>
    </View>
  );
}
