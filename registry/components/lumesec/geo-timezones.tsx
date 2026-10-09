"use client";

import * as React from "react";

import { snap, useCanvas, type CanvasSurface } from "@/lib/lumesec/canvas";
import { usePalette } from "@/lib/lumesec/color";
import {
  bayer4,
  createDotBatch,
  GEO_TOKENS,
  geoInk,
  ringFront,
  type DotBatch,
  type GeoInk,
  type GeoPalette,
} from "@/lib/lumesec/geo";
import {
  formatUtcOffset,
  formatWeekday,
  formatZonedTime,
  isValidTimeZone,
  startOfZonedDay,
  useNow,
  utcOffsetMinutes,
  zonedParts,
  type ZonedParts,
} from "@/lib/lumesec/geo-data";
import { clamp, easeOutCubic, hash, lerp, mixRgb, rgba, stringHash } from "@/lib/lumesec/math";
import {
  prefersReducedMotion,
  springStep,
  useAnimationLoop,
  useLazyRef,
  useReducedMotion,
  type Spring,
} from "@/lib/lumesec/motion";
import { RollText } from "@/lib/lumesec/roll-text";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** One row of the planner: a city and the IANA time zone its local time comes from. */
export interface TimeZoneCity {
  /** Unique id, used as the React key and by `reference`. Rows with a repeated id are skipped. */
  readonly id: string;
  /** Name shown in the row and in the slider's value text, for example `London`. */
  readonly label: string;
  /** IANA time zone, for example `Europe/London`. An unknown zone falls back to UTC and the row says "(UTC)". */
  readonly timeZone: string;
}

/** Props of GeoTimezones. Every other `div` prop goes to the root element. */
export interface GeoTimezonesProps extends Omit<React.ComponentProps<"div">, "defaultValue" | "onChange"> {
  /** The rows (controlled). Use with `onCitiesChange`. An empty array shows an empty state. */
  cities?: readonly TimeZoneCity[];
  /** The rows when uncontrolled. Default: London, Berlin, New York and São Paulo, which share two working hours all year. */
  defaultCities?: readonly TimeZoneCity[];
  /** Called with the remaining rows when the user removes one. */
  onCitiesChange?: (cities: readonly TimeZoneCity[]) => void;
  /** The cursor instant in epoch ms (controlled). Use with `onValueChange`. */
  value?: number;
  /** The cursor instant when uncontrolled. Default: the current time rounded to `step`, read once after mount. */
  defaultValue?: number;
  /** Called with the new instant in epoch ms as the cursor moves (snapped to `step`). */
  onValueChange?: (value: number) => void;
  /** Id of the city whose local midnight starts the window and whose hours label the axis. Default: the first city. */
  reference?: string;
  /** Working hours in local time, `[from, to)`. Default `[9, 17]`. A range may wrap past midnight. */
  workHours?: readonly [number, number];
  /** Sleeping hours in local time, `[from, to)`. Default `[23, 7]`, which wraps past midnight. */
  sleepHours?: readonly [number, number];
  /** Cursor step in minutes, 1 to 180. Default 15. */
  step?: number;
  /** Shows times on a 12-hour clock. */
  hour12?: boolean;
  /** Shows a remove button on every row. */
  removable?: boolean;
  /** BCP 47 locale for the weekday names. Default `en-US`. */
  locale?: string;
  /** Accessible name of the time cursor. Default "Meeting time". */
  label?: string;
}

/**
 * A meeting planner: several cities on one time line, one row per city, with each local hour drawn as a block of
 * dots, dense for working hours and sparse for the night. Hours when every city is at work light up as an accent band
 * across all rows. Drag the cursor (or use the arrow keys) and every city's local time rolls with it; when the cursor
 * enters the band, a light runs down through it and bursts out at the bottom. The window is one local day of the
 * reference city, and offsets come from the time zone database, so daylight saving time and half-hour zones are exact.
 *
 * @example
 * <GeoTimezones
 *   defaultCities={[
 *     { id: "lon", label: "London", timeZone: "Europe/London" },
 *     { id: "nyc", label: "New York", timeZone: "America/New_York" },
 *   ]}
 *   onValueChange={(time) => setMeeting(new Date(time))}
 * />
 */
