"use client";

import * as React from "react";

import { useCanvas } from "@/lib/lumesec/canvas";
import { usePalette } from "@/lib/lumesec/color";
import {
  angleDelta,
  buildArcLength,
  centralAngle,
  createDotBatch,
  createScreenPoint,
  cubicBezier,
  GEO_TOKENS,
  geoInk,
  globeArc,
  isOccluded,
  isValidLatLon,
  latLonToVector,
  projectGlobe,
  ringFront,
  rotationFromView,
  sphereLattice,
  spacingForRadius,
  toDegrees,
  type ArcLengthTable,
  type DotBatch,
  type GeoInk,
  type GeoPalette,
  type GlobeView,
  type LatLon,
  type SphereLattice,
  type Vec3,
} from "@/lib/lumesec/geo";
import { createRandom, DEMO_CITIES, pickWeighted } from "@/lib/lumesec/geo-data";
import { clamp, easeOutCubic, rgba, smoothstep, type RGB } from "@/lib/lumesec/math";
import {
  prefersReducedMotion,
  springStep,
  useAnimationLoop,
  useLazyRef,
  useReducedMotion,
  type Spring,
} from "@/lib/lumesec/motion";
import { cn } from "@/lib/utils";

/** Two places to join with an arc that climbs into the sky above the horizon. */
export interface HorizonConnection {
  /** Where the arc leaves the surface, in degrees. */
  readonly from: LatLon;
  /** Where the arc comes down, in degrees. */
  readonly to: LatLon;
}

/** When the land reveal plays: on first view, as soon as the component mounts, or never. */
export type HorizonReveal = "view" | "mount" | "none";

/** Props of GeoHorizon. The remaining props go to the root `<section>`. */
export interface GeoHorizonProps extends React.ComponentProps<"section"> {
  /** Headline, copy and actions. They sit over the sky, above the globe, and stay fully interactive. */
  children?: React.ReactNode;
  /**
   * Pairs of places to arc between. Arcs play in order, one every `arcInterval` seconds, for the pairs whose two ends are
   * on the visible cap; the others wait until the drift brings them round. An empty array draws no arcs. Without it,
   * arcs play between demo cities, and between land points where no two demo cities are on the cap.
   */
  connections?: readonly HorizonConnection[];
  /** The point shown in the lower third of the visible cap. The view springs to a new value. */
  center?: LatLon;
  /** Share of the height the cap takes, 0.25 to 0.7. */
  capHeight?: number;
  /** Turns the globe slowly, west to east like the Earth, while it is on screen. */
  drift?: boolean;
  /** Drift speed in degrees of longitude per second. */
  driftSpeed?: number;
  /** When the land reveal plays. `view` waits until about a third of the component is on screen. */
  reveal?: HorizonReveal;
  /** Seconds between new arcs. At most four arcs are in flight. */
  arcInterval?: number;
  /** Alignment of the children: centred, or left-aligned with a wider inset. */
  align?: "center" | "start";
  /** Draws the accent glow above the limb. */
  atmosphere?: boolean;
}

/**
 * The top of a large dotted globe rising from the bottom edge, for page heroes. On first view the horizon line draws
 * out from its middle and the land appears behind an uneven, bright front that spreads from the same point. Then
 * connections leave the surface, climb into the sky and come down in another region, each landing lighting a ring of
 * dots, while a glint runs along the limb now and then. Your headline and actions are regular children over the sky.
 *
 * @example
 * <GeoHorizon aria-labelledby="hero-title" className="h-[420px]">
 *   <h1 id="hero-title">Requests between regions</h1>
 * </GeoHorizon>
 */
export function GeoHorizon({
  children,
  connections,
  center = DEFAULT_CENTER,
  capHeight = 0.46,
  drift = true,
  driftSpeed = 1.2,
  reveal = "view",
  arcInterval = 1.4,
  align = "center",
  atmosphere = true,
  className,
  ...props
}: GeoHorizonProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  /** Everything the loop mutates, created on first use (never during render). */
  const stateRef = useLazyRef(createHorizonState);
  const settings = React.useRef<HorizonSettings>(DEFAULT_SETTINGS);
  const reducedMotion = useReducedMotion();

  const loop = useAnimationLoop(canvasRef, step);
  const palette = usePalette(canvasRef, GEO_TOKENS, () => loop.kick());
  const surface = useCanvas(canvasRef, () => loop.kick(), CANVAS_OPTIONS);

  const cap = Number.isFinite(capHeight) ? clamp(capHeight, 0.25, 0.7) : 0.46;
  const mask = skyMask(cap);
  const centerLat = Number.isFinite(center.lat) ? clamp(center.lat, -90, 90) : DEFAULT_CENTER.lat;
  const centerLon = Number.isFinite(center.lon) ? center.lon : DEFAULT_CENTER.lon;

  React.useEffect(() => {
    settings.current = {
      connections,
      centerLat,
      centerLon,
      capHeight: cap,
      drift,
      driftSpeed: Number.isFinite(driftSpeed) ? driftSpeed : 1.2,
      arcInterval: Number.isFinite(arcInterval) ? Math.max(0.25, arcInterval) : 1.4,
      atmosphere,
      reveal,
    };
    loop.kick();
  }, [connections, centerLat, centerLon, cap, drift, driftSpeed, arcInterval, atmosphere, reveal, loop]);

  // A new centre springs into place from where the view is now, instead of jumping.
  React.useEffect(() => {
    const state = stateRef.current;
    if (state.shownCenter && state.armed && !prefersReducedMotion()) {
      state.lonSpring.position += angleDelta(centerLon, state.shownCenter.lon);
      state.latSpring.position += state.shownCenter.lat - centerLat;
    }
    state.shownCenter = { lat: centerLat, lon: centerLon };
    loop.kick();
  }, [centerLat, centerLon, stateRef, loop]);

  // `view` arms the reveal once a good part of the hero is on screen; `mount` and `none` arm it right away.
  React.useEffect(() => {
    const state = stateRef.current;
    const canvas = canvasRef.current;
    if (state.armed || !canvas) return;
    if (reveal !== "view" || typeof IntersectionObserver === "undefined") {
      state.armed = true;
      loop.kick();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry?.isIntersecting) return;
        const viewport = entry.rootBounds?.height ?? window.innerHeight;
        if (entry.intersectionRatio < ARM_RATIO && entry.intersectionRect.height < viewport * 0.5) return;
        state.armed = true;
        observer.disconnect();
        loop.kick();
      },
      { threshold: [0, 0.15, ARM_RATIO, 0.6] },
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [reveal, stateRef, loop]);

  // Reduced motion swaps the flights for still arcs (and back); restart the loop when it changes.
  React.useEffect(() => {
    loop.kick();
  }, [reducedMotion, loop]);

  React.useEffect(() => {
    const state = stateRef.current;
    return () => {
      if (state.wake) window.clearTimeout(state.wake);
      state.wake = 0;
    };
  }, [stateRef]);

  function step(_time: number, delta: number) {
    const state = stateRef.current;
    if (state.wake) {
      window.clearTimeout(state.wake);
      state.wake = 0;
    }
    const busy = drawHorizon(state, settings.current, surface.current, palette.current, delta, prefersReducedMotion());
    if (busy) return true;
    // Settled: sleep until the next arc or glint is due instead of spinning the loop.
    const at = state.nextEvent;
    if (Number.isFinite(at)) {
      state.wake = window.setTimeout(
        () => {
          state.wake = 0;
          state.clock = Math.max(state.clock, at);
          loop.kick();
        },
        Math.max(0, at - state.clock) * 1000,
      );
    }
    return false;
  }

  return (
    <section
      data-slot="geo-horizon"
      data-align={align}
      className={cn("relative isolate h-full min-h-[340px] w-full overflow-hidden bg-background text-foreground", className)}
      {...props}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 block size-full"
        style={{ maskImage: mask, WebkitMaskImage: mask }}
      />
      <div
        className={cn(
          "relative z-[2] flex flex-col gap-3 pt-10",
          align === "start" ? "items-start pr-4 pl-8 text-left" : "items-center px-4 text-center",
        )}
      >
        {children}
      </div>
    </section>
  );
}

