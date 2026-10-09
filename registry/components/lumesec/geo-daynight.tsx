"use client";

import * as React from "react";

import { localPoint, snap, useCanvas, type CanvasSurface } from "@/lib/lumesec/canvas";
import { usePalette } from "@/lib/lumesec/color";
import {
  bayer4,
  createDotBatch,
  createGlobeMotion,
  DEG,
  EARTH_RADIUS_KM,
  flyTo,
  GEO_TOKENS,
  geodesicCircle,
  geoInk,
  isValidLatLon,
  latLonToVector,
  nudgeGlobe,
  rotationFromView,
  solarElevation,
  spacingForRadius,
  sphereLattice,
  stepGlobeMotion,
  subsolarPoint,
  toLonLat,
  traceGlobeLine,
  TWILIGHT,
  useGlobeDrag,
  wrapLongitude,
  type DotBatch,
  type GeoInk,
  type GeoPalette,
  type GlobeView,
  type LatLon,
  type SphereLattice,
  type Vec3,
} from "@/lib/lumesec/geo";
import {
  createRandom,
  DEMO_CITIES,
  formatDuration,
  formatLatLon,
  scatterAround,
  toEpochMs,
  useNow,
} from "@/lib/lumesec/geo-data";
import { clamp, hash, mixRgb, rgba, smoothstep, TAU, type RGB } from "@/lib/lumesec/math";
import { prefersReducedMotion, springStep, useAnimationLoop, useLazyRef, useReducedMotion } from "@/lib/lumesec/motion";
import { RollText } from "@/lib/lumesec/roll-text";
import { cn } from "@/lib/utils";

/** A place whose lights the globe draws on the night side. */
export interface DaylightCity {
  /** Stable id; it seeds where the city's lights scatter. */
  readonly id: string;
  /** Display name, used in the globe's accessible label. */
  readonly name: string;
  /** Latitude in degrees, −90 to 90. */
  readonly lat: number;
  /** Longitude in degrees, east positive. */
  readonly lon: number;
  /** 0 to 1: a heavier city has more lights (10 to 40) spread wider (40 to 140 km). */
  readonly weight: number;
}

/** How far into the night the dithered twilight band reaches: civil −6°, nautical −12°, astronomical −18°. */
export type DaylightTwilight = keyof typeof TWILIGHT;

/** Where the globe faces: the dusk terminator, the point under the sun, or a fixed point. */
export type DaylightView = "terminator" | "subsolar" | LatLon;

/** Props of `GeoDaynight`. Other `div` props go to the root. */
export interface GeoDaynightProps extends Omit<React.ComponentProps<"div">, "defaultValue"> {
  /** Instant shown, as epoch ms or a Date (controlled). Use with `onValueChange`. */
  value?: number | Date;
  /** Instant shown first when uncontrolled; without it the globe shows the current time after mount. */
  defaultValue?: number | Date;
  /** Called while scrubbing and when Now is pressed, with the shown instant in epoch ms. */
  onValueChange?: (value: number) => void;
  /** Follows the clock (every 30 s) while uncontrolled and not scrubbed away from now. */
  live?: boolean;
  /** Places whose lights shine at night. Default: the 60 demo cities. An empty array shows no lights. */
  cities?: readonly DaylightCity[];
  /** How far into the night the dithered band reaches (−6°, −12° or −18°). */
  twilight?: DaylightTwilight;
  /** Hours the slider reaches either side of now. */
  scrubRange?: number;
  /** Where the globe faces. It turns there on a soft spring when this changes or Now is pressed, never while scrubbing. */
  view?: DaylightView;
  /** Marks the point where the sun is overhead. */
  showSun?: boolean;
  /** 12-hour clock in the readout. */
  hour12?: boolean;
}

/**
 * A dotted globe split by the terminator. Land dots in the twilight band are drawn with a 4×4 ordered dither, so day
 * thins into night dot by dot, and city lights shine on the night side. Scrubbing the time slider sweeps the terminator
 * across a still globe: as night reaches a city its lights switch on one after another with a small flash, and at dawn
 * they fade out. The UTC time and the offset from now roll as they change.
 *
 * @example
 * <GeoDaynight twilight="civil" onValueChange={(instant) => setShown(instant)} />
 */
