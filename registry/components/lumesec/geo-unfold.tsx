"use client";

import * as React from "react";

import { snapCenter, useCanvas, type CanvasSurface } from "@/lib/lumesec/canvas";
import { usePalette } from "@/lib/lumesec/color";
import {
  arcLift,
  buildArcLength,
  centralAngle,
  createDotBatch,
  createGlobeMotion,
  createProjection,
  createScreenPoint,
  DEG,
  flatCurve,
  flyTo,
  forEachDot,
  GEO_TOKENS,
  geoInk,
  globeArc,
  isOccluded,
  nudgeGlobe,
  projectionOutlineSvgPath,
  quadPoint,
  rotationFromView,
  sphereLattice,
  stepGlobeMotion,
  useGlobeDrag,
  wrapLongitude,
  type ArcLengthTable,
  type DotBatch,
  type GeoInk,
  type GeoPalette,
  type GlobeMotion,
  type LatLon,
  type MapProjection,
  type QuadCurve,
  type SphereLattice,
} from "@/lib/lumesec/geo";
import { findRegion } from "@/lib/lumesec/geo-data";
import { clamp, lerp, rgba, smoothstep, TAU, type RGB } from "@/lib/lumesec/math";
import { prefersReducedMotion, springStep, useAnimationLoop, useLazyRef } from "@/lib/lumesec/motion";
import { Sparks } from "@/lib/lumesec/sparks";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** The two views: the dotted globe, or the same dots laid out as a flat map. */
export type UnfoldView = "globe" | "map";

/** Projections the map view can use. Both show the whole world, cut at the back of the globe. */
export type UnfoldProjection = "equalEarth" | "equirectangular";

/** A route between two places, drawn in both views. */
export interface UnfoldRoute {
  /** Where the route starts; packets leave from here. */
  from: LatLon;
  /** Where the route ends; packets arrive here. */
  to: LatLon;
  /** Traffic share from 0 to 1 (default 0.5). Packets leave at 0.4 + 1.2 × weight per second. */
  weight?: number;
}

/** Props of GeoUnfold. Other `div` props go to the root element. */
export interface GeoUnfoldProps extends Omit<React.ComponentProps<"div">, "title"> {
  /** The shown view (controlled). Use with `onViewChange`. */
  view?: UnfoldView;
  /** The view when uncontrolled. */
  defaultView?: UnfoldView;
  /** Called when the toggle changes the view. A controlled `view` that changes from outside does not call it. */
  onViewChange?: (view: UnfoldView) => void;
  /**
   * Routes shown in both views. Without it the component shows 8 demo routes between cloud regions; an empty array
   * shows the land with no routes.
   */
  routes?: readonly UnfoldRoute[];
  /**
   * Initial globe centre, and where Home turns the globe back to. The map is centred on the longitude the globe faces
   * when it opens, so it is cut at the back of the globe.
   */
  center?: LatLon;
  /** Projection of the map view. */
  projection?: UnfoldProjection;
  /** Length of the globe-to-map morph in milliseconds. Values below 300 count as 300. */
  duration?: number;
  /** Shows the Globe / Map toggle. Hide it to drive `view` from outside. */
  showToggle?: boolean;
  /** Runs packets along the routes. */
  packets?: boolean;
  /** Heading shown left of the toggle. */
  title?: React.ReactNode;
}

const DEFAULT_CENTER: LatLon = { lat: 20, lon: 10 };

/**
 * One set of land dots that is either a globe or a flat map. Switching to the map peels the globe open at the back:
 * the dots next to the seam swing out first, the hidden side turns toward you as it comes around the edge, and the
 * rest follows on springs with a slight overshoot. When the cut edges land, light runs along them and sparks fly off.
 * Routes bend from lifted arcs on the globe to flat curves on the map, with packets running along them in both views.
 * Drag the globe (or use the arrow keys) to move the seam before switching.
 *
 * @example
 * <GeoUnfold title="Traffic between regions" routes={[{ from: { lat: 50.1, lon: 8.7 }, to: { lat: 39, lon: -77.5 } }]} />
 */
export function GeoUnfold({
  view: viewProp,
  defaultView = "globe",
  onViewChange,
  routes,
  center = DEFAULT_CENTER,
  projection = "equalEarth",
  duration = 1100,
  showToggle = true,
  packets = true,
  title,
  className,
  ...props
}: GeoUnfoldProps) {
  const [view, setView] = useControllableState<UnfoldView>({
    value: viewProp,
    defaultValue: defaultView,
    onChange: onViewChange,
  });
  const routeKey = routesKey(routes);
  const routeCount = routes === undefined ? DEMO_ROUTES.length : normalizeRoutes(routes).length;

  const stageRef = React.useRef<HTMLDivElement>(null);
  const mainRef = React.useRef<HTMLCanvasElement>(null);
  const effectsRef = React.useRef<HTMLCanvasElement>(null);
  const motionRef = useLazyRef(() => createGlobeMotion({ lon: center.lon, lat: center.lat, latLimit: 70 }));
  /** The morph engine, created on first use. It starts from the first render's view, centre and projection. */
  const engineRef = useLazyRef(() => createEngine(view === "map" ? 1 : 0, center, projection));
  const routesRef = React.useRef(routes);
  const settings = React.useRef({ duration, packets, center });

  const loop = useAnimationLoop(stageRef, step);
  const palette = usePalette(stageRef, GEO_TOKENS, () => loop.kick());

  React.useEffect(() => {
    routesRef.current = routes;
    settings.current = { duration, packets, center };
  });

  // New routes rebuild their geometry; packets on the old routes are dropped.
  React.useEffect(() => {
    const engine = engineRef.current;
    engine.input = normalizeRoutes(routesRef.current ?? DEMO_ROUTES);
    engine.packets = [];
    engine.pulses = [];
    engine.warmed = false;
    rebuild(engine);
    loop.kick();
  }, [routeKey, engineRef, loop]);

  React.useEffect(() => {
    const engine = engineRef.current;
    if (engine.kind === projection) return;
    engine.kind = projection;
    rebuild(engine);
    loop.kick();
  }, [projection, engineRef, loop]);

  React.useEffect(() => {
    if (!packets) engineRef.current.packets = [];
    loop.kick();
  }, [packets, engineRef, loop]);

  // The view changed (toggle or controlled prop): run the morph toward it, continuing from the current progress.
  React.useEffect(() => {
    const engine = engineRef.current;
    const target = view === "map" ? 1 : 0;
    if (engine.target === target) return;
    if (target === 1 && engine.P <= 0 && engine.settled) {
      // cut the map at the back of the globe as it faces now
      const state = motionRef.current;
      state.target = null;
      state.velocityLon = 0;
      state.velocityLat = 0;
      engine.meridian = state.lon;
      engine.tilt = state.lat;
      rebuild(engine);
    }
    engine.target = target;
    loop.kick();
  }, [view, engineRef, motionRef, loop]);

  const main = useCanvas(
    mainRef,
    (surface) => {
      const engine = engineRef.current;
      engine.width = surface.width;
      engine.height = surface.height;
      engine.dpr = surface.dpr;
      rebuild(engine);
      loop.kick();
    },
    CANVAS_OPTIONS,
  );
  const effects = useCanvas(effectsRef, () => loop.kick(), CANVAS_OPTIONS);

  useGlobeDrag(stageRef, motionRef, {
    radius: () => engineRef.current.radius,
    onChange: () => loop.kick(),
    axis: "x",
    disabled: view !== "globe",
  });

  function step(_time: number, delta: number) {
    const engine = engineRef.current;
    const state = motionRef.current;
    const surface = main.current;
    const colors = palette.current;
    if (!surface || !colors || !engine.dots) return false;
    if (colors !== engine.palette) applyPalette(engine, colors);
    const reduced = prefersReducedMotion();
    const { duration: ms, packets: packetsOn } = settings.current;
    let active = false;

    // Two clocks: P runs over the whole duration (hairlines, sparks, seam copies); T releases the dots over its first
    // third, seam first on the way out and middle first on the way back. Each dot then springs to its view.
    const before = engine.P;
    const seconds = reduced ? CROSSFADE_SECONDS : Math.max(MIN_SECONDS, ms / 1000);
    if (engine.P !== engine.target || engine.T !== engine.target) {
      engine.P = approach(engine.P, engine.target, delta / seconds);
      engine.T = approach(engine.T, engine.target, delta / (reduced ? seconds : seconds * RELEASE_SHARE));
      engine.crossfade = reduced;
      engine.dirty = true;
      active = true;
    }
    if ((active || !engine.settled) && advanceSprings(engine, delta, seconds, reduced)) active = true;

    if (engine.P > 0 || engine.target > 0 || !engine.settled) {
      // the globe holds still while it is open: the morph and the map are cut at this meridian
      state.lon = engine.meridian;
      state.lat = engine.tilt;
      state.target = null;
      state.velocityLon = 0;
      state.velocityLat = 0;
    } else if (stepGlobeMotion(state, delta, reduced)) {
      active = true;
    }
    if (state.lon !== engine.drawnLon || state.lat !== engine.drawnLat) engine.dirty = true;

    // seam copies of routes appear once the map has settled and leave first when it folds
    const copyGoal = engine.P >= 1 ? 1 : 0;
    if (engine.copyAlpha !== copyGoal) {
      engine.copyAlpha = reduced ? copyGoal : approach(engine.copyAlpha, copyGoal, delta / COPY_FADE_SECONDS);
      engine.dirty = true;
      active = true;
    }

    const fx = effects.current;
    if (fx && !reduced && engine.target === 1 && before < SPARK_AT && engine.P >= SPARK_AT) emitSeamSparks(engine);

    if (engine.dirty) {
      drawMain(engine, surface, state);
      engine.dirty = false;
      engine.drawnLon = state.lon;
      engine.drawnLat = state.lat;
    }
    const effectsAlive = fx ? drawEffects(engine, fx, delta, packetsOn && !reduced) : false;
    return active || effectsAlive;
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const engine = engineRef.current;
    if (view !== "globe" || engine.P > 0 || engine.target > 0 || !engine.settled) return;
    const state = motionRef.current;
    if (event.key === "ArrowLeft") nudgeGlobe(state, 10, 0);
    else if (event.key === "ArrowRight") nudgeGlobe(state, -10, 0);
    else if (event.key === "Home") flyTo(state, settings.current.center);
    else return;
    event.preventDefault();
    loop.kick();
  }

  const routeText = routeCount === 0 ? "no routes" : routeCount === 1 ? "1 route" : `${routeCount} routes`;
  const showHeader = title != null || showToggle || routeCount === 0;

  return (
    <div
      data-slot="geo-unfold"
      data-view={view}
      className={cn("grid w-full max-w-[660px] gap-3", className)}
      {...props}
    >
      {showHeader && (
        <div className="flex min-h-7 items-center gap-3">
          {title != null && (
            <div className="min-w-0 truncate text-[13.5px] leading-5 font-medium text-foreground">{title}</div>
          )}
          {routeCount === 0 && <span className="text-[12px] leading-5 text-muted-foreground">No routes</span>}
          {showToggle && <ViewToggle view={view} onSelect={setView} className="ml-auto" />}
        </div>
      )}
      <div
        ref={stageRef}
        role="img"
        aria-label={view === "globe" ? `Globe with ${routeText}. Arrow keys turn the globe.` : `Map with ${routeText}.`}
        aria-keyshortcuts={view === "globe" ? "ArrowLeft ArrowRight Home" : undefined}
        tabIndex={view === "globe" ? 0 : undefined}
        data-view={view}
        onKeyDown={handleKeyDown}
        className="relative aspect-[2/1] w-full touch-pan-y rounded-xl outline-none select-none [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid data-[view=globe]:cursor-grab data-[view=globe]:active:cursor-grabbing data-[view=map]:touch-auto"
      >
        <canvas ref={mainRef} aria-hidden="true" className="absolute inset-0 block size-full" />
        <canvas
          ref={effectsRef}
          aria-hidden="true"
          className="pointer-events-none absolute -top-6 -left-4 block h-[calc(100%+48px)] w-[calc(100%+32px)]"
        />
      </div>
    </div>
  );
}