/* Constants ------------------------------------------------------------------------------------------ */

const DEFAULT_CENTER: LatLon = { lat: 38, lon: -40 };
const CANVAS_OPTIONS = { maxDpr: 2 };
/**
 * The canvas fades in toward the bottom, so the text above the horizon sits on a clean background: fully transparent at
 * the top, opaque from 38 % down, or from just above the limb when a tall cap reaches higher.
 */
const skyMask = (capHeight: number) =>
  `linear-gradient(to bottom, transparent 0, #000 ${clamp((1 - capHeight) * 100 - 6, 8, 38).toFixed(1)}%)`;
/** Share of the component that has to be on screen before the `view` reveal plays. */
const ARM_RATIO = 0.35;

/** Lattice dots are this far apart (CSS px) where the globe faces the viewer; never closer than MIN_SPACING degrees. */
const DOT_PITCH = 4.5;
const MIN_SPACING = 0.35;
/** Lattice spacing snaps to 5 % steps, so resizing reuses cached lattices instead of rebuilding on every pixel. */
const SPACING_STEP = Math.log(1.05);
const DOT_SIZE = 1.6;

const REVEAL_SECONDS = 1.8;
/** The front runs a little past the farthest dot, so the last dots appear fully instead of waiting at the edge. */
const REVEAL_REACH = 1.12;
const LIMB_SECONDS = 1.1;

const ARC_SEGMENTS = 64;
const ARC_DOT_SPACING = 3.5;
const ARC_ALPHA = 0.6;
const COMET_SQUARES = 10;
const COMET_STEP = 1.9;
const GROW_SECONDS = 1.6;
const HOLD_SECONDS = 0.6;
const ERASE_SECONDS = 0.9;
const FLIGHT_SECONDS = GROW_SECONDS + HOLD_SECONDS + ERASE_SECONDS;
const MAX_FLIGHTS = 4;
/** Demo pairs are at least this far apart, so every arc reads as a trip. */
const MIN_DEMO_DEGREES = 15;
/** A place must face the viewer this much (view z) to start or end an arc: not on the horizon itself. */
const MIN_FACING = 0.15;
const ARC_EASE = cubicBezier(0.45, 0, 0.25, 1);

const LAUNCH_PING = { seconds: 0.4, radius: 14, width: 3, glow: 0.22, hot: 0.35 };
const LANDING_PING = { seconds: 0.8, radius: 36, width: 5, glow: 0.32, hot: 1 };

const GLINT_PERIOD = 7;
const GLINT_SIGMA = 70;
const GLINT_SPEED = 620;
const GLINT_EASE = cubicBezier(0.35, 0, 0.65, 1);
/** Positions (0..1 across ±3σ) of the gradient stops that approximate the glint's Gaussian. */
const GLINT_STOPS = [0, 0.12, 0.24, 0.36, 0.44, 0.5, 0.56, 0.64, 0.76, 0.88, 1];

/** Reduced motion: still arcs that change this often. */
const STILL_SECONDS = 4;
const STILL_ARCS = 3;

/** Positions on the dot colour ramp: lattice grey, accent, hot highlight. */
const TONE_ACCENT = 0.5;
const TONE_HOT = 1;

/* State ---------------------------------------------------------------------------------------------- */

interface HorizonSettings {
  connections: readonly HorizonConnection[] | undefined;
  centerLat: number;
  centerLon: number;
  capHeight: number;
  drift: boolean;
  driftSpeed: number;
  arcInterval: number;
  atmosphere: boolean;
  reveal: HorizonReveal;
}

const DEFAULT_SETTINGS: HorizonSettings = {
  connections: undefined,
  centerLat: DEFAULT_CENTER.lat,
  centerLon: DEFAULT_CENTER.lon,
  capHeight: 0.46,
  drift: true,
  driftSpeed: 1.2,
  arcInterval: 1.4,
  atmosphere: true,
  reveal: "view",
};

/** Screen geometry of the globe for the current size. The centre lies far below the component. */
interface HorizonGeometry {
  width: number;
  height: number;
  /** Screen y of the top of the limb. */
  limbTop: number;
  radius: number;
  cx: number;
  cy: number;
  /** Latitude that faces the viewer (at the disc centre) so `center` lands in the lower third of the cap. */
  facing: number;
}

/** The part of the sphere the canvas can show, relative to the view longitude. */
interface VisibleWindow {
  minLat: number;
  lonMin: number;
  lonMax: number;
  /** The pole is on screen: every longitude is visible. */
  all: boolean;
}

