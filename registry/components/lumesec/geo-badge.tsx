"use client";

import * as React from "react";

import { fillSquare, useCanvas, type CanvasSurface } from "@/lib/lumesec/canvas";
import { usePalette } from "@/lib/lumesec/color";
import {
  angleDelta,
  GEO_TOKENS,
  geoInk,
  latLonToVector,
  ringFront,
  rotationFromView,
  sphereLattice,
  wrapLongitude,
  type GeoInk,
  type GeoPalette,
  type LatLon,
  type Rotation,
  type SphereLattice,
  type Vec3,
} from "@/lib/lumesec/geo";
import { DEMO_REGIONS, formatMs, type GeoRegion } from "@/lib/lumesec/geo-data";
import { clamp, mixRgb, rgba, smoothstep, TAU } from "@/lib/lumesec/math";
import {
  prefersReducedMotion,
  springStep,
  useAnimationLoop,
  useLazyRef,
  useReducedMotion,
  type Spring,
} from "@/lib/lumesec/motion";
import { ROLL_TIMING, RollText } from "@/lib/lumesec/roll-text";
import { cn } from "@/lib/utils";

/** Health of a region, shown as a coloured dot at the end of the badge. */
export type GeoBadgeStatus = "operational" | "degraded" | "outage";

/** Badge height: `sm` is 26 px with a 20 px globe, `md` is 30 px with a 24 px globe. */
export type GeoBadgeSize = "sm" | "md";

/**
 * Props of `GeoBadge`. Other `span` props go to the root. `aria-label` replaces the visually hidden reading, for
 * example to translate it.
 */
export interface GeoBadgeProps extends Omit<React.ComponentProps<"span">, "onClick" | "ref" | "children"> {
  /**
   * The region to show: an id looked up in `regions` (`"eu-central"`), or a region object
   * `{ id, label, city, lat, lon, timeZone }`. An id that is not in `regions` shows the raw id and leaves the globe
   * where it is, without a marker.
   */
  region?: string | GeoRegion;
  /** Lookup list for string ids. */
  regions?: readonly GeoRegion[];
  /** Round trip to the region in milliseconds, shown after the name. Omit to hide it. */
  latency?: number;
  /** Adds a status dot: green when operational, amber when degraded, red during an outage. */
  status?: GeoBadgeStatus;
  /** `sm` is 26 px tall with 12 px text, `md` is 30 px tall with 12.5 px text. */
  size?: GeoBadgeSize;
  /** Text shown instead of the region's label. */
  label?: string;
  /** Renders the badge as a native `button` and calls this on click. */
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** The root element: a `span`, or a `button` when `onClick` is set. */
  ref?: React.Ref<HTMLElement>;
}

/**
 * A pill with a tiny dotted globe, a region name and its latency, for headers, footers and status bars. When the
 * region changes, the globe turns to it on a slightly under-damped spring and settles, then a ring of light pings
 * across its dots from the region and spills a few sparks past the globe's edge. The name rolls in the direction of
 * the turn and each digit of the latency rolls toward the new value. At rest nothing moves.
 *
 * @example
 * <GeoBadge region="eu-central" latency={18} status="operational" />
 */
