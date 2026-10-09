import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { finite, isRecord, readJson, rows, text, toDate } from "@/lib/lumesec/data";

/** The part of an element readJson uses; no DOM needed. */
function element(attributes: Record<string, string>, localName = "px-sparkline"): Element {
  const fake: Pick<Element, "localName" | "getAttribute"> = {
    localName,
    getAttribute: (name: string) => (Object.hasOwn(attributes, name) ? attributes[name] : null),
  };
  return fake as Element;
}

interface Point {
  label: string;
  value: number;
}

const parsePoint = (entry: unknown): Point | null =>
  isRecord(entry) && typeof entry.label === "string" ? { label: entry.label, value: finite(entry.value, 0) } : null;

describe("readJson", () => {
  let warn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("parses the data attribute, or another attribute by name", () => {
    expect(readJson(element({ data: '[{"label":"a","value":1}]' }))).toEqual([{ label: "a", value: 1 }]);
    expect(readJson(element({ series: '{"a":1}' }), "series")).toEqual({ a: 1 });
  });

  it("returns null for a missing or blank attribute without a warning", () => {
    expect(readJson(element({}))).toBeNull();
    expect(readJson(element({ data: "  " }))).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back to null on invalid JSON and warns once per element", () => {
    const first = element({ data: "[{label: 'a'}]" });
    expect(readJson(first)).toBeNull();
    expect(readJson(first)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("<px-sparkline>: the data attribute is not valid JSON; showing sample data.");

    expect(readJson(element({ rows: "{" }, "px-table"), "rows")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenLastCalledWith("<px-table>: the rows attribute is not valid JSON; showing sample data.");
  });

  it("keeps a __proto__ key as plain data instead of polluting prototypes", () => {
    const value = readJson(element({ data: '[{"__proto__":{"polluted":true},"label":"a","value":2}]' }));
    const parsed = rows(value, parsePoint);

    expect(parsed).toEqual([{ label: "a", value: 2 }]);
    expect(Object.prototype).not.toHaveProperty("polluted");

    const [entry] = value as unknown[];
    expect(Object.getPrototypeOf(entry)).toBe(Object.prototype);
    expect(Object.hasOwn(entry as object, "__proto__")).toBe(true);
  });
});

describe("rows", () => {
  it("returns null for anything but an array, so the element shows its sample data", () => {
    for (const value of [null, undefined, {}, "[]", 3]) expect(rows(value, parsePoint)).toBeNull();
  });

  it("keeps an empty array empty", () => {
    expect(rows([], parsePoint)).toEqual([]);
  });

  it("drops the entries the parser rejects and keeps the order of the rest", () => {
    const value = [{ label: "a", value: 1 }, null, "b", { value: 2 }, { label: "c", value: "3" }, []];
    expect(rows(value, parsePoint)).toEqual([
      { label: "a", value: 1 },
      { label: "c", value: 3 },
    ]);
  });

  it("passes the index of each entry", () => {
    expect(rows(["x", "y"], (entry, index) => `${index}:${String(entry)}`)).toEqual(["0:x", "1:y"]);
  });
});

describe("field readers", () => {
  it("isRecord accepts plain objects only", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("a")).toBe(false);
  });

  it("finite reads numbers and numeric strings, and falls back for the rest", () => {
    expect(finite(3, 0)).toBe(3);
    expect(finite("3.5", 0)).toBe(3.5);
    expect(finite(" -2 ", 0)).toBe(-2);
    const invalid = ["", "  ", "abc", "Infinity", Number.NaN, Number.POSITIVE_INFINITY, null, undefined, true, []];
    for (const value of invalid) expect(finite(value, 7)).toBe(7);
  });

  it("text reads strings and finite numbers", () => {
    expect(text("a")).toBe("a");
    expect(text("")).toBe("");
    expect(text(42)).toBe("42");
    expect(text(Number.NaN, "?")).toBe("?");
    expect(text(null, "?")).toBe("?");
    expect(text({ toString: () => "x" }, "?")).toBe("?");
  });

  it("toDate reads Dates, ISO strings and epoch milliseconds", () => {
    const date = new Date("2026-01-02T03:04:05Z");
    expect(toDate(date)).toBe(date);
    expect(toDate("2026-01-02T03:04:05Z")?.getTime()).toBe(date.getTime());
    expect(toDate(date.getTime())?.getTime()).toBe(date.getTime());
    expect(toDate(0)?.getTime()).toBe(0);
  });

  it("toDate returns null for values that are not dates", () => {
    for (const value of ["not a date", "", Number.NaN, new Date(Number.NaN), null, undefined, true, {}]) {
      expect(toDate(value)).toBeNull();
    }
  });
});