/** One arc between two places, from launch to erase. */
interface Flight {
  from: LatLon;
  to: LatLon;
  fromVector: Vec3;
  toVector: Vec3;
  /** World xyz of the lifted arc, ARC_SEGMENTS + 1 samples. */
  samples: Float32Array;
  /** Clock at launch; -Infinity for the still arcs of reduced motion. */
  start: number;
  xs: Float32Array;
  ys: Float32Array;
  /** 1 where the sample is behind the globe. */
  hidden: Uint8Array;
  table: ArcLengthTable | undefined;
}

/** A place the built-in demo may arc between: a demo city or, over open ocean, a land dot. */
interface DemoPlace extends LatLon {
  readonly weight: number;
}

/** A ring of light spreading over the lattice around a launch or a landing. */
interface Ping {
  x: number;
  y: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  width: number;
  amp: number;
  glow: number;
  hot: number;
  reach: number;
}

/** Everything the animation loop mutates. Lives in a ref, never in React state. */
interface HorizonState {
  /** Seconds of animation, advanced only while the loop runs, so arcs freeze off screen and continue after. */
  clock: number;
  armed: boolean;
  /** Clock when the reveal began, NaN before the first armed frame. */
  revealStart: number;
  revealAnimated: boolean;
  /** Accumulated drift in degrees, kept within [0, 360). */
  drift: number;
  lonSpring: Spring;
  latSpring: Spring;
  shownCenter: LatLon | null;
  flights: Flight[];
  still: Flight[];
  reducedMode: boolean;
  nextLaunch: number;
  launches: number;
  /** Next connection to try, for `connections` (round robin). */
  cursor: number;
  nextGlint: number;
  glintStart: number;
  nextStill: number;
  /** The next scheduled event while the loop sleeps, or Infinity. */
  nextEvent: number;
  wake: number;
  random: () => number;
  geometry: HorizonGeometry;
  view: GlobeView;
  window: VisibleWindow;
  windowKey: string;
  lattice: SphereLattice | null;
  latticeSpacing: number;
  latticeSouth: number;
  palette: GeoPalette | null;
  ink: GeoInk | null;
  hot: RGB;
  batch: DotBatch | null;
  pings: Ping[];
  pingCount: number;
  /** Demo places on the cap, refilled for every pick. */
  candidates: DemoPlace[];
  /** The view longitude of the last frame, for picks that need the visible window. */
  viewLon: number;
  /** Whether the canvas has something on it that needs clearing. */
  dirty: boolean;
}

function createHorizonState(): HorizonState {
  return {
    clock: 0,
    armed: false,
    revealStart: Number.NaN,
    revealAnimated: false,
    drift: 0,
    lonSpring: { position: 0, velocity: 0 },
    latSpring: { position: 0, velocity: 0 },
    shownCenter: null,
    flights: [],
    still: [],
    reducedMode: false,
    nextLaunch: Number.POSITIVE_INFINITY,
    launches: 0,
    cursor: 0,
    nextGlint: Number.POSITIVE_INFINITY,
    glintStart: Number.NEGATIVE_INFINITY,
    nextStill: 0,
    nextEvent: Number.POSITIVE_INFINITY,
    wake: 0,
    random: createRandom("geo-horizon"),
    geometry: { width: 0, height: 0, limbTop: 0, radius: 1, cx: 0, cy: 0, facing: 0 },
    view: { cx: 0, cy: 0, radius: 1, rotation: new Float64Array(9) },
    window: { minLat: -90, lonMin: -180, lonMax: 180, all: true },
    windowKey: "",
    lattice: null,
    latticeSpacing: 0,
    latticeSouth: 90,
    palette: null,
    ink: null,
    hot: [255, 255, 255],
    batch: null,
    pings: Array.from({ length: MAX_FLIGHTS * 2 }, () => ({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      radius: 0,
      width: 1,
      amp: 0,
      glow: 0,
      hot: 0,
      reach: 0,
    })),
    pingCount: 0,
    candidates: [],
    viewLon: 0,
    dirty: false,
  };
}

/* Frame ---------------------------------------------------------------------------------------------- */

/**
 * Advances the clock, the drift and the arcs, then draws one frame. Returns whether anything is still moving; when it
 * is not, `state.nextEvent` says when the loop should wake up again.
 */
