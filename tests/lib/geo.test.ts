import { describe, expect, it } from "vitest";

import {
  angleDelta,
  boundsOf,
  createProjection,
  createScreenPoint,
  destinationPoint,
  distanceKm,
  EARTH_RADIUS_KM,
  initialBearing,
  isValidLatLon,
  projectLatLonGlobe,
  rotationFromView,
  screenToGlobe,
  unwrapLongitude,
  wrapLongitude,
  type LatLon,
  type ProjectionKind,
} from "@/lib/lumesec/geo";
import { formatCoordinate, formatLatLon, ipScope, parseCoordinates, parseIpAddress } from "@/lib/lumesec/geo-data";

const LONDON: LatLon = { lat: 51.5072, lon: -0.1276 };
const PARIS: LatLon = { lat: 48.8566, lon: 2.3522 };
const NEW_YORK: LatLon = { lat: 40.7128, lon: -74.006 };
const SYDNEY: LatLon = { lat: -33.8688, lon: 151.2093 };
const CAPE_TOWN: LatLon = { lat: -33.9249, lon: 18.4241 };

function expectNear(actual: LatLon | null, expected: LatLon, tolerance = 1e-6) {
  expect(actual).not.toBeNull();
  if (!actual) return;
  expect(Math.abs(actual.lat - expected.lat)).toBeLessThan(tolerance);
  expect(Math.abs(wrapLongitude(actual.lon - expected.lon))).toBeLessThan(tolerance);
}