export function GeoBadge({
  region = "eu-central",
  regions = DEMO_REGIONS,
  latency,
  status,
  size = "md",
  label,
  onClick,
  className,
  ref,
  "aria-label": ariaLabel,
  ...props
}: GeoBadgeProps) {
  const reducedMotion = useReducedMotion();
  const resolved = typeof region === "string" ? (regions.find((item) => item.id === region) ?? null) : region;
  const id = typeof region === "string" ? region : region.id;
  const text = label ?? resolved?.label ?? id;
  // a region without a usable position keeps the globe where it is, like an unknown id
  const located = resolved !== null && Number.isFinite(resolved.lat) && Number.isFinite(resolved.lon);
  const lat = located ? resolved.lat : null;
  const lon = located ? resolved.lon : null;

  // The name rolls up for an eastward turn and down for a westward one (derived during render, so it rolls in the
  // same paint as the change).
  const [roll, setRoll] = React.useState({ text, lon, direction: 1 });
  if (roll.text !== text || (lon !== null && roll.lon !== lon)) {
    const direction = lon !== null && roll.lon !== null && angleDelta(roll.lon, lon) < 0 ? -1 : 1;
    setRoll({ text, lon: lon ?? roll.lon, direction: roll.text !== text ? direction : roll.direction });
  }

  // Digits roll up when the latency rises and down when it falls.
  const shown = latency !== undefined && Number.isFinite(latency) ? Math.max(0, latency) : null;
  const [tick, setTick] = React.useState({ value: shown, direction: 1 });
  if (tick.value !== shown) {
    setTick({ value: shown, direction: shown !== null && tick.value !== null && shown < tick.value ? -1 : 1 });
  }
  const reading = shown === null ? null : splitReading(formatMs(shown));

  // The reading lives in a visually hidden span rather than in `aria-label`: a plain `span` has no role, so screen
  // readers ignore a label on it, while its text is read in both root elements.
  const spoken =
    ariaLabel ??
    [
      `Region ${text}`,
      resolved && resolved.city && resolved.city !== text ? resolved.city : null,
      reading ? `${reading.number} ${reading.unit === "s" ? "seconds" : "milliseconds"}` : null,
      status ?? null,
    ]
      .filter(Boolean)
      .join(", ");

  // One ref type for both root elements: the handle is the rendered node, re-read on every commit (the element type
  // changes with `onClick`).
  const rootRef = React.useRef<HTMLElement | null>(null);
  const setRoot = React.useCallback((node: HTMLElement | null) => {
    rootRef.current = node;
  }, []);
  const asButton = onClick !== undefined;
  React.useImperativeHandle(ref, () => rootRef.current!);

  const metrics = SIZES[size];
  const content = (
    <>
      <BadgeGlobe lat={lat} lon={lon} size={metrics.globe} dots={metrics.dots} sparks={metrics.sparks} />
      <span aria-hidden="true" className="inline-flex items-baseline gap-2">
        <RegionLabel text={text} direction={roll.direction} animate={!reducedMotion} />
        {reading ? (
          <>
            <span className="size-[3px] shrink-0 self-center rounded-full bg-muted-foreground/45" />
            <span className="inline-flex items-baseline gap-[0.3em]">
              <RollingNumber text={reading.number} direction={tick.direction} animate={!reducedMotion} />
              <RollText text={reading.unit} direction={tick.direction} animate={!reducedMotion} className="text-muted-foreground" />
            </span>
          </>
        ) : null}
      </span>
      {status ? <StatusDot status={status} /> : null}
      <span className="sr-only">{spoken}</span>
    </>
  );

  const rootClass = cn(
    "relative inline-flex shrink-0 items-center rounded-full border border-border bg-card pl-[3px] align-middle font-sans leading-none whitespace-nowrap text-foreground [-webkit-tap-highlight-color:transparent]",
    metrics.root,
    asButton &&
      "cursor-pointer outline-none [transition:border-color_.2s_ease,transform_.15s_cubic-bezier(.2,.8,.2,1)] select-none hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec active:scale-[.97] motion-reduce:transition-none",
    className,
  );

  if (asButton) {
    return (
      <button type="button" ref={setRoot} data-slot="geo-badge" data-size={size} data-status={status} onClick={onClick} className={rootClass} {...props}>
        {content}
      </button>
    );
  }
  return (
    <span ref={setRoot} data-slot="geo-badge" data-size={size} data-status={status} className={rootClass} {...props}>
      {content}
    </span>
  );
}

/* Globe ------------------------------------------------------------------------------------------------ */

interface BadgeGlobeProps {
  /** Latitude of the region, or null when the region is unknown (the globe stays where it is, without a marker). */
  lat: number | null;
  lon: number | null;
  /** Diameter in CSS px. */
  size: number;
  /** Dots on the whole sphere; about half face the viewer. */
  dots: number;
  /** Sparks the ping throws past the globe's edge. */
  sparks: number;
}

/**
 * The dotted globe. Turns to the region on a spring, then pings once from it; the loop stops when everything has
 * settled. The server renders the disc outline only; the dots appear after mount.
 */
