import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ComponentProps } from "react";
import type { SharedValue } from "react-native-reanimated";
import { makeSharedValue } from "@/test-utils/reanimated";
import { Controls } from "./Controls";
import type { PlayerControlsProps } from "./PlayerControls";

const mockNavigate = jest.fn();
let mockOutroActive = false;
let mockPostCredits = false;
let mockAutoplay = true;
let mockTime = { currentTime: 120_000, remainingTime: 1_320_000 };
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
  useSettings: () => ({ settings: { autoPlayNextEpisode: mockAutoplay } }),
}));
jest.mock("@/hooks/usePlaybackManager", () => ({
  usePlaybackManager: () => ({ nextItem: { Id: "next", Type: "Episode" } }),
}));
jest.mock("@/hooks/useTrickplay", () => ({
  useTrickplay: () => ({ prefetchAllTrickplayImages: () => {} }),
}));
jest.mock("./hooks/useVideoTime", () => ({
  useVideoTime: () => mockTime,
}));
jest.mock("@/utils/segments", () => ({
  useSegments: () => ({}),
  SEGMENT_SKIP_KEY: {
    Intro: "player.skip_intro",
    Outro: "player.skip_credits",
  },
}));
jest.mock("@/hooks/useMediaSegments", () => ({
  useMediaSegments: () => ({
    showSkipButton: false,
    isOutroActive: mockOutroActive,
    hasContentAfterCredits: mockPostCredits,
  }),
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
beforeEach(() => {
  mockNavigate.mockClear();
  mockOutroActive = false;
  mockPostCredits = false;
  mockAutoplay = true;
  mockTime = { currentTime: 120_000, remainingTime: 1_320_000 };
});

test("opening controls mid-episode does not reveal the floating Next Episode pill", async () => {
  await render(<Controls {...props(async () => true)} />);
  expect(
    screen.queryByRole("button", { name: "player.next_episode" }),
  ).toBeNull();
  expect(mockChrome.onNextEpisode).toBeDefined();
});

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

test("the upstream outro pill marks watched before advancing when tapped", async () => {
  mockOutroActive = true;
  const finish = jest.fn(async () => true);
  await render(<Controls {...props(finish)} showControls={false} />);
  expect(finish).not.toHaveBeenCalled();
  await fireEvent.press(
    screen.getByRole("button", { name: "player.next_episode" }),
  );
  expect(finish).toHaveBeenCalledTimes(1);
  expect(mockNavigate).toHaveBeenCalledWith(
    expect.objectContaining({ itemId: "next" }),
  );
});

test("Next Episode pill retains the final-ten-seconds fallback without markers", async () => {
  mockTime = { currentTime: 1_435_000, remainingTime: 5_000 };
  await render(<Controls {...props(async () => true)} showControls={false} />);
  expect(
    screen.getByRole("button", { name: "player.next_episode" }),
  ).toBeTruthy();
});

test.each([1_320_000, 5_000])(
  "autoplay off keeps the Next Episode pill hidden with %i ms remaining",
  async (remainingTime) => {
    mockAutoplay = false;
    mockOutroActive = true;
    mockTime = { currentTime: 1_440_000 - remainingTime, remainingTime };
    await render(<Controls {...props(async () => true)} />);
    expect(
      screen.queryByRole("button", { name: "player.next_episode" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "player.skip_credits" }),
    ).toBeTruthy();
  },
);

test("post-credits content keeps Skip Credits instead of the outro Next Episode pill", async () => {
  mockOutroActive = true;
  mockPostCredits = true;
  await render(<Controls {...props(async () => true)} />);
  expect(
    screen.queryByRole("button", { name: "player.next_episode" }),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: "player.skip_credits" }),
  ).toBeTruthy();
});

test("automatic advancement does not explicitly mark the episode watched", async () => {
  mockTime = { currentTime: 1_435_000, remainingTime: 5_000 };
  const finish = jest.fn(async () => true);
  const view = await render(<Controls {...props(finish)} />);
  mockTime = { currentTime: 1_440_000, remainingTime: 0 };
  await view.rerender(<Controls {...props(finish)} isPlaying={false} />);
  expect(mockNavigate).toHaveBeenCalledWith(
    expect.objectContaining({ itemId: "next" }),
  );
  expect(finish).not.toHaveBeenCalled();
});

test("completion failure does not navigate", async () => {
  mockOutroActive = true;
  await render(<Controls {...props(async () => false)} />);
  await fireEvent.press(
    screen.getByRole("button", { name: "player.next_episode" }),
  );
  expect(mockNavigate).not.toHaveBeenCalled();
});
