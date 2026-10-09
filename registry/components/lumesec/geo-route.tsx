"use client";

import * as React from "react";

import { fillSquare, snapCenter, snapSize, useCanvas, type CanvasSurface } from "@/lib/lumesec/canvas";
import { usePalette } from "@/lib/lumesec/color";
import {
  angleDelta,
  boundsOf,
  buildArcLength,
  createDotBatch,
  createProjection,
  createScreenPoint,
  distanceKm,
  easeOutBack,
  fitBoundsToAspect,
  forEachDot,
  GEO_TOKENS,
  geoInk,
  isValidLatLon,
  mapLattice,
  unwrapLongitude,
  wrapLongitude,
  type ArcLengthTable,
  type DotBatch,
  type DotLattice,
  type GeoBounds,
  type GeoInk,
} from "@/lib/lumesec/geo";
import {
  formatDistance,
  formatDuration,
  formatNumber,
  formatSpeed,
  formatUtcOffset,
  formatZonedTime,
  toEpochMs,
  utcOffsetMinutes,
  zonedParts,
} from "@/lib/lumesec/geo-data";
import { clamp, easeOutCubic, hash, lerp, mixRgb, rgba, TAU } from "@/lib/lumesec/math";
import {
  prefersReducedMotion,
  springStep,
  useAnimationLoop,
  useLazyRef,
  useReducedMotion,
  type Spring,
} from "@/lib/lumesec/motion";
import { RollText } from "@/lib/lumesec/roll-text";
import { Sparks, type SparkOptions } from "@/lib/lumesec/sparks";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** One recorded position of a track. */
export interface TrackPoint {
  /** When the position was recorded: epoch ms, an ISO 8601 string (read as UTC when it has no offset) or a Date. */
  readonly time: number | string | Date;
  /** Latitude in degrees, −90 to 90. */
  readonly lat: number;
  /** Longitude in degrees. */
  readonly lon: number;
  /** Speed over ground in km/h. Without it, the speed between two points is their distance over the time between them. */
  readonly speed?: number;
  /**
   * Name of the place, such as a port. A stop that contains a labelled point names it in its chip, and a label on the
   * first or the last point is shown beside it on the map.
   */
  readonly label?: string;
}

/** Unit of the speed readout. Distances follow it: nautical miles with `kn`, km with `km/h`, miles with `mph`. */
export type GeoRouteUnit = "km/h" | "kn" | "mph";

/** Props of `GeoRoute`. Other `div` props go to the root. */
export interface GeoRouteProps extends Omit<React.ComponentProps<"div">, "defaultValue"> {
  /**
   * The recorded track, in any order (it is sorted by time; a repeated time keeps its first point). Points with an
   * invalid time or position are skipped. Without it the component plays an invented 23-day container-ship voyage. An
   * empty array shows an empty map with the controls disabled.
   */
  track?: readonly TrackPoint[];
  /** Playhead time in epoch ms (controlled). The playhead moves there when it changes. Use with `onValueChange`. */
  value?: number;
  /** Playhead time in epoch ms when uncontrolled. Defaults to the start of the track. */
  defaultValue?: number;
  /** Called with the playhead time while playing (about 12 times a second) and on every scrub step. */
  onValueChange?: (value: number) => void;
  /** Whether the track plays (controlled). Use with `onPlayingChange`. */
  playing?: boolean;
  /**
   * Whether the track plays when uncontrolled. Playback begins once the map is first on screen, never with reduced
   * motion (there it waits for Play).
   */
  defaultPlaying?: boolean;
  /** Called by the play button, with false at the end of the track (when `loop` is off) and when autoplay is skipped. */
  onPlayingChange?: (playing: boolean) => void;
  /** Playback speed in seconds of track time per second (controlled). Use with `onSpeedChange`. */
  speed?: number;
  /** Playback speed when uncontrolled: six hours of track time per second. */
  defaultSpeed?: number;
  /** Called when a speed is picked in the speed control. */
  onSpeedChange?: (speed: number) => void;
  /** The speed control's options, in seconds of track time per second. */
  speeds?: readonly number[];
  /** Unit of the speed readout and the distance travelled. */
  unit?: GeoRouteUnit;
  /** Below this speed, in km/h, the track counts as stopped. */
  stopSpeed?: number;
  /** Minutes a stop must last to be marked on the map. */
  minStop?: number;
  /** Starts over from the beginning after a short hold at the end. */
  loop?: boolean;
  /** IANA time zone of the track time readout, such as `Asia/Singapore`. */
  timeZone?: string;
}

/**
 * Replays a recorded track on a dotted map fitted to it. The marker points along its heading and turns on a spring;
 * behind it the travelled path lights up as a wake of dots that cools from glint to accent to a faint line, so the
 * wake is longer the faster the track plays. Stops leave a ring of dots that fills while the track waits there.
 *
 * Play, pause, scrub and pick a speed (one hour, six hours or a day of track time per second). A speed chart of dot
 * columns under the map follows the playhead and scrubs too; hovering it previews that moment with a ghost marker. The
 * track time, speed and distance travelled roll in tabular figures as the marker moves.
 *
 * @example
 * <GeoRoute track={points} unit="km/h" timeZone="Europe/Berlin" onValueChange={(time) => setCursor(time)} />
 */