export function GeoDaynight({
  value,
  defaultValue,
  onValueChange,
  live = true,
  cities = DEMO_CITIES,
  twilight = "nautical",
  scrubRange = 12,
  view = "terminator",
  showSun = true,
  hour12 = false,
  className,
  ...props
}: GeoDaynightProps) {
  const range = rangeOf(scrubRange);
  const maxSteps = Math.max(1, Math.floor(range * STEPS_PER_HOUR));
  const reducedMotion = useReducedMotion();
  const hintId = React.useId();

  // the clock: null on the server and in the first client render, then every 30 s
  const now = useNow(CLOCK_MS);
  const [firstNow, setFirstNow] = React.useState<number | null>(null);
  if (firstNow === null && now !== null) setFirstNow(now);

  // The pinned instant, or null while following the clock. Controlled through `value`; a parent that sets `value`
  // back to undefined hands the globe back to the clock rather than to an older uncontrolled state.
  const controlled = value !== undefined;
  const [internal, setInternal] = React.useState<number | null>(() => (defaultValue === undefined ? null : toEpochMs(defaultValue)));
  const [wasControlled, setWasControlled] = React.useState(controlled);
  if (wasControlled !== controlled) {
    setWasControlled(controlled);
    if (!controlled) setInternal(null);
  }
  const pinned = controlled ? toEpochMs(value) : internal;
  // the latest pin for handlers that fire before a re-render (key repeat)
  const pinnedRef = React.useRef(pinned);
  React.useEffect(() => {
    pinnedRef.current = pinned;
  });

  const shown = pinned ?? (live ? now : firstNow);
  const offset = shown !== null && now !== null ? shown - now : null;
  const thumbHours = offset === null ? 0 : clamp(offset / HOUR_MS, -range, range);
  const away = offset !== null && Math.abs(offset) >= NOW_TOLERANCE_MS;

  // digits roll up when time moves forward, down when it moves back
  const [roll, setRoll] = React.useState({ shown, direction: 1 });
  if (roll.shown !== shown) {
    setRoll({ shown, direction: shown !== null && roll.shown !== null && shown < roll.shown ? -1 : 1 });
  }
  const direction = roll.direction;

  const clock = shown === null ? null : clockParts(shown, hour12);
  const sun = React.useMemo(() => (shown === null ? null : subsolarPoint(shown)), [shown]);
  const places = React.useMemo(() => cities.filter(isValidCity), [cities]);
  const signature = React.useMemo(() => citySignature(places), [places]);
  const globeLabel = sun ? describeNight(places, sun) : "Globe";
  const timeText = clock ? `${clock.text} UTC` : "Time not set";
  const valueText = offset === null ? timeText : `${timeText}, ${spokenOffset(offset)}`;
  // the chip earns the accent only away from now; at now it says whether the globe follows the clock
  const following = pinned === null && live;
  const chipText = offset !== null && away ? offsetLabel(offset) : following ? "Live" : "Now";
  const viewKey = typeof view === "string" ? view : `${view.lat},${view.lon}`;
  const ticks = React.useMemo(() => tickHours(range), [range]);
  const endLabel = formatHours(range);
  const rangeStart = -range;

  const stageRef = React.useRef<HTMLDivElement>(null);
  const globeCanvasRef = React.useRef<HTMLCanvasElement>(null);
  const trackCanvasRef = React.useRef<HTMLCanvasElement>(null);
  const thumbRef = React.useRef<HTMLDivElement>(null);

  // the view and the scene below are created on first use, not on each of the clock's frequent re-renders
  const motionRef = useLazyRef(() => createGlobeMotion({ lat: 0, stiffness: VIEW_STIFFNESS, damping: 1, latLimit: LAT_LIMIT }));
  const thumb = React.useRef<ThumbMotion>({ position: 0, velocity: 0, target: 0, dragging: false, glide: false, steps: 0, placed: false });
  const glide = React.useRef<TimeGlide>({ shown: null, position: 0, velocity: 0 });
  const sceneRef = useLazyRef(createScene);
  const placed = React.useRef(false);
  // the server markup places the thumb with `left`; the loop moves it from there with a transform
  const [thumbOrigin] = React.useState(() => (thumbHours + range) / (2 * range));

  const latest = React.useRef<Latest>({ range, places, signature, twilight: TWILIGHT[twilight], showSun, view, shown });
  React.useEffect(() => {
    latest.current = { range, places, signature, twilight: TWILIGHT[twilight], showSun, view, shown };
  });

  const loop = useAnimationLoop(stageRef, step);
  const colors = usePalette(stageRef, GEO_TOKENS, () => loop.kick());
  const globe = useCanvas(
    globeCanvasRef,
    (surface) => {
      sceneRef.current.layout = layoutFor(surface);
      loop.kick();
    },
    { maxDpr: 2 },
  );
  const track = useCanvas(trackCanvasRef, (surface) => {
    sceneRef.current.trackDots = buildTrackDots(surface.width, surface.height);
    loop.kick();
  });

  useGlobeDrag(stageRef, motionRef, {
    radius: () => sceneRef.current.layout.radius,
    onChange: () => loop.kick(),
  });

  // Props reach the loop through `latest`; redraw after every render.
  React.useEffect(() => {
    loop.kick();
  });

  // A new shown instant: the drawn time glides there, so the terminator sweeps instead of jumping.
  React.useEffect(() => {
    const state = glide.current;
    if (shown === null) return;
    if (state.shown === null || prefersReducedMotion()) {
      state.position = 0;
      state.velocity = 0;
    } else {
      const lag = state.position + (state.shown - shown);
      state.position = Math.abs(lag) > GLIDE_LIMIT_MS ? 0 : lag;
      if (state.position === 0) state.velocity = 0;
    }
    state.shown = shown;
    loop.kick();
  }, [shown, loop]);

  // Face the view as soon as a time is known; later `view` changes turn the globe on the soft spring.
  const known = shown !== null;
  React.useEffect(() => {
    const { view: currentView, shown: time } = latest.current;
    if (time === null) return;
    const target = viewTarget(currentView, time);
    const state = motionRef.current;
    if (!placed.current || prefersReducedMotion()) {
      placed.current = true;
      state.lon = target.lon;
      state.lat = clamp(target.lat, -LAT_LIMIT, LAT_LIMIT);
      state.target = null;
    } else {
      flyTo(state, target);
    }
    loop.kick();
  }, [viewKey, known, motionRef, loop]);

  // The thumb springs to the shown offset unless a drag holds it; it starts where the first clock reading puts it.
  React.useEffect(() => {
    const state = thumb.current;
    if (state.dragging) return;
    state.target = thumbHours;
    if (prefersReducedMotion() || (!state.placed && now !== null)) {
      state.position = thumbHours;
      state.velocity = 0;
    }
    if (now !== null) state.placed = true;
    loop.kick();
  }, [thumbHours, now, loop]);

  function step(time: number, delta: number) {
    const reduced = prefersReducedMotion();
    const current = latest.current;
    const cache = sceneRef.current;
    let active = stepThumb(delta, reduced, current.range);

    if (stepGlobeMotion(motionRef.current, delta, reduced)) active = true;

    const timeGlide = glide.current;
    if (timeGlide.position !== 0) {
      if (reduced) {
        timeGlide.position = 0;
        timeGlide.velocity = 0;
      } else {
        springStep(timeGlide, 0, delta, GLIDE_STIFFNESS, 1);
        if (Math.abs(timeGlide.position) < 400 && Math.abs(timeGlide.velocity) < 4000) {
          timeGlide.position = 0;
          timeGlide.velocity = 0;
        } else {
          active = true;
        }
      }
    }

    const palette = colors.current;
    if (!palette) return active;
    const ink = inkFor(cache, palette);

    const trackSurface = track.current;
    if (trackSurface) drawTrack(trackSurface, cache.trackDots, ink, thumbX(thumb.current.position, current.range, trackSurface.width));

    const surface = globe.current;
    if (!surface || timeGlide.shown === null || cache.layout.radius <= 0) return active;
    const renderTime = timeGlide.shown + timeGlide.position;

    const land = landFor(cache);
    const lights = lightsFor(cache, land.lattice, current.places, current.signature);
    let sky = cache.sky;
    if (!sky || Math.abs(renderTime - sky.time) >= SKY_STEP_MS || sky.twilight !== current.twilight) {
      sky = computeSky(renderTime, current.twilight);
      cache.sky = sky;
    }
    if (land.shadedAt !== sky) shadeLand(land, sky);
    if (lights.updatedAt !== sky) {
      const mode: LightMode = reduced ? "instant" : !lights.started ? (cache.introPlayed ? "instant" : "intro") : "live";
      updateLights(lights, sky, time, mode);
      lights.started = true;
      if (mode === "intro") cache.introPlayed = true;
    }

    const state = motionRef.current;
    const view: GlobeView = {
      cx: cache.layout.cx,
      cy: cache.layout.cy,
      radius: cache.layout.radius * state.zoom,
      rotation: rotationFromView(state.lon, state.lat, cache.rotation),
    };
    const context = surface.context;
    context.clearRect(0, 0, surface.width, surface.height);
    drawShade(context, view, sky, ink.geo);
    drawLand(context, view, land, ink.land);
    const lightsBusy = drawLights(context, view, lights, ink, time, reduced);
    if (current.showSun) drawSun(context, view, sky, ink.geo.warning, surface.dpr);

    if (!cache.ready) {
      cache.ready = true;
      stageRef.current?.setAttribute("data-ready", "");
    }
    return active || lightsBusy;
  }

  /** Springs the thumb and moves it. Returns whether it is still moving. */
  function stepThumb(delta: number, reduced: boolean, currentRange: number) {
    const state = thumb.current;
    if (!state.dragging || state.glide) {
      if (reduced) {
        state.position = state.target;
        state.velocity = 0;
      } else {
        springStep(state, state.target, delta);
        state.position = clamp(state.position, -currentRange * 1.04, currentRange * 1.04);
      }
    }
    const element = thumbRef.current;
    const width = track.current?.width ?? 0;
    if (element && width) {
      const fraction = (clamp(state.position, -currentRange, currentRange) + currentRange) / (2 * currentRange);
      const shift = (fraction - thumbOrigin) * (width - THUMB_WIDTH);
      element.style.transform = `translate3d(${shift.toFixed(2)}px,0,0)`;
    }
    const settled = Math.abs(state.position - state.target) < 0.002 && Math.abs(state.velocity) < 0.004;
    return state.dragging || !settled;
  }

  /** Pins an instant (null: follow the clock) and reports the instant shown. */
  function setPinned(next: number | null) {
    if (Object.is(pinnedRef.current, next)) return;
    pinnedRef.current = next;
    if (!controlled) setInternal(next);
    const instant = next ?? now;
    if (instant !== null) onValueChange?.(instant);
  }

  /** Commits a slider position, in 15-minute steps from now. Step 0 follows the clock again while `live`. */
  function commitSteps(steps: number) {
    if (now === null) return;
    const clamped = clamp(steps, -maxSteps, maxSteps);
    setPinned(clamped === 0 && live ? null : now + clamped * STEP_MS);
  }

  function goNow() {
    if (now === null) return;
    if (pinnedRef.current === null && live) onValueChange?.(now);
    else setPinned(live ? null : now);
    const state = thumb.current;
    state.dragging = false;
    state.target = 0;
    if (prefersReducedMotion()) {
      state.position = 0;
      state.velocity = 0;
    }
    const target = viewTarget(view, now);
    if (prefersReducedMotion()) {
      motionRef.current.lon = target.lon;
      motionRef.current.lat = clamp(target.lat, -LAT_LIMIT, LAT_LIMIT);
      motionRef.current.target = null;
    } else {
      flyTo(motionRef.current, target);
    }
    loop.kick();
  }

  function dragTo(trackElement: HTMLElement, clientX: number, first: boolean) {
    const state = thumb.current;
    const hours = hoursOnTrack(trackElement, clientX, range);
    if (first && !prefersReducedMotion()) {
      // glide to the press point instead of jumping
      state.target = hours;
      state.glide = true;
    } else {
      state.glide = false;
      state.position = hours;
      state.velocity = 0;
    }
    const steps = Math.round(hours * STEPS_PER_HOUR);
    if (steps !== state.steps) {
      state.steps = steps;
      commitSteps(steps);
    }
    loop.kick();
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || now === null) return;
    event.preventDefault();
    const trackElement = event.currentTarget;
    trackElement.focus({ preventScroll: true });
    trackElement.setPointerCapture(event.pointerId);
    const state = thumb.current;
    state.dragging = true;
    state.steps = Math.round(thumbHours * STEPS_PER_HOUR);
    trackElement.setAttribute("data-dragging", "");
    dragTo(trackElement, event.clientX, true);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (thumb.current.dragging) dragTo(event.currentTarget, event.clientX, false);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const state = thumb.current;
    if (!state.dragging) return;
    state.dragging = false;
    state.glide = false;
    const trackElement = event.currentTarget;
    trackElement.removeAttribute("data-dragging");
    if (trackElement.hasPointerCapture(event.pointerId)) trackElement.releasePointerCapture(event.pointerId);
    state.target = clamp(state.steps, -maxSteps, maxSteps) / STEPS_PER_HOUR;
    loop.kick();
  }

  function handleSliderKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (now === null) return;
    if (event.key === "Home") {
      event.preventDefault();
      goNow();
      return;
    }
    const change = sliderKeySteps(event.key, event.shiftKey);
    if (change === null) return;
    event.preventDefault();
    // from the latest committed instant, so presses that arrive before a re-render still add up
    const instant = pinnedRef.current ?? (live ? now : (firstNow ?? now));
    commitSteps(Math.round((instant - now) / STEP_MS) + change);
  }

  function handleGlobeKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const turn = GLOBE_KEYS[event.key];
    if (!turn) return;
    event.preventDefault();
    nudgeGlobe(motionRef.current, turn[0], turn[1]);
    loop.kick();
  }

  return (
    <div data-slot="geo-daynight" className={cn("grid w-full max-w-[400px] gap-3 text-foreground", className)} {...props}>
      <div
        ref={stageRef}
        role="img"
        tabIndex={0}
        aria-label={globeLabel}
        aria-roledescription="globe"
        aria-describedby={hintId}
        onKeyDown={handleGlobeKeyDown}
        className="group/stage relative aspect-[4/3] w-full cursor-grab touch-pan-y outline-none select-none [-webkit-tap-highlight-color:transparent] active:cursor-grabbing"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 400 300"
          className="absolute inset-0 size-full transition-opacity duration-500 group-data-[ready]/stage:opacity-0 motion-reduce:transition-none"
        >
          <circle cx="200" cy="150" r="132" strokeWidth="1" vectorEffect="non-scaling-stroke" className="fill-foreground/[0.03] stroke-border" />
        </svg>
        <canvas
          ref={globeCanvasRef}
          aria-hidden="true"
          className="pointer-events-none absolute -top-3 -left-3 block h-[calc(100%+24px)] w-[calc(100%+24px)] opacity-0 transition-opacity duration-500 group-data-[ready]/stage:opacity-100 motion-reduce:transition-none"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-1/2 aspect-square h-[88%] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 outline-2 outline-offset-4 outline-lumesec outline-solid group-focus-visible/stage:opacity-100"
        />
        <span id={hintId} className="sr-only">
          Drag or use the arrow keys to turn the globe.
        </span>
      </div>

      <div className="@container">
        <div className="flex min-h-[22px] flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-mono text-[15px] leading-[22px] font-medium tracking-[-0.01em] tabular-nums">
            {clock ? (
              <>
                <RollText text={clock.hours} direction={direction} animate={!reducedMotion} reserve={hour12 ? HOUR12_RESERVE : undefined} />
                :
                <RollText text={clock.minutes} direction={direction} animate={!reducedMotion} />
                {clock.suffix ? (
                  <>
                    {" "}
                    <RollText text={clock.suffix} direction={direction} animate={!reducedMotion} />
                  </>
                ) : null}
              </>
            ) : (
              "--:--"
            )}
          </span>
          <span className="text-[12px] leading-[22px] text-muted-foreground">UTC</span>
          <span
            data-state={away ? "away" : "now"}
            aria-hidden={offset === null || undefined}
            className={cn(
              "inline-flex h-[19px] items-center self-center rounded-[5px] bg-muted px-1.5 font-mono text-[11.5px] leading-none text-muted-foreground tabular-nums transition-colors duration-300 data-[state=away]:bg-lumesec/12 data-[state=away]:text-lumesec motion-reduce:transition-none",
              offset === null && "invisible",
            )}
          >
            <RollText text={chipText} direction={direction} animate={!reducedMotion} />
          </span>
          <span className="w-full text-[12px] leading-[22px] whitespace-nowrap text-muted-foreground @min-[380px]:ml-auto @min-[380px]:w-auto">
            Sun over <span className="font-mono text-[11.5px] tabular-nums">{sun ? formatLatLon(sun, "decimal", 1) : "–"}</span>
          </span>
        </div>
      </div>

      <div className="flex items-start gap-2">
        <div className="grid min-w-0 flex-1 gap-1.5">
          <div
            role="slider"
            tabIndex={0}
            aria-label="Time shown"
            aria-valuemin={rangeStart}
            aria-valuemax={range}
            aria-valuenow={Math.round(thumbHours * 100) / 100}
            aria-valuetext={valueText}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onKeyDown={handleSliderKeyDown}
            className="group/track relative h-6 cursor-pointer touch-none rounded-lg bg-muted outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid data-[dragging]:cursor-grabbing"
          >
            <canvas ref={trackCanvasRef} aria-hidden="true" className="absolute inset-0 block size-full rounded-lg" />
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              {ticks.map((hours) => (
                <div
                  key={hours}
                  className={cn(
                    "absolute top-[9px] -ml-px h-1.5 w-0.5 rounded-[1px] bg-foreground/24",
                    hours === 0 && "top-[7px] h-2.5 bg-foreground/48",
                  )}
                  style={{ left: stopOffset(hours, range) }}
                />
              ))}
            </div>
            <div
              ref={thumbRef}
              className="pointer-events-none absolute top-0 z-[2] h-6 w-4 will-change-transform"
              style={{ left: `calc((100% - ${THUMB_WIDTH}px) * ${thumbOrigin})` }}
            >
              <div className="absolute inset-0 rounded-md bg-white shadow-[0_1px_2px_rgba(0,0,0,.28),0_0_0_.5px_rgba(0,0,0,.18)] [transition:transform_.18s_cubic-bezier(.2,.8,.2,1)] group-data-[dragging]/track:[transform:scale(.9,.94)] motion-reduce:transition-none"
              />
            </div>
          </div>
          <div aria-hidden="true" className="relative h-3.5 text-[11px] leading-[14px] text-muted-foreground tabular-nums">
            <span className="absolute left-0">
              {MINUS}
              {endLabel} h
            </span>
            <span className="absolute left-1/2 -translate-x-1/2">Now</span>
            <span className="absolute right-0">+{endLabel} h</span>
          </div>
        </div>
        <button
          type="button"
          onClick={goNow}
          data-state={away ? "away" : "now"}
          className="h-6 shrink-0 cursor-pointer rounded-md border border-border bg-card px-2.5 font-[inherit] text-[12px] leading-none font-medium text-muted-foreground transition-colors duration-200 outline-none hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid data-[state=away]:text-foreground"
        >
          Now
        </button>
      </div>
    </div>
  );
}

