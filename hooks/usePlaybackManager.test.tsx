import { act, renderHook } from "@testing-library/react-native";
import type { makeApi } from "@/test-utils/jellyfinApi";
import { usePlaybackManager } from "./usePlaybackManager";

let mockConnected = true;
let mockDownloaded = true;
const mockUpdate = jest.fn();
const mockInvalidate = jest.fn();
jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({}),
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));
jest.mock("@/providers/JellyfinProvider", () => {
  const { atom } = require("jotai");
  const api = jest.requireActual("@/test-utils/jellyfinApi").makeApi();
  return { apiAtom: atom(api), userAtom: atom({ Id: "user-1" }), mockApi: api };
});
jest.mock("@/utils/atoms/shuffleQueue", () => ({
  shuffleQueueAtom: require("jotai").atom(null),
}));
jest.mock("@/hooks/useNetworkStatus", () => ({
  useNetworkStatus: () => ({ isConnected: mockConnected }),
}));
jest.mock("@/providers/DownloadProvider", () => ({
  useDownload: () => ({
    getDownloadedItemById: () =>
      mockDownloaded
        ? {
            item: {
              Id: "episode-1",
              UserData: { Played: false, PlaybackPositionTicks: 123 },
            },
          }
        : undefined,
    updateDownloadedItem: mockUpdate,
    getDownloadedItems: () => [],
  }),
}));

const api = (
  jest.requireMock("@/providers/JellyfinProvider") as {
    mockApi: ReturnType<typeof makeApi>;
  }
).mockApi;
beforeEach(() => {
  mockConnected = true;
  mockDownloaded = true;
  mockUpdate.mockClear();
  api.mock.reset();
});

test("rejects a server failure without marking a download watched locally", async () => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  api.mock.onAny().reply(500);
  const { result } = await renderHook(() => usePlaybackManager());
  await expect(result.current.markItemPlayed("episode-1")).rejects.toThrow();
  expect(mockUpdate).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});

test("completes an offline download locally and clears its resume position", async () => {
  mockConnected = false;
  const { result } = await renderHook(() =>
    usePlaybackManager({ isOffline: true }),
  );
  await act(async () => {
    await result.current.markItemPlayed("episode-1");
  });
  expect(mockUpdate).toHaveBeenCalledWith(
    "episode-1",
    expect.objectContaining({
      item: expect.objectContaining({
        UserData: expect.objectContaining({
          Played: true,
          PlaybackPositionTicks: 0,
        }),
      }),
    }),
  );
  expect(api.mock.history.post).toHaveLength(0);
});

test("does not claim to complete an unavailable streamed episode", async () => {
  mockConnected = false;
  mockDownloaded = false;
  const { result } = await renderHook(() => usePlaybackManager());
  await expect(result.current.markItemPlayed("episode-1")).rejects.toThrow(
    "server connection",
  );
});