export function GeoRoute({
  track,
  value,
  defaultValue,
  onValueChange,
  playing: playingProp,
  defaultPlaying = true,
  onPlayingChange,
  speed: speedProp,
  defaultSpeed = DEFAULT_RATE,
  onSpeedChange,
  speeds,
  unit = "kn",
  stopSpeed = 1,
  minStop = 30,
  loop: looping = true,
  timeZone = "UTC",
  className,
  ...props
}: GeoRouteProps) {
  const reducedMotion = useReducedMotion();
  const stopLimit = Number.isFinite(stopSpeed) && stopSpeed >= 0 ? stopSpeed : 1;
  const minStopMinutes = Number.isFinite(minStop) && minStop >= 0 ? minStop : 30;

  const source = track ?? DEMO_TRACK;
  const built = React.useMemo(() => buildModel(source, stopLimit, minStopMinutes), [source, stopLimit, minStopMinutes]);
  // A new array with the same points keeps the model, so the wake and the playhead survive a parent re-render.
  const [stable, setStable] = React.useState(built);
  if (stable.key !== built.key) setStable(built);
  const model = stable.key === built.key ? stable : built;
  const playable = model.samples >= 2;

  const rateOptions = React.useMemo(() => normaliseRates(speeds), [speeds]);
  const [time, setTime] = useControllableState<number>({ value, defaultValue: defaultValue ?? model.start, onChange: onValueChange });
  const [playing, setPlaying] = useControllableState<boolean>({ value: playingProp, defaultValue: defaultPlaying, onChange: onPlayingChange });
  const [rateValue, setRate] = useControllableState<number>({ value: speedProp, defaultValue: defaultSpeed, onChange: onSpeedChange });
  const rate = Number.isFinite(rateValue) && rateValue > 0 ? rateValue : DEFAULT_RATE;
  const shownTime = clampTime(model, time);

  const [hover, setHover] = React.useState<number | null>(null);
  const [activeStop, setActiveStop] = React.useState<string | null>(null);
  // The server markup places the marker and the thumb; the animation loop moves them from there.
  const [initial] = React.useState(() => ({ marker: placementAt(model, shownTime), progress: progressOf(model, shownTime) }));

  const mapRef = React.useRef<HTMLDivElement>(null);
  const baseRef = React.useRef<HTMLCanvasElement>(null);
  const trackRef = React.useRef<HTMLCanvasElement>(null);
  const effectsRef = React.useRef<HTMLCanvasElement>(null);
  const chartRef = React.useRef<HTMLCanvasElement>(null);
  const markerRef = React.useRef<HTMLSpanElement>(null);
  const arrowRef = React.useRef<HTMLSpanElement>(null);
  const railRef = React.useRef<HTMLDivElement>(null);
  const fillRef = React.useRef<HTMLDivElement>(null);
  const thumbRef = React.useRef<HTMLDivElement>(null);
  const liveRef = React.useRef<HTMLDivElement>(null);
  const engineRef = useLazyRef(() => new RouteEngine());
  const latestTime = React.useRef(time);
  const written = React.useRef<WrittenStyles>({ marker: null, arrow: null, left: "", top: "", rotate: "", fill: "", thumb: "" });

  /** Where the effects layer sits relative to the map, in CSS px (offsets ignore the gallery's zoom). */
  function measureEffects() {
    const layer = effectsRef.current;
    if (layer) engineRef.current.setEffectsOffset(-layer.offsetLeft, -layer.offsetTop);
  }

  const loop = useAnimationLoop(mapRef, step);
  const palette = usePalette(mapRef, GEO_TOKENS, applyTheme);
  const base = useCanvas(
    baseRef,
    (surface) => {
      engineRef.current.layout(surface.width, surface.height, surface.dpr);
      measureEffects();
      loop.kick();
    },
    MAP_CANVAS,
  );
  const trackSurface = useCanvas(
    trackRef,
    () => {
      engineRef.current.invalidate();
      loop.kick();
    },
    MAP_CANVAS,
  );
  const effects = useCanvas(
    effectsRef,
    () => {
      measureEffects();
      loop.kick();
    },
    MAP_CANVAS,
  );
  const chart = useCanvas(chartRef, (surface) => {
    engineRef.current.layoutChart(surface.width, surface.height);
    loop.kick();
  });

  function step(_time: number, delta: number) {
    const engine = engineRef.current;
    const active = engine.step(base.current, trackSurface.current, chart.current, effects.current, delta);
    applyDom(engine);
    return active;
  }

  /** Moves the marker, its heading and the scrubber thumb; writes only what changed. */
  function applyDom(engine: RouteEngine) {
    const cache = written.current;
    const marker = markerRef.current;
    // a remounted marker (no points, then points) starts from its server style: write everything again
    if (marker !== cache.marker) {
      cache.marker = marker;
      cache.left = cache.top = "";
    }
    if (marker && engine.markerReady) {
      const left = `${engine.markerX.toFixed(3)}%`;
      const top = `${engine.markerY.toFixed(3)}%`;
      if (left !== cache.left) marker.style.left = cache.left = left;
      if (top !== cache.top) marker.style.top = cache.top = top;
    }
    const arrow = arrowRef.current;
    if (arrow !== cache.arrow) {
      cache.arrow = arrow;
      cache.rotate = "";
    }
    const rotate = `rotate(${engine.heading.position.toFixed(1)}deg)`;
    if (arrow && rotate !== cache.rotate) arrow.style.transform = cache.rotate = rotate;
    const progress = engine.progress();
    const fill = `scaleX(${progress.toFixed(4)})`;
    const thumb = `${(progress * 100).toFixed(3)}%`;
    if (fillRef.current && fill !== cache.fill) fillRef.current.style.transform = cache.fill = fill;
    if (thumbRef.current && thumb !== cache.thumb) thumbRef.current.style.left = cache.thumb = thumb;
  }

  function applyTheme() {
    const colors = palette.current;
    if (!colors) return;
    engineRef.current.setInk(geoInk(colors));
    loop.kick();
  }

  function announce(text: string) {
    if (liveRef.current) liveRef.current.textContent = text;
  }

  React.useLayoutEffect(() => {
    latestTime.current = time;
  });

  // The engine reports back: the playhead (throttled), the end of the track, a skipped autoplay, the arrival.
  React.useEffect(() => {
    const engine = engineRef.current;
    engine.onTime = setTime;
    engine.onFinish = () => {
      setPlaying(false);
      announce("Playback finished at the end of the track.");
    };
    engine.onAutoplayCancel = () => setPlaying(false);
    engine.onArrive = () => {
      const marker = markerRef.current;
      if (!marker || typeof marker.animate !== "function" || prefersReducedMotion()) return;
      marker.animate(ARRIVE_KEYFRAMES, { duration: 560, easing: "cubic-bezier(.2,.9,.3,1)" });
    };
  }, [engineRef, setTime, setPlaying]);

  React.useEffect(() => {
    engineRef.current.setModel(model, latestTime.current);
    loop.kick();
  }, [model, engineRef, loop]);

  // A playhead that changes from outside (or is clamped by a controlled parent) moves the marker there.
  React.useEffect(() => {
    const engine = engineRef.current;
    if (engine.isEcho(time)) return;
    engine.seekExternal(time, clockNow());
    loop.kick();
  }, [time, engineRef, loop]);

  React.useEffect(() => {
    const engine = engineRef.current;
    engine.speed = rate;
    engine.looping = looping;
    loop.kick();
  }, [rate, looping, engineRef, loop]);

  React.useEffect(() => {
    engineRef.current.autoplay = playingProp === undefined && defaultPlaying;
  }, [playingProp, defaultPlaying, engineRef]);

  React.useEffect(() => {
    engineRef.current.setPlaying(playing, clockNow());
    loop.kick();
  }, [playing, model, engineRef, loop]);

  React.useEffect(() => {
    engineRef.current.setHover(hover);
    loop.kick();
  }, [hover, engineRef, loop]);

  // Reduced motion drops the wake's glow and the spring; redraw when it changes.
  React.useEffect(() => {
    engineRef.current.invalidate();
    loop.kick();
  }, [reducedMotion, engineRef, loop]);

  function seekTo(next: number) {
    const engine = engineRef.current;
    const now = clockNow();
    engine.seek(next, now);
    engine.emit(now);
    loop.kick();
  }

  function togglePlayback() {
    if (!playable) return;
    setPlaying((current) => !current);
  }

  function timeAtPointer(element: HTMLElement, clientX: number) {
    const rect = element.getBoundingClientRect();
    const fraction = rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0;
    return model.start + fraction * model.duration;
  }

  function handleRailPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!playable || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    const rail = railRef.current;
    if (!rail) return;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    engineRef.current.setScrubbing(true);
    seekTo(timeAtPointer(rail, event.clientX));
  }

  function handleRailPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const rail = railRef.current;
    if (!rail || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    seekTo(timeAtPointer(rail, event.clientX));
  }

  function handlePointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    const target = event.currentTarget;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    engineRef.current.setScrubbing(false);
    loop.kick();
  }

  function handleScrubKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      togglePlayback();
      return;
    }
    if (!playable) return;
    const current = engineRef.current.time;
    const percent = model.duration / 100;
    const factor = event.shiftKey ? 10 : 1;
    let next: number | null = null;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = current + percent * factor;
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = current - percent * factor;
        break;
      case "PageUp":
        next = current + percent * 10;
        break;
      case "PageDown":
        next = current - percent * 10;
        break;
      case "Home":
        next = model.start;
        break;
      case "End":
        next = model.end;
        break;
    }
    if (next === null) return;
    event.preventDefault();
    seekTo(next);
  }

  function handleChartPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!playable || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    engineRef.current.setScrubbing(true);
    const at = timeAtPointer(event.currentTarget, event.clientX);
    seekTo(at);
    if (event.pointerType !== "touch") setHover(at);
  }

  function handleChartPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!playable) return;
    const at = timeAtPointer(event.currentTarget, event.clientX);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) seekTo(at);
    if (event.pointerType !== "touch") setHover(at);
  }

  function handleChartPointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    handlePointerEnd(event);
    if (event.pointerType === "touch") setHover(null);
  }

  // The readout moves in steps that suit the playback speed, so the figures roll a few times a second, not 60.
  const quantum = playing && playable ? readoutStep(rate) : MINUTE_MS;
  const readTime = playable ? clamp(Math.floor(shownTime / quantum) * quantum, model.start, model.end) : shownTime;
  const readFraction = fractionOf(model, readTime);
  const hasPoints = model.samples > 0;
  const timeText = hasPoints ? trackTimeText(model, readTime, timeZone) : MISSING;
  const speedKmh = hasPoints ? sampleValue(model.speed, readFraction) : Number.NaN;
  const speedText = formatSpeed(speedKmh, unit);
  const travelled = hasPoints ? sampleValue(model.km, readFraction) : Number.NaN;
  const travelledText = distanceText(travelled, unit);
  const exactTimeText = hasPoints ? trackTimeText(model, shownTime, timeZone) : MISSING;
  const exactSpeed = hasPoints ? sampleValue(model.speed, fractionOf(model, shownTime)) : Number.NaN;
  const valueText = hasPoints ? `${exactTimeText}, ${spokenSpeed(exactSpeed, unit)}` : "No track";

  const ghost = hover !== null && playable ? placementAt(model, hover) : null;
  const hoverLeft = hover !== null && playable ? progressOf(model, hover) * 100 : 0;
  const stop = activeStop === null ? null : (model.stops.find((entry) => entry.key === activeStop) ?? null);
  const rangeStart = hasPoints ? formatZonedTime(timeZone, model.start, { date: "short" }) : MISSING;
  const rangeEnd = hasPoints ? formatZonedTime(timeZone, model.end, { date: "short" }) : MISSING;

  return (
    <div
      data-slot="geo-route"
      role="group"
      aria-label="Route playback"
      className={cn(
        "@container grid w-full max-w-[660px] gap-2.5 rounded-[14px] border border-border bg-card p-3 text-card-foreground shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)] [-webkit-tap-highlight-color:transparent]",
        className,
      )}
      {...props}
    >
      <p className="sr-only">{mapSummary(model, unit)}</p>

      <div ref={mapRef} className="relative w-full select-none" style={{ aspectRatio: MAP_ASPECT }}>
        <div className="absolute inset-0 overflow-hidden rounded-[10px] bg-muted/40">
          <canvas ref={baseRef} aria-hidden="true" className="absolute inset-0 block size-full" />
          <canvas ref={trackRef} aria-hidden="true" className="absolute inset-0 block size-full" />
        </div>
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[10px] border border-border/70" />

        {[model.origin, model.destination].map((place, i) =>
          place ? <PlaceLabel key={i === 0 ? "origin" : "destination"} place={place} /> : null,
        )}

        {model.stops.map((entry) => (
          <button
            key={entry.key}
            type="button"
            aria-label={stopLabel(entry, model, timeZone)}
            onClick={() => seekTo(entry.start)}
            onFocus={() => setActiveStop(entry.key)}
            onBlur={() => setActiveStop((current) => (current === entry.key ? null : current))}
            onPointerEnter={() => setActiveStop(entry.key)}
            onPointerLeave={() => setActiveStop((current) => (current === entry.key ? null : current))}
            className="absolute z-[2] -mt-3 -ml-3 size-6 cursor-pointer rounded-full border-0 bg-transparent p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-solid focus-visible:outline-lumesec"
            style={{ left: percent(entry.x), top: percent(entry.y) }}
          />
        ))}

        {ghost ? (
          <span aria-hidden="true" className="pointer-events-none absolute z-[3] size-0 opacity-50" style={{ left: percent(ghost.x), top: percent(ghost.y) }}>
            <span className="absolute -top-[7px] -left-[7px] block size-3.5" style={{ transform: `rotate(${ghost.heading.toFixed(1)}deg)` }}>
              <Chevron />
            </span>
          </span>
        ) : null}

        {hasPoints ? (
          <span
            ref={markerRef}
            aria-hidden="true"
            className="pointer-events-none absolute z-[3] size-0"
            style={{ left: percent(initial.marker.x), top: percent(initial.marker.y) }}
          >
            {playable ? (
              <span
                ref={arrowRef}
                className="absolute -top-[7px] -left-[7px] block size-3.5 will-change-transform"
                style={{ transform: `rotate(${initial.marker.heading.toFixed(1)}deg)` }}
              >
                <Chevron />
              </span>
            ) : (
              <span className="absolute -top-1 -left-1 block size-2 rounded-full bg-lumesec shadow-[0_0_0_1.5px_var(--card)]" />
            )}
          </span>
        ) : (
          <p className="absolute inset-0 m-0 grid place-items-center">
            <span className="rounded-md bg-card/85 px-2 text-[12.5px] leading-5 text-muted-foreground">No track points</span>
          </p>
        )}

        {stop ? <StopChip stop={stop} /> : null}

        <canvas
          ref={effectsRef}
          aria-hidden="true"
          className="pointer-events-none absolute -top-10 -left-4 z-[4] block h-[calc(100%+80px)] w-[calc(100%+32px)] @min-[560px]:-left-10 @min-[560px]:w-[calc(100%+80px)]"
        />
      </div>

      <div className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2.5 @max-[480px]:grid-cols-[32px_minmax(0,1fr)]">
        <button
          type="button"
          aria-label="Play"
          aria-pressed={playing}
          disabled={!playable}
          data-state={playing ? "playing" : "paused"}
          onClick={togglePlayback}
          className="group/play grid size-8 cursor-pointer place-items-center rounded-lg border border-border bg-card p-0 text-foreground outline-none transition-[border-color] duration-200 hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec disabled:cursor-default disabled:opacity-50 disabled:hover:border-border data-[state=playing]:border-[color-mix(in_srgb,var(--lumesec)_45%,var(--border))] motion-reduce:transition-none"
        >
          <svg
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
            className="col-start-1 row-start-1 size-3.5 transition-[opacity,scale] duration-300 ease-[cubic-bezier(.3,1.3,.5,1)] group-data-[state=playing]/play:scale-50 group-data-[state=playing]/play:opacity-0 motion-reduce:transition-none"
          >
            <path d="M5 3.6c0-.6.6-.9 1.1-.6l6.3 4.4c.4.3.4.9 0 1.2l-6.3 4.4c-.5.3-1.1 0-1.1-.6z" />
          </svg>
          <svg
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
            className="col-start-1 row-start-1 size-3.5 scale-50 text-lumesec opacity-0 transition-[opacity,scale] duration-300 ease-[cubic-bezier(.3,1.3,.5,1)] group-data-[state=playing]/play:scale-100 group-data-[state=playing]/play:opacity-100 motion-reduce:transition-none"
          >
            <rect x="4" y="3.25" width="2.6" height="9.5" rx="0.7" />
            <rect x="9.4" y="3.25" width="2.6" height="9.5" rx="0.7" />
          </svg>
        </button>

        <div
          role="slider"
          tabIndex={playable ? 0 : -1}
          aria-label="Track time"
          aria-valuemin={model.start}
          aria-valuemax={model.end}
          aria-valuenow={Math.round(shownTime)}
          aria-valuetext={valueText}
          aria-disabled={!playable || undefined}
          onPointerDown={handleRailPointerDown}
          onPointerMove={handleRailPointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onKeyDown={handleScrubKeyDown}
          className="group/scrub relative h-8 min-w-0 cursor-pointer touch-none outline-none aria-disabled:cursor-default aria-disabled:opacity-50"
        >
          <div ref={railRef} className="absolute inset-x-[7px] top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-muted">
            <div
              ref={fillRef}
              className="absolute inset-0 origin-left rounded-full bg-lumesec"
              style={{ transform: `scaleX(${initial.progress.toFixed(4)})` }}
            />
            {playable
              ? model.stops.map((entry) => (
                  <span
                    key={entry.key}
                    aria-hidden="true"
                    className="absolute top-1/2 h-[7px] min-w-px -translate-y-1/2 rounded-[1px] bg-foreground/30"
                    style={{ left: percent(progressOf(model, entry.start) * 100), width: percent((progressOf(model, entry.end) - progressOf(model, entry.start)) * 100) }}
                  />
                ))
              : null}
            <div
              ref={thumbRef}
              className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-lumesec bg-card shadow-[0_1px_3px_rgb(0_0_0/0.25)] outline-offset-2 group-focus-visible/scrub:outline-2 group-focus-visible/scrub:outline-solid group-focus-visible/scrub:outline-lumesec"
              style={{ left: percent(initial.progress * 100) }}
            />
          </div>
        </div>

        <SpeedControl rates={rateOptions} value={rate} onChange={setRate} className="@max-[480px]:col-span-2" />
      </div>

      <dl className="m-0 flex items-end gap-4 text-[11px] leading-4">
        <Reading label="Track time" text={timeText} order={readTime} animate={!reducedMotion} className="min-w-0 flex-1" />
        <Reading label="Speed" text={speedText} order={speedKmh} animate={!reducedMotion} className="justify-items-end text-right" />
        <Reading label="Travelled" text={travelledText} order={travelled} animate={!reducedMotion} className="justify-items-end text-right" />
      </dl>

      <div className="grid gap-1">
        <div
          aria-hidden="true"
          onPointerDown={handleChartPointerDown}
          onPointerMove={handleChartPointerMove}
          onPointerUp={handleChartPointerEnd}
          onPointerCancel={handleChartPointerEnd}
          onPointerLeave={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) setHover(null);
          }}
          className={cn("relative h-[44px] touch-pan-y select-none", playable && "cursor-ew-resize")}
        >
          <canvas ref={chartRef} aria-hidden="true" className="absolute inset-0 block size-full" />
          {hover !== null && playable ? (
            <span
              className="pointer-events-none absolute bottom-full z-[2] mb-1.5 -translate-x-1/2 rounded-md border border-border bg-popover px-1.5 font-mono text-[11px] leading-[18px] whitespace-nowrap text-popover-foreground tabular-nums shadow-[0_6px_16px_-8px_rgb(0_0_0/0.45)]"
              style={{ left: `clamp(100px, ${hoverLeft.toFixed(3)}%, calc(100% - 100px))` }}
            >
              {trackTimeText(model, hover, timeZone)}
              <span className="text-muted-foreground"> · {formatSpeed(sampleValue(model.speed, fractionOf(model, hover)), unit)}</span>
            </span>
          ) : null}
        </div>
        <div aria-hidden="true" className="flex justify-between font-mono text-[10.5px] leading-[14px] text-muted-foreground tabular-nums">
          <span>{rangeStart}</span>
          <span>{rangeEnd}</span>
        </div>
      </div>

      <div ref={liveRef} aria-live="polite" className="sr-only" />
    </div>
  );
}