/* Constants ------------------------------------------------------------------------------------------ */

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
/** The slider moves in 15-minute steps. */
const STEP_MS = 15 * MINUTE_MS;
const STEPS_PER_HOUR = HOUR_MS / STEP_MS;
/** The clock refreshes every 30 s; the sky is recomputed when the drawn time moves this far. */
const CLOCK_MS = 30_000;
const SKY_STEP_MS = 30_000;
/** Offsets under this read as "Now". */
const NOW_TOLERANCE_MS = 30_000;
/** Larger jumps of the shown time do not glide (the sun would spin around the globe). */
const GLIDE_LIMIT_MS = 13 * HOUR_MS;
/** Critically damped, so the drawn time never overshoots and lights do not flicker back. */
const GLIDE_STIFFNESS = 140;
/** The soft spring that re-centres the view. */
const VIEW_STIFFNESS = 60;
const LAT_LIMIT = 35;

/** Globe radius as a share of the stage's shorter side. */
const RADIUS_SHARE = 0.44;
/** The globe canvas reaches this far past the stage on every side, for the sun's rays and the ignition halos. */
const OUTSET = 12;
/** Land dot pitch at the centre of the disc, and the dot size, in CSS px. */
const DOT_PITCH = 3.5;
const DOT_SIZE = 1.5;
const LIGHT_SIZE = 1.5;
const FLASH_SIZE = 2.5;
/** The accent glow under a lit dot, in px (its alpha depends on the theme, see inkFor). */
const GLOW_SIZE = 4.5;
/** Seconds of the ignition flash, and of the fade when a light goes out. */
const FLASH_SECONDS = 0.25;
const FLASH_TAIL_SECONDS = 1.1;
const FADE_SECONDS = 0.4;

