"use client";

import * as React from "react";

import { useCanvas, type CanvasSurface } from "@/lib/lumesec/canvas";
import { usePalette, type ColorToken, type Palette } from "@/lib/lumesec/color";
import {
  arcLift,
  buildArcLength,
  centralAngle,
  createDotBatch,
  cubicBezier,
  forEachDot,
  GEO_TOKENS,
  geoInk,
  globeArc,
  graticuleSvgPath,
  isOccluded,
  latLonToVector,
  nearestLocation,
  pointAtDistance,
  ringFront,
  rotationFromView,
  spacingForRadius,
  sphereLattice,
  wrapLongitude,
  type ArcLengthTable,
  type DotBatch,
  type GeoInk,
  type LatLon,
  type Rotation,
  type SphereLattice,
} from "@/lib/lumesec/geo";
import {
  createRandom,
  DEMO_REGIONS,
  findCity,
  formatNumber,
  pickWeighted,
  scatterAround,
  toEpochMs,
} from "@/lib/lumesec/geo-data";
import { clamp, easeOutCubic, hash, mixRgb, rgba, smoothstep, TAU, type RGB } from "@/lib/lumesec/math";
import {
  prefersReducedMotion,
  springStep,
  useAnimationLoop,
  useInView,
  useInterval,
  useLazyRef,
  useReducedMotion,
} from "@/lib/lumesec/motion";
import { RollText } from "@/lib/lumesec/roll-text";
import { Sparks } from "@/lib/lumesec/sparks";
import { cn } from "@/lib/utils";

/** What happened to a request: stopped at the shield, or let through to the site. */
export type ThreatVerdict = "blocked" | "allowed";

/** The protected site. The globe faces it, so it sits at the centre of the disc. */
export interface ThreatTarget {
  /** Name shown in the header and the accessible summary, for example `eu-central`. */
  readonly label: string;
  /** Latitude in degrees, -90 to 90. */
  readonly lat: number;
  /** Longitude in degrees, east positive. */
  readonly lon: number;
}

/** One inbound request. */
export interface ThreatEvent {
  /** Unique id. Each id is counted and animated once. */
  readonly id: string;
  /** Latitude of the origin in degrees. */
  readonly lat: number;
  /** Longitude of the origin in degrees. */
  readonly lon: number;
  /** `blocked` requests burst off the shield; `allowed` ones pass through and land. */
  readonly verdict: ThreatVerdict;
  /**
   * Origin group for the counts and the top list, for example a region id, a country or a network name. Default: the
   * nearest of 16 generic regions (`us-east`, `sa-east`, `eu-central`, `ap-south`, ...) by great-circle distance.
   */
  readonly region?: string;
  /**
   * When the request happened: epoch ms, an ISO string or a Date. Default: when the component receives it. Requests
   * older than `windowSeconds` are ignored; requests older than 10 s are counted without an arc.
   */
  readonly time?: number | string | Date;
}

/** Imperative actions, exposed through `ref`. */
export interface GeoThreatsHandle {
  /** Adds one request, with or without `events`. An id that was already seen is ignored. */
  push(event: ThreatEvent): void;
}

/** Props of `GeoThreats`. Other `div` props go to the root; `ref` receives the `GeoThreatsHandle`. */
export interface GeoThreatsProps extends Omit<React.ComponentProps<"div">, "ref" | "children"> {
  /** The protected site the globe faces. Default `eu-central` (Frankfurt). */
  target?: ThreatTarget;
  /**
   * Requests to show. Each new `id` animates once, so the array can grow or be replaced. Without it a seeded demo
   * stream runs; an empty array shows an empty window, and `push()` adds requests to it.
   */
  events?: readonly ThreatEvent[];
  /** Arcs drawn at once. Further requests go straight into the counts. */
  maxInFlight?: number;
  /** Window in seconds for the counts, the origin list and the rate chart, 1 to 3,600. */
  windowSeconds?: number;
  /** Radius of the shield ring around the site in px, 10 to 120 and at most 60 % of the globe's radius. */
  shieldRadius?: number;
  /**
   * Runs the demo stream while `events` is not given. Off keeps the prefilled demo window as it is, until a request
   * is pushed.
   */
  live?: boolean;
  /** Called when a request reaches the shield (blocked) or the site (allowed); at once for requests without an arc. */
  onEvent?: (event: ThreatEvent) => void;
  /** Exposes `push(event)`. */
  ref?: React.Ref<GeoThreatsHandle>;
}

/** eu-central, at the coordinates of the shared demo region (Frankfurt). */
const DEFAULT_TARGET: ThreatTarget = { label: "eu-central", lat: 50.1109, lon: 8.6821 };

/** The globe's radius as a share of the stage: the lifted arcs from the far side still fit above the limb. */
const RADIUS_SHARE = 0.4;
const LAND_PITCH = 4;
const LAND_DOT = 1.5;
/** Dots this close to the limb (view z) are left out: the foreshortened rows would moiré. */
const LIMB_CUTOFF = 0.05;
/** No land dots within this many px of the site, so the target square stands clear. */
const TARGET_CLEARING = 9;

const SHIELD_DOTS = 48;
const SHIELD_DOT = 2;
const SHIELD_REST_ALPHA = 0.5;
const SHIELD_STIFFNESS = 600;
const SHIELD_DAMPING = 0.4;
/** A blocked hit dents the ring over ±0.35 rad with an inward kick in px/s (about 4 px deep at the centre). */
const DENT_SPAN = 0.35;
const DENT_KICK = 160;
/** An allowed request parts the ring outward by about 3 px. */
const PART_SPAN = 0.3;
const PART_KICK = 120;
const HEAT_SECONDS = 0.3;
const GLINT_SECONDS = 0.16;
/** Reduced motion: the shield dots facing a new request's origin light up this long. */
const STILL_GLOW_SECONDS = 0.4;

const ARC_SEGMENTS = 56;
const ARC_LIFT = 0.9;
/** Packets speed up toward the site. */
const PACKET_EASE = cubicBezier(0.5, 0, 0.75, 1);
const TRAIL_SPACING = 3.5;
const TRAIL_ALPHA = 0.15;
/** Seconds the trail takes to retract into the impact point. */
const TRAIL_ERASE = 0.35;
const TAIL_SQUARES = 6;
const TAIL_SPACING = 2.5;
const SPARK_COUNT = 10;
const FLICK_SECONDS = 0.3;
const PIP_SECONDS = 0.6;
const LANDING_SECONDS = 0.7;
const LANDING_PITCH = 4;

/** Requests older than this are counted without an arc. */
const FRESH_MS = 10_000;
const SEEN_LIMIT = 4000;
const REFRESH_DELAY_MS = 120;
const SUMMARY_INTERVAL_MS = 15_000;
const TOP_COUNT = 5;
/** The window, and with it the per-second series, covers at most an hour. */
const MAX_SERIES = 3600;

/** Average demo requests per second. */
const DEMO_RATE = 4;
const DEMO_SPREAD_KM = 260;
/** Demo requests between two campaigns: every 20 s or so another source sends three times as much. */
const DEMO_CAMPAIGN_EVENTS = 80;

/** The dotted share bars and the rate chart: 2 px dots on a 3 px pitch. */
const BAR_PITCH = 3;
const BAR_DOT = 2;
const BAR_MASK: React.CSSProperties = {
  maskImage: `linear-gradient(90deg, #000 ${BAR_DOT}px, transparent ${BAR_DOT}px), linear-gradient(#000 ${BAR_DOT}px, transparent ${BAR_DOT}px)`,
  WebkitMaskImage: `linear-gradient(90deg, #000 ${BAR_DOT}px, transparent ${BAR_DOT}px), linear-gradient(#000 ${BAR_DOT}px, transparent ${BAR_DOT}px)`,
  maskSize: `${BAR_PITCH}px ${BAR_PITCH}px`,
  WebkitMaskSize: `${BAR_PITCH}px ${BAR_PITCH}px`,
  maskComposite: "intersect",
  WebkitMaskComposite: "source-in",
};
const ROW_HEIGHT = 36;

const LAND_POP_KEYFRAMES: Keyframe[] = [
  { transform: "scale(1)", boxShadow: "0 0 0 0 color-mix(in srgb, var(--lumesec-success) 0%, transparent)" },
  {
    transform: "scale(1.45)",
    boxShadow: "0 0 0 3px color-mix(in srgb, var(--lumesec-success) 45%, transparent)",
    offset: 0.3,
  },
  { transform: "scale(1)", boxShadow: "0 0 0 6px color-mix(in srgb, var(--lumesec-success) 0%, transparent)" },
];
const ROW_ENTER_KEYFRAMES: Keyframe[] = [
  { opacity: 0, transform: "translateY(8px)" },
  { opacity: 1, transform: "none" },
];

/**
 * Inbound requests converge on one protected site at the centre of a dotted globe. Requests from the far side come
 * up over the horizon. A ring of dots around the site is its shield: a blocked request stops at the ring, dents it and
 * throws sparks back the way it came; an allowed request parts the ring, passes and lands on the site. Counts per
 * verdict, the top origin regions and the requests per second over the window sit beside the globe. Arcs in flight
 * are capped; the rest go straight into the counts.
 *
 * Without `events` a seeded demo stream runs on a prefilled minute of counts. Pass your requests as `events` (new ids
 * animate), or add them one by one with `push()` through `ref`.
 *
 * @example
 * const threats = React.useRef<GeoThreatsHandle>(null);
 * <GeoThreats ref={threats} target={{ label: "eu-central", lat: 50.11, lon: 8.68 }} events={requests} />
 * // later: threats.current?.push({ id: "r-1", lat: 19.07, lon: 72.87, verdict: "blocked" });
 */