describe("great-circle geometry", () => {
  it("measures well-known city distances", () => {
    expect(distanceKm(LONDON, PARIS)).toBeCloseTo(343.9, 0);
    expect(distanceKm(LONDON, NEW_YORK)).toBeCloseTo(5570, -1);
    expect(distanceKm(LONDON, SYDNEY)).toBeCloseTo(16_994, -1);
  });

  it("is symmetric and zero for the same point", () => {
    expect(distanceKm(PARIS, LONDON)).toBe(distanceKm(LONDON, PARIS));
    expect(distanceKm(PARIS, PARIS)).toBe(0);
  });

  it("measures half the circumference between antipodes", () => {
    expect(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(Math.PI * EARTH_RADIUS_KM, 6);
    expect(distanceKm({ lat: 90, lon: 0 }, { lat: -90, lon: 0 })).toBeCloseTo(Math.PI * EARTH_RADIUS_KM, 6);
  });

  it("takes the short way across the antimeridian", () => {
    const oneDegree = (Math.PI / 180) * EARTH_RADIUS_KM;
    expect(distanceKm({ lat: 0, lon: 179.5 }, { lat: 0, lon: -179.5 })).toBeCloseTo(oneDegree, 6);
  });

  it("reaches the destination it measured: bearing plus distance round-trips", () => {
    for (const [from, to] of [
      [LONDON, PARIS],
      [NEW_YORK, LONDON],
      [SYDNEY, CAPE_TOWN],
      [
        { lat: 10, lon: 170 },
        { lat: -10, lon: -170 },
      ],
    ] as const) {
      expectNear(destinationPoint(from, initialBearing(from, to), distanceKm(from, to)), to);
    }
  });

  it("gives bearings clockwise from north", () => {
    expect(initialBearing({ lat: 0, lon: 0 }, { lat: 10, lon: 0 })).toBeCloseTo(0, 9);
    expect(initialBearing({ lat: 0, lon: 0 }, { lat: 0, lon: 10 })).toBeCloseTo(90, 9);
    expect(initialBearing({ lat: 0, lon: 0 }, { lat: -10, lon: 0 })).toBeCloseTo(180, 9);
    expect(initialBearing({ lat: 0, lon: 0 }, { lat: 0, lon: -10 })).toBeCloseTo(270, 9);
  });
});

describe("longitudes", () => {
  it("wraps into [-180, 180)", () => {
    expect(wrapLongitude(180)).toBe(-180);
    expect(wrapLongitude(-180)).toBe(-180);
    expect(wrapLongitude(190)).toBe(-170);
    expect(wrapLongitude(-190)).toBe(170);
    expect(wrapLongitude(540)).toBe(-180);
    expect(Object.is(wrapLongitude(360), 0)).toBe(true);
  });

  it("unwraps a longitude to within 180 degrees of another", () => {
    expect(unwrapLongitude(170, -170)).toBe(190);
    expect(unwrapLongitude(-170, 170)).toBe(-190);
    expect(unwrapLongitude(0, 10)).toBe(10);
  });

  it("gives the shortest signed difference, in (-180, 180]", () => {
    expect(angleDelta(170, -170)).toBe(20);
    expect(angleDelta(-170, 170)).toBe(-20);
    expect(angleDelta(0, 180)).toBe(180);
    expect(angleDelta(0, -180)).toBe(180);
  });

  it("bounds Pacific points across the antimeridian instead of around the world", () => {
    const bounds = boundsOf([
      { lat: 0, lon: 170 },
      { lat: 10, lon: -170 },
    ]);
    expect(bounds.west).toBeCloseTo(160, 9);
    expect(bounds.east).toBeCloseTo(200, 9);
    expect(bounds.west).toBeGreaterThanOrEqual(-180);
    expect(bounds.west).toBeLessThan(180);
  });

  it("bounds nothing as the whole world", () => {
    expect(boundsOf([])).toEqual({ west: -180, south: -90, east: 180, north: 90 });
  });
});

describe("isValidLatLon", () => {
  it("accepts finite coordinates with |lat| <= 90 and any longitude", () => {
    expect(isValidLatLon({ lat: 0, lon: 0 })).toBe(true);
    expect(isValidLatLon({ lat: -90, lon: 180 })).toBe(true);
    expect(isValidLatLon({ lat: 90, lon: 540 })).toBe(true);
  });

  it("rejects out-of-range, non-finite and non-numeric values", () => {
    expect(isValidLatLon({ lat: 90.0001, lon: 0 })).toBe(false);
    expect(isValidLatLon({ lat: Number.NaN, lon: 0 })).toBe(false);
    expect(isValidLatLon({ lat: 0, lon: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isValidLatLon({ lat: "48.85", lon: 2.35 })).toBe(false);
    expect(isValidLatLon({ lat: 48.85 })).toBe(false);
    expect(isValidLatLon(null)).toBe(false);
    expect(isValidLatLon(undefined)).toBe(false);
  });
});

describe("flat projections", () => {
  const kinds: ProjectionKind[] = ["equirectangular", "equalEarth", "mercator", "azimuthalEquidistant"];

  it.each(kinds)("%s: invert undoes project", (kind) => {
    const projection = createProjection(kind, { width: 800, height: 420, padding: 12, center: { lat: 20, lon: 10 } });
    const point = createScreenPoint();
    for (const place of [LONDON, NEW_YORK, SYDNEY, CAPE_TOWN, { lat: 0, lon: 0 }, { lat: -45, lon: -120 }]) {
      expect(projection.project(place.lat, place.lon, point)).toBe(true);
      expectNear(projection.invert(point.x, point.y), place);
    }
  });

  it("keeps a cropped map's points inside its frame and inverts outside it to null", () => {
    const projection = createProjection("equirectangular", { width: 600, height: 300, latRange: [-58, 84] });
    const point = createScreenPoint();
    expect(projection.project(LONDON.lat, LONDON.lon, point)).toBe(true);
    expect(point.x).toBeGreaterThanOrEqual(projection.frame.x0);
    expect(point.x).toBeLessThanOrEqual(projection.frame.x1);
    expect(projection.project(-80, 0, point)).toBe(false);
    expect(projection.invert(projection.frame.x0 - 10, projection.frame.y0 - 10)).toBeNull();
  });

  it("draws a range across the antimeridian as one continuous map", () => {
    const projection = createProjection("equirectangular", {
      width: 600,
      height: 300,
      lonRange: [150, 210],
      latRange: [-50, 10],
    });
    const { x0, x1 } = projection.frame;
    const west = createScreenPoint();
    const east = createScreenPoint();
    expect(projection.project(-20, 170, west)).toBe(true);
    expect(projection.project(-20, -170, east)).toBe(true);
    expect(west.x).toBeGreaterThan(x0);
    expect(east.x).toBeLessThan(x1);
    expect((east.x - west.x) / (x1 - x0)).toBeCloseTo(20 / 60, 9);
    expectNear(projection.invert(east.x, east.y), { lat: -20, lon: -170 });
  });
});

describe("orthographic globe", () => {
  const view = { cx: 200, cy: 200, radius: 150, rotation: rotationFromView(10, 45) };

  it("puts the view centre in the middle of the disc", () => {
    expectNear(screenToGlobe(view, 200, 200), { lat: 45, lon: 10 });
  });

  it("projects a visible point and reads it back from the screen", () => {
    const point = createScreenPoint();
    expect(projectLatLonGlobe(view, PARIS.lat, PARIS.lon, point)).toBe(true);
    expectNear(screenToGlobe(view, point.x, point.y), PARIS);
  });

  it("hides the far side and returns null off the disc", () => {
    expect(projectLatLonGlobe(view, -45, -170, createScreenPoint())).toBe(false);
    expect(screenToGlobe(view, 200 + 151, 200)).toBeNull();
  });
});

describe("parseIpAddress", () => {
  it("parses IPv4 and normalises IPv6 text (RFC 5952)", () => {
    expect(parseIpAddress("192.0.2.1")).toMatchObject({ version: 4, text: "192.0.2.1" });
    expect(parseIpAddress("2001:DB8:0:0:0:0:0:1")?.text).toBe("2001:db8::1");
    expect(parseIpAddress("2001:db8:0:0:1:0:0:1")?.text).toBe("2001:db8::1:0:0:1");
    expect(parseIpAddress("2001:db8:0:1:1:1:1:1")?.text).toBe("2001:db8:0:1:1:1:1:1");
    expect(parseIpAddress("::ffff:192.0.2.1")?.text).toBe("::ffff:192.0.2.1");
  });

  it("accepts brackets and drops a zone", () => {
    expect(parseIpAddress(" [2001:db8::1] ")?.text).toBe("2001:db8::1");
    expect(parseIpAddress("fe80::1%eth0")?.text).toBe("fe80::1");
  });

  it.each(["", "256.0.0.1", "01.2.3.4", "1.2.3", "192.0.2.1:80", "1::2::3", "1:2:3:4:5:6:7:8:9", "fe80::1%", "g::1"])(
    "rejects %j",
    (text) => {
      expect(parseIpAddress(text)).toBeNull();
    },
  );
});

describe("ipScope", () => {
  const scopeOf = (text: string) => {
    const address = parseIpAddress(text);
    if (!address) throw new Error(`${text} does not parse`);
    return ipScope(address);
  };

  it.each([
    ["192.0.2.1", "documentation"],
    ["198.51.100.200", "documentation"],
    ["203.0.113.42", "documentation"],
    ["2001:db8::1", "documentation"],
    ["3fff::1", "documentation"],
    ["3fff:fff:ffff::1", "documentation"],
    ["3fff:1000::1", "public"],
    ["10.0.0.1", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["172.32.0.1", "public"],
    ["192.168.1.1", "private"],
    ["fd00::1", "private"],
    ["127.0.0.1", "loopback"],
    ["::1", "loopback"],
    ["0.0.0.0", "unspecified"],
    ["::", "unspecified"],
    ["100.64.0.1", "shared"],
    ["100.128.0.1", "public"],
    ["169.254.10.1", "link-local"],
    ["fe80::1", "link-local"],
    ["224.0.0.1", "multicast"],
    ["ff02::1", "multicast"],
    ["192.0.0.1", "reserved"],
    ["192.0.0.9", "public"],
    ["192.0.0.10", "public"],
    ["192.0.0.11", "reserved"],
    ["198.18.0.1", "reserved"],
    ["198.19.255.255", "reserved"],
    ["198.20.0.1", "public"],
    ["240.0.0.1", "reserved"],
    ["::ffff:10.0.0.1", "private"],
    ["64:ff9b::192.0.2.1", "documentation"],
    ["8.8.8.8", "public"],
    ["2606:4700::1111", "public"],
  ])("classifies %s as %s", (text, scope) => {
    expect(scopeOf(text)).toBe(scope);
  });
});

describe("coordinate text", () => {
  it("formats decimal, DMS and signed forms", () => {
    expect(formatLatLon(PARIS)).toBe("48.8566° N, 2.3522° E");
    expect(formatLatLon(PARIS, "dms")).toBe("48°51′24″ N, 2°21′08″ E");
    expect(formatLatLon(LONDON, "signed")).toBe("51.5072, −0.1276");
  });

  it("carries rounded seconds into minutes and degrees", () => {
    expect(formatCoordinate(10.99999, "lat", "dms").text).toBe("11°00′00″ N");
  });

  it("shows N or E for a negative value that rounds to zero", () => {
    expect(formatCoordinate(-0.00001, "lat", "decimal").text).toBe("0.0000° N");
    expect(formatCoordinate(-0.00001, "lon", "dms").text).toBe("0°00′00″ E");
  });

  it("wraps longitudes, clamps latitudes and marks missing values", () => {
    expect(formatCoordinate(190, "lon", "decimal", 1).text).toBe("170.0° W");
    expect(formatCoordinate(95, "lat", "decimal", 0).text).toBe("90° N");
    expect(formatCoordinate(Number.NaN, "lat", "decimal").text).toBe("–");
  });

  it("parses what it formats", () => {
    for (const format of ["decimal", "dms", "signed"] as const) {
      expectNear(parseCoordinates(formatLatLon(SYDNEY, format)), SYDNEY, format === "dms" ? 1 / 3600 : 1e-4);
    }
  });

  it("reads pairs given longitude first and rejects impossible ones", () => {
    expectNear(parseCoordinates("2.3522E 48.8566N"), PARIS);
    expect(parseCoordinates("91, 0")).toBeNull();
    expect(parseCoordinates("48.8566N 2.3522N")).toBeNull();
  });
});