/* View toggle ---------------------------------------------------------------------------------------- */

const VIEWS: readonly UnfoldView[] = ["globe", "map"];
const VIEW_LABELS: Record<UnfoldView, string> = { globe: "Globe", map: "Map" };

/** Two radio buttons on a muted track; the card-coloured pill slides between them on an under-damped spring. */
function ViewToggle({
  view,
  onSelect,
  className,
}: {
  view: UnfoldView;
  onSelect: (view: UnfoldView) => void;
  className?: string;
}) {
  const index = Math.max(0, VIEWS.indexOf(view));
  const groupRef = React.useRef<HTMLDivElement>(null);
  const pillRef = React.useRef<HTMLSpanElement>(null);
  const buttons = React.useRef<(HTMLButtonElement | null)[]>([]);
  const spring = React.useRef({ position: index, velocity: 0, target: index });
  // The server markup places the pill; the loop moves it from there.
  const [origin] = React.useState(index);

  const loop = useAnimationLoop(groupRef, (_time, delta) => {
    const state = spring.current;
    if (prefersReducedMotion()) {
      state.position = state.target;
      state.velocity = 0;
    } else {
      springStep(state, state.target, delta, 520, 0.72);
    }
    const pill = pillRef.current;
    if (pill) pill.style.transform = `translateX(${(clamp(state.position, -0.1, 1.1) * 100).toFixed(2)}%)`;
    return Math.abs(state.position - state.target) > 0.0005 || Math.abs(state.velocity) > 0.001;
  });

  React.useEffect(() => {
    spring.current.target = index;
    loop.kick();
  }, [index, loop]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const offset =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!offset) return;
    event.preventDefault();
    const next = (index + offset + VIEWS.length) % VIEWS.length;
    onSelect(VIEWS[next]);
    buttons.current[next]?.focus();
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label="View"
      className={cn(
        "relative grid h-7 shrink-0 grid-cols-2 rounded-[9px] bg-muted p-[3px] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_6%,transparent)]",
        className,
      )}
    >
      <span
        ref={pillRef}
        aria-hidden="true"
        className="absolute top-[3px] bottom-[3px] left-[3px] w-[calc(50%-3px)] rounded-[6px] bg-card shadow-[0_1px_2px_rgba(0,0,0,.14),0_0_0_.5px_color-mix(in_srgb,var(--foreground)_12%,transparent)] will-change-transform"
        style={{ transform: `translateX(${origin * 100}%)` }}
      />
      {VIEWS.map((option, i) => (
        <button
          key={option}
          ref={(node) => {
            buttons.current[i] = node;
          }}
          type="button"
          role="radio"
          aria-checked={i === index}
          tabIndex={i === index ? 0 : -1}
          data-state={i === index ? "checked" : "unchecked"}
          onClick={() => onSelect(option)}
          onKeyDown={handleKeyDown}
          className="relative z-[1] inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[6px] border-0 bg-transparent px-2.5 font-[inherit] text-[12px] leading-none font-medium whitespace-nowrap text-muted-foreground outline-none select-none [transition:color_.2s_ease] hover:text-[color-mix(in_srgb,var(--foreground)_75%,var(--muted-foreground))] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-lumesec focus-visible:outline-solid data-[state=checked]:text-foreground"
        >
          {option === "globe" ? <GlobeIcon /> : <MapIcon />}
          {VIEW_LABELS[option]}
        </button>
      ))}
    </div>
  );
}

function GlobeIcon() {
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.15}
      aria-hidden="true"
      className="size-3.5 shrink-0"
    >
      <circle cx="7" cy="7" r="5.4" />
      <ellipse cx="7" cy="7" rx="2.3" ry="5.4" />
      <path d="M1.8 7h10.4" />
    </svg>
  );
}

function MapIcon() {
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.15}
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-3.5 shrink-0"
    >
      <path d="M3.4 3.2h7.2c1.5 0 2.2 1.7 2.2 3.8s-.7 3.8-2.2 3.8H3.4C1.9 10.8 1.2 9.1 1.2 7s.7-3.8 2.2-3.8Z" />
      <path d="M1.4 7h11.2M7 3.2v7.6" />
    </svg>
  );
}

