/*
 * RN-side seam for the pure Stremio client: loads manifests for the configured
 * addon URLs (Settings.stremioAddonUrls) with a module-level cache so navigating
 * between Stremio screens doesn't re-fetch every manifest.
 */
import { useEffect, useMemo, useState } from "react";
import { useSettings } from "@/utils/atoms/settings";
import { fetchManifest, type LoadedAddon } from "./client";

const manifestCache = new Map<string, LoadedAddon>();
const failureCache = new Map<string, string>();

export interface AddonState {
  manifestUrl: string;
  status: "loading" | "ready" | "error";
  addon?: LoadedAddon;
  error?: string;
}

export function invalidateAddonCache(manifestUrl?: string) {
  if (manifestUrl) {
    manifestCache.delete(manifestUrl);
    failureCache.delete(manifestUrl);
  } else {
    manifestCache.clear();
    failureCache.clear();
  }
}

/** Load all configured addons; `addons` contains only the ready ones, in order. */
export function useStremioAddons(): {
  urls: string[];
  states: AddonState[];
  addons: LoadedAddon[];
  loading: boolean;
  retry: (url: string) => void;
} {
  const { settings } = useSettings();
  const urls = useMemo(
    () => settings?.stremioAddonUrls ?? [],
    [settings?.stremioAddonUrls],
  );
  const [nonce, setNonce] = useState(0);
  const [states, setStates] = useState<AddonState[]>([]);

  useEffect(() => {
    let cancelled = false;
    const compute = () =>
      urls.map((u): AddonState => {
        const cached = manifestCache.get(u);
        if (cached) return { manifestUrl: u, status: "ready", addon: cached };
        const err = failureCache.get(u);
        if (err) return { manifestUrl: u, status: "error", error: err };
        return { manifestUrl: u, status: "loading" };
      });
    setStates(compute());
    for (const u of urls) {
      if (manifestCache.has(u) || failureCache.has(u)) continue;
      fetchManifest(u)
        .then((manifest) => {
          manifestCache.set(u, { manifestUrl: u, manifest });
        })
        .catch((e) => {
          failureCache.set(u, (e as Error).message);
          console.warn(`[STREMIO] manifest failed for ${u}: ${e}`);
        })
        .finally(() => {
          if (!cancelled) setStates(compute());
        });
    }
    return () => {
      cancelled = true;
    };
  }, [urls, nonce]);

  const addons = useMemo(
    () =>
      states
        .filter((s) => s.status === "ready" && s.addon)
        .map((s) => s.addon as LoadedAddon),
    [states],
  );

  return {
    urls,
    states,
    addons,
    loading: states.some((s) => s.status === "loading"),
    retry: (url: string) => {
      invalidateAddonCache(url);
      setNonce((n) => n + 1);
    },
  };
}
