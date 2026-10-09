import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withinLimit } from "@/lib/server/throttle";

const START = new Date("2026-01-01T00:00:00Z").getTime();

describe("withinLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows max requests in a window, then blocks", () => {
    const results = Array.from({ length: 5 }, () => withinLimit("allow:a", 3, 60_000));
    expect(results).toEqual([true, true, true, false, false]);
  });

  it("counts each key on its own", () => {
    expect(withinLimit("keys:a", 1, 60_000)).toBe(true);
    expect(withinLimit("keys:a", 1, 60_000)).toBe(false);
    expect(withinLimit("keys:b", 1, 60_000)).toBe(true);
    expect(withinLimit("keys:a", 1, 60_000)).toBe(false);
  });

  it("starts a new window once ms have passed since the first request", () => {
    expect(withinLimit("window:a", 2, 1000)).toBe(true);
    vi.setSystemTime(START + 400);
    expect(withinLimit("window:a", 2, 1000)).toBe(true);
    expect(withinLimit("window:a", 2, 1000)).toBe(false);

    vi.setSystemTime(START + 999);
    expect(withinLimit("window:a", 2, 1000)).toBe(false);

    vi.setSystemTime(START + 1000);
    expect(withinLimit("window:a", 2, 1000)).toBe(true);
    expect(withinLimit("window:a", 2, 1000)).toBe(true);
    expect(withinLimit("window:a", 2, 1000)).toBe(false);
  });

  it("does not extend the window for blocked requests", () => {
    expect(withinLimit("fixed:a", 1, 1000)).toBe(true);
    for (let t = 100; t < 1000; t += 100) {
      vi.setSystemTime(START + t);
      expect(withinLimit("fixed:a", 1, 1000)).toBe(false);
    }
    vi.setSystemTime(START + 1000);
    expect(withinLimit("fixed:a", 1, 1000)).toBe(true);
  });

  it("forgets the oldest key once more than 10,000 keys are tracked", () => {
    expect(withinLimit("bound:first", 1, 60_000)).toBe(true);
    expect(withinLimit("bound:first", 1, 60_000)).toBe(false);

    for (let i = 0; i < 9_999; i++) withinLimit(`bound:${i}`, 1, 60_000);
    expect(withinLimit("bound:first", 1, 60_000)).toBe(false);

    withinLimit("bound:9999", 1, 60_000);
    expect(withinLimit("bound:first", 1, 60_000)).toBe(true);
    expect(withinLimit("bound:9999", 1, 60_000)).toBe(false);
  });
});