/* Constants ------------------------------------------------------------------------------------------- */

const CANVAS_OPTIONS = { maxDpr: 2 };
/** Globe radius as a share of the stage height. */
const GLOBE_SCALE = 0.46;
/** Inner padding of the fitted map in px. */
const MAP_PADDING = 12;
/** Target distance between land dots on the map, in px. */
const DOT_PITCH = 3.5;
const DOT_SIZE = 1.5;
/** Base opacity of a land dot facing the viewer. */
const LAND_ALPHA = 0.82;
/** Extra opacity and tint toward the soft accent while a dot moves fast: the moving front reads as light. */
const FLIGHT_BOOST = 0.24;
const FLIGHT_TINT = 0.85;
/** Share of the duration over which the release clock lets the dots go, seam first. */
const RELEASE_SHARE = 0.32;
/** Release order: distance from the seam, plus a smooth wave and a little grain for an uneven front. */
const RELEASE_JITTER = 0.18;
const RELEASE_GRAIN = 0.05;
/**
 * Each dot springs to its view. At the default 1100 ms the natural frequency is 7.6 rad/s (scaled with `duration`) at
 * a damping ratio of 0.68: about 5 % overshoot, landing roughly when the duration ends.
 */
const SPRING_OMEGA = 7.6;
const SPRING_DAMPING = 0.68;
const DEFAULT_SECONDS = 1.1;
/** Shortest morph the springs follow stably. */
const MIN_SECONDS = 0.3;
/** Peak speed of a released dot as a share of the natural frequency, for the launch glow. */
const PEAK_SPEED = 0.466;
/** How far the overshoot pushes a landed dot away from the map centre, per unit of overshoot. */
const OVERSHOOT_GAIN = 0.7;
/** Route geometry: samples per route (48 segments), flat-map bend and globe arc height. */
const SEGMENTS = 48;
const SAMPLES = SEGMENTS + 1;
const ROUTE_BEND = 0.18;
const ROUTE_LIFT = 0.8;
const ROUTE_SPACING = 3.5;
const ROUTE_DOT = 1.5;
const ROUTE_ALPHA = 0.55;
/** Packets: px per second, tail squares and their spacing, and a cap on how many run at once. */
const PACKET_SPEED = 70;
const PACKET_TAIL = 5;
const PACKET_GAP = 2.6;
const MAX_PACKETS = 48;
const PULSE_SECONDS = 0.65;
const COPY_FADE_SECONDS = 0.15;
const CROSSFADE_SECONDS = 0.15;
/** Morph progress at which the map edges land and throw sparks. */
const SPARK_AT = 0.5;
/** How long the light runs along the landed seam, and how long it takes to reach the poles. */
const SEAM_SECONDS = 0.85;
const SEAM_TRAVEL = 0.45;
/** How far the effects canvas reaches past the stage. */
const FX_X = 16;
const FX_Y = 24;

/* Demo routes ---------------------------------------------------------------------------------------- */

const DEMO_PAIRS: readonly (readonly [string, string, number])[] = [
  ["eu-central", "us-east", 1],
  ["eu-west", "sa-east", 0.45],
  ["eu-central", "ap-south", 0.7],
  ["me-central", "ap-southeast", 0.55],
  ["ap-southeast", "au-east", 0.5],
  ["ap-northeast", "us-west", 0.9],
  ["au-east", "us-west", 0.35],
  ["af-south", "eu-central", 0.4],
];

/** Eight routes between demo cloud regions, used while `routes` is undefined. Two of them cross the Pacific. */
const DEMO_ROUTES: readonly UnfoldRoute[] = DEMO_PAIRS.flatMap(([fromId, toId, weight]) => {
  const from = findRegion(fromId);
  const to = findRegion(toId);
  return from && to ? [{ from: { lat: from.lat, lon: from.lon }, to: { lat: to.lat, lon: to.lon }, weight }] : [];
});

interface RouteInput {
  from: LatLon;
  to: LatLon;
  weight: number;
}

const validPoint = (point: LatLon | undefined) => !!point && Number.isFinite(point.lat) && Number.isFinite(point.lon);

/** Valid routes with clamped coordinates and weights; entries with missing or non-finite points are skipped. */
function normalizeRoutes(routes: readonly UnfoldRoute[]): RouteInput[] {
  const list: RouteInput[] = [];
  for (const route of routes) {
    if (!route || !validPoint(route.from) || !validPoint(route.to)) continue;
    const weight = route.weight;
    list.push({
      from: { lat: clamp(route.from.lat, -89.9, 89.9), lon: wrapLongitude(route.from.lon) },
      to: { lat: clamp(route.to.lat, -89.9, 89.9), lon: wrapLongitude(route.to.lon) },
      weight: typeof weight === "number" && Number.isFinite(weight) ? clamp(weight, 0, 1) : 0.5,
    });
  }
  return list;
}

/** A string that changes only when the route data changes, so inline arrays do not rebuild every render. */
function routesKey(routes: readonly UnfoldRoute[] | undefined) {
  if (routes === undefined) return "demo";
  return routes
    .map((route) => `${route?.from?.lat},${route?.from?.lon},${route?.to?.lat},${route?.to?.lon},${route?.weight}`)
    .join(";");
}

/* Engine --------------------------------------------------------------------------------------------- */

/** Per-dot data of the land lattice, rebuilt when the lattice or the cut meridian changes. */
interface LandDots {
  count: number;
  xyz: Float32Array;
  phi: Float32Array;
  sinPhi: Float32Array;
  cosPhi: Float32Array;
  /** Longitude east of the cut meridian, in radians, within ±π. */
  rho: Float32Array;
  mapX: Float32Array;
  mapY: Float32Array;
  springs: SpringSet;
}

/** Morph springs of a set of points: progress (0 globe, 1 map), velocity, and when the release clock lets each go. */
interface SpringSet {
  count: number;
  e: Float32Array;
  v: Float32Array;
  /** Release threshold in (0, 1): seam points have the lowest, so they leave first and come back last. */
  threshold: Float32Array;
}

/** A route's samples in both views plus the blended polyline the packets run on. */
interface RouteGeometry {
  weight: number;
  fromPlace: number;
  toPlace: number;
  /** Lifted globe arc in world space, xyz per sample. */
  world: Float32Array;
  lift: Float32Array;
  phi: Float32Array;
  sinPhi: Float32Array;
  cosPhi: Float32Array;
  /** Longitude east of the cut meridian in radians, unwrapped along the route so it stays continuous. */
  rho: Float32Array;
  springs: SpringSet;
  /** 1 where the lifted arc is hidden behind the globe facing the cut meridian. */
  occluded: Uint8Array;
  mapX: Float32Array;
  mapY: Float32Array;
  /** The route again, shifted by ∓360°, for routes that leave the map across the seam. */
  copies: ArcLengthTable[];
  /** The current polyline, its visibility and its map weight per sample. */
  xs: Float32Array;
  ys: Float32Array;
  vis: Float32Array;
  ease: Float32Array;
  table: ArcLengthTable;
}

/** A route end, drawn as a marker and used for arrival pulses. */
interface Place {
  x0: number;
  y0: number;
  z0: number;
  phi: number;
  sinPhi: number;
  cosPhi: number;
  rho: number;
  mapX: number;
  mapY: number;
  /** Current position and visibility, updated with every redraw. */
  x: number;
  y: number;
  vis: number;
}

interface Packet {
  route: number;
  /** Distance travelled along the route in px. */
  s: number;
}

interface Pulse {
  place: number;
  age: number;
}

