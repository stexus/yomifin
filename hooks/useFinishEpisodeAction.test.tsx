import { act, renderHook } from "@testing-library/react-native";
import { useFinishEpisodeAction } from "./useFinishEpisodeAction";

test("advances only after the current episode has been marked watched", async () => {
  let resolve!: (finished: boolean) => void;
  const finish = jest.fn(
    () =>
      new Promise<boolean>((done) => {
        resolve = done;
      }),
  );
  const advance = jest.fn();
  const { result } = await renderHook(() =>
    useFinishEpisodeAction("episode-1", finish, advance),
  );
  let action!: Promise<void>;
  await act(() => {
    action = result.current();
  });
  expect(advance).not.toHaveBeenCalled();
  await act(async () => {
    resolve(true);
    await action;
  });
  expect(advance).toHaveBeenCalledTimes(1);
});

test("does not navigate when completion failed", async () => {
  const advance = jest.fn();
  const { result } = await renderHook(() =>
    useFinishEpisodeAction("episode-1", async () => false, advance),
  );
  await act(async () => {
    await result.current();
  });
  expect(advance).not.toHaveBeenCalled();
});

test.each(["unmount", "change-item"])(
  "does not navigate a different player after %s",
  async (change) => {
    let resolve!: (finished: boolean) => void;
    const finish = () =>
      new Promise<boolean>((done) => {
        resolve = done;
      });
    const advance = jest.fn();
    const { result, unmount, rerender } = await renderHook(
      ({ id }: { id: string }) => useFinishEpisodeAction(id, finish, advance),
      { initialProps: { id: "episode-1" } },
    );
    let action!: Promise<void>;
    await act(() => {
      action = result.current();
    });
    if (change === "unmount") await unmount();
    else await rerender({ id: "episode-2" });
    await act(async () => {
      resolve(true);
      await action;
    });
    expect(advance).not.toHaveBeenCalled();
  },
);