function BadgeGlobe({ lat, lon, size, dots, sparks }: BadgeGlobeProps) {
  const wrapRef = React.useRef<HTMLSpanElement>(null);
  const globeRef = React.useRef<HTMLCanvasElement>(null);
  const effectsRef = React.useRef<HTMLCanvasElement>(null);
  // created on first use, facing the first region; later regions turn it
  const motionRef = useLazyRef(() => createGlobeState(lat, lon));

  const loop = useAnimationLoop(wrapRef, step);
  const colors = usePalette(wrapRef, GEO_TOKENS, () => loop.kick());
  const globe = useCanvas(globeRef, () => loop.kick());
  const effects = useCanvas(effectsRef, () => loop.kick());

  // A new region: turn the short way round, then ping once the turn has settled.
  React.useEffect(() => {
    const state = motionRef.current;
    if (lat === null || lon === null) {
      if (state.marker) {
        state.marker = null;
        loop.kick();
      }
      return;
    }
    if (state.marker && state.marker.lat === lat && state.marker.lon === lon) return;
    state.marker = { lat, lon };
    state.yawTarget = state.yaw.position + angleDelta(state.yaw.position, lon);
    state.pitchTarget = clamp(lat, -PITCH_LIMIT, PITCH_LIMIT);
    if (prefersReducedMotion()) {
      jumpToTarget(state);
      state.pingPending = false;
    } else {
      state.pingPending = true;
    }
    loop.kick();
  }, [lat, lon, loop, motionRef]);

  function step(time: number, delta: number) {
    const state = motionRef.current;
    const now = time * 1000;
    const reduced = prefersReducedMotion();

    if (reduced) {
      jumpToTarget(state);
    } else {
      springStep(state.yaw, state.yawTarget, delta, TURN_STIFFNESS, TURN_DAMPING);
      springStep(state.pitch, state.pitchTarget, delta, TURN_STIFFNESS, TURN_DAMPING);
    }
    // the ring fires as the globe lands, the last ripple of the overshoot still fading under it
    if (state.pingPending && !isTurning(state, LAND_DEGREES, LAND_SPEED)) {
      state.pingPending = false;
      if (!reduced) firePing(state, now, sparks);
    }
    const turning = isTurning(state, SETTLE_DEGREES, SETTLE_SPEED);
    if (!turning) {
      // the residual error is a fraction of a pixel; land exactly and keep the yaw bounded
      jumpToTarget(state);
      state.yaw.position = wrapLongitude(state.yaw.position);
      state.yawTarget = state.yaw.position;
    }
    if (reduced && state.pingStart >= 0) {
      state.pingStart = -1;
      state.pending = [];
      state.sparks = [];
    }

    const palette = colors.current;
    if (!palette) return turning;
    if (state.inkSource !== palette) {
      state.ink = geoInk(palette);
      state.inkSource = palette;
    }
    const ink = state.ink;
    if (!ink) return turning;

    rotationFromView(state.yaw.position, state.pitch.position, state.rotation);
    const pinging = state.pingStart >= 0 && now - state.pingStart < PING_TOTAL;
    if (!pinging) state.pingStart = -1;
    const globeSurface = globe.current;
    if (globeSurface) drawGlobe(globeSurface, badgeLattice(dots), state, ink, now);
    const effectsSurface = effects.current;
    const sparksLive = effectsSurface ? drawSparks(effectsSurface, state, ink, now, delta, size) : false;
    return turning || pinging || sparksLive;
  }

  /** The globe has landed on the region: rings out of the marker, a border pop on the pill. */
  function firePing(state: GlobeState, now: number, count: number) {
    if (!state.marker) return;
    state.pingStart = now;
    latLonToVector(state.marker.lat, state.marker.lon, state.origin);
    state.pending = limbSparks(state, count, size / 2);
    const pill = wrapRef.current?.parentElement;
    if (pill && typeof pill.animate === "function") pill.animate(PILL_POP_KEYFRAMES, { duration: 700, easing: "cubic-bezier(.25,.7,.3,1)" });
  }

  const outline = size / 2 - 0.375;
  return (
    <span ref={wrapRef} aria-hidden="true" className="relative block shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 block size-full overflow-visible">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={outline}
          strokeWidth={0.75}
          className="fill-[color-mix(in_srgb,var(--muted)_55%,transparent)] stroke-border"
        />
      </svg>
      <canvas ref={globeRef} className="absolute inset-0 block size-full" />
      <canvas
        ref={effectsRef}
        className="pointer-events-none absolute z-[1] block"
        style={{ top: -FX, left: -FX, width: size + FX * 2, height: size + FX * 2 }}
      />
    </span>
  );
}