/** Everything the frame loop mutates. Lives in a ref, never in React state. */
interface Engine {
  kind: UnfoldProjection;
  input: readonly RouteInput[];
  width: number;
  height: number;
  dpr: number;
  cx: number;
  cy: number;
  radius: number;
  /** px per radian of longitude on the map's equator: the scale the unrolled globe ends at. */
  mapScale: number;
  projection: MapProjection | null;
  outline: Path2D | null;
  /** The longitude the map is centred on: the globe's centre when it was opened. */
  meridian: number;
  /** The globe's centre latitude when it was opened, in degrees. */
  tilt: number;
  lattice: SphereLattice | null;
  dots: LandDots | null;
  routes: RouteGeometry[];
  places: Place[];
  /** Morph springs of the places, in the order of `places`. */
  placeSprings: SpringSet;
  /** The map's left and right edges, where the cut seam lands, as polylines from the south to the north pole. */
  seam: Seam | null;
  /** Seconds since the seam landed, or −1. */
  seamAge: number;
  /** Morph clock over the whole duration: 0 globe, 1 map. Drives the hairlines, the seam sparks and the copies. */
  P: number;
  /** Release clock: runs over the first third of the duration and lets the dots go. */
  T: number;
  target: number;
  /** Whether every spring rests at its goal. */
  settled: boolean;
  /** Natural frequency of the springs in rad/s, for the launch glow. */
  omega: number;
  /** Reduced motion swaps the views with a crossfade instead of the morph. */
  crossfade: boolean;
  copyAlpha: number;
  dirty: boolean;
  drawnLon: number;
  drawnLat: number;
  rotation: Float64Array;
  palette: GeoPalette | null;
  ink: GeoInk | null;
  landBatch: DotBatch | null;
  routeBatch: DotBatch | null;
  packets: Packet[];
  pulses: Pulse[];
  sparks: Sparks | null;
  /** Whether packets have been seeded along the routes since they were built. */
  warmed: boolean;
  fxDirty: boolean;
}

function createEngine(T: number, center: LatLon, kind: UnfoldProjection): Engine {
  return {
    kind,
    input: [],
    width: 0,
    height: 0,
    dpr: 1,
    cx: 0,
    cy: 0,
    radius: 0,
    mapScale: 1,
    projection: null,
    outline: null,
    meridian: wrapLongitude(center.lon),
    tilt: clamp(center.lat, -70, 70),
    lattice: null,
    dots: null,
    routes: [],
    places: [],
    placeSprings: createSprings(0, T),
    seam: null,
    seamAge: -1,
    P: T,
    T,
    target: T,
    settled: true,
    omega: SPRING_OMEGA,
    crossfade: false,
    copyAlpha: T,
    dirty: true,
    drawnLon: Number.NaN,
    drawnLat: Number.NaN,
    rotation: new Float64Array(9),
    palette: null,
    ink: null,
    landBatch: null,
    routeBatch: null,
    packets: [],
    pulses: [],
    sparks: null,
    warmed: false,
    fxDirty: false,
  };
}

const approach = (value: number, goal: number, amount: number) =>
  value < goal ? Math.min(goal, value + amount) : Math.max(goal, value - amount);

const wrapRadians = (angle: number) => angle - TAU * Math.round(angle / TAU);

/**
 * Release threshold of a point. Seam points (|ρ| near π) go first when the globe opens and come back last when it
 * closes, so the middle folds first. The front is uneven but coherent: a smooth wave over latitude and longitude reads
 * as a ragged edge while continents keep their shape in flight, plus a little per-dot grain.
 */
function releaseAt(phi: number, rho: number, grain: number) {
  const wrapped = wrapRadians(rho);
  const wave =
    0.5 + 0.28 * Math.sin(phi * 4.1 + wrapped * 1.3 + 0.7) + 0.22 * Math.sin(phi * 7.3 - wrapped * 2.2 + 2.1);
  const order =
    (1 - Math.abs(wrapped) / Math.PI) * (1 - RELEASE_JITTER) + wave * RELEASE_JITTER + (grain - 0.5) * RELEASE_GRAIN;
  // strictly inside (0, 1): nothing moves at rest and everything has gone when the clock ends
  return 0.005 + 0.99 * clamp(order, 0, 1);
}

/** Springs for `count` points, all resting at `value`. */
function createSprings(count: number, value: number): SpringSet {
  return {
    count,
    e: new Float32Array(count).fill(value),
    v: new Float32Array(count),
    threshold: new Float32Array(count),
  };
}

/**
 * Steps every spring toward its goal: 1 once the release clock has passed its threshold, else 0. Reversing the clock
 * keeps positions and velocities, so a morph can turn around at any point. Returns whether anything still moves.
 */
function advanceSprings(engine: Engine, delta: number, seconds: number, reduced: boolean) {
  const omega = (SPRING_OMEGA * DEFAULT_SECONDS) / Math.max(MIN_SECONDS, seconds);
  const stiffness = omega * omega;
  const damping = 2 * omega * SPRING_DAMPING;
  const clock = engine.T;
  const half = delta / 2;
  let moving = false;
  const advance = (set: SpringSet) => {
    const { e, v, threshold } = set;
    for (let i = 0; i < set.count; i++) {
      const goal = clock > threshold[i] ? 1 : 0;
      let position = e[i];
      let velocity = v[i];
      if (reduced) {
        position = goal;
        velocity = 0;
      } else {
        // two half steps of the semi-implicit integrator, like springStep
        for (let h = 0; h < 2; h++) {
          velocity += (stiffness * (goal - position) - damping * velocity) * half;
          position += velocity * half;
        }
        if (Math.abs(goal - position) < 1e-3 && Math.abs(velocity) < 1e-2) {
          position = goal;
          velocity = 0;
        } else {
          moving = true;
        }
      }
      e[i] = position;
      v[i] = velocity;
    }
  };
  if (engine.dots) advance(engine.dots.springs);
  for (const route of engine.routes) advance(route.springs);
  advance(engine.placeSprings);
  engine.omega = omega;
  engine.settled = !moving;
  if (moving) engine.dirty = true;
  return moving;
}

/**
 * Glow of a moving dot, from its speed: released dots are fastest just after they leave, so the lit dots form a band
 * that travels from the seam to the middle instead of tinting the whole map.
 */
const launchGlow = (velocity: number, omega: number) => smoothstep(0.45, 1, Math.abs(velocity) / (PEAK_SPEED * omega));

/** Globe dots dim toward the limb, so the sphere reads round. */
const depthShade = (depth: number) => 0.42 + 0.58 * smoothstep(0, 0.8, depth);

function applyPalette(engine: Engine, palette: GeoPalette) {
  const ink = geoInk(palette);
  engine.palette = palette;
  engine.ink = ink;
  engine.landBatch?.setRamp([ink.landStrong, ink.soft]);
  engine.routeBatch?.setRamp([ink.accent, ink.soft]);
  engine.dirty = true;
}

const scratchPoint = createScreenPoint();
const curveScratch: QuadCurve = { x0: 0, y0: 0, cx: 0, cy: 0, x1: 0, y1: 0 };
const pointScratch = { x: 0, y: 0 };

/** Rebuilds the projection, the lattice and every per-dot, per-route and per-place array for the current layout. */
function rebuild(engine: Engine) {
  const { width, height } = engine;
  if (!width || !height) return;
  engine.cx = width / 2;
  engine.cy = height / 2;
  engine.radius = height * GLOBE_SCALE;
  const projection = createProjection(engine.kind, {
    width,
    height,
    padding: MAP_PADDING,
    center: { lat: 0, lon: engine.meridian },
  });
  engine.projection = projection;
  engine.outline = new Path2D(projectionOutlineSvgPath(projection));
  projection.projectRelative(0, 0, scratchPoint);
  const originX = scratchPoint.x;
  const originY = scratchPoint.y;
  projection.projectRelative(0, 1, scratchPoint);
  engine.mapScale = (scratchPoint.x - originX) / DEG;
  projection.projectRelative(1, 0, scratchPoint);
  const pxPerDegree = Math.max(0.05, Math.abs(originY - scratchPoint.y));

  // one lattice for both views, spaced for DOT_PITCH between rows on the map
  const spacing = clamp(Math.round((DOT_PITCH / pxPerDegree) * 20) / 20, 0.6, 8);
  const lattice = sphereLattice({ spacingDeg: spacing, landOnly: true });
  const fresh = lattice !== engine.lattice || !engine.dots;
  if (fresh || !engine.dots) {
    engine.lattice = lattice;
    engine.dots = allocateDots(lattice);
  }
  const dots = engine.dots;
  const meridian = engine.meridian;
  const { threshold } = dots.springs;
  for (let i = 0; i < dots.count; i++) {
    const rho = wrapLongitude(lattice.lon[i] - meridian) * DEG;
    dots.rho[i] = rho;
    threshold[i] = releaseAt(dots.phi[i], rho, lattice.jitter[i]);
    projection.project(lattice.lat[i], lattice.lon[i], scratchPoint);
    dots.mapX[i] = scratchPoint.x;
    dots.mapY[i] = scratchPoint.y;
  }
  // a new lattice (after a resize) starts where the release clock says each dot should be
  if (fresh) restSprings(dots.springs, engine.T);

  engine.landBatch ??= createDotBatch(dots.count, [[128, 128, 128]], { tones: 16, levels: 20 });
  engine.routeBatch ??= createDotBatch(2048, [[128, 128, 128]], { tones: 8, levels: 20 });
  engine.sparks ??= new Sparks();
  if (engine.ink) {
    engine.landBatch.setRamp([engine.ink.landStrong, engine.ink.soft]);
    engine.routeBatch.setRamp([engine.ink.accent, engine.ink.soft]);
  }

  buildRoutes(engine, projection);

  engine.seam = buildSeam(projection);
  engine.dirty = true;
}