const THUMB_WIDTH = 16;
const TRACK_PAD = THUMB_WIDTH / 2;
const TRACK_PITCH = 3.5;
const TRACK_DOT = 1.5;
/** How far behind the thumb (in px) the offset trail stays dense. */
const TRAIL_HEAD = 72;

const MINUS = "−";
const HOUR12_RESERVE = ["12"] as const;

const GLOBE_KEYS: Record<string, readonly [number, number] | undefined> = {
  ArrowLeft: [-10, 0],
  ArrowRight: [10, 0],
  ArrowUp: [0, 10],
  ArrowDown: [0, -10],
};

/* State --------------------------------------------------------------------------------------------- */

/** Thumb physics in hours from now. Lives in a ref. */
interface ThumbMotion {
  position: number;
  velocity: number;
  target: number;
  dragging: boolean;
  /** A press glides the thumb to the press point; moving the pointer then drags it directly. */
  glide: boolean;
  /** The 15-minute step last committed by the drag. */
  steps: number;
  /** Set once the first clock reading placed the thumb. */
  placed: boolean;
}

/** The drawn time trails the shown time on a spring: `position` is the lag in ms (drawn − shown). */
interface TimeGlide {
  shown: number | null;
  position: number;
  velocity: number;
}

/** Props the animation loop reads. */
interface Latest {
  range: number;
  places: readonly DaylightCity[];
  signature: string;
  twilight: number;
  showSun: boolean;
  view: DaylightView;
  shown: number | null;
}

interface GlobeLayout {
  cx: number;
  cy: number;
  radius: number;
}