/* Label ---------------------------------------------------------------------------------------------- */

/**
 * The region name. It rolls in the direction of the turn while its slot springs to the new width, so the pill stays
 * snug around the text and never jumps. The width is only set while it animates; at rest the text sizes the slot.
 */
function RegionLabel({ text, direction, animate }: { text: string; direction: number; animate: boolean }) {
  const boxRef = React.useRef<HTMLSpanElement>(null);
  const sizerRef = React.useRef<HTMLSpanElement>(null);
  /** Natural width of the current text, kept current when web fonts load after mount. */
  const width = React.useRef<number | null>(null);
  const resize = React.useRef<Animation | null>(null);

  React.useEffect(() => {
    const sizer = sizerRef.current;
    if (!sizer || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      width.current = sizer.getBoundingClientRect().width;
    });
    observer.observe(sizer);
    return () => observer.disconnect();
  }, []);

  React.useLayoutEffect(() => {
    const box = boxRef.current;
    const sizer = sizerRef.current;
    if (!box || !sizer) return;
    const next = sizer.getBoundingClientRect().width;
    // start from the width on screen, which may be mid-way through the previous change
    const from = resize.current ? box.getBoundingClientRect().width : width.current;
    width.current = next;
    resize.current?.cancel();
    resize.current = null;
    if (from === null || Math.abs(from - next) < 0.5 || !animate || prefersReducedMotion() || typeof box.animate !== "function") return;
    const animation = box.animate([{ width: `${from}px` }, { width: `${next}px` }], { duration: ROLL_TIMING.duration, easing: WIDTH_EASING });
    animation.onfinish = () => {
      if (resize.current === animation) resize.current = null;
    };
    resize.current = animation;
  }, [text, animate]);

  return (
    <span ref={boxRef} className="relative flex min-w-0 font-medium [clip-path:inset(-8px_-1px)]">
      <RollText text={text} direction={direction} animate={animate} />
      <span ref={sizerRef} className="invisible absolute top-0 left-0 whitespace-nowrap">
        {text}
      </span>
    </span>
  );
}

/* Latency digits --------------------------------------------------------------------------------------- */

/**
 * A mechanical readout: one rolling column per character, counted from the right so the units keep their place.
 * Columns that appear or disappear on the left grow or shrink, so the pill widens smoothly instead of jumping.
 */
function RollingNumber({ text, direction, animate }: { text: string; direction: number; animate: boolean }) {
  const chars = Array.from(text);
  const columns = Math.max(MIN_COLUMNS, chars.length);
  return (
    <span className="inline-flex items-baseline font-mono tabular-nums">
      {Array.from({ length: columns }, (_, i) => {
        const position = columns - 1 - i;
        const char = chars[chars.length - 1 - position] ?? "";
        return (
          <span
            key={position}
            className="inline-flex min-w-0 justify-end [clip-path:inset(-8px_0)] [transition:width_.34s_cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none"
            style={{ width: char ? "1ch" : "0ch" }}
          >
            <RollText text={char} direction={direction} animate={animate} className="justify-items-end" />
          </span>
        );
      })}
    </span>
  );
}

/* Status dot ------------------------------------------------------------------------------------------- */