export function GeoTimezones({
  cities,
  defaultCities,
  onCitiesChange,
  value,
  defaultValue,
  onValueChange,
  reference,
  workHours = WORK_HOURS,
  sleepHours = SLEEP_HOURS,
  step = 15,
  hour12 = false,
  removable = false,
  locale,
  label = "Meeting time",
  className,
  ...props
}: GeoTimezonesProps) {
  const reducedMotion = useReducedMotion();
  const [cityList, setCityList] = useControllableState<readonly TimeZoneCity[]>({
    value: cities,
    defaultValue: defaultCities ?? DEMO_CITIES,
    onChange: onCitiesChange,
  });
  const rows = React.useMemo(() => resolveCities(cityList), [cityList]);

  const stepMinutes = Number.isFinite(step) ? clamp(Math.round(step), 1, 180) : 15;
  const stepMs = stepMinutes * MINUTE;
  const [workFrom, workTo] = workHours;
  const [sleepFrom, sleepTo] = sleepHours;

  // The cursor: the controlled value, else the stored one, else the clock read once after mount (null before).
  const clockAfterMount = useNow(0, value === undefined && defaultValue === undefined);
  const [stored, setStored] = useControllableState<number | null>({
    value: value === undefined ? undefined : Number.isFinite(value) ? value : null,
    defaultValue: defaultValue !== undefined && Number.isFinite(defaultValue) ? defaultValue : null,
    onChange: (next) => {
      if (next !== null) onValueChange?.(next);
    },
  });
  const cursor = stored ?? (clockAfterMount === null ? null : Math.round(clockAfterMount / stepMs) * stepMs);

  /** Rows on screen: the cities, plus removed rows while they collapse. */
  const [presence, setPresence] = React.useState<Presence>(() => ({
    source: rows,
    items: rows.map((row) => ({ row, entering: false, leaving: false })),
  }));
  if (presence.source !== rows) {
    setPresence({ source: rows, items: mergePresence(presence.items, rows, reducedMotion) });
  }

  const referenceRow = rows.find((row) => row.id === reference) ?? rows[0] ?? null;
  const referenceZone = referenceRow?.zone ?? "UTC";
  const start = cursor === null || !referenceRow ? null : startOfZonedDay(referenceZone, cursor);
  const end = start === null ? null : windowEnd(referenceZone, start);
  const span = start !== null && end !== null ? end - start : DAY;
  /** The last step inside the window (23:45 with 15-minute steps). */
  const lastOffset = Math.floor((span - 1) / stepMs) * stepMs;
  const lastTime = start === null ? null : start + lastOffset;

  const models = React.useMemo(() => {
    const map = new Map<string, RowModel>();
    if (start === null || end === null) return map;
    const rules: HourRules = { workFrom, workTo, sleepFrom, sleepTo };
    for (const item of presence.items) map.set(item.row.id, buildRowModel(item.row, start, end, rules, locale));
    return map;
  }, [presence.items, start, end, workFrom, workTo, sleepFrom, sleepTo, locale]);

  const overlap = React.useMemo(() => computeOverlap(rows, models, start, end), [rows, models, start, end]);
  const ticks = React.useMemo(
    () => (start === null || end === null ? genericTicks(hour12) : windowTicks(referenceZone, start, end, hour12)),
    [referenceZone, start, end, hour12],
  );

  // Times roll in the direction the cursor moved.
  const [roll, setRoll] = React.useState<{ cursor: number | null; direction: number }>({ cursor, direction: 1 });
  if (roll.cursor !== cursor) {
    setRoll({ cursor, direction: cursor !== null && roll.cursor !== null && cursor < roll.cursor ? -1 : 1 });
  }

  const contentRef = React.useRef<HTMLDivElement>(null);
  const rowsRef = React.useRef<HTMLDivElement>(null);
  const stripRef = React.useRef<HTMLCanvasElement>(null);
  const effectsRef = React.useRef<HTMLCanvasElement>(null);
  const sliderRef = React.useRef<HTMLDivElement>(null);
  const cursorRef = React.useRef<HTMLDivElement>(null);
  const chipRef = React.useRef<HTMLSpanElement>(null);
  const rowRefs = React.useRef(new Map<string, HTMLDivElement>());
  const removeRefs = React.useRef(new Map<string, HTMLButtonElement>());
  /** The motion state, created on first use (effects, handlers and the loop), never during a render. */
  const engineRef = useLazyRef(() => createEngine());

  const loop = useAnimationLoop(contentRef, frame);
  const palette = usePalette(contentRef, GEO_TOKENS, () => loop.kick());
  const strip = useCanvas(stripRef, () => loop.kick(), CANVAS_OPTIONS);
  const effects = useCanvas(effectsRef, () => loop.kick(), CANVAS_OPTIONS);

  // A cursor that changes from outside (or a window that moves) springs the line to its place.
  React.useEffect(() => {
    if (cursor === null || start === null) return;
    const engine = engineRef.current;
    const fraction = clamp((cursor - start) / span, 0, 1);
    engine.latest = cursor;
    if (!engine.dragging) engine.cursor.target = fraction;
    if (!engine.ready || prefersReducedMotion()) {
      engine.cursor.position = engine.cursor.target;
      engine.cursor.velocity = 0;
    }
    engine.ready = true;
    loop.kick();
  }, [cursor, start, span, engineRef, loop]);

  // A new band fills from the top; the one it replaces drains from the top.
  React.useEffect(() => {
    const band = engineRef.current.band;
    if (band.key === overlap.key) return;
    band.previous = band.current;
    band.previousFill = band.fill;
    band.current = overlap.intervals;
    band.key = overlap.key;
    band.fill = 0;
    band.drain = 0;
    loop.kick();
  }, [overlap, engineRef, loop]);

  React.useEffect(() => {
    loop.kick();
  }, [models, reducedMotion, loop]);

  const registerRow = React.useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) rowRefs.current.set(id, node);
    else rowRefs.current.delete(id);
  }, []);
  const registerRemove = React.useCallback((id: string, node: HTMLButtonElement | null) => {
    if (node) removeRefs.current.set(id, node);
    else removeRefs.current.delete(id);
  }, []);
  const handleRowMotion = React.useCallback(
    (ms: number) => {
      const engine = engineRef.current;
      engine.animatingUntil = Math.max(engine.animatingUntil, performance.now() + ms);
      loop.kick();
    },
    [engineRef, loop],
  );
  const handleRowExited = React.useCallback((id: string) => {
    setPresence((current) => ({
      ...current,
      items: current.items.filter((item) => !(item.leaving && item.row.id === id)),
    }));
  }, []);

  function frame(time: number, delta: number) {
    const engine = engineRef.current;
    const ms = time * 1000;
    const reduced = prefersReducedMotion();
    const colors = palette.current;
    if (colors && colors !== engine.palette) {
      engine.palette = colors;
      engine.ink = geoInk(colors);
      const ramp = [engine.ink.land, engine.ink.landStrong, engine.ink.accent, engine.ink.glint];
      if (engine.batch) engine.batch.setRamp(ramp);
      else engine.batch = createDotBatch(4096, ramp, { tones: TONES, levels: 16 });
    }

    // Rows are measured every frame, so the canvas follows rows that grow in or collapse.
    const items = presence.items;
    engine.tops.length = 0;
    engine.heights.length = 0;
    for (const item of items) {
      const element = rowRefs.current.get(item.row.id);
      engine.tops.push(element ? element.offsetTop : 0);
      engine.heights.push(element ? element.offsetHeight : 0);
    }
    engine.rowsOffset = rowsRef.current?.offsetTop ?? 0;

    const cursorSpring = engine.cursor;
    if (reduced) {
      cursorSpring.position = cursorSpring.target;
      cursorSpring.velocity = 0;
    } else {
      springStep(cursorSpring, cursorSpring.target, delta, 520, 0.72);
    }
    let moving = !settled(cursorSpring, cursorSpring.target);

    // Each row's highlight trails the cursor on its own spring, so the lit column bends behind fast drags.
    for (let i = 0; i < items.length; i++) {
      const id = items[i].row.id;
      let highlight = engine.highlights.get(id);
      if (!highlight) {
        highlight = { position: cursorSpring.position, velocity: 0 };
        engine.highlights.set(id, highlight);
      }
      if (reduced) {
        highlight.position = cursorSpring.position;
        highlight.velocity = 0;
      } else {
        springStep(highlight, cursorSpring.position, delta, 300 + i * 40, 0.8);
      }
      if (!settled(highlight, cursorSpring.position)) moving = true;
    }
    if (engine.highlights.size > items.length) {
      for (const id of engine.highlights.keys())
        if (!items.some((item) => item.row.id === id)) engine.highlights.delete(id);
    }

    const glowTarget = engine.dragging ? 1 : engine.focused ? 0.7 : REST_GLOW;
    if (reduced) {
      engine.glow.position = glowTarget;
      engine.glow.velocity = 0;
    } else {
      springStep(engine.glow, glowTarget, delta, 170, 1);
    }
    if (!settled(engine.glow, glowTarget)) moving = true;

    const band = engine.band;
    band.fill = reduced ? 1 : Math.min(1, band.fill + delta / FILL_SECONDS);
    band.drain = reduced ? 1 : Math.min(1, band.drain + delta / DRAIN_SECONDS);

    // The light runs down the band when the line enters it (not when the band appears around the line).
    const inside = engine.ready && intervalsContain(band.current, cursorSpring.position);
    if (inside && !engine.inBand && band.fill >= 1 && !reduced) {
      engine.sweepStart = ms;
      engine.sparksFired = false;
      popChip(chipRef.current);
    }
    engine.inBand = inside;

    const stripSurface = strip.current;
    const cursorElement = cursorRef.current;
    if (cursorElement && stripSurface) {
      cursorElement.style.transform = `translate3d(${(cursorSpring.position * stripSurface.width).toFixed(2)}px,0,0)`;
      cursorElement.style.opacity = engine.ready ? "1" : "0";
    }

    const ink = engine.ink;
    const batch = engine.batch;
    const scene: Scene = { items, models, span };
    if (stripSurface && ink && batch) drawStrip(stripSurface, batch, ink, scene, engine, ms, reduced);

    const effectsSurface = effects.current;
    const sparksAlive =
      effectsSurface && ink && stripSurface
        ? drawEffects(effectsSurface, ink, engine, stripSurface.width, ms, delta)
        : false;

    const sweeping = engine.sweepStart >= 0 && ms - engine.sweepStart < SWEEP_MS + 100;
    const ambient = !reduced && band.current.length > 0 && engine.ready;
    return (
      moving || band.fill < 1 || band.drain < 1 || sweeping || sparksAlive || ms < engine.animatingUntil || ambient
    );
  }

  const fractionOf = (time: number) => (start === null ? 0 : clamp((time - start) / span, 0, 1));

  function snapTime(time: number) {
    if (start === null || lastTime === null) return time;
    return clamp(start + Math.round((time - start) / stepMs) * stepMs, start, lastTime);
  }

  function commit(time: number) {
    engineRef.current.latest = time;
    setStored(time);
  }

  function dragTo(element: HTMLElement, clientX: number, release: boolean) {
    if (start === null || lastTime === null) return;
    const engine = engineRef.current;
    const rect = element.getBoundingClientRect();
    const fraction = rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0;
    const time = snapTime(start + fraction * span);
    // the line follows the pointer while dragging and settles on the step on release
    engine.cursor.target = release ? fractionOf(time) : Math.min(fraction, fractionOf(lastTime));
    commit(time);
    loop.kick();
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || start === null) return;
    event.preventDefault();
    const element = event.currentTarget;
    element.focus({ preventScroll: true });
    element.setPointerCapture(event.pointerId);
    element.setAttribute("data-dragging", "");
    engineRef.current.dragging = true;
    dragTo(element, event.clientX, false);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (engineRef.current.dragging) dragTo(event.currentTarget, event.clientX, false);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const engine = engineRef.current;
    if (!engine.dragging) return;
    engine.dragging = false;
    const element = event.currentTarget;
    element.removeAttribute("data-dragging");
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    if (event.type === "pointercancel") {
      // the page took the gesture (a vertical scroll): settle on the last committed time
      if (engine.latest !== null) engine.cursor.target = fractionOf(engine.latest);
      loop.kick();
      return;
    }
    dragTo(element, event.clientX, true);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (start === null || lastTime === null) return;
    const move = keyMove(event.key, event.shiftKey, stepMs);
    if (move === null) return;
    event.preventDefault();
    const engine = engineRef.current;
    // from the latest committed time, so presses that arrive before a re-render still add up
    const base = engine.latest ?? cursor ?? start;
    let time: number;
    if (move === "start") time = start;
    else if (move === "end") time = lastTime;
    else {
      // an off-grid time first moves to the grid point in the direction of the key
      const steps = (base - start) / stepMs;
      const aligned = start + (move > 0 ? Math.floor(steps) : Math.ceil(steps)) * stepMs;
      time = clamp(aligned + move, start, lastTime);
    }
    engine.cursor.target = fractionOf(time);
    if (prefersReducedMotion()) engine.cursor.position = engine.cursor.target;
    commit(time);
    loop.kick();
  }

  function removeCity(id: string) {
    const index = rows.findIndex((row) => row.id === id);
    const remaining = rows.filter((row) => row.id !== id);
    // focus moves before the row turns inert: to the next row's button, else the previous one, else the cursor
    const neighbour = remaining[index] ?? remaining[index - 1];
    const target =
      (neighbour && removeRefs.current.get(neighbour.id)) ?? (remaining.length > 0 ? sliderRef.current : null);
    target?.focus({ preventScroll: true });
    setCityList(cityList.filter((city) => city.id !== id));
  }

  const clocks = presence.items.map((item) => clockText(item.row.zone, cursor, hour12, locale));
  const valueText =
    cursor === null
      ? undefined
      : rows.map((row) => `${formatZonedTime(row.zone, cursor, { hour12 })} ${row.label}`).join(", ");
  const referenceLabel = referenceRow?.label ?? "";
  const rangeText = overlap.ranges
    .map(
      (range) =>
        `${formatZonedTime(referenceZone, range.from, { hour12 })}–${formatZonedTime(referenceZone, range.to, { hour12 })}`,
    )
    .join(", ");
  const status: OverlapStatus =
    rows.length === 0 || start === null ? "idle" : rows.length === 1 ? "single" : overlap.minutes > 0 ? "band" : "none";
  const announcement =
    status === "band"
      ? `Overlap ${rangeText} ${referenceLabel} time`
      : status === "none"
        ? "No common working hours"
        : "";
  const empty = presence.items.length === 0;

  return (
    <div
      data-slot="geo-timezones"
      className={cn(
        "@container w-full max-w-[660px] rounded-[14px] border border-border bg-card p-3 text-card-foreground shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)] [-webkit-tap-highlight-color:transparent]",
        className,
      )}
      {...props}
    >
      <div
        ref={contentRef}
        className={cn(
          "grid gap-1.5",
          hour12 ? "[--col:150px] @max-[480px]:[--col:118px]" : "[--col:132px] @max-[480px]:[--col:104px]",
        )}
      >
        <div aria-hidden="true" className="flex h-7 min-w-0 items-center gap-2">
          {status === "band" ? (
            <>
              <OverlapChip ref={chipRef} minutes={overlap.minutes} animate={!reducedMotion} />
              <span className="min-w-0 truncate text-[12.5px] leading-4 text-muted-foreground">
                <span className="font-mono tabular-nums">{rangeText}</span> {referenceLabel} time
              </span>
            </>
          ) : status === "none" ? (
            <span className="truncate text-[12.5px] leading-4 text-muted-foreground">No common working hours</span>
          ) : status === "single" ? (
            <span className="truncate text-[12.5px] leading-4 text-muted-foreground">
              Common hours need two or more cities
            </span>
          ) : null}
        </div>
        <span className="sr-only" aria-live="polite">
          {announcement}
        </span>

        {/* the canvases stay mounted when the list is empty, so they keep their size observers */}
        <div className="relative select-none">
          <div
            aria-hidden="true"
            className={cn("grid h-[22px] grid-cols-[var(--col)_minmax(0,1fr)]", empty && "hidden")}
          >
            <span className="self-end truncate pr-2 pb-1 text-[11px] leading-[14px] text-muted-foreground">
              {referenceLabel} time
            </span>
            <div className="relative">
              {ticks.map((tick, i) => (
                <span
                  key={tick.at}
                  className={cn("absolute inset-y-0 flex items-end", i % 2 === 1 && "@max-[480px]:hidden")}
                  style={{ left: `${(tick.at * 100).toFixed(3)}%` }}
                >
                  <span className="absolute bottom-0 left-0 h-[5px] w-px bg-border" />
                  <span className="pb-1 pl-[3px] font-mono text-[10.5px] leading-3 whitespace-nowrap text-muted-foreground tabular-nums">
                    {tick.text}
                  </span>
                </span>
              ))}
            </div>
          </div>

          <div
            ref={rowsRef}
            role={empty ? undefined : "list"}
            aria-label={empty ? undefined : "Cities"}
            className="relative"
          >
            <canvas
              ref={stripRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 left-[var(--col)] block h-full w-[calc(100%-var(--col))]"
            />
            {presence.items.map((item, i) => (
              <TimezoneRow
                key={item.row.id}
                item={item}
                model={models.get(item.row.id)}
                clock={clocks[i]}
                direction={roll.direction}
                animate={!reducedMotion}
                hour12={hour12}
                removable={removable}
                onRemove={removeCity}
                onExited={handleRowExited}
                onMotion={handleRowMotion}
                registerRow={registerRow}
                registerRemove={registerRemove}
              />
            ))}
          </div>
          {empty ? (
            <div className="grid h-[88px] place-items-center rounded-[10px] border border-dashed border-border text-[12.5px] text-muted-foreground">
              No cities to compare
            </div>
          ) : null}

          {rows.length > 0 ? (
            <div
              ref={sliderRef}
              role="slider"
              tabIndex={0}
              aria-label={label}
              aria-orientation="horizontal"
              aria-valuemin={0}
              aria-valuemax={Math.round(lastOffset / MINUTE)}
              aria-valuenow={cursor === null || start === null ? undefined : Math.round((cursor - start) / MINUTE)}
              aria-valuetext={valueText}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                engineRef.current.focused = true;
                loop.kick();
              }}
              onBlur={() => {
                engineRef.current.focused = false;
                loop.kick();
              }}
              className="group/slider absolute inset-y-0 right-0 left-[var(--col)] z-[3] cursor-grab touch-pan-y outline-none data-[dragging]:cursor-grabbing"
            >
              <div
                ref={cursorRef}
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-0 w-0 opacity-0 will-change-transform"
              >
                <div className="absolute top-[17px] bottom-0 -left-px w-0.5 bg-lumesec" />
                <div className="absolute top-[3px] -left-[7px] grid size-[14px] place-items-center rounded-[4px] bg-lumesec shadow-[0_0_0_2px_var(--card),0_1px_3px_rgb(0_0_0/0.25)] outline-lumesec group-focus-visible/slider:outline-2 group-focus-visible/slider:outline-offset-2 group-focus-visible/slider:outline-solid">
                  <span className="h-1.5 w-[3px] border-x border-lumesec-foreground/85" />
                </div>
              </div>
            </div>
          ) : null}

          <canvas
            ref={effectsRef}
            aria-hidden="true"
            className="pointer-events-none absolute -top-6 -right-6 -bottom-12 left-[calc(var(--col)-24px)] z-[4] block h-[calc(100%+72px)] w-[calc(100%-var(--col)+48px)]"
          />
        </div>
      </div>
    </div>
  );
}