/** Both sides of the map, where the back of the globe was cut. */
interface Seam {
  left: ArcLengthTable;
  right: ArcLengthTable;
  /** Latitude of each sample, shared by both sides. */
  lat: Float32Array;
}

function buildSeam(projection: MapProjection): Seam {
  const count = 91;
  const lat = new Float32Array(count);
  const xs = new Float32Array(count);
  const ys = new Float32Array(count);
  const side = (lambda: number) => {
    for (let i = 0; i < count; i++) {
      lat[i] = -90 + i * 2;
      projection.projectRelative(lat[i], lambda, scratchPoint);
      xs[i] = scratchPoint.x;
      ys[i] = scratchPoint.y;
    }
    return buildArcLength(xs, ys, count);
  };
  return { left: side(-180), right: side(180), lat };
}

function allocateDots(lattice: SphereLattice): LandDots {
  const count = lattice.count;
  const phi = new Float32Array(count);
  const sinPhi = new Float32Array(count);
  const cosPhi = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const angle = lattice.lat[i] * DEG;
    phi[i] = angle;
    sinPhi[i] = Math.sin(angle);
    cosPhi[i] = Math.cos(angle);
  }
  return {
    count,
    xyz: lattice.xyz,
    phi,
    sinPhi,
    cosPhi,
    rho: new Float32Array(count),
    mapX: new Float32Array(count),
    mapY: new Float32Array(count),
    springs: createSprings(count, 0),
  };
}

/** Puts every spring of a set at rest at the goal the release clock gives it. */
function restSprings(set: SpringSet, clock: number) {
  for (let i = 0; i < set.count; i++) {
    set.e[i] = clock > set.threshold[i] ? 1 : 0;
    set.v[i] = 0;
  }
}

function createPlace(point: LatLon, engine: Engine, projection: MapProjection): Place {
  const phi = point.lat * DEG;
  const lambda = point.lon * DEG;
  const rho = wrapLongitude(point.lon - engine.meridian) * DEG;
  projection.project(point.lat, point.lon, scratchPoint);
  return {
    x0: Math.cos(phi) * Math.sin(lambda),
    y0: Math.sin(phi),
    z0: Math.cos(phi) * Math.cos(lambda),
    phi,
    sinPhi: Math.sin(phi),
    cosPhi: Math.cos(phi),
    rho,
    mapX: scratchPoint.x,
    mapY: scratchPoint.y,
    x: 0,
    y: 0,
    vis: 0,
  };
}

function buildRoutes(engine: Engine, projection: MapProjection) {
  const places: Place[] = [];
  const placeIndex = new Map<string, number>();
  const placeFor = (point: LatLon) => {
    const key = `${point.lat.toFixed(3)},${point.lon.toFixed(3)}`;
    const known = placeIndex.get(key);
    if (known !== undefined) return known;
    places.push(createPlace(point, engine, projection));
    placeIndex.set(key, places.length - 1);
    return places.length - 1;
  };
  const tilt = engine.tilt * DEG;
  const sinTilt = Math.sin(tilt);
  const cosTilt = Math.cos(tilt);
  const meridian = engine.meridian * DEG;
  const previousRoutes = engine.routes;
  const curveLambda = new Float32Array(SAMPLES);
  const curveLat = new Float32Array(SAMPLES);
  const copyX = new Float32Array(SAMPLES);
  const copyY = new Float32Array(SAMPLES);

  engine.routes = engine.input.map((input, index) => {
    const { from, to } = input;
    const world = globeArc(from, to, { segments: SEGMENTS, lift: arcLift(centralAngle(from, to), ROUTE_LIFT) });
    const route: RouteGeometry = {
      weight: input.weight,
      fromPlace: placeFor(from),
      toPlace: placeFor(to),
      world,
      lift: new Float32Array(SAMPLES),
      phi: new Float32Array(SAMPLES),
      sinPhi: new Float32Array(SAMPLES),
      cosPhi: new Float32Array(SAMPLES),
      rho: new Float32Array(SAMPLES),
      springs: createSprings(SAMPLES, 0),
      occluded: new Uint8Array(SAMPLES),
      mapX: new Float32Array(SAMPLES),
      mapY: new Float32Array(SAMPLES),
      copies: [],
      xs: new Float32Array(SAMPLES),
      ys: new Float32Array(SAMPLES),
      vis: new Float32Array(SAMPLES),
      ease: new Float32Array(SAMPLES),
      table: buildArcLength([0, 0], [0, 0], 2),
    };
    let previous = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const x = world[i * 3];
      const y = world[i * 3 + 1];
      const z = world[i * 3 + 2];
      const length = Math.hypot(x, y, z) || 1;
      const phi = Math.asin(clamp(y / length, -1, 1));
      const relative = Math.atan2(x, z) - meridian;
      // unwrap along the route, so a route across the seam runs past the map's edge instead of jumping
      const rho = i === 0 ? wrapRadians(relative) : previous + wrapRadians(relative - previous);
      previous = rho;
      route.lift[i] = length - 1;
      route.phi[i] = phi;
      route.sinPhi[i] = Math.sin(phi);
      route.cosPhi[i] = Math.cos(phi);
      route.rho[i] = rho;
      route.springs.threshold[i] = releaseAt(phi, rho, 0.5);
      // lifted view coordinates of the globe facing the cut meridian
      const vx = route.cosPhi[i] * Math.sin(rho) * length;
      const wy = route.sinPhi[i] * length;
      const wz = route.cosPhi[i] * Math.cos(rho) * length;
      route.occluded[i] = isOccluded(vx, cosTilt * wy - sinTilt * wz, sinTilt * wy + cosTilt * wz) ? 1 : 0;
    }

    // The flat curve bends toward the nearer pole, with `to` continuing past the edge when the route crosses the seam.
    // It bends in longitude and latitude and is projected sample by sample, so its copy shifted by 360° meets it
    // exactly at the map's edge.
    const lambdaFrom = route.rho[0] / DEG;
    const lambdaTo = route.rho[SEGMENTS] / DEG;
    const bend = ROUTE_BEND * (lambdaTo >= lambdaFrom ? 1 : -1) * (from.lat + to.lat >= 0 ? 1 : -1);
    const curve = flatCurve(lambdaFrom, -from.lat, lambdaTo, -to.lat, bend, curveScratch);
    let lowest = Infinity;
    let highest = -Infinity;
    for (let i = 0; i < SAMPLES; i++) {
      quadPoint(curve, i / SEGMENTS, pointScratch);
      curveLambda[i] = pointScratch.x;
      curveLat[i] = clamp(-pointScratch.y, -89.5, 89.5);
      lowest = Math.min(lowest, pointScratch.x);
      highest = Math.max(highest, pointScratch.x);
      projection.projectRelative(curveLat[i], curveLambda[i], scratchPoint);
      route.mapX[i] = scratchPoint.x;
      route.mapY[i] = scratchPoint.y;
    }
    const copyAt = (shift: number) => {
      for (let i = 0; i < SAMPLES; i++) {
        projection.projectRelative(curveLat[i], curveLambda[i] + shift, scratchPoint);
        copyX[i] = scratchPoint.x;
        copyY[i] = scratchPoint.y;
      }
      return buildArcLength(copyX, copyY, SAMPLES);
    };
    if (highest > 180) route.copies.push(copyAt(-360));
    if (lowest < -180) route.copies.push(copyAt(360));

    // a rebuilt route (resize, new cut) keeps its springs, so a morph in progress carries on
    const kept = previousRoutes[index]?.springs;
    if (kept) {
      route.springs.e.set(kept.e);
      route.springs.v.set(kept.v);
    } else {
      restSprings(route.springs, engine.T);
    }
    return route;
  });

  const previousPlaces = engine.placeSprings;
  const placeSprings = previousPlaces.count === places.length ? previousPlaces : createSprings(places.length, 0);
  places.forEach((place, i) => {
    placeSprings.threshold[i] = releaseAt(place.phi, place.rho, 0.5);
  });
  if (placeSprings !== previousPlaces) restSprings(placeSprings, engine.T);
  engine.places = places;
  engine.placeSprings = placeSprings;
}