/** The status dot. A change of status pops it and sends one ripple out; degraded and outage carry a soft halo. */
function StatusDot({ status }: { status: GeoBadgeStatus }) {
  const dotRef = React.useRef<HTMLSpanElement>(null);
  const rippleRef = React.useRef<HTMLSpanElement>(null);
  const previous = React.useRef(status);

  React.useEffect(() => {
    if (previous.current === status) return;
    previous.current = status;
    if (prefersReducedMotion()) return;
    const dot = dotRef.current;
    const ripple = rippleRef.current;
    if (dot && typeof dot.animate === "function") dot.animate(DOT_POP_KEYFRAMES, { duration: 460, easing: "cubic-bezier(.2,1.5,.4,1)" });
    if (ripple && typeof ripple.animate === "function") ripple.animate(RIPPLE_KEYFRAMES, { duration: 720, easing: "cubic-bezier(.1,.75,.3,1)" });
  }, [status]);

  return (
    <span aria-hidden="true" className="relative grid size-1.5 shrink-0 place-items-center">
      <span ref={rippleRef} className={cn("absolute inset-0 rounded-full border opacity-0", STATUS_RIPPLE[status])} />
      <span ref={dotRef} className={cn("block size-1.5 rounded-full [transition:background-color_.3s_ease,box-shadow_.3s_ease]", STATUS_DOT[status])} />
    </span>
  );
}

/* Constants -------------------------------------------------------------------------------------------- */

/**
 * Per size: the pill, the globe diameter, the lattice and the sparks. The lattices keep about 2.7 device pixels between
 * dots at the centre on a 2x screen, dense enough for the continents to read at this size.
 */
const SIZES: Record<GeoBadgeSize, { root: string; globe: number; dots: number; sparks: number }> = {
  md: { root: "h-[30px] gap-2 pr-3 text-[12.5px]", globe: 24, dots: 480, sparks: 9 },
  sm: { root: "h-[26px] gap-1.5 pr-2.5 text-[12px]", globe: 20, dots: 360, sparks: 7 },
};

const STATUS_DOT: Record<GeoBadgeStatus, string> = {
  operational: "bg-lumesec-success",
  degraded: "bg-lumesec-warning shadow-[0_0_6px_color-mix(in_srgb,var(--lumesec-warning)_70%,transparent)]",
  outage: "bg-destructive shadow-[0_0_6px_color-mix(in_srgb,var(--destructive)_70%,transparent)]",
};

const STATUS_RIPPLE: Record<GeoBadgeStatus, string> = {
  operational: "border-lumesec-success",
  degraded: "border-lumesec-warning",
  outage: "border-destructive",
};

/** The latency keeps at least this many columns mounted, so the hundreds can roll in rather than appear. */
const MIN_COLUMNS = 4;

/** The globe's centre latitude stays within this, so polar regions do not tip the globe over. */
const PITCH_LIMIT = 50;
/** The badge spring: a quick turn with a small overshoot. */
const TURN_STIFFNESS = 520;
const TURN_DAMPING = 0.72;
/** The turn counts as settled below this error (degrees) and speed (degrees per second). */
const SETTLE_DEGREES = 0.5;
const SETTLE_SPEED = 2;
/**
 * The ping fires once the globe has visibly landed: under 2.5° (half a pixel at the centre) and 60°/s. Waiting for the
 * settle threshold would leave a quarter second of stillness between the landing and the ring.
 */
const LAND_DEGREES = 2.5;
const LAND_SPEED = 60;

/** One ring takes this long (ms) to cross the visible half of the globe. */
const PING_DURATION = 600;
/** The echo ring follows this much later (ms) at this strength. */
const PING_ECHO_DELAY = 120;
const PING_ECHO_STRENGTH = 0.55;
const PING_TOTAL = PING_DURATION + PING_ECHO_DELAY;
/** How far the ring travels, as arc length over the radius: just past the limb (π/2). */
const PING_REACH = 1.72;
/** Ring width in px, and how far (px) the dots' jitter lets the front run ahead or behind. */
const RING_WIDTH = 1.6;
const RING_UNEVENNESS = 2;
/** How far the effects canvas reaches past the globe on every side (px). */
const FX = 14;

/** The label slot's width follows the roll without overshoot. */
const WIDTH_EASING = "cubic-bezier(.2,.85,.25,1)";

const accentMix = (percent: number) => `color-mix(in srgb, var(--lumesec) ${percent}%, transparent)`;

const PILL_POP_KEYFRAMES: Keyframe[] = [
  { borderColor: "color-mix(in srgb, var(--lumesec) 55%, var(--border))", boxShadow: `0 0 0 1px ${accentMix(30)}, 0 0 14px -3px ${accentMix(28)}` },
  { borderColor: "var(--border)", boxShadow: "0 0 0 1px transparent, 0 0 14px -3px transparent" },
];