/** The sun for one drawn instant, and the night and deep-night rings around the point opposite it. */
interface Sky {
  time: number;
  twilight: number;
  sunVector: Vec3;
  night: Float64Array;
  deep: Float64Array;
}

/** Land dots of the globe and which of them are lit, for the sky they were shaded for. */
interface LandField {
  lattice: SphereLattice;
  day: Uint8Array;
  shadedAt: Sky | null;
}

type LightMode = "intro" | "live" | "instant";

/**
 * City lights snapped to land dots: unit vectors, the sun elevation each switches at, how bright it is (how many of
 * the city's lights fell on it), and its on/off state with the time it changed.
 */
interface LightField {
  signature: string;
  lattice: SphereLattice;
  count: number;
  xyz: Float32Array;
  threshold: Float32Array;
  jitter: Float32Array;
  strength: Float32Array;
  elevation: Float32Array;
  on: Uint8Array;
  /** Loop time in seconds the light switched (on: ignition, may lie ahead for a staggered start; off: fade start). */
  changedAt: Float64Array;
  updatedAt: Sky | null;
  started: boolean;
}

interface TrackDot {
  x: number;
  y: number;
  density: number;
}

interface SceneInk {
  palette: GeoPalette;
  geo: GeoInk;
  land: DotBatch;
  light: DotBatch;
  halo: DotBatch;
  /** Alpha of the glow under a lit dot. */
  glow: number;
  trackGrey: RGB;
}

/** Everything the loop caches between frames. Lives in a ref. */
interface Scene {
  layout: GlobeLayout;
  land: LandField | null;
  lights: LightField | null;
  sky: Sky | null;
  ink: SceneInk | null;
  rotation: Float64Array;
  trackDots: TrackDot[];
  introPlayed: boolean;
  ready: boolean;
}

function createScene(): Scene {
  return {
    layout: { cx: 0, cy: 0, radius: 0 },
    land: null,
    lights: null,
    sky: null,
    ink: null,
    rotation: new Float64Array(9),
    trackDots: [],
    introPlayed: false,
    ready: false,
  };
}

/* Time, text and validation -------------------------------------------------------------------------- */

function rangeOf(hours: number) {
  return Number.isFinite(hours) && hours > 0 ? clamp(hours, 0.25, 24 * 14) : 12;
}

function isValidCity(city: DaylightCity) {
  return isValidLatLon(city) && typeof city.name === "string";
}

/** Changes only when a city's identity, place or weight changes, so an inline array does not rebuild the lights. */
function citySignature(places: readonly DaylightCity[]) {
  return places.map((city) => `${city.id}:${city.lat.toFixed(4)}:${city.lon.toFixed(4)}:${weightOf(city).toFixed(3)}`).join("|");
}

const weightOf = (city: DaylightCity) => clamp(Number.isFinite(city.weight) ? city.weight : 0.5, 0, 1);

interface ClockParts {
  hours: string;
  minutes: string;
  suffix: string | null;
  text: string;
}

/** UTC wall-clock digits of an instant, read straight from the epoch so server and client agree. */
function clockParts(time: number, hour12: boolean): ClockParts {
  const dayMinutes = ((Math.floor(time / MINUTE_MS) % 1440) + 1440) % 1440;
  const hour = Math.floor(dayMinutes / 60);
  const minutes = String(dayMinutes % 60).padStart(2, "0");
  if (!hour12) {
    const hours = String(hour).padStart(2, "0");
    return { hours, minutes, suffix: null, text: `${hours}:${minutes}` };
  }
  const hours = String(((hour + 11) % 12) + 1);
  const suffix = hour < 12 ? "AM" : "PM";
  return { hours, minutes, suffix, text: `${hours}:${minutes} ${suffix}` };
}

/** '+3 h', '−45 m', '+2 d 4 h', or 'Now' within half a minute. */
function offsetLabel(offset: number) {
  if (Math.abs(offset) < NOW_TOLERANCE_MS) return "Now";
  return `${offset > 0 ? "+" : MINUS}${formatDuration(Math.abs(offset))}`;
}

/** 'now', '3 hours ahead', '2 hours 15 minutes behind', for aria-valuetext. */
function spokenOffset(offset: number) {
  const total = Math.round(Math.abs(offset) / MINUTE_MS);
  if (Math.abs(offset) < NOW_TOLERANCE_MS || total === 0) return "now";
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  const unit = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (days) parts.push(unit(days, "day"));
  if (hours) parts.push(unit(hours, "hour"));
  if (minutes && !days) parts.push(unit(minutes, "minute"));
  return `${parts.join(" ")} ${offset > 0 ? "ahead" : "behind"}`;
}

function formatHours(hours: number) {
  return String(Number(hours.toFixed(2)));
}

/** Tick hours every 3 h, coarser for long ranges so the track never gets crowded. */
function tickHours(range: number) {
  const spacing = [3, 6, 12, 24, 48, 96].find((hours) => (2 * range) / hours <= 16) ?? 168;
  const ticks: number[] = [];
  for (let hours = -Math.floor(range / spacing) * spacing; hours <= range + 1e-9; hours += spacing) ticks.push(hours);
  if (!ticks.includes(0)) ticks.push(0);
  return ticks;
}

/** CSS `left` of an offset on the track: the thumb's centre never leaves the track. */
const stopOffset = (hours: number, range: number) =>
  `calc(${TRACK_PAD}px + (100% - ${TRACK_PAD * 2}px) * ${(hours + range) / (2 * range)})`;

const thumbX = (hours: number, range: number, width: number) =>
  TRACK_PAD + ((clamp(hours, -range, range) + range) / (2 * range)) * (width - 2 * TRACK_PAD);

/** Hours under a pointer on the track, measured in the track's own px so CSS zoom on an ancestor does not skew it. */
function hoursOnTrack(trackElement: HTMLElement, clientX: number, range: number) {
  const { x } = localPoint(trackElement, clientX, 0);
  const fraction = clamp((x - TRACK_PAD) / Math.max(1, trackElement.offsetWidth - 2 * TRACK_PAD), 0, 1);
  return (fraction * 2 - 1) * range;
}

/** 15-minute steps a key moves the slider, or null for keys it ignores. */
function sliderKeySteps(key: string, shift: boolean) {
  const arrow = shift ? STEPS_PER_HOUR : 1;
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return arrow;
    case "ArrowLeft":
    case "ArrowDown":
      return -arrow;
    case "PageUp":
      return 3 * STEPS_PER_HOUR;
    case "PageDown":
      return -3 * STEPS_PER_HOUR;
    default:
      return null;
  }
}

