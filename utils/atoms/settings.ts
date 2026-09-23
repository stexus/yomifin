import {
  type BaseItemKind,
  type CultureDto,
  type ItemFilter,
  type ItemSortBy,
  type SortOrder,
  SubtitlePlaybackMode,
} from "@jellyfin/sdk/lib/generated-client";
import { t } from "i18next";
import { atom, useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect } from "react";
import { Platform } from "react-native";
import { BITRATES, type Bitrate } from "@/components/BitrateSelector";
import * as ScreenOrientation from "@/packages/expo-screen-orientation";
import { apiAtom } from "@/providers/JellyfinProvider";
import { logAndCaptureError, writeInfoLog } from "@/utils/log";
import {
  PLUGIN_SETTINGS_KEY,
  readStoredSettings,
  SETTINGS_KEY,
} from "@/utils/storedSettings";
import { storage } from "../mmkv";
import {
  type AppliedPluginDefaults,
  pluginRefreshOverlay,
  resolveEffectiveSettings,
} from "./settingsOverrides";

const _STREAMYFIN_PLUGIN_ID = "1e9e5d386e6746158719e98a5c34f004";
const STREAMYFIN_PLUGIN_SETTINGS = PLUGIN_SETTINGS_KEY;
const PLUGIN_APPLIED_DEFAULTS = "STREAMYFIN_PLUGIN_APPLIED_DEFAULTS";

export type DownloadQuality = "original" | "high" | "low";

export type DownloadOption = {
  label: string;
  value: DownloadQuality;
};

export const ScreenOrientationEnum: Record<
  (typeof ScreenOrientation.OrientationLock)[keyof typeof ScreenOrientation.OrientationLock],
  string
> = {
  [ScreenOrientation.OrientationLock.DEFAULT]:
    "home.settings.other.orientations.DEFAULT",
  [ScreenOrientation.OrientationLock.ALL]:
    "home.settings.other.orientations.ALL",
  [ScreenOrientation.OrientationLock.PORTRAIT]:
    "home.settings.other.orientations.PORTRAIT",
  [ScreenOrientation.OrientationLock.PORTRAIT_UP]:
    "home.settings.other.orientations.PORTRAIT_UP",
  [ScreenOrientation.OrientationLock.PORTRAIT_DOWN]:
    "home.settings.other.orientations.PORTRAIT_DOWN",
  [ScreenOrientation.OrientationLock.LANDSCAPE]:
    "home.settings.other.orientations.LANDSCAPE",
  [ScreenOrientation.OrientationLock.LANDSCAPE_LEFT]:
    "home.settings.other.orientations.LANDSCAPE_LEFT",
  [ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT]:
    "home.settings.other.orientations.LANDSCAPE_RIGHT",
  [ScreenOrientation.OrientationLock.OTHER]:
    "home.settings.other.orientations.OTHER",
  [ScreenOrientation.OrientationLock.UNKNOWN]:
    "home.settings.other.orientations.UNKNOWN",
};

export const DownloadOptions: DownloadOption[] = [
  {
    label: "Original quality",
    value: "original",
  },
  {
    label: "High quality",
    value: "high",
  },
  {
    label: "Small file size",
    value: "low",
  },
];

export type LibraryOptions = {
  display: "row" | "list";
  cardStyle: "compact" | "detailed";
  imageStyle: "poster" | "cover";
  showTitles: boolean;
  showStats: boolean;
};

export type DefaultLanguageOption = {
  value: string;
  label: string;
};

export type Home = {
  sections: Array<HomeSection>;
};

export type HomeSection = {
  title?: string;
  orientation?: "horizontal" | "vertical";
  items?: HomeSectionItemResolver;
  nextUp?: HomeSectionNextUpResolver;
  latest?: HomeSectionLatestResolver;
  custom?: HomeSectionCustomEndpointResolver;
};

export type HomeSectionItemResolver = {
  title?: string;
  sortBy?: Array<ItemSortBy>;
  sortOrder?: Array<SortOrder>;
  includeItemTypes?: Array<BaseItemKind>;
  genres?: Array<string>;
  parentId?: string;
  limit?: number;
  filters?: Array<ItemFilter>;
};

export type HomeSectionCustomEndpointResolver = {
  title?: string;
  endpoint: string;
  headers?: any;
  query?: any;
};

export type HomeSectionNextUpResolver = {
  parentId?: string;
  limit?: number;
  enableResumable?: boolean;
  enableRewatching?: boolean;
};

