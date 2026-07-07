import { Stack } from "expo-router";
import { Platform } from "react-native";

export default function AnimeLayout() {
  const common = {
    headerShown: !Platform.isTV,
    headerBlurEffect: "none" as const,
    headerTransparent: Platform.OS === "ios",
    headerShadowVisible: false,
  };
  return (
    <Stack>
      <Stack.Screen
        name='index'
        options={{ ...common, headerTitle: "Anime" }}
      />
      <Stack.Screen name='detail' options={{ ...common, headerTitle: "" }} />
    </Stack>
  );
}