const DOT_POP_KEYFRAMES: Keyframe[] = [{ transform: "scale(.4)" }, { transform: "scale(1.35)", offset: 0.45 }, { transform: "scale(1)" }];

const RIPPLE_KEYFRAMES: Keyframe[] = [
  { opacity: 0.9, transform: "scale(1)" },
  { opacity: 0, transform: "scale(3.2)" },
];

/* Motion state and drawing ----------------------------------------------------------------------------- */

/** A spark waiting for the ring to reach its point on the limb. */
interface PendingSpark {
  /** Screen angle of the limb point, radians, counter-clockwise from the right. */
  angle: number;
  /** Arc distance (px) from the ping origin to that limb point, less the front's jitter. */
  arc: number;
  speed: number;
  life: number;
  size: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
}

/** Everything the animation loop mutates. Lives in a ref, never in React state. */
interface GlobeState {
  /** Centre longitude of the view (degrees, unbounded while turning). */
  yaw: Spring;
  /** Centre latitude of the view, clamped to ±PITCH_LIMIT. */
  pitch: Spring;
  yawTarget: number;
  pitchTarget: number;
  /** The region's point, or null for an unknown region. */
  marker: LatLon | null;
  /** Set by a region change; the ping fires once the turn settles. */
  pingPending: boolean;
  /** Start of the current ping in ms, or -1. */
  pingStart: number;
  /** Unit vector of the ping origin. Fixed for the ping, so a new turn carries the old ring away with the globe. */
  origin: Vec3;
  pending: PendingSpark[];
  sparks: Spark[];
  /** Whether the effects canvas has something on it that needs clearing. */
  fxDirty: boolean;
  rotation: Rotation;
  inkSource: GeoPalette | null;
  ink: GeoInk | null;
}

function createGlobeState(lat: number | null, lon: number | null): GlobeState {
  const known = lat !== null && lon !== null;
  const yaw = known ? lon : 10;
  const pitch = known ? clamp(lat, -PITCH_LIMIT, PITCH_LIMIT) : 20;
  return {
    yaw: { position: yaw, velocity: 0 },
    pitch: { position: pitch, velocity: 0 },
    yawTarget: yaw,
    pitchTarget: pitch,
    marker: known ? { lat, lon } : null,
    pingPending: false,
    pingStart: -1,
    origin: [0, 0, 1],
    pending: [],
    sparks: [],
    fxDirty: false,
    rotation: new Float64Array(9),
    inkSource: null,
    ink: null,
  };
}

/** Whether either spring is still further than `degrees` from its target or faster than `speed`. */
function isTurning(state: GlobeState, degrees: number, speed: number) {
  return (
    Math.abs(state.yawTarget - state.yaw.position) >= degrees ||
    Math.abs(state.yaw.velocity) >= speed ||
    Math.abs(state.pitchTarget - state.pitch.position) >= degrees ||
    Math.abs(state.pitch.velocity) >= speed
  );
}

function jumpToTarget(state: GlobeState) {
  state.yaw.position = state.yawTarget;
  state.yaw.velocity = 0;
  state.pitch.position = state.pitchTarget;
  state.pitch.velocity = 0;
}

/** '18 ms' → { number: '18', unit: 'ms' }; '1.24 s' → { number: '1.24', unit: 's' }. */
function splitReading(text: string) {
  const space = text.lastIndexOf(" ");
  return space < 0 ? { number: text, unit: "" } : { number: text.slice(0, space), unit: text.slice(space + 1) };
}

/** Front of a ring (arc px from the origin) `elapsed` ms after it starts: fast out of the marker, easing at the limb. */
function ringRadius(elapsed: number, radius: number) {
  const t = clamp(elapsed / PING_DURATION, 0, 1);
  return PING_REACH * radius * (1 - (1 - t) * (1 - t));
}

/** Strength of a ring: full while it crosses the globe, fading as it passes the limb. */
const ringStrength = (elapsed: number) => (elapsed < 0 ? 0 : 1 - smoothstep(0.72, 1, elapsed / PING_DURATION));

/**
 * Sparks for the limb points the first ring will cross, on the left, top and bottom of the globe (the side that faces
 * the pill's edge; the label sits to the right). Each waits until the ring reaches its point.
 */