export interface MaxAutoPlayEpisodeCount {
  key: string;
  value: number;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * The plugin may send object-typed settings as plain primitives.
 * Resolve to the proper option object from the available choices.
 */
const normalizePluginValue = (
  settingsKey: keyof Settings,
  value: unknown,
): unknown => {
  if (settingsKey === "subtitleSize" && isFiniteNumber(value) && value >= 10) {
    return value / 100;
  }

  if (typeof value !== "object" || value === null) {
    const defaultVal = defaultValues[settingsKey];
    if (
      typeof defaultVal === "object" &&
      defaultVal !== null &&
      "key" in defaultVal &&
      "value" in defaultVal
    ) {
      // defaultBitrate needs a lookup because its keys are human-readable
      // (e.g. "8 Mb/s") that can't be derived from the raw value (e.g. 8000000).
      // Other { key, value } settings like maxAutoPlayEpisodeCount work with
      // the fallback because their keys are just String(value) (e.g. "5").
      if (settingsKey === "defaultBitrate") {
        const match = BITRATES.find(
          (b) => b.key === value || b.value === value,
        );
        if (match) return match;
      }
      // maxAutoPlayEpisodeCount: 0 is invalid (breaks autoplay), clamp to -1
      // -1 key must match the translated dropdown label so the UI shows "Disabled"
      if (
        settingsKey === "maxAutoPlayEpisodeCount" &&
        (value === 0 || value === -1)
      ) {
        return { key: t("home.settings.other.disabled"), value: -1 };
      }
      return { key: String(value), value };
    }
  }
  return value;
};

export type HomeSectionLatestResolver = {
  parentId?: string;
  limit?: number;
  groupItems?: boolean;
  isPlayed?: boolean;
  includeItemTypes?: Array<BaseItemKind>;
};

// Video player enum. MPV is the universal default; ExoPlayer is an
// opt-in alternative on Android TV, selectable via settings.videoPlayer.
// Native is the fully-native chrome (iOS/Android mobile, plus the TV
// toggles) — it decodes with the selected engine, see
// getActiveVideoPlayerEngine.
export enum VideoPlayer {
  MPV = 0,
  ExoPlayer = 1,
  Native = 2,
}

/**
 * Whether ExoPlayer's native module is available on the current platform.
 * ExoPlayer only ships for Android TV; on any other platform a persisted
 * `videoPlayer: ExoPlayer` preference (e.g. MMKV roaming) must fall back
 * to MPV rather than crash on requireNativeView().
 */
export const isExoPlayerSupported =
  Platform.OS === "android" && Platform.isTV === true;

/**
 * Whether the fully-native player is available on the current platform.
 * Android mobile/tablet can opt in. The fork keeps iPhone/iPad on the RN
 * player route so the subtitle lookup and Anki overlays remain available.
 */
export const isNativePlayerSupported =
  // The native iOS chrome does not host Yomifin's RN mining overlays yet.
  Platform.OS === "android" && Platform.isTV !== true;

/**
 * Whether the fully-native player can run on the current platform as the
 * Apple TV variant. It is the default, with the
 * `nativeVideoPlayerTV` setting as the opt-out, and it requires tvOS 26+ —
 * the chrome is built on native glass Menus and other 26-era APIs, so older
 * boxes keep the JS player unconditionally.
 */
export const isNativePlayerSupportedTV =
  Platform.OS === "ios" &&
  Platform.isTV === true &&
  Number.parseInt(String(Platform.Version), 10) >= 26;

/**
 * Whether the fully-native player can run on the current platform as the
 * Android TV variant. It is opt-in via `nativeVideoPlayerAndroidTV` (default false),
 * and requires Android TV.
 */
export const isNativePlayerSupportedAndroidTV =
  Platform.OS === "android" && Boolean(Platform.isTV);

/**
 * The DECODING ENGINE for the current settings — never `Native`. MPV is the
 * universal default; ExoPlayer is an opt-in alternative on Android TV. The
 * engine axis is independent of the controls axis: the fully-native chrome
 * decodes with this same engine (see NativePlayerConfig.engine), so the
 * device profile and the chrome's engine must both resolve from here.
 */
export const getActiveVideoPlayerEngine = (
  settings:
    | Partial<
        Pick<
          Settings,
          "videoPlayer" | "nativeVideoPlayerTV" | "nativeVideoPlayerAndroidTV"
        >
      >
    | null
    | undefined,
): VideoPlayer => {
  if (isExoPlayerSupported && settings?.videoPlayer === VideoPlayer.ExoPlayer) {
    return VideoPlayer.ExoPlayer;
  }
  return VideoPlayer.MPV;
};

/**
 * Resolve what actually RENDERS for the current settings: the fully-native
 * chrome when it is active, otherwise the JS-route engine view. The native
 * toggles pick the CONTROLS layer only — the chrome decodes with
 * getActiveVideoPlayerEngine, so this function says nothing about the
 * engine (use getActivePlayerType for that).
 *
 * On iPhone/iPad the fork always uses the RN route with MPV, including when
 * a persisted preference requests Native. On Apple TV (tvOS 26+) the
 * chrome is the default with `nativeVideoPlayerTV` as the opt-out;
 * on Android TV it is opt-in via `nativeVideoPlayerAndroidTV`. The platform
 * capability gates are folded in here so a caller is never told one thing
 * renders while another actually does — that mismatch would let Jellyfin
 * pick a stream for the wrong renderer.
 */
export const getActiveVideoPlayer = (
  settings:
    | Partial<
        Pick<
          Settings,
          "videoPlayer" | "nativeVideoPlayerTV" | "nativeVideoPlayerAndroidTV"
        >
      >
    | null
    | undefined,
): VideoPlayer => {
  if (isNativePlayerSupportedTV && settings?.nativeVideoPlayerTV !== false) {
    return VideoPlayer.Native;
  }
  if (
    isNativePlayerSupportedAndroidTV &&
    settings?.nativeVideoPlayerAndroidTV === true
  ) {
    return VideoPlayer.Native;
  }
  if (isNativePlayerSupported && settings?.videoPlayer === VideoPlayer.Native) {
    return VideoPlayer.Native;
  }
  return getActiveVideoPlayerEngine(settings);
};

/**
 * Should a play request be handed to the fully-native chrome? The routing
 * predicate for usePlayMedia and the WS "Play" handler — the engine choice
 * travels along inside the presented config.
 */
export const isNativeChromeActive = (
  settings:
    | Partial<
        Pick<
          Settings,
          "videoPlayer" | "nativeVideoPlayerTV" | "nativeVideoPlayerAndroidTV"
        >
      >
    | null
    | undefined,
): boolean => getActiveVideoPlayer(settings) === VideoPlayer.Native;

/**
 * The lowercase player-type identifier that `generateDeviceProfile` expects.
 * This is the ENGINE, always — even while the chrome presents. A chrome-on-
 * ExoPlayer session must negotiate the ExoPlayer profile, and
 * buildNativePlayerConfig passes the same value as the config's engine.
 */
export const getActivePlayerType = (
  settings:
    | Partial<
        Pick<
          Settings,
          "videoPlayer" | "nativeVideoPlayerTV" | "nativeVideoPlayerAndroidTV"
        >
      >
    | null
    | undefined,
): "mpv" | "exoplayer" => {
  return getActiveVideoPlayerEngine(settings) === VideoPlayer.ExoPlayer
    ? "exoplayer"
    : "mpv";
};

// TV Typography scale presets
export enum TVTypographyScale {
  Small = "small",
  Default = "default",
  Large = "large",
  ExtraLarge = "extraLarge",
}

// Segment skip behavior options
export type SegmentSkipMode = "none" | "ask" | "auto";

// Audio transcoding mode - controls how surround audio is handled
// This controls server-side transcoding behavior for audio streams.
// MPV decodes via FFmpeg and supports most formats, but mobile devices
// can't passthrough to external receivers, so this primarily affects
// bandwidth usage and server load.
export enum AudioTranscodeMode {
  Auto = "auto", // Platform defaults (recommended)
  ForceStereo = "stereo", // Always transcode to stereo
  Allow51 = "5.1", // Allow up to 5.1, transcode 7.1+
  AllowAll = "passthrough", // Direct play all audio formats
}

// Inactivity timeout for TV - auto logout after period of no activity
export enum InactivityTimeout {
  Disabled = 0,
  OneMinute = 60000,
  FiveMinutes = 300000,
  FifteenMinutes = 900000,
  ThirtyMinutes = 1800000,
  OneHour = 3600000,
  FourHours = 14400000,
  TwentyFourHours = 86400000,
}

// MPV cache mode - controls how caching is enabled
export type MpvCacheMode = "auto" | "yes" | "no";
export type MpvVoDriver = "gpu-next" | "gpu";

/** Content groups that can appear in the home hero carousel. */
export type HomeHeroSection = "continueWatching" | "nextUp" | "recentlyAdded";
/** Media kinds that can appear in the home hero carousel. */
export type HomeHeroMediaType = "movie" | "tv";

export type Settings = {
  home?: Home | null;
  deviceProfile?: "Expo" | "Native" | "Old";
  mediaListCollectionIds?: string[];
  preferedLanguage?: string;
  searchEngine: "Marlin" | "Jellyfin" | "Streamystats";
  /** Video player backend. Defaults to MPV when unset (see getActiveVideoPlayer). */
  videoPlayer?: VideoPlayer;
  marlinServerUrl?: string;
  streamyStatsServerUrl?: string;
  streamyStatsMovieRecommendations?: boolean;
  streamyStatsSeriesRecommendations?: boolean;
  streamyStatsPromotedWatchlists?: boolean;
  downloadQuality?: DownloadOption;
  /** iOS only: show a Lock Screen / Dynamic Island Live Activity while a download runs. */
  showDownloadLiveActivity: boolean;
  defaultBitrate?: Bitrate;
  libraryOptions: LibraryOptions;
  defaultAudioLanguage: CultureDto | null;
  playDefaultAudioTrack: boolean;
  rememberAudioSelections: boolean;
  defaultSubtitleLanguage: CultureDto | null;
  subtitleMode: SubtitlePlaybackMode;
  rememberSubtitleSelections: boolean;
  /** Turn subtitles on automatically while audio is muted, and off again after. */
  subtitlesOnMute: boolean;
  /**
   * Let that automatic selection pick a subtitle the server must re-process the
   * stream for (burned-in, or image-based while transcoding). Off by default:
   * a volume key press should never interrupt playback.
   */
  subtitlesOnMuteAllowRestart: boolean;
  showHomeTitles: boolean;
  defaultVideoOrientation: (typeof ScreenOrientation.OrientationLock)[keyof typeof ScreenOrientation.OrientationLock];
  forwardSkipTime: number;
  rewindSkipTime: number;
  showCustomMenuLinks: boolean;
  disableHapticFeedback: boolean;
  subtitleSize: number;
  subtitleBackground: boolean;
  subtitleBackgroundOpacity: number;
  subtitleBackgroundPadding: number;
  subtitleFont: string;
  subtitleColor: string;
  subtitleMarginY?: number;
  subtitleAlignX?: "left" | "center" | "right";
  subtitleAlignY?: "top" | "center" | "bottom";
  safeAreaInControlsEnabled: boolean;
  jellyseerrServerUrl?: string;
  /** Seerr admin API key: signs the user in via their Jellyfin ID, no password. */
  jellyseerrApiKey?: string;
  /**
   * Sign in to Jellyseerr automatically on launch using the Jellyfin password.
   * Jellyseerr's /auth/jellyfin endpoint takes the password rather than the
   * Jellyfin token, so enabling this persists that password in the platform
   * secure store. Nothing is stored unless a Jellyseerr server is configured.
   */
  autoLoginJellyseerr: boolean;
  useKefinTweaks: boolean;
  hiddenLibraries?: string[];
  enableH265ForChromecast: boolean;
  maxAutoPlayEpisodeCount: MaxAutoPlayEpisodeCount;
  autoPlayEpisodeCount: number;
  autoPlayNextEpisode: boolean;
  // Media segment skip preferences
  skipIntro: SegmentSkipMode;
  skipOutro: SegmentSkipMode;
  skipRecap: SegmentSkipMode;
  skipCommercial: SegmentSkipMode;
  skipPreview: SegmentSkipMode;
  /** Ask whether to resume or start over when playing an in-progress item. */
  showResumeDialog: boolean;
  // Playback speed settings
  defaultPlaybackSpeed: number;
  playbackSpeedPerMedia: Record<string, number>;
  playbackSpeedPerShow: Record<string, number>;
  // MPV buffer/cache settings
  mpvCacheEnabled?: MpvCacheMode;
  mpvCacheSeconds?: number;
  mpvDemuxerMaxBytes?: number; // MB
  mpvDemuxerMaxBackBytes?: number; // MB
  // MPV video output driver (Android only)
  mpvVoDriver?: MpvVoDriver;
  // Gesture controls
  enableHorizontalSwipeSkip: boolean;
  enableLeftSideBrightnessSwipe: boolean;
  enableRightSideVolumeSwipe: boolean;
  enableHoldToSpeed: boolean;
  holdToSpeedRate: number;
  enablePinchToZoom: boolean;
  enableDoubleTapToSeek: boolean;
  hideVolumeSlider: boolean;
  hideBrightnessSlider: boolean;
  usePopularPlugin: boolean;
  mergeNextUpAndContinueWatching: boolean;
  /**
   * Home hero carousel filters. Both are "hidden" lists, so an empty list
   * (the default) shows everything, and they combine: hiding the
   * "recentlyAdded" group and the "movie" media type leaves only
   * continue-watching and next-up episodes.
   */
  hiddenHomeHeroSections?: HomeHeroSection[];
  hiddenHomeHeroMediaTypes?: HomeHeroMediaType[];
  // Use the episode's own image (instead of the series thumb) for the
  // "Next Up" and "Continue Watching" home rows.
  useEpisodeImagesForNextUp: boolean;
  // TV-specific settings
  /** Apple TV only: use the fully-native tvOS player (default on; needs tvOS 26+). */
  nativeVideoPlayerTV: boolean;
  /** Android TV only: use the fully-native Android TV player (opt-in; default off). */
  nativeVideoPlayerAndroidTV?: boolean;
  showHomeBackdrop: boolean;
  /**
   * The home hero carousel, on every platform — the TV one and the iOS one
   * are the same feature and share this single switch. Stored values from
   * the old TV-only `showTVHeroCarousel` key are migrated in `loadSettings`.
   */
  showHeroCarousel: boolean;
  tvTypographyScale: TVTypographyScale;
  showSeriesPosterOnEpisode: boolean;
  tvThemeMusicEnabled: boolean;
  // Appearance
  hideRemoteSessionButton: boolean;
  hideWatchlistsTab: boolean;
  // Audio look-ahead caching
  audioLookaheadEnabled: boolean;
  audioLookaheadCount: number;
  audioMaxCacheSizeMB: number;
  // Music playback
  preferLocalAudio: boolean;
  // Audio transcoding mode
  audioTranscodeMode: AudioTranscodeMode;
  // Optional third-party lookups. Both call a service directly from the client
  // rather than through Jellyfin, so each can be turned off on its own.
  wikidataAwardsEnabled: boolean;
  openSubtitlesEnabled: boolean;
  // OpenSubtitles API key for client-side subtitle fetching
  openSubtitlesApiKey?: string;
  // TV-only: Inactivity timeout for auto-logout
  inactivityTimeout: InactivityTimeout;
  // Yomifin / Reader
  yomifinPauseOnLookup: boolean;
  yomifinPopupPosition: "left" | "right";
  controlsDimOpacity: number;
  /** Popup color theme. "auto" follows the app (dark-only for now → dark). */
  yomifinPopupTheme: "light" | "dark" | "auto";
  /**
   * Per-dictionary UI/lookup preferences, keyed by dictionary title:
   *   enabled — include in lookups (disabled dicts are filtered out of results)
   *   order   — priority order (0 = highest; definition blocks sort by this)
   *   tint    — accent color (hex) for the per-dictionary boundary in the popup
   * New dictionaries not present here default to enabled + appended + a stable tint.
   */
  yomifinDictionaryConfig: Record<
    string,
    { enabled: boolean; order: number; tint: string }
  >;
  /**
   * Phase 8 — runtime Anki card config (AnkiConnect url, deck, note type, per-field
   * marker templates, word-audio sources). null = not configured yet → the
   * DEFAULT_ANKI_CONFIG seam in utils/yomifin/ankiConfig.ts applies. Written by
   * Settings → Anki; consumed imperatively by getAnkiConfig().
   */
  yomifinAnkiConfig: import("@/utils/yomifin/ankiConfig").AnkiConfig | null;
  /**
   * Profiles (JA/ZH bundles — utils/yomifin/profiles.ts). `yomifinActiveProfile` is
   * the manual selection (the player auto-overrides it from the subtitle/audio track
   * language); `yomifinProfiles` stores per-profile dictionary + Anki config. The
   * LEGACY keys above remain the JA profile's fallback storage (no migration).
   */
  yomifinActiveProfile: import("@/utils/yomifin/profiles").ProfileId;
  yomifinProfiles: Partial<
    Record<
      import("@/utils/yomifin/profiles").ProfileId,
      import("@/utils/yomifin/profiles").YomifinProfileData
    >
  >;
  /** Max lookup entries (≈ popup panes) per tap. Yomitan's default is 32. */
  yomifinMaxResults: number;
  /**
   * Per-title manual profile overrides (in-player pill), keyed by the player's
   * stable key (Jellyfin SeriesId/ItemId, `yozora:<name>`). Wins over the
   * track-language auto-selection; long-press the pill clears back to auto.
   */
  yomifinProfileOverrides: Record<
    string,
    import("@/utils/yomifin/profiles").ProfileId
  >;
  /**
   * Which profile each installed dictionary belongs to, keyed by title.
   * Unmapped = "ja" (pre-profiles installs need no migration). Assigned to the
   * active profile at import time; editable per-row in Settings → Dictionaries.
   */
  yomifinDictionaryLanguages: Record<
    string,
    import("@/utils/yomifin/profiles").ProfileId
  >;
  /**
   * Video gesture layer (RNGH rebuild): double-tap left/right of the screen seeks
   * backward/forward by this many seconds. 0 disables double-tap seeking (single
   * taps then toggle controls with no recognition delay).
   */
  yomifinDoubleTapSeconds: number;
  /** Two-finger tap anywhere on the video toggles play/pause. */
  yomifinTwoFingerTapPause: boolean;
  /**
   * Drag anywhere on the video to scrub, Infuse-style (horizontal pan maps the
   * full screen width to the full duration; trickplay preview when available).
   * Off restores the legacy horizontal flick-to-skip (enableHorizontalSwipeSkip).
   */
  yomifinDragSeekEnabled: boolean;
  /** Tappable subtitle overlay: text size (pt). */
  yomifinSubtitleFontSize: number;
  /** Tappable subtitle overlay: text outline/shadow strength. */
  yomifinSubtitleOutline: "none" | "thin" | "normal" | "strong";
  /** Tappable subtitle overlay: CSS-style font weight (400/500/600/700). */
  yomifinSubtitleWeight: number;
  /** Tappable subtitle overlay: distance from the bottom edge (pt). */
  yomifinSubtitleBottomOffset: number;
  /** jimaku.cc API key for online subtitle search (empty = feature hidden). */
  yomifinJimakuApiKey: string;
  /**
   * Which sources the unified search screen queries. "both" runs Jellyfin AND
   * Yozora (source badges disambiguate the results). NB: pre-migration installs
   * may have "stremio" stored — mapped to "yozora" at the read site.
   */
  searchScope: "jellyfin" | "yozora" | "both";
  // ===== Yozora backend (self-hosted debrid streaming; see utils/yozora/) =====
  // NB: credentials (serverUrl/token/username/deviceId) are dedicated MMKV keys
  // in utils/yozora/session.ts, NOT Settings — the Settings bag is plugin-
  // overridable and JSON-serialized wholesale; secrets don't belong here
  // (same convention as the Jellyfin token in JellyfinProvider).
  /** Device label shown in Yozora's device list (AUTH-5). */
  yozoraDeviceName: string;
  /** Skip the source picker: POST /resolve auto-pick (best CACHED candidate, RES-12). */
  yozoraAutoPlay: boolean;
  /**
   * Yozora tab: which anime title language to display (TitleSummary.titles).
   * jimaku search always uses romaji/native regardless (see jimakuTitle).
   * (Key name is historical — predates the AniList→Yozora migration.)
   */
  anilistTitleLanguage: "romaji" | "english" | "native";
  // ===== Player UI (senplayer-style rework) =====
  /**
   * Show the persistent OSD status bar (clock/battery/etc) during REGULAR playback
   * (i.e. while the control pane is hidden). When the control pane is up, the full
   * status bar always shows regardless of these toggles.
   */
  playerStatusBarDuringPlayback: boolean;
  /** Which items appear in the status bar DURING PLAYBACK (all show when controls up). */
  playerStatusShowClock: boolean;
  playerStatusShowDate: boolean;
  playerStatusShowBattery: boolean;
  playerStatusShowWifi: boolean;
  playerStatusShowNetwork: boolean;
  /** Clock format: 12-hour (true) or 24-hour (false). Follows device locale otherwise. */
  playerClock12Hour: boolean;
  /** Anonymous crash/error reporting via Sentry (on by default, opt-out). */
  sentryEnabled: boolean;
};

export interface Lockable<T> {
  locked: boolean;
  value: T;
}

export type PluginLockableSettings = {
  [K in keyof Settings]: Lockable<Settings[K]>;
};
export type StreamyfinPluginConfig = {
  settings: PluginLockableSettings;
};

// Settings whose values are secrets. They must never reach the app log,
// which users read in-app and paste into bug reports.
const SENSITIVE_SETTING_KEYS: ReadonlySet<keyof Settings> = new Set([
  "jellyseerrApiKey",
  "openSubtitlesApiKey",
] as const);

export const redactPluginSettings = (
  settings: PluginLockableSettings | undefined,
): PluginLockableSettings | undefined =>
  settings &&
  (Object.fromEntries(
    Object.entries(settings).map(([key, lockable]) => [
      key,
      SENSITIVE_SETTING_KEYS.has(key as keyof Settings) && lockable?.value
        ? { ...lockable, value: "[redacted]" }
        : lockable,
    ]),
  ) as PluginLockableSettings);

export const defaultValues: Settings = {
  home: null,
  deviceProfile: "Expo",
  mediaListCollectionIds: [],
  preferedLanguage: undefined,
  searchEngine: "Jellyfin",
  // videoPlayer intentionally undefined — resolved at runtime via
  // getActiveVideoPlayer() so existing installs are unaffected.
  marlinServerUrl: "",
  streamyStatsServerUrl: "",
  streamyStatsMovieRecommendations: false,
  streamyStatsSeriesRecommendations: false,
  streamyStatsPromotedWatchlists: false,
  downloadQuality: DownloadOptions[0],
  showDownloadLiveActivity: true,
  defaultBitrate: BITRATES[0],
  libraryOptions: {
    display: "list",
    cardStyle: "detailed",
    imageStyle: "cover",
    showTitles: true,
    showStats: true,
  },
  defaultAudioLanguage: null,
  playDefaultAudioTrack: true,
  rememberAudioSelections: true,
  defaultSubtitleLanguage: null,
  subtitleMode: SubtitlePlaybackMode.Default,
  rememberSubtitleSelections: true,
  subtitlesOnMute: true,
  subtitlesOnMuteAllowRestart: false,
  showHomeTitles: true,
  defaultVideoOrientation: ScreenOrientation.OrientationLock.DEFAULT,
  forwardSkipTime: 30,
  rewindSkipTime: 10,
  showCustomMenuLinks: false,
  disableHapticFeedback: false,
  subtitleSize: 1.0,
  subtitleBackground: false,
  subtitleBackgroundOpacity: 60,
  subtitleBackgroundPadding: 8,
  subtitleFont: "System",
  subtitleColor: "#FFFFFF",
  subtitleMarginY: 25,
  subtitleAlignX: "center",
  subtitleAlignY: "bottom",
  safeAreaInControlsEnabled: true,
  jellyseerrServerUrl: undefined,
  jellyseerrApiKey: undefined,
  autoLoginJellyseerr: true,
  useKefinTweaks: false,
  hiddenLibraries: [],
  enableH265ForChromecast: false,
  maxAutoPlayEpisodeCount: { key: "3", value: 3 },
  autoPlayEpisodeCount: 0,
  autoPlayNextEpisode: true,
  // Media segment skip defaults
  skipIntro: "ask",
  skipOutro: "ask",
  skipRecap: "ask",
  skipCommercial: "ask",
  skipPreview: "ask",
  showResumeDialog: false,
  // Playback speed defaults
  defaultPlaybackSpeed: 1.0,
  playbackSpeedPerMedia: {},
  playbackSpeedPerShow: {},
  // MPV buffer/cache defaults.
  // Android TV gets tighter caps — combined with libmpv 1.0's larger
  // baseline (fontconfig + libxml2 + libplacebo HDR path + scudo
  // retention) the larger mobile budget pushes 2 GB Android TV boxes
  // into swap death during 4K HDR playback. Apple TV has more RAM and
  // keeps the full budget. Users can override via the settings screen.
  mpvCacheEnabled: "auto",
  mpvCacheSeconds: 10,
  mpvDemuxerMaxBytes: Platform.isTV && Platform.OS === "android" ? 75 : 150, // MB
  mpvDemuxerMaxBackBytes: Platform.isTV && Platform.OS === "android" ? 30 : 50, // MB
  // MPV video output driver defaults (Android only)
  mpvVoDriver: "gpu-next",
  // Gesture controls
  enableHorizontalSwipeSkip: true,
  enableLeftSideBrightnessSwipe: true,
  enableRightSideVolumeSwipe: true,
  enableHoldToSpeed: true,
  holdToSpeedRate: 2.0,
  enablePinchToZoom: true,
  enableDoubleTapToSeek: false,
  hideVolumeSlider: false,
  hideBrightnessSlider: false,
  usePopularPlugin: true,
  mergeNextUpAndContinueWatching: false,
  hiddenHomeHeroSections: [],
  hiddenHomeHeroMediaTypes: [],
  useEpisodeImagesForNextUp: false,
  // TV-specific settings
  nativeVideoPlayerTV: true,
  nativeVideoPlayerAndroidTV: false,
  showHomeBackdrop: true,
  showHeroCarousel: true,
  tvTypographyScale: TVTypographyScale.Default,
  showSeriesPosterOnEpisode: false,
  tvThemeMusicEnabled: true,
  // Appearance
  hideRemoteSessionButton: false,
  hideWatchlistsTab: false,
  // Audio look-ahead caching defaults
  audioLookaheadEnabled: true,
  audioLookaheadCount: 1,
  audioMaxCacheSizeMB: 500,
  // Music playback
  preferLocalAudio: true,
  // Audio transcoding mode
  audioTranscodeMode: AudioTranscodeMode.Auto,
  // Optional third-party lookups
  wikidataAwardsEnabled: true,
  openSubtitlesEnabled: true,
  // TV-only: Inactivity timeout (disabled by default)
  inactivityTimeout: InactivityTimeout.Disabled,
  // Yomifin / Reader
  yomifinPauseOnLookup: true,
  yomifinPopupPosition: "right",
  controlsDimOpacity: 0.4,
  yomifinPopupTheme: "dark",
  yomifinDictionaryConfig: {},
  yomifinAnkiConfig: null,
  yomifinActiveProfile: "ja",
  yomifinProfiles: {},
  yomifinMaxResults: 32,
  yomifinProfileOverrides: {},
  yomifinDictionaryLanguages: {},
  yomifinDoubleTapSeconds: 10,
  yomifinTwoFingerTapPause: true,
  yomifinDragSeekEnabled: true,
  yomifinSubtitleFontSize: 32,
  yomifinSubtitleOutline: "normal",
  yomifinSubtitleWeight: 500,
  yomifinSubtitleBottomOffset: 64,
  yomifinJimakuApiKey: "",
  searchScope: "both",
  // Yozora backend prefs — credentials live in utils/yozora/session.ts (MMKV).
  yozoraDeviceName: "Yomifin iPad",
  yozoraAutoPlay: false,
  anilistTitleLanguage: "romaji",
  // Player UI (senplayer-style rework): during-playback status bar = clock + battery.
  playerStatusBarDuringPlayback: true,
  playerStatusShowClock: true,
  playerStatusShowDate: false,
  playerStatusShowBattery: true,
  playerStatusShowWifi: false,
  playerStatusShowNetwork: false,
  playerClock12Hour: true,
  // Crash reporting defaults on; the intro sheet and settings expose the opt-out
  sentryEnabled: true,
};

type LegacySubtitleSettings = Partial<Settings> & {
  mpvSubtitleScale?: number;
  mpvSubtitleMarginY?: number;
  mpvSubtitleAlignX?: "left" | "center" | "right";
  mpvSubtitleAlignY?: "top" | "center" | "bottom";
  mpvSubtitleFontSize?: number;
  mpvSubtitleBackgroundEnabled?: boolean;
  mpvSubtitleBackgroundOpacity?: number;
};

const migrateSubtitleSettings = (settings: LegacySubtitleSettings) => {
  let changed = false;

  if (isFiniteNumber(settings.mpvSubtitleScale)) {
    settings.subtitleSize = settings.mpvSubtitleScale;
    changed = true;
  } else if (
    isFiniteNumber(settings.subtitleSize) &&
    settings.subtitleSize >= 10
  ) {
    settings.subtitleSize = settings.subtitleSize / 100;
    changed = true;
  }

  if (isFiniteNumber(settings.mpvSubtitleMarginY)) {
    settings.subtitleMarginY = settings.mpvSubtitleMarginY;
    changed = true;
  }

  if (settings.mpvSubtitleAlignX) {
    settings.subtitleAlignX = settings.mpvSubtitleAlignX;
    changed = true;
  }

  if (settings.mpvSubtitleAlignY) {
    settings.subtitleAlignY = settings.mpvSubtitleAlignY;
    changed = true;
  }

  // The legacy MPV background setting lived in a separate advanced section.
  // Treat an explicit true as user intent, but do not let the old default false
  // overwrite the primary subtitleBackground setting.
  if (settings.mpvSubtitleBackgroundEnabled === true) {
    settings.subtitleBackground = true;
    changed = true;

    if (isFiniteNumber(settings.mpvSubtitleBackgroundOpacity)) {
      settings.subtitleBackgroundOpacity =
        settings.mpvSubtitleBackgroundOpacity;
    }
  } else if (
    settings.subtitleBackgroundOpacity === undefined &&
    isFiniteNumber(settings.mpvSubtitleBackgroundOpacity)
  ) {
    settings.subtitleBackgroundOpacity = settings.mpvSubtitleBackgroundOpacity;
    changed = true;
  }

  const legacyKeys: Array<keyof LegacySubtitleSettings> = [
    "mpvSubtitleScale",
    "mpvSubtitleMarginY",
    "mpvSubtitleAlignX",
    "mpvSubtitleAlignY",
    "mpvSubtitleFontSize",
    "mpvSubtitleBackgroundEnabled",
    "mpvSubtitleBackgroundOpacity",
  ];

  for (const key of legacyKeys) {
    if (key in settings) {
      delete settings[key];
      changed = true;
    }
  }

  return changed;
};

const loadSettings = (): Partial<Settings> => {
  const stored = readStoredSettings() as LegacySubtitleSettings & {
    showTVHeroCarousel?: boolean;
  };
  let changed = migrateSubtitleSettings(stored);

  // `showTVHeroCarousel` became `showHeroCarousel` once the hero shipped on
  // phones too and the two were merged into one switch. Carry a stored TV
  // preference across so a hero someone had turned off stays off.
  if (
    stored.showHeroCarousel === undefined &&
    stored.showTVHeroCarousel !== undefined
  ) {
    stored.showHeroCarousel = stored.showTVHeroCarousel;
    changed = true;
  }
  if ("showTVHeroCarousel" in stored) {
    delete stored.showTVHeroCarousel;
    changed = true;
  }

  if (changed) {
    storage.set(SETTINGS_KEY, JSON.stringify(stored));
  }
  return stored;
};

const EXCLUDE_FROM_SAVE = ["home"];

const saveSettings = (settings: Settings) => {
  try {
    const persistedSettings = { ...settings };
    for (const key of Object.keys(persistedSettings)) {
      if (EXCLUDE_FROM_SAVE.includes(key)) {
        delete persistedSettings[key as keyof Settings];
      }
    }
    const jsonValue = JSON.stringify(persistedSettings);
    storage.set(SETTINGS_KEY, jsonValue);
  } catch (error) {
    // The user's change is silently lost when this fails.
    logAndCaptureError("Saving settings failed", error);
  }
};

export const settingsAtom = atom<Partial<Settings> | null>(null);

/**
 * Server-side counterpart to the `showTVHeroCarousel` migration in
 * `loadSettings`: the Streamyfin plugin config still keys the hero switch
 * under the old name, so alias it or an admin's existing lock and default
 * would quietly stop being enforced after the rename.
 */
const migratePluginSettings = (
  settings: PluginLockableSettings | undefined,
): PluginLockableSettings | undefined => {
  if (!settings) {
    return settings;
  }
  const legacy = (settings as Record<string, unknown>).showTVHeroCarousel;
  if (settings.showHeroCarousel !== undefined || legacy === undefined) {
    return settings;
  }
  return {
    ...settings,
    showHeroCarousel: legacy as PluginLockableSettings["showHeroCarousel"],
  };
};

const loadPluginSettings = () => {
  try {
    return migratePluginSettings(
      storage.get<PluginLockableSettings>(STREAMYFIN_PLUGIN_SETTINGS),
    );
  } catch (error) {
    // Without the plugin settings the server admin's policy is not applied.
    logAndCaptureError("Loading plugin settings failed", error);
    return undefined;
  }
};

export const pluginSettingsAtom = atom<PluginLockableSettings | undefined>(
  loadPluginSettings(),
);

/**
 * User settings with the admin's plugin overrides applied — the same value
 * `useSettings().settings` returns, as an atom.
 *
 * Components that need a single setting should subscribe to this (or a
 * `selectAtom` of it) instead of calling `useSettings`, which also pulls in the
 * mutation helpers and a load effect.
 */
export const effectiveSettingsAtom = atom<Settings>((get) =>
  resolveEffectiveSettings(
    get(settingsAtom),
    get(pluginSettingsAtom),
    defaultValues,
    normalizePluginValue,
  ),
);

const loadAppliedPluginDefaults = (): AppliedPluginDefaults => {
  try {
    return storage.get<AppliedPluginDefaults>(PLUGIN_APPLIED_DEFAULTS) ?? {};
  } catch {
    return {};
  }
};

export const useSettings = () => {
  const api = useAtomValue(apiAtom);
  const [_settings, setSettings] = useAtom(settingsAtom);
  const [pluginSettings, _setPluginSettings] = useAtom(pluginSettingsAtom);

  useEffect(() => {
    if (_settings === null) {
      const loadedSettings = loadSettings();
      setSettings(loadedSettings);
    }
  }, [_settings, setSettings]);

  const setPluginSettings = useCallback(
    (settings: PluginLockableSettings | undefined) => {
      const migrated = migratePluginSettings(settings);
      storage.setAny(STREAMYFIN_PLUGIN_SETTINGS, migrated);
      _setPluginSettings(migrated);
    },
    [_setPluginSettings],
  );

  const refreshStreamyfinPluginSettings = useCallback(async () => {
    if (!api) {
      return;
    }
    const newPluginSettings = await api.getStreamyfinPluginConfig().then(
      ({ data }) => {
        writeInfoLog(
          "Got plugin settings",
          redactPluginSettings(data?.settings),
        );
        return data?.settings;
      },
      (_err) => undefined,
    );
    setPluginSettings(newPluginSettings);

    // Write against the atom's value at apply time, not the hook's render
    // snapshot: this runs while the user can be changing settings (the intro
    // sheet is up during first-run login), and a merge built from the
    // snapshot resurrected whatever the user had just overwritten.
    if (newPluginSettings) {
      setSettings((currentSettings) => {
        if (!currentSettings) return currentSettings;

        const applied = loadAppliedPluginDefaults();
        const result = pluginRefreshOverlay(
          currentSettings,
          newPluginSettings,
          applied,
          normalizePluginValue,
        );
        if (!result) return currentSettings;

        const newSettings = {
          ...defaultValues,
          ...currentSettings,
          ...result.overlay,
        } as Settings;
        saveSettings(newSettings);
        if (result.applied) {
          storage.setAny(PLUGIN_APPLIED_DEFAULTS, result.applied);
        }
        return newSettings;
      });
    }

    return newPluginSettings;
  }, [api, setPluginSettings, setSettings]);

  const updateSettings = (update: Partial<Settings>) => {
    // Admin-locked settings are enforced at write time too: a control that
    // isn't disabled in the UI must not persist a value the admin pinned.
    // The read memo already overrides locked keys, but without this guard the
    // write would silently land in user storage and resurface once unlocked.
    const sanitizedUpdate = Object.fromEntries(
      Object.entries(update).filter(
        ([key]) => pluginSettings?.[key as keyof Settings]?.locked !== true,
      ),
    ) as Partial<Settings>;

    if (Object.keys(sanitizedUpdate).length === 0) return;

    setSettings((currentSettings) => {
      if (!currentSettings) return currentSettings;

      const requestedKeys = Object.keys(sanitizedUpdate) as Array<
        keyof Settings
      >;
      const changedKeys = requestedKeys.filter(
        (key) => !Object.is(currentSettings[key], sanitizedUpdate[key]),
      );
      if (changedKeys.length === 0) return currentSettings;

      const newSettings = {
        ...defaultValues,
        ...currentSettings,
        ...sanitizedUpdate,
      } as Settings;
      saveSettings(newSettings);
      return newSettings;
    });
  };

  const settings = useAtomValue(effectiveSettingsAtom);

  return {
    settings,
    updateSettings,
    pluginSettings,
    setPluginSettings,
    refreshStreamyfinPluginSettings,
  };
};
