import { describe, expect, test } from "bun:test";
import { createControlsTimer } from "./controlsTimer";

function setup() {
  let allowed = true;
  let hides = 0;
  let now = 0;
  const pending = new Set<{ at: number; callback: () => void }>();
  const timer = createControlsTimer(
    () => allowed,
    () => hides++,
    () => 5000,
    (callback, ms) => {
      const task = { at: now + ms, callback };
      pending.add(task);
      return () => {
        pending.delete(task);
      };
    },
  );
  return {
    timer,
    setAllowed: (value: boolean) => {
      allowed = value;
    },
    hides: () => hides,
    advance: (ms: number) => {
      now += ms;
      for (const task of [...pending])
        if (task.at <= now) {
          pending.delete(task);
          task.callback();
        }
    },
  };
}

describe("player control timeout", () => {
  test("interaction restarts the full five-second window", () => {
    const test = setup();
    test.timer.reset();
    test.advance(4000);
    test.timer.reset();
    test.advance(4000);
    expect(test.hides()).toBe(0);
    test.advance(1000);
    expect(test.hides()).toBe(1);
  });
  test("scrub or menu interactions cannot re-arm a blocked timeout", () => {
    const test = setup();
    test.timer.reset();
    test.setAllowed(false);
    test.timer.reset();
    test.advance(10_000);
    expect(test.hides()).toBe(0);
    test.setAllowed(true);
    test.timer.reset();
    test.advance(4999);
    expect(test.hides()).toBe(0);
    test.advance(1);
    expect(test.hides()).toBe(1);
  });
  test("rechecks blockers even if their effect has not run yet", () => {
    const test = setup();
    test.timer.reset();
    test.setAllowed(false);
    test.advance(5000);
    expect(test.hides()).toBe(0);
  });
  test("unmount cancels pending work", () => {
    const test = setup();
    test.timer.reset();
    test.timer.clear();
    test.advance(5000);
    expect(test.hides()).toBe(0);
  });
});