/* Parts ------------------------------------------------------------------------------------------------ */

/** The 14 px marker: an accent arrowhead with a card-coloured edge, pointing east before rotation. */
function Chevron() {
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true" className="block size-3.5 overflow-visible">
      <path d="M1.6 2.2 12.8 7 1.6 11.8 4.3 7Z" strokeWidth={1} strokeLinejoin="round" className="fill-lumesec stroke-card" />
    </svg>
  );
}

const LABEL_OFFSETS: Record<LabelSide, string> = {
  right: "translate(9px, -50%)",
  left: "translate(calc(-100% - 9px), -50%)",
  above: "translate(-50%, calc(-100% - 8px))",
  below: "translate(-50%, 8px)",
};

/** The origin or destination name beside its point, away from the track, on a soft card-coloured halo. */
function PlaceLabel({ place }: { place: PlacePoint }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute z-[1] text-[11px] leading-[14px] whitespace-nowrap text-muted-foreground [text-shadow:0_0_2px_var(--card),0_0_4px_var(--card),0_0_6px_var(--card)]"
      style={{ left: percent(place.x), top: percent(place.y), transform: LABEL_OFFSETS[place.side] }}
    >
      {place.label}
    </span>
  );
}

/** The chip of the stop under the pointer or in focus: its place, if known, and how long the track waited there. */
function StopChip({ stop }: { stop: Stop }) {
  const below = stop.y < 22;
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute z-[5] rounded-md border border-border bg-popover px-1.5 text-[11px] leading-[18px] whitespace-nowrap text-popover-foreground shadow-[0_6px_16px_-8px_rgb(0_0_0/0.45)]"
      style={{
        left: `clamp(70px, ${percent(stop.x)}, calc(100% - 70px))`,
        top: percent(stop.y),
        transform: `translate(-50%, ${below ? "16px" : "calc(-100% - 16px)"})`,
      }}
    >
      {stop.label ? <span className="text-foreground">{stop.label} · </span> : null}
      <span className="text-muted-foreground">Stop </span>
      <span className="font-mono tabular-nums">{formatDuration(stop.end - stop.start)}</span>
    </span>
  );
}

interface ReadingProps {
  label: string;
  text: string;
  /** The value behind the text: rising values roll up, falling values roll down. */
  order: number;
  animate: boolean;
  className?: string;
}

/** One readout cell: a small label over figures that roll character by character in the direction of change. */
function Reading({ label, text, order, animate, className }: ReadingProps) {
  return (
    <div className={cn("grid gap-0.5", className)}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 overflow-hidden font-mono text-[13px] leading-5 text-foreground tabular-nums">
        <RollingFigures text={text} order={order} animate={animate} />
        <span className="sr-only">{text}</span>
      </dd>
    </div>
  );
}

function RollingFigures({ text, order, animate }: { text: string; order: number; animate: boolean }) {
  const key = Number.isFinite(order) ? order : 0;
  const [shown, setShown] = React.useState({ text, order: key, direction: 1 });
  if (shown.text !== text) setShown({ text, order: key, direction: key >= shown.order ? 1 : -1 });
  // spaces become no-break spaces: a lone space inside a grid cell would collapse
  const characters = Array.from(text, (character) => (character === " " ? "\u00a0" : character));
  return (
    <span aria-hidden="true" className="inline-flex whitespace-nowrap">
      {characters.map((character, i) => (
        // keyed from the right, so units keep their wheels and only the changing digits roll
        <RollText key={characters.length - i} text={character} direction={shown.direction} animate={animate} />
      ))}
    </span>
  );
}

interface SpeedControlProps {
  rates: readonly number[];
  value: number;
  onChange: (rate: number) => void;
  className?: string;
}

/** Playback speed as a segmented radio group; the selection pill slides with a small overshoot. */
function SpeedControl({ rates, value, onChange, className }: SpeedControlProps) {
  const buttons = React.useRef<(HTMLButtonElement | null)[]>([]);
  const index = rates.indexOf(value);
  const focusIndex = index >= 0 ? index : 0;

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const last = rates.length - 1;
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = focusIndex >= last ? 0 : focusIndex + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = focusIndex <= 0 ? last : focusIndex - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next < 0) return;
    event.preventDefault();
    onChange(rates[next]);
    buttons.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Playback speed"
      onKeyDown={handleKeyDown}
      className={cn("relative grid h-8 auto-cols-fr grid-flow-col rounded-lg bg-muted p-0.5", className)}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 rounded-md bg-card shadow-[0_1px_2px_rgb(0_0_0/0.14),0_0_0_0.5px_rgb(0_0_0/0.06)] transition-[transform,opacity] duration-300 ease-[cubic-bezier(.3,1.3,.5,1)] motion-reduce:transition-none"
        style={{
          width: `calc((100% - 4px) / ${rates.length})`,
          transform: `translateX(${focusIndex * 100}%)`,
          opacity: index >= 0 ? 1 : 0,
        }}
      />
      {rates.map((rate, i) => (
        <button
          key={rate}
          ref={(node) => {
            buttons.current[i] = node;
          }}
          type="button"
          role="radio"
          aria-checked={i === index}
          title={spokenRate(rate)}
          tabIndex={i === focusIndex ? 0 : -1}
          onClick={() => onChange(rate)}
          className="relative z-[1] cursor-pointer rounded-md border-0 bg-transparent px-2.5 font-mono text-[11.5px] leading-7 whitespace-nowrap text-muted-foreground tabular-nums outline-none transition-colors duration-200 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec aria-checked:text-foreground motion-reduce:transition-none"
        >
          {rateLabel(rate)}
        </button>
      ))}
    </div>
  );
}

/* Model ------------------------------------------------------------------------------------------------ */

interface RoutePoint {
  readonly time: number;
  readonly lat: number;
  /** Unwrapped: continuous with the previous point, so a track across the 180th meridian stays in one piece. */
  readonly lon: number;
  readonly speed: number | null;
  readonly label: string | null;
}

type LabelSide = "right" | "left" | "above" | "below";

/** A place name at an end of the track, in % of the map box, on the side facing away from the track. */
interface PlacePoint {
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly side: LabelSide;
}

/** A run of samples below the stop speed that lasts at least `minStop`. */
interface Stop {
  readonly key: string;
  readonly start: number;
  readonly end: number;
  readonly label: string | null;
  /** Position in % of the map box. */
  readonly x: number;
  readonly y: number;
  /** Middle sample index (fractional), for the canvas position. */
  readonly fraction: number;
}

/**
 * The prepared track: the points, and a time-uniform table of SAMPLES rows (position, speed, distance, screen
 * heading) so every lookup during playback is O(1).
 */