function drawHorizon(
  state: HorizonState,
  config: HorizonSettings,
  surface: { context: CanvasRenderingContext2D; width: number; height: number } | null,
  palette: GeoPalette | null,
  delta: number,
  reduced: boolean,
): boolean {
  state.nextEvent = Number.POSITIVE_INFINITY;
  if (!surface || !palette) return false;
  const { context, width, height } = surface;
  state.clock += delta;
  if (palette !== state.palette) updateInk(state, palette);

  const geometry = measureGeometry(state.geometry, width, height, config.capHeight, config.centerLat);
  // Plain until earned: nothing is drawn before the reveal is armed. The lattice is built already, so the reveal's
  // first frames do not wait for it.
  if (!state.armed) {
    ensureLattice(state, geometry, geometry.facing, geometry.facing);
    if (state.dirty) context.clearRect(0, 0, width, height);
    state.dirty = false;
    return false;
  }
  if (Number.isNaN(state.revealStart)) beginReveal(state, config, reduced);
  if (reduced !== state.reducedMode) {
    state.reducedMode = reduced;
    state.flights.length = 0;
    state.still.length = 0;
    state.nextStill = state.clock;
  }

  const progress = state.revealAnimated && !reduced ? clamp((state.clock - state.revealStart) / REVEAL_SECONDS, 0, 1) : 1;
  const limbGrowth = state.revealAnimated && !reduced ? easeOutCubic((state.clock - state.revealStart) / LIMB_SECONDS) : 1;

  // Drift and the centre springs.
  if (config.drift && !reduced) state.drift = (state.drift + config.driftSpeed * delta + 360) % 360;
  const lonMoving = settleSpring(state.lonSpring, delta, reduced);
  const latMoving = settleSpring(state.latSpring, delta, reduced);
  const springing = lonMoving || latMoving;

  const facing = clamp(geometry.facing + state.latSpring.position, -89, 89);
  const viewLon = config.centerLon - state.drift + state.lonSpring.position;
  state.viewLon = viewLon;
  ensureLattice(state, geometry, facing, geometry.facing);
  const view = state.view;
  view.cx = geometry.cx;
  view.cy = geometry.cy;
  view.radius = geometry.radius;
  rotationFromView(viewLon, facing, view.rotation);

  // Arcs: flights while animated, a few still arcs with reduced motion.
  const hasSource = !config.connections || config.connections.length > 0;
  if (reduced) {
    if (state.clock >= state.nextStill) {
      pickStillArcs(state, config, geometry);
      state.nextStill = state.clock + STILL_SECONDS;
    }
  } else {
    launchFlights(state, config, geometry);
    let alive = 0;
    for (const flight of state.flights) if (state.clock - flight.start < FLIGHT_SECONDS) state.flights[alive++] = flight;
    state.flights.length = alive;
  }

  // The glint along the limb, every GLINT_PERIOD seconds once the reveal is done.
  const limbLength = 2 * Math.asin(Math.min(1, width / 2 / geometry.radius)) * geometry.radius;
  const glintSeconds = (limbLength + 6 * GLINT_SIGMA) / GLINT_SPEED;
  if (!reduced && state.clock >= state.nextGlint) {
    state.glintStart = state.nextGlint;
    state.nextGlint = Math.max(state.nextGlint + GLINT_PERIOD, state.clock + 1);
  }
  const glintAge = state.clock - state.glintStart;
  const glinting = !reduced && glintAge >= 0 && glintAge < glintSeconds;
  const glintAt = glinting ? -3 * GLINT_SIGMA + GLINT_EASE(glintAge / glintSeconds) * (limbLength + 6 * GLINT_SIGMA) : 0;

  // Draw.
  const ink = state.ink;
  const batch = state.batch;
  if (!ink || !batch) return false;
  context.clearRect(0, 0, width, height);
  state.dirty = true;
  if (config.atmosphere) drawAtmosphere(context, geometry, ink, smoothstep(0, 0.45, progress));
  drawLimb(context, geometry, ink, state.hot, limbGrowth);
  collectPings(state);
  drawLand(state, geometry, viewLon, progress, glinting ? glintAt : Number.NaN, batch);
  const flights = reduced ? state.still : state.flights;
  for (const flight of flights) drawFlight(context, state, flight, batch, ink, reduced);
  batch.flush(context);
  if (glinting) drawGlint(context, geometry, ink, state.hot, glintAt);

  const busy = !reduced && (config.drift || progress < 1 || limbGrowth < 1 || springing || state.flights.length > 0 || glinting);
  if (!busy) {
    if (reduced) state.nextEvent = hasSource ? state.nextStill : Number.POSITIVE_INFINITY;
    else state.nextEvent = Math.min(hasSource ? state.nextLaunch : Number.POSITIVE_INFINITY, state.nextGlint);
  }
  return busy;
}

/** Steps a centre spring toward 0 (jumps with reduced motion). Returns whether it is still moving. */
function settleSpring(spring: Spring, delta: number, reduced: boolean) {
  if (!reduced && (Math.abs(spring.position) > 0.001 || Math.abs(spring.velocity) > 0.001)) {
    springStep(spring, 0, delta, 36, 1);
    return true;
  }
  spring.position = 0;
  spring.velocity = 0;
  return false;
}

/** First armed frame: start the reveal clock and schedule the first arcs and the first glint. */
function beginReveal(state: HorizonState, config: HorizonSettings, reduced: boolean) {
  state.revealStart = state.clock;
  state.revealAnimated = config.reveal !== "none" && !reduced;
  // Two arcs are in flight when the reveal ends: the first leaves as the front passes the middle, the second follows.
  state.nextLaunch = state.clock + (state.revealAnimated ? 0.75 : 0.25);
  state.launches = 0;
  state.nextGlint = state.clock + (state.revealAnimated ? REVEAL_SECONDS - 0.1 : 2);
  state.nextStill = state.clock;
  state.reducedMode = reduced;
}

function updateInk(state: HorizonState, palette: GeoPalette) {
  const ink = geoInk(palette);
  state.palette = palette;
  state.ink = ink;
  // The highlight on dot fields: white in dark themes, the deep accent shade in light ones (the pale glint vanishes on white).
  state.hot = ink.hot;
  const stops: RGB[] = [ink.landStrong, ink.accent, state.hot];
  if (state.batch) state.batch.setRamp(stops);
  else state.batch = createDotBatch(16384, stops, { tones: 24, levels: 32 });
}

/* Geometry and lattice ------------------------------------------------------------------------------- */

/**
 * limbTop = height·(1 − capHeight), R = max(0.95·width, 1.25·height), centre (width/2, limbTop + R). The facing latitude
 * puts `centerLat` at screen y = height − 0.35·capHeight·height on the central meridian.
 */
function measureGeometry(out: HorizonGeometry, width: number, height: number, capHeight: number, centerLat: number) {
  out.width = width;
  out.height = height;
  out.limbTop = height * (1 - capHeight);
  out.radius = Math.max(0.95 * width, 1.25 * height, 1);
  out.cx = width / 2;
  out.cy = out.limbTop + out.radius;
  const anchorY = height - 0.35 * capHeight * height;
  const vy = clamp((out.cy - anchorY) / out.radius, -1, 1);
  out.facing = clamp(centerLat - toDegrees(Math.asin(vy)), -89, 89);
  return out;
}

/**
 * Recomputes the visible window when the geometry changes and swaps in a lattice that covers it. While the view springs
 * to a new centre, the lattice already covers the target too, and it keeps some slack, so a spring rebuilds it once
 * instead of at every few degrees.
 */
function ensureLattice(state: HorizonState, geometry: HorizonGeometry, facing: number, targetFacing: number) {
  const windowKey = `${geometry.width}|${geometry.height}|${geometry.cy.toFixed(2)}|${geometry.radius.toFixed(2)}|${facing.toFixed(3)}`;
  if (windowKey !== state.windowKey) {
    state.windowKey = windowKey;
    measureWindow(state.window, geometry, facing);
  }
  let need = state.window.minLat;
  if (Math.abs(targetFacing - facing) > 0.01) need = Math.min(need, measureWindow(targetWindow, geometry, targetFacing).minLat);
  need -= 3;
  const raw = Math.max(MIN_SPACING, spacingForRadius(geometry.radius, DOT_PITCH));
  const spacing = MIN_SPACING * Math.exp(Math.round(Math.log(raw / MIN_SPACING) / SPACING_STEP) * SPACING_STEP);
  const current = state.lattice;
  if (current && spacing === state.latticeSpacing && state.latticeSouth <= need && state.latticeSouth >= need - 25) return;
  const south = Math.max(-90, Math.floor((need - 2) / 5) * 5);
  state.latticeSpacing = spacing;
  state.latticeSouth = south;
  state.lattice = sphereLattice({ spacingDeg: spacing, method: "rows", landOnly: true, latRange: [south, 90], order: "longitude" });
}

