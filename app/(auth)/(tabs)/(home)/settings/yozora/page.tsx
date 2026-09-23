/*
 * Settings → Yozora: connect this device to the self-hosted Yozora backend
 * (~/playground/yozora) that powers the on-demand anime/streaming surface.
 *
 * Phase 1 of the Yozora migration (docs/yomifin/YOZORA_MIGRATION_PLAN.md):
 * this screen is the ONLY user-visible change — it establishes the session
 * (server URL + username/password → opaque device token, AUTH-1) that Phase 2's
 * (yozora) tab and Phase 3's player consume via useYozora().
 *
 * Credentials are dedicated MMKV keys (utils/yozora/session.ts), NOT Settings;
 * only yozoraDeviceName / yozoraAutoPlay live in Settings.
 */
import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSettings } from "@/utils/atoms/settings";
import { YozoraApiError } from "@/utils/yozora/api";
import { useYozora } from "@/utils/yozora/session";

export default function YozoraSettingsPage() {
  const insets = useSafeAreaInsets();
  const { settings, updateSettings } = useSettings();
  const {
    client,
    connected,
    serverUrl: storedUrl,
    username,
    connect,
    disconnect,
  } = useYozora();

  const [serverUrl, setServerUrl] = useState(storedUrl);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  const onConnect = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await connect({
        serverUrl,
        username: user.trim(),
        password,
        deviceName: settings.yozoraDeviceName ?? "Yomifin iPad",
      });
      setPassword("");
      setUser("");
      setStatus({ kind: "ok", text: "Connected." });
    } catch (e) {
      setStatus({ kind: "err", text: describeError(e) });
    } finally {
      setBusy(false);
    }
  };

  const onTest = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const me = await client.me();
      setStatus({
        kind: "ok",
        text: `Reachable — signed in as ${me.username}.`,
      });
    } catch (e) {
      setStatus({ kind: "err", text: describeError(e) });
    } finally {
      setBusy(false);
    }
  };

  const onDisconnect = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await disconnect();
      setStatus({ kind: "ok", text: "Signed out." });
    } catch (e) {
      setStatus({ kind: "err", text: describeError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior='automatic'
      contentContainerStyle={{
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
    >
      <View
        className='p-4 flex flex-col'
        style={{ paddingTop: Platform.OS === "android" ? 10 : 0, gap: 20 }}
      >
        <Text style={s.subtitle}>
          Yozora is the self-hosted backend that resolves debrid streams and
          tracks progress for the anime tab. Enter your server and account to
          connect this device.
        </Text>

        {/* Connection status banner */}
        <View
          style={{
            backgroundColor: connected
              ? "rgba(52,199,89,0.12)"
              : "rgba(255,255,255,0.06)",
            borderRadius: 10,
            padding: 12,
          }}
        >
          <Text
            style={{
              color: connected ? "#34c759" : "#aaa",
              fontWeight: "700",
            }}
          >
            {connected ? `Connected as ${username}` : "Not connected"}
          </Text>
          {connected ? <Text style={s.subtitle}>{storedUrl}</Text> : null}
        </View>

        {/* Server URL */}
        <View style={{ gap: 8 }}>
          <Text style={s.title}>Server URL</Text>
          <Text style={s.subtitle}>
            The deployment origin, e.g. https://yozora.example.com — no /api/v1.
          </Text>
          <TextInput
            value={serverUrl}
            onChangeText={setServerUrl}
            editable={!connected && !busy}
            placeholder='https://yozora.example.com'
            placeholderTextColor='#666'
            autoCapitalize='none'
            autoCorrect={false}
            keyboardType='url'
            style={s.input}
          />
        </View>

        {!connected ? (
          <>
            {/* Credentials */}
            <View style={{ gap: 8 }}>
              <Text style={s.title}>Username</Text>
              <TextInput
                value={user}
                onChangeText={setUser}
                editable={!busy}
                placeholder='username'
                placeholderTextColor='#666'
                autoCapitalize='none'
                autoCorrect={false}
                style={s.input}
              />
            </View>
            <View style={{ gap: 8 }}>
              <Text style={s.title}>Password</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                editable={!busy}
                placeholder='password'
                placeholderTextColor='#666'
                secureTextEntry
                autoCapitalize='none'
                autoCorrect={false}
                style={s.input}
                onSubmitEditing={() => {
                  if (serverUrl.trim() && user.trim() && password) onConnect();
                }}
              />
            </View>

            <Button
              label='Connect'
              busy={busy}
              disabled={!serverUrl.trim() || !user.trim() || !password}
              onPress={onConnect}
            />
          </>
        ) : (
          <>
            {/* Auto-play */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.title}>Auto-play best cached source</Text>
                <Text style={s.subtitle}>
                  Skip the source picker and play the best already-cached
                  release (falls back to the picker when nothing is cached).
                </Text>
              </View>
              <Switch
                value={settings.yozoraAutoPlay ?? false}
                onValueChange={(v) => updateSettings({ yozoraAutoPlay: v })}
              />
            </View>

            <Button label='Test connection' busy={busy} onPress={onTest} />
            <Button
              label='Sign out'
              busy={busy}
              destructive
              onPress={onDisconnect}
            />
          </>
        )}

        {status ? (
          <Text
            style={{
              color: status.kind === "ok" ? "#34c759" : "#ff6b6b",
              fontSize: 14,
            }}
          >
            {status.text}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

function describeError(e: unknown): string {
  if (e instanceof YozoraApiError) {
    if (e.code === "NETWORK_ERROR")
      return "Couldn't reach the server. Check the URL and that Yozora is running.";
    if (e.code === "INVALID_CREDENTIALS" || e.status === 401)
      return "Wrong username or password.";
    if (e.code === "ACCOUNT_DISABLED") return "This account is disabled.";
    return `${e.code}: ${e.message}`;
  }
  return (e as Error)?.message ?? "Something went wrong.";
}

function Button({
  label,
  onPress,
  busy,
  disabled,
  destructive,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const off = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={{
        backgroundColor: destructive
          ? "rgba(255,59,48,0.15)"
          : off
            ? "rgba(255,255,255,0.08)"
            : "#6cb6ff",
        borderRadius: 10,
        paddingVertical: 12,
        alignItems: "center",
        flexDirection: "row",
        justifyContent: "center",
        gap: 8,
      }}
    >
      {busy ? <ActivityIndicator size='small' color='#fff' /> : null}
      <Text
        style={{
          color: destructive ? "#ff6b6b" : off ? "#888" : "#001",
          fontWeight: "700",
          fontSize: 15,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const s = {
  title: { color: "#fff", fontSize: 16, fontWeight: "700" as const },
  subtitle: {
    color: "#888",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  input: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#fff",
    fontSize: 15,
  },
};
