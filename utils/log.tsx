import { useQuery } from "@tanstack/react-query";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import type React from "react";
import { storage } from "./mmkv";

export type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: any;
}

const mmkvStorage = createJSONStorage(() => ({
  getItem: (key: string) => storage.getString(key) || null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.remove(key),
}));
const logsAtom = atomWithStorage("logs", [], mmkvStorage);

export const writeToLog = (level: LogLevel, message: string, data?: any) => {
  const newEntry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: level,
    message: message,
    data: data,
  };

  const currentLogs = storage.getString("logs");
  const logs: LogEntry[] = currentLogs ? JSON.parse(currentLogs) : [];
  logs.push(newEntry);

  const maxLogs = 100;
  const recentLogs = logs.slice(Math.max(logs.length - maxLogs, 0));

  storage.set("logs", JSON.stringify(recentLogs));
};

export const writeInfoLog = (message: string, data?: any) =>
  writeToLog("INFO", message, data);
export const writeErrorLog = (message: string, data?: any) =>
  writeToLog("ERROR", message, data);
export const writeDebugLog = (message: string, data?: any) => {
  if (process.env.EXPO_PUBLIC_WRITE_DEBUG === "1") {
    writeToLog("DEBUG", message, data);
  }
};

export const readFromLog = (): LogEntry[] => {
  const logs = storage.getString("logs");
  return logs ? JSON.parse(logs) : [];
};

/**
 * Live view of the persisted log ring buffer. The 1s poll runs ONLY while a
 * component using this hook is mounted (i.e. the Logs settings screen) — it used
 * to run app-wide via a root provider, doing an MMKV read + JSON.parse every
 * second for the whole app lifetime even though nothing but this screen reads it.
 */
export function useLog() {
  const { data: logs } = useQuery({
    queryKey: ["logs"],
    queryFn: async () => readFromLog(),
    refetchInterval: 1000,
  });

  return { logs };
}

/**
 * Kept as a passthrough so the root layout's tree is unchanged. Polling now lives
 * in `useLog()` (see above), scoped to where the logs are actually shown.
 */
export function LogProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export default logsAtom;