/** The globe's centre for a view at an instant. The terminator view faces dusk, so day and night split the disc. */
function viewTarget(view: DaylightView, time: number): LatLon {
  if (typeof view === "object" && Number.isFinite(view.lat) && Number.isFinite(view.lon)) {
    return { lat: view.lat, lon: wrapLongitude(view.lon) };
  }
  // a point without a usable position faces dusk, like the default view
  const sun = subsolarPoint(time);
  if (view === "subsolar") return sun;
  return { lat: clamp(0.8 * sun.lat, -20, 20), lon: wrapLongitude(sun.lon + 90) };
}

/** 'Night in Tokyo, Sydney and 9 more', heaviest cities first. */
function describeNight(places: readonly DaylightCity[], sun: LatLon) {
  if (places.length === 0) return "Globe without cities";
  const dark = places
    .map((city, index) => ({ city, index }))
    .filter(({ city }) => solarElevation(city, sun) < 0)
    .sort((a, b) => weightOf(b.city) - weightOf(a.city) || a.index - b.index)
    .map(({ city }) => city.name);
  if (dark.length === 0) return "Daylight in every city";
  if (dark.length === places.length) return "Night in every city";
  if (dark.length <= 3) return `Night in ${dark.length === 1 ? dark[0] : `${dark.slice(0, -1).join(", ")} and ${dark[dark.length - 1]}`}`;
  return `Night in ${dark[0]}, ${dark[1]} and ${dark.length - 2} more`;
}

/* Scene building ------------------------------------------------------------------------------------ */

function layoutFor(surface: CanvasSurface): GlobeLayout {
  const stageWidth = surface.width - 2 * OUTSET;
  const stageHeight = surface.height - 2 * OUTSET;
  return { cx: surface.width / 2, cy: surface.height / 2, radius: Math.max(0, RADIUS_SHARE * Math.min(stageWidth, stageHeight)) };
}

/** Drawing colours for the current palette; the dot batches are kept and only re-tinted on a theme change. */
function inkFor(cache: Scene, palette: GeoPalette): SceneInk {
  const known = cache.ink;
  if (known && known.palette === palette) return known;
  const geo = geoInk(palette);
  // city lights: white in the dark theme, the accent on light; the ignition flash runs toward the shine colour
  const landStops: RGB[] = [geo.land, geo.landStrong];
  const lightStops: RGB[] = [geo.dark ? geo.glint : geo.accent, geo.shine];
  const haloStops: RGB[] = [geo.accent];
  const ink: SceneInk = {
    palette,
    geo,
    land: known?.land ?? createDotBatch(4096, landStops, { tones: 2, levels: 24 }),
    light: known?.light ?? createDotBatch(2048, lightStops, { tones: 6, levels: 20 }),
    halo: known?.halo ?? createDotBatch(1024, haloStops, { tones: 1, levels: 32 }),
    // the glow under lit dots needs more alpha to show on a dark card
    glow: geo.dark ? 0.3 : 0.16,
    trackGrey: mixRgb(geo.muted, geo.card, 1 / 3),
  };
  if (known) {
    ink.land.setRamp(landStops);
    ink.light.setRamp(lightStops);
    ink.halo.setRamp(haloStops);
  }
  cache.ink = ink;
  return ink;
}

function landFor(cache: Scene): LandField {
  // quantised, so a resize by a pixel or two keeps the cached lattice
  const spacing = Math.round(spacingForRadius(cache.layout.radius, DOT_PITCH) * 50) / 50;
  const lattice = sphereLattice({ spacingDeg: spacing, landOnly: true });
  const known = cache.land;
  if (known && known.lattice === lattice) return known;
  const land: LandField = { lattice, day: new Uint8Array(lattice.count), shadedAt: null };
  cache.land = land;
  return land;
}

function lightsFor(cache: Scene, lattice: SphereLattice, places: readonly DaylightCity[], signature: string): LightField {
  const known = cache.lights;
  if (known && known.signature === signature && known.lattice === lattice) return known;
  // a rebuilt field (new cities, or a resize) starts without the intro: its first update is instant
  const lights = buildLights(places, lattice, signature);
  cache.lights = lights;
  return lights;
}

/**
 * Scatters each city's lights around it, seeded by the city id so they never move, then snaps them onto the globe's
 * land dots: a city becomes a patch of lit dots, brightest where most of its lights fall. A light far from any land
 * dot (a small island) keeps its own position.
 */
function buildLights(places: readonly DaylightCity[], lattice: SphereLattice, signature: string): LightField {
  const { find, spacing } = createDotFinder(lattice);
  // on small globes a land dot covers more than a city's spread; widen it so a city still lights a patch of dots
  const spread = Math.max(1, (spacing * DEG * EARTH_RADIUS_KM) / 110);
  const dots = new Map<number, { count: number; jitter: number }>();
  const loose: { vector: Vec3; jitter: number }[] = [];
  places.forEach((city) => {
    const weight = weightOf(city);
    const random = createRandom(`geo-daynight:${city.id}`);
    const lightCount = Math.round(10 + 30 * weight);
    for (let k = 0; k < lightCount; k++) {
      const point = scatterAround(random, city, (40 + 100 * weight) * spread, true);
      const jitter = random();
      const vector = latLonToVector(point.lat, point.lon);
      const index = find(vector);
      if (index < 0) {
        loose.push({ vector, jitter });
        continue;
      }
      const dot = dots.get(index);
      if (dot) dot.count++;
      else dots.set(index, { count: 1, jitter });
    }
  });

  const count = dots.size + loose.length;
  const xyz = new Float32Array(count * 3);
  const threshold = new Float32Array(count);
  const jitter = new Float32Array(count);
  const strength = new Float32Array(count);
  let i = 0;
  const add = (x: number, y: number, z: number, j: number, lights: number) => {
    xyz[i * 3] = x;
    xyz[i * 3 + 1] = y;
    xyz[i * 3 + 2] = z;
    jitter[i] = j;
    // a dot switches at −6° to −4°, so a city lights up over a few minutes of solar time, not at once
    threshold[i] = -6 + 2 * j;
    strength[i] = 0.5 + 0.5 * Math.min(1, lights / 4);
    i++;
  };
  for (const [index, dot] of dots) add(lattice.xyz[index * 3], lattice.xyz[index * 3 + 1], lattice.xyz[index * 3 + 2], dot.jitter, dot.count);
  for (const light of loose) add(light.vector[0], light.vector[1], light.vector[2], light.jitter, 1);
  return {
    signature,
    lattice,
    count,
    xyz,
    threshold,
    jitter,
    strength,
    elevation: new Float32Array(count),
    on: new Uint8Array(count),
    changedAt: new Float64Array(count).fill(-Infinity),
    updatedAt: null,
    started: false,
  };
}

/**
 * Nearest land dot to a unit vector, or −1 when none lies within 1.5 lattice spacings. The lattice is ordered by
 * rows, so only the dots of the three nearest rows are compared.
 */
