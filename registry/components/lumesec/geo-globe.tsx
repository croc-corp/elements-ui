"use client";

import * as React from "react";

import { useCanvas, type CanvasSurface } from "@/lib/lumesec/canvas";
import { usePalette } from "@/lib/lumesec/color";
import {
  angleDelta,
  arcLift,
  ARROW_DIRECTIONS,
  buildArcLength,
  centralAngle,
  createDotBatch,
  createGlobeMotion,
  createScreenPoint,
  cubicBezier,
  DEG,
  flyTo,
  forEachDot,
  GEO_TOKENS,
  geoInk,
  globeArc,
  graticuleSvgPath,
  isOccluded,
  isValidLatLon,
  latLonToVector,
  nudgeGlobe,
  placeLabels,
  pointAtDistance,
  projectLatLonGlobe,
  ringFront,
  rotationFromView,
  spacingForRadius,
  spatialNavigate,
  sphereLattice,
  stepGlobeMotion,
  toneColor,
  traceGlobeCoastlines,
  useGlobeDrag,
  wrapLongitude,
  type ArcLengthTable,
  type DotBatch,
  type GeoInk,
  type GlobeMotion,
  type GlobeView,
  type LabelAnchor,
  type LabelPlacement,
  type LatLon,
  type ScreenPoint,
  type SphereLattice,
  type Vec3,
} from "@/lib/lumesec/geo";
import { createRandom, DEMO_CITIES, DEMO_REGIONS, pickWeighted } from "@/lib/lumesec/geo-data";
import { clamp, easeOutCubic, mixRgb, rgba, smoothstep, TAU, type RGB } from "@/lib/lumesec/math";
import {
  prefersReducedMotion,
  springStep,
  useAnimationLoop,
  useInView,
  useInterval,
  useLazyRef,
  useReducedMotion,
  type Spring,
} from "@/lib/lumesec/motion";
import { RollText } from "@/lib/lumesec/roll-text";
import { Sparks } from "@/lib/lumesec/sparks";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** Colour of a connection: the accent, or one of the status colours. */
export type GlobeTone = "accent" | "info" | "success" | "warning" | "destructive";

/** Land dot pitch: `fine` 3 px, `regular` 4 px, `coarse` 5 px between dots at the centre of the globe. */
export type GlobeDensity = "fine" | "regular" | "coarse";

/** A place on the globe. Connections refer to it by `id`. */
export interface GlobeLocation {
  /** Unique id. Connections use it in `from` and `to`, and it is the selection value. */
  readonly id: string;
  /** Name shown in the chip and used as the marker's accessible name. */
  readonly label: string;
  /** Latitude in degrees, -90 to 90. */
  readonly lat: number;
  /** Longitude in degrees, east positive. */
  readonly lon: number;
}

/** One connection between two locations. Each `id` plays once. */
export interface GlobeConnection {
  /** Unique id. A connection whose id has already played is ignored. */
  readonly id: string;
  /** Id of the location it leaves. */
  readonly from: string;
  /** Id of the location it lands at. */
  readonly to: string;
  /** Colour of the arc, packet and arrival. Default `accent`. */
  readonly tone?: GlobeTone;
}

/** Imperative actions on the globe, exposed through `ref`. */
export interface GeoGlobeHandle {
  /** Plays one connection (ignored when its id has already played). Works with or without `connections`. */
  push(connection: GlobeConnection): void;
  /** Turns the globe toward a location id or a point. */
  flyTo(target: string | LatLon): void;
}

/** Props of GeoGlobe. The remaining props go to the root `<div>`. */
export interface GeoGlobeProps extends Omit<React.ComponentProps<"div">, "ref" | "defaultValue" | "children"> {
  /** Points on the globe. Without it the globe shows 12 demo regions. An empty array shows the bare globe. */
  locations?: readonly GlobeLocation[];
  /**
   * Connections to play, with location ids. Each new `id` plays once, so the array can grow or be replaced. Without
   * it a seeded demo stream runs; pass an empty array to play only what you `push()`.
   */
  connections?: readonly GlobeConnection[];
  /** Selected location id (controlled). Use with `onValueChange`. */
  value?: string | null;
  /** Selected location when uncontrolled. */
  defaultValue?: string | null;
  /** Called when a location is selected or the selection is cleared. */
  onValueChange?: (value: string | null) => void;
  /** Where the globe faces on mount, and where Home returns to. The latitude is limited to ±35°. */
  defaultCenter?: LatLon;
  /** Turns the globe slowly while idle, resuming 2.5 s after the last interaction. Off with reduced motion. */
  autoRotate?: boolean;
  /** Land dot pitch: 3, 4 or 5 px. */
  density?: GlobeDensity;
  /** Draws the hairline coastline. */
  coastline?: boolean;
  /** Arcs in flight at once. Further connections only add to the counts. */
  maxArcs?: number;
  /** Called when a connection's packet lands; at once for connections beyond `maxArcs`. */
  onArrive?: (connection: GlobeConnection) => void;
  /** Accessible name of the globe. */
  label?: string;
  /** Exposes `push()` and `flyTo()`. */
  ref?: React.Ref<GeoGlobeHandle>;
}

/* Constants ------------------------------------------------------------------------------------------- */

const DEFAULT_CENTER: LatLon = { lat: 24, lon: 12 };
const LAT_LIMIT = 35;
const PITCH: Record<GlobeDensity, number> = { fine: 3, regular: 4, coarse: 5 };
/** The globe's radius as a share of the stage's shorter side, leaving room for the arcs above it. */
const RADIUS_SHARE = 0.38;
/** The effects canvas reaches this far above and below the stage, so sparks fly past its edge. */
const FX_Y = 40;
const LAND_DOT = 1.5;
/** Dots closer to the limb than this (view z) are skipped: the foreshortened rows would moiré. */
const LIMB_CUTOFF = 0.06;
const MARKER_SIZE = 24;
/** Zoomed in, the globe and its markers fade out over this many px at the stage edge. */
const EDGE_FADE = 20;
const EDGE_MASK = ["bottom", "right"]
  .map(
    (side) =>
      `linear-gradient(to ${side}, transparent, #000 ${EDGE_FADE}px, #000 calc(100% - ${EDGE_FADE}px), transparent)`,
  )
  .join(", ");
const MARKER_HIDE_Z = 0.12;
const AUTO_ROTATE_SPEED = 6;
const ZOOM_STEP = 0.2;

const ARC_SEGMENTS = 64;
const ARC_LIFT = 0.7;
const ARC_EASE = cubicBezier(0.45, 0, 0.25, 1);
/** Seconds the full arc rests between drawing and erasing. */
const ARC_HOLD = 0.5;
const ARC_DOT_SPACING = 3.5;
const ARC_ALPHA = 0.7;
/** Static arcs under reduced motion stay this long. */
const STILL_SECONDS = 2;
/** Seconds between connections of a batch, so a burst arrives as a volley. */
const STAGGER = 0.12;
/** A long volley still leaves within this many seconds. */
const MAX_STAGGER = 2.4;

const RIPPLE_SECONDS = 0.9;
const RIPPLE_REACH = 46;
const RIPPLE_WIDTH = 7;
const RIPPLE_COS = Math.cos(25 * DEG);
const GLOW_SECONDS = 2.4;
const SPARK_COUNT = 18;

const PLAYED_LIMIT = 2000;
const DEMO_INTERVAL_MS = 900;
const REPORT_INTERVAL_MS = 10_000;

const TONES: readonly GlobeTone[] = ["accent", "info", "success", "warning", "destructive"];

