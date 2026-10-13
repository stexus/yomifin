import { afterEach, describe, expect, mock, test } from "bun:test";
import React, { useCallback, useImperativeHandle, useState } from "react";
import type { SharedValue } from "react-native-reanimated";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let hardwareBack: (() => boolean) | undefined;
const present = mock(() => {});
const dismiss = mock(() => {});
mock.module("react-native", () => ({
  BackHandler: {
    addEventListener: (_event: string, callback: () => boolean) => {
      hardwareBack = callback;
      return {
        remove() {
          hardwareBack = undefined;
        },
      };
    },
  },
  useWindowDimensions: () => ({ width: 1024, height: 768 }),
  TouchableOpacity: "TouchableOpacity",
  View: "View",
  StyleSheet: { hairlineWidth: 1, create: (styles: unknown) => styles },
  Platform: { OS: "ios", isTV: false },
}));
mock.module("@gorhom/bottom-sheet", () => ({
  BottomSheetBackdrop: "BottomSheetBackdrop",
  BottomSheetScrollView: "BottomSheetScrollView",
  BottomSheetModal: React.forwardRef((props: Record<string, unknown>, ref) => {
    useImperativeHandle(ref, () => ({ present, dismiss }), []);
    return React.createElement(
      "BottomSheetModal",
      props,
      props.children as React.ReactNode,
    );
  }),
}));
mock.module("@/components/common/Text", () => ({ Text: "Text" }));
mock.module("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
mock.module("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }),
}));
mock.module("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
mock.module("@expo/ui/swift-ui", () => ({
  Button: "Button",
  Host: "Host",
  Menu: "Menu",
}));
mock.module("@expo/ui/swift-ui/modifiers", () => ({ disabled: () => ({}) }));
const { PlayerMenuSheet } = await import("./dropdown/PlayerMenuSheet");
const { useVideoSlider } = await import("./hooks/useVideoSlider");
const { useControlsTimeout } = await import("./useControlsTimeout");
const rendered: ReactTestRenderer[] = [];
afterEach(async () => {
  for (const tree of rendered.splice(0)) await act(() => tree.unmount());
  present.mockClear();
  dismiss.mockClear();
});
const host = (tree: ReactTestRenderer, name: string) =>
  tree.root.find((node) => String(node.type) === name);
async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  await act(() => {
    tree = create(element);
  });
  rendered.push(tree);
  return tree;
}

describe("shared menu lifecycle", () => {
  test("opening blocks auto-hide; all native dismiss paths release it", async () => {
    const changes = mock((_open: boolean) => {});
    const select = mock(() => {});
    const tree = await render(
      <PlayerMenuSheet
        title='Subtitles'
        trigger={<React.Fragment />}
        groups={[
          { options: [{ type: "action", label: "Online", onPress: select }] },
        ]}
        onOpenChange={changes}
      />,
    );
    await act(() =>
      tree.root
        .find(
          (node) =>
            String(node.type) === "TouchableOpacity" &&
            node.props.accessibilityLabel === "Subtitles",
        )
        .props.onPress(),
    );
    expect(present).toHaveBeenCalledTimes(1);
    expect(changes.mock.calls).toEqual([[true]]);
    // A selection requests dismissal, but the timer stays blocked through its animation.
    await act(() =>
      tree.root
        .findAll((node) => String(node.type) === "TouchableOpacity")[1]
        .props.onPress(),
    );
    expect(select).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(hardwareBack?.()).toBe(true);
    expect(dismiss).toHaveBeenCalledTimes(2);
    expect(changes.mock.calls).toEqual([[true]]);
    // The bottom sheet sends this for selections, swipes and backdrop dismissal.
    await act(() => host(tree, "BottomSheetModal").props.onDismiss());
    expect(changes.mock.calls).toEqual([[true], [false]]);
  });
  test("opening subtitle scale keeps the timer blocked after the originating menu dismisses", async () => {
    const hide = mock(() => {});
    let closeScale!: () => void;
    const Harness = () => {
      const [panels, setPanels] = useState<Set<string>>(() => new Set());
      const update = useCallback(
        (key: string, open: boolean) =>
          setPanels((previous) => {
            const next = new Set(previous);
            if (open) next.add(key);
            else next.delete(key);
            return next;
          }),
        [],
      );
      const onOpenChange = useCallback(
        (open: boolean) => update("menu", open),
        [update],
      );
      closeScale = () => update("scale", false);
      useControlsTimeout({
        showControls: true,
        isSliding: false,
        episodeView: panels.size > 0,
        onHideControls: hide,
        timeout: 10,
      });
      return (
        <PlayerMenuSheet
          title='Subtitles'
          trigger={<React.Fragment />}
          onOpenChange={onOpenChange}
          groups={[
            {
              options: [
                {
                  type: "action",
                  label: "Scale",
                  onPress: () => update("scale", true),
                },
              ],
            },
          ]}
        />
      );
    };
    const tree = await render(<Harness />);
    await act(() =>
      tree.root
        .find(
          (node) =>
            String(node.type) === "TouchableOpacity" &&
            node.props.accessibilityLabel === "Subtitles",
        )
        .props.onPress(),
    );
    await act(() =>
      tree.root
        .findAll((node) => String(node.type) === "TouchableOpacity")[1]
        .props.onPress(),
    );
    await act(() => host(tree, "BottomSheetModal").props.onDismiss());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(hide).not.toHaveBeenCalled();
    await act(() => closeScale());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(hide).toHaveBeenCalledTimes(1);
  });
  test("ordinary playback renders do not recreate menu hosts", async () => {
    const changes = mock((_open: boolean) => {});
    const props = {
      title: "Audio",
      trigger: <React.Fragment />,
      groups: [],
      onOpenChange: changes,
    };
    const tree = await render(<PlayerMenuSheet {...props} />);
    const menuHost = host(tree, "BottomSheetModal");
    await act(() => tree.update(<PlayerMenuSheet {...props} />));
    expect(host(tree, "BottomSheetModal")).toBe(menuHost);
    expect(present).not.toHaveBeenCalled();
  });
});