/* Rows ---------------------------------------------------------------------------------------------- */

interface TimezoneRowProps {
  item: PresenceItem;
  model: RowModel | undefined;
  clock: ClockText;
  direction: number;
  animate: boolean;
  hour12: boolean;
  removable: boolean;
  onRemove: (id: string) => void;
  onExited: (id: string) => void;
  onMotion: (ms: number) => void;
  registerRow: (id: string, node: HTMLDivElement | null) => void;
  registerRemove: (id: string, node: HTMLButtonElement | null) => void;
}

/** One city: name, local time and weekday on the left; local midnights over the dot strip on the right. */
function TimezoneRow({
  item,
  model,
  clock,
  direction,
  animate,
  hour12,
  removable,
  onRemove,
  onExited,
  onMotion,
  registerRow,
  registerRemove,
}: TimezoneRowProps) {
  const { row, entering, leaving } = item;
  const { id } = row;
  const node = React.useRef<HTMLDivElement>(null);
  const setNode = React.useCallback(
    (element: HTMLDivElement | null) => {
      node.current = element;
      registerRow(id, element);
    },
    [id, registerRow],
  );
  const setRemove = React.useCallback(
    (element: HTMLButtonElement | null) => registerRemove(id, element),
    [id, registerRemove],
  );

  // A row added after the first render grows in; the canvas measures it every frame and follows.
  React.useLayoutEffect(() => {
    const element = node.current;
    if (!entering || !element || typeof element.animate !== "function" || prefersReducedMotion()) return;
    const animation = element.animate(
      [
        { height: "0px", opacity: 0 },
        { height: `${ROW_HEIGHT}px`, opacity: 1 },
      ],
      { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
    onMotion(280);
    return () => animation.cancel();
  }, [entering, onMotion]);

  React.useLayoutEffect(() => {
    if (!leaving) return;
    const element = node.current;
    if (!element || typeof element.animate !== "function") {
      onExited(id);
      return;
    }
    const animation = element.animate(
      [
        { height: `${element.offsetHeight}px`, opacity: 1 },
        { height: "0px", opacity: 0 },
      ],
      { duration: 220, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" },
    );
    onMotion(260);
    animation.onfinish = () => onExited(id);
    return () => {
      animation.onfinish = null;
      animation.cancel();
    };
  }, [leaving, id, onExited, onMotion]);

  return (
    <div
      ref={setNode}
      role={leaving ? undefined : "listitem"}
      aria-hidden={leaving || undefined}
      inert={leaving}
      className="group/row grid h-11 grid-cols-[var(--col)_minmax(0,1fr)] overflow-hidden border-t border-border"
    >
      <div className="flex min-w-0 flex-col justify-center gap-[3px] pr-2.5">
        <div className="flex h-4 min-w-0 items-center gap-1">
          <span title={row.label} className="truncate text-[13px] leading-4 font-medium text-foreground">
            {row.label}
          </span>
          {row.invalid ? <span className="shrink-0 text-[11px] leading-4 text-muted-foreground">(UTC)</span> : null}
          {removable ? (
            <button
              ref={setRemove}
              type="button"
              aria-label={`Remove ${row.label}`}
              onClick={() => onRemove(id)}
              className="-my-0.5 ml-auto grid size-5 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-muted-foreground opacity-0 transition-[opacity,background-color,color] duration-150 outline-none group-hover/row:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-lumesec focus-visible:outline-solid motion-reduce:transition-none [@media(hover:none)]:opacity-100"
            >
              <svg
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.4}
                strokeLinecap="round"
                aria-hidden="true"
                className="size-2.5"
              >
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
          ) : null}
        </div>
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="flex shrink-0 items-baseline font-mono text-[15px] leading-[18px] font-medium text-foreground tabular-nums @max-[480px]:text-[13px]">
            <RollText
              text={clock.hours}
              direction={direction}
              animate={animate}
              reserve={HOUR_RESERVE}
              className="justify-items-end"
            />
            <span>:</span>
            <RollText text={clock.minutes} direction={direction} animate={animate} />
            {hour12 ? (
              <RollText
                text={clock.period}
                direction={direction}
                animate={animate}
                reserve={PERIOD_RESERVE}
                className="ml-1 text-[11px] font-normal text-muted-foreground"
              />
            ) : null}
          </span>
          <span className="flex min-w-0 items-baseline gap-1 text-[11px] leading-[14px] text-muted-foreground">
            <RollText text={clock.weekday} direction={direction} animate={animate} />
            {clock.offset ? <span className="truncate @max-[480px]:hidden">· {clock.offset}</span> : null}
          </span>
        </div>
      </div>
      <div aria-hidden="true" className="relative">
        {model?.midnights.map((midnight) => (
          <div
            key={midnight.at}
            className="pointer-events-none absolute inset-y-0 w-0"
            style={{ left: `${(midnight.at * 100).toFixed(3)}%` }}
          >
            <div className="absolute inset-y-0 left-0 w-px bg-border" />
            <span
              className={cn(
                "absolute top-[2px] h-3 rounded-[3px] border border-border bg-card px-[3px] font-mono text-[9.5px] leading-[10px] whitespace-nowrap text-muted-foreground",
                midnight.at > 0.86 ? "right-[3px]" : "left-[3px]",
              )}
            >
              {midnight.weekday}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The accent chip with the total overlap; the duration rolls when it changes and the chip pops on the entry light. */
function OverlapChip({
  minutes,
  animate,
  ref,
}: {
  minutes: number;
  animate: boolean;
  ref: React.Ref<HTMLSpanElement>;
}) {
  const [shown, setShown] = React.useState({ minutes, direction: 1 });
  if (shown.minutes !== minutes) setShown({ minutes, direction: minutes > shown.minutes ? 1 : -1 });
  return (
    <span
      ref={ref}
      className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-lumesec/30 bg-lumesec/10 px-2 text-[12px] leading-4 font-medium text-lumesec"
    >
      <span className="size-1.5 rounded-[1px] bg-lumesec" />
      <RollText
        text={formatSpan(minutes)}
        direction={shown.direction}
        animate={animate}
        className="font-mono tabular-nums"
      />
      <span>overlap</span>
    </span>
  );
}

/* Constants ------------------------------------------------------------------------------------------ */

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const WORK_HOURS: readonly [number, number] = [9, 17];
const SLEEP_HOURS: readonly [number, number] = [23, 7];

/** Built-in rows, used only while neither `cities` nor `defaultCities` is set. They share 2 working hours all year. */
const DEMO_CITIES: readonly TimeZoneCity[] = [
  { id: "london", label: "London", timeZone: "Europe/London" },
  { id: "berlin", label: "Berlin", timeZone: "Europe/Berlin" },
  { id: "new-york", label: "New York", timeZone: "America/New_York" },
  { id: "sao-paulo", label: "São Paulo", timeZone: "America/Sao_Paulo" },
];

const HOUR_RESERVE = ["00"] as const;
const PERIOD_RESERVE = ["AM", "PM"] as const;
const CANVAS_OPTIONS = { maxDpr: 2 } as const;

// Geometry in CSS pixels
const ROW_HEIGHT = 44;
/** Centre of the dot lane: the top 14px of a row hold the midnight chips. */
const LANE_CENTER = 28.5;
const DOT_ROWS = 6;
const DOT_SIZE = 2;
/** Room for the burst around the strip on the effects canvas (matches its negative insets). */
const FX_SIDE = 24;
const FX_TOP = 24;

/** Share of lit dots per hour class (sleep, off, work), in ordered-dither order. */
const DENSITY = [0.18, 0.5, 1] as const;
const SLEEP = 0;
const OFF = 1;
const WORK = 2;
const WEEKEND_ALPHA = 0.6;
const UNLIT_ALPHA = 0.42;
const BAND_ALPHA = 0.85;
const REST_GLOW = 0.32;

// Positions on the dot colour ramp: land grey, ink grey, accent, glint.
const TONES = 25;
const TONE_INK = 1 / 3;
const TONE_ACCENT = 2 / 3;
const TONE_GLINT = 1;

const FILL_SECONDS = 0.42;
const DRAIN_SECONDS = 0.3;
const SWEEP_MS = 450;
/** The reveal threshold runs to 1 (0.82 by height + 0.18 jitter); the extra 0.07 is the soft edge. */
const REVEAL_END = 1.07;
const REVEAL_EDGE = 0.07;

const POP_KEYFRAMES: Keyframe[] = [
  { transform: "scale(.8)", easing: "cubic-bezier(.2,.8,.2,1)" },
  { transform: "scale(1.08)", easing: "cubic-bezier(.4,0,.2,1)", offset: 0.55 },
  { transform: "scale(1)" },
];

/* Model ---------------------------------------------------------------------------------------------- */

/** A city ready to draw: its zone is valid (unknown zones read as UTC). */
interface CityRow {
  readonly id: string;
  readonly label: string;
  readonly zone: string;
  readonly invalid: boolean;
}

interface PresenceItem {
  readonly row: CityRow;
  /** Added after the first render: grows in. */
  readonly entering: boolean;
  /** Removed: collapses, then leaves the list. */
  readonly leaving: boolean;
}

interface Presence {
  /** The resolved rows the items were merged from. */
  readonly source: readonly CityRow[];
  readonly items: readonly PresenceItem[];
}

/** A span of the window as fractions, 0 at the window start and 1 at its end. */
interface Interval {
  readonly from: number;
  readonly to: number;
}

/** One local hour of a row; partial at the window edges and in zones with half-hour offsets. */
interface Cell extends Interval {
  readonly kind: typeof SLEEP | typeof OFF | typeof WORK;
  readonly weekend: boolean;
}

interface RowModel {
  readonly cells: readonly Cell[];
  /** Local midnights inside the window, with the weekday that starts there. */
  readonly midnights: readonly { readonly at: number; readonly weekday: string }[];
  /** Working hours, merged into continuous spans. */
  readonly work: readonly Interval[];
  /** Varies the reveal jitter between rows. */
  readonly seed: number;
}

interface HourRules {
  workFrom: number;
  workTo: number;
  sleepFrom: number;
  sleepTo: number;
}

interface Overlap {
  readonly intervals: readonly Interval[];
  /** Absolute times of the intervals, in epoch ms. */
  readonly ranges: readonly { readonly from: number; readonly to: number }[];
  readonly minutes: number;
  /** Changes when the band changes; a new key fills the band again. */
  readonly key: string;
}

type OverlapStatus = "idle" | "single" | "band" | "none";

interface ClockText {
  hours: string;
  minutes: string;
  period: string;
  weekday: string;
  offset: string;
}

function resolveCities(list: readonly TimeZoneCity[]): CityRow[] {
  const seen = new Set<string>();
  const rows: CityRow[] = [];
  for (const city of list) {
    if (!city || typeof city.id !== "string" || seen.has(city.id)) continue;
    seen.add(city.id);
    const valid = isValidTimeZone(city.timeZone);
    rows.push({
      id: city.id,
      label: String(city.label ?? city.id),
      zone: valid ? city.timeZone : "UTC",
      invalid: !valid,
    });
  }
  return rows;
}

/** New rows in their order, with removed rows kept in place (collapsing) unless motion is reduced. */
function mergePresence(previous: readonly PresenceItem[], next: readonly CityRow[], reduced: boolean): PresenceItem[] {
  const before = new Map(previous.map((item) => [item.row.id, item]));
  const nextIds = new Set(next.map((row) => row.id));
  const items: PresenceItem[] = next.map((row) => ({
    row,
    entering: before.get(row.id)?.entering ?? true,
    leaving: false,
  }));
  if (reduced) return items;
  previous.forEach((item, i) => {
    if (nextIds.has(item.row.id)) return;
    // insert after the nearest earlier row that is still on screen
    let anchor = -1;
    for (let j = i - 1; j >= 0 && anchor < 0; j--)
      anchor = items.findIndex((candidate) => candidate.row.id === previous[j].row.id);
    items.splice(anchor + 1, 0, { row: item.row, entering: item.entering, leaving: true });
  });
  return items;
}

/** The next local midnight of the reference zone: the window is one local day (23 to 25 hours around DST changes). */
function windowEnd(zone: string, start: number) {
  const end = startOfZonedDay(zone, start + 26 * HOUR);
  return end > start ? end : start + DAY;
}

function inHours(hour: number, from: number, to: number) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

function buildRowModel(
  row: CityRow,
  start: number,
  end: number,
  rules: HourRules,
  locale: string | undefined,
): RowModel {
  const span = end - start;
  const cells: Cell[] = [];
  const midnights: { at: number; weekday: string }[] = [];
  const work: Interval[] = [];
  const parts: ZonedParts = { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0, weekday: 4 };
  let time = start;
  let day = -1;
  // a local day has at most 26 hour cells, plus the partial ones at the edges
  for (let guard = 0; time < end && guard < 32; guard++) {
    zonedParts(row.zone, time, parts);
    let next = time - (parts.minute * 60 + parts.second) * 1000 + HOUR;
    if (next <= time) next = time + HOUR;
    if (next > end) next = end;
    const from = (time - start) / span;
    const to = (next - start) / span;
    const kind = inHours(parts.hour, rules.workFrom, rules.workTo)
      ? WORK
      : inHours(parts.hour, rules.sleepFrom, rules.sleepTo)
        ? SLEEP
        : OFF;
    cells.push({ from, to, kind, weekend: parts.weekday === 0 || parts.weekday === 6 });
    if (day !== -1 && parts.day !== day) midnights.push({ at: from, weekday: formatWeekday(row.zone, time, locale) });
    day = parts.day;
    if (kind === WORK) {
      const last = work[work.length - 1];
      if (last && Math.abs(last.to - from) < 1e-9) work[work.length - 1] = { from: last.from, to };
      else work.push({ from, to });
    }
    time = next;
  }
  return { cells, midnights, work, seed: stringHash(row.id) % 997 };
}

function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const result: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const from = Math.max(a[i].from, b[j].from);
    const to = Math.min(a[i].to, b[j].to);
    if (to - from > 1e-9) result.push({ from, to });
    if (a[i].to < b[j].to) i++;
    else j++;
  }
  return result;
}

const NO_OVERLAP: Overlap = { intervals: [], ranges: [], minutes: 0, key: "" };

/** Hours when every city is at work. One city has nothing to compare, so it has no band. */
function computeOverlap(
  rows: readonly CityRow[],
  models: ReadonlyMap<string, RowModel>,
  start: number | null,
  end: number | null,
): Overlap {
  if (start === null || end === null || rows.length < 2) return NO_OVERLAP;
  const span = end - start;
  let band: readonly Interval[] | null = null;
  for (const row of rows) {
    const model = models.get(row.id);
    if (!model) return NO_OVERLAP;
    band = band === null ? model.work : intersect(band, model.work);
  }
  const intervals = (band ?? []).filter((interval) => (interval.to - interval.from) * span >= MINUTE - 1);
  if (!intervals.length) return { ...NO_OVERLAP, key: `none@${start}` };
  const ranges = intervals.map((interval) => ({
    from: Math.round((start + interval.from * span) / MINUTE) * MINUTE,
    to: Math.round((start + interval.to * span) / MINUTE) * MINUTE,
  }));
  const minutes = ranges.reduce((total, range) => total + (range.to - range.from) / MINUTE, 0);
  const key = ranges.map((range) => `${range.from}-${range.to}`).join(",");
  return { intervals, ranges, minutes, key };
}

function intervalsContain(intervals: readonly Interval[], at: number) {
  for (const interval of intervals) if (at >= interval.from && at < interval.to) return true;
  return false;
}

const pad2 = (value: number) => String(value).padStart(2, "0");

function hourLabel(hour: number, hour12: boolean) {
  if (!hour12) return pad2(hour);
  return `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;
}

/** Axis labels every 3 hours of the reference city's local time. */
function windowTicks(zone: string, start: number, end: number, hour12: boolean) {
  const span = end - start;
  const ticks: { at: number; text: string }[] = [];
  for (let offset = 0; offset < span - HOUR; offset += 3 * HOUR) {
    ticks.push({ at: offset / span, text: hourLabel(zonedParts(zone, start + offset).hour, hour12) });
  }
  return ticks;
}

/** The same labels before the clock is read, so the axis does not shift after mount. */
function genericTicks(hour12: boolean) {
  return Array.from({ length: 8 }, (_, i) => ({ at: i / 8, text: hourLabel(i * 3, hour12) }));
}

function clockText(zone: string, time: number | null, hour12: boolean, locale: string | undefined): ClockText {
  if (time === null) return { hours: "--", minutes: "--", period: "", weekday: "–", offset: "" };
  const parts = zonedParts(zone, time);
  return {
    hours: hour12 ? String(parts.hour % 12 || 12) : pad2(parts.hour),
    minutes: pad2(parts.minute),
    period: parts.hour < 12 ? "AM" : "PM",
    weekday: formatWeekday(zone, time, locale),
    offset: formatUtcOffset(utcOffsetMinutes(zone, time)),
  };
}

/** '2 h', '1 h 30 min', '45 min'. */
function formatSpan(minutes: number) {
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** The time a key moves by (ms), a window edge, or null for keys the cursor ignores. */
function keyMove(key: string, shift: boolean, stepMs: number): number | "start" | "end" | null {
  const unit = shift ? HOUR : stepMs;
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return unit;
    case "ArrowLeft":
    case "ArrowDown":
      return -unit;
    case "PageUp":
      return 3 * HOUR;
    case "PageDown":
      return -3 * HOUR;
    case "Home":
      return "start";
    case "End":
      return "end";
    default:
      return null;
  }
}

function popChip(element: HTMLElement | null) {
  if (element && typeof element.animate === "function") element.animate(POP_KEYFRAMES, { duration: 420 });
}

/* Motion state and drawing --------------------------------------------------------------------------- */

interface BandState {
  current: readonly Interval[];
  previous: readonly Interval[];
  key: string;
  /** Fill progress of the current band, 0 to 1 over FILL_SECONDS. */
  fill: number;
  /** Drain progress of the previous band, 0 to 1 over DRAIN_SECONDS. */
  drain: number;
  /** How far the previous band had filled when it was replaced. */
  previousFill: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  /** How far toward the glint this spark is tinted. */
  mix: number;
}

/** Everything the animation loop mutates. Lives in a ref, never in React state. */
interface Engine {
  /** False until the first cursor arrives; the line stays hidden until then. */
  ready: boolean;
  dragging: boolean;
  focused: boolean;
  /** Cursor line position as a window fraction, on a spring toward `target`. */
  cursor: Spring & { target: number };
  /** The latest committed cursor time, so key presses add up before React re-renders. */
  latest: number | null;
  highlights: Map<string, Spring>;
  /** Strength of the lit column under the cursor. */
  glow: Spring;
  band: BandState;
  inBand: boolean;
  /** Start of the light running down the band, in ms, or -1. */
  sweepStart: number;
  sparksFired: boolean;
  sparks: Spark[];
  fxDirty: boolean;
  /** Rows grow or collapse until this time (ms). */
  animatingUntil: number;
  tops: number[];
  heights: number[];
  /** Top of the rows below the axis, in the area's coordinates. */
  rowsOffset: number;
  palette: GeoPalette | null;
  ink: GeoInk | null;
  batch: DotBatch | null;
}

function createEngine(): Engine {
  return {
    ready: false,
    dragging: false,
    focused: false,
    cursor: { position: 0, velocity: 0, target: 0 },
    latest: null,
    highlights: new Map(),
    glow: { position: REST_GLOW, velocity: 0 },
    band: { current: [], previous: [], key: "", fill: 1, drain: 1, previousFill: 1 },
    inBand: false,
    sweepStart: -1,
    sparksFired: true,
    sparks: [],
    fxDirty: false,
    animatingUntil: 0,
    tops: [],
    heights: [],
    rowsOffset: 0,
    palette: null,
    ink: null,
    batch: null,
  };
}

const settled = (spring: Spring, target: number) =>
  Math.abs(spring.position - target) < 0.0004 && Math.abs(spring.velocity) < 0.002;

interface Scene {
  items: readonly PresenceItem[];
  models: ReadonlyMap<string, RowModel>;
  span: number;
}

/** Top of the first row and the height of all rows, in the strip canvas's coordinates. */
function rowsExtent(engine: Engine) {
  const count = engine.tops.length;
  if (!count) return { top: 0, height: 0 };
  const top = engine.tops[0];
  return { top, height: Math.max(1, engine.tops[count - 1] + engine.heights[count - 1] - top) };
}

/** 0 to 1: how far a dot at `threshold` is revealed by a front at `level`. */
const reveal = (level: number, threshold: number) => clamp((level - threshold) / REVEAL_EDGE, 0, 1);

/** The dot strip: one block of dots per local hour and row, the overlap band, and the lit column under the cursor. */
function drawStrip(
  surface: CanvasSurface,
  batch: DotBatch,
  ink: GeoInk,
  scene: Scene,
  engine: Engine,
  now: number,
  reduced: boolean,
) {
  const { context, width, height, dpr } = surface;
  context.clearRect(0, 0, width, height);
  const { items, models, span } = scene;
  if (!items.length || !width || !engine.ready) return;

  const hourWidth = (width * HOUR) / span;
  // narrow strips use a 3px pitch so every hour keeps at least two columns
  const pitch = hourWidth >= 15 ? 4 : 3;
  const blockHeight = (DOT_ROWS - 1) * pitch + DOT_SIZE;
  const extent = rowsExtent(engine);
  const band = engine.band;
  const fillLevel = easeOutCubic(band.fill) * REVEAL_END;
  const drainLevel = band.drain * REVEAL_END;
  const previousLevel = easeOutCubic(band.previousFill) * REVEAL_END;
  const seconds = now / 1000;
  const sweepSince = engine.sweepStart >= 0 ? now - engine.sweepStart : -1;
  const sweeping = sweepSince >= 0 && sweepSince < SWEEP_MS + 150;
  const sweepFront = (sweepSince / SWEEP_MS) * (extent.height + 24) - 12;
  const sweepFade = sweeping ? 1 - smoothFade(sweepSince, SWEEP_MS, SWEEP_MS + 150) : 0;
  const glow = engine.glow.position;

  // a faint wash and two hairlines frame the band, so it reads as one span across every row
  const washes: [readonly Interval[], number][] = [
    [band.current, easeOutCubic(band.fill)],
    [band.previous, (1 - band.drain) * easeOutCubic(band.previousFill)],
  ];
  for (const [intervals, strength] of washes) {
    if (strength <= 0.01) continue;
    for (const interval of intervals) {
      const x0 = snap(interval.from * width, dpr);
      const x1 = snap(interval.to * width, dpr);
      context.fillStyle = rgba(ink.accent, 0.07 * strength);
      context.fillRect(x0, extent.top, x1 - x0, extent.height);
      context.fillStyle = rgba(ink.accent, 0.32 * strength);
      context.fillRect(x0, extent.top, 1, extent.height);
      context.fillRect(x1 - 1, extent.top, 1, extent.height);
    }
  }

  items.forEach((item, i) => {
    const model = models.get(item.row.id);
    const rowTop = engine.tops[i];
    const rowHeight = engine.heights[i];
    if (!model || !(rowHeight > 1)) return;
    const rowBottom = rowTop + rowHeight;
    const blockTop = snap(rowTop + LANE_CENTER - blockHeight / 2, dpr);
    const active = !item.leaving;
    const highlightX = (engine.highlights.get(item.row.id)?.position ?? engine.cursor.position) * width;

    for (const cell of model.cells) {
      const cellLeft = cell.from * width;
      const cellWidth = (cell.to - cell.from) * width;
      const columns = Math.floor((cellWidth - pitch + DOT_SIZE) / pitch);
      if (columns < 1) continue;
      const left = cellLeft + (cellWidth - ((columns - 1) * pitch + DOT_SIZE)) / 2;
      const level = DENSITY[cell.kind];
      const baseAlpha = cell.weekend ? WEEKEND_ALPHA : 1;

      for (let c = 0; c < columns; c++) {
        const x = snap(left + c * pitch, dpr);
        const column = Math.round(x / pitch);
        const center = (x + DOT_SIZE / 2) / width;
        const inCurrent = active && intervalsContain(band.current, center);
        const inPrevious = active && intervalsContain(band.previous, center);
        const dx = (x + DOT_SIZE / 2 - highlightX) / (pitch * 1.1);
        const highlight = glow * Math.exp(-dx * dx);
        const shimmer = reduced ? 1 : 0.75 + 0.25 * Math.sin(seconds * 1.4 + x * 0.05);

        for (let r = 0; r < DOT_ROWS; r++) {
          const y = blockTop + r * pitch;
          if (y + DOT_SIZE > rowBottom) break;
          const lit = level > bayer4(r, column);
          let tone = lit ? TONE_INK : 0;
          let alpha = (lit ? 1 : UNLIT_ALPHA) * baseAlpha;

          if (lit && (inCurrent || inPrevious)) {
            const jitter = hash(column * 31 + r * 7 + model.seed);
            const threshold = ((y - extent.top) / extent.height) * 0.82 + jitter * 0.18;
            const kept = inPrevious ? Math.min(1 - reveal(drainLevel, threshold), reveal(previousLevel, threshold)) : 0;
            const amount = inCurrent
              ? inPrevious
                ? Math.max(kept, reveal(fillLevel, threshold))
                : reveal(fillLevel, threshold)
              : kept;
            if (amount > 0) {
              tone = lerp(tone, TONE_ACCENT, amount);
              alpha = lerp(alpha, BAND_ALPHA * shimmer, amount);
              if (sweeping && inCurrent) {
                // the entry light: an uneven front running down through the band, glint behind a short tail
                const front = ringFront(y - extent.top, sweepFront, 9, jitter, 6);
                const tail = y - extent.top < sweepFront ? Math.exp(-(sweepFront - (y - extent.top)) / 36) * 0.35 : 0;
                const light = Math.min(1, front + tail) * sweepFade * amount;
                tone = lerp(tone, TONE_GLINT, light);
                alpha = lerp(alpha, 1, light);
              }
            }
          }

          if (highlight > 0.01) {
            tone = lerp(tone, tone >= TONE_ACCENT - 0.01 ? TONE_GLINT : TONE_ACCENT, highlight * 0.85);
            alpha = lerp(alpha, 1, highlight * (lit ? 0.8 : 0.4));
          }
          batch.add(x, y, DOT_SIZE, tone, alpha);
        }
      }
    }
  });
  batch.flush(context);
  context.globalAlpha = 1;
}

/** 0 before `from`, 1 after `to`, linear between. */
const smoothFade = (value: number, from: number, to: number) => clamp((value - from) / (to - from), 0, 1);

/** The light bar of the entry sweep and the burst at the band's foot, on the canvas that reaches past the card. */
function drawEffects(
  surface: CanvasSurface,
  ink: GeoInk,
  engine: Engine,
  stripWidth: number,
  now: number,
  delta: number,
) {
  const { context, width, height } = surface;
  const extent = rowsExtent(engine);
  const band = engine.band.current;
  const sweepSince = engine.sweepStart >= 0 ? now - engine.sweepStart : -1;
  const sweeping = sweepSince >= 0 && sweepSince < SWEEP_MS && band.length > 0;

  if (sweepSince >= SWEEP_MS && !engine.sparksFired) {
    engine.sparksFired = true;
    const y = FX_TOP + engine.rowsOffset + extent.top + extent.height;
    for (const interval of band) {
      const x = FX_SIDE + ((interval.from + interval.to) / 2) * stripWidth;
      engine.sparks.push(...footSparks(x, y, (interval.to - interval.from) * stripWidth));
    }
  }

  if (!sweeping && !engine.sparks.length) {
    if (engine.fxDirty) {
      context.clearRect(0, 0, width, height);
      engine.fxDirty = false;
    }
    return false;
  }
  engine.fxDirty = true;
  context.clearRect(0, 0, width, height);

  if (sweeping) {
    const k = sweepSince / SWEEP_MS;
    const y = FX_TOP + engine.rowsOffset + extent.top + k * extent.height;
    const alpha = 0.6 * (1 - k * 0.5);
    for (const interval of band) {
      const x0 = FX_SIDE + interval.from * stripWidth;
      const x1 = FX_SIDE + interval.to * stripWidth;
      const beam = context.createLinearGradient(0, y - 18, 0, y + 6);
      beam.addColorStop(0, rgba(ink.accent, 0));
      beam.addColorStop(0.7, rgba(ink.accent, alpha * 0.35));
      beam.addColorStop(0.92, rgba(ink.glint, alpha));
      beam.addColorStop(1, rgba(ink.glint, 0));
      context.fillStyle = beam;
      context.fillRect(x0, y - 18, x1 - x0, 24);
    }
  }

  const drag = Math.exp(-delta * 3.4);
  const alive: Spark[] = [];
  for (const spark of engine.sparks) {
    spark.age += delta;
    if (spark.age >= spark.life) continue;
    spark.vx *= drag;
    spark.vy = spark.vy * drag + 220 * delta;
    spark.x += spark.vx * delta;
    spark.y += spark.vy * delta;
    const life = 1 - spark.age / spark.life;
    const hot = Math.max(0, 1 - spark.age / 0.12);
    const color = mixRgb(ink.accent, ink.glint, Math.min(1, spark.mix * 0.6 + hot));
    context.globalAlpha = Math.pow(life, 1.3);
    context.fillStyle = `rgb(${color[0] | 0},${color[1] | 0},${color[2] | 0})`;
    context.fillRect(Math.round(spark.x * 2) / 2, Math.round(spark.y * 2) / 2, spark.size, spark.size);
    alive.push(spark);
  }
  context.globalAlpha = 1;
  engine.sparks = alive;
  return alive.length > 0 || sweeping;
}

/** Pixel sparks thrown out of the band's foot when the entry light reaches the last row: down and out past the card. */
function footSparks(x: number, y: number, spread: number): Spark[] {
  return Array.from({ length: 24 }, () => {
    const angle = Math.PI / 2 + (Math.random() - 0.5) * 2.4;
    const speed = 90 + Math.random() * 230;
    return {
      x: x + (Math.random() - 0.5) * Math.max(4, spread * 0.8),
      y: y - Math.random() * 4,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      age: 0,
      life: 0.4 + Math.random() * 0.55,
      size: Math.random() < 0.3 ? 2.5 : 1.5,
      mix: Math.random(),
    };
  });
}