/* Morph geometry -------------------------------------------------------------------------------------- */

/** The fixed frame of a morph: globe centre and radius, map scale and the globe's tilt in radians. */
interface UnrollFrame {
  cx: number;
  cy: number;
  radius: number;
  mapScale: number;
  tilt: number;
}

interface UnrollPoint {
  x: number;
  y: number;
  /** View-space z of the surface normal: below 0 the point still faces away. */
  depth: number;
  /** Weight of the final blend onto the projected map position. */
  blend: number;
}

const unrolled: UnrollPoint = { x: 0, y: 0, depth: 0, blend: 0 };

/**
 * Where a point is at morph progress `e` (0 globe, 1 map, a little above 1 on the overshoot). The globe unrolls about
 * its axis onto the plane that touches its front: a sphere of radius 1/k whose meridians are k times the original
 * angle apart, so as k falls from 1 to 0 the back of the globe comes around the edges and flattens into a sinusoidal
 * map at the map's scale. The last part blends onto the real projection, and the tilt relaxes on the way.
 */
function unroll(
  frame: UnrollFrame,
  phi: number,
  sinPhi: number,
  cosPhi: number,
  rho: number,
  mapX: number,
  mapY: number,
  e: number,
  lift: number,
  out: UnrollPoint,
) {
  const settled = e < 1 ? e : 1;
  const k = 1 - settled;
  let wx: number;
  let wz: number;
  let cosA: number;
  if (k > 1e-3) {
    const angle = rho * k;
    const radius = 1 / k;
    cosA = Math.cos(angle);
    wx = cosPhi * radius * Math.sin(angle);
    wz = cosPhi * (1 - radius * (1 - cosA));
  } else {
    cosA = 1;
    wx = cosPhi * rho;
    wz = cosPhi;
  }
  const wy = phi + (sinPhi - phi) * k;
  const tau = frame.tilt * k;
  const cosTau = Math.cos(tau);
  const sinTau = Math.sin(tau);
  const vy = cosTau * wy - sinTau * wz;
  const scale = (frame.mapScale + (frame.radius - frame.mapScale) * k) * (1 + lift * k);
  const ux = frame.cx + wx * scale;
  const uy = frame.cy - vy * scale;
  const blend = smoothstep(0.55, 1, settled);
  let x = ux + (mapX - ux) * blend;
  let y = uy + (mapY - uy) * blend;
  if (e > 1) {
    // the landing overshoot pushes the map open a little from its centre, then it settles
    x += (mapX - frame.cx) * (e - 1) * OVERSHOOT_GAIN;
    y += (mapY - frame.cy) * (e - 1) * OVERSHOOT_GAIN;
  }
  out.x = x;
  out.y = y;
  out.depth = cosTau * cosA * cosPhi + sinTau * sinPhi;
  out.blend = blend;
}

/* Drawing -------------------------------------------------------------------------------------------- */

/** The land, routes, route ends and hairlines. Redrawn only while something moves. */
function drawMain(engine: Engine, surface: CanvasSurface, motion: GlobeMotion) {
  const { context, width, height } = surface;
  const { dots, ink, landBatch, routeBatch, projection } = engine;
  context.clearRect(0, 0, width, height);
  if (!dots || !ink || !landBatch || !routeBatch || !projection) return;
  const P = engine.P;
  const crossfade = engine.crossfade && P > 0 && P < 1;
  const restGlobe = !crossfade && P <= 0 && engine.settled;
  const restMap = !crossfade && P >= 1 && engine.settled;
  const morphing = !crossfade && !restGlobe && !restMap;
  const globeWeight = crossfade ? 1 - P : restGlobe ? 1 : 0;
  const mapWeight = crossfade ? P : restMap ? 1 : 0;
  rotationFromView(motion.lon, motion.lat, engine.rotation);
  const frame: UnrollFrame = {
    cx: engine.cx,
    cy: engine.cy,
    radius: engine.radius,
    mapScale: engine.mapScale,
    tilt: engine.tilt * DEG,
  };

  // hairlines: the limb gives way to the projection's border
  const limbAlpha = crossfade ? 1 - P : 1 - smoothstep(0.04, 0.42, P);
  const outlineAlpha = crossfade ? P : smoothstep(0.5, 0.92, P);
  context.lineWidth = 1;
  context.strokeStyle = rgba(ink.border);
  if (limbAlpha > 0.005) {
    context.globalAlpha = limbAlpha;
    context.beginPath();
    context.arc(engine.cx, engine.cy, engine.radius + 1.5, 0, TAU);
    context.stroke();
  }
  if (outlineAlpha > 0.005 && engine.outline) {
    context.globalAlpha = outlineAlpha;
    context.stroke(engine.outline);
  }
  context.globalAlpha = 1;

  if (globeWeight > 0) addGlobeLand(engine, dots, landBatch, globeWeight);
  if (mapWeight > 0) addMapLand(engine, dots, landBatch, mapWeight);
  if (morphing) addMorphLand(engine, dots, landBatch, frame);
  landBatch.flush(context);

  for (const route of engine.routes) {
    if (morphing) {
      routeMorph(route, frame);
      drawRoute(engine, routeBatch, route, ROUTE_ALPHA);
    } else {
      if (globeWeight > 0) {
        routeGlobe(engine, route);
        drawRoute(engine, routeBatch, route, ROUTE_ALPHA * globeWeight);
      }
      if (mapWeight > 0) {
        routeMap(route);
        drawRoute(engine, routeBatch, route, ROUTE_ALPHA * mapWeight);
      }
    }
    if (engine.copyAlpha > 0) {
      for (const copy of route.copies) drawDotted(engine, routeBatch, copy, null, null, ROUTE_ALPHA * engine.copyAlpha);
    }
  }
  routeBatch.flush(context);

  drawPlaces(engine, context, ink, frame, P, crossfade, morphing);
}

function addGlobeLand(engine: Engine, dots: LandDots, batch: DotBatch, weight: number) {
  const m = engine.rotation;
  const { xyz } = dots;
  const { cx, cy, radius, dpr } = engine;
  for (let i = 0; i < dots.count; i++) {
    const x = xyz[i * 3];
    const y = xyz[i * 3 + 1];
    const z = xyz[i * 3 + 2];
    const vz = m[6] * x + m[7] * y + m[8] * z;
    if (vz < -0.02) continue;
    const vx = m[0] * x + m[1] * y + m[2] * z;
    const vy = m[3] * x + m[4] * y + m[5] * z;
    const alpha = smoothstep(-0.02, 0.1, vz) * depthShade(vz) * LAND_ALPHA * weight;
    batch.add(
      snapCenter(cx + vx * radius, DOT_SIZE, dpr),
      snapCenter(cy - vy * radius, DOT_SIZE, dpr),
      DOT_SIZE,
      0,
      alpha,
    );
  }
}

function addMapLand(engine: Engine, dots: LandDots, batch: DotBatch, weight: number) {
  const { dpr } = engine;
  const alpha = LAND_ALPHA * weight;
  for (let i = 0; i < dots.count; i++) {
    batch.add(snapCenter(dots.mapX[i], DOT_SIZE, dpr), snapCenter(dots.mapY[i], DOT_SIZE, dpr), DOT_SIZE, 0, alpha);
  }
}