export function GeoThreats(props: GeoThreatsProps) {
  // demo counts and your counts are separate timelines: switching between them starts the panel over
  return <ThreatsPanel key={props.events === undefined ? "demo" : "data"} {...props} />;
}

function ThreatsPanel({
  target = DEFAULT_TARGET,
  events,
  maxInFlight = 24,
  windowSeconds = 60,
  shieldRadius = 26,
  live = true,
  onEvent,
  ref,
  className,
  ...props
}: GeoThreatsProps) {
  const demo = events === undefined;
  const windowLength = Number.isFinite(windowSeconds) ? Math.round(clamp(windowSeconds, 1, MAX_SERIES)) : 60;
  const windowMs = windowLength * 1000;
  const phrase = windowPhrase(windowLength);
  const siteLabel = target.label || DEFAULT_TARGET.label;
  const siteLat = Number.isFinite(target.lat) ? clamp(target.lat, -90, 90) : DEFAULT_TARGET.lat;
  const siteLon = Number.isFinite(target.lon) ? wrapLongitude(target.lon) : DEFAULT_TARGET.lon;
  const ringRadius = Number.isFinite(shieldRadius) ? clamp(shieldRadius, 10, 120) : 26;
  const inFlightCap = Number.isFinite(maxInFlight) ? Math.max(0, Math.floor(maxInFlight)) : 24;
  const reducedMotion = useReducedMotion();

  // The first window: the seeded demo history at a fixed clock, so the server and the client agree on it.
  const [snapshot, setSnapshot] = React.useState<Snapshot>(() => (demo ? demoSnapshot(windowLength) : EMPTY_SNAPSHOT));
  const [summary, setSummary] = React.useState(() => summaryText(siteLabel, phrase, snapshot));

  const rotation = React.useMemo(() => rotationFromView(siteLon, siteLat), [siteLon, siteLat]);
  const graticule = React.useMemo(
    () => graticuleSvgPath({ size: 80, centerLon: siteLon, centerLat: siteLat, step: 30 }),
    [siteLon, siteLat],
  );
  const shieldPlaceholder = React.useMemo(() => shieldOffsets(ringRadius), [ringRadius]);

  const rootRef = React.useRef<HTMLDivElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const baseRef = React.useRef<HTMLCanvasElement>(null);
  const effectsRef = React.useRef<HTMLCanvasElement>(null);
  const placeholderRef = React.useRef<HTMLDivElement>(null);
  const targetRef = React.useRef<HTMLSpanElement>(null);

  /** The mutable state, created on first use (effects, handlers, timers and the loop), never during a render. */
  const runtimeRef = useLazyRef(() => createRuntime());
  const inView = useInView(rootRef, "120px");
  const stageInView = useInView(stageRef);
  /** What the loop, the timers and the handle read: the latest props and derived values. */
  const latest = React.useRef<Latest>({
    site: { label: siteLabel, lat: siteLat, lon: siteLon },
    rotation,
    inFlightCap,
    windowMs,
    phrase,
    ringRadius,
    onEvent,
    stageInView,
  });
  React.useEffect(() => {
    latest.current = {
      site: { label: siteLabel, lat: siteLat, lon: siteLon },
      rotation,
      inFlightCap,
      windowMs,
      phrase,
      ringRadius,
      onEvent,
      stageInView,
    };
  });

  const loop = useAnimationLoop(stageRef, step);
  const palette = usePalette(rootRef, GEO_TOKENS, () => {
    runtimeRef.current.inkStale = true;
    loop.kick();
  });
  const baseSurface = useCanvas(
    baseRef,
    () => {
      runtimeRef.current.baseDirty = true;
      loop.kick();
    },
    { maxDpr: 2 },
  );
  const effectsSurface = useCanvas(effectsRef, () => loop.kick(), { maxDpr: 2 });

  /** Recounts the window. The top list re-sorts only when `reorder` is set (once a second), so rows do not flicker. */
  const refresh = React.useCallback(
    (reorder: boolean) => {
      const run = runtimeRef.current;
      const { windowMs: span, site, phrase: windowText } = latest.current;
      const now = Date.now();
      const next = aggregate(run, now, span, reorder);
      run.top = next.top.map((row) => row.name);
      setSnapshot((previous) => (sameSnapshot(previous, next) ? previous : next));
      const key = `${site.label}\n${windowText}`;
      if (now - run.summaryTime >= SUMMARY_INTERVAL_MS || run.summaryKey !== key) {
        run.summaryTime = now;
        run.summaryKey = key;
        setSummary(summaryText(site.label, windowText, next));
      }
    },
    [runtimeRef],
  );

  const scheduleRefresh = React.useCallback(() => {
    const run = runtimeRef.current;
    if (run.refreshTimer) return;
    run.refreshTimer = window.setTimeout(() => {
      run.refreshTimer = 0;
      refresh(false);
    }, REFRESH_DELAY_MS);
  }, [runtimeRef, refresh]);

  /** Counts a request that reached the shield or the site (or skipped its arc), and reports it. */
  const settle = React.useCallback(
    (entry: Entry) => {
      addCount(runtimeRef.current, entry.time, entry.verdict, entry.region);
      scheduleRefresh();
      latest.current.onEvent?.(entry.event);
    },
    [runtimeRef, scheduleRefresh],
  );

  /** Counts the requests still in flight at once, for when their arcs cannot play on (a new site, reduced motion). */
  const settleFlying = React.useCallback(() => {
    const run = runtimeRef.current;
    const flying = run.arcs.filter((arc) => !arc.done);
    clearEffects(run);
    for (const arc of flying) settle(arc.entry);
  }, [runtimeRef, settle]);

  /** Takes new requests: an arc each while fewer than `maxInFlight` fly and the globe is on screen, else straight to the counts. */
  const ingest = React.useCallback(
    (list: readonly ThreatEvent[]) => {
      const run = runtimeRef.current;
      const current = latest.current;
      const now = Date.now();
      const reduced = prefersReducedMotion();
      const onScreen = current.stageInView && !document.hidden;
      let kicked = false;
      for (const event of list) {
        if (!isEvent(event) || run.seen.has(event.id)) continue;
        remember(run, event.id);
        const happened = Math.min(now, toEpochMs(event.time) ?? now);
        if (now - happened >= current.windowMs) continue;
        const origin: LatLon = { lat: clamp(event.lat, -90, 90), lon: wrapLongitude(event.lon) };
        const region = typeof event.region === "string" && event.region.trim() ? event.region.trim() : regionOf(origin);
        const entry: Entry = { event, origin, verdict: event.verdict, region, time: happened };
        if (reduced) {
          if (onScreen) {
            glowShield(run, current.rotation, origin, event.verdict);
            kicked = true;
          }
          settle(entry);
          continue;
        }
        const angle = centralAngle(origin, current.site);
        if (now - happened >= FRESH_MS || !onScreen || countFlying(run.arcs) >= current.inFlightCap || angle < 1e-3) {
          settle(entry);
          continue;
        }
        run.arcs.push(createArc(entry, current.site, current.rotation, angle));
        kicked = true;
      }
      if (kicked) loop.kick();
    },
    [runtimeRef, loop, settle],
  );

  React.useImperativeHandle(ref, () => ({ push: (event) => ingest([event]) }), [ingest]);

  // Demo mode: a window of invented history fills the counts at once, relative to the real clock.
  React.useEffect(() => {
    if (!demo) return;
    const run = runtimeRef.current;
    if (!run.prefilled) {
      run.prefilled = true;
      const now = Date.now();
      for (const item of demoHistory(windowLength)) addCount(run, now - item.ago, item.verdict, item.region);
    }
    scheduleRefresh();
  }, [demo, windowLength, runtimeRef, scheduleRefresh]);

  // Your requests: every id that has not been seen yet comes in now.
  React.useEffect(() => {
    if (events) ingest(events);
  }, [events, ingest]);

  // The demo stream: about four requests a second while the panel is on screen.
  React.useEffect(() => {
    if (!demo || !live || !inView) return;
    const run = runtimeRef.current;
    let timer = 0;
    const tick = () => {
      if (!document.hidden) {
        const event = nextDemoEvent(run);
        if (event) ingest([event]);
      }
      timer = window.setTimeout(tick, demoGap(run.random));
    };
    timer = window.setTimeout(tick, 240);
    return () => window.clearTimeout(timer);
  }, [demo, live, inView, runtimeRef, ingest]);

  // Once a second the window slides: old requests leave the counts and the list re-sorts. A paused demo keeps its
  // prefilled picture.
  const sliding = inView && (live || !demo);
  useInterval(() => refresh(true), 1000, sliding);
  React.useEffect(() => {
    if (sliding) scheduleRefresh();
  }, [sliding, scheduleRefresh]);

  // A new site label or window length reaches the counts and the summary at once, not with the next 15 s refresh.
  React.useEffect(() => {
    scheduleRefresh();
  }, [siteLabel, windowLength, scheduleRefresh]);

  // A new site turns the globe: arcs in flight no longer fit, so they are counted at once and the land is redrawn.
  React.useEffect(() => {
    settleFlying();
    runtimeRef.current.baseDirty = true;
    loop.kick();
  }, [rotation, runtimeRef, settleFlying, loop]);

  // Reduced motion turned on mid-flight: the arcs stop and their requests are counted.
  React.useEffect(() => {
    if (reducedMotion) settleFlying();
    loop.kick();
  }, [reducedMotion, settleFlying, loop]);

  React.useEffect(() => {
    loop.kick();
  }, [ringRadius, loop]);

  React.useEffect(() => {
    const run = runtimeRef.current;
    return () => {
      window.clearTimeout(run.refreshTimer);
      window.clearTimeout(run.latticeTimer);
      run.refreshTimer = 0;
      run.latticePending = 0;
    };
  }, [runtimeRef]);

  function step(_time: number, delta: number) {
    const run = runtimeRef.current;
    const base = baseSurface.current;
    const effects = effectsSurface.current;
    const colors = palette.current;
    if (!base || !effects || !colors) return false;
    if (run.inkStale || !run.ink) applyInk(run, geoInk(colors));
    const current = latest.current;
    layoutView(run, base.width, base.height, current.rotation, current.ringRadius);
    // the effects canvas reaches past the stage by a responsive margin: measure it rather than assume it
    run.offsetX = (effects.width - base.width) / 2;
    run.offsetY = (effects.height - base.height) / 2;
    ensureLattice(run, loop.kick);

    if (run.baseDirty) {
      drawBase(base, run);
      run.baseDirty = false;
      if (!run.painted) {
        run.painted = true;
        // crossfade from the server placeholder to the first canvas frame
        if (placeholderRef.current) placeholderRef.current.style.opacity = "0";
      }
    }

    advanceArcs(run, delta, { impact, cross, land });
    const shieldMoving = stepShield(run, delta, prefersReducedMotion());
    const alive = drawEffects(effects, run, delta);
    return alive || shieldMoving;
  }

  /** A blocked packet reached the ring: dent, heat and sparks reflected off the ring the way a ball bounces. */
  function impact(arc: Arc) {
    const run = runtimeRef.current;
    hitShield(run, arc.impactAngle, "blocked");
    const ink = run.ink;
    if (ink) {
      const nx = Math.cos(arc.impactAngle);
      const ny = Math.sin(arc.impactAngle);
      const x = run.cx + run.offsetX + nx * run.ringRadius;
      const y = run.cy + run.offsetY + ny * run.ringRadius;
      // the incoming direction reflected about the ring normal at the impact
      const dx = Math.cos(arc.impactHeading);
      const dy = Math.sin(arc.impactHeading);
      const dot = dx * nx + dy * ny;
      const angle = Math.atan2(dy - 2 * dot * ny, dx - 2 * dot * nx);
      run.sparks.add(x, y, SPARK_COUNT, [ink.destructive, run.sparkHot], {
        angle,
        spread: 1,
        speed: [80, 220],
        life: [0.3, 0.7],
        size: [1.5, 2],
        drag: 3.2,
        jitter: 1,
      });
    }
    settle(arc.entry);
  }

  /** An allowed packet passes the ring: the dots part around it and close again. */
  function cross(arc: Arc) {
    hitShield(runtimeRef.current, arc.impactAngle, "allowed");
  }

  /** An allowed packet reached the site: a ring of lit dots runs out from it and the target square pops. */
  function land(arc: Arc) {
    runtimeRef.current.landings.push({ age: 0 });
    const square = targetRef.current;
    if (square && typeof square.animate === "function") {
      square.animate(LAND_POP_KEYFRAMES, { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
    settle(arc.entry);
  }

  const total = snapshot.blocked + snapshot.allowed;

  return (
    <div
      ref={rootRef}
      data-slot="geo-threats"
      className={cn("@container grid w-full max-w-[660px] gap-2 text-foreground", className)}
      {...props}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[12.5px] leading-5">
        <div className="flex items-center gap-x-4">
          <Counter label="Blocked" value={snapshot.blocked} dotClass="bg-destructive" />
          <Counter label="Allowed" value={snapshot.allowed} dotClass="bg-lumesec-success" />
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <span aria-hidden="true" className="size-1.5 shrink-0 bg-lumesec" />
          <span>Site</span>
          <span className="truncate font-mono text-[12px] text-foreground/80">{siteLabel}</span>
        </div>
      </div>
      <div className="grid gap-3 @min-[560px]:grid-cols-[minmax(0,1fr)_200px]">
        <div
          ref={stageRef}
          role="img"
          aria-label={summary}
          className="relative mx-auto aspect-square w-full max-w-[420px] select-none"
        >
          <div
            ref={placeholderRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 transition-opacity duration-300 motion-reduce:transition-none"
          >
            <svg viewBox="0 0 80 80" className="absolute top-[10%] left-[10%] size-[80%] overflow-visible">
              <circle
                cx="40"
                cy="40"
                r="40"
                className="fill-foreground/[0.025] stroke-border"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={graticule}
                fill="none"
                className="stroke-border"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <svg
              viewBox={`${-ringRadius - 2} ${-ringRadius - 2} ${ringRadius * 2 + 4} ${ringRadius * 2 + 4}`}
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 overflow-visible"
              style={{ width: ringRadius * 2 + 4, height: ringRadius * 2 + 4 }}
            >
              {shieldPlaceholder.map((point, i) => (
                <rect
                  key={i}
                  x={point.x - SHIELD_DOT / 2}
                  y={point.y - SHIELD_DOT / 2}
                  width={SHIELD_DOT}
                  height={SHIELD_DOT}
                  className="fill-foreground/30"
                />
              ))}
            </svg>
          </div>
          <canvas ref={baseRef} aria-hidden="true" className="pointer-events-none absolute inset-0 block size-full" />
          {/* reaches past the stage, so far-side arcs can rise above the limb; 16 px to the sides on narrow screens */}
          <canvas
            ref={effectsRef}
            aria-hidden="true"
            className="pointer-events-none absolute -top-10 -left-4 z-[1] block h-[calc(100%+80px)] w-[calc(100%+32px)] @min-[500px]:-left-10 @min-[500px]:w-[calc(100%+80px)]"
          />
          <span
            ref={targetRef}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-1/2 z-[2] -mt-[5px] -ml-[5px] size-2.5 bg-lumesec"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-4 border-t border-border pt-2.5 @min-[560px]:border-t-0 @min-[560px]:border-l @min-[560px]:pt-0 @min-[560px]:pl-3">
          <OriginList rows={snapshot.top} total={total} phrase={phrase} reducedMotion={reducedMotion} />
          <RateChart blocked={snapshot.blockedSeries} allowed={snapshot.allowedSeries} peak={snapshot.peak} />
        </div>
      </div>
    </div>
  );
}

/* Header counter */

function Counter({ label, value, dotClass }: { label: string; value: number; dotClass: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden="true" className={cn("size-1.5 shrink-0", dotClass)} />
      <span className="text-muted-foreground">{label}</span>
      <Odometer value={value} className="text-[13px] font-medium text-foreground" />
      <span className="sr-only">{formatNumber(value)}</span>
    </span>
  );
}

/**
 * A number whose digits roll one by one, each on its own drum: only the digits that change move, upward when the value
 * grows and downward when it shrinks. Hidden from assistive technology; pair it with the plain value.
 */
function Odometer({ value, className }: { value: number; className?: string }) {
  const [state, setState] = React.useState({ value, direction: 1 });
  if (state.value !== value) setState({ value, direction: value >= state.value ? 1 : -1 });
  const characters = Array.from(formatNumber(value));
  return (
    <span aria-hidden="true" className={cn("inline-flex font-mono tabular-nums", className)}>
      {characters.map((character, i) => (
        // keyed from the right, so the ones digit keeps its drum when the number grows a digit
        <RollText key={characters.length - i} text={character} direction={state.direction} />
      ))}
    </span>
  );
}

/* Origin list */

interface OriginListProps {
  rows: readonly RegionCount[];
  total: number;
  phrase: string;
  reducedMotion: boolean;
}

/** The top origins, re-sorted at most once a second. Rows that change rank slide to their new place on a spring. */
function OriginList({ rows, total, phrase, reducedMotion }: OriginListProps) {
  const listRef = React.useRef<HTMLDivElement>(null);
  const nodes = React.useRef(new Map<string, HTMLLIElement>());
  const tops = React.useRef(new Map<string, number>());
  const ready = React.useRef(false);
  const [columns, setColumns] = React.useState(0);
  const order = rows.map((row) => row.name).join("\n");

  React.useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(() => {
      setColumns(Math.max(1, Math.floor((list.clientWidth + BAR_PITCH - BAR_DOT) / BAR_PITCH)));
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  React.useLayoutEffect(() => {
    const previous = tops.current;
    const next = new Map<string, number>();
    // nothing slides on the first paint; afterwards new rows rise in and moved rows spring to their place
    const animate = ready.current && !reducedMotion;
    let entering = 0;
    for (const [name, node] of nodes.current) {
      const top = node.offsetTop;
      next.set(name, top);
      if (!animate || typeof node.animate !== "function") continue;
      const before = previous.get(name);
      if (before === undefined) {
        node.animate(ROW_ENTER_KEYFRAMES, {
          duration: 320,
          delay: 50 * entering++,
          easing: "cubic-bezier(.2,.8,.2,1)",
          fill: "backwards",
        });
        continue;
      }
      // start from where the row is drawn now, so a re-sort during a slide does not jump
      const from = before + translateY(node) - top;
      if (Math.abs(from) < 0.5) continue;
      for (const animation of node.getAnimations()) animation.cancel();
      const spring = springKeyframes(from, 360, 0.8);
      node.animate(spring.keyframes, { duration: spring.duration, easing: "linear" });
    }
    tops.current = next;
    ready.current = true;
  }, [order, reducedMotion]);

  return (
    <div ref={listRef} className="grid content-start gap-1">
      <div className="flex items-baseline justify-between gap-2 text-[12px] leading-5 text-muted-foreground">
        <span>Top origins</span>
        <span>{shortWindow(phrase)}</span>
      </div>
      {rows.length ? (
        <ol className="relative m-0 list-none p-0" style={{ minHeight: ROW_HEIGHT * TOP_COUNT }}>
          {rows.map((row) => {
            const count = row.blocked + row.allowed;
            return (
              <li
                key={row.name}
                ref={(node) => {
                  if (node) nodes.current.set(row.name, node);
                  else nodes.current.delete(row.name);
                }}
                className="grid content-center gap-[5px]"
                style={{ height: ROW_HEIGHT }}
              >
                <span className="sr-only">
                  {`${row.name}: ${formatNumber(count)} ${count === 1 ? "request" : "requests"}, ${formatNumber(row.blocked)} blocked, ${formatNumber(row.allowed)} allowed`}
                </span>
                <div aria-hidden="true" className="flex items-baseline justify-between gap-2 leading-[18px]">
                  <span className="truncate text-[12.5px]">{row.name}</span>
                  <Odometer value={count} className="text-[12px] text-foreground/80" />
                </div>
                <DotBar blocked={row.blocked} allowed={row.allowed} total={total} columns={columns} />
              </li>
            );
          })}
        </ol>
      ) : (
        <p
          className="m-0 grid place-items-center text-center text-[12.5px] text-muted-foreground"
          style={{ minHeight: ROW_HEIGHT * TOP_COUNT }}
        >
          No requests in {phrase}
        </p>
      )}
    </div>
  );
}

/**
 * The region's share of all requests in the window as a strip of dots: blocked dots first, then allowed ones, on a
 * track of dim dots. Lengths snap to whole dots once the strip is measured.
 */
function DotBar({
  blocked,
  allowed,
  total,
  columns,
}: {
  blocked: number;
  allowed: number;
  total: number;
  columns: number;
}) {
  const share = total > 0 ? (blocked + allowed) / total : 0;
  const blockedShare = total > 0 ? blocked / total : 0;
  let blockedWidth: string | number;
  let allowedWidth: string | number;
  if (columns > 0) {
    const lit = blocked + allowed > 0 ? Math.max(1, Math.round(share * columns)) : 0;
    const litBlocked = blocked > 0 ? clamp(Math.round(blockedShare * columns), 1, lit) : 0;
    blockedWidth = litBlocked * BAR_PITCH;
    allowedWidth = (lit - litBlocked) * BAR_PITCH;
  } else {
    blockedWidth = `${blockedShare * 100}%`;
    allowedWidth = `${(share - blockedShare) * 100}%`;
  }
  return (
    <div aria-hidden="true" className="flex h-[5px] w-full bg-foreground/12" style={BAR_MASK}>
      <div className="h-full shrink-0 bg-destructive" style={{ width: blockedWidth }} />
      <div className="h-full shrink-0 bg-lumesec-success" style={{ width: allowedWidth }} />
    </div>
  );
}

/* Rate chart */

const CHART_TOKENS = {
  foreground: GEO_TOKENS.foreground,
  destructive: GEO_TOKENS.destructive,
  success: GEO_TOKENS.success,
} as const satisfies Record<string, ColorToken>;
const CHART_HEIGHT = 44;

/**
 * Requests per second over the window as columns of dots, newest on the right: blocked dots stacked first, allowed
 * ones on top, on a matrix of dim dots. A flood shows as a spike. The peak is real text.
 */
function RateChart({
  blocked,
  allowed,
  peak,
}: {
  blocked: readonly number[];
  allowed: readonly number[];
  peak: number;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [version, setVersion] = React.useState(0);
  const surface = useCanvas(canvasRef, () => setVersion((value) => value + 1));
  const palette = usePalette(canvasRef, CHART_TOKENS, () => setVersion((value) => value + 1));

  // redrawn when the series changes (once a second at most), on resize and on theme change (`version`)
  React.useEffect(() => {
    if (surface.current && palette.current) drawRate(surface.current, palette.current, blocked, allowed);
  }, [blocked, allowed, version, surface, palette]);

  return (
    <div className="mt-auto hidden gap-1.5 @min-[560px]:grid">
      <div className="flex items-baseline justify-between gap-2 text-[12px] leading-5 text-muted-foreground">
        <span>Requests per second</span>
        <span>
          Peak <span className="font-mono text-foreground/80 tabular-nums">{formatNumber(peak)}</span>
        </span>
      </div>
      <canvas ref={canvasRef} aria-hidden="true" className="block w-full" style={{ height: CHART_HEIGHT }} />
    </div>
  );
}

/**
 * Draws the columns: one per second, or the average of several seconds when the window has more seconds than the
 * chart has columns, spread over the full width with the newest on the right.
 */
function drawRate(
  surface: CanvasSurface,
  palette: Palette<keyof typeof CHART_TOKENS>,
  blocked: readonly number[],
  allowed: readonly number[],
) {
  const { context, width, height, dpr } = surface;
  context.clearRect(0, 0, width, height);
  const seconds = blocked.length;
  if (!seconds) return;
  const perColumn = Math.max(
    1,
    Math.ceil(seconds / Math.max(1, Math.floor((width + BAR_PITCH - BAR_DOT) / BAR_PITCH))),
  );
  const columns = Math.ceil(seconds / perColumn);
  const pitch = (width - BAR_DOT) / Math.max(1, columns - 1);
  const rows = Math.max(1, Math.floor((height + BAR_PITCH - BAR_DOT) / BAR_PITCH));
  const rates: (readonly [blocked: number, allowed: number])[] = [];
  let busiest = 0;
  for (let c = 0; c < columns; c++) {
    const end = seconds - (columns - 1 - c) * perColumn;
    const start = Math.max(0, end - perColumn);
    let b = 0;
    let a = 0;
    for (let i = start; i < end; i++) {
      b += blocked[i];
      a += allowed[i];
    }
    const span = Math.max(1, end - start);
    rates.push([b / span, a / span]);
    busiest = Math.max(busiest, (b + a) / span);
  }
  // one dot is one request a second until a column would overflow; then each dot stands for several
  const perDot = Math.max(1, Math.ceil(busiest / rows));
  // dots snap to device pixels, so the fractional pitch never blurs them
  const xOf = (column: number) => Math.round(column * pitch * dpr) / dpr;
  const yOf = (row: number) => height - BAR_DOT - row * BAR_PITCH;

  context.fillStyle = rgba(palette.foreground);
  context.globalAlpha = 0.12;
  for (let c = 0; c < columns; c++) for (let r = 0; r < rows; r++) context.fillRect(xOf(c), yOf(r), BAR_DOT, BAR_DOT);
  context.globalAlpha = 1;

  const lit = rates.map(([b, a]) => {
    const blockedDots = Math.min(rows, b > 0 ? Math.max(1, Math.round(b / perDot)) : 0);
    const allowedDots = Math.min(rows - blockedDots, a > 0 ? Math.max(1, Math.round(a / perDot)) : 0);
    return [blockedDots, allowedDots] as const;
  });
  context.fillStyle = rgba(palette.destructive);
  lit.forEach(([b], c) => {
    for (let r = 0; r < b; r++) context.fillRect(xOf(c), yOf(r), BAR_DOT, BAR_DOT);
  });
  context.fillStyle = rgba(palette.success);
  lit.forEach(([b, a], c) => {
    for (let r = b; r < b + a; r++) context.fillRect(xOf(c), yOf(r), BAR_DOT, BAR_DOT);
  });
}

/** Translate-y of a row as drawn right now, including a running animation. */
function translateY(node: HTMLElement) {
  const transform = getComputedStyle(node).transform;
  if (!transform || transform === "none") return 0;
  return new DOMMatrixReadOnly(transform).m42;
}

/** Keyframes of a damped spring from `from` px back to 0, sampled at 60 Hz, so WAAPI plays a real spring. */
function springKeyframes(from: number, stiffness: number, damping: number) {
  const state = { position: from, velocity: 0 };
  const frame = 1 / 60;
  const keyframes: Keyframe[] = [{ transform: `translateY(${from.toFixed(2)}px)` }];
  for (let i = 0; i < 120; i++) {
    springStep(state, 0, frame, stiffness, damping);
    if (Math.abs(state.position) < 0.15 && Math.abs(state.velocity) < 4) break;
    keyframes.push({ transform: `translateY(${state.position.toFixed(2)}px)` });
  }
  keyframes.push({ transform: "none" });
  return { keyframes, duration: (keyframes.length - 1) * frame * 1000 };
}

/* Counting */

/** Requests per origin region in the window. */
interface RegionCount {
  readonly name: string;
  readonly blocked: number;
  readonly allowed: number;
}

interface Snapshot {
  readonly blocked: number;
  readonly allowed: number;
  /** Up to five regions, most requests first (as of the last re-sort). */
  readonly top: readonly RegionCount[];
  /** Blocked and allowed requests per second over the window, oldest first; the last entry is the current second. */
  readonly blockedSeries: readonly number[];
  readonly allowedSeries: readonly number[];
  /** The busiest second in the window. */
  readonly peak: number;
}

const EMPTY_SNAPSHOT: Snapshot = { blocked: 0, allowed: 0, top: [], blockedSeries: [], allowedSeries: [], peak: 0 };

/** Counts of one second. */
interface Bucket {
  blocked: number;
  allowed: number;
  regions: Map<string, [blocked: number, allowed: number]>;
}

function addCount(run: Runtime, time: number, verdict: ThreatVerdict, region: string) {
  const second = Math.floor(time / 1000);
  let bucket = run.buckets.get(second);
  if (!bucket) {
    bucket = { blocked: 0, allowed: 0, regions: new Map() };
    run.buckets.set(second, bucket);
  }
  let counts = bucket.regions.get(region);
  if (!counts) {
    counts = [0, 0];
    bucket.regions.set(region, counts);
  }
  if (verdict === "blocked") {
    bucket.blocked++;
    counts[0]++;
  } else {
    bucket.allowed++;
    counts[1]++;
  }
}

/** Totals over the window (dropping older seconds) and the top regions; the order changes only with `reorder`. */
function aggregate(run: Runtime, now: number, windowMs: number, reorder: boolean): Snapshot {
  const seconds = clamp(Math.round(windowMs / 1000), 1, MAX_SERIES);
  const newest = Math.floor(now / 1000);
  const oldest = newest - seconds + 1;
  const blockedSeries = new Array<number>(seconds).fill(0);
  const allowedSeries = new Array<number>(seconds).fill(0);
  let blocked = 0;
  let allowed = 0;
  const regions = new Map<string, [number, number]>();
  for (const [second, bucket] of run.buckets) {
    if (second < oldest) {
      run.buckets.delete(second);
      continue;
    }
    if (second > newest) continue;
    blocked += bucket.blocked;
    allowed += bucket.allowed;
    blockedSeries[second - oldest] += bucket.blocked;
    allowedSeries[second - oldest] += bucket.allowed;
    for (const [name, counts] of bucket.regions) {
      const sum = regions.get(name);
      if (sum) {
        sum[0] += counts[0];
        sum[1] += counts[1];
      } else regions.set(name, [counts[0], counts[1]]);
    }
  }
  const row = (name: string): RegionCount => {
    const counts = regions.get(name);
    return { name, blocked: counts?.[0] ?? 0, allowed: counts?.[1] ?? 0 };
  };
  const shown = run.top.filter((name) => regions.has(name));
  let names: string[];
  if (reorder || shown.length < Math.min(TOP_COUNT, regions.size)) {
    // most requests first; ties keep the current order, then go alphabetically
    const rank = new Map(run.top.map((name, i) => [name, i]));
    names = [...regions.keys()]
      .sort((a, b) => {
        const difference = sumOf(regions.get(b)) - sumOf(regions.get(a));
        if (difference) return difference;
        return (rank.get(a) ?? TOP_COUNT) - (rank.get(b) ?? TOP_COUNT) || a.localeCompare(b);
      })
      .slice(0, TOP_COUNT);
    if (!reorder) {
      // between re-sorts, keep the rows in place and add newcomers at the bottom
      const kept = shown.slice();
      for (const name of names) if (kept.length < TOP_COUNT && !kept.includes(name)) kept.push(name);
      names = kept;
    }
  } else {
    names = shown;
  }
  let peak = 0;
  for (let i = 0; i < seconds; i++) peak = Math.max(peak, blockedSeries[i] + allowedSeries[i]);
  return { blocked, allowed, top: names.map(row), blockedSeries, allowedSeries, peak };
}

const sumOf = (counts: readonly number[] | undefined) => (counts ? counts[0] + counts[1] : 0);

function sameSnapshot(a: Snapshot, b: Snapshot) {
  if (a.blocked !== b.blocked || a.allowed !== b.allowed || a.peak !== b.peak || a.top.length !== b.top.length) {
    return false;
  }
  if (!sameSeries(a.blockedSeries, b.blockedSeries) || !sameSeries(a.allowedSeries, b.allowedSeries)) return false;
  return a.top.every(
    (row, i) => row.name === b.top[i].name && row.blocked === b.top[i].blocked && row.allowed === b.top[i].allowed,
  );
}

function sameSeries(a: readonly number[], b: readonly number[]) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** 'the last minute', 'the last 30 seconds', 'the last 5 minutes', 'the last hour'. */
function windowPhrase(seconds: number) {
  if (seconds === 1) return "the last second";
  if (seconds === 60) return "the last minute";
  if (seconds === 3600) return "the last hour";
  if (seconds % 60 === 0) return `the last ${seconds / 60} minutes`;
  return `the last ${seconds} seconds`;
}

/** 'Last minute', 'Last 30 seconds': the phrase without its article, for the list heading. */
const shortWindow = (phrase: string) => phrase.replace(/^the l/, "L");

/** The accessible summary of the window: 'Requests to eu-central. In the last minute: 1,284 blocked, 312 allowed, most from ap-south.' */
function summaryText(label: string, phrase: string, snapshot: Snapshot) {
  const total = snapshot.blocked + snapshot.allowed;
  if (!total) return `Requests to ${label}. No requests in ${phrase}.`;
  let top: RegionCount | undefined;
  for (const row of snapshot.top) {
    if (!top || row.blocked + row.allowed > top.blocked + top.allowed) top = row;
  }
  const blocked = formatNumber(snapshot.blocked);
  const allowed = formatNumber(snapshot.allowed);
  return `Requests to ${label}. In ${phrase}: ${blocked} blocked, ${allowed} allowed${top ? `, most from ${top.name}` : ""}.`;
}

/** The nearest of the generic regions (`us-east`, `sa-east`, `ap-south`, ...) by great-circle distance. */
function regionOf(point: LatLon): string {
  const nearest = nearestLocation(DEMO_REGIONS, point);
  return nearest ? DEMO_REGIONS[nearest.index].label : "other";
}

/* Demo data */

/** An invented source of demo requests: a demo city, how much it sends and how much of that is blocked. */
interface DemoSource {
  readonly city: LatLon;
  readonly region: string;
  readonly weight: number;
  readonly blockRate: number;
}

/**
 * Invented demo traffic: the weights and block rates are made up, the cities are real places. About 80 % of it is
 * blocked; each source falls in the region nearest to it.
 */
const DEMO_SOURCE_TABLE: readonly (readonly [city: string, weight: number, blockRate: number])[] = [
  ["del", 1, 0.9],
  ["bom", 0.8, 0.88],
  ["blr", 0.3, 0.85],
  ["pvg", 0.9, 0.92],
  ["hkg", 0.35, 0.85],
  ["icn", 0.5, 0.86],
  ["gru", 0.7, 0.86],
  ["eze", 0.2, 0.8],
  ["scl", 0.2, 0.8],
  ["iad", 0.6, 0.6],
  ["jfk", 0.3, 0.6],
  ["sfo", 0.4, 0.6],
  ["dxb", 0.35, 0.75],
  ["cgk", 0.4, 0.85],
  ["bkk", 0.3, 0.85],
  ["nbo", 0.15, 0.8],
  ["jnb", 0.15, 0.7],
  ["syd", 0.25, 0.6],
  ["per", 0.1, 0.6],
  ["akl", 0.08, 0.6],
  ["lhr", 0.25, 0.6],
];

let demoSources: DemoSource[] | null = null;

function getDemoSources(): DemoSource[] {
  demoSources ??= DEMO_SOURCE_TABLE.flatMap(([id, weight, blockRate]): DemoSource[] => {
    const city = findCity(id);
    if (!city) return [];
    const point: LatLon = { lat: city.lat, lon: city.lon };
    return [{ city: point, region: regionOf(point), weight, blockRate }];
  });
  return demoSources;
}

/**
 * Campaigns, in turn (indexes into the source table): one source sends three times as much for a while, so the top
 * list re-sorts now and then.
 */
const DEMO_CAMPAIGNS: readonly number[] = [6, 12, 3, 5, 9, 13, 0];

interface HistoryItem {
  /** How long ago, in ms. */
  readonly ago: number;
  readonly verdict: ThreatVerdict;
  readonly region: string;
}

/** A window of invented demo history, the same on the server and the client. */
function demoHistory(windowSeconds: number): HistoryItem[] {
  const sources = getDemoSources();
  const items: HistoryItem[] = [];
  if (!sources.length) return items;
  const random = createRandom("geo-threats-history");
  const count = Math.min(6000, Math.round(windowSeconds * DEMO_RATE));
  // the history ends a little before now, so the window does not drop its oldest second right after mount
  const span = Math.max(0, windowSeconds * 1000 - 1500);
  for (let i = 0; i < count; i++) {
    const source = pickWeighted(random, sources, (item) => item.weight);
    items.push({
      ago: span * ((i + random()) / count),
      verdict: random() < source.blockRate ? "blocked" : "allowed",
      region: source.region,
    });
  }
  return items;
}

/** The demo counts for the first render, from a fixed clock, so the server and the client agree. */
function demoSnapshot(windowSeconds: number): Snapshot {
  const run = createRuntime();
  const now = 1_000_000_000_000;
  for (const item of demoHistory(windowSeconds)) addCount(run, now - item.ago, item.verdict, item.region);
  return aggregate(run, now, windowSeconds * 1000, true);
}

/** The next demo request: a weighted source, scattered around its city. */
function nextDemoEvent(run: Runtime): ThreatEvent | null {
  const sources = getDemoSources();
  if (!sources.length) return null;
  const campaign = DEMO_CAMPAIGNS[Math.floor(run.demoCount / DEMO_CAMPAIGN_EVENTS) % DEMO_CAMPAIGNS.length];
  const boosted = sources[campaign % sources.length];
  const source = pickWeighted(run.random, sources, (item) => item.weight * (item === boosted ? 3 : 1));
  const point = scatterAround(run.random, source.city, DEMO_SPREAD_KM, true);
  const verdict: ThreatVerdict = run.random() < source.blockRate ? "blocked" : "allowed";
  return { id: `demo-${run.demoCount++}`, lat: point.lat, lon: point.lon, verdict, region: source.region };
}

/** Milliseconds to the next demo request: random gaps around 250 ms, as in real traffic. */
const demoGap = (random: () => number) => clamp(-Math.log(1 - random()) * (1000 / DEMO_RATE), 50, 1000);

/* Runtime state */

interface Latest {
  site: ThreatTarget;
  rotation: Rotation;
  inFlightCap: number;
  windowMs: number;
  phrase: string;
  ringRadius: number;
  onEvent: ((event: ThreatEvent) => void) | undefined;
  stageInView: boolean;
}

/** A request on its way in. */
interface Entry {
  readonly event: ThreatEvent;
  /** The origin with its latitude clamped and its longitude wrapped. */
  readonly origin: LatLon;
  readonly verdict: ThreatVerdict;
  readonly region: string;
  readonly time: number;
}

/**
 * A request in flight. Its lifted great-circle arc is projected once into unit view space (the view never moves), so a
 * resize only rescales it.
 */
interface Arc {
  readonly entry: Entry;
  /** Unit view space, y down: x = view x, y = −view y. Lengths are in globe radii. */
  readonly table: ArcLengthTable;
  readonly visible: Uint8Array;
  /** View depth per sample; the back half of a lifted arc draws dimmer. */
  readonly depth: Float32Array;
  readonly duration: number;
  /** Where the arc first shows: 0, or where it clears the limb (far-side origins). */
  readonly firstVisible: number;
  /** Where the arc comes up over the limb, or −1 when its origin faces the viewer. */
  readonly limb: number;
  age: number;
  /** Distance of the packet along the arc this frame, in radii. */
  head: number;
  /** Distance where the arc enters the shield circle, for the ring radius in `shieldKey`. */
  shield: number;
  shieldKey: number;
  /** Screen angle of the entry point around the site, and the packet's heading there. */
  impactAngle: number;
  impactHeading: number;
  flicked: boolean;
  crossed: boolean;
  /** Impacted (blocked) or landed (allowed); the trail then retracts. */
  done: boolean;
  /** Seconds since done. */
  erase: number;
}

interface ShieldDot {
  readonly cos: number;
  readonly sin: number;
  readonly angle: number;
  /** Radial offset in px on a spring. */
  readonly offset: { position: number; velocity: number };
  heat: number;
  glint: number;
  verdict: ThreatVerdict;
  /** Reduced motion: seconds left of a still glow. */
  hold: number;
}

/** The limb glint where an arc comes over the horizon: two dots across the path. */
interface Flick {
  x: number;
  y: number;
  angle: number;
  age: number;
}

/** A small flash where a request leaves an origin on the visible side. */
interface Pip {
  x: number;
  y: number;
  verdict: ThreatVerdict;
  age: number;
}

interface Landing {
  age: number;
}

interface LandingDot {
  x: number;
  y: number;
  distance: number;
  jitter: number;
}

/** What the trail visitor needs, kept in one object so forEachDot gets a single long-lived callback. */
interface TrailCursor {
  arc: Arc | null;
  batch: DotBatch | null;
  segment: number;
  head: number;
  from: number;
  start: number;
  fade: number;
  radius: number;
  ox: number;
  oy: number;
}

/** Everything the animation loop and the timers mutate. Lives in a ref, never in React state. */
interface Runtime {
  width: number;
  height: number;
  cx: number;
  cy: number;
  radius: number;
  ringRadius: number;
  /** How far the effects canvas reaches past the stage on the left and the top. */
  offsetX: number;
  offsetY: number;
  rotation: Rotation | null;
  lattice: SphereLattice | null;
  latticeSpacing: number;
  latticePending: number;
  latticeTimer: number;
  ink: GeoInk | null;
  inkStale: boolean;
  sparkHot: RGB;
  discFill: string;
  limbStroke: string;
  land: DotBatch | null;
  trail: Record<ThreatVerdict, DotBatch> | null;
  ring: Record<ThreatVerdict, DotBatch> | null;
  glint: DotBatch | null;
  baseDirty: boolean;
  painted: boolean;
  shield: ShieldDot[];
  arcs: Arc[];
  flicks: Flick[];
  pips: Pip[];
  landings: Landing[];
  landingDots: LandingDot[] | null;
  sparks: Sparks;
  seen: Set<string>;
  seenOrder: string[];
  buckets: Map<number, Bucket>;
  /** The region names the list shows, in order. */
  top: string[];
  refreshTimer: number;
  summaryTime: number;
  /** Site label and window phrase of the current summary; a change refreshes it at once. */
  summaryKey: string;
  /** Whether the demo history has been counted (effects run twice in development). */
  prefilled: boolean;
  random: () => number;
  demoCount: number;
  cursor: TrailCursor;
  visitTrailDot: (x: number, y: number, s: number) => void;
  packet: { x: number; y: number; angle: number };
}

function createRuntime(): Runtime {
  const run: Runtime = {
    width: 0,
    height: 0,
    cx: 0,
    cy: 0,
    radius: 0,
    ringRadius: 0,
    offsetX: 0,
    offsetY: 0,
    rotation: null,
    lattice: null,
    latticeSpacing: 0,
    latticePending: 0,
    latticeTimer: 0,
    ink: null,
    inkStale: true,
    sparkHot: [255, 255, 255],
    discFill: "",
    limbStroke: "",
    land: null,
    trail: null,
    ring: null,
    glint: null,
    baseDirty: true,
    painted: false,
    shield: createShield(SHIELD_DOTS),
    arcs: [],
    flicks: [],
    pips: [],
    landings: [],
    landingDots: null,
    sparks: new Sparks(),
    seen: new Set(),
    seenOrder: [],
    buckets: new Map(),
    top: [],
    refreshTimer: 0,
    summaryTime: Number.NEGATIVE_INFINITY,
    summaryKey: "",
    prefilled: false,
    random: createRandom("geo-threats"),
    demoCount: 0,
    cursor: { arc: null, batch: null, segment: 0, head: 0, from: 0, start: 0, fade: 1, radius: 1, ox: 0, oy: 0 },
    visitTrailDot: () => {},
    packet: { x: 0, y: 0, angle: 0 },
  };
  run.visitTrailDot = (x, y, s) => visitTrailDot(run.cursor, x, y, s);
  return run;
}

function createShield(count: number): ShieldDot[] {
  return Array.from({ length: count }, (_, k): ShieldDot => {
    // dot 0 at the top, clockwise on screen
    const angle = (k / count) * TAU - Math.PI / 2;
    return {
      angle,
      cos: Math.cos(angle),
      sin: Math.sin(angle),
      offset: { position: 0, velocity: 0 },
      heat: 0,
      glint: 0,
      verdict: "blocked",
      hold: 0,
    };
  });
}

/** Shield dot positions around (0, 0), for the server placeholder; rounded so the server and the client agree. */
function shieldOffsets(radius: number) {
  return Array.from({ length: SHIELD_DOTS }, (_, k) => {
    const angle = (k / SHIELD_DOTS) * TAU - Math.PI / 2;
    return { x: Number((Math.cos(angle) * radius).toFixed(2)), y: Number((Math.sin(angle) * radius).toFixed(2)) };
  });
}

/** Drops malformed requests (no id, coordinates that are not numbers, an unknown verdict). */
function isEvent(value: ThreatEvent | null | undefined): value is ThreatEvent {
  if (!value) return false;
  return (
    typeof value.id === "string" &&
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lon) &&
    (value.verdict === "blocked" || value.verdict === "allowed")
  );
}

/** Remembers a seen id; the oldest of the last 4,000 is forgotten. */
function remember(run: Runtime, id: string) {
  run.seen.add(id);
  run.seenOrder.push(id);
  if (run.seenOrder.length > SEEN_LIMIT) {
    for (const old of run.seenOrder.splice(0, run.seenOrder.length - SEEN_LIMIT)) run.seen.delete(old);
  }
}

function countFlying(arcs: readonly Arc[]) {
  let flying = 0;
  for (const arc of arcs) if (!arc.done) flying++;
  return flying;
}

/** Drops every arc, glint, landing and spark (their requests are counted by the caller where they should be). */
function clearEffects(run: Runtime) {
  run.arcs = [];
  run.flicks = [];
  run.pips = [];
  run.landings = [];
  run.sparks.clear();
}

/** Projects a request's lifted arc into unit view space once, marking the samples hidden behind the globe. */
function createArc(entry: Entry, site: LatLon, rotation: Rotation, angle: number): Arc {
  const samples = globeArc(entry.origin, site, { segments: ARC_SEGMENTS, lift: arcLift(angle, ARC_LIFT) });
  const count = ARC_SEGMENTS + 1;
  const xs = new Float32Array(count);
  const ys = new Float32Array(count);
  const visible = new Uint8Array(count);
  const depth = new Float32Array(count);
  const m = rotation;
  let firstVisible = -1;
  let limbIndex = -1;
  for (let i = 0; i < count; i++) {
    const x = samples[i * 3];
    const y = samples[i * 3 + 1];
    const z = samples[i * 3 + 2];
    const vx = m[0] * x + m[1] * y + m[2] * z;
    const vy = m[3] * x + m[4] * y + m[5] * z;
    const vz = m[6] * x + m[7] * y + m[8] * z;
    xs[i] = vx;
    ys[i] = -vy;
    depth[i] = vz;
    visible[i] = isOccluded(vx, vy, vz) ? 0 : 1;
    if (visible[i] && firstVisible < 0) firstVisible = i;
    if (i > 0 && visible[i] && !visible[i - 1] && limbIndex < 0) limbIndex = i;
  }
  const table = buildArcLength(xs, ys, count);
  return {
    entry,
    table,
    visible,
    depth,
    duration: 1 + (0.8 * angle) / Math.PI,
    firstVisible: firstVisible > 0 ? table.distances[firstVisible] : 0,
    limb: limbIndex > 0 ? table.distances[limbIndex] : -1,
    age: 0,
    head: 0,
    shield: table.length,
    shieldKey: -1,
    impactAngle: -Math.PI / 2,
    impactHeading: Math.PI / 2,
    flicked: false,
    crossed: false,
    done: false,
    erase: 0,
  };
}

/**
 * Where the arc enters the shield circle (`unit` radii around the site): the first visible sample inside it,
 * interpolated with the one before. Also the screen angle of that point and the packet's heading there.
 */
function locateShieldEntry(arc: Arc, unit: number, scratch: { x: number; y: number; angle: number }) {
  const { table, visible } = arc;
  const { xs, ys, distances, count } = table;
  let s = table.length;
  for (let i = 0; i < count; i++) {
    if (!visible[i]) continue;
    const r = Math.hypot(xs[i], ys[i]);
    if (r > unit) continue;
    if (i === 0 || !visible[i - 1]) {
      s = distances[i];
    } else {
      const before = Math.hypot(xs[i - 1], ys[i - 1]);
      const t = before > r ? clamp((before - unit) / (before - r), 0, 1) : 1;
      s = distances[i - 1] + (distances[i] - distances[i - 1]) * t;
    }
    break;
  }
  arc.shield = s;
  pointAtDistance(table, s, scratch);
  // a request from right at the site comes from the top
  arc.impactAngle = Math.hypot(scratch.x, scratch.y) > 1e-4 ? Math.atan2(scratch.y, scratch.x) : -Math.PI / 2;
  pointAtDistance(table, Math.max(0, s - 0.02), scratch);
  const bx = scratch.x;
  const by = scratch.y;
  pointAtDistance(table, s, scratch);
  arc.impactHeading =
    Math.hypot(scratch.x - bx, scratch.y - by) > 1e-6
      ? Math.atan2(scratch.y - by, scratch.x - bx)
      : arc.impactAngle + Math.PI;
}

/* Theme and layout */

/**
 * Colours for a theme. Hit dots heat from the verdict colour toward white in dark themes and toward a deeper shade in
 * light ones, so the hottest dot always has the most contrast.
 */
function applyInk(run: Runtime, ink: GeoInk) {
  run.ink = ink;
  run.inkStale = false;
  const hot = (color: RGB): RGB => (ink.dark ? mixRgb(color, ink.glint, 0.75) : mixRgb(color, ink.foreground, 0.35));
  run.sparkHot = ink.dark ? ink.glint : mixRgb(ink.destructive, ink.glint, 0.45);
  run.discFill = rgba(mixRgb(ink.card, ink.foreground, ink.dark ? 0.025 : 0.018));
  run.limbStroke = rgba(ink.border);
  run.land = createDotBatch(8192, [ink.landStrong], { tones: 1, levels: 24 });
  run.trail = {
    blocked: createDotBatch(1024, [ink.destructive, hot(ink.destructive)], { tones: 12 }),
    allowed: createDotBatch(512, [ink.success, hot(ink.success)], { tones: 12 }),
  };
  run.ring = {
    blocked: createDotBatch(64, [ink.landStrong, ink.destructive, hot(ink.destructive)], { tones: 24 }),
    allowed: createDotBatch(64, [ink.landStrong, ink.success, hot(ink.success)], { tones: 24 }),
  };
  run.glint = createDotBatch(32, [ink.hot], { tones: 1 });
  run.baseDirty = true;
}

function layoutView(run: Runtime, width: number, height: number, rotation: Rotation, ringRadius: number) {
  const radius = Math.min(width, height) * RADIUS_SHARE;
  // the ring never grows past most of the disc
  const ring = Math.min(ringRadius, radius * 0.6);
  if (width === run.width && height === run.height && rotation === run.rotation && ring === run.ringRadius) return;
  if (rotation !== run.rotation || radius !== run.radius) run.baseDirty = true;
  if (ring !== run.ringRadius || radius !== run.radius) {
    run.landingDots = null;
    for (const arc of run.arcs) arc.shieldKey = -1;
  }
  run.width = width;
  run.height = height;
  run.cx = width / 2;
  run.cy = height / 2;
  run.radius = radius;
  run.ringRadius = ring;
  run.rotation = rotation;
}

/** Lattice spacing for a radius, on an 8 % ladder so resizing back and forth reuses cached lattices. */
function latticeSpacing(radius: number) {
  const exact = spacingForRadius(radius, LAND_PITCH);
  const step = Math.log(1.08);
  return Math.exp(Math.round(Math.log(exact) / step) * step);
}

/** The land lattice for the current radius: the first at once, later ones once the size rests for 160 ms. */
function ensureLattice(run: Runtime, rebuilt: () => void) {
  if (run.radius <= 0) return;
  const spacing = latticeSpacing(run.radius);
  if (!run.lattice) {
    run.lattice = sphereLattice({ spacingDeg: spacing, method: "rows", landOnly: true });
    run.latticeSpacing = spacing;
    run.baseDirty = true;
    return;
  }
  if (spacing === run.latticeSpacing) {
    // resized back before the pending lattice was built
    if (run.latticePending) {
      window.clearTimeout(run.latticeTimer);
      run.latticePending = 0;
    }
    return;
  }
  if (spacing === run.latticePending) return;
  run.latticePending = spacing;
  window.clearTimeout(run.latticeTimer);
  run.latticeTimer = window.setTimeout(() => {
    run.lattice = sphereLattice({ spacingDeg: spacing, method: "rows", landOnly: true });
    run.latticeSpacing = spacing;
    run.latticePending = 0;
    run.baseDirty = true;
    rebuilt();
  }, 160);
}

/* Frame steps */

interface ArcHandlers {
  impact: (arc: Arc) => void;
  cross: (arc: Arc) => void;
  land: (arc: Arc) => void;
}

const entryScratch = { x: 0, y: 0, angle: 0 };

/** Moves the packets: blocked ones stop at the shield, allowed ones part it and land; finished trails retract. */
function advanceArcs(run: Runtime, delta: number, handlers: ArcHandlers) {
  const radius = run.radius;
  if (radius <= 0) return;
  const unit = run.ringRadius / radius;
  let write = 0;
  for (const arc of run.arcs) {
    if (arc.shieldKey !== unit) {
      locateShieldEntry(arc, unit, entryScratch);
      arc.shieldKey = unit;
    }
    if (arc.done) {
      arc.erase += delta;
      if (arc.erase < TRAIL_ERASE) run.arcs[write++] = arc;
      continue;
    }
    arc.age += delta;
    arc.head = headDistance(arc, PACKET_EASE(clamp(arc.age / arc.duration, 0, 1)));
    if (!arc.flicked && arc.limb >= 0 && arc.head >= arc.limb) {
      arc.flicked = true;
      pointAtDistance(arc.table, arc.limb, run.packet);
      run.flicks.push({ x: run.packet.x, y: run.packet.y, angle: run.packet.angle, age: 0 });
    }
    if (arc.age <= delta && arc.visible[0] && arc.depth[0] > 0.12) {
      run.pips.push({ x: arc.table.xs[0], y: arc.table.ys[0], verdict: arc.entry.verdict, age: 0 });
    }
    if (arc.entry.verdict === "blocked") {
      if (arc.head >= arc.shield) {
        arc.head = arc.shield;
        arc.done = true;
        handlers.impact(arc);
      }
    } else {
      if (!arc.crossed && arc.head >= arc.shield) {
        arc.crossed = true;
        handlers.cross(arc);
      }
      if (arc.age >= arc.duration) {
        arc.head = arc.table.length;
        arc.done = true;
        handlers.land(arc);
      }
    }
    run.arcs[write++] = arc;
  }
  run.arcs.length = write;

  let flickWrite = 0;
  for (const flick of run.flicks) {
    flick.age += delta;
    if (flick.age < FLICK_SECONDS) run.flicks[flickWrite++] = flick;
  }
  run.flicks.length = flickWrite;
  let pipWrite = 0;
  for (const pip of run.pips) {
    pip.age += delta;
    if (pip.age < PIP_SECONDS) run.pips[pipWrite++] = pip;
  }
  run.pips.length = pipWrite;
  let landingWrite = 0;
  for (const landing of run.landings) {
    landing.age += delta;
    if (landing.age < LANDING_SECONDS) run.landings[landingWrite++] = landing;
  }
  run.landings.length = landingWrite;
}

/**
 * Distance along the arc at progress `p` of the great circle (not of the screen path), so far-side packets climb
 * slowly into view.
 */
function headDistance(arc: Arc, p: number) {
  const { distances, count } = arc.table;
  const f = p * (count - 1);
  const i = Math.min(count - 2, Math.floor(f));
  return distances[i] + (distances[i + 1] - distances[i]) * (f - i);
}

/** The shield's dents settle on their springs and its heat fades. Returns whether anything still moves. */
function stepShield(run: Runtime, delta: number, reduced: boolean) {
  let moving = false;
  const cool = Math.exp(-delta / HEAT_SECONDS);
  const fade = Math.exp(-delta / GLINT_SECONDS);
  for (const dot of run.shield) {
    const { offset } = dot;
    if (reduced) {
      offset.position = 0;
      offset.velocity = 0;
      dot.glint = 0;
      if (dot.hold > 0) {
        dot.hold -= delta;
        moving = true;
        if (dot.hold <= 0) {
          dot.hold = 0;
          dot.heat = 0;
        }
      } else dot.heat = 0;
      continue;
    }
    dot.hold = 0;
    if (Math.abs(offset.position) > 0.01 || Math.abs(offset.velocity) > 0.05) {
      springStep(offset, 0, delta, SHIELD_STIFFNESS, SHIELD_DAMPING);
      moving = true;
    } else {
      offset.position = 0;
      offset.velocity = 0;
    }
    if (dot.heat > 0.004) {
      dot.heat *= cool;
      dot.glint *= fade;
      moving = true;
    } else {
      dot.heat = 0;
      dot.glint = 0;
    }
  }
  return moving;
}

/** Wraps an angle difference into (−π, π]. */
function angleBetween(a: number, b: number) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

/** A hit at screen angle `theta`: blocked dents the ring inward and heats it; allowed parts it outward. */
function hitShield(run: Runtime, theta: number, verdict: ThreatVerdict) {
  const span = verdict === "blocked" ? DENT_SPAN : PART_SPAN;
  for (const dot of run.shield) {
    const d = angleBetween(dot.angle, theta);
    if (Math.abs(d) >= span) continue;
    const weight = Math.cos((d / span) * (Math.PI / 2));
    if (verdict === "blocked") {
      dot.offset.velocity -= DENT_KICK * weight;
      dot.heat = Math.max(dot.heat, weight);
      dot.glint = Math.max(dot.glint, weight ** 4);
      dot.verdict = "blocked";
    } else {
      dot.offset.velocity += PART_KICK * weight;
      // an allowed request tints the ring only lightly, and never over a fresher blocked hit
      if (dot.heat < 0.45 * weight) {
        dot.heat = 0.45 * weight;
        dot.verdict = "allowed";
      }
    }
  }
}

const glowScratch: [number, number, number] = [0, 0, 0];

/** Reduced motion: the shield dots facing the request's origin light up for a moment, without any movement. */
function glowShield(run: Runtime, rotation: Rotation, origin: LatLon, verdict: ThreatVerdict) {
  const v = latLonToVector(origin.lat, origin.lon, glowScratch);
  const m = rotation;
  const x = m[0] * v[0] + m[1] * v[1] + m[2] * v[2];
  const y = -(m[3] * v[0] + m[4] * v[1] + m[5] * v[2]);
  if (Math.hypot(x, y) < 1e-3) return;
  const theta = Math.atan2(y, x);
  for (const dot of run.shield) {
    const d = angleBetween(dot.angle, theta);
    if (Math.abs(d) >= DENT_SPAN) continue;
    const weight = Math.cos((d / DENT_SPAN) * (Math.PI / 2));
    if (weight < 0.2) continue;
    dot.heat = Math.max(dot.heat, weight);
    dot.verdict = verdict;
    dot.hold = STILL_GLOW_SECONDS;
  }
}

/* Drawing */

/** The globe: a faint disc, the land dots shaded by their depth, and the limb. Drawn once per size and theme. */
function drawBase(surface: CanvasSurface, run: Runtime) {
  const { context, width, height } = surface;
  context.clearRect(0, 0, width, height);
  const { cx, cy, radius, lattice, land, rotation: m } = run;
  if (radius <= 0 || !m) return;

  context.fillStyle = run.discFill;
  context.beginPath();
  context.arc(cx, cy, radius, 0, TAU);
  context.fill();

  if (lattice && land) {
    const { xyz } = lattice;
    const clearing = TARGET_CLEARING * TARGET_CLEARING;
    for (let i = 0; i < lattice.count; i++) {
      const x = xyz[i * 3];
      const y = xyz[i * 3 + 1];
      const z = xyz[i * 3 + 2];
      const vz = m[6] * x + m[7] * y + m[8] * z;
      if (vz < LIMB_CUTOFF) continue;
      const dx = (m[0] * x + m[1] * y + m[2] * z) * radius;
      const dy = -(m[3] * x + m[4] * y + m[5] * z) * radius;
      if (dx * dx + dy * dy < clearing) continue;
      land.add(cx + dx, cy + dy, LAND_DOT, 0, 0.12 + 0.45 * Math.pow(vz, 0.6));
    }
    land.flush(context);
  }

  context.beginPath();
  context.arc(cx, cy, Math.max(0, radius - 0.5), 0, TAU);
  context.strokeStyle = run.limbStroke;
  context.lineWidth = 1;
  context.stroke();
}

/**
 * Arcs, packets, the shield, landings and sparks, on the canvas that reaches past the stage. Returns whether anything
 * is alive.
 */
function drawEffects(surface: CanvasSurface, run: Runtime, delta: number) {
  const { context, width, height } = surface;
  context.clearRect(0, 0, width, height);
  const { trail, ring, glint, radius } = run;
  if (!trail || !ring || !glint || radius <= 0) return false;
  const ox = run.cx + run.offsetX;
  const oy = run.cy + run.offsetY;

  drawLandings(run, trail.allowed, ox, oy);

  for (const pip of run.pips) {
    const t = pip.age / PIP_SECONDS;
    const fade = (1 - t) * (1 - t);
    trail[pip.verdict].add(ox + pip.x * radius, oy + pip.y * radius, 2.5, 0.4, fade);
  }

  for (const arc of run.arcs) drawArc(run, arc, trail[arc.entry.verdict], ox, oy);
  trail.blocked.flush(context);
  trail.allowed.flush(context);

  for (const flick of run.flicks) {
    const alpha = Math.exp(-flick.age / 0.1);
    const x = ox + flick.x * radius;
    const y = oy + flick.y * radius;
    // two dots across the path, where it clears the horizon
    const nx = -Math.sin(flick.angle) * 2;
    const ny = Math.cos(flick.angle) * 2;
    glint.add(x + nx, y + ny, 2, 0, alpha);
    glint.add(x - nx, y - ny, 2, 0, alpha);
  }
  glint.flush(context);

  drawShield(run, ring, ox, oy);
  ring.blocked.flush(context);
  ring.allowed.flush(context);

  const sparking = run.sparks.step(context, delta);
  return run.arcs.length > 0 || run.flicks.length > 0 || run.pips.length > 0 || run.landings.length > 0 || sparking;
}

/** The comet and its faint dotted trail. Hidden stretches (behind the globe) are skipped. */
function drawArc(run: Runtime, arc: Arc, batch: DotBatch, ox: number, oy: number) {
  const radius = run.radius;
  const { table, visible, depth } = arc;
  const cursor = run.cursor;
  const erase = arc.done ? easeOutCubic(arc.erase / TRAIL_ERASE) : 0;
  cursor.arc = arc;
  cursor.batch = batch;
  cursor.segment = 0;
  cursor.head = arc.head;
  cursor.start = arc.firstVisible;
  // a finished trail retracts toward where the packet stopped, and fades as it goes
  cursor.from = arc.firstVisible + (arc.head - arc.firstVisible) * erase;
  cursor.fade = arc.done ? 1 - erase : 1;
  cursor.radius = radius;
  cursor.ox = ox;
  cursor.oy = oy;
  forEachDot(table, TRAIL_SPACING / radius, cursor.from, arc.head, run.visitTrailDot);
  if (arc.done) return;

  // the comet: a 2 px head and six squares of tail behind it
  const count = table.count;
  const packet = run.packet;
  for (let k = TAIL_SQUARES; k >= 0; k--) {
    const s = arc.head - (k * TAIL_SPACING) / radius;
    if (s < 0) continue;
    const j = segmentAt(table, s);
    if (!visible[j] || !visible[Math.min(count - 1, j + 1)]) continue;
    pointAtDistance(table, s, packet);
    const dim = depth[j] < 0 ? 0.6 : 1;
    const x = ox + packet.x * radius;
    const y = oy + packet.y * radius;
    if (k === 0) batch.add(x, y, 2, 0.55, dim);
    else batch.add(x, y, k < 3 ? 2 : 1.5, 0.3 - k * 0.04, (0.86 - k * 0.12) * dim);
  }
}

/** forEachDot visitor for the arc in `cursor`: skips hidden stretches, eases in at the start and brightens near the head. */
function visitTrailDot(cursor: TrailCursor, x: number, y: number, s: number) {
  const arc = cursor.arc;
  const batch = cursor.batch;
  if (!arc || !batch) return;
  const { table, visible, depth } = arc;
  const last = table.count - 1;
  while (cursor.segment < last - 1 && table.distances[cursor.segment + 1] < s) cursor.segment++;
  const j = cursor.segment;
  if (!visible[j] || !visible[j + 1]) return;
  const radius = cursor.radius;
  const dim = depth[j] < 0 ? 0.5 : 1;
  const ease = smoothstep(cursor.start, cursor.start + 24 / radius, s);
  const nearHead = smoothstep(cursor.head - 48 / radius, cursor.head, s);
  const alpha = (TRAIL_ALPHA + 0.2 * nearHead) * ease * dim * cursor.fade;
  batch.add(cursor.ox + x * radius, cursor.oy + y * radius, 1.5, 0, alpha);
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

/** The shield ring: dots on their radial springs, heated toward the verdict colour (and glint at the centre of a hit). */
function drawShield(run: Runtime, ring: Record<ThreatVerdict, DotBatch>, ox: number, oy: number) {
  const radius = run.ringRadius;
  for (const dot of run.shield) {
    // a flood of hits deepens the dent, but the ring never folds into the site
    const r = Math.max(radius * 0.55, radius + dot.offset.position);
    const heat = dot.heat;
    const tone = Math.min(1, heat * 1.3) * 0.5 + dot.glint * 0.5;
    const alpha = Math.min(1, SHIELD_REST_ALPHA + 0.9 * heat);
    ring[heat > 0 ? dot.verdict : "blocked"].add(
      ox + dot.cos * r,
      oy + dot.sin * r,
      SHIELD_DOT + heat * 0.75,
      tone,
      alpha,
    );
  }
}

/** A small lattice inside the shield, lit by an uneven ring that runs outward from the site after each landing. */
function drawLandings(run: Runtime, batch: DotBatch, ox: number, oy: number) {
  if (!run.landings.length) return;
  const reach = run.ringRadius - 5;
  if (!run.landingDots) run.landingDots = landingLattice(reach);
  for (const landing of run.landings) {
    const t = landing.age / LANDING_SECONDS;
    const front = 6 + (reach - 6) * easeOutCubic(t);
    const fade = 1 - t;
    for (const dot of run.landingDots) {
      const b = ringFront(dot.distance, front, 3.2, dot.jitter, 3) * fade;
      if (b < 0.04) continue;
      batch.add(ox + dot.x, oy + dot.y, 1.5, b * 0.6, Math.min(1, b * 1.1));
    }
  }
}

/** Concentric rings of dots inside the shield, so the landing ripple reads round at any size. */
function landingLattice(reach: number): LandingDot[] {
  const dots: LandingDot[] = [];
  for (let ring = 0, radius = 8; radius <= reach; ring++, radius += LANDING_PITCH) {
    const count = Math.max(6, Math.round((TAU * radius) / 3.6));
    const offset = hash(ring + 0.5) * TAU;
    for (let k = 0; k < count; k++) {
      const angle = offset + (k / count) * TAU;
      dots.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        distance: radius,
        jitter: hash(ring * 97 + k),
      });
    }
  }
  return dots;
}