function limbSparks(state: GlobeState, count: number, radius: number): PendingSpark[] {
  const m = state.rotation;
  const [x, y, z] = state.origin;
  // the origin in view space (+x right, +y up), with the rotation the globe settled on
  rotationFromView(state.yawTarget, state.pitchTarget, m);
  const ox = m[0] * x + m[1] * y + m[2] * z;
  const oy = m[3] * x + m[4] * y + m[5] * z;
  const list: PendingSpark[] = [];
  const offset = Math.random() * TAU;
  for (let i = 0; i < count; i++) {
    const angle = offset + ((i + Math.random() * 0.7) / count) * TAU;
    // skip the wedge that points at the label
    if (Math.cos(angle) > 0.45) continue;
    const reach = Math.acos(clamp(ox * Math.cos(angle) + oy * Math.sin(angle), -1, 1)) * radius;
    list.push({
      angle,
      arc: reach - Math.random() * RING_UNEVENNESS,
      speed: 34 + Math.random() * 46,
      life: 0.32 + Math.random() * 0.3,
      size: Math.random() < 0.3 ? 1.5 : 1,
    });
  }
  return list;
}

const markerScratch: Vec3 = [0, 0, 0];

/** One lattice per size, shared by every badge on the page (Fibonacci points with the land flag of the world mask). */
const lattices = new Map<number, SphereLattice>();
function badgeLattice(count: number) {
  let lattice = lattices.get(count);
  if (!lattice) {
    lattice = sphereLattice({ count, method: "fibonacci", landOnly: false });
    lattices.set(count, lattice);
  }
  return lattice;
}

/**
 * The dots of the facing half (land 1.1 px, water 0.6 px, both fading toward the limb), the ping rings and the region
 * marker. Ring dots grow, take the accent and, at the crest, the highlight colour.
 */
function drawGlobe(surface: CanvasSurface, dots: SphereLattice, state: GlobeState, ink: GeoInk, now: number) {
  const { context, width, height, dpr } = surface;
  context.clearRect(0, 0, width, height);
  const m = state.rotation;
  const radius = width / 2;
  const cx = width / 2;
  const cy = height / 2;

  const pinging = state.pingStart >= 0;
  const elapsed = pinging ? now - state.pingStart : 0;
  const front = ringRadius(elapsed, radius);
  const echoFront = ringRadius(elapsed - PING_ECHO_DELAY, radius);
  const strength = ringStrength(elapsed);
  const echoStrength = ringStrength(elapsed - PING_ECHO_DELAY) * PING_ECHO_STRENGTH;
  // land the first ring has passed keeps a faint accent for a moment
  const wake = pinging ? 0.22 * Math.exp(-elapsed / 240) : 0;
  const [ox, oy, oz] = state.origin;
  const landStyle = rgba(ink.landStrong);
  const waterStyle = rgba(ink.land);

  for (let i = 0; i < dots.count; i++) {
    const x = dots.xyz[i * 3];
    const y = dots.xyz[i * 3 + 1];
    const z = dots.xyz[i * 3 + 2];
    const depth = m[6] * x + m[7] * y + m[8] * z;
    if (depth <= 0.02) continue;
    const sx = cx + (m[0] * x + m[1] * y + m[2] * z) * radius;
    const sy = cy - (m[3] * x + m[4] * y + m[5] * z) * radius;
    const land = dots.land[i] === 1;
    let size = land ? 1.1 : 0.6;
    let alpha = land ? 0.35 + 0.65 * depth : 0.14 * depth;
    let style = land ? landStyle : waterStyle;

    if (pinging) {
      const distance = Math.acos(clamp(x * ox + y * oy + z * oz, -1, 1)) * radius;
      const jitter = dots.jitter[i];
      const light = Math.min(
        1,
        strength * ringFront(distance, front, RING_WIDTH, jitter, RING_UNEVENNESS) +
          echoStrength * ringFront(distance, echoFront, RING_WIDTH, jitter, RING_UNEVENNESS),
      );
      const trail = land && distance < front - RING_WIDTH ? wake : 0;
      const glow = Math.max(light, trail);
      if (glow > 0.03) {
        size += light * (land ? 0.8 : 0.7);
        alpha += (Math.min(1, 0.45 + depth) - alpha) * glow;
        const base = land ? ink.landStrong : ink.land;
        const tinted = mixRgb(base, ink.accent, Math.min(1, glow * 1.5));
        style = rgba(mixRgb(tinted, ink.hot, smoothstep(0.55, 1, light) * 0.75));
      }
    }

    context.globalAlpha = alpha;
    context.fillStyle = style;
    fillSquare(context, sx, sy, size, dpr);
  }
  context.globalAlpha = 1;

  const marker = state.marker;
  if (!marker) return;
  const point = latLonToVector(marker.lat, marker.lon, markerScratch);
  const depth = m[6] * point[0] + m[7] * point[1] + m[8] * point[2];
  if (depth <= 0) return;
  const mx = cx + (m[0] * point[0] + m[1] * point[1] + m[2] * point[2]) * radius;
  const my = cy - (m[3] * point[0] + m[4] * point[1] + m[5] * point[2]) * radius;
  const flash = pinging ? Math.exp(-elapsed / 220) : 0;
  const fade = smoothstep(0, 0.25, depth);
  const glowRadius = 6 + 2 * flash;
  const glow = context.createRadialGradient(mx, my, 0, mx, my, glowRadius);
  glow.addColorStop(0, rgba(ink.accent, (0.35 + 0.25 * flash) * fade));
  glow.addColorStop(1, rgba(ink.accent, 0));
  context.fillStyle = glow;
  context.fillRect(mx - glowRadius, my - glowRadius, glowRadius * 2, glowRadius * 2);
  context.globalAlpha = fade;
  context.fillStyle = rgba(mixRgb(ink.accent, ink.hot, flash * 0.6));
  fillSquare(context, mx, my, 2.4 + 1.2 * flash, dpr);
  context.globalAlpha = 1;
}

