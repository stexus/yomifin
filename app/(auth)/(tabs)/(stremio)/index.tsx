/*
 * Stremio tab home: configured addons + their browsable catalogs.
 *
 * MVP shell over utils/stremio/client.ts — entirely separate from the Jellyfin
 * browsing surface (see FEATURES.md backlog item 1).
 */
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/common/Text";
import useRouter from "@/hooks/useAppRouter";
import { useSettings } from "@/utils/atoms/settings";
import { browsableCatalogs } from "@/utils/stremio/client";
import {
  invalidateAddonCache,
  useStremioAddons,
} from "@/utils/stremio/useStremioAddons";

export default function StremioHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { settings, updateSettings } = useSettings();
  const { states, retry } = useStremioAddons();
  const [newUrl, setNewUrl] = useState("");
  const [manageMode, setManageMode] = useState(false);

  const urls = settings?.stremioAddonUrls ?? [];

  const addAddon = () => {
    const url = newUrl.trim();
    if (!url || urls.includes(url)) return;
    updateSettings({ stremioAddonUrls: [...urls, url] });
    setNewUrl("");
  };

  const removeAddon = (url: string) => {
    invalidateAddonCache(url);
    updateSettings({ stremioAddonUrls: urls.filter((u) => u !== url) });
  };

  return (
    <ScrollView
      className='flex-1 bg-black'
      contentContainerStyle={{
        paddingTop: insets.top + 56,
        paddingBottom: insets.bottom + 96,
        paddingHorizontal: 16,
      }}
      contentInsetAdjustmentBehavior='automatic'
    >
      <View className='flex-row items-center justify-between mb-4'>
        <Text className='text-neutral-400 text-xs'>
          {urls.length} addon{urls.length === 1 ? "" : "s"} configured
        </Text>
        <Pressable onPress={() => setManageMode((m) => !m)} hitSlop={8}>
          <Text className='text-purple-400 text-sm'>
            {manageMode ? "Done" : "Manage addons"}
          </Text>
        </Pressable>
      </View>

      {manageMode ? (
        <View className='mb-6 bg-neutral-900 rounded-xl p-3'>
          {urls.map((u) => (
            <View
              key={u}
              className='flex-row items-center justify-between py-2 border-b border-neutral-800'
            >
              <Text
                className='text-neutral-300 text-xs flex-1 mr-3'
                numberOfLines={1}
              >
                {u}
              </Text>
              <Pressable onPress={() => removeAddon(u)} hitSlop={8}>
                <Text className='text-red-400 text-sm'>Remove</Text>
              </Pressable>
            </View>
          ))}
          <View className='flex-row items-center mt-3'>
            <TextInput
              className='flex-1 bg-neutral-800 text-white rounded-lg px-3 py-2 mr-2 text-xs'
              placeholder='https://…/manifest.json'
              placeholderTextColor='#777'
              autoCapitalize='none'
              autoCorrect={false}
              value={newUrl}
              onChangeText={setNewUrl}
            />
            <Pressable
              onPress={addAddon}
              className='bg-purple-600 rounded-lg px-4 py-2'
            >
              <Text className='text-white text-sm'>Add</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {states.length === 0 ? (
        <Text className='text-neutral-400'>
          No Stremio addons configured. Tap "Manage addons" and paste a manifest
          URL.
        </Text>
      ) : null}

      {states.map((s) => (
        <View key={s.manifestUrl} className='mb-6'>
          <View className='flex-row items-center mb-2'>
            <Text className='text-white text-lg font-bold mr-2'>
              {s.addon?.manifest.name ?? "Addon"}
            </Text>
            {s.status === "loading" ? (
              <ActivityIndicator size='small' color='#aaa' />
            ) : null}
          </View>
          {s.status === "error" ? (
            <Pressable onPress={() => retry(s.manifestUrl)}>
              <Text className='text-red-400 text-xs'>
                Failed to load manifest — tap to retry ({s.error})
              </Text>
            </Pressable>
          ) : null}
          {s.addon
            ? (() => {
                const cats = browsableCatalogs(s.addon.manifest);
                if (cats.length === 0)
                  return (
                    <Text className='text-neutral-500 text-xs'>
                      No browsable catalogs (stream/meta provider)
                    </Text>
                  );
                return cats.map((c) => (
                  <Pressable
                    key={`${c.type}/${c.id}`}
                    className='bg-neutral-900 rounded-xl px-4 py-3 mb-2 flex-row items-center justify-between'
                    onPress={() =>
                      router.push({
                        // Typed-routes cast: route added on this branch; the
                        // generated Href union regenerates on next `expo start`.
                        pathname: "/(auth)/(tabs)/(stremio)/catalog" as any,
                        params: {
                          manifestUrl: s.manifestUrl,
                          type: c.type,
                          id: c.id,
                          name: c.name ?? c.id,
                        },
                      })
                    }
                  >
                    <Text className='text-white'>{c.name ?? c.id}</Text>
                    <Text className='text-neutral-500 text-xs'>{c.type}</Text>
                  </Pressable>
                ));
              })()
            : null}
        </View>
      ))}
    </ScrollView>
  );
}