/** The marker dot per tone; neutral markers use the land ink (the foreground 55 % over the card). */
const TONE_DOT: Record<GlobeTone, string> = {
  accent: "bg-lumesec",
  info: "bg-lumesec-info",
  success: "bg-lumesec-success",
  warning: "bg-lumesec-warning",
  destructive: "bg-destructive",
};
const NEUTRAL_DOT = "bg-[color-mix(in_srgb,var(--foreground)_55%,var(--card))]";

/** The first 12 demo regions, from the shared Location demo set. */
const DEMO_LOCATIONS: readonly GlobeLocation[] = DEMO_REGIONS.slice(0, 12).map((region) => ({
  id: region.id,
  label: region.label,
  lat: region.lat,
  lon: region.lon,
}));

/** Demo traffic weights: each region takes the weight of its city in the demo city list. */
const DEMO_WEIGHTS = new Map<string, number>(
  DEMO_REGIONS.map((region) => [region.id, DEMO_CITIES.find((city) => city.name === region.city)?.weight ?? 0.5]),
);

const POP_KEYFRAMES: Keyframe[] = [
  { transform: "scale(1)" },
  { transform: "scale(2.1)", offset: 0.28 },
  { transform: "scale(1)" },
];
const CHIP_ENTER_KEYFRAMES: Keyframe[] = [
  { scale: "0.94", filter: "blur(2px)" },
  { scale: "1", filter: "blur(0)" },
];

/**
 * A dotted globe of the land masses with connections between locations. Each connection is a dotted arc that rises
 * higher the farther it travels, with a packet at its head; when the packet lands, the land dots around the
 * destination light up in an uneven ring and sparks fly off past the globe's edge. Drag to turn the globe (it coasts
 * and settles); locations are buttons in one tab stop, and selecting one keeps only its connections lit.
 *
 * @example
 * const globe = React.useRef<GeoGlobeHandle>(null);
 * <GeoGlobe ref={globe} locations={regions} connections={[]} onArrive={(c) => log(c)} />
 * // later: globe.current?.push({ id: "c-1", from: "us-east", to: "eu-central" });
 */