/**
 * Sparks thrown off the limb where the first ring leaves the globe, on the canvas that reaches past it. Returns
 * whether any spark is alive or still waiting for the ring.
 */
function drawSparks(surface: CanvasSurface, state: GlobeState, ink: GeoInk, now: number, delta: number, size: number) {
  const { context, width, height, dpr } = surface;
  const radius = size / 2;
  const cx = width / 2;
  const cy = height / 2;
  // a ring that ended before reaching a limb point never throws its spark
  if (state.pingStart < 0) state.pending.length = 0;
  if (state.pending.length) {
    const front = ringRadius(now - state.pingStart, radius);
    const waiting: PendingSpark[] = [];
    for (const spark of state.pending) {
      if (front < spark.arc) {
        waiting.push(spark);
        continue;
      }
      const dx = Math.cos(spark.angle);
      const dy = -Math.sin(spark.angle);
      state.sparks.push({
        x: cx + dx * (radius + 0.5),
        y: cy + dy * (radius + 0.5),
        vx: dx * spark.speed,
        vy: dy * spark.speed,
        age: 0,
        life: spark.life,
        size: spark.size,
      });
    }
    state.pending = waiting;
  }

  if (!state.sparks.length) {
    if (state.fxDirty) {
      context.clearRect(0, 0, width, height);
      state.fxDirty = false;
    }
    return state.pending.length > 0;
  }
  state.fxDirty = true;
  context.clearRect(0, 0, width, height);
  const drag = Math.exp(-delta * 4.5);
  const alive: Spark[] = [];
  for (const spark of state.sparks) {
    spark.age += delta;
    if (spark.age >= spark.life) continue;
    spark.vx *= drag;
    spark.vy *= drag;
    spark.x += spark.vx * delta;
    spark.y += spark.vy * delta;
    const life = 1 - spark.age / spark.life;
    const heat = Math.max(0, 1 - spark.age / 0.14);
    context.globalAlpha = Math.pow(life, 1.2);
    context.fillStyle = rgba(mixRgb(ink.accent, ink.hot, 0.25 + 0.6 * heat));
    fillSquare(context, spark.x, spark.y, spark.size, dpr);
    alive.push(spark);
  }
  context.globalAlpha = 1;
  state.sparks = alive;
  return alive.length > 0 || state.pending.length > 0;
}
