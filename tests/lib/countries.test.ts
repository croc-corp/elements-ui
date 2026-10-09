import { describe, expect, it } from "vitest";

import { COUNTRIES, countryAt, countryShape, getCountry, isSeam } from "@/lib/lumesec/geo-countries";

const codeAt = (lat: number, lon: number) => countryAt(lat, lon)?.code;

describe("country table", () => {
  it("looks countries up by code, case-insensitively", () => {
    expect(getCountry("DE")).toMatchObject({ code: "DE", name: "Germany", region: "Europe" });
    expect(getCountry("jp")?.name).toBe("Japan");
    expect(getCountry("XK")?.name).toBe("Kosovo");
    expect(getCountry("ZZ")).toBeUndefined();
  });

  it("has unique codes, sorted by name, each with an outline", () => {
    const codes = COUNTRIES.map((country) => country.code);
    expect(new Set(codes).size).toBe(codes.length);
    const names = COUNTRIES.map((country) => country.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
    expect(codes.filter((code) => countryShape(code).length === 0)).toEqual([]);
  });

  it("returns an empty outline for an unknown code", () => {
    expect(countryShape("ZZ")).toEqual([]);
    expect(countryShape("constructor")).toEqual([]);
  });
});

describe("countryAt", () => {
  it.each([
    ["Berlin", 52.52, 13.405, "DE"],
    ["Paris", 48.8566, 2.3522, "FR"],
    ["São Paulo", -23.5505, -46.6333, "BR"],
    ["Wellington", -41.2865, 174.7762, "NZ"],
    ["Antananarivo", -18.8792, 47.5079, "MG"],
    ["Fairbanks, Alaska", 64.8378, -147.7164, "US"],
    ["Nome, Alaska", 64.5011, -165.4064, "US"],
    ["Anadyr, Chukotka", 64.7337, 177.4968, "RU"],
    ["eastern Chukotka, west of 180", 66.0, -173.0, "RU"],
    ["Viti Levu, Fiji", -17.8, 178.0, "FJ"],
    ["the South Pole", -89.9, 0, "AQ"],
    ["inland Antarctica", -80, 120, "AQ"],
  ])("finds %s", (_, lat, lon, code) => {
    expect(codeAt(lat, lon)).toBe(code);
  });

  it("returns undefined over the ocean", () => {
    expect(countryAt(0, -140)).toBeUndefined();
    expect(countryAt(30, -40)).toBeUndefined();
    expect(countryAt(-30, 80)).toBeUndefined();
  });

  it("wraps longitudes", () => {
    expect(codeAt(52.52, 13.405 + 360)).toBe("DE");
    expect(codeAt(64.8378, -147.7164 - 360)).toBe("US");
  });

  it("finds every country at its own label point", () => {
    const misplaced = COUNTRIES.filter((country) => codeAt(country.lat, country.lon) !== country.code).map(
      (country) => `${country.code} at ${country.lat}, ${country.lon}: ${codeAt(country.lat, country.lon) ?? "none"}`,
    );
    expect(misplaced).toEqual([]);
  });
});

describe("isSeam", () => {
  it("marks segments that jump across or run along the antimeridian", () => {
    expect(isSeam(179.5, -179.5)).toBe(true);
    expect(isSeam(180, -180)).toBe(true);
    expect(isSeam(-180, -180)).toBe(true);
  });

  it("keeps ordinary border segments", () => {
    expect(isSeam(10, 11)).toBe(false);
    expect(isSeam(179.5, 179.8)).toBe(false);
  });
});
