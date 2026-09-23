import { Feather, Ionicons } from "@expo/vector-icons";
import { Stack } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Platform, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { toast } from "sonner-native";
import { nestedTabPageScreenOptions } from "@/components/stacks/NestedTabPageStack";
import useRouter from "@/hooks/useAppRouter";
import { syncAnki } from "@/utils/yomifin/anki";
import { getAnkiConfig } from "@/utils/yomifin/ankiConfig";

const Chromecast = Platform.isTV ? null : require("@/components/Chromecast");

import { useAtom } from "jotai";
import { HeaderBackButton } from "@/components/common/HeaderBackButton";
import { useSessions, type useSessionsProps } from "@/hooks/useSessions";
import { userAtom } from "@/providers/JellyfinProvider";

export default function IndexLayout() {
  const _router = useRouter();
  const [user] = useAtom(userAtom);
  const { t } = useTranslation();

  return (
    <Stack>
      <Stack.Screen
        name='index'
        options={{
          headerShown: !Platform.isTV,
          headerTitle: t("tabs.home"),
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerRight: () => (
            <View className='flex flex-row items-center px-2'>
              {!Platform.isTV && (
                <>
                  <Chromecast.Chromecast background='transparent' />
                  {user?.Policy?.IsAdministrator && <SessionsButton />}
                  <AnkiSyncButton />
                  <SettingsButton />
                </>
              )}
            </View>
          ),
        }}
      />
      <Stack.Screen
        name='downloads/index'
        options={{
          headerShown: !Platform.isTV,
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          title: t("home.downloads.downloads_title"),
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <Stack.Screen
        name='sessions/index'
        options={{
          title: t("home.sessions.title"),
          headerShown: !Platform.isTV,
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <Stack.Screen
        name='settings'
        options={{
          title: t("home.settings.settings_title"),
          headerShown: !Platform.isTV,
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={() => _router.back()}
              className='pl-0.5'
              style={{ marginRight: Platform.OS === "android" ? 16 : 0 }}
            >
              <Feather name='chevron-left' size={28} color='white' />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name='companion-login'
        options={{
          title: t("companion_login.title"),
          headerShown: !Platform.isTV,
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <Stack.Screen
        name='settings/playback-controls/page'
        options={{
          title: t("home.settings.playback_controls.title"),
          headerShown: !Platform.isTV,
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <Stack.Screen
        name='settings/audio-subtitles/page'
        options={{
          title: t("home.settings.audio_subtitles.title"),
          headerShown: !Platform.isTV,
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <Stack.Screen
        name='settings/dictionaries/page'
        options={{
          title: "Dictionaries",
          headerShown: !Platform.isTV,
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <Stack.Screen
        name='settings/anki/page'
        options={{
          title: "Anki",
          headerShown: !Platform.isTV,
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <Stack.Screen
        name='settings/reader/page'
        options={{
          title: "Reader",
          headerShown: !Platform.isTV,
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <Stack.Screen
        name='settings/yozora/page'
        options={{
          title: "Yozora",
          headerShown: !Platform.isTV,
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <Stack.Screen
        name='settings/appearance/page'
        options={{
          title: t("home.settings.appearance.title"),
          headerShown: !Platform.isTV,
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <Stack.Screen
        name='settings/music/page'
        options={{
          title: t("home.settings.music.title"),
          headerShown: !Platform.isTV,
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <Stack.Screen
        name='settings/appearance/hide-libraries/page'
        options={{
          title: t("home.settings.other.hide_libraries"),
          headerShown: !Platform.isTV,
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <Stack.Screen
        name='settings/plugins/page'
        options={{
          title: t("home.settings.plugins.plugins_title"),
          headerShown: !Platform.isTV,
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={() => _router.back()}
              className='pl-0.5'
              style={{ marginRight: Platform.OS === "android" ? 16 : 0 }}
            >
              <Feather name='chevron-left' size={28} color='white' />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name='settings/plugins/marlin-search/page'
        options={{
          title: "Marlin Search",
          headerShown: !Platform.isTV,
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <Stack.Screen
        name='settings/plugins/jellyseerr/page'
        options={{
          title: "Jellyseerr",
          headerShown: !Platform.isTV,
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <Stack.Screen
        name='settings/plugins/streamystats/page'
        options={{
          title: "Streamystats",
          headerShown: !Platform.isTV,
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <Stack.Screen
        name='settings/plugins/kefinTweaks/page'
        options={{
          title: "KefinTweaks",
          headerShown: !Platform.isTV,
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <Stack.Screen
        name='settings/intro/page'
        options={{
          title: t("home.settings.intro.title"),
          headerShown: !Platform.isTV,
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <Stack.Screen
        name='settings/logs/page'
        options={{
          title: t("home.settings.logs.logs_title"),
          headerShown: !Platform.isTV,
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      <Stack.Screen
        name='settings/network/page'
        options={{
          title: t("home.settings.network.title"),
          headerShown: !Platform.isTV,
          headerBlurEffect: "none",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
          headerLeft: () => <HeaderBackButton />,
        }}
      />
      {Object.entries(nestedTabPageScreenOptions).map(([name, options]) => (
        <Stack.Screen key={name} name={name} options={options} />
      ))}
      <Stack.Screen
        name='collections/[collectionId]'
        options={{
          title: "",
          headerLeft: () => <HeaderBackButton />,
          headerShown: !Platform.isTV,
          headerBlurEffect: "prominent",
          headerTransparent: Platform.OS === "ios",
          headerShadowVisible: false,
        }}
      />
    </Stack>
  );
}

// Pushes the whole Anki collection to AnkiWeb (AnkiConnect "sync"). Uses the
// active profile's AnkiConnect URL; sync is collection-wide so profile doesn't
// really matter beyond which URL is configured.
const AnkiSyncButton = () => {
  const [syncing, setSyncing] = useState(false);

  const onPress = async () => {
    if (syncing) return;
    const url = getAnkiConfig().url;
    if (!url) {
      toast.error("Set an AnkiConnect URL in Settings → Anki first");
      return;
    }
    setSyncing(true);
    try {
      await syncAnki(url);
      toast.success("Anki sync started");
    } catch (e) {
      toast.error((e as Error).message || "Anki sync failed");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Pressable
      onPress={onPress}
      className='mr-4'
      hitSlop={8}
      disabled={syncing}
    >
      {syncing ? (
        <ActivityIndicator size='small' color='white' />
      ) : (
        <Ionicons name='cloud-upload-outline' color='white' size={24} />
      )}
    </Pressable>
  );
};

const SettingsButton = () => {
  const router = useRouter();

  return (
    <Pressable
      onPress={() => {
        router.push("/(auth)/settings");
      }}
    >
      <Feather name='settings' color={"white"} size={22} />
    </Pressable>
  );
};

const SessionsButton = () => {
  const router = useRouter();
  const { sessions = [] } = useSessions({} as useSessionsProps);

  return (
    <Pressable
      onPress={() => {
        router.push("/(auth)/sessions");
      }}
      className='mr-4'
    >
      <Ionicons
        name='play-circle'
        color={sessions.length === 0 ? "white" : "#9333ea"}
        size={28}
      />
    </Pressable>
  );
};
