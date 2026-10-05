// Registers the tsx require hook so the TypeScript config plugins referenced
// from app.json ("./plugins/*.ts") can be loaded by Node during config evaluation.
import "tsx/cjs";
import { execFileSync } from "node:child_process";
import type { ConfigContext, ExpoConfig } from "expo/config";

// Build metadata, injected into `extra.build` and read at runtime via
// expo-constants (see utils/version.ts). Sources in priority order:
// EAS cloud build → GitHub Actions → explicit EXPO_PUBLIC_* → local git → null.
const git = (args: string[]): string | null => {
  try {
    return execFileSync("git", args, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return null;
  }
};

const buildMeta = {
  commit:
    (
      process.env.EAS_BUILD_GIT_COMMIT_HASH ||
      process.env.GITHUB_SHA ||
      process.env.EXPO_PUBLIC_GIT_COMMIT ||
      git(["rev-parse", "HEAD"]) ||
      ""
    ).slice(0, 7) || null,
  branch:
    process.env.EAS_BUILD_GIT_BRANCH ||
    process.env.GITHUB_HEAD_REF ||
    process.env.GITHUB_REF_NAME ||
    process.env.EXPO_PUBLIC_GIT_BRANCH ||
    git(["rev-parse", "--abbrev-ref", "HEAD"]) ||
    null,
  profile:
    process.env.EAS_BUILD_PROFILE ||
    process.env.EXPO_PUBLIC_BUILD_PROFILE ||
    null,
  // GitHub Actions run number (#2098) — lets anyone map a sideloaded CI build back
  // to its Actions run (artifacts + logs) without Expo access. Null outside CI.
  runNumber:
    process.env.GITHUB_RUN_NUMBER ||
    process.env.EXPO_PUBLIC_GIT_RUN_NUMBER ||
    null,
  builtAt: new Date().toISOString(),
};

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = process.env.APP_VARIANT ?? "stable";
  if (variant !== "stable" && variant !== "development") {
    throw new Error(`Unknown APP_VARIANT: ${variant}`);
  }

  if (process.env.EXPO_TV !== "1") {
    const isDev = variant === "development";
    config.name = isDev ? "Yomifin Dev" : "Yomifin";
    config.scheme = isDev ? "yomifin-dev" : "streamyfin";
    config.ios = {
      ...config.ios,
      bundleIdentifier: isDev
        ? "com.massimotseng.yomifin.dev"
        : "com.massimotseng.yomifin",
      buildNumber:
        process.env.YOMIFIN_BUILD_NUMBER ?? config.ios?.buildNumber ?? "1",
    };
    // Only Dev should claim Expo's generated URL scheme when both apps exist.
    config.plugins = [
      ...(config.plugins ?? []),
      ["expo-dev-client", { addGeneratedScheme: isDev }],
    ];
    config.plugins?.push("expo-background-task");

    config.plugins?.push([
      "react-native-google-cast",
      { useDefaultExpandedMediaControls: true },
    ]);

    config.plugins?.push([
      "expo-camera",
      {
        cameraPermission:
          "Allow Streamyfin to access the camera to scan QR codes for TV login.",
      },
    ]);
  }

  // Sentry source-map/dSYM upload needs SENTRY_AUTH_TOKEN; without it the
  // injected build phases fail Release builds outright. Disable upload unless
  // the token is present (EAS secret / CI env), so it self-enables with it.
  for (const plugin of config.plugins ?? []) {
    if (Array.isArray(plugin) && plugin[0] === "@sentry/react-native/expo") {
      plugin[1] = {
        ...plugin[1],
        disableAutoUpload: !process.env.SENTRY_AUTH_TOKEN,
      };
    }
  }

  // Only override googleServicesFile if env var is set
  const androidConfig: { googleServicesFile?: string } = {};
  if (process.env.GOOGLE_SERVICES_JSON) {
    androidConfig.googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
  }

  config.extra = { ...config.extra, build: buildMeta };

  return {
    ...(Object.keys(androidConfig).length > 0 && { android: androidConfig }),
    ...config,
  } as ExpoConfig;
};
