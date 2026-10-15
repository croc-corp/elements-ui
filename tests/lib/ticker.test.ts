import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cancelTick, requestTick } from "@/lib/lumesec/ticker";

/** The animation frames requested, run by hand. */
let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  frames = [];
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  // the tests run in node: the ticker reads timers from `window`
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames[id - 1] = () => undefined;
  });
});

afterEach(() => {
  // run what is left, so the ticker's queues are empty for the next test
  for (const frame of frames.splice(0)) frame(performance.now());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ticker", () => {
  it("runs every queued callback in one animation frame and skips cancelled ones", () => {
    const ran: string[] = [];
    requestTick(() => ran.push("a"));
    const b = requestTick(() => ran.push("b"));
    requestTick(() => ran.push("c"));
    cancelTick(b);
    expect(frames).toHaveLength(1);
    frames.shift()?.(16);
    expect(ran).toEqual(["a", "c"]);
  });

  it("requests no frame while nothing is queued", () => {
    const id = requestTick(() => undefined);
    cancelTick(id);
    frames.shift()?.(16);
    vi.advanceTimersByTime(1000);
    expect(frames).toHaveLength(0);
  });

  it("queues a callback made during a frame for the next frame", () => {
    const ran: string[] = [];
    requestTick(() => {
      ran.push("first");
      requestTick(() => ran.push("second"));
    });
    frames.shift()?.(16);
    expect(ran).toEqual(["first"]);
    expect(frames).toHaveLength(1);
    frames.shift()?.(32);
    expect(ran).toEqual(["first", "second"]);
  });

  it("holds a later callback on the timer and requests its frame when it is due", () => {
    const ran: number[] = [];
    requestTick((now) => ran.push(now), performance.now() + 100);
    expect(frames).toHaveLength(0);
    vi.advanceTimersByTime(90);
    expect(frames).toHaveLength(0);
    vi.advanceTimersByTime(10);
    expect(frames).toHaveLength(1);
    frames.shift()?.(100);
    expect(ran).toEqual([100]);
  });

  it("drops a waiting callback when it is cancelled", () => {
    const callback = vi.fn();
    const id = requestTick(callback, performance.now() + 50);
    cancelTick(id);
    vi.advanceTimersByTime(100);
    expect(frames).toHaveLength(0);
    expect(callback).not.toHaveBeenCalled();
  });
});