export function GeoGlobe({
  locations,
  connections,
  value,
  defaultValue = null,
  onValueChange,
  defaultCenter = DEFAULT_CENTER,
  autoRotate = false,
  density = "regular",
  coastline = true,
  maxArcs = 24,
  onArrive,
  label = "Connections between locations",
  ref,
  className,
  ...props
}: GeoGlobeProps) {
  const [selected, setSelected] = useControllableState<string | null>({ value, defaultValue, onChange: onValueChange });
  const places = React.useMemo(() => normalizeLocations(locations ?? DEMO_LOCATIONS), [locations]);
  const placeById = React.useMemo(() => new Map(places.map((place) => [place.id, place])), [places]);
  const demo = connections === undefined;
  const reducedMotion = useReducedMotion();
  const hintId = React.useId();

  const centerLat = clamp(
    Number.isFinite(defaultCenter.lat) ? defaultCenter.lat : DEFAULT_CENTER.lat,
    -LAT_LIMIT,
    LAT_LIMIT,
  );
  const centerLon = wrapLongitude(Number.isFinite(defaultCenter.lon) ? defaultCenter.lon : DEFAULT_CENTER.lon);

  const [stats, setStats] = React.useState<StatsMap>(EMPTY_STATS);
  // derived state: demo counts never mix with your data
  const [statsDemo, setStatsDemo] = React.useState(demo);
  if (statsDemo !== demo) {
    setStatsDemo(demo);
    setStats(EMPTY_STATS);
  }
  const [hoverId, setHoverId] = React.useState<string | null>(null);
  const [focusId, setFocusId] = React.useState<string | null>(null);
  const [tabStopId, setTabStopId] = React.useState<string | null>(null);
  const [report, setReport] = React.useState("");

  const selectedPlace = selected !== null ? placeById.get(selected) : undefined;
  const known = (id: string | null) => (id !== null && placeById.has(id) ? id : null);
  const chipId = known(hoverId) ?? known(focusId) ?? selectedPlace?.id ?? null;
  const chipPlace = chipId !== null ? placeById.get(chipId) : undefined;
  const chipStats = (chipId !== null && stats[chipId]) || ZERO_STATS;
  const tabStop = known(tabStopId) ?? selectedPlace?.id ?? places[0]?.id ?? null;

  // Server markup: markers placed from the starting view, in container units, until the loop takes over.
  const serverMarkers = React.useMemo(
    () => serverMarkerStyles(places, centerLon, centerLat),
    [places, centerLon, centerLat],
  );
  const graticule = React.useMemo(
    () => graticuleSvgPath({ size: 200, centerLon, centerLat, step: 30 }),
    [centerLon, centerLat],
  );

  const rootRef = React.useRef<HTMLDivElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const surfaceRef = React.useRef<HTMLDivElement>(null);
  const globeRef = React.useRef<HTMLCanvasElement>(null);
  const effectsRef = React.useRef<HTMLCanvasElement>(null);
  const placeholderRef = React.useRef<SVGSVGElement>(null);
  const ringRef = React.useRef<HTMLDivElement>(null);
  const chipRef = React.useRef<HTMLDivElement>(null);
  const markerRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const dotRefs = React.useRef(new Map<string, HTMLSpanElement>());

  const motionRef = useLazyRef(() =>
    createGlobeMotion({ lon: centerLon, lat: centerLat, stiffness: 120, damping: 0.85, latLimit: LAT_LIMIT }),
  );
  /** Everything the loop mutates, created on first use (never during render). */
  const runtimeRef = useLazyRef(createRuntime);
  /** What the loop and the imperative handle read: the latest props and derived values. */
  const latest = React.useRef<Latest>({ selected, chipId, places, placeById, maxArcs, onArrive, demo });
  React.useEffect(() => {
    latest.current = { selected, chipId, places, placeById, maxArcs, onArrive, demo };
  });

  const loop = useAnimationLoop(stageRef, step);
  const palette = usePalette(rootRef, GEO_TOKENS, () => {
    runtimeRef.current.inkStale = true;
    loop.kick();
  });
  const globeSurface = useCanvas(
    globeRef,
    () => {
      runtimeRef.current.globeDirty = true;
      loop.kick();
    },
    { maxDpr: 2 },
  );
  const effectsSurface = useCanvas(effectsRef, () => loop.kick(), { maxDpr: 2 });

  useGlobeDrag(surfaceRef, motionRef, {
    radius: () => runtimeRef.current.view.radius,
    axis: "x",
    onChange: () => {
      surfaceRef.current?.toggleAttribute("data-dragging", motionRef.current.dragging);
      loop.kick();
    },
    // a tap on the globe (not on a marker) clears the selection
    onTap: () => setSelected(null),
  });

  /**
   * Queues connections. Several in one go (an array, or `push()` calls in one handler) leave as a staggered volley
   * rather than all in the same frame.
   */
  const play = React.useCallback(
    (list: readonly GlobeConnection[], demoStream = false) => {
      const run = runtimeRef.current;
      let played = false;
      for (const connection of list) {
        if (!isConnection(connection) || run.played.has(connection.id)) continue;
        enqueue(run, latest.current, connection, { delay: volleyDelay(run), demo: demoStream });
        played = true;
      }
      if (played) loop.kick();
    },
    [runtimeRef, loop],
  );

  const flyToTarget = React.useCallback(
    (target: string | LatLon) => {
      const point = typeof target === "string" ? latest.current.placeById.get(target) : target;
      if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) {
        warnOnce(runtimeRef.current, `GeoGlobe: flyTo() got an unknown location "${String(target)}".`);
        return;
      }
      flyTo(motionRef.current, point);
      loop.kick();
    },
    [motionRef, runtimeRef, loop],
  );

  React.useImperativeHandle(ref, () => ({ push: (connection) => play([connection]), flyTo: flyToTarget }), [
    play,
    flyToTarget,
  ]);

  // Your connections: every id that has not played yet plays now.
  React.useEffect(() => {
    if (connections) play(connections);
  }, [connections, play]);

  // Demo stream: three arcs already in flight, then a connection every 0.9 s while the globe is in view.
  const inView = useInView(rootRef, "120px");
  React.useEffect(() => {
    const run = runtimeRef.current;
    if (!demo) {
      // nothing invented stays once your data arrives
      run.arcs = run.arcs.filter((arc) => !arc.demo);
      run.stats = [];
      run.arrivals = [];
      loop.kick();
      return;
    }
    if (run.seeded) return;
    run.seeded = true;
    for (const progress of [0.72, 0.46, 0.18]) {
      const connection = nextDemoConnection(run, latest.current.places);
      if (connection) enqueue(run, latest.current, connection, { progress, demo: true });
    }
    loop.kick();
  }, [demo, runtimeRef, loop]);
  useInterval(
    () => {
      if (document.hidden) return;
      const connection = nextDemoConnection(runtimeRef.current, latest.current.places);
      if (connection) play([connection], true);
    },
    DEMO_INTERVAL_MS,
    demo && inView,
  );

  // Polite summary of the arrivals, at most every 10 s.
  useInterval(() => {
    const run = runtimeRef.current;
    if (!run.arrivals.length) return;
    setReport(arrivalReport(run.arrivals, latest.current.placeById));
    run.arrivals = [];
  }, REPORT_INTERVAL_MS);

  // A new selection turns the globe toward it; the arcs re-spring their emphasis either way.
  const selectedLat = selectedPlace?.lat;
  const selectedLon = selectedPlace?.lon;
  React.useEffect(() => {
    if (selectedLat !== undefined && selectedLon !== undefined)
      flyTo(motionRef.current, { lat: selectedLat, lon: selectedLon });
    loop.kick();
  }, [selectedLat, selectedLon, selected, motionRef, loop]);

  React.useEffect(() => {
    motionRef.current.autoRotate = autoRotate ? AUTO_ROTATE_SPEED : 0;
    loop.kick();
  }, [autoRotate, motionRef, loop]);

  React.useEffect(() => {
    runtimeRef.current.globeDirty = true;
    loop.kick();
  }, [coastline, density, places, reducedMotion, runtimeRef, loop]);

  // Ctrl or Meta + wheel (and trackpad pinch) zooms; a plain wheel still scrolls the page.
  React.useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      nudgeGlobe(motionRef.current, 0, 0, clamp(-event.deltaY * lines * 0.0025, -0.25, 0.25));
      loop.kick();
    };
    surface.addEventListener("wheel", handleWheel, { passive: false });
    return () => surface.removeEventListener("wheel", handleWheel);
  }, [motionRef, loop]);

  // The chip's size feeds its placement.
  React.useEffect(() => {
    const chip = chipRef.current;
    if (!chip) return;
    const run = runtimeRef.current;
    const measure = () => {
      run.chipWidth = chip.offsetWidth;
      run.chipHeight = chip.offsetHeight;
      loop.kick();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(chip);
    return () => observer.disconnect();
  }, [runtimeRef, loop]);

  // A chip for a new location eases in where it lands.
  React.useEffect(() => {
    const chip = chipRef.current;
    runtimeRef.current.chipSide = null;
    loop.kick();
    if (chipId === null || !chip || reducedMotion || typeof chip.animate !== "function") return;
    const animation = chip.animate(CHIP_ENTER_KEYFRAMES, { duration: 200, easing: "cubic-bezier(.2,.8,.2,1)" });
    return () => animation.cancel();
  }, [chipId, reducedMotion, runtimeRef, loop]);

  // A new starting view makes React write the markers' server styles again; the loop puts them back on its next frame.
  React.useLayoutEffect(() => {
    runtimeRef.current.markers.clear();
    loop.kick();
  }, [serverMarkers, runtimeRef, loop]);

  React.useEffect(() => {
    const run = runtimeRef.current;
    return () => {
      window.clearTimeout(run.latticeTimer);
      // a cancelled rebuild must be scheduled again when the effect re-runs
      run.latticePending = 0;
    };
  }, [runtimeRef]);

  function step(_time: number, delta: number) {
    const run = runtimeRef.current;
    const globe = globeSurface.current;
    const colors = palette.current;
    if (!globe || !colors) return false;
    if (run.inkStale || !run.ink) applyInk(run, geoInk(colors));
    const ink = run.ink;
    if (!ink) return false;

    const reduced = prefersReducedMotion();
    const state = motionRef.current;
    const moving = stepGlobeMotion(state, delta, reduced);
    updateView(run, state, globe.width, globe.height);
    ensureLattice(run, PITCH[density] ?? PITCH.regular, () => loop.kick());

    const { selected: selection } = latest.current;
    const springing = advanceArcs(
      run,
      selection,
      delta,
      reduced,
      (arc) => arrive(arc, reduced),
      (arc) => depart(arc),
    );
    advanceRipples(run, delta);

    if (run.globeDirty || run.ripples.length) {
      drawGlobe(globe, run, ink, coastline);
      run.globeDirty = false;
      if (!run.painted) {
        run.painted = true;
        // crossfade from the server placeholder to the first canvas frame
        if (placeholderRef.current) placeholderRef.current.style.opacity = "0";
      }
    }
    const effects = effectsSurface.current;
    if (effects) drawEffects(effects, run, delta);

    placeMarkers(run);
    placeChip(run);
    placeRing(run);

    if (run.stats.length) {
      const events = run.stats;
      run.stats = [];
      setStats((previous) => applyStats(previous, events));
    }

    return (
      moving ||
      springing ||
      run.arcs.length > 0 ||
      run.ripples.length > 0 ||
      run.glows.length > 0 ||
      run.sparks.active ||
      run.fxDirty
    );
  }

  function depart(arc: Arc) {
    runtimeRef.current.stats.push({ id: arc.connection.from, kind: "out", tone: arc.tone });
  }

  /** The packet landed: ring, sparks and a pop on the marker; under reduced motion only the glow and the counts. */
  function arrive(arc: Arc, reduced: boolean) {
    const run = runtimeRef.current;
    const { connection, tone } = arc;
    const vector = latLonToVector(arc.to.lat, arc.to.lon);
    run.glows.push({ vector, age: 0, tone });
    run.stats.push({ id: connection.to, kind: "in", tone });
    run.arrivals.push(connection.to);
    if (!reduced) {
      run.ripples.push({ vector, age: 0, tone, radius: 0, fade: 1 });
      const point = run.point;
      const { view } = run;
      if (projectLatLonGlobe(view, arc.to.lat, arc.to.lon, point) && point.z > 0.05 && run.ink) {
        // sparks leave away from the globe's centre, so near the limb they fly off the disc
        const angle = Math.atan2(point.y - view.cy, point.x - view.cx);
        run.sparks.add(point.x, point.y + FX_Y, SPARK_COUNT, [toneColor(run.ink, tone), run.hot], {
          angle,
          spread: 1.6,
          speed: [60, 220],
          life: [0.4, 0.9],
        });
      }
      const dot = dotRefs.current.get(connection.to);
      if (dot && point.z >= MARKER_HIDE_Z && typeof dot.animate === "function") {
        dot.animate(POP_KEYFRAMES, { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
    }
    latest.current.onArrive?.(connection);
  }

  function placeMarkers(run: Runtime) {
    const { places: list } = latest.current;
    const point = run.point;
    for (const place of list) {
      const button = markerRefs.current.get(place.id);
      if (!button) continue;
      projectLatLonGlobe(run.view, place.lat, place.lon, point);
      const x = point.x - MARKER_SIZE / 2;
      const y = point.y - MARKER_SIZE / 2;
      // zoomed in, markers fade out at the stage edge with the globe instead of floating past it
      const edge = Math.min(point.x, run.width - point.x, point.y, run.height - point.y);
      const opacity =
        smoothstep(MARKER_HIDE_Z, MARKER_HIDE_Z + 0.12, point.z) * smoothstep(EDGE_FADE * 0.25, EDGE_FADE, edge);
      const last = run.markers.get(place.id);
      const unchanged = last?.element === button && Math.abs(last.x - x) < 0.01 && Math.abs(last.y - y) < 0.01;
      if (unchanged && Math.abs(last.opacity - opacity) < 0.005) continue;
      button.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0)`;
      button.style.opacity = opacity.toFixed(3);
      // back-side markers stay focusable; focusing one turns the globe toward it
      button.style.pointerEvents = opacity > 0 ? "" : "none";
      run.markers.set(place.id, { element: button, x, y, opacity });
    }
  }

  function placeChip(run: Runtime) {
    const chip = chipRef.current;
    if (!chip) return;
    const { chipId: id, placeById: lookup, places: list } = latest.current;
    const place = id !== null ? lookup.get(id) : undefined;
    const point = run.point;
    const front = place ? projectLatLonGlobe(run.view, place.lat, place.lon, point) && point.z >= MARKER_HIDE_Z : false;
    const marker = place ? run.markers.get(place.id) : undefined;
    const shown = Boolean(place) && front && (marker?.opacity ?? 0) > 0.5 && run.chipWidth > 0;
    if (shown !== run.chipShown) {
      run.chipShown = shown;
      chip.style.opacity = shown ? "1" : "0";
    }
    if (!shown || !place) return;
    const anchor = { x: point.x, y: point.y };
    const others: { x: number; y: number }[] = [];
    for (const other of list) {
      if (other.id === place.id) continue;
      const marker = run.markers.get(other.id);
      if (marker && marker.opacity > 0.5) others.push({ x: marker.x + MARKER_SIZE / 2, y: marker.y + MARKER_SIZE / 2 });
    }
    const box = chipBox(run, anchor, others);
    chip.style.transform = `translate3d(${box.x.toFixed(1)}px,${box.y.toFixed(1)}px,0)`;
  }

  function placeRing(run: Runtime) {
    const ring = ringRef.current;
    if (!ring || Math.abs(run.ringRadius - run.view.radius) < 0.25) return;
    run.ringRadius = run.view.radius;
    const size = `${(run.view.radius * 2).toFixed(1)}px`;
    ring.style.width = size;
    ring.style.height = size;
  }

  function focusPlace(place: GlobeLocation) {
    setFocusId(place.id);
    setTabStopId(place.id);
    flyTo(motionRef.current, place);
    loop.kick();
  }

  function handleStageKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const state = motionRef.current;
    const degrees = event.shiftKey ? 30 : 10;
    switch (event.key) {
      case "ArrowLeft":
        nudgeGlobe(state, -degrees, 0);
        break;
      case "ArrowRight":
        nudgeGlobe(state, degrees, 0);
        break;
      case "ArrowUp":
        nudgeGlobe(state, 0, degrees);
        break;
      case "ArrowDown":
        nudgeGlobe(state, 0, -degrees);
        break;
      case "+":
      case "=":
        nudgeGlobe(state, 0, 0, ZOOM_STEP);
        break;
      case "-":
      case "_":
        nudgeGlobe(state, 0, 0, -ZOOM_STEP);
        break;
      case "Home":
        flyTo(state, { lat: centerLat, lon: centerLon }, 1);
        break;
      case "Escape":
        if (selected === null) return;
        setSelected(null);
        break;
      default:
        return;
    }
    event.preventDefault();
    loop.kick();
  }

  function handleMarkerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const direction = ARROW_DIRECTIONS[event.key];
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    // the globe unrolled around the view centre, so the arrows reach locations on the far side too
    const state = motionRef.current;
    const centre = state.target ?? state;
    const points = places.map((place) => ({ x: angleDelta(centre.lon, place.lon), y: -place.lat }));
    const next = spatialNavigate(points, index, direction);
    if (next !== index) markerRefs.current.get(places[next].id)?.focus();
  }

  return (
    <div
      ref={rootRef}
      data-slot="geo-globe"
      className={cn("@container relative w-full max-w-[660px] text-foreground", className)}
      {...props}
    >
      <div
        ref={stageRef}
        role="group"
        aria-roledescription="globe"
        aria-label={`${label}, ${places.length} ${places.length === 1 ? "location" : "locations"}`}
        aria-describedby={hintId}
        tabIndex={0}
        onKeyDown={handleStageKeyDown}
        className="group/globe relative aspect-square outline-none select-none [--globe-cy:50cqw] [--globe-r:38cqw] @[480px]:aspect-[16/11] @[480px]:[--globe-cy:34.375cqw] @[480px]:[--globe-r:26.125cqw]"
      >
        <svg
          ref={placeholderRef}
          aria-hidden="true"
          viewBox="0 0 200 200"
          className="pointer-events-none absolute top-1/2 left-1/2 size-[calc(var(--globe-r)*2)] -translate-x-1/2 -translate-y-1/2 overflow-visible transition-opacity duration-300 motion-reduce:transition-none"
        >
          <circle
            cx="100"
            cy="100"
            r="100"
            className="fill-card stroke-border"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <path d={graticule} fill="none" className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        </svg>
        <canvas
          ref={globeRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 block size-full"
          style={{
            maskImage: EDGE_MASK,
            WebkitMaskImage: EDGE_MASK,
            maskComposite: "intersect",
            WebkitMaskComposite: "source-in",
          }}
        />
        <div
          ref={surfaceRef}
          aria-hidden="true"
          className="absolute inset-0 cursor-grab touch-pan-y [-webkit-tap-highlight-color:transparent] data-[dragging]:cursor-grabbing"
        />
        <canvas
          ref={effectsRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-10 z-[1] block h-[calc(100%+80px)] w-full"
        />
        <div
          ref={ringRef}
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-1/2 size-[calc(var(--globe-r)*2)] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 outline-2 outline-offset-4 outline-lumesec outline-solid group-focus-visible/globe:opacity-100"
        />
        <div className="pointer-events-none absolute inset-0 z-[2]">
          {places.map((place, index) => {
            const placeStats = stats[place.id];
            const tone = placeStats?.tone ?? null;
            const pressed = place.id === selectedPlace?.id;
            return (
              <button
                key={place.id}
                ref={(node) => {
                  if (node) markerRefs.current.set(place.id, node);
                  else markerRefs.current.delete(place.id);
                }}
                type="button"
                tabIndex={place.id === tabStop ? 0 : -1}
                aria-pressed={pressed}
                aria-label={`${place.label}, ${placeStats?.incoming ?? 0} in, ${placeStats?.outgoing ?? 0} out`}
                onClick={() => setSelected((current) => (current === place.id ? null : place.id))}
                onFocus={() => focusPlace(place)}
                onBlur={() => setFocusId((current) => (current === place.id ? null : current))}
                onKeyDown={(event) => handleMarkerKeyDown(event, index)}
                onPointerEnter={() => setHoverId(place.id)}
                onPointerLeave={() => setHoverId((current) => (current === place.id ? null : current))}
                className="group/marker pointer-events-auto absolute top-0 left-0 grid size-6 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 outline-none [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-lumesec focus-visible:outline-solid"
                style={serverMarkers.get(place.id)}
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-[4px] scale-75 rounded-full border border-foreground/30 opacity-0 transition-[opacity,scale,border-color] duration-200 ease-out group-hover/marker:scale-100 group-hover/marker:opacity-100 group-aria-pressed/marker:scale-100 group-aria-pressed/marker:border-lumesec group-aria-pressed/marker:opacity-100 motion-reduce:transition-none"
                />
                <span
                  ref={(node) => {
                    if (node) dotRefs.current.set(place.id, node);
                    else dotRefs.current.delete(place.id);
                  }}
                  aria-hidden="true"
                  className={cn(
                    "relative size-1.5 rounded-full shadow-[0_0_0_1.5px_var(--card)] transition-colors duration-500",
                    tone ? TONE_DOT[tone] : NEUTRAL_DOT,
                    pressed && !tone && "bg-lumesec",
                  )}
                />
              </button>
            );
          })}
        </div>
        <div
          ref={chipRef}
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0 z-[3] flex items-center gap-2 rounded-md border border-border bg-card px-2 py-[5px] text-[12px] leading-4 whitespace-nowrap opacity-0 shadow-[0_8px_20px_-12px_rgb(0_0_0/0.45)] transition-opacity duration-150 motion-reduce:transition-none"
        >
          <span className="font-medium">{chipPlace?.label ?? ""}</span>
          <span className="h-3 w-px bg-border" />
          <span className="flex items-center gap-1 font-mono text-[11.5px] text-muted-foreground tabular-nums">
            In
            <RollText key={`in:${chipId}`} text={String(chipStats.incoming)} className="text-foreground" />
            <span className="px-0.5">·</span>
            Out
            <RollText key={`out:${chipId}`} text={String(chipStats.outgoing)} className="text-foreground" />
          </span>
        </div>
      </div>
      <p id={hintId} className="sr-only">
        Arrow keys turn the globe, plus and minus zoom, Home resets the view. Each location is a button; arrow keys move
        between locations.
      </p>
      <div aria-live="polite" className="sr-only">
        {report}
      </div>
    </div>
  );
}

/* Runtime state ----------------------------------------------------------------------------------------- */

interface LocationStats {
  readonly incoming: number;
  readonly outgoing: number;
  /** Tone of the latest connection that left or reached the location. */
  readonly tone: GlobeTone | null;
}

type StatsMap = Readonly<Record<string, LocationStats>>;

const EMPTY_STATS: StatsMap = {};
const ZERO_STATS: LocationStats = { incoming: 0, outgoing: 0, tone: null };

interface StatEvent {
  id: string;
  kind: "in" | "out";
  tone: GlobeTone;
}

interface Latest {
  selected: string | null;
  chipId: string | null;
  places: readonly GlobeLocation[];
  placeById: ReadonlyMap<string, GlobeLocation>;
  maxArcs: number;
  onArrive: ((connection: GlobeConnection) => void) | undefined;
  demo: boolean;
}

/** A connection in flight: its lifted arc in world space and the screen buffers it is redrawn from every frame. */
interface Arc {
  readonly connection: GlobeConnection;
  readonly tone: GlobeTone;
  readonly to: LatLon;
  readonly demo: boolean;
  /** World xyz per sample, lifted by the arc's altitude. */
  readonly samples: Float32Array;
  /** Seconds to draw (and to erase) the arc: longer for longer arcs. */
  readonly duration: number;
  /** Seconds since departure; negative while waiting its turn in a volley. */
  age: number;
  departed: boolean;
  arrived: boolean;
  /** Reduced motion at departure: the arc shows complete and static, without a packet. */
  still: boolean;
  /** 1 when it touches the selection (or nothing is selected), else 0.15; sprung. */
  readonly emphasis: Spring;
  readonly xs: Float32Array;
  readonly ys: Float32Array;
  readonly zs: Float32Array;
  readonly visible: Uint8Array;
  readonly table: ArcLengthTable;
}

interface Ripple {
  readonly vector: Vec3;
  readonly tone: GlobeTone;
  age: number;
  /** Ring radius in px this frame. */
  radius: number;
  /** Brightness left this frame, 1 to 0. */
  fade: number;
}

interface Glow {
  readonly vector: Vec3;
  readonly tone: GlobeTone;
  age: number;
}

interface MarkerPosition {
  /** The button last written, so a remounted one is placed again. */
  element: HTMLButtonElement;
  x: number;
  y: number;
  opacity: number;
}

/** Shared state of the forEachDot visitor, so drawing an arc allocates nothing. */
interface DotCursor {
  arc: Arc | null;
  batch: DotBatch | null;
  segment: number;
  head: number;
  tail: number;
  flying: boolean;
  emphasis: number;
}

/** Everything the animation loop mutates. Lives in a ref, never in React state. */
interface Runtime {
  view: GlobeView;
  width: number;
  height: number;
  lastLon: number;
  lastLat: number;
  lattice: SphereLattice | null;
  latticeSpacing: number;
  latticePending: number;
  latticeTimer: number;
  ink: GeoInk | null;
  inkStale: boolean;
  hot: RGB;
  discFill: string;
  limb: string;
  coast: string;
  /** Land dots in their resting shade. */
  base: DotBatch | null;
  /** Land dots lit by an arrival: land ink → tone → hot, per tone. */
  lit: Record<GlobeTone, DotBatch> | null;
  /** Arc dots and packets: tone → hot, per tone. */
  trail: Record<GlobeTone, DotBatch> | null;
  arcs: Arc[];
  ripples: Ripple[];
  glows: Glow[];
  sparks: Sparks;
  played: Set<string>;
  playedOrder: string[];
  stats: StatEvent[];
  /** Destination ids since the last live-region report. */
  arrivals: string[];
  random: () => number;
  demoCount: number;
  /** When the last connection was queued (ms) and its place in the current volley. */
  volleyTime: number;
  volleyIndex: number;
  seeded: boolean;
  warned: boolean;
  globeDirty: boolean;
  fxDirty: boolean;
  painted: boolean;
  markers: Map<string, MarkerPosition>;
  chipWidth: number;
  chipHeight: number;
  chipShown: boolean;
  chipSide: LabelPlacement["side"] | null;
  /** Radius the focus ring was last sized to. */
  ringRadius: number;
  point: ScreenPoint;
  cursor: DotCursor;
  visitArcDot: (x: number, y: number, s: number) => void;
  packet: { x: number; y: number; angle: number };
}

function createRuntime(): Runtime {
  const run: Runtime = {
    view: { cx: 0, cy: 0, radius: 0, rotation: new Float64Array(9) },
    width: 0,
    height: 0,
    lastLon: Number.NaN,
    lastLat: Number.NaN,
    lattice: null,
    latticeSpacing: 0,
    latticePending: 0,
    latticeTimer: 0,
    ink: null,
    inkStale: true,
    hot: [255, 255, 255],
    discFill: "",
    limb: "",
    coast: "",
    base: null,
    lit: null,
    trail: null,
    arcs: [],
    ripples: [],
    glows: [],
    sparks: new Sparks(),
    played: new Set(),
    playedOrder: [],
    stats: [],
    arrivals: [],
    random: createRandom("geo-globe"),
    demoCount: 0,
    volleyTime: -Infinity,
    volleyIndex: 0,
    seeded: false,
    warned: false,
    globeDirty: true,
    fxDirty: false,
    painted: false,
    markers: new Map(),
    chipWidth: 0,
    chipHeight: 0,
    chipShown: false,
    chipSide: null,
    ringRadius: 0,
    point: createScreenPoint(),
    cursor: { arc: null, batch: null, segment: 0, head: 0, tail: 0, flying: false, emphasis: 1 },
    visitArcDot: () => {},
    packet: { x: 0, y: 0, angle: 0 },
  };
  run.visitArcDot = (x, y, s) => visitArcDot(run.cursor, x, y, s);
  return run;
}

/* Data ---------------------------------------------------------------------------------------------------- */

const isTone = (tone: unknown): tone is GlobeTone =>
  typeof tone === "string" && (TONES as readonly string[]).includes(tone);

function isConnection(value: GlobeConnection | null | undefined): value is GlobeConnection {
  return (
    Boolean(value) && typeof value?.id === "string" && typeof value.from === "string" && typeof value.to === "string"
  );
}

/** Valid, unique locations with wrapped longitudes. Invalid entries are skipped. */
function normalizeLocations(list: readonly GlobeLocation[]): GlobeLocation[] {
  const seen = new Set<string>();
  const result: GlobeLocation[] = [];
  for (const place of list) {
    if (!place || typeof place.id !== "string" || seen.has(place.id)) continue;
    if (!isValidLatLon(place)) continue;
    seen.add(place.id);
    result.push({
      id: place.id,
      label: String(place.label ?? place.id),
      lat: place.lat,
      lon: wrapLongitude(place.lon),
    });
  }
  return result;
}

/** Server styles for the markers: positions from the starting view in container units, back-side ones hidden. */
function serverMarkerStyles(places: readonly GlobeLocation[], centerLon: number, centerLat: number) {
  const rotation = rotationFromView(centerLon, centerLat);
  const view: GlobeView = { cx: 0, cy: 0, radius: 1, rotation };
  const point = createScreenPoint();
  const styles = new Map<string, React.CSSProperties>();
  for (const place of places) {
    projectLatLonGlobe(view, place.lat, place.lon, point);
    const hidden = point.z < MARKER_HIDE_Z;
    styles.set(place.id, {
      transform: `translate3d(calc(50cqw + ${point.x.toFixed(4)} * var(--globe-r) - ${MARKER_SIZE / 2}px), calc(var(--globe-cy) + ${point.y.toFixed(4)} * var(--globe-r) - ${MARKER_SIZE / 2}px), 0)`,
      opacity: hidden ? 0 : 1,
      pointerEvents: hidden ? "none" : undefined,
    });
  }
  return styles;
}

function warnOnce(run: Runtime, message: string) {
  if (run.warned || process.env.NODE_ENV === "production") return;
  run.warned = true;
  console.warn(message);
}

/** Delay of the next connection: 0, unless others were queued in the same task, then one stagger step more each. */
function volleyDelay(run: Runtime) {
  const now = performance.now();
  run.volleyIndex = now - run.volleyTime < 4 ? run.volleyIndex + 1 : 0;
  run.volleyTime = now;
  return Math.min(run.volleyIndex * STAGGER, MAX_STAGGER);
}

/** Remembers a played id; the oldest of the last 2,000 is forgotten. */
function remember(run: Runtime, id: string) {
  run.played.add(id);
  run.playedOrder.push(id);
  if (run.playedOrder.length > PLAYED_LIMIT) {
    const forgotten = run.playedOrder.splice(0, run.playedOrder.length - PLAYED_LIMIT);
    for (const old of forgotten) run.played.delete(old);
  }
}

/** Adds a connection: an arc while fewer than `maxArcs` are in flight, else straight to the counts. */
function enqueue(
  run: Runtime,
  latest: Latest,
  connection: GlobeConnection,
  options: { delay?: number; progress?: number; demo?: boolean },
) {
  const from = latest.placeById.get(connection.from);
  const to = latest.placeById.get(connection.to);
  remember(run, connection.id);
  if (!from || !to) {
    warnOnce(run, `GeoGlobe: connection "${connection.id}" refers to an unknown location and was skipped.`);
    return;
  }
  const tone = isTone(connection.tone) ? connection.tone : "accent";
  const angle = centralAngle(from, to);
  if (run.arcs.length >= Math.max(0, latest.maxArcs) || angle < 1e-4) {
    run.stats.push({ id: from.id, kind: "out", tone }, { id: to.id, kind: "in", tone });
    latest.onArrive?.(connection);
    return;
  }
  const count = ARC_SEGMENTS + 1;
  const duration = 0.7 + (0.9 * angle) / Math.PI;
  const xs = new Float32Array(count);
  const ys = new Float32Array(count);
  const selected = latest.selected;
  const emphasis = selected === null || connection.from === selected || connection.to === selected ? 1 : 0.15;
  run.arcs.push({
    connection,
    tone,
    to: { lat: to.lat, lon: to.lon },
    demo: options.demo ?? false,
    samples: globeArc(from, to, { segments: ARC_SEGMENTS, lift: arcLift(angle, ARC_LIFT) }),
    duration,
    age: options.progress !== undefined ? options.progress * duration : -(options.delay ?? 0),
    departed: false,
    // seeded demo arcs already past their landing do not land again
    arrived: options.progress !== undefined && options.progress >= 1,
    still: false,
    emphasis: { position: emphasis, velocity: 0 },
    xs,
    ys,
    zs: new Float32Array(count),
    visible: new Uint8Array(count),
    table: buildArcLength(xs, ys, count),
  });
}

/** The next demo connection: two different locations, weighted by the traffic of their cities. */
function nextDemoConnection(run: Runtime, places: readonly GlobeLocation[]): GlobeConnection | null {
  if (places.length < 2) return null;
  const weight = (place: GlobeLocation) => DEMO_WEIGHTS.get(place.id) ?? 0.5;
  const from = pickWeighted(run.random, places, weight);
  let to = pickWeighted(run.random, places, weight);
  for (let attempt = 0; attempt < 6 && to.id === from.id; attempt++) to = pickWeighted(run.random, places, weight);
  if (to.id === from.id) return null;
  return { id: `demo-${run.demoCount++}`, from: from.id, to: to.id };
}

function applyStats(previous: StatsMap, events: readonly StatEvent[]): StatsMap {
  const next: Record<string, LocationStats> = { ...previous };
  for (const event of events) {
    const current = next[event.id] ?? ZERO_STATS;
    next[event.id] = {
      incoming: current.incoming + (event.kind === "in" ? 1 : 0),
      outgoing: current.outgoing + (event.kind === "out" ? 1 : 0),
      tone: event.tone,
    };
  }
  return next;
}

function arrivalReport(arrivals: readonly string[], placeById: ReadonlyMap<string, GlobeLocation>) {
  const tally = new Map<string, number>();
  let top = arrivals[0];
  for (const id of arrivals) {
    const count = (tally.get(id) ?? 0) + 1;
    tally.set(id, count);
    if (count > (tally.get(top) ?? 0)) top = id;
  }
  const count = arrivals.length;
  const name = placeById.get(top)?.label ?? top;
  return `${count} ${count === 1 ? "connection" : "connections"} in the last 10 seconds, most into ${name}`;
}

/* Frame steps --------------------------------------------------------------------------------------------- */

function byTone<T>(make: (tone: GlobeTone) => T): Record<GlobeTone, T> {
  return {
    accent: make("accent"),
    info: make("info"),
    success: make("success"),
    warning: make("warning"),
    destructive: make("destructive"),
  };
}

/** Colours for a theme. The hottest shade is the glint in dark themes and the deep shine in light ones. */
function applyInk(run: Runtime, ink: GeoInk) {
  run.ink = ink;
  run.inkStale = false;
  run.hot = ink.hot;
  run.discFill = rgba(mixRgb(ink.card, ink.foreground, 0.03));
  run.limb = rgba(ink.border);
  run.coast = rgba(ink.coast, 0.16);
  run.base = createDotBatch(8192, [ink.landStrong], { tones: 1, levels: 24 });
  run.lit = byTone((tone) => createDotBatch(512, [ink.landStrong, toneColor(ink, tone), run.hot], { tones: 24 }));
  run.trail = byTone((tone) => createDotBatch(1024, [toneColor(ink, tone), run.hot], { tones: 12 }));
  run.globeDirty = true;
}

function updateView(run: Runtime, motion: GlobeMotion, width: number, height: number) {
  const radius = Math.min(width, height) * RADIUS_SHARE * motion.zoom;
  const view = run.view;
  if (
    motion.lon === run.lastLon &&
    motion.lat === run.lastLat &&
    radius === view.radius &&
    width === run.width &&
    height === run.height
  )
    return;
  rotationFromView(motion.lon, motion.lat, view.rotation);
  view.cx = width / 2;
  view.cy = height / 2;
  view.radius = radius;
  run.width = width;
  run.height = height;
  run.lastLon = motion.lon;
  run.lastLat = motion.lat;
  run.globeDirty = true;
}

/** Lattice spacing for a radius, on an 8 % ladder so zooming back and forth reuses cached lattices. */
function latticeSpacing(radius: number, pitch: number) {
  const exact = spacingForRadius(radius, pitch);
  const step = Math.log(1.08);
  return Math.exp(Math.round(Math.log(exact) / step) * step);
}

/**
 * The land lattice for the current radius. The first one builds at once; later ones (resize, zoom) build after the
 * radius rests for 160 ms, so a pinch never stalls on a rebuild.
 */
function ensureLattice(run: Runtime, pitch: number, rebuilt: () => void) {
  if (run.view.radius <= 0) return;
  const spacing = latticeSpacing(run.view.radius, pitch);
  if (!run.lattice) {
    run.lattice = sphereLattice({ spacingDeg: spacing, method: "rows", landOnly: true });
    run.latticeSpacing = spacing;
    return;
  }
  if (spacing === run.latticeSpacing || spacing === run.latticePending) return;
  run.latticePending = spacing;
  window.clearTimeout(run.latticeTimer);
  run.latticeTimer = window.setTimeout(() => {
    run.lattice = sphereLattice({ spacingDeg: spacing, method: "rows", landOnly: true });
    run.latticeSpacing = spacing;
    run.latticePending = 0;
    run.globeDirty = true;
    rebuilt();
  }, 160);
}

/** Ages the arcs, fires departures and arrivals, springs the emphasis. Returns whether an emphasis still moves. */
function advanceArcs(
  run: Runtime,
  selected: string | null,
  delta: number,
  reduced: boolean,
  arrive: (arc: Arc) => void,
  depart: (arc: Arc) => void,
) {
  let springing = false;
  let write = 0;
  for (const arc of run.arcs) {
    arc.age += delta;
    if (!arc.departed && arc.age >= 0) {
      arc.departed = true;
      arc.still = reduced;
      depart(arc);
    }
    if (arc.departed && !arc.arrived && (arc.still || arc.age >= arc.duration)) {
      arc.arrived = true;
      arrive(arc);
    }
    const { connection, emphasis } = arc;
    const target = selected === null || connection.from === selected || connection.to === selected ? 1 : 0.15;
    if (reduced) {
      emphasis.position = target;
      emphasis.velocity = 0;
    } else if (Math.abs(emphasis.position - target) > 0.001 || Math.abs(emphasis.velocity) > 0.001) {
      springStep(emphasis, target, delta, 260, 0.8);
      springing = true;
    }
    const end = arc.still ? STILL_SECONDS : arc.duration * 2 + ARC_HOLD;
    if (arc.age < end) run.arcs[write++] = arc;
  }
  run.arcs.length = write;

  let glowWrite = 0;
  for (const glow of run.glows) {
    glow.age += delta;
    if (glow.age < GLOW_SECONDS) run.glows[glowWrite++] = glow;
  }
  run.glows.length = glowWrite;
  return springing;
}

function advanceRipples(run: Runtime, delta: number) {
  let write = 0;
  for (const ripple of run.ripples) {
    ripple.age += delta;
    if (ripple.age >= RIPPLE_SECONDS) continue;
    const t = ripple.age / RIPPLE_SECONDS;
    ripple.radius = RIPPLE_REACH * easeOutCubic(t);
    ripple.fade = 1 - t;
    run.ripples[write++] = ripple;
  }
  if (write !== run.ripples.length) run.globeDirty = true;
  run.ripples.length = write;
}

/* Drawing ------------------------------------------------------------------------------------------------- */

/** The globe: atmosphere, disc, land dots (lit around arrivals), coastline and limb. */
function drawGlobe(surface: CanvasSurface, run: Runtime, ink: GeoInk, coastline: boolean) {
  const { context, width, height } = surface;
  const { view, lattice, base, lit } = run;
  const { cx, cy, radius } = view;
  context.clearRect(0, 0, width, height);
  if (radius <= 0) return;

  const atmosphere = context.createRadialGradient(cx, cy, radius * 0.98, cx, cy, radius * 1.1);
  atmosphere.addColorStop(0, rgba(ink.accent, ink.dark ? 0.16 : 0.1));
  atmosphere.addColorStop(1, rgba(ink.accent, 0));
  context.fillStyle = atmosphere;
  context.beginPath();
  context.arc(cx, cy, radius * 1.1, 0, TAU);
  context.fill();

  context.fillStyle = run.discFill;
  context.beginPath();
  context.arc(cx, cy, radius, 0, TAU);
  context.fill();

  if (lattice && base && lit) {
    const m = view.rotation;
    const { xyz, jitter } = lattice;
    const ripples = run.ripples;
    const rippleCount = ripples.length;
    for (let i = 0; i < lattice.count; i++) {
      const x = xyz[i * 3];
      const y = xyz[i * 3 + 1];
      const z = xyz[i * 3 + 2];
      const vz = m[6] * x + m[7] * y + m[8] * z;
      if (vz < LIMB_CUTOFF) continue;
      const sx = cx + (m[0] * x + m[1] * y + m[2] * z) * radius;
      const sy = cy - (m[3] * x + m[4] * y + m[5] * z) * radius;
      const alpha = 0.22 + 0.78 * Math.pow(vz, 0.6);
      let glow = 0;
      let glowTone: GlobeTone = "accent";
      for (let r = 0; r < rippleCount; r++) {
        const ripple = ripples[r];
        const v = ripple.vector;
        const cos = x * v[0] + y * v[1] + z * v[2];
        if (cos < RIPPLE_COS) continue;
        const distance = Math.acos(Math.min(1, cos)) * radius;
        const b = ringFront(distance, ripple.radius, RIPPLE_WIDTH, jitter[i], 5) * ripple.fade;
        if (b > glow) {
          glow = b;
          glowTone = ripple.tone;
        }
      }
      if (glow > 0.03) {
        lit[glowTone].add(sx, sy, LAND_DOT + glow * 0.5, Math.min(1, glow * 1.15), Math.min(1, alpha + 0.8 * glow));
      } else {
        base.add(sx, sy, LAND_DOT, 0, alpha);
      }
    }
    base.flush(context);
    for (const tone of TONES) lit[tone].flush(context);
  }

  if (coastline) {
    context.beginPath();
    traceGlobeCoastlines(context, view);
    context.strokeStyle = run.coast;
    context.lineWidth = 0.75;
    context.stroke();
  }

  context.beginPath();
  context.arc(cx, cy, Math.max(0, radius - 0.5), 0, TAU);
  context.strokeStyle = run.limb;
  context.lineWidth = 1;
  context.stroke();
}

/** Arcs, packets, arrival glows and sparks, on the canvas that reaches past the stage. */
function drawEffects(surface: CanvasSurface, run: Runtime, delta: number) {
  const { context, width, height } = surface;
  const { trail, ink } = run;
  const drawing = run.arcs.some((arc) => arc.departed) || run.glows.length > 0 || run.sparks.active;
  if (!drawing || !trail || !ink) {
    if (run.fxDirty) {
      context.clearRect(0, 0, width, height);
      run.fxDirty = false;
    }
    return;
  }
  run.fxDirty = true;
  context.clearRect(0, 0, width, height);
  const { view, point } = run;

  for (const glow of run.glows) {
    if (!projectGlobeVector(view, glow.vector, point) || point.z < MARKER_HIDE_Z) continue;
    const fade = 1 - glow.age / GLOW_SECONDS;
    const color = toneColor(ink, glow.tone);
    const y = point.y + FX_Y;
    const halo = context.createRadialGradient(point.x, y, 0, point.x, y, 13);
    halo.addColorStop(0, rgba(color, 0.42 * fade * fade));
    halo.addColorStop(1, rgba(color, 0));
    context.fillStyle = halo;
    context.fillRect(point.x - 13, y - 13, 26, 26);
  }

  for (const arc of run.arcs) {
    if (arc.departed) drawArc(run, arc);
  }
  for (const tone of TONES) trail[tone].flush(context);

  run.sparks.step(context, delta);
}

function projectGlobeVector(view: GlobeView, v: Vec3, out: ScreenPoint) {
  const m = view.rotation;
  const x = m[0] * v[0] + m[1] * v[1] + m[2] * v[2];
  const y = m[3] * v[0] + m[4] * v[1] + m[5] * v[2];
  const z = m[6] * v[0] + m[7] * v[1] + m[8] * v[2];
  out.x = view.cx + x * view.radius;
  out.y = view.cy - y * view.radius;
  out.z = z;
  return z > 0;
}

/**
 * One arc: the samples are projected, the hidden ones (behind the globe's disc) break the stroke, and dots sit every
 * 3.5 px of screen length between the erasing tail and the drawing head. The packet rides the head.
 */
function drawArc(run: Runtime, arc: Arc) {
  const { view, cursor, trail } = run;
  if (!trail) return;
  const m = view.rotation;
  const { cx, cy, radius } = view;
  const { samples, xs, ys, zs, visible } = arc;
  const count = xs.length;
  for (let i = 0; i < count; i++) {
    const x = samples[i * 3];
    const y = samples[i * 3 + 1];
    const z = samples[i * 3 + 2];
    const vx = m[0] * x + m[1] * y + m[2] * z;
    const vy = m[3] * x + m[4] * y + m[5] * z;
    const vz = m[6] * x + m[7] * y + m[8] * z;
    xs[i] = cx + vx * radius;
    ys[i] = cy - vy * radius + FX_Y;
    zs[i] = vz;
    visible[i] = isOccluded(vx, vy, vz) ? 0 : 1;
  }
  const table = buildArcLength(xs, ys, count, arc.table);
  const length = table.length;

  let head = 1;
  let tail = 0;
  if (!arc.still) {
    head = ARC_EASE(clamp(arc.age / arc.duration, 0, 1));
    tail = ARC_EASE(clamp((arc.age - arc.duration - ARC_HOLD) / arc.duration, 0, 1));
  }
  if (tail >= 1) return;

  cursor.arc = arc;
  cursor.batch = trail[arc.tone];
  cursor.segment = 0;
  cursor.head = head * length;
  cursor.tail = tail * length;
  cursor.flying = !arc.still && head < 1;
  cursor.emphasis = arc.emphasis.position;
  forEachDot(table, ARC_DOT_SPACING, cursor.tail, cursor.head, run.visitArcDot);

  // the packet: a hot head and eight squares of tail, hidden when another location is selected
  const packet = clamp((arc.emphasis.position - 0.15) / 0.85, 0, 1);
  if (!cursor.flying || packet <= 0.02) return;
  const batch = trail[arc.tone];
  for (let k = 8; k >= 0; k--) {
    const s = cursor.head - k * 3;
    if (s < 0) continue;
    const segment = segmentAt(table, s);
    if (!visible[segment] || !visible[Math.min(count - 1, segment + 1)]) continue;
    pointAtDistance(table, s, run.packet);
    const depth = zs[segment] < 0 ? 0.55 : 1;
    if (k === 0) batch.add(run.packet.x, run.packet.y, 2.5, 1, packet * depth);
    else
      batch.add(run.packet.x, run.packet.y, k < 3 ? 2 : 1.5, 0.85 - k * 0.08, (0.9 - (k - 1) * 0.1) * packet * depth);
  }
}

/** forEachDot visitor for the arc in `cursor`: skips hidden stretches, brightens toward the head. */
function visitArcDot(cursor: DotCursor, x: number, y: number, s: number) {
  const arc = cursor.arc;
  const batch = cursor.batch;
  if (!arc || !batch) return;
  const { table, visible, zs } = arc;
  const last = table.count - 1;
  while (cursor.segment < last - 1 && table.distances[cursor.segment + 1] < s) cursor.segment++;
  const j = cursor.segment;
  if (!visible[j] || !visible[Math.min(last, j + 1)]) return;
  const depth = zs[j] < 0 ? 0.45 : 1;
  const nearHead = cursor.flying ? smoothstep(cursor.head - 30, cursor.head, s) : 0;
  const tailFade = cursor.tail > 0 ? smoothstep(cursor.tail, cursor.tail + 14, s) : 1;
  const alpha = (ARC_ALPHA + 0.4 * nearHead) * cursor.emphasis * depth * tailFade;
  batch.add(x, y, LAND_DOT, nearHead * 0.55, alpha);
}

/** Index of the table segment that holds distance `s` (binary search). */
function segmentAt(table: ArcLengthTable, s: number) {
  let low = 0;
  let high = Math.max(0, table.count - 2);
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (table.distances[middle] <= s) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** Top-left of the chip: it keeps its side while that side fits, else placeLabels picks a new one. */
function chipBox(run: Runtime, anchor: { x: number; y: number }, others: readonly { x: number; y: number }[]) {
  const width = run.chipWidth;
  const height = run.chipHeight;
  const gap = 12;
  const boxFor = (side: LabelPlacement["side"]) => ({
    x: side === "right" ? anchor.x + gap : side === "left" ? anchor.x - gap - width : anchor.x - width / 2,
    y: side === "top" ? anchor.y - gap - height : side === "bottom" ? anchor.y + gap : anchor.y - height / 2,
  });
  const fits = (box: { x: number; y: number }) =>
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + width <= run.width &&
    box.y + height <= run.height &&
    others.every((p) => p.x <= box.x - 4 || p.x >= box.x + width + 4 || p.y <= box.y - 4 || p.y >= box.y + height + 4);
  if (run.chipSide) {
    const box = boxFor(run.chipSide);
    if (fits(box)) return box;
  }
  const anchors: LabelAnchor[] = [
    { x: anchor.x, y: anchor.y, width, height, priority: 1, gap },
    ...others.map((p) => ({ x: p.x, y: p.y, width: 0, height: 0, priority: 0 })),
  ];
  const [placement] = placeLabels(anchors, run.width, run.height);
  run.chipSide = placement.visible ? placement.side : "right";
  const box = boxFor(run.chipSide);
  return {
    x: clamp(box.x, 0, Math.max(0, run.width - width)),
    y: clamp(box.y, 0, Math.max(0, run.height - height)),
  };
}