interface RouteModel {
  readonly key: string;
  readonly start: number;
  readonly end: number;
  readonly duration: number;
  /** Rows in the uniform table: 0 without points, 1 for a single point, else SAMPLES. */
  readonly samples: number;
  readonly lat: Float64Array;
  /** Unwrapped longitude. */
  readonly lon: Float64Array;
  /** km/h. */
  readonly speed: Float64Array;
  /** Distance travelled since the start, in km. */
  readonly km: Float64Array;
  /** Screen heading in degrees, clockwise from east (CSS rotate). */
  readonly heading: Float64Array;
  /** Position in % of the map box, from the nominal projection. */
  readonly nx: Float32Array;
  readonly ny: Float32Array;
  readonly maxSpeed: number;
  readonly totalKm: number;
  readonly stopSpeed: number;
  readonly stops: readonly Stop[];
  /** The map box: the track's bounds widened to the map's aspect. */
  readonly bounds: GeoBounds;
  /** Degrees added to an unwrapped longitude to get its longitude relative to the central meridian. */
  readonly lambdaOffset: number;
  readonly origin: PlacePoint | null;
  readonly destination: PlacePoint | null;
}

/** The styles the animation loop last wrote, per element, so a frame writes only what changed. */
interface WrittenStyles {
  marker: HTMLSpanElement | null;
  arrow: HTMLSpanElement | null;
  left: string;
  top: string;
  rotate: string;
  fill: string;
  thumb: string;
}

interface Placement {
  /** % of the map box. */
  x: number;
  y: number;
  heading: number;
}

/** Sorts and cleans the track, samples it uniformly in time, finds the stops and fits the map. */
function buildModel(track: readonly TrackPoint[], stopSpeed: number, minStop: number): RouteModel {
  const parsed: { time: number; lat: number; lon: number; speed: number | null; label: string | null }[] = [];
  for (const point of track) {
    const time = toEpochMs(point.time);
    if (time === null || !isValidLatLon(point)) continue;
    const speed = typeof point.speed === "number" && Number.isFinite(point.speed) && point.speed >= 0 ? point.speed : null;
    const label = typeof point.label === "string" && point.label.trim() !== "" ? point.label.trim() : null;
    parsed.push({ time, lat: point.lat, lon: wrapLongitude(point.lon), speed, label });
  }
  // a stable sort, so a repeated time keeps the point that came first
  parsed.sort((a, b) => a.time - b.time);
  const points: RoutePoint[] = [];
  for (const point of parsed) {
    const previous = points[points.length - 1];
    if (previous && previous.time === point.time) continue;
    points.push({ ...point, lon: previous ? unwrapLongitude(previous.lon, point.lon) : point.lon });
  }

  const bounds = fitBoundsToAspect(boundsOf(points, BOUNDS_MARGIN, BOUNDS_MIN_SPAN), MAP_ASPECT, "equirectangular");
  const nominal = createProjection("equirectangular", {
    width: NOMINAL_WIDTH,
    height: NOMINAL_HEIGHT,
    lonRange: [bounds.west, bounds.east],
    latRange: [bounds.south, bounds.north],
  });
  const lambdaOffset = points.length > 0 ? wrapLongitude(points[0].lon - nominal.centerLon) - points[0].lon : 0;

  const table = sampleTrack(points);
  const count = table.lat.length;
  const nx = new Float32Array(count);
  const ny = new Float32Array(count);
  const screen = createScreenPoint();
  for (let k = 0; k < count; k++) {
    nominal.projectRelative(table.lat[k], table.lon[k] + lambdaOffset, screen);
    nx[k] = (screen.x / NOMINAL_WIDTH) * 100;
    ny[k] = (screen.y / NOMINAL_HEIGHT) * 100;
  }

  let maxSpeed = 0;
  for (let k = 0; k < count; k++) if (Number.isFinite(table.speed[k])) maxSpeed = Math.max(maxSpeed, table.speed[k]);

  const start = points[0]?.time ?? 0;
  const end = points[points.length - 1]?.time ?? 0;
  const stops = count >= 2 ? findStops(points, table.speed, start, end, stopSpeed, minStop, nx, ny) : [];

  // the origin's name goes against the direction of departure, the destination's along the direction of arrival
  const first = points[0];
  const last = points[points.length - 1];
  const origin: PlacePoint | null = first?.label
    ? { label: first.label, x: nx[0], y: ny[0], side: labelSide(nx[0], ny[0], count > 1 ? table.heading[0] + 180 : 0) }
    : null;
  const destination: PlacePoint | null =
    last?.label && points.length > 1
      ? { label: last.label, x: nx[count - 1], y: ny[count - 1], side: labelSide(nx[count - 1], ny[count - 1], table.heading[count - 1]) }
      : null;

  const key = `${points.map((point) => `${point.time},${point.lat},${point.lon},${point.speed ?? ""},${point.label ?? ""}`).join("|")}#${stopSpeed}#${minStop}`;
  return {
    key,
    start,
    end,
    duration: end - start,
    samples: count,
    lat: table.lat,
    lon: table.lon,
    speed: table.speed,
    km: table.km,
    heading: table.heading,
    nx,
    ny,
    maxSpeed,
    totalKm: count > 0 ? table.km[count - 1] : 0,
    stopSpeed,
    stops,
    bounds,
    lambdaOffset,
    origin,
    destination,
  };
}

/**
 * The time-uniform table. Positions interpolate linearly between points (a straight line on the equirectangular map);
 * speeds interpolate between given speeds, else they are the segment's distance over its time. Each row carries the
 * heading of its segment on screen; segments that do not move keep the heading before them.
 */
function sampleTrack(points: readonly RoutePoint[]) {
  const n = points.length;
  if (n === 0) {
    const empty = new Float64Array(0);
    return { lat: empty, lon: empty, speed: empty, km: empty, heading: empty };
  }
  if (n === 1) {
    const point = points[0];
    return {
      lat: Float64Array.of(point.lat),
      lon: Float64Array.of(point.lon),
      speed: Float64Array.of(point.speed ?? Number.NaN),
      km: Float64Array.of(0),
      heading: Float64Array.of(0),
    };
  }

  const segmentKm = new Float64Array(n - 1);
  const segmentHeading = new Float64Array(n - 1).fill(Number.NaN);
  const cumulative = new Float64Array(n);
  for (let i = 0; i < n - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    segmentKm[i] = distanceKm(a, b);
    cumulative[i + 1] = cumulative[i] + segmentKm[i];
    if (segmentKm[i] > STILL_KM) segmentHeading[i] = (Math.atan2(-(b.lat - a.lat), b.lon - a.lon) * 180) / Math.PI;
  }
  // still segments keep the heading they arrived with; leading still segments take the first real one
  let carried = Number.NaN;
  for (let i = 0; i < n - 1; i++) {
    if (Number.isNaN(segmentHeading[i])) segmentHeading[i] = carried;
    else carried = segmentHeading[i];
  }
  const firstHeading = segmentHeading.find((heading) => !Number.isNaN(heading)) ?? 0;
  for (let i = 0; i < n - 1 && Number.isNaN(segmentHeading[i]); i++) segmentHeading[i] = firstHeading;

  const lat = new Float64Array(SAMPLES);
  const lon = new Float64Array(SAMPLES);
  const speed = new Float64Array(SAMPLES);
  const km = new Float64Array(SAMPLES);
  const heading = new Float64Array(SAMPLES);
  const start = points[0].time;
  const span = points[n - 1].time - start;
  let segment = 0;
  for (let k = 0; k < SAMPLES; k++) {
    const t = start + (span * k) / (SAMPLES - 1);
    while (segment < n - 2 && t > points[segment + 1].time) segment++;
    const a = points[segment];
    const b = points[segment + 1];
    const length = b.time - a.time;
    const f = length > 0 ? clamp((t - a.time) / length, 0, 1) : 0;
    lat[k] = lerp(a.lat, b.lat, f);
    lon[k] = lerp(a.lon, b.lon, f);
    km[k] = cumulative[segment] + segmentKm[segment] * f;
    speed[k] = a.speed !== null && b.speed !== null ? lerp(a.speed, b.speed, f) : segmentKm[segment] / Math.max(1e-9, length / HOUR_MS);
    heading[k] = segmentHeading[segment];
  }
  return { lat, lon, speed, km, heading };
}

/** Runs of samples below `stopSpeed` lasting at least `minStop` minutes, named by a labelled point inside them. */
function findStops(
  points: readonly RoutePoint[],
  speed: Float64Array,
  start: number,
  end: number,
  stopSpeed: number,
  minStop: number,
  nx: Float32Array,
  ny: Float32Array,
): Stop[] {
  const count = speed.length;
  const step = (end - start) / (count - 1);
  const stops: Stop[] = [];
  let runStart = -1;
  for (let k = 0; k <= count; k++) {
    const below = k < count && speed[k] < stopSpeed;
    if (below && runStart < 0) runStart = k;
    if (below || runStart < 0) continue;
    const first = runStart;
    const last = k - 1;
    runStart = -1;
    const stopStart = start + first * step;
    const stopEnd = start + last * step;
    if (stopEnd - stopStart < minStop * MINUTE_MS || stopEnd <= stopStart) continue;
    const fraction = (first + last) / 2;
    const named = points.find((point) => point.label !== null && point.time >= stopStart - step && point.time <= stopEnd + step);
    stops.push({
      key: `${Math.round(stopStart)}`,
      start: stopStart,
      end: stopEnd,
      label: named?.label ?? null,
      x: sampleValue(nx, fraction),
      y: sampleValue(ny, fraction),
      fraction,
    });
  }
  return stops;
}

/**
 * The side of a point a label takes when it should face `angle` (screen degrees, clockwise from east): the dominant
 * direction first, then the other axis, skipping sides that would run past the map's edge.
 */
