import { describe, expect, it } from "vitest";

import { fuzzyMatch } from "@/lib/lumesec/fuzzy";
import {
  clamp,
  hash,
  hslToRgb,
  lerp,
  percent,
  rgba,
  rgbToHex,
  smoothstep,
  stringHash,
  type RGB,
} from "@/lib/lumesec/math";

describe("numbers", () => {
  it("clamp limits a value to the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it("lerp interpolates without clamping t", () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(lerp(10, 20, 1.5)).toBe(25);
    expect(lerp(10, 20, -1)).toBe(0);
  });

  it("smoothstep is 0 below the first edge, 1 above the second and 0.5 halfway", () => {
    expect(smoothstep(2, 4, 1)).toBe(0);
    expect(smoothstep(2, 4, 3)).toBe(0.5);
    expect(smoothstep(2, 4, 5)).toBe(1);
  });

  it("percent prints three decimals, so server and browser markup match", () => {
    expect(percent(0.25)).toBe("25.000%");
    expect(percent(1 / 3)).toBe("33.333%");
    expect(percent(0)).toBe("0.000%");
    expect(percent(1)).toBe("100.000%");
  });

  it("stringHash is 32-bit FNV-1a", () => {
    expect(stringHash("")).toBe(0x811c9dc5);
    expect(stringHash("a")).toBe(0xe40c292c);
    expect(stringHash("foobar")).toBe(0xbf9cf968);
  });

  it("hash is deterministic and in [0, 1)", () => {
    for (let n = -50; n <= 50; n += 0.5) {
      const value = hash(n);
      expect(value).toBe(hash(n));
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("colours", () => {
  it.each([
    [0, "#ff0000"],
    [60, "#ffff00"],
    [120, "#00ff00"],
    [180, "#00ffff"],
    [240, "#0000ff"],
    [300, "#ff00ff"],
  ])("hue %i at full saturation and half lightness is %s", (hue, hex) => {
    expect(rgbToHex(hslToRgb(hue, 1, 0.5))).toBe(hex);
  });

  it("wraps hues outside [0, 360)", () => {
    expect(hslToRgb(-120, 0.8, 0.4)).toEqual(hslToRgb(240, 0.8, 0.4));
    expect(hslToRgb(480, 0.8, 0.4)).toEqual(hslToRgb(120, 0.8, 0.4));
  });

  it("gives black, white and greys whatever the hue", () => {
    expect(rgbToHex(hslToRgb(200, 0.7, 0))).toBe("#000000");
    expect(rgbToHex(hslToRgb(200, 0.7, 1))).toBe("#ffffff");
    expect(hslToRgb(200, 0, 0.5)).toEqual([127.5, 127.5, 127.5]);
  });

  it("matches a known colour", () => {
    expect(rgbToHex(hslToRgb(260.09, 0.9008, 0.5255))).toBe("#6219f3");
  });

  it("keeps every channel within 0 to 255", () => {
    for (let hue = 0; hue < 360; hue += 15) {
      for (const saturation of [0, 0.5, 1]) {
        for (const lightness of [0, 0.25, 0.5, 0.75, 1]) {
          for (const channel of hslToRgb(hue, saturation, lightness)) {
            expect(channel).toBeGreaterThanOrEqual(-1e-9);
            expect(channel).toBeLessThanOrEqual(255 + 1e-9);
          }
        }
      }
    }
  });

  it("rgbToHex and rgba round and clamp channels", () => {
    const color: RGB = [300, -5, 127.5];
    expect(rgbToHex(color)).toBe("#ff0080");
    expect(rgba(color)).toBe("rgb(255,0,128)");
    expect(rgba(color, 0.5)).toBe("rgba(255,0,128,0.5)");
  });
});

describe("fuzzyMatch", () => {
  it("matches everything with score 1 for an empty query", () => {
    expect(fuzzyMatch("", "Anything")).toEqual({ score: 1, indices: [] });
  });

  it("scores a substring 100 minus its start, case-insensitively", () => {
    expect(fuzzyMatch("sel", "Select")).toEqual({ score: 100, indices: [0, 1, 2] });
    expect(fuzzyMatch("LEC", "Select")).toEqual({ score: 98, indices: [2, 3, 4] });
  });

  it("matches characters in order and scores them by span", () => {
    expect(fuzzyMatch("sct", "Select")).toEqual({ score: 45, indices: [0, 4, 5] });
    expect(fuzzyMatch("dp", "Date picker")).toEqual({ score: 45, indices: [0, 5] });
  });

  it("returns null when the characters are missing or out of order", () => {
    expect(fuzzyMatch("xyz", "Select")).toBeNull();
    expect(fuzzyMatch("ts", "Select")).toBeNull();
    expect(fuzzyMatch("selects", "Select")).toBeNull();
  });

  it("ranks substrings first, earlier ones higher, then the tightest scattered match", () => {
    const items = ["Toast bar", "Data table", "Tabs", "Text area", "Toggle"];
    const ranked = items
      .map((item) => ({ item, match: fuzzyMatch("tab", item) }))
      .filter((entry) => entry.match !== null)
      .sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0))
      .map((entry) => entry.item);
    expect(ranked).toEqual(["Tabs", "Data table", "Toast bar"]);
  });
});