const targetWindow: VisibleWindow = { minLat: -90, lonMin: -180, lonMax: 180, all: true };
const windowRotation = new Float64Array(9);

/**
 * The latitudes and relative longitudes the canvas can show. Drift only turns the globe about its axis, so this
 * depends on the size and the facing latitude alone. The extremes lie on the boundary of the visible region (the
 * canvas edges and the limb) unless the pole is on screen.
 */
function measureWindow(out: VisibleWindow, geometry: HorizonGeometry, facing: number) {
  const { width, height, cx, cy, radius } = geometry;
  const m = rotationFromView(0, facing, windowRotation);
  let minLat = 90;
  let lonMin = 180;
  let lonMax = -180;
  const visit = (sx: number, sy: number) => {
    const vx = (sx - cx) / radius;
    const vy = (cy - sy) / radius;
    const rho = vx * vx + vy * vy;
    if (rho > 1) return;
    const vz = Math.sqrt(1 - rho);
    const wx = m[0] * vx + m[3] * vy + m[6] * vz;
    const wy = m[1] * vx + m[4] * vy + m[7] * vz;
    const wz = m[2] * vx + m[5] * vy + m[8] * vz;
    const lat = toDegrees(Math.asin(clamp(wy, -1, 1)));
    const lon = toDegrees(Math.atan2(wx, wz));
    minLat = Math.min(minLat, lat);
    lonMin = Math.min(lonMin, lon);
    lonMax = Math.max(lonMax, lon);
  };
  const steps = 96;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    visit(width * t, height);
    visit(0, height * t);
    visit(width, height * t);
    const half = Math.asin(Math.min(1, width / 2 / radius));
    const angle = -Math.PI / 2 - half + 2 * half * t;
    visit(cx + Math.cos(angle) * radius * 0.9999, cy + Math.sin(angle) * radius * 0.9999);
  }
  const poleY = cy - Math.cos(facing * (Math.PI / 180)) * radius;
  const poleVisible = facing > 0 && poleY <= height;
  out.minLat = minLat;
  out.lonMin = lonMin - 3;
  out.lonMax = lonMax + 3;
  out.all = poleVisible || lonMax - lonMin > 330;
  return out;
}

/* Arcs ----------------------------------------------------------------------------------------------- */

const placePoint = createScreenPoint();
const placeVector: Vec3 = [0, 0, 0];

/** Whether a place faces the viewer well and lies inside the canvas, away from its edges. */
function onCap(state: HorizonState, geometry: HorizonGeometry, place: LatLon) {
  latLonToVector(place.lat, place.lon, placeVector);
  projectGlobe(state.view, placeVector, placePoint);
  return (
    placePoint.z > MIN_FACING &&
    placePoint.x >= 12 &&
    placePoint.x <= geometry.width - 12 &&
    placePoint.y >= geometry.limbTop + 4 &&
    placePoint.y <= geometry.height - 12
  );
}

const isPlace = (place: LatLon | undefined): place is LatLon => isValidLatLon(place);

const samePlace = (a: LatLon, b: LatLon) => Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(angleDelta(a.lon, b.lon)) < 1e-6;

/** Whether a pair (either direction) is already on screen, so the same arc never plays twice at once. */
function pairInFlight(flights: readonly Flight[], from: LatLon, to: LatLon) {
  return flights.some(
    (flight) =>
      (samePlace(flight.from, from) && samePlace(flight.to, to)) || (samePlace(flight.from, to) && samePlace(flight.to, from)),
  );
}

/** The next pair to draw: the next visible connection in order, or a weighted pair of visible demo cities. */
function pickPair(state: HorizonState, config: HorizonSettings, geometry: HorizonGeometry, busy: readonly Flight[]) {
  const connections = config.connections;
  if (connections) {
    const count = connections.length;
    for (let k = 0; k < count; k++) {
      const index = (state.cursor + k) % count;
      const connection = connections[index];
      if (!connection || !isPlace(connection.from) || !isPlace(connection.to)) continue;
      if (centralAngle(connection.from, connection.to) < 0.01) continue;
      if (pairInFlight(busy, connection.from, connection.to)) continue;
      if (!onCap(state, geometry, connection.from) || !onCap(state, geometry, connection.to)) continue;
      state.cursor = (index + 1) % count;
      return connection;
    }
    return null;
  }
  const candidates = state.candidates;
  candidates.length = 0;
  for (const city of DEMO_CITIES) if (onCap(state, geometry, city)) candidates.push(city);
  const pair = pickDemoPair(state, candidates, busy);
  if (pair) return pair;
  // Over open ocean (the Pacific) no two demo cities are on the cap: borrow a few land dots so the arcs keep going.
  addLandCandidates(state, geometry, candidates, 12);
  return pickDemoPair(state, candidates, busy);
}

/** A weighted pair of candidates at least MIN_DEMO_DEGREES apart that is not in flight, preferring fresh endpoints. */
function pickDemoPair(state: HorizonState, candidates: readonly DemoPlace[], busy: readonly Flight[]) {
  if (candidates.length < 2) return null;
  for (let attempt = 0; attempt < 24; attempt++) {
    const from = pickWeighted(state.random, candidates, (place) => place.weight);
    const to = pickWeighted(state.random, candidates, (place) => place.weight);
    if (from === to || toDegrees(centralAngle(from, to)) < MIN_DEMO_DEGREES) continue;
    if (pairInFlight(busy, from, to)) continue;
    // spread the arcs out: a place already at either end of an arc in flight is a last resort
    if (attempt < 16 && busy.some((flight) => samePlace(flight.from, from) || samePlace(flight.to, to) || samePlace(flight.from, to))) continue;
    return { from, to };
  }
  return null;
}

