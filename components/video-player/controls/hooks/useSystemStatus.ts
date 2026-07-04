/*
 * useSystemStatus — feeds the player's custom OSD status bar.
 *
 * Sources:
 *  - clock/date: a low-frequency interval (10s; the minute is what matters).
 *  - battery: expo-battery (level + charging), via an OPTIONAL native require so a
 *    stale binary that predates the dependency degrades gracefully (no battery
 *    readout) instead of crashing the whole player route.
 *  - network type: @react-native-community/netinfo (wifi / cellular / none).
 *  - throughput: polled from mpv's technical info (video+audio bitrate) ONLY while
 *    `needsThroughput` is true (controls up + the user enabled the network item),
 *    so idle playback pays nothing.
 */
import NetInfo, {
  type NetInfoStateType,
} from "@react-native-community/netinfo";
import { useEffect, useRef, useState } from "react";
import type { TechnicalInfo } from "@/modules/mpv-player";

// expo-battery is a NATIVE module (added for this feature). Require it optionally so
// a JS-only Metro run on a binary that predates it doesn't hard-crash — the battery
// item just renders nothing until the app is rebuilt.
type BatteryModule = typeof import("expo-battery");
let Battery: BatteryModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Battery = require("expo-battery") as BatteryModule;
} catch {
  Battery = null;
}

export interface SystemStatus {
  /** Localized wall-clock time, e.g. "9:41 PM" (12h) or "21:41" (24h). */
  clock: string;
  /** Localized short date, e.g. "Sat, Jul 4". */
  date: string;
  /** 0..1, or null when unavailable (module missing / not yet read). */
  batteryLevel: number | null;
  batteryCharging: boolean;
  /** "wifi" | "cellular" | "none" | "other" */
  netType: NetInfoStateType | "unknown";
  /** Estimated current stream throughput in KB/s, or null when not polled. */
  throughputKbps: number | null;
}

interface Options {
  /** 12-hour clock (else 24h). */
  hour12: boolean;
  /** Poll mpv for stream bitrate → throughput readout. */
  needsThroughput: boolean;
  getTechnicalInfo?: () => Promise<TechnicalInfo>;
}

function formatClock(d: Date, hour12: boolean): string {
  return d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12,
  });
}

function formatDate(d: Date): string {
  return d.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function useSystemStatus({
  hour12,
  needsThroughput,
  getTechnicalInfo,
}: Options): SystemStatus {
  const [now, setNow] = useState(() => new Date());
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [batteryCharging, setBatteryCharging] = useState(false);
  const [netType, setNetType] = useState<NetInfoStateType | "unknown">(
    "unknown",
  );
  const [throughputKbps, setThroughputKbps] = useState<number | null>(null);

  // Clock — tick every 10s (cheap; the visible resolution is the minute).
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(id);
  }, []);

  // Battery — initial read + live listeners. Wrapped defensively: on a binary that
  // predates the native module, the expo wrapper can throw at CALL time (not just at
  // require), which must not take down the player.
  useEffect(() => {
    if (!Battery) return;
    let mounted = true;
    let lvlSub: { remove?: () => void } | undefined;
    let stateSub: { remove?: () => void } | undefined;
    try {
      Battery.getBatteryLevelAsync()
        .then((lvl) => {
          if (mounted && lvl >= 0) setBatteryLevel(lvl);
        })
        .catch(() => {});
      Battery.getBatteryStateAsync?.()
        .then((state) => {
          if (!mounted) return;
          setBatteryCharging(
            state === Battery?.BatteryState.CHARGING ||
              state === Battery?.BatteryState.FULL,
          );
        })
        .catch(() => {});
      lvlSub = Battery.addBatteryLevelListener(({ batteryLevel: lvl }) => {
        if (lvl >= 0) setBatteryLevel(lvl);
      });
      stateSub = Battery.addBatteryStateListener(({ batteryState }) => {
        setBatteryCharging(
          batteryState === Battery?.BatteryState.CHARGING ||
            batteryState === Battery?.BatteryState.FULL,
        );
      });
    } catch {
      /* native module unavailable on this binary — battery item stays hidden */
    }
    return () => {
      mounted = false;
      lvlSub?.remove?.();
      stateSub?.remove?.();
    };
  }, []);

  // Network type — live.
  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      setNetType(state.type);
    });
    return () => unsub();
  }, []);

  // Throughput — poll mpv bitrate only while needed.
  const tiRef = useRef(getTechnicalInfo);
  tiRef.current = getTechnicalInfo;
  useEffect(() => {
    if (!needsThroughput || !tiRef.current) {
      setThroughputKbps(null);
      return;
    }
    let mounted = true;
    const poll = async () => {
      try {
        const info = await tiRef.current?.();
        if (!mounted || !info) return;
        const bits = (info.videoBitrate ?? 0) + (info.audioBitrate ?? 0);
        setThroughputKbps(bits > 0 ? bits / 8 / 1024 : null);
      } catch {
        /* ignore */
      }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [needsThroughput]);

  return {
    clock: formatClock(now, hour12),
    date: formatDate(now),
    batteryLevel,
    batteryCharging,
    netType,
    throughputKbps,
  };
}