function createDotFinder(lattice: SphereLattice) {
  const rows = new Map<number, [start: number, end: number]>();
  for (let i = 0; i < lattice.count; i++) {
    const row = lattice.row[i];
    const span = rows.get(row);
    if (span) span[1] = i + 1;
    else rows.set(row, [i, i + 1]);
  }
  // row spacing in degrees, read from two consecutive rows
  let spacing = 2;
  for (let i = 1; i < lattice.count; i++) {
    if (lattice.row[i] !== lattice.row[i - 1]) {
      spacing = Math.abs(lattice.lat[i] - lattice.lat[i - 1]) / Math.max(1, Math.abs(lattice.row[i] - lattice.row[i - 1]));
      break;
    }
  }
  const limit = Math.cos(1.5 * spacing * DEG);
  const find = (vector: Readonly<Vec3>) => {
    const lat = Math.asin(clamp(vector[1], -1, 1)) / DEG;
    const centre = Math.round((lat + 90 - spacing / 2) / spacing);
    let best = -1;
    let bestDot = limit;
    for (let row = centre - 1; row <= centre + 1; row++) {
      const span = rows.get(row);
      if (!span) continue;
      for (let i = span[0]; i < span[1]; i++) {
        const dot = lattice.xyz[i * 3] * vector[0] + lattice.xyz[i * 3 + 1] * vector[1] + lattice.xyz[i * 3 + 2] * vector[2];
        if (dot > bestDot) {
          bestDot = dot;
          best = i;
        }
      }
    }
    return best;
  };
  return { find, spacing };
}

function computeSky(time: number, twilight: number): Sky {
  const sun = subsolarPoint(time);
  const antisolar = { lat: -sun.lat, lon: wrapLongitude(sun.lon + 180) };
  const quarter = (EARTH_RADIUS_KM * Math.PI) / 2;
  return {
    time,
    twilight,
    sunVector: latLonToVector(sun.lat, sun.lon),
    // both rings run clockwise around the night side, so traceGlobeLine fills what they enclose
    night: toLonLat(geodesicCircle(antisolar, quarter, 128)),
    deep: toLonLat(geodesicCircle(antisolar, EARTH_RADIUS_KM * (90 + twilight) * DEG, 128)),
  };
}

/** Day or night per land dot: the twilight band is an ordered dither, so day thins into night dot by dot. */
function shadeLand(land: LandField, sky: Sky) {
  const { lattice, day } = land;
  const { xyz, row, column } = lattice;
  const [sx, sy, sz] = sky.sunVector;
  for (let i = 0; i < lattice.count; i++) {
    const sine = xyz[i * 3] * sx + xyz[i * 3 + 1] * sy + xyz[i * 3 + 2] * sz;
    const elevation = Math.asin(clamp(sine, -1, 1)) / DEG;
    const level = smoothstep(sky.twilight, 3, elevation);
    day[i] = bayer4(row[i], column[i]) < level ? 1 : 0;
  }
  land.shadedAt = sky;
}

/**
 * Switches lights for a new sky. `live` flashes each light at the moment it crosses its threshold; `intro` lights the
 * night side from the terminator outward on first view; `instant` sets the state without any animation.
 */
function updateLights(lights: LightField, sky: Sky, clock: number, mode: LightMode) {
  const { xyz, threshold, elevation, on, changedAt, jitter } = lights;
  const [sx, sy, sz] = sky.sunVector;
  for (let i = 0; i < lights.count; i++) {
    const sine = xyz[i * 3] * sx + xyz[i * 3 + 1] * sy + xyz[i * 3 + 2] * sz;
    const e = Math.asin(clamp(sine, -1, 1)) / DEG;
    elevation[i] = e;
    const target = e < threshold[i] ? 1 : 0;
    if (mode === "instant") {
      on[i] = target;
      changedAt[i] = -Infinity;
    } else if (mode === "intro") {
      on[i] = target;
      // nearest the terminator first, deepest night last
      changedAt[i] = target ? clock + 0.15 + Math.min(1, (threshold[i] - e) / 50) * 1.1 + jitter[i] * 0.12 : -Infinity;
    } else if (target !== on[i]) {
      const visible = clock >= changedAt[i];
      on[i] = target;
      changedAt[i] = target ? clock : visible ? clock : -Infinity;
    }
  }
  lights.updatedAt = sky;
}

function buildTrackDots(width: number, height: number): TrackDot[] {
  const columns = Math.floor((width - 4) / TRACK_PITCH);
  const rows = Math.floor((height - 4) / TRACK_PITCH);
  const left = (width - (columns - 1) * TRACK_PITCH) / 2;
  const top = (height - (rows - 1) * TRACK_PITCH) / 2;
  const dots: TrackDot[] = [];
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows; row++) {
      const seed = column * 31 + row * 7 + 1;
      dots.push({ x: left + column * TRACK_PITCH, y: top + row * TRACK_PITCH, density: hash(seed) });
    }
  }
  return dots;
}

/* Drawing ------------------------------------------------------------------------------------------- */

/**
 * The shaded hemisphere: on a light card the night side darkens, on a dark card the day side lightens, so day always
 * reads as the lit half. The ring at the twilight limit adds a second, fainter step.
 */
function drawShade(context: CanvasRenderingContext2D, view: GlobeView, sky: Sky, ink: GeoInk) {
  const { cx, cy, radius, rotation } = view;
  const [sx, sy, sz] = sky.sunVector;
  // the sun's depth in view space; at ±1 the terminator lies on the limb, where tracing it is numerically unstable
  const sunDepth = rotation[6] * sx + rotation[7] * sy + rotation[8] * sz;
  const traceArea = (ring: Float64Array) => {
    if (ring === sky.night && sunDepth > 0.9995) return;
    if (ring === sky.night && sunDepth < -0.9995) {
      context.moveTo(cx + radius, cy);
      context.arc(cx, cy, radius, 0, TAU);
      return;
    }
    traceGlobeLine(context, view, ring, true);
  };
  const fill = (ring: Float64Array, alpha: number) => {
    context.beginPath();
    if (ink.dark) {
      // the disc plus the night area, filled even-odd, is the day side
      context.moveTo(cx + radius, cy);
      context.arc(cx, cy, radius, 0, TAU);
    }
    traceArea(ring);
    context.fillStyle = rgba(ink.foreground, alpha);
    context.fill("evenodd");
  };
  fill(sky.night, 0.05);
  fill(sky.deep, 0.025);

  context.beginPath();
  context.arc(cx, cy, radius, 0, TAU);
  context.lineWidth = 1;
  context.strokeStyle = rgba(ink.border);
  context.stroke();
}