function labelSide(x: number, y: number, angle: number): LabelSide {
  const radians = (angle * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  const horizontal: LabelSide = dx >= 0 ? "right" : "left";
  const vertical: LabelSide = dy >= 0 ? "below" : "above";
  const order = Math.abs(dx) >= Math.abs(dy) ? [horizontal, vertical] : [vertical, horizontal];
  const fits = (side: LabelSide) => (side === "right" ? x < 78 : side === "left" ? x > 22 : side === "below" ? y < 88 : y > 12);
  return order.find(fits) ?? (x > 50 ? "left" : "right");
}

const clampTime = (model: RouteModel, time: number) => (Number.isFinite(time) ? clamp(time, model.start, model.end) : model.start);

/** Fractional row of the uniform table at `time`. */
function fractionOf(model: RouteModel, time: number) {
  if (model.samples < 2 || !(model.duration > 0)) return 0;
  return clamp((time - model.start) / model.duration, 0, 1) * (model.samples - 1);
}

function progressOf(model: RouteModel, time: number) {
  return model.samples >= 2 && model.duration > 0 ? clamp((time - model.start) / model.duration, 0, 1) : 0;
}

/** Linear interpolation in a table at a fractional row. */
function sampleValue(table: ArrayLike<number>, fraction: number) {
  const count = table.length;
  if (count === 0) return Number.NaN;
  if (count === 1) return table[0];
  const i = clamp(Math.floor(fraction), 0, count - 2);
  return table[i] + (table[i + 1] - table[i]) * clamp(fraction - i, 0, 1);
}

function headingAt(model: RouteModel, time: number) {
  const table = model.heading;
  if (table.length < 2) return table[0] ?? 0;
  const fraction = fractionOf(model, time);
  const i = clamp(Math.floor(fraction), 0, table.length - 2);
  return table[i] + angleDelta(table[i], table[i + 1]) * clamp(fraction - i, 0, 1);
}

/** Marker position in % of the map box and its heading, from the nominal projection (safe during render). */
function placementAt(model: RouteModel, time: number): Placement {
  const fraction = fractionOf(model, time);
  return {
    x: model.samples > 0 ? sampleValue(model.nx, fraction) : 50,
    y: model.samples > 0 ? sampleValue(model.ny, fraction) : 50,
    heading: headingAt(model, time),
  };
}

/* Text ------------------------------------------------------------------------------------------------- */

/** 'Day 6, 14:20 UTC': the day counted from the track's first calendar day in the zone, the wall time and offset. */
function trackTimeText(model: RouteModel, time: number, timeZone: string) {
  const parts = zonedParts(timeZone, time);
  const first = zonedParts(timeZone, model.start);
  const day = Math.round((Date.UTC(parts.year, parts.month - 1, parts.day) - Date.UTC(first.year, first.month - 1, first.day)) / DAY_MS) + 1;
  return `Day ${day}, ${pad2(parts.hour)}:${pad2(parts.minute)} ${formatUtcOffset(utcOffsetMinutes(timeZone, time))}`;
}

const pad2 = (value: number) => String(value).padStart(2, "0");

/** A CSS percentage rounded to 3 decimals, so the server and the browser write the same style. */
const percent = (value: number) => `${(Number.isFinite(value) ? value : 0).toFixed(3)}%`;

/** Distance in the unit that goes with the speed unit: '4,210 nm', '7,800 km', '4,850 mi'. */
function distanceText(km: number, unit: GeoRouteUnit) {
  if (unit !== "kn") return formatDistance(km, unit === "mph" ? "mi" : "km");
  if (!Number.isFinite(km)) return MISSING;
  const miles = km / KM_PER_NM;
  return `${formatNumber(miles, { fractionDigits: Math.abs(miles) < 10 ? 1 : 0 })} nm`;
}

function spokenSpeed(kmh: number, unit: GeoRouteUnit) {
  if (!Number.isFinite(kmh)) return "speed unknown";
  const value = unit === "kn" ? kmh / KM_PER_NM : unit === "mph" ? kmh / KM_PER_MILE : kmh;
  const words = unit === "kn" ? "knots" : unit === "mph" ? "miles per hour" : "kilometres per hour";
  return `${formatNumber(value)} ${words}`;
}

/** '40 minutes', '6 hours 20 minutes', '1 day 2 hours', for screen readers. */
function spokenDuration(ms: number) {
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const minutes = Math.round(Math.max(0, ms) / MINUTE_MS);
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${plural(hours, "hour")} ${plural(minutes % 60, "minute")}` : plural(hours, "hour");
  const totalHours = Math.round(minutes / 60);
  const days = Math.floor(totalHours / 24);
  return totalHours % 24 ? `${plural(days, "day")} ${plural(totalHours % 24, "hour")}` : plural(days, "day");
}

function stopLabel(stop: Stop, model: RouteModel, timeZone: string) {
  const place = stop.label ? ` at ${stop.label}` : "";
  return `Stop${place}, ${spokenDuration(stop.end - stop.start)}, from ${trackTimeText(model, stop.start, timeZone)}. Moves the playhead to the arrival.`;
}

function mapSummary(model: RouteModel, unit: GeoRouteUnit) {
  if (model.samples === 0) return "Route map: no track points.";
  if (model.samples === 1) return `Route map with a single track point${model.origin ? ` at ${model.origin.label}` : ""}.`;
  const route = model.origin && model.destination ? ` from ${model.origin.label} to ${model.destination.label}` : "";
  const stops = model.stops.length === 1 ? "1 stop" : `${model.stops.length} stops`;
  return `Route map of a track${route}: ${distanceText(model.totalKm, unit)} in ${spokenDuration(model.duration)}, with ${stops}.`;
}

/** '1 h/s', '6 h/s', '1 d/s', '30 min/s'. */
function rateLabel(rate: number) {
  if (rate % 86_400 === 0) return `${rate / 86_400} d/s`;
  if (rate % 3_600 === 0) return `${rate / 3_600} h/s`;
  if (rate % 60 === 0) return `${rate / 60} min/s`;
  return `${formatNumber(rate)} s/s`;
}

function spokenRate(rate: number) {
  const plural = (count: number, word: string) => `${formatNumber(count)} ${word}${count === 1 ? "" : "s"}`;
  const amount =
    rate % 86_400 === 0
      ? plural(rate / 86_400, "day")
      : rate % 3_600 === 0
        ? plural(rate / 3_600, "hour")
        : rate % 60 === 0
          ? plural(rate / 60, "minute")
          : plural(rate, "second");
  return `${amount} of track time per second`;
}

/** Finite positive options without repeats, in the given order; the default three when nothing usable is left. */
function normaliseRates(rates: readonly number[] | undefined): readonly number[] {
  const usable = (rates ?? []).filter((rate, i, list) => Number.isFinite(rate) && rate > 0 && list.indexOf(rate) === i);
  return usable.length > 0 ? usable : DEFAULT_RATES;
}

/** The readout's time step while playing: the smallest of these that is at least a quarter second of playback. */
function readoutStep(rate: number) {
  const wanted = rate * 250;
  for (const minutes of READOUT_STEPS) if (minutes * MINUTE_MS >= wanted) return minutes * MINUTE_MS;
  return READOUT_STEPS[READOUT_STEPS.length - 1] * MINUTE_MS;
}

/* Demo voyage ------------------------------------------------------------------------------------------ */

interface VoyageStop {
  readonly lat: number;
  readonly lon: number;
  /** Speed on the way here, in knots. */
  readonly kn: number;
  readonly label?: string;
  /** Hours spent here before sailing on. */
  readonly hours?: number;
}

/**
 * Invented container-ship voyage from Rotterdam to Singapore via Suez, starting 2 September 2026 06:00 UTC, with port
 * stops at Algeciras, Port Said (waiting for the canal convoy), Jeddah and Colombo. Waypoints follow open water.
 */
const VOYAGE: readonly VoyageStop[] = [
  { lat: 51.95, lon: 4.05, kn: 0, label: "Rotterdam" },
  { lat: 51.55, lon: 2.6, kn: 13 },
  { lat: 50.95, lon: 1.45, kn: 15 },
  { lat: 50.3, lon: -1.0, kn: 18.5 },
  { lat: 49.7, lon: -4.5, kn: 18.5 },
  { lat: 48.6, lon: -6.0, kn: 18.5 },
  { lat: 44.5, lon: -9.5, kn: 19 },
  { lat: 40.5, lon: -9.9, kn: 19 },
  { lat: 37.0, lon: -9.4, kn: 18.5 },
  { lat: 36.1, lon: -6.6, kn: 15 },
  { lat: 36.13, lon: -5.43, kn: 9, label: "Algeciras", hours: 14 },
  { lat: 36.0, lon: -4.6, kn: 12 },
  { lat: 36.6, lon: -1.0, kn: 18.5 },
  { lat: 37.4, lon: 3.5, kn: 19 },
  { lat: 37.6, lon: 9.5, kn: 19 },
  { lat: 37.3, lon: 11.3, kn: 17 },
  { lat: 35.8, lon: 14.8, kn: 18.5 },
  { lat: 34.3, lon: 21.0, kn: 19 },
  { lat: 33.4, lon: 26.0, kn: 19 },
  { lat: 32.0, lon: 30.5, kn: 17 },
  { lat: 31.35, lon: 32.3, kn: 9, label: "Port Said", hours: 12 },
  { lat: 30.6, lon: 32.33, kn: 7.5 },
  { lat: 29.95, lon: 32.56, kn: 7.5 },
  { lat: 28.6, lon: 33.2, kn: 13 },
  { lat: 27.6, lon: 34.0, kn: 17 },
  { lat: 24.5, lon: 36.0, kn: 18.5 },
  { lat: 21.48, lon: 39.1, kn: 10, label: "Jeddah", hours: 18 },
  { lat: 19.5, lon: 39.8, kn: 15 },
  { lat: 15.5, lon: 41.6, kn: 18.5 },
  { lat: 12.6, lon: 43.35, kn: 16 },
  { lat: 12.2, lon: 45.5, kn: 18.5 },
  { lat: 12.6, lon: 51.0, kn: 19 },
  { lat: 11.0, lon: 57.0, kn: 19 },
  { lat: 8.5, lon: 66.0, kn: 19 },
  { lat: 7.2, lon: 74.5, kn: 18.5 },
  { lat: 6.6, lon: 78.8, kn: 16 },
  { lat: 6.95, lon: 79.82, kn: 8, label: "Colombo", hours: 12 },
  { lat: 5.7, lon: 80.6, kn: 14 },
  { lat: 6.0, lon: 86.0, kn: 19 },
  { lat: 6.2, lon: 92.0, kn: 19 },
  { lat: 6.3, lon: 95.0, kn: 18.5 },
  { lat: 5.4, lon: 98.2, kn: 17 },
  { lat: 3.6, lon: 99.8, kn: 16.5 },
  { lat: 2.4, lon: 101.4, kn: 16 },
  { lat: 1.4, lon: 103.0, kn: 14 },
  { lat: 1.17, lon: 103.6, kn: 11 },
  { lat: 1.25, lon: 103.84, kn: 7, label: "Singapore" },
];

const VOYAGE_START = Date.UTC(2026, 8, 2, 6, 0);
/** A position report every four hours at most, with a small deterministic wobble in the reported speed. */
const DEMO_STEP_HOURS = 4;

function createDemoVoyage(): TrackPoint[] {
  const first = VOYAGE[0];
  const points: TrackPoint[] = [{ time: VOYAGE_START, lat: first.lat, lon: first.lon, speed: 0, label: first.label }];
  let time = VOYAGE_START;
  let report = 0;
  for (let i = 1; i < VOYAGE.length; i++) {
    const from = VOYAGE[i - 1];
    const to = VOYAGE[i];
    const kmh = to.kn * KM_PER_NM;
    const hours = distanceKm(from, to) / kmh;
    const steps = Math.max(1, Math.ceil(hours / DEMO_STEP_HOURS));
    const arrives = to.hours !== undefined || i === VOYAGE.length - 1;
    for (let s = 1; s <= steps; s++) {
      report++;
      time += (hours / steps) * HOUR_MS;
      const k = s / steps;
      const docked = arrives && s === steps;
      points.push({
        time: Math.round(time),
        lat: lerp(from.lat, to.lat, k),
        lon: lerp(from.lon, to.lon, k),
        speed: docked ? 0 : Math.round(kmh * (1 + 0.035 * Math.sin(report * 1.9)) * 10) / 10,
        label: s === steps ? to.label : undefined,
      });
    }
    if (to.hours !== undefined) {
      time += to.hours * HOUR_MS;
      points.push({ time: Math.round(time), lat: to.lat, lon: to.lon, speed: 0, label: to.label });
    }
  }
  return points;
}

/* Constants -------------------------------------------------------------------------------------------- */

const MISSING = "–";
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const KM_PER_NM = 1.852;
const KM_PER_MILE = 1.609344;
/** Segments shorter than this, in km, are standing still: they keep the previous heading. */
const STILL_KM = 0.02;

const DEFAULT_RATE = 21_600;
const DEFAULT_RATES: readonly number[] = [3_600, 21_600, 86_400];
const READOUT_STEPS = [1, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440] as const;

const SAMPLES = 2000;
const MAP_ASPECT = 2;
const NOMINAL_WIDTH = 1000;
const NOMINAL_HEIGHT = NOMINAL_WIDTH / MAP_ASPECT;
const MAP_CANVAS = { maxDpr: 2 } as const;
/** boundsOf margin and minimum span: the track keeps clear of the edges, and a short track still shows its region. */
const BOUNDS_MARGIN = 0.12;
const BOUNDS_MIN_SPAN = 60;

/** Land lattice: honeycomb, 4 px. */
const PITCH = 4;
const LAND_SIZE = 1.5;
const LAND_ALPHA = 0.85;
/** First view: the land prints outward from the start of the track; the chart columns rise left to right. */
const REVEAL_MS = 1100;
const REVEAL_BAND = 0.06;
const REVEAL_END = 1 + REVEAL_BAND * 1.5;
const CHART_REVEAL_DELAY = 150;
const CHART_REVEAL_MS = 900;

/** The wake: dots every 4 px, cooling over 3 s to a faint line; a short tail glows at the head even at rest. */
const WAKE_SPACING = 4;
const WAKE_FADE_MS = 3000;
const WAKE_FLOOR = 0.15;
const WAKE_MIN_SIZE = 1.4;
const WAKE_MAX_SIZE = 2;
const TAIL_GLOW = 0.6;
const TAIL_PX = 36;
const HINT_SIZE = 1.4;
const HINT_ALPHA = 0.3;
const HALO_RADIUS = 14;
/** Scrubbing lights the last 140 px behind the playhead as if just passed, older the farther back. */
const SCRUB_REACH_PX = 140;
const SCRUB_MS_PER_PX = 25;
/** The wake keeps animating while it cools; after this the loop may stop. */
const SETTLE_MS = 12_000;
const RESTART_FADE_MS = 300;
/** The marker waits this long at the destination before a loop starts over. */
const LOOP_HOLD_MS = 700;
const EMIT_MS = 80;

/** The marker turns on a spring through the shortest angle. */
const HEADING_STIFFNESS = 300;
const HEADING_DAMPING = 0.8;

/** Stop rings: 18 dots on a 9 px radius, clear of the 14 px marker; they pop with an overshoot when completed. */
const STOP_RADIUS = 9;
const STOP_DOTS = 18;
const STOP_HINT_ALPHA = 0.35;
const POP_MS = 460;

/** Speed chart: dot columns every 3 px, bottom-aligned. */
const CHART_PITCH = 3;
const CHART_DOT = 1.6;

const STOP_SPARKS: SparkOptions = { speed: [40, 150], life: [0.3, 0.65], size: [1.5, 2], drag: 3.5, jitter: 3 };
const ARRIVAL_SPARKS: SparkOptions = { speed: [70, 280], life: [0.45, 1], size: [1.5, 2.5], drag: 3, jitter: 3 };

const ARRIVE_KEYFRAMES: Keyframe[] = [{ scale: "1" }, { scale: "1.6", offset: 0.35 }, { scale: "1" }];

/** Built after the constants it uses. */
const DEMO_TRACK: readonly TrackPoint[] = createDemoVoyage();

/* Engine ----------------------------------------------------------------------------------------------- */

interface Box {
  width: number;
  height: number;
  dpr: number;
}

type RevealPhase = "waiting" | "running" | "done";

/**
 * Everything the canvases draw, outside React: the playhead clock, the land lattice (baked; printed on first view),
 * the track layer (hint, wake, stop rings, endpoints, glow), the speed chart and the sparks on the layer that reaches
 * past the map. Wake pass times are stored per table row, so they survive a resize.
 */
class RouteEngine {
  onTime: (time: number) => void = () => undefined;
  onFinish: () => void = () => undefined;
  onAutoplayCancel: () => void = () => undefined;
  onArrive: () => void = () => undefined;

  /** The playhead in epoch ms. */
  time = 0;
  /** Track seconds per second. */
  speed = DEFAULT_RATE;
  looping = true;
  /** Whether `playing` came from `defaultPlaying`: the first frame cancels it with reduced motion. */
  autoplay = false;
  /** The last time reported through onTime. */
  lastEmitted = Number.NaN;
  /** Marker position in % of the map box, valid once `markerReady`. */
  markerX = 0;
  markerY = 0;
  markerReady = false;
  readonly heading: Spring = { position: 0, velocity: 0 };

  private model: RouteModel | null = null;
  private playing = false;
  private scrubbing = false;
  private finished = false;
  private hover: number | null = null;
  private firstFrame = true;
  private pendingEmit = false;
  private snapHeading = true;
  private lastEmitAt = -Infinity;
  /** The last few reported times, for isEcho. */
  private recent: number[] = [];
  private holdUntil = -Infinity;
  private ink: GeoInk | null = null;
  private landColor = "";
  private trackBatch: DotBatch | null = null;
  private chartBatch: DotBatch | null = null;
  private revealBatch: DotBatch | null = null;
  private box: Box | null = null;
  private chartBox: { width: number; height: number } | null = null;
  private lattice: DotLattice | null = null;
  private sx = new Float32Array(0);
  private sy = new Float32Array(0);
  private path: ArcLengthTable | null = null;
  private dotX = new Float32Array(0);
  private dotY = new Float32Array(0);
  /** Table row at or before each wake dot. */
  private dotSample = new Int32Array(0);
  /** clockNow() when the playhead passed each table row, or −Infinity. */
  private passAt = new Float64Array(0);
  private fadePass: Float64Array | null = null;
  private fadeHead = 0;
  private fadeStart = -Infinity;
  private lastPassAt = -Infinity;
  private stopX = new Float32Array(0);
  private stopY = new Float32Array(0);
  private stopPop = new Float64Array(0);
  private chartDots = new Uint8Array(0);
  private chartX0 = 0;
  private reveal: RevealPhase = "waiting";
  private revealStart = 0;
  private threshold = new Float32Array(0);
  private baseDirty = true;
  private trackDirty = true;
  private chartDirty = true;
  private effectsDirty = false;
  private effectsX = 0;
  private effectsY = 0;
  private readonly sparks = new Sparks();
  private readonly point = createScreenPoint();

  setInk(ink: GeoInk) {
    this.ink = ink;
    this.landColor = rgba(ink.land);
    // on light cards the glint is nearly white: stop halfway to it so the head stays visible
    const hot = ink.dark ? ink.glint : mixRgb(ink.accent, ink.glint, 0.5);
    const trackRamp = [ink.landStrong, ink.accent, hot];
    const chartRamp = [ink.land, ink.accent, hot];
    const revealRamp = [ink.land, ink.accent];
    if (this.trackBatch) this.trackBatch.setRamp(trackRamp);
    else this.trackBatch = createDotBatch(1024, trackRamp, { tones: 24, levels: 16 });
    if (this.chartBatch) this.chartBatch.setRamp(chartRamp);
    else this.chartBatch = createDotBatch(2048, chartRamp, { tones: 24, levels: 16 });
    if (this.revealBatch) this.revealBatch.setRamp(revealRamp);
    else this.revealBatch = createDotBatch(4096, revealRamp, { tones: 16, levels: 16 });
    this.baseDirty = true;
    this.trackDirty = true;
    this.chartDirty = true;
  }

  /** New data. The first model takes the component's playhead; later ones keep it when it lies inside the new track. */
  setModel(model: RouteModel, preferred: number) {
    if (this.model === model) return;
    const first = this.model === null;
    this.model = model;
    this.passAt = new Float64Array(model.samples).fill(-Infinity);
    this.fadePass = null;
    this.stopPop = new Float64Array(model.stops.length).fill(-Infinity);
    this.finished = false;
    this.holdUntil = -Infinity;
    if (first) {
      this.time = clampTime(model, preferred);
      this.lastEmitted = preferred;
    } else {
      const inside = this.time >= model.start && this.time <= model.end;
      this.time = inside ? this.time : model.start;
    }
    if (!Object.is(this.time, this.lastEmitted)) this.pendingEmit = true;
    this.snapHeading = true;
    this.layoutGeometry();
    this.buildChart();
    if (this.reveal === "running") this.prepareReveal();
    this.baseDirty = true;
    this.trackDirty = true;
    this.chartDirty = true;
  }

  layout(width: number, height: number, dpr: number) {
    this.box = { width, height, dpr };
    this.layoutGeometry();
    if (this.reveal === "running") this.prepareReveal();
    this.baseDirty = true;
    this.trackDirty = true;
  }

  layoutChart(width: number, height: number) {
    this.chartBox = { width, height };
    this.buildChart();
    this.chartDirty = true;
  }

  /** A canvas was cleared (resized) or the motion preference changed: draw again on the next frame. */
  invalidate() {
    this.trackDirty = true;
    this.chartDirty = true;
  }

  /** Position of the map's top-left corner on the effects layer. */
  setEffectsOffset(x: number, y: number) {
    this.effectsX = x;
    this.effectsY = y;
  }

  /** Play or pause. Playing from the end of the track starts over. */
  setPlaying(playing: boolean, now: number) {
    this.playing = playing;
    const model = this.model;
    if (!playing || !model || model.samples < 2) return;
    if (this.time >= model.end) {
      this.holdUntil = -Infinity;
      this.restart(now);
    }
    this.finished = false;
  }

  setScrubbing(scrubbing: boolean) {
    this.scrubbing = scrubbing;
  }

  setHover(time: number | null) {
    if (time === this.hover) return;
    this.hover = time;
    this.chartDirty = true;
  }

  /** Fraction of the track behind the playhead. */
  progress() {
    const model = this.model;
    return model ? progressOf(model, this.time) : 0;
  }

  /**
   * Moves the playhead. Wake rows beyond it are cleared; the last 140 px behind it are lit as if just passed, so the
   * wake stays bright where the scrub lands.
   */
  seek(time: number, now: number) {
    const model = this.model;
    if (!model || model.samples < 2) return;
    this.time = clampTime(model, time);
    this.finished = false;
    this.holdUntil = -Infinity;
    const index = Math.floor(fractionOf(model, this.time));
    this.passAt.fill(-Infinity, index + 1);
    const path = this.path;
    if (path) {
      const head = this.headDistance();
      for (let i = index; i >= 0; i--) {
        const behind = head - path.distances[i];
        if (behind > SCRUB_REACH_PX) break;
        this.passAt[i] = Math.max(this.passAt[i], now - behind * SCRUB_MS_PER_PX);
      }
    }
    this.lastPassAt = now;
    this.trackDirty = true;
    this.chartDirty = true;
  }

  /** A playhead set from outside: like a scrub, but the marker faces its new heading at once. */
  seekExternal(time: number, now: number) {
    this.seek(time, now);
    this.lastEmitted = time;
    if (this.model && !Object.is(this.time, time)) this.pendingEmit = true;
    this.snapHeading = true;
  }

  /** Reports the playhead through onTime when it changed since the last report. */
  emit(now: number) {
    this.pendingEmit = false;
    if (Object.is(this.time, this.lastEmitted)) return;
    this.lastEmitted = this.time;
    this.lastEmitAt = now;
    this.recent.push(this.time);
    if (this.recent.length > 4) this.recent.shift();
    this.onTime(this.time);
  }

  /**
   * Whether a playhead coming back from React is one this engine reported itself. Reports come every 80 ms, so a slow
   * commit may hand back an older one; that must not pull the playhead back.
   */
  isEcho(time: number) {
    return Object.is(time, this.lastEmitted) || this.recent.includes(time);
  }

  /** One frame: the reveal, the clock, the heading spring, then the track, the chart and the sparks. */
  step(base: CanvasSurface | null, track: CanvasSurface | null, chart: CanvasSurface | null, effects: CanvasSurface | null, delta: number) {
    const model = this.model;
    if (!model || !this.ink) return false;
    const now = clockNow();
    const reduced = prefersReducedMotion();
    let active = false;

    if (this.firstFrame) {
      this.firstFrame = false;
      if (reduced && this.autoplay && this.playing) {
        this.playing = false;
        this.onAutoplayCancel();
      }
    }

    // The land prints itself once, outward from the start of the track, the first time the map is on screen.
    if (this.reveal === "waiting" && this.lattice) {
      if (reduced) this.reveal = "done";
      else {
        this.reveal = "running";
        this.revealStart = now;
        this.prepareReveal();
      }
    }
    let chartFront = this.reveal === "done" ? REVEAL_END : 0;
    if (this.reveal === "running") {
      const t = (now - this.revealStart) / REVEAL_MS;
      chartFront = easeOutCubic((now - this.revealStart - CHART_REVEAL_DELAY) / CHART_REVEAL_MS) * REVEAL_END;
      if (t >= 1 || reduced) {
        this.reveal = "done";
        this.baseDirty = true;
        chartFront = REVEAL_END;
      } else {
        if (base) this.drawReveal(base, easeOutCubic(t) * REVEAL_END);
        active = true;
      }
      this.chartDirty = true;
    }
    if (this.reveal === "done" && this.baseDirty && base) {
      this.bake(base);
      this.baseDirty = false;
    }

    const before = this.time;
    if (this.advance(delta, now)) active = true;
    if (this.time !== before) {
      this.trackDirty = true;
      this.chartDirty = true;
    }

    // the heading follows the track through the shortest turn
    const target = headingAt(model, this.time);
    const goal = this.heading.position + angleDelta(this.heading.position, target);
    if (reduced || this.snapHeading) {
      this.heading.position = goal;
      this.heading.velocity = 0;
      this.snapHeading = false;
    } else if (Math.abs(goal - this.heading.position) > 0.05 || Math.abs(this.heading.velocity) > 0.05) {
      springStep(this.heading, goal, delta, HEADING_STIFFNESS, HEADING_DAMPING);
      active = true;
    } else {
      this.heading.position = ((goal % 360) + 360) % 360;
      this.heading.velocity = 0;
    }

    if (this.box && model.samples > 0 && this.sx.length === model.samples) {
      const fraction = fractionOf(model, this.time);
      this.markerX = (sampleValue(this.sx, fraction) / this.box.width) * 100;
      this.markerY = (sampleValue(this.sy, fraction) / this.box.height) * 100;
      this.markerReady = true;
    }

    if (this.pendingEmit || (this.time !== this.lastEmitted && (!this.playing || now - this.lastEmitAt >= EMIT_MS))) this.emit(now);

    const cooling = !reduced && now - this.lastPassAt < SETTLE_MS;
    const fading = this.fadePass !== null && now - this.fadeStart < RESTART_FADE_MS;
    if (this.fadePass && !fading) {
      this.fadePass = null;
      this.trackDirty = true;
    }
    const popping = !reduced && this.stopPop.some((at) => now - at < POP_MS);
    if (cooling || fading || popping) {
      active = true;
      this.trackDirty = true;
    }
    if (track && this.trackDirty) {
      this.drawTrack(track, now, reduced);
      this.trackDirty = false;
    }
    if (chart && this.chartDirty) {
      this.drawChart(chart, reduced, chartFront);
      this.chartDirty = false;
    }
    if (effects && this.drawEffects(effects, delta)) active = true;
    return active || this.pendingEmit;
  }

  /* internals */

  /** Advances the clock while playing. Returns whether the playhead is still on its way (or holding at the end). */
  private advance(delta: number, now: number) {
    const model = this.model;
    if (!model || model.samples < 2 || !this.playing || this.scrubbing || this.finished) return false;
    if (this.holdUntil > -Infinity) {
      if (now < this.holdUntil) return true;
      this.holdUntil = -Infinity;
      this.restart(now);
      return true;
    }
    const from = this.time;
    const to = from + this.speed * delta * 1000;
    const fromNow = now - delta * 1000;
    if (to < model.end) {
      this.markPassed(from, to, fromNow, now);
      this.time = to;
      return true;
    }
    this.markPassed(from, model.end, fromNow, now);
    this.time = model.end;
    this.arrive();
    if (this.looping) {
      this.holdUntil = now + LOOP_HOLD_MS;
      return true;
    }
    this.finished = true;
    this.playing = false;
    this.emit(now);
    this.onFinish();
    return false;
  }

  /** Stamps the rows the playhead passed this frame with the moment it passed them; completed stops pop. */
  private markPassed(from: number, to: number, fromNow: number, toNow: number) {
    const model = this.model;
    if (!model || !(to > from)) return;
    const a = fractionOf(model, from);
    const b = fractionOf(model, to);
    if (a <= 0) this.passAt[0] = fromNow;
    for (let i = Math.floor(a) + 1; i <= Math.floor(b) && i < this.passAt.length; i++) {
      this.passAt[i] = fromNow + (toNow - fromNow) * (b > a ? (i - a) / (b - a) : 1);
    }
    this.lastPassAt = toNow;
    model.stops.forEach((stop, i) => {
      if (from < stop.end && stop.end <= to) this.popStop(i, toNow);
    });
  }

  /** Starts over: the old wake fades out in 300 ms while the marker faces the first heading. */
  private restart(now: number) {
    const model = this.model;
    if (!model) return;
    this.fadePass = this.passAt;
    this.fadeHead = this.headDistance();
    this.fadeStart = now;
    this.passAt = new Float64Array(model.samples).fill(-Infinity);
    this.stopPop.fill(-Infinity);
    this.time = model.start;
    this.finished = false;
    this.snapHeading = true;
    this.pendingEmit = true;
    this.trackDirty = true;
    this.chartDirty = true;
  }

  private popStop(index: number, now: number) {
    this.stopPop[index] = now;
    const ink = this.ink;
    if (!ink || index >= this.stopX.length) return;
    this.sparks.add(this.stopX[index] + this.effectsX, this.stopY[index] + this.effectsY, 10, [ink.accent, ink.dark ? ink.glint : ink.soft], STOP_SPARKS);
  }

  /** The destination: sparks fly out past the map's edge and the marker pops. */
  private arrive() {
    const ink = this.ink;
    const last = this.sx.length - 1;
    if (ink && last >= 0) {
      this.sparks.add(this.sx[last] + this.effectsX, this.sy[last] + this.effectsY, 32, [ink.accent, ink.dark ? ink.glint : ink.soft], ARRIVAL_SPARKS);
    }
    this.onArrive();
  }

  /** Arc length of the playhead along the projected table, in px. */
  private headDistance() {
    const model = this.model;
    const path = this.path;
    if (!model || !path || path.count < 2) return 0;
    const fraction = fractionOf(model, this.time);
    const i = clamp(Math.floor(fraction), 0, path.count - 2);
    return path.distances[i] + (path.distances[i + 1] - path.distances[i]) * clamp(fraction - i, 0, 1);
  }

  /** The projection, the lattice, the projected table, the wake dots and the stop positions for the current box. */
  private layoutGeometry() {
    const model = this.model;
    const box = this.box;
    if (!model || !box) return;
    const { bounds } = model;
    const projection = createProjection("equirectangular", {
      width: box.width,
      height: box.height,
      lonRange: [bounds.west, bounds.east],
      latRange: [bounds.south, bounds.north],
    });
    this.lattice = mapLattice(projection, { pitch: PITCH, layout: "honeycomb" });
    const count = model.samples;
    this.sx = new Float32Array(count);
    this.sy = new Float32Array(count);
    for (let k = 0; k < count; k++) {
      projection.projectRelative(model.lat[k], model.lon[k] + model.lambdaOffset, this.point);
      this.sx[k] = this.point.x;
      this.sy[k] = this.point.y;
    }
    this.path = count >= 2 ? buildArcLength(this.sx, this.sy, count) : null;

    const path = this.path;
    const dots = path ? Math.floor(path.length / WAKE_SPACING) + 1 : 0;
    this.dotX = new Float32Array(dots);
    this.dotY = new Float32Array(dots);
    this.dotSample = new Int32Array(dots);
    if (path && dots > 0) {
      let row = 0;
      forEachDot(path, WAKE_SPACING, 0, path.length, (x, y, s) => {
        const j = Math.round(s / WAKE_SPACING);
        if (j >= dots) return;
        while (row < count - 2 && path.distances[row + 1] <= s) row++;
        this.dotX[j] = x;
        this.dotY[j] = y;
        this.dotSample[j] = row;
      });
    }

    this.stopX = new Float32Array(model.stops.length);
    this.stopY = new Float32Array(model.stops.length);
    model.stops.forEach((stop, i) => {
      this.stopX[i] = sampleValue(this.sx, stop.fraction);
      this.stopY[i] = sampleValue(this.sy, stop.fraction);
    });
    this.trackDirty = true;
  }

  /** Dot columns for the chart: the peak speed in each column's time span, scaled to the fastest moment. */
  private buildChart() {
    const box = this.chartBox;
    const model = this.model;
    if (!box || !model) return;
    const columns = Math.max(1, Math.floor((box.width - 2) / CHART_PITCH) + 1);
    const rows = Math.max(1, Math.floor((box.height - 3) / CHART_PITCH) + 1);
    const dots = new Uint8Array(columns);
    const count = model.samples;
    if (count >= 2) {
      const top = Math.max(model.maxSpeed, model.stopSpeed, 1e-6);
      for (let c = 0; c < columns; c++) {
        const from = Math.floor((c / columns) * (count - 1));
        const to = Math.max(from, Math.floor(((c + 1) / columns) * (count - 1)));
        let peak = 0;
        for (let k = from; k <= to; k++) if (Number.isFinite(model.speed[k])) peak = Math.max(peak, model.speed[k]);
        dots[c] = peak < model.stopSpeed ? 0 : Math.max(1, Math.min(rows, Math.round((peak / top) * rows)));
      }
    }
    this.chartDots = dots;
    this.chartX0 = (box.width - (columns - 1) * CHART_PITCH) / 2;
  }

  /** Reveal thresholds: distance from the start of the track, plus the dot's jitter for an uneven front. */
  private prepareReveal() {
    const lattice = this.lattice;
    const box = this.box;
    if (!lattice || !box) return;
    const ox = this.sx.length > 0 ? this.sx[0] : box.width / 2;
    const oy = this.sy.length > 0 ? this.sy[0] : box.height / 2;
    const reach = Math.max(
      Math.hypot(ox, oy),
      Math.hypot(box.width - ox, oy),
      Math.hypot(ox, box.height - oy),
      Math.hypot(box.width - ox, box.height - oy),
    );
    this.threshold = new Float32Array(lattice.count);
    for (let i = 0; i < lattice.count; i++) {
      const n = Math.hypot(lattice.x[i] - ox, lattice.y[i] - oy) / Math.max(1, reach);
      this.threshold[i] = n * 0.82 + lattice.jitter[i] * 0.18;
    }
  }

  private bake(surface: CanvasSurface) {
    const { context, width, height, dpr } = surface;
    context.clearRect(0, 0, width, height);
    const lattice = this.lattice;
    if (!lattice) return;
    context.fillStyle = this.landColor;
    context.globalAlpha = LAND_ALPHA;
    for (let i = 0; i < lattice.count; i++) fillSquare(context, lattice.x[i], lattice.y[i], LAND_SIZE, dpr);
    context.globalAlpha = 1;
  }

  /** The first reveal: dots appear behind an uneven front that flashes in the accent as it passes. */
  private drawReveal(surface: CanvasSurface, front: number) {
    const { context, width, height, dpr } = surface;
    const lattice = this.lattice;
    const batch = this.revealBatch;
    context.clearRect(0, 0, width, height);
    if (!lattice || !batch || this.threshold.length !== lattice.count) return;
    for (let i = 0; i < lattice.count; i++) {
      const passed = front - this.threshold[i];
      const appear = clamp(passed / REVEAL_BAND, 0, 1);
      if (appear <= 0) continue;
      const flash = Math.exp(-passed / 0.05);
      const size = snapSize(LAND_SIZE + 0.6 * flash, dpr);
      batch.add(snapCenter(lattice.x[i], size, dpr), snapCenter(lattice.y[i], size, dpr), size, 0.85 * flash, appear * LAND_ALPHA);
    }
    batch.flush(context);
  }

  /** The track layer: the glow at the head, the dotted hint ahead, the wake behind, the stop rings and the endpoints. */
  private drawTrack(surface: CanvasSurface, now: number, reduced: boolean) {
    const { context, width, height, dpr } = surface;
    context.clearRect(0, 0, width, height);
    const model = this.model;
    const ink = this.ink;
    const batch = this.trackBatch;
    if (!model || !ink || !batch || !this.path || this.sx.length !== model.samples) return;
    const head = this.headDistance();
    const dots = this.dotX.length;
    const headIndex = Math.min(dots - 1, Math.floor(head / WAKE_SPACING + 1e-6));
    const fraction = fractionOf(model, this.time);

    if (!reduced) {
      const x = sampleValue(this.sx, fraction);
      const y = sampleValue(this.sy, fraction);
      const halo = context.createRadialGradient(x, y, 0, x, y, HALO_RADIUS);
      halo.addColorStop(0, rgba(ink.accent, this.playing ? 0.3 : 0.2));
      halo.addColorStop(1, rgba(ink.accent, 0));
      context.fillStyle = halo;
      context.fillRect(x - HALO_RADIUS, y - HALO_RADIUS, HALO_RADIUS * 2, HALO_RADIUS * 2);
    }

    // ahead of the marker: the rest of the track as a quiet dotted hint
    const hint = snapSize(HINT_SIZE, dpr);
    for (let j = headIndex + 1; j < dots; j++) {
      batch.add(snapCenter(this.dotX[j], hint, dpr), snapCenter(this.dotY[j], hint, dpr), hint, 0, HINT_ALPHA);
    }
    // after a loop restart the old wake fades out
    if (this.fadePass) {
      const keep = 1 - clamp((now - this.fadeStart) / RESTART_FADE_MS, 0, 1);
      const fadeIndex = Math.min(dots - 1, Math.floor(this.fadeHead / WAKE_SPACING + 1e-6));
      for (let j = 0; j <= fadeIndex; j++) this.addWakeDot(batch, j, this.fadePass, this.fadeHead, now, reduced, dpr, keep);
    }
    for (let j = 0; j <= headIndex; j++) this.addWakeDot(batch, j, this.passAt, head, now, reduced, dpr, 1);
    this.addStops(batch, now, reduced, dpr);

    const last = model.samples - 1;
    const end = snapSize(3, dpr);
    batch.add(snapCenter(this.sx[0], end, dpr), snapCenter(this.sy[0], end, dpr), end, 0, 0.9);
    batch.add(snapCenter(this.sx[last], end, dpr), snapCenter(this.sy[last], end, dpr), end, this.time >= model.end ? 0.5 : 0, 0.9);
    batch.flush(context);
  }

  /**
   * One wake dot. Freshness is exp(−age / 3 s) since the playhead passed it, or the tail glow within 36 px of the head,
   * whichever is brighter; it sets the tone (strong land → accent → glint), the alpha (0.15 to 1) and the size (1.4 to
   * 2 px). Reduced motion draws the whole wake in the accent at one alpha.
   */
  private addWakeDot(batch: DotBatch, j: number, pass: Float64Array, head: number, now: number, reduced: boolean, dpr: number, keep: number) {
    let fresh: number;
    if (reduced) fresh = 0.5;
    else {
      const passed = pass[this.dotSample[j]];
      const age = passed > -Infinity ? Math.max(0, now - passed) : Infinity;
      const tail = TAIL_GLOW * Math.exp(-Math.max(0, head - j * WAKE_SPACING) / TAIL_PX);
      fresh = Math.max(Math.exp(-age / WAKE_FADE_MS), tail);
    }
    const alpha = reduced ? 0.85 : WAKE_FLOOR + (1 - WAKE_FLOOR) * fresh;
    const size = snapSize(WAKE_MIN_SIZE + (WAKE_MAX_SIZE - WAKE_MIN_SIZE) * fresh, dpr);
    batch.add(snapCenter(this.dotX[j], size, dpr), snapCenter(this.dotY[j], size, dpr), size, fresh, alpha * keep);
  }

  /** Stop rings: a faint hint ahead, filling clockwise while the track waits there, then lit; completion pops. */
  private addStops(batch: DotBatch, now: number, reduced: boolean, dpr: number) {
    const model = this.model;
    if (!model) return;
    model.stops.forEach((stop, i) => {
      if (i >= this.stopX.length) return;
      const done = this.time >= stop.end;
      const dwelling = !done && this.time >= stop.start;
      const progress = done ? 1 : dwelling ? (this.time - stop.start) / Math.max(1, stop.end - stop.start) : 0;
      const lit = done ? STOP_DOTS : Math.floor(progress * STOP_DOTS);
      const age = now - this.stopPop[i];
      const pop = !reduced && done && age < POP_MS ? age / POP_MS : 1;
      const radius = STOP_RADIUS * (pop < 1 ? 0.6 + 0.4 * easeOutBack(pop, 2.2) : 1);
      const flash = 1 - pop;
      for (let d = 0; d < STOP_DOTS; d++) {
        const angle = -Math.PI / 2 + (d / STOP_DOTS) * TAU;
        const on = d < lit;
        const leading = dwelling && d === lit && !reduced;
        const size = snapSize(on || leading ? 1.75 : 1.4, dpr);
        const tone = on ? 0.5 + 0.5 * flash : leading ? 1 : 0;
        const alpha = on || leading ? 0.95 : STOP_HINT_ALPHA;
        const x = this.stopX[i] + Math.cos(angle) * radius;
        const y = this.stopY[i] + Math.sin(angle) * radius;
        batch.add(snapCenter(x, size, dpr), snapCenter(y, size, dpr), size, tone, alpha);
      }
    });
  }

  /**
   * The speed chart: one dot column per 3 px, as tall as the peak speed in its span. Columns behind the playhead are lit
   * in the accent, hottest next to it; the rest stay in the land grey. Stops leave a single baseline dot.
   */
  private drawChart(surface: CanvasSurface, reduced: boolean, front: number) {
    const { context, width, height, dpr } = surface;
    context.clearRect(0, 0, width, height);
    const model = this.model;
    const ink = this.ink;
    const batch = this.chartBatch;
    if (!model || !ink || !batch) return;
    const playable = model.samples >= 2;
    const headX = playable ? progressOf(model, this.time) * width : -1;
    const columns = this.chartDots.length;
    const size = snapSize(CHART_DOT, dpr);
    for (let c = 0; c < columns; c++) {
      const x = this.chartX0 + c * CHART_PITCH;
      const n = columns > 1 ? c / (columns - 1) : 0;
      const count = this.chartDots[c];
      const lit = playable && x <= headX;
      const heat = lit && !reduced ? Math.exp(-(headX - x) / CHART_PITCH / 6) : 0;
      for (let r = 0; r < Math.max(1, count); r++) {
        const threshold = n * 0.82 + hash(c * 31 + r * 7 + 1.13) * 0.18;
        const appear = clamp((front - threshold) / 0.07, 0, 1);
        if (appear <= 0) continue;
        const y = height - 2 - r * CHART_PITCH;
        const top = r === count - 1;
        const tone = count === 0 ? (lit ? 0.5 : 0) : lit ? 0.5 + 0.5 * heat * (top ? 1 : 0.6) : 0;
        const alpha = count === 0 ? 0.55 : 1;
        batch.add(snapCenter(x, size, dpr), snapCenter(y, size, dpr), size, tone, alpha * appear);
      }
    }
    batch.flush(context);

    if (!playable) return;
    // 1 px hairlines whose left edge sits on a device pixel
    const line = snapSize(1, dpr);
    context.fillStyle = rgba(ink.accent);
    context.globalAlpha = 0.9;
    context.fillRect(Math.round((headX - line / 2) * dpr) / dpr, 0, line, height);
    if (this.hover !== null) {
      const hoverX = progressOf(model, this.hover) * width;
      context.fillStyle = rgba(ink.foreground);
      context.globalAlpha = 0.35;
      context.fillRect(Math.round((hoverX - line / 2) * dpr) / dpr, 0, line, height);
    }
    context.globalAlpha = 1;
  }

  /** Sparks on the layer that reaches past the map. Returns whether any are alive. */
  private drawEffects(surface: CanvasSurface, delta: number) {
    const { context, width, height } = surface;
    if (!this.sparks.active) {
      if (this.effectsDirty) {
        context.clearRect(0, 0, width, height);
        this.effectsDirty = false;
      }
      return false;
    }
    this.effectsDirty = true;
    context.clearRect(0, 0, width, height);
    return this.sparks.step(context, delta);
  }
}

/** The current time in ms, for the animation loop and event handlers (never read during render). */
function clockNow() {
  return performance.now();
}
