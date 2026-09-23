/*
 * Required disconnected states for the Yozora tab (never a bare spinner):
 *   not configured  → explainer + deep link to Settings → Yozora;
 *   unreachable     → "server unreachable" + retry (probe via GET /me).
 * Children render only when connected AND the probe succeeds (probe result is
 * cached; individual queries still carry their own error states).
 */
import { useQuery } from "@tanstack/react-query";
import type React from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Text } from "@/components/common/Text";
import useRouter from "@/hooks/useAppRouter";
import { useYozora } from "@/utils/yozora/session";

export default function DisconnectedGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { client, connected, serverUrl } = useYozora();

  const probe = useQuery({
    queryKey: ["yozora", "probe", serverUrl],
    queryFn: () => client.me(),
    enabled: connected,
    staleTime: 60 * 1000,
    retry: 1,
  });

  if (!connected) {
    return (
      <View className='flex-1 items-center justify-center px-10'>
        <Text className='text-white text-lg font-bold mb-2'>
          Connect to Yozora
        </Text>
        <Text className='text-neutral-400 text-sm text-center mb-5'>
          This tab streams from your self-hosted Yozora server. Add the server
          URL and sign in to get started.
        </Text>
        <Pressable
          className='bg-purple-600 rounded-xl px-5 py-3'
          onPress={() => router.push("/settings/yozora/page" as any)}
        >
          <Text className='text-white font-bold'>Open Yozora settings</Text>
        </Pressable>
      </View>
    );
  }

  if (probe.isError) {
    return (
      <View className='flex-1 items-center justify-center px-10'>
        <Text className='text-white text-lg font-bold mb-2'>
          Server unreachable
        </Text>
        <Text className='text-neutral-400 text-sm text-center mb-5'>
          Couldn't reach {serverUrl}. Check the network (or the deployment) and
          try again.
        </Text>
        <Pressable
          className='bg-neutral-800 rounded-xl px-5 py-3'
          onPress={() => probe.refetch()}
        >
          <Text className='text-white font-bold'>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (probe.isLoading) {
    return (
      <View className='flex-1 items-center justify-center'>
        <ActivityIndicator color='#aaa' />
      </View>
    );
  }

  return <>{children}</>;
}