function drawLand(context: CanvasRenderingContext2D, view: GlobeView, land: LandField, batch: DotBatch) {
  const { cx, cy, radius, rotation: m } = view;
  const { lattice, day } = land;
  const { xyz } = lattice;
  for (let i = 0; i < lattice.count; i++) {
    const x0 = xyz[i * 3];
    const y0 = xyz[i * 3 + 1];
    const z0 = xyz[i * 3 + 2];
    const z = m[6] * x0 + m[7] * y0 + m[8] * z0;
    if (z <= 0.01) continue;
    const x = m[0] * x0 + m[1] * y0 + m[2] * z0;
    const y = m[3] * x0 + m[4] * y0 + m[5] * z0;
    const depth = 0.25 + 0.75 * Math.pow(z, 0.6);
    const lit = day[i];
    batch.add(cx + x * radius, cy - y * radius, DOT_SIZE, lit, (lit ? 0.9 : 0.36) * depth);
  }
  batch.flush(context);
}

/** City lights with their ignition flash. Returns whether any light is still flashing, fading or waiting to ignite. */
function drawLights(context: CanvasRenderingContext2D, view: GlobeView, lights: LightField, ink: SceneInk, clock: number, reduced: boolean) {
  const { cx, cy, radius, rotation: m } = view;
  const { xyz, elevation, on, changedAt, strength } = lights;
  let busy = false;
  for (let i = 0; i < lights.count; i++) {
    // lights on the day side are never drawn
    if (elevation[i] >= 0) continue;
    const x0 = xyz[i * 3];
    const y0 = xyz[i * 3 + 1];
    const z0 = xyz[i * 3 + 2];
    const z = m[6] * x0 + m[7] * y0 + m[8] * z0;
    if (z <= 0.01) continue;
    const age = clock - changedAt[i];
    if (!on[i] && !(age >= 0 && age < FADE_SECONDS)) continue;
    if (on[i] && age < 0) {
      busy = true;
      continue;
    }
    const x = cx + (m[0] * x0 + m[1] * y0 + m[2] * z0) * radius;
    const y = cy - (m[3] * x0 + m[4] * y0 + m[5] * z0) * radius;
    const depth = (0.35 + 0.65 * Math.sqrt(z)) * strength[i];
    if (!on[i]) {
      busy = true;
      const fade = 1 - age / FADE_SECONDS;
      ink.light.add(x, y, LIGHT_SIZE, 0, 0.85 * fade * depth);
      ink.halo.add(x, y, GLOW_SIZE, 0, ink.glow * fade * depth);
      continue;
    }
    const flash = reduced || age >= FLASH_TAIL_SECONDS ? 0 : Math.exp(-age / FLASH_SECONDS);
    if (flash > 0.01) busy = true;
    const size = !reduced && age < FLASH_SECONDS ? FLASH_SIZE : LIGHT_SIZE;
    ink.light.add(x, y, size, flash, Math.min(1, 0.85 * depth + 0.9 * flash));
    // a soft square of accent under each lit dot; overlapping squares pool into a city glow
    ink.halo.add(x, y, GLOW_SIZE, 0, (ink.glow + 0.25 * flash) * depth);
    if (flash > 0.08) {
      // the ignition twinkle: four pixel arms that drift outward as the flash fades
      const reach = 2.5 + 3 * (1 - flash);
      const alpha = 0.9 * flash * depth;
      ink.light.add(x - reach, y, 1, 1, alpha);
      ink.light.add(x + reach, y, 1, 1, alpha);
      ink.light.add(x, y - reach, 1, 1, alpha);
      ink.light.add(x, y + reach, 1, 1, alpha);
    }
  }
  ink.halo.flush(context);
  ink.light.flush(context);
  return busy;
}

/** A 4 px square where the sun is overhead, with three dotted rays pointing away from the globe's centre. */
function drawSun(context: CanvasRenderingContext2D, view: GlobeView, sky: Sky, color: RGB, dpr: number) {
  const { cx, cy, radius, rotation: m } = view;
  const [sx, sy, sz] = sky.sunVector;
  let x = m[0] * sx + m[1] * sy + m[2] * sz;
  let y = m[3] * sx + m[4] * sy + m[5] * sz;
  const z = m[6] * sx + m[7] * sy + m[8] * sz;
  if (z < -0.2) return;
  let alpha = 1;
  if (z < 0) {
    // just behind the limb: keep the marker on the edge while it fades, so the sun's side stays readable
    const length = Math.hypot(x, y) || 1;
    x /= length;
    y /= length;
    alpha = 1 + z / 0.2;
  }
  const px = cx + x * radius;
  const py = cy - y * radius;
  const distance = Math.hypot(px - cx, py - cy);
  // outward from the centre; near the centre the rays point up
  const outward = smoothstep(0.12 * radius, 0.4 * radius, distance);
  let ux = distance > 0 ? ((px - cx) / distance) * outward : 0;
  let uy = distance > 0 ? ((py - cy) / distance) * outward - (1 - outward) : -1;
  const length = Math.hypot(ux, uy) || 1;
  ux /= length;
  uy /= length;
  context.fillStyle = rgba(color);
  for (const turn of [-0.6, 0, 0.6]) {
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const rx = ux * cos - uy * sin;
    const ry = ux * sin + uy * cos;
    RAY_DOTS.forEach((reach, k) => {
      context.globalAlpha = alpha * RAY_ALPHA[k];
      context.fillRect(snap(px + rx * reach - 0.75, dpr), snap(py + ry * reach - 0.75, dpr), 1.5, 1.5);
    });
  }
  context.globalAlpha = alpha;
  context.fillRect(snap(px - 2, dpr), snap(py - 2, dpr), 4, 4);
  context.globalAlpha = 1;
}

const RAY_DOTS = [6, 9, 12];
const RAY_ALPHA = [0.9, 0.6, 0.32];

/**
 * The span between now and the thumb as accent dots on the track, dense right behind the thumb and thinning toward
 * now. At now the track stays plain.
 */
function drawTrack(surface: CanvasSurface, dots: readonly TrackDot[], ink: SceneInk, thumbAt: number) {
  const { context, width, height } = surface;
  context.clearRect(0, 0, width, height);
  const centre = width / 2;
  const span = thumbAt - centre;
  if (Math.abs(span) < 2) return;
  const sign = Math.sign(span);
  const reach = Math.abs(span);
  const { accent } = ink.geo;
  const grey = ink.trackGrey;
  for (const dot of dots) {
    const along = (dot.x - centre) * sign;
    if (along < 0 || along > reach - 4) continue;
    // 1 right behind the thumb, 0 from TRAIL_HEAD px back
    const head = 1 - clamp((reach - along) / TRAIL_HEAD, 0, 1);
    if (dot.density > 0.22 + 0.62 * head) continue;
    const tint = 0.4 + 0.6 * head;
    context.globalAlpha = 0.35 + 0.55 * head;
    context.fillStyle = rgba(mixRgb(grey, accent, tint));
    context.fillRect(dot.x - TRACK_DOT / 2, dot.y - TRACK_DOT / 2, TRACK_DOT, TRACK_DOT);
  }
  context.globalAlpha = 1;
}
