import { fireEvent, render, screen } from "@testing-library/react-native";
import { SkipSegmentOverlay } from "./SkipSegmentOverlay";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock("@/hooks/useControlsSafeAreaInsets", () => ({
  useControlsSafeAreaInsets: () => ({ top: 0, left: 0, bottom: 0, right: 0 }),
}));
jest.mock(
  "react-native-reanimated",
  () => jest.requireActual("@/test-utils/reanimated").reanimatedModule,
);

const props = () => ({
  showSkipButton: false,
  showSkipCreditButton: true,
  hasContentAfterCredits: true,
  willShowNextEpisode: true,
  showNextEpisode: true,
  autoAdvanceNextEpisode: false,
  remainingTime: 180_000,
  isPlaying: true,
  itemId: "episode-1",
  skipIntro: jest.fn(),
  skipCredit: jest.fn(),
  onNextEpisodeFinish: jest.fn(),
  onNextEpisodePress: jest.fn(),
  controlsVisible: false,
});

test("offers separate Skip Credits and Next Episode buttons without controls or a countdown", async () => {
  const actions = props();
  await render(<SkipSegmentOverlay {...actions} />);
  await fireEvent.press(
    screen.getByRole("button", { name: "player.skip_credits" }),
  );
  expect(actions.skipCredit).toHaveBeenCalledTimes(1);
  expect(actions.onNextEpisodePress).not.toHaveBeenCalled();
  await fireEvent.press(
    screen.getByRole("button", { name: "player.next_episode" }),
  );
  expect(actions.onNextEpisodePress).toHaveBeenCalledTimes(1);
  expect(actions.onNextEpisodeFinish).not.toHaveBeenCalled();
});

test("disables completion while watched state is being saved", async () => {
  const actions = props();
  await render(<SkipSegmentOverlay {...actions} nextButtonDisabled />);
  const finish = screen.getByRole("button", { name: "player.next_episode" });
  expect(finish.props.accessibilityState).toMatchObject({
    disabled: true,
    busy: true,
  });
  await fireEvent.press(finish);
  expect(actions.onNextEpisodePress).not.toHaveBeenCalled();
});