function addMorphLand(engine: Engine, dots: LandDots, batch: DotBatch, frame: UnrollFrame) {
  const { dpr, omega } = engine;
  const { e, v } = dots.springs;
  for (let i = 0; i < dots.count; i++) {
    const progress = e[i];
    unroll(
      frame,
      dots.phi[i],
      dots.sinPhi[i],
      dots.cosPhi[i],
      dots.rho[i],
      dots.mapX[i],
      dots.mapY[i],
      progress,
      0,
      unrolled,
    );
    const visible = lerp(smoothstep(-0.02, 0.1, unrolled.depth), 1, unrolled.blend);
    if (visible <= 0.01) continue;
    const glow = launchGlow(v[i], omega);
    const alpha =
      visible * (lerp(depthShade(unrolled.depth), 1, clamp(progress, 0, 1)) * LAND_ALPHA + glow * FLIGHT_BOOST);
    batch.add(
      snapCenter(unrolled.x, DOT_SIZE, dpr),
      snapCenter(unrolled.y, DOT_SIZE, dpr),
      DOT_SIZE,
      glow * FLIGHT_TINT,
      alpha,
    );
  }
}

/** The route on the globe as it faces now: lifted samples, hidden where they pass behind it. */
function routeGlobe(engine: Engine, route: RouteGeometry) {
  const m = engine.rotation;
  const { world } = route;
  const { cx, cy, radius } = engine;
  for (let i = 0; i < SAMPLES; i++) {
    const x = world[i * 3];
    const y = world[i * 3 + 1];
    const z = world[i * 3 + 2];
    const vx = m[0] * x + m[1] * y + m[2] * z;
    const vy = m[3] * x + m[4] * y + m[5] * z;
    const vz = m[6] * x + m[7] * y + m[8] * z;
    route.xs[i] = cx + vx * radius;
    route.ys[i] = cy - vy * radius;
    route.vis[i] = isOccluded(vx, vy, vz) ? 0 : 1;
    route.ease[i] = 0;
  }
  buildArcLength(route.xs, route.ys, SAMPLES, route.table);
}

function routeMap(route: RouteGeometry) {
  route.xs.set(route.mapX);
  route.ys.set(route.mapY);
  route.vis.fill(1);
  route.ease.fill(1);
  buildArcLength(route.xs, route.ys, SAMPLES, route.table);
}

/** Each sample unrolls with the land under it, so the route stays on its places while it bends flat. */
function routeMorph(route: RouteGeometry, frame: UnrollFrame) {
  const { e } = route.springs;
  for (let i = 0; i < SAMPLES; i++) {
    unroll(
      frame,
      route.phi[i],
      route.sinPhi[i],
      route.cosPhi[i],
      route.rho[i],
      route.mapX[i],
      route.mapY[i],
      e[i],
      route.lift[i],
      unrolled,
    );
    const settled = clamp(e[i], 0, 1);
    const facing = lerp(smoothstep(-0.02, 0.1, unrolled.depth), 1, unrolled.blend);
    route.xs[i] = unrolled.x;
    route.ys[i] = unrolled.y;
    // the globe's occlusion counts only with the weight the globe still has
    route.vis[i] = lerp(1 - route.occluded[i], facing, settled);
    route.ease[i] = settled;
  }
  buildArcLength(route.xs, route.ys, SAMPLES, route.table);
}

function drawRoute(engine: Engine, batch: DotBatch, route: RouteGeometry, alpha: number) {
  drawDotted(engine, batch, route.table, route.vis, route.ease, alpha);
}

/**
 * Dots every ROUTE_SPACING px along a polyline, phase-locked to its start so they do not crawl while it bends.
 * Visibility is interpolated between samples; where the map weight is up, dots outside the map's border are clipped.
 */
function drawDotted(
  engine: Engine,
  batch: DotBatch,
  table: ArcLengthTable,
  vis: Float32Array | null,
  ease: Float32Array | null,
  alpha: number,
) {
  const projection = engine.projection;
  if (!projection || table.count < 2 || alpha <= 0) return;
  const { dpr } = engine;
  let k = 0;
  for (let j = 0; j < table.count - 1; j++) {
    const d0 = table.distances[j];
    const d1 = table.distances[j + 1];
    const span = d1 - d0;
    for (; k * ROUTE_SPACING <= d1 + 1e-6; k++) {
      const s = k * ROUTE_SPACING;
      const f = span > 0 ? clamp((s - d0) / span, 0, 1) : 0;
      let visible = vis ? vis[j] + (vis[j + 1] - vis[j]) * f : 1;
      if (visible <= 0.02) continue;
      const x = table.xs[j] + (table.xs[j + 1] - table.xs[j]) * f;
      const y = table.ys[j] + (table.ys[j + 1] - table.ys[j]) * f;
      const mapWeight = ease ? ease[j] + (ease[j + 1] - ease[j]) * f : 1;
      if (mapWeight > 0.001 && !projection.invert(x, y)) visible *= 1 - mapWeight;
      if (visible <= 0.02) continue;
      batch.add(snapCenter(x, DOT_SIZE, dpr), snapCenter(y, DOT_SIZE, dpr), ROUTE_DOT, 0, alpha * visible);
    }
  }
}

function placeOnGlobe(engine: Engine, place: Place) {
  const m = engine.rotation;
  const vx = m[0] * place.x0 + m[1] * place.y0 + m[2] * place.z0;
  const vy = m[3] * place.x0 + m[4] * place.y0 + m[5] * place.z0;
  const vz = m[6] * place.x0 + m[7] * place.y0 + m[8] * place.z0;
  place.x = engine.cx + vx * engine.radius;
  place.y = engine.cy - vy * engine.radius;
  place.vis = smoothstep(-0.02, 0.1, vz);
}

/** Route ends: a card-coloured square punched into the land with the accent square on top. */
function drawPlaces(
  engine: Engine,
  context: CanvasRenderingContext2D,
  ink: GeoInk,
  frame: UnrollFrame,
  P: number,
  crossfade: boolean,
  morphing: boolean,
) {
  const springs = engine.placeSprings.e;
  const card = rgba(ink.card);
  const accent = rgba(ink.accent);
  const { dpr } = engine;
  // markers shrink with small stages so they do not cover the land around them
  const scale = clamp(engine.width / 600, 0.7, 1);
  const device = (value: number) => Math.max(1, Math.round(value * dpr)) / dpr;
  const hole = device(6 * scale);
  const halo = device(8 * scale);
  const core = device(3 * scale);
  const mark = (x: number, y: number, alpha: number) => {
    if (alpha <= 0.02) return;
    const px = Math.round(x * dpr) / dpr;
    const py = Math.round(y * dpr) / dpr;
    context.globalAlpha = alpha;
    context.fillStyle = card;
    context.fillRect(px - hole / 2, py - hole / 2, hole, hole);
    context.globalAlpha = alpha * 0.18;
    context.fillStyle = accent;
    context.fillRect(px - halo / 2, py - halo / 2, halo, halo);
    context.globalAlpha = alpha;
    context.fillRect(px - core / 2, py - core / 2, core, core);
  };
  engine.places.forEach((place, index) => {
    if (morphing) {
      unroll(
        frame,
        place.phi,
        place.sinPhi,
        place.cosPhi,
        place.rho,
        place.mapX,
        place.mapY,
        springs[index] ?? 0,
        0,
        unrolled,
      );
      place.x = unrolled.x;
      place.y = unrolled.y;
      place.vis = lerp(smoothstep(-0.02, 0.1, unrolled.depth), 1, unrolled.blend);
      mark(place.x, place.y, place.vis);
      return;
    }
    if (crossfade) {
      placeOnGlobe(engine, place);
      mark(place.x, place.y, place.vis * (1 - P));
      mark(place.mapX, place.mapY, P);
      if (P >= 0.5) {
        place.x = place.mapX;
        place.y = place.mapY;
        place.vis = 1;
      }
      return;
    }
    if (P <= 0) {
      placeOnGlobe(engine, place);
    } else {
      place.x = place.mapX;
      place.y = place.mapY;
      place.vis = 1;
    }
    mark(place.x, place.y, place.vis);
  });
  context.globalAlpha = 1;
}