/** Adds up to `count` random land dots from the visible part of the lattice, as light-weight demo places. */
function addLandCandidates(state: HorizonState, geometry: HorizonGeometry, candidates: DemoPlace[], count: number) {
  const lattice = state.lattice;
  const buckets = lattice?.lonBuckets;
  if (!lattice || !buckets || lattice.count === 0) return;
  const visible = state.window;
  const first = visible.all ? 0 : Math.floor(state.viewLon + visible.lonMin + 180);
  const last = visible.all ? 359 : Math.floor(state.viewLon + visible.lonMax + 180);
  let added = 0;
  for (let attempt = 0; attempt < count * 6 && added < count; attempt++) {
    const bucket = (((first + Math.floor(state.random() * (last - first + 1))) % 360) + 360) % 360;
    const size = buckets[bucket + 1] - buckets[bucket];
    if (size <= 0) continue;
    const index = buckets[bucket] + Math.floor(state.random() * size);
    const place = { lat: lattice.lat[index], lon: lattice.lon[index], weight: 0.3 };
    if (!onCap(state, geometry, place)) continue;
    candidates.push(place);
    added++;
  }
}

function createFlight(from: LatLon, to: LatLon, start: number): Flight {
  // The apex climbs 4 % of the radius plus up to 16 % for the longest trips, so arcs between places near the horizon
  // rise clearly into the sky instead of running along the limb.
  const lift = 0.04 + (0.16 * centralAngle(from, to)) / Math.PI;
  return {
    from,
    to,
    fromVector: latLonToVector(from.lat, from.lon),
    toVector: latLonToVector(to.lat, to.lon),
    samples: globeArc(from, to, { segments: ARC_SEGMENTS, lift }),
    start,
    xs: new Float32Array(ARC_SEGMENTS + 1),
    ys: new Float32Array(ARC_SEGMENTS + 1),
    hidden: new Uint8Array(ARC_SEGMENTS + 1),
    table: undefined,
  };
}

function launchFlights(state: HorizonState, config: HorizonSettings, geometry: HorizonGeometry) {
  // After a long pause (off screen), pick up the rhythm from now instead of launching a backlog.
  if (state.nextLaunch < state.clock - config.arcInterval) state.nextLaunch = state.clock;
  while (state.clock >= state.nextLaunch) {
    if (state.flights.length < MAX_FLIGHTS) {
      const pair = pickPair(state, config, geometry, state.flights);
      if (pair) {
        state.flights.push(createFlight(pair.from, pair.to, state.nextLaunch));
        state.launches++;
      }
    }
    // the second arc follows the first closely, so two are in flight as the reveal ends
    state.nextLaunch += state.launches === 1 ? Math.min(0.7, config.arcInterval) : config.arcInterval;
  }
}

function pickStillArcs(state: HorizonState, config: HorizonSettings, geometry: HorizonGeometry) {
  const chosen: Flight[] = [];
  for (let i = 0; i < STILL_ARCS; i++) {
    const pair = pickPair(state, config, geometry, chosen);
    if (!pair) break;
    chosen.push(createFlight(pair.from, pair.to, Number.NEGATIVE_INFINITY));
  }
  state.still = chosen;
}

/** Fills `state.pings` with the launch and landing rings of the flights in progress, in screen and world space. */
function collectPings(state: HorizonState) {
  state.pingCount = 0;
  if (state.reducedMode) return;
  for (const flight of state.flights) {
    const age = state.clock - flight.start;
    if (age >= 0 && age < LAUNCH_PING.seconds) addPing(state, flight.fromVector, age / LAUNCH_PING.seconds, LAUNCH_PING);
    const landed = age - GROW_SECONDS;
    if (landed >= 0 && landed < LANDING_PING.seconds) addPing(state, flight.toVector, landed / LANDING_PING.seconds, LANDING_PING);
  }
}

function addPing(
  state: HorizonState,
  vector: Vec3,
  progress: number,
  shape: { radius: number; width: number; glow: number; hot: number },
) {
  if (state.pingCount >= state.pings.length) return;
  if (!projectGlobe(state.view, vector, placePoint)) return;
  const ping = state.pings[state.pingCount++];
  const fade = Math.pow(1 - progress, 1.2);
  ping.x = placePoint.x;
  ping.y = placePoint.y;
  ping.vx = vector[0];
  ping.vy = vector[1];
  ping.vz = vector[2];
  ping.radius = easeOutCubic(progress) * shape.radius;
  ping.width = shape.width;
  ping.amp = fade;
  ping.glow = shape.glow * fade * fade;
  ping.hot = shape.hot;
  // the screen distance never exceeds the surface distance, so this box is a safe cull
  ping.reach = ping.radius + shape.width * 2.5 + 6;
}

/* Drawing -------------------------------------------------------------------------------------------- */

/** A soft accent ring that peaks at the limb and fades into the sky, with a short fade inward. */
function drawAtmosphere(context: CanvasRenderingContext2D, geometry: HorizonGeometry, ink: GeoInk, strength: number) {
  if (strength <= 0) return;
  const { cx, cy, radius, width, height } = geometry;
  const inner = radius * 0.985;
  const outer = radius * 1.06;
  const peak = (ink.dark ? 0.22 : 0.14) * strength;
  const at = (radius - inner) / (outer - inner);
  const gradient = context.createRadialGradient(cx, cy, inner, cx, cy, outer);
  gradient.addColorStop(0, rgba(ink.accent, 0));
  gradient.addColorStop(at, rgba(ink.accent, peak));
  gradient.addColorStop(at + (1 - at) * 0.25, rgba(ink.accent, peak * 0.5));
  gradient.addColorStop(at + (1 - at) * 0.55, rgba(ink.accent, peak * 0.16));
  gradient.addColorStop(1, rgba(ink.accent, 0));
  const top = Math.max(0, geometry.limbTop - (outer - radius) - 2);
  context.fillStyle = gradient;
  context.fillRect(0, top, width, height - top);
}

