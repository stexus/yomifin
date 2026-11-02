import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ComponentProps } from "react";
import type { SharedValue } from "react-native-reanimated";
import { makeSharedValue } from "@/test-utils/reanimated";
import { Controls } from "./Controls";
import type { PlayerControlsProps } from "./PlayerControls";

const mockNavigate = jest.fn();
let mockChrome: PlayerControlsProps;
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({}) }));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock(
  "react-native-reanimated",
  () => jest.requireActual("@/test-utils/reanimated").reanimatedModule,
);
jest.mock("@/hooks/useAppRouter", () => ({
  __esModule: true,
  default: () => ({ setParams: mockNavigate }),
}));
jest.mock("@/hooks/useHaptic", () => ({ useHaptic: () => () => {} }));
jest.mock("@/hooks/useServerVersion", () => ({
  useServerVersion: () => "12.0.0",
}));
jest.mock("@/hooks/useControlsSafeAreaInsets", () => ({
  useControlsSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/providers/OfflineModeProvider", () => ({
  useOfflineMode: () => false,
}));
jest.mock("@/utils/atoms/settings", () => ({
  useSettings: () => ({ settings: { autoPlayNextEpisode: false } }),
}));
jest.mock("@/hooks/usePlaybackManager", () => ({
  usePlaybackManager: () => ({ nextItem: { Id: "next", Type: "Episode" } }),
}));
jest.mock("@/hooks/useTrickplay", () => ({
  useTrickplay: () => ({ prefetchAllTrickplayImages: () => {} }),
}));
jest.mock("./hooks/useVideoTime", () => ({
  useVideoTime: () => ({ currentTime: 120_000, remainingTime: 1_320_000 }),
}));
jest.mock("@/utils/segments", () => ({
  useSegments: () => ({}),
  SEGMENT_SKIP_KEY: {
    Intro: "player.skip_intro",
    Outro: "player.skip_credits",
  },
}));
jest.mock("@/hooks/useMediaSegments", () => ({
  useMediaSegments: () => ({ showSkipButton: false, isOutroActive: false }),
}));
jest.mock("@/utils/jellyfin/getDefaultPlaySettings", () => ({
  getDefaultPlaySettings: () => ({}),
  getAdjacentStartTicks: () => 0,
}));
jest.mock("./PlayerControls", () => ({
  PlayerControls: (props: PlayerControlsProps) => {
    mockChrome = props;
    return props.overlays;
  },
}));
jest.mock("./dropdown/DropdownView", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("./EpisodeList", () => ({ EpisodeList: () => null }));
jest.mock("./SegmentSkippedNotice", () => ({
  SegmentSkippedNotice: () => null,
}));
jest.mock("./TechnicalInfoOverlay", () => ({
  TechnicalInfoOverlay: () => null,
}));
jest.mock("./ContinueWatchingOverlay", () => ({
  __esModule: true,
  default: () => null,
}));

const props = (
  finish: () => Promise<boolean>,
): ComponentProps<typeof Controls> => ({
  item: { Id: "current", Type: "Episode", RunTimeTicks: 14_400_000_000 },
  isPlaying: true,
  isSeeking: makeSharedValue(false) as SharedValue<boolean>,
  cacheProgress: makeSharedValue(0) as SharedValue<number>,
  progress: makeSharedValue(120_000) as SharedValue<number>,
  isBuffering: false,
  showControls: true,
  togglePlay: () => {},
  setShowControls: () => {},
  seek: () => {},
  play: () => {},
  pause: () => {},
  onFinishEpisode: finish,
});
beforeEach(() => mockNavigate.mockClear());

test("next-arrow navigation does not call completion", async () => {
  const finish = jest.fn(async () => true);
  await render(<Controls {...props(finish)} />);
  await act(() => {
    mockChrome.onNextEpisode?.();
  });
  expect(mockNavigate).toHaveBeenCalledWith(
    expect.objectContaining({ itemId: "next" }),
  );
  expect(finish).not.toHaveBeenCalled();
});

test("finish pill works early with autoplay off and advances only after completion", async () => {
  const finish = jest.fn(async () => true);
  await render(<Controls {...props(finish)} />);
  await fireEvent.press(
    screen.getByRole("button", { name: "player.finish_and_next_episode" }),
  );
  expect(finish).toHaveBeenCalledTimes(1);
  expect(mockNavigate).toHaveBeenCalledWith(
    expect.objectContaining({ itemId: "next" }),
  );
});

test("completion failure does not navigate", async () => {
  await render(<Controls {...props(async () => false)} />);
  await fireEvent.press(
    screen.getByRole("button", { name: "player.finish_and_next_episode" }),
  );
  expect(mockNavigate).not.toHaveBeenCalled();
});