const locateScratch = { j: 0, f: 0, x: 0, y: 0 };

/** Segment, fraction and position at distance `s` along a table (binary search, no allocation). */
function locate(table: ArcLengthTable, s: number) {
  const out = locateScratch;
  let low = 0;
  let high = table.count - 2;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (table.distances[middle] <= s) low = middle;
    else high = middle - 1;
  }
  const span = table.distances[low + 1] - table.distances[low];
  const f = span > 0 ? clamp((s - table.distances[low]) / span, 0, 1) : 0;
  out.j = low;
  out.f = f;
  out.x = table.xs[low] + (table.xs[low + 1] - table.xs[low]) * f;
  out.y = table.ys[low] + (table.ys[low + 1] - table.ys[low]) * f;
  return out;
}

/** Packets, arrival pulses and seam sparks, on the canvas that reaches past the stage. Returns whether to keep going. */
function drawEffects(engine: Engine, surface: CanvasSurface, delta: number, packetsOn: boolean) {
  const { context, width, height } = surface;
  const ink = engine.ink;
  const sparks = engine.sparks;
  if (!ink || !sparks) return false;
  const spawning = packetsOn && engine.routes.length > 0;
  if (!packetsOn && engine.packets.length) engine.packets = [];
  if (spawning) spawnPackets(engine, delta);

  if (engine.seamAge >= 0) {
    engine.seamAge += delta;
    if (engine.seamAge > SEAM_SECONDS) engine.seamAge = -1;
  }

  if (!engine.packets.length && !engine.pulses.length && !sparks.active && engine.seamAge < 0) {
    if (engine.fxDirty) {
      context.clearRect(0, 0, width, height);
      engine.fxDirty = false;
    }
    return spawning;
  }
  engine.fxDirty = true;
  context.clearRect(0, 0, width, height);
  context.save();
  context.translate(FX_X, FX_Y);

  const head = rgba(ink.shine);
  const tail = rgba(ink.accent);
  const alive: Packet[] = [];
  for (const packet of engine.packets) {
    const route = engine.routes[packet.route];
    if (!route) continue;
    packet.s += PACKET_SPEED * delta;
    if (packet.s >= route.table.length) {
      if ((engine.places[route.toPlace]?.vis ?? 0) > 0.5) engine.pulses.push({ place: route.toPlace, age: 0 });
      continue;
    }
    alive.push(packet);
    drawPacket(engine, context, route.table, route.vis, route.ease, packet.s, 1, head, tail);
    if (engine.copyAlpha > 0) {
      for (const copy of route.copies)
        drawPacket(engine, context, copy, null, null, packet.s, engine.copyAlpha, head, tail);
    }
  }
  engine.packets = alive;

  context.strokeStyle = tail;
  context.lineWidth = 1;
  const pulses: Pulse[] = [];
  for (const pulse of engine.pulses) {
    pulse.age += delta;
    const place = engine.places[pulse.place];
    if (!place || pulse.age >= PULSE_SECONDS) continue;
    pulses.push(pulse);
    const p = pulse.age / PULSE_SECONDS;
    const size = 4 + 10 * (1 - (1 - p) * (1 - p));
    const x = Math.round(place.x) + 0.5;
    const y = Math.round(place.y) + 0.5;
    context.globalAlpha = 0.6 * (1 - p) * (1 - p) * place.vis;
    context.strokeRect(x - size / 2, y - size / 2, size, size);
  }
  engine.pulses = pulses;
  if (engine.seamAge >= 0 && engine.seam) drawSeam(context, engine.seam, engine.seamAge, ink);
  context.globalAlpha = 1;
  context.restore();

  sparks.step(context, delta);
  return true;
}

function spawnPackets(engine: Engine, delta: number) {
  const { routes, packets } = engine;
  if (!engine.warmed) {
    // start with traffic already on the wire instead of an empty map
    engine.warmed = true;
    routes.forEach((route, index) => packets.push({ route: index, s: Math.random() * route.table.length }));
  }
  routes.forEach((route, index) => {
    const rate = 0.4 + 1.2 * route.weight;
    if (packets.length < MAX_PACKETS && Math.random() < 1 - Math.exp(-rate * delta))
      packets.push({ route: index, s: 0 });
  });
}

/** A 2 px head in the shine colour and five tail squares that fade behind it. */
function drawPacket(
  engine: Engine,
  context: CanvasRenderingContext2D,
  table: ArcLengthTable,
  vis: Float32Array | null,
  ease: Float32Array | null,
  s: number,
  alpha: number,
  head: string,
  tail: string,
) {
  const projection = engine.projection;
  if (!projection || table.count < 2) return;
  for (let k = PACKET_TAIL; k >= 0; k--) {
    const distance = s - k * PACKET_GAP;
    if (distance < 0) continue;
    const at = locate(table, distance);
    let visible = vis ? vis[at.j] + (vis[at.j + 1] - vis[at.j]) * at.f : 1;
    const mapWeight = ease ? ease[at.j] + (ease[at.j + 1] - ease[at.j]) * at.f : 1;
    if (visible > 0.02 && mapWeight > 0.001 && !projection.invert(at.x, at.y)) visible *= 1 - mapWeight;
    if (visible <= 0.02) continue;
    const size = k === 0 ? 2 : 1.5;
    context.globalAlpha = alpha * visible * (k === 0 ? 1 : 0.78 * (1 - k / (PACKET_TAIL + 1)));
    context.fillStyle = k === 0 ? head : tail;
    context.fillRect(Math.round((at.x - size / 2) * 2) / 2, Math.round((at.y - size / 2) * 2) / 2, size, size);
  }
  context.globalAlpha = 1;
}

/**
 * The seam lands: light runs along both cut edges of the map from the equator to the poles, and sparks fly off them,
 * outward from the map's centre and past the stage.
 */
function emitSeamSparks(engine: Engine) {
  const { sparks, ink, seam } = engine;
  if (!sparks || !ink || !seam) return;
  engine.seamAge = 0;
  const colors: RGB[] = [ink.accent, ink.glint, ink.soft];
  for (const side of [seam.left, seam.right]) {
    for (let i = 0; i < seam.lat.length; i += 4) {
      const latitude = seam.lat[i];
      if (latitude < -62 || latitude > 76) continue;
      const x = side.xs[i];
      const y = side.ys[i];
      const near = 1 - Math.abs(latitude) / 90;
      sparks.add(x + FX_X, y + FX_Y, near > 0.5 ? 3 : 2, colors, {
        angle: Math.atan2((y - engine.cy) * 0.6, x - engine.cx),
        spread: 1.2,
        speed: [40, 210],
        life: [0.3, 0.7],
        size: [1.5, 2.5],
        drag: 3.4,
        jitter: 1.5,
      });
    }
  }
}

/** A dotted line of light along both seam edges: a bright band runs from the equator to the poles and fades. */
function drawSeam(context: CanvasRenderingContext2D, seam: Seam, age: number, ink: GeoInk) {
  const travel = clamp(age / SEAM_TRAVEL, 0, 1);
  const front = 1.15 * (1 - (1 - travel) * (1 - travel) * (1 - travel));
  const fade = 1 - smoothstep(0.3, SEAM_SECONDS, age);
  const head = rgba(ink.hot);
  const trail = rgba(ink.accent);
  for (const side of [seam.left, seam.right]) {
    forEachDot(side, 3, 0, side.length, (x, y, s) => {
      const at = locate(side, s);
      const latitude = seam.lat[at.j] + (seam.lat[at.j + 1] - seam.lat[at.j]) * at.f;
      const u = Math.abs(latitude) / 90;
      const offset = (u - front) / 0.1;
      const band = Math.exp(-offset * offset);
      const lit = u <= front ? 0.45 : 0;
      const intensity = Math.max(band, lit) * fade;
      if (intensity < 0.03) return;
      const size = band > 0.6 ? 2 : 1.5;
      context.globalAlpha = intensity;
      context.fillStyle = band >= lit ? head : trail;
      context.fillRect(Math.round((x - size / 2) * 2) / 2, Math.round((y - size / 2) * 2) / 2, size, size);
    });
  }
}