/** The 1px limb. While the reveal runs it draws out from the middle, with a hot point at each end. */
function drawLimb(context: CanvasRenderingContext2D, geometry: HorizonGeometry, ink: GeoInk, hot: RGB, growth: number) {
  if (growth <= 0) return;
  const { cx, cy, radius, width } = geometry;
  const half = Math.asin(Math.min(1, (width / 2 + 6) / radius));
  const spread = half * growth;
  const top = -Math.PI / 2;
  context.beginPath();
  context.arc(cx, cy, radius, top - spread, top + spread);
  context.strokeStyle = rgba(ink.accent, 0.35 + 0.3 * (1 - growth));
  context.lineWidth = 1;
  context.stroke();
  if (growth >= 1) return;
  const strength = 1 - smoothstep(0.7, 1, growth);
  for (const side of [-1, 1]) {
    const angle = top + side * spread;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    const bloom = context.createRadialGradient(x, y, 0, x, y, 10);
    bloom.addColorStop(0, ink.dark ? rgba(hot, 0.55 * strength) : rgba(ink.accent, 0.28 * strength));
    bloom.addColorStop(0.4, rgba(ink.accent, (ink.dark ? 0.22 : 0.1) * strength));
    bloom.addColorStop(1, rgba(ink.accent, 0));
    context.fillStyle = bloom;
    context.fillRect(x - 10, y - 10, 20, 20);
    context.globalAlpha = strength;
    context.fillStyle = rgba(hot);
    context.fillRect(x - 1.25, y - 1.25, 2.5, 2.5);
    context.globalAlpha = 1;
  }
}

/**
 * The land lattice: only the longitude buckets the canvas can show, culled to the front and the canvas. Alpha grows from
 * the limb to the bottom edge; the reveal front, the pings and the glint brighten and tint dots on top of that.
 */
function drawLand(
  state: HorizonState,
  geometry: HorizonGeometry,
  viewLon: number,
  progress: number,
  glintAt: number,
  batch: DotBatch,
) {
  const lattice = state.lattice;
  const buckets = lattice?.lonBuckets;
  if (!lattice || !buckets) return;
  const { width, height, limbTop, radius, cx, cy } = geometry;
  const m = state.view.rotation;
  const xyz = lattice.xyz;
  const jitter = lattice.jitter;
  const span = Math.max(1, height - limbTop);
  const originX = width / 2;
  const maxDistance = Math.max(1, Math.hypot(width / 2, height - limbTop));
  const revealing = progress < 1;
  const growth = REVEAL_REACH * easeOutCubic(progress);
  const frontFade = 1 - smoothstep(0.75, 1, progress);
  const pings = state.pings;
  const pingCount = state.pingCount;
  const glinting = !Number.isNaN(glintAt);
  const glintStartAngle = -Math.PI / 2 - Math.asin(Math.min(1, width / 2 / radius));

  const visible = state.window;
  let first = 0;
  let last = 359;
  if (!visible.all) {
    first = Math.floor(viewLon + visible.lonMin + 180);
    last = Math.floor(viewLon + visible.lonMax + 180);
  }
  for (let b = first; b <= last; b++) {
    const bucket = ((b % 360) + 360) % 360;
    const end = buckets[bucket + 1];
    for (let i = buckets[bucket]; i < end; i++) {
      const wx = xyz[i * 3];
      const wy = xyz[i * 3 + 1];
      const wz = xyz[i * 3 + 2];
      const z = m[6] * wx + m[7] * wy + m[8] * wz;
      if (z <= 0) continue;
      const sx = cx + (m[0] * wx + m[1] * wy + m[2] * wz) * radius;
      if (sx < -2 || sx > width + 2) continue;
      const sy = cy - (m[3] * wx + m[4] * wy + m[5] * wz) * radius;
      if (sy > height + 2) continue;

      let alpha = 0.18 + 0.7 * Math.pow(clamp((sy - limbTop) / span, 0, 1), 0.8);
      let tone = 0;
      if (revealing) {
        // procedural reveal from the middle of the horizon: near dots first, jitter keeps the front uneven
        const n = Math.hypot(sx - originX, sy - limbTop) / maxDistance;
        const lead = growth - (n * 0.82 + jitter[i] * 0.18);
        if (lead <= 0) continue;
        const appear = Math.min(1, lead / 0.07);
        const front = Math.exp(-lead / 0.05) * frontFade;
        alpha = (alpha + 0.6 * front) * appear;
        tone = front;
      }
      for (let p = 0; p < pingCount; p++) {
        const ping = pings[p];
        const dx = sx - ping.x;
        const dy = sy - ping.y;
        if (dx > ping.reach || dx < -ping.reach || dy > ping.reach || dy < -ping.reach) continue;
        // distance on the surface, so rings near the horizon flatten into ellipses
        const distance = Math.sqrt(Math.max(0, 2 - 2 * (wx * ping.vx + wy * ping.vy + wz * ping.vz))) * radius;
        const ring = ringFront(distance, ping.radius, ping.width, jitter[i]) * ping.amp;
        const glow = distance < ping.radius ? ping.glow * (1 - distance / ping.radius) : 0;
        const lit = ring + glow;
        if (lit < 0.01) continue;
        alpha += ring * 0.85 + glow;
        tone = Math.max(tone, Math.min(1, TONE_ACCENT + ring * 0.5 * ping.hot) * Math.min(1, lit * 3));
      }
      if (glinting) {
        const dx = sx - cx;
        const dy = sy - cy;
        const depth = radius - Math.sqrt(dx * dx + dy * dy);
        if (depth < 16) {
          const along = (Math.atan2(dy, dx) - glintStartAngle) * radius - glintAt;
          const light = Math.exp(-0.5 * (along / GLINT_SIGMA) * (along / GLINT_SIGMA)) * Math.exp(-depth / 5);
          alpha += light * 0.8;
          tone = Math.max(tone, light);
        }
      }
      // foreshortened dots shrink toward the limb, so the packed rows read as a fine horizon instead of solid bands
      batch.add(sx, sy, DOT_SIZE * (0.6 + 0.4 * Math.min(1, z / 0.7)), tone, Math.min(1, alpha));
    }
  }
}

const arcPoint = { x: 0, y: 0 };

/** Position at distance `s` along a projected flight; false where that part of the arc is behind the globe. */
function flightPointAt(flight: Flight, s: number, out: { x: number; y: number }) {
  const table = flight.table;
  if (!table || table.count < 2) return false;
  const distances = table.distances;
  const d = clamp(s, 0, table.length);
  let low = 0;
  let high = table.count - 2;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (distances[middle] <= d) low = middle;
    else high = middle - 1;
  }
  const span = distances[low + 1] - distances[low];
  const t = span > 0 ? clamp((d - distances[low]) / span, 0, 1) : 0;
  out.x = table.xs[low] + (table.xs[low + 1] - table.xs[low]) * t;
  out.y = table.ys[low] + (table.ys[low + 1] - table.ys[low]) * t;
  return !flight.hidden[t < 0.5 ? low : low + 1];
}

