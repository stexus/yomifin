/*
 * Yozora session glue — the DEVICE-only bridge between the pure client
 * (utils/yozora/api.ts) and app state. This is where storage reads live, so
 * api.ts can stay pure and bun-testable.
 *
 * CREDENTIAL STORAGE: serverUrl/token/username/deviceId live in dedicated
 * top-level MMKV keys (`yozora.*`), NOT in Settings — deliberately mirroring
 * how the Jellyfin session stores `token`/`serverUrl` (JellyfinProvider.tsx).
 * The Settings bag is the wrong place for credentials: it participates in the
 * Streamyfin plugin-settings override mechanism (a Jellyfin server can lock /
 * override any Settings key at runtime), and it's serialized wholesale to a
 * JSON blob. Only harmless prefs (yozoraDeviceName, yozoraAutoPlay) stay in
 * Settings.
 *
 *   const { client, connected, connect, disconnect } = useYozora();
 *   if (connected) await client.continueWatching();
 */
import { atom, useAtom } from "jotai";
import { useCallback, useMemo } from "react";
import { storage } from "@/utils/mmkv";
import { createYozoraClient, normalizeBaseUrl, type YozoraClient } from "./api";

const KEY_SERVER = "yozora.serverUrl";
const KEY_TOKEN = "yozora.token";
const KEY_USERNAME = "yozora.username";
const KEY_DEVICE_ID = "yozora.deviceId";

export interface YozoraCredentials {
  serverUrl: string;
  token: string;
  username: string;
  deviceId: number | null;
}

function loadCredentials(): YozoraCredentials {
  return {
    serverUrl: storage.getString(KEY_SERVER) ?? "",
    token: storage.getString(KEY_TOKEN) ?? "",
    username: storage.getString(KEY_USERNAME) ?? "",
    deviceId: storage.getNumber(KEY_DEVICE_ID) ?? null,
  };
}

/** MMKV is synchronous, so the atom is correct from first render. */
const yozoraCredentialsAtom = atom<YozoraCredentials>(loadCredentials());

export interface ConnectArgs {
  serverUrl: string;
  username: string;
  password: string;
  deviceName?: string;
}

export interface YozoraSession {
  /** Client bound to the current server URL + token (present even when signed
   *  out — auth-gated calls will 401). */
  client: YozoraClient;
  /** True once a server URL AND token are configured. */
  connected: boolean;
  serverUrl: string;
  username: string;
  /** POST /auth/login → persist session (throws YozoraApiError on failure). */
  connect: (args: ConnectArgs) => Promise<void>;
  /** Best-effort self-revoke of this device, then clear the local session
   *  regardless (a failed revoke must not strand the user signed-in locally).
   *  Keeps serverUrl for convenient re-login. */
  disconnect: () => Promise<void>;
}

/** React hook: memoized Yozora client + session state + connect/disconnect. */
export function useYozora(): YozoraSession {
  const [creds, setCreds] = useAtom(yozoraCredentialsAtom);

  const client = useMemo(
    () =>
      createYozoraClient({
        baseUrl: creds.serverUrl,
        token: creds.token || null,
      }),
    [creds.serverUrl, creds.token],
  );

  const connect = useCallback(
    async ({ serverUrl, username, password, deviceName }: ConnectArgs) => {
      const normalized = normalizeBaseUrl(serverUrl);
      const loginClient = createYozoraClient({ baseUrl: normalized });
      const res = await loginClient.login(username, password, deviceName);
      storage.set(KEY_SERVER, normalized);
      storage.set(KEY_TOKEN, res.token);
      storage.set(KEY_USERNAME, res.user.username);
      storage.set(KEY_DEVICE_ID, res.device.id);
      setCreds(loadCredentials());
    },
    [setCreds],
  );

  const disconnect = useCallback(async () => {
    const { serverUrl, token, deviceId } = loadCredentials();
    if (serverUrl && token && deviceId != null) {
      try {
        await createYozoraClient({ baseUrl: serverUrl, token }).logoutDevice(
          deviceId,
        );
      } catch {
        // token already revoked / server down — clear locally anyway
      }
    }
    storage.remove(KEY_TOKEN);
    storage.remove(KEY_USERNAME);
    storage.remove(KEY_DEVICE_ID);
    setCreds(loadCredentials());
  }, [setCreds]);

  return {
    client,
    connected: Boolean(creds.serverUrl && creds.token),
    serverUrl: creds.serverUrl,
    username: creds.username,
    connect,
    disconnect,
  };
}
