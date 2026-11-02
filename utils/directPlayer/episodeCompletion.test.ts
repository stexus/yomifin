import { EpisodeCompletion } from "./episodeCompletion";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test("finishes after outstanding progress and stop, with watched state written last", async () => {
  const completion = new EpisodeCompletion();
  const pending = deferred();
  const calls: string[] = [];
  const progress = completion.report(async () => {
    await pending.promise;
    calls.push("progress");
  });
  const finish = completion.finish({
    pause: async () => {
      calls.push("pause");
    },
    stop: async () => {
      calls.push("stop");
    },
    markPlayed: async () => {
      calls.push("played");
    },
    restore: async () => {
      calls.push("restore");
    },
  });
  await Promise.resolve();
  expect(calls).toEqual(["pause"]);
  await completion.report(async () => {
    calls.push("late-progress");
  });
  pending.resolve();
  await progress;
  expect(await finish).toBe(true);
  await completion.report(async () => {
    calls.push("later-progress");
  });
  expect(calls).toEqual(["pause", "progress", "stop", "played"]);
});

test("ignores repeated taps while finishing and after completion", async () => {
  const completion = new EpisodeCompletion();
  const pending = deferred();
  const steps = {
    pause: async () => {},
    stop: async () => {},
    markPlayed: jest.fn(() => pending.promise),
    restore: async () => {},
  };
  const first = completion.finish(steps);
  expect(await completion.finish(steps)).toBe(false);
  pending.resolve();
  expect(await first).toBe(true);
  expect(await completion.finish(steps)).toBe(false);
  expect(steps.markPlayed).toHaveBeenCalledTimes(1);
});

test("a failed mark restores the paused session and allows retry", async () => {
  const completion = new EpisodeCompletion();
  const restore = jest.fn(async () => {});
  const steps = {
    pause: async () => {},
    stop: async () => {},
    markPlayed: jest.fn(async (): Promise<void> => {
      throw new Error("offline");
    }),
    restore,
  };
  await expect(completion.finish(steps)).rejects.toThrow("offline");
  expect(restore).toHaveBeenCalledTimes(1);
  const progress = jest.fn(async () => {});
  await completion.report(progress);
  expect(progress).toHaveBeenCalledTimes(1);
  steps.markPlayed.mockResolvedValueOnce(undefined);
  expect(await completion.finish(steps)).toBe(true);
});

test("does not mark watched if stopping the session failed", async () => {
  const completion = new EpisodeCompletion();
  const markPlayed = jest.fn(async () => {});
  const restore = jest.fn(async () => {});
  await expect(
    completion.finish({
      pause: async () => {},
      stop: async () => {
        throw new Error("stop failed");
      },
      markPlayed,
      restore,
    }),
  ).rejects.toThrow("stop failed");
  expect(markPlayed).not.toHaveBeenCalled();
  expect(restore).not.toHaveBeenCalled();
});