/**
 * One arc: projects its lifted samples, then queues the dotted body (phase-locked to s = 0, so dots never crawl), the
 * comet at the head and the end markers. The comet's bloom is drawn straight away, under the dots.
 */
function drawFlight(
  context: CanvasRenderingContext2D,
  state: HorizonState,
  flight: Flight,
  batch: DotBatch,
  ink: GeoInk,
  still: boolean,
) {
  const { cx, cy, radius, rotation: m } = state.view;
  const samples = flight.samples;
  for (let k = 0; k <= ARC_SEGMENTS; k++) {
    const wx = samples[k * 3];
    const wy = samples[k * 3 + 1];
    const wz = samples[k * 3 + 2];
    const x = m[0] * wx + m[1] * wy + m[2] * wz;
    const y = m[3] * wx + m[4] * wy + m[5] * wz;
    const z = m[6] * wx + m[7] * wy + m[8] * wz;
    flight.xs[k] = cx + x * radius;
    flight.ys[k] = cy - y * radius;
    flight.hidden[k] = isOccluded(x, y, z) ? 1 : 0;
  }
  const table = buildArcLength(flight.xs, flight.ys, ARC_SEGMENTS + 1, flight.table);
  flight.table = table;
  const length = table.length;

  // The head grows, holds, then the tail erases toward the destination.
  const age = still ? FLIGHT_SECONDS / 2 : state.clock - flight.start;
  const grow = still ? 1 : ARC_EASE(age / GROW_SECONDS);
  const erase = still ? 0 : ARC_EASE((age - GROW_SECONDS - HOLD_SECONDS) / ERASE_SECONDS);
  const head = grow * length;
  const tail = erase * length;
  const bodyAlpha = ARC_ALPHA * (1 - 0.35 * erase);

  for (let k = Math.ceil(tail / ARC_DOT_SPACING); k * ARC_DOT_SPACING <= head; k++) {
    if (!flightPointAt(flight, k * ARC_DOT_SPACING, arcPoint)) continue;
    batch.add(arcPoint.x, arcPoint.y, DOT_SIZE, TONE_ACCENT, bodyAlpha);
  }

  // The comet: ten squares behind the head, hot at the front, while the arc is still travelling.
  const comet = still ? 0 : age < GROW_SECONDS ? 1 : Math.max(0, 1 - (age - GROW_SECONDS) / 0.18);
  if (comet > 0 && head > 0 && flightPointAt(flight, head, arcPoint)) {
    // a light halo on dark themes; on light ones a faint accent wash, so the head stays crisp instead of smudged
    const bloom = context.createRadialGradient(arcPoint.x, arcPoint.y, 0, arcPoint.x, arcPoint.y, 9);
    bloom.addColorStop(0, ink.dark ? rgba(state.hot, 0.32 * comet) : rgba(ink.accent, 0.16 * comet));
    bloom.addColorStop(0.45, rgba(ink.accent, (ink.dark ? 0.16 : 0.07) * comet));
    bloom.addColorStop(1, rgba(ink.accent, 0));
    context.fillStyle = bloom;
    context.fillRect(arcPoint.x - 9, arcPoint.y - 9, 18, 18);
    for (let c = 0; c < COMET_SQUARES; c++) {
      const s = head - c * COMET_STEP;
      if (s < Math.max(0, tail)) break;
      if (!flightPointAt(flight, s, arcPoint)) continue;
      const fall = c / (COMET_SQUARES - 1);
      batch.add(arcPoint.x, arcPoint.y, 2.6 - 0.9 * fall, TONE_HOT - (TONE_HOT - TONE_ACCENT) * fall, Math.pow(1 - fall * 0.85, 1.4) * comet);
    }
  }

  // End markers: the source while the arc is out, the destination once it has landed.
  const fade = 1 - erase;
  const source = still ? 1 : smoothstep(0, 0.15, age) * fade;
  if (source > 0 && projectGlobe(state.view, flight.fromVector, placePoint)) {
    batch.add(placePoint.x, placePoint.y, 2.6, TONE_ACCENT, 0.95 * source);
  }
  const landed = still ? 1 : clamp((age - GROW_SECONDS) / 0.35, 0, 1);
  if ((still || age >= GROW_SECONDS) && projectGlobe(state.view, flight.toVector, placePoint)) {
    const pop = (1 - landed) * (1 - landed);
    batch.add(placePoint.x, placePoint.y, 2.6 + 2.4 * pop, TONE_ACCENT + (TONE_HOT - TONE_ACCENT) * pop, fade);
  }
}

/** A Gaussian highlight (σ 70 px of limb length) that runs along the limb: a 6px bloom and a 1.5px core. */
function drawGlint(context: CanvasRenderingContext2D, geometry: HorizonGeometry, ink: GeoInk, hot: RGB, at: number) {
  const { cx, cy, radius, width } = geometry;
  const half = Math.asin(Math.min(1, width / 2 / radius));
  const start = -Math.PI / 2 - half;
  const middle = start + at / radius;
  const reach = (3 * GLINT_SIGMA) / radius;
  const from = Math.max(start, middle - reach);
  const to = Math.min(-Math.PI / 2 + half, middle + reach);
  if (to <= from) return;
  const x0 = cx + Math.cos(middle - reach) * radius;
  const y0 = cy + Math.sin(middle - reach) * radius;
  const x1 = cx + Math.cos(middle + reach) * radius;
  const y1 = cy + Math.sin(middle + reach) * radius;
  const core = context.createLinearGradient(x0, y0, x1, y1);
  const bloom = context.createLinearGradient(x0, y0, x1, y1);
  for (const u of GLINT_STOPS) {
    const sigmas = (u - 0.5) * 6;
    const g = Math.exp(-0.5 * sigmas * sigmas);
    core.addColorStop(u, rgba(hot, 0.9 * g));
    bloom.addColorStop(u, rgba(ink.accent, 0.25 * g));
  }
  context.beginPath();
  context.arc(cx, cy, radius, from, to);
  context.lineWidth = 6;
  context.strokeStyle = bloom;
  context.stroke();
  context.lineWidth = 1.5;
  context.strokeStyle = core;
  context.stroke();
}