describe("shared slider playback lifecycle", () => {
  for (const playing of [false, true]) {
    test(`${playing ? "playing" : "paused"} scrub preserves its initial state`, async () => {
      const progress = { value: 10_000 } as SharedValue<number>;
      const isSeeking = { value: false } as SharedValue<boolean>;
      const play = mock(() => {}),
        pause = mock(() => {}),
        seek = mock((_ms: number) => {});
      let slider!: ReturnType<typeof useVideoSlider>;
      const Harness = ({ isPlaying }: { isPlaying: boolean }) => {
        slider = useVideoSlider({
          progress,
          isSeeking,
          isPlaying,
          play,
          pause,
          seek,
          showControls: true,
          calculateTrickplayUrl: () => {},
        });
        return null;
      };
      const tree = await render(<Harness isPlaying={playing} />);
      await act(() => slider.handleSliderStart());
      expect(isSeeking.value).toBe(true);
      // Native pause callbacks change isPlaying during a drag; the start state must survive.
      await act(() => tree.update(<Harness isPlaying={false} />));
      await act(() => slider.handleSliderComplete(42_500));
      expect(seek.mock.calls).toEqual([[42_500]]);
      expect(progress.value).toBe(42_500);
      expect(isSeeking.value).toBe(false);
      expect(play).toHaveBeenCalledTimes(playing ? 1 : 0);
    });
  }
  test("chapter seek does not reuse an earlier playing slider's resume flag", async () => {
    let slider!: ReturnType<typeof useVideoSlider>;
    const play = mock(() => {}),
      pause = mock(() => {}),
      seek = mock((_ms: number) => {});
    const progress = { value: 0 } as SharedValue<number>,
      isSeeking = { value: false } as SharedValue<boolean>;
    const Harness = ({ isPlaying }: { isPlaying: boolean }) => {
      slider = useVideoSlider({
        progress,
        isSeeking,
        isPlaying,
        play,
        pause,
        seek,
        showControls: true,
        calculateTrickplayUrl: () => {},
      });
      return null;
    };
    const tree = await render(<Harness isPlaying />);
    await act(() => slider.handleSliderStart());
    await act(() => slider.handleSliderComplete(10_000));
    play.mockClear();
    await act(() => tree.update(<Harness isPlaying={false} />));
    await act(() => slider.seekTo(30_000));
    expect(play).not.toHaveBeenCalled();
    expect(seek.mock.calls.at(-1)).toEqual([30_000]);
  });
});

test("menu and scrubbing blockers survive control interactions", async () => {
  let interact!: () => void;
  const hide = mock(() => {});
  const Harness = ({ blocked }: { blocked: boolean }) => {
    interact = useControlsTimeout({
      showControls: true,
      isSliding: false,
      episodeView: blocked,
      onHideControls: hide,
      timeout: 10,
    }).handleControlsInteraction;
    return null;
  };
  const tree = await render(<Harness blocked />);
  await act(async () => {
    interact();
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
  expect(hide).not.toHaveBeenCalled();
  await act(() => tree.update(<Harness blocked={false} />));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
  expect(hide).toHaveBeenCalledTimes(1);
});
