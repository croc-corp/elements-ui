"use client";

import * as React from "react";

import { fillSquare, localPoint, useCanvas, type CanvasSurface } from "@/lib/lumesec/canvas";
import { usePalette } from "@/lib/lumesec/color";
import {
  createDotBatch,
  createProjection,
  createScreenPoint,
  easeInCubic,
  GEO_TOKENS,
  geoInk,
  MAP_LAT_RANGE,
  mapLattice,
  nearestIndex,
  projectionAspect,
  projectionOutlineSvgPath,
  ringFront,
  wrapLongitude,
  type DotBatch,
  type DotLattice,
  type GeoInk,
  type MapProjection,
} from "@/lib/lumesec/geo";
import { countryAt } from "@/lib/lumesec/geo-countries";
import {
  createRandom,
  DEMO_CITIES,
  formatAgo,
  formatLatLon,
  formatNumber,
  pickWeighted,
  scatterAround,
  useNow,
} from "@/lib/lumesec/geo-data";
import { clamp, easeOutCubic, rgba, smoothstep } from "@/lib/lumesec/math";
import {
  prefersReducedMotion,
  settleSpring,
  useAnimationLoop,
  useInView,
  useInterval,
  useLazyRef,
  useReducedMotion,
  type Spring,
} from "@/lib/lumesec/motion";
import { RollText } from "@/lib/lumesec/roll-text";
import { Sparks, type SparkOptions } from "@/lib/lumesec/sparks";
import { cn } from "@/lib/utils";

/** One visit: where and when someone opened a page, and what the feed shows for it. */
export interface VisitorEvent {
  /** Unique id. A new id drops onto the map; an id that is already shown is ignored. */
  readonly id: string;
  /** Latitude in degrees, −90 to 90. */
  readonly lat: number;
  /** Longitude in degrees, −180 to 180. */
  readonly lon: number;
  /** Place shown in the feed. Without it the feed shows the country at the point, or the coordinates. */
  readonly city?: string;
  /** What was visited, such as a path (`/pricing`). Shown in mono under the place; without it, the coordinates. */
  readonly label?: string;
  /** When the visit happened, in epoch ms. */
  readonly time: number;
}

/** Map projection of the visitor map. */
export type GeoVisitorsProjection = "equalEarth" | "equirectangular";

/** Imperative actions, exposed through `ref`. */
export interface GeoVisitorsHandle {
  /**
   * Adds a visit. It drops onto the map, adds to the afterglow and enters the feed like any new visit. Ids that are
   * already shown are ignored.
   */
  push(event: VisitorEvent): void;
}

/** Props of `GeoVisitors`. Other `div` props go to the root; `ref` receives the `GeoVisitorsHandle`. */
export interface GeoVisitorsProps extends Omit<React.ComponentProps<"div">, "ref" | "title"> {
  /**
   * Your visits. Ids that appear after the first render drop onto the map; ids that leave the list leave the map and
   * the feed. Without it a seeded demo stream runs. An empty array shows an empty feed.
   */
  events?: readonly VisitorEvent[];
  /** Count shown as online now. Default: the visits of the last five minutes. */
  online?: number;
  /** Seconds until a visit's afterglow has faded. At least 5. */
  decay?: number;
  /** Rows in the feed, 1 to 24. */
  maxFeed?: number;
  /** Map projection. */
  projection?: GeoVisitorsProjection;
  /** Header text. */
  title?: React.ReactNode;
  /** Runs the demo stream while `events` is not given. The stream pauses while the panel is off screen. */
  live?: boolean;
  /** Called when a feed row is activated with a click, Enter or Space. */
  onEventClick?: (event: VisitorEvent) => void;
  /** Exposes `push(event)`. */
  ref?: React.Ref<GeoVisitorsHandle>;
}

/**
 * A live map of visits with a feed beside it and an online-now count. Each visit falls onto the map as a short
 * streak, lands with an uneven ring of lit land dots and a few sparks that can fly past the map's edge, and its row
 * slides into the feed. Visits leave an afterglow on the land dots that fades over `decay` seconds, so busy regions
 * build up a soft density. Pointing at a row marks its point; pointing at the map marks the nearest visit's row.
 *
 * Without `events` a seeded demo stream runs. Pass your visits as `events` (new ids drop in), or add them one by one
 * with `push()` through `ref`.
 *
 * @example
 * <GeoVisitors events={visits} onEventClick={(visit) => openSession(visit.id)} />
 */
export function GeoVisitors(props: GeoVisitorsProps) {
  // demo data and your data are separate timelines: switching between them starts the panel over
  return <VisitorsPanel key={props.events === undefined ? "demo" : "data"} {...props} />;
}

function VisitorsPanel({
  events,
  online,
  decay: decayProp = 300,
  maxFeed: maxFeedProp = 6,
  projection = "equalEarth",
  title = "Visitors",
  live = true,
  onEventClick,
  ref,
  className,
  ...props
}: GeoVisitorsProps) {
  const demo = events === undefined;
  const decay = Number.isFinite(decayProp) ? Math.max(5, decayProp) : 300;
  const maxFeed = Number.isFinite(maxFeedProp) ? clamp(Math.round(maxFeedProp), 1, 24) : 6;
  const reducedMotion = useReducedMotion();

  // The first timeline: the seeded demo history (times relative to 0) or your events. Server and client agree on it.
  const [initial] = React.useState(() => {
    const visits = demo ? demoHistory() : validEvents(events ?? []);
    return { visits, reference: demo ? 0 : newestTime(visits) };
  });

  const [feed, setFeed] = React.useState<FeedState>(() => ({ limit: maxFeed, rows: newestRows(initial.visits, maxFeed) }));
  if (feed.limit !== maxFeed) setFeed(resizeFeed(feed, maxFeed));

  // The clock starts after mount, so the server and the first client render show the same relative times.
  const [clock, setClock] = React.useState<number | null>(null);
  const tick = useNow(15_000, clock !== null);
  const now = clock === null ? initial.reference : Math.max(clock, tick ?? clock);

  const [recent, setRecent] = React.useState(() => countRecent(initial.visits, initial.reference));
  const count = online !== undefined && Number.isFinite(online) ? Math.max(0, Math.round(online)) : recent;
  const [summary, setSummary] = React.useState("");

  const [rowActive, setRowActive] = React.useState<string | null>(null);
  const [mapHover, setMapHover] = React.useState<MapHover | null>(null);
  const activeId = rowActive ?? mapHover?.event.id ?? null;

  const rootRef = React.useRef<HTMLDivElement>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const baseRef = React.useRef<HTMLCanvasElement>(null);
  const heatRef = React.useRef<HTMLCanvasElement>(null);
  const effectsRef = React.useRef<HTMLCanvasElement>(null);
  // the map and the feed queue are created on first use (effects, handlers and the loop), never during a render
  const mapRef = useLazyRef(() => new VisitorMap());
  const queueRef = useLazyRef(createQueue);
  /** Ids of `events` the map already knows, to tell new ids from removed ones. */
  const knownIds = React.useRef<Set<string>>(new Set());
  const feedLimit = React.useRef(maxFeed);
  const streamCount = React.useRef(0);
  const inView = useInView(rootRef, "120px");
  /** Whether new visits may drop: only while the map is on screen and the page is visible, else they would pile up. */
  const onScreen = React.useRef(false);

  /**
   * The feed queue, which writes the rows into state and reads the latest row limit. A function declaration rather than
   * an inline arrow, so the React Compiler does not treat `feedLimit` as frozen by the hook call.
   */
  function createQueue() {
    return createFeedQueue(
      (change) =>
        setFeed((state) =>
          change.kind === "add" ? insertRow(state, change.event, prefersReducedMotion()) : replaceRows(state, change.events),
        ),
      () => feedLimit.current,
    );
  }

  /** Where the effects layer sits relative to the map, in CSS px (layout offsets are unaffected by a scaled preview). */
  function measureEffects() {
    const map = baseRef.current;
    const layer = effectsRef.current;
    if (map && layer) mapRef.current.setEffectsOffset(map.offsetLeft - layer.offsetLeft, map.offsetTop - layer.offsetTop);
  }

  const loop = useAnimationLoop(rootRef, step);
  const palette = usePalette(rootRef, GEO_TOKENS, applyTheme);
  const base = useCanvas(baseRef, (surface) => {
    mapRef.current.layout(surface.width, surface.height, surface.dpr);
    measureEffects();
    loop.kick();
  }, MAP_CANVAS);
  const heat = useCanvas(heatRef, () => {
    mapRef.current.invalidate();
    loop.kick();
  }, MAP_CANVAS);
  const effects = useCanvas(effectsRef, () => {
    measureEffects();
    loop.kick();
  }, MAP_CANVAS);

  function step(_time: number, delta: number) {
    return mapRef.current.step(base.current, heat.current, effects.current, delta);
  }

  function applyTheme() {
    const colors = palette.current;
    if (!colors) return;
    mapRef.current.setInk(geoInk(colors));
    loop.kick();
  }

  React.useEffect(() => {
    onScreen.current = inView;
  }, [inView]);

  React.useEffect(() => {
    feedLimit.current = maxFeed;
    if (mapRef.current.configure(projection, decay)) loop.kick();
  }, [mapRef, projection, decay, loop, maxFeed]);

  // A landed visit queues its row; the queue changes at most one row per 160 ms.
  React.useEffect(() => {
    const map = mapRef.current;
    const queue = queueRef.current;
    map.onLand = (event) => queue.add(event);
    return () => queue.clear();
  }, [mapRef, queueRef]);

  // Start the clock: the demo history moves to now, your events are loaded as they are. No drops for these.
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      const start = Date.now();
      const shift = demo ? start : 0;
      const visits = shift ? initial.visits.map((visit) => ({ ...visit, time: visit.time + shift })) : initial.visits;
      const map = mapRef.current;
      map.addVisits(visits, { animate: false, announce: false }, start);
      knownIds.current = new Set(visits.map((visit) => visit.id));
      if (shift) setFeed((state) => shiftRows(state, shift));
      setRecent(map.countRecent(start));
      setClock(start);
      loop.kick();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [demo, initial, mapRef, loop]);

  // Your events: new ids drop in, removed ids leave the map and the feed.
  React.useEffect(() => {
    if (demo || clock === null) return;
    const list = validEvents(events ?? []);
    const ids = new Set(list.map((event) => event.id));
    const known = knownIds.current;
    knownIds.current = ids;
    const removed = new Set([...known].filter((id) => !ids.has(id)));
    const added = list.filter((event) => !known.has(event.id));
    const map = mapRef.current;
    if (removed.size > 0) {
      map.removeVisits(removed);
      queueRef.current.replace(map.newest(maxFeed), removed);
    }
    if (added.length > 0) map.addVisits(added, { animate: canDrop(onScreen.current), announce: true }, Date.now());
    loop.kick();
  }, [demo, clock, events, mapRef, queueRef, loop, maxFeed]);

  // The demo stream: a visit every 0.6 to 2.2 s, weighted by city, while the panel is on screen.
  React.useEffect(() => {
    if (!demo || !live || !inView || clock === null) return;
    const random = createRandom(Date.now());
    let timer = 0;
    const next = () => {
      timer = window.setTimeout(() => {
        const visit = demoVisit(random, Date.now(), `v${streamCount.current++}`);
        mapRef.current.addVisits([visit], { animate: canDrop(onScreen.current), announce: true }, visit.time);
        loop.kick();
        next();
      }, 600 + random() * 1600);
    };
    next();
    return () => window.clearTimeout(timer);
  }, [demo, live, inView, clock, mapRef, loop]);

  // Rows mark their point: a ping and a lit ring, with the rest of the afterglow dimmed. The map hover only marks.
  React.useEffect(() => {
    mapRef.current.setActive(activeId, rowActive !== null);
    loop.kick();
  }, [activeId, rowActive, mapRef, loop]);

  // The afterglow fades in steps of 250 ms; the online count follows.
  useInterval(
    () => {
      const map = mapRef.current;
      const time = Date.now();
      map.tick(time);
      setRecent(map.countRecent(time));
      loop.kick();
    },
    HEAT_TICK_MS,
    inView && clock !== null,
  );

  // One polite summary every 15 s instead of an announcement per visit, and none while the panel is off screen.
  useInterval(
    () => {
      const text = mapRef.current.summary(Date.now());
      if (text) setSummary(text);
    },
    SUMMARY_MS,
    inView && clock !== null,
  );

  React.useImperativeHandle(
    ref,
    () => ({
      push(event: VisitorEvent) {
        if (!isValidEvent(event)) return;
        mapRef.current.addVisits([event], { animate: canDrop(onScreen.current), announce: true }, Date.now());
        loop.kick();
      },
    }),
    [mapRef, loop],
  );

  const removeRow = React.useCallback((id: string) => setFeed((state) => dropRow(state, id)), []);
  const pointRow = React.useCallback((id: string | null) => setRowActive(id), []);
  const activateRow = React.useCallback(
    (event: VisitorEvent) => {
      // a click pings the point again, even when the row is already marked
      mapRef.current.ping(event.id);
      loop.kick();
      onEventClick?.(event);
    },
    [mapRef, loop, onEventClick],
  );

  function holdFeed(reason: "pointer" | "focus", held: boolean) {
    queueRef.current.hold(reason, held);
  }

  function handleMapPointer(event: React.PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget;
    // in CSS px of the map, which the gallery may show scaled
    const point = localPoint(box, event.clientX, event.clientY);
    const hit = mapRef.current.nearest(point.x, point.y, HOVER_RADIUS);
    setMapHover((current) => {
      if (!hit) return null;
      if (current && current.event.id === hit.event.id && current.x === hit.x && current.y === hit.y) return current;
      return { event: hit.event, x: hit.x, y: hit.y, width: box.offsetWidth };
    });
  }

  function handleFeedKeyDown(event: React.KeyboardEvent<HTMLOListElement>) {
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("li:not([inert]) button"));
    const index = buttons.findIndex((button) => button === document.activeElement);
    if (index < 0) return;
    const target =
      event.key === "ArrowDown"
        ? Math.min(buttons.length - 1, index + 1)
        : event.key === "ArrowUp"
          ? Math.max(0, index - 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : -1;
    if (target < 0) return;
    event.preventDefault();
    buttons[target].focus();
  }

  const aspect = projectionAspect(projection, MAP_LAT_RANGE);
  const outline = React.useMemo(
    () =>
      projectionOutlineSvgPath(
        createProjection(projection, { width: NOMINAL_WIDTH, height: NOMINAL_WIDTH / aspect, latRange: MAP_LAT_RANGE }),
      ),
    [projection, aspect],
  );
  const streaming = !demo || live;

  return (
    <div
      ref={rootRef}
      data-slot="geo-visitors"
      className={cn(
        "@container w-full max-w-[660px] rounded-[14px] border border-border bg-card text-card-foreground shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)] [-webkit-tap-highlight-color:transparent]",
        className,
      )}
      {...props}
    >
      <div className="flex h-11 items-center gap-3 border-b border-border px-4">
        <div className="min-w-0 truncate text-[13.5px] leading-5 font-medium tracking-[-0.005em] text-foreground">{title}</div>
        <div className="ml-auto flex shrink-0 items-center gap-2 text-[12.5px] leading-5">
          <LiveDot paused={!streaming} />
          <span className="font-mono text-[13px] text-foreground tabular-nums">
            <RollingCount value={count} animate={!reducedMotion} />
          </span>
          <span aria-hidden="true" className="text-muted-foreground">
            online now
          </span>
          <span className="sr-only">{`${formatNumber(count)} online now`}</span>
        </div>
      </div>
      <div className="grid @min-[560px]:grid-cols-[minmax(0,1fr)_216px]">
        <div className="flex flex-col justify-center gap-2 p-3">
          <div
            ref={boxRef}
            className="relative w-full select-none"
            style={{ aspectRatio: aspect }}
            onPointerMove={handleMapPointer}
            onPointerDown={handleMapPointer}
            onPointerLeave={(event) => {
              // a tap keeps its tooltip until the next tap on the map
              if (event.pointerType !== "touch") setMapHover(null);
            }}
          >
            <svg
              aria-hidden="true"
              viewBox={`0 0 ${NOMINAL_WIDTH} ${round2(NOMINAL_WIDTH / aspect)}`}
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 block size-full overflow-visible"
            >
              <path d={outline} vectorEffect="non-scaling-stroke" strokeWidth={1} className="fill-muted/35 stroke-border" />
            </svg>
            <canvas ref={baseRef} aria-hidden="true" className="absolute inset-0 block size-full" />
            <canvas ref={heatRef} aria-hidden="true" className="absolute inset-0 block size-full" />
            <canvas
              ref={effectsRef}
              aria-hidden="true"
              className="pointer-events-none absolute -top-14 -left-4 z-[3] block h-[calc(100%+80px)] w-[calc(100%+32px)] @min-[560px]:-left-10 @min-[560px]:w-[calc(100%+80px)]"
            />
            {mapHover ? <MapTooltip hover={mapHover} now={now} /> : null}
          </div>
          <Legend decay={decay} />
        </div>
        <div className="border-t border-border px-2 py-2 @min-[560px]:border-t-0 @min-[560px]:border-l">
          {feed.rows.length === 0 ? (
            <p
              className="m-0 grid place-items-center text-[12.5px] leading-5 text-muted-foreground"
              style={{ minHeight: feed.limit * ROW_HEIGHT }}
            >
              No visits yet
            </p>
          ) : (
            <ol
              aria-label="Recent visits"
              className="m-0 grid list-none content-start p-0"
              style={{ minHeight: feed.limit * ROW_HEIGHT }}
              onKeyDown={handleFeedKeyDown}
              onPointerEnter={() => holdFeed("pointer", true)}
              onPointerLeave={() => holdFeed("pointer", false)}
              onFocus={() => holdFeed("focus", true)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) holdFeed("focus", false);
              }}
            >
              {feed.rows.map((row) => (
                <FeedRow
                  key={row.event.id}
                  row={row}
                  now={now}
                  active={row.event.id === activeId}
                  onPoint={pointRow}
                  onActivate={activateRow}
                  onExited={removeRow}
                />
              ))}
            </ol>
          )}
        </div>
      </div>
      <div aria-live="polite" className="sr-only">
        {summary}
      </div>
    </div>
  );
}

/* Feed ------------------------------------------------------------------------------------------------ */

interface FeedRowState {
  readonly event: VisitorEvent;
  /** `enter` slides in once, `exit` slides out and then leaves the list. */
  readonly phase: "idle" | "enter" | "exit";
}

interface FeedState {
  readonly limit: number;
  /** Newest first. Leaving rows stay until their animation ends. */
  readonly rows: readonly FeedRowState[];
}

interface FeedRowProps {
  row: FeedRowState;
  now: number;
  active: boolean;
  onPoint: (id: string | null) => void;
  onActivate: (event: VisitorEvent) => void;
  onExited: (id: string) => void;
}

/** One visit in the feed: the place and the relative time, the page in mono below. */
function FeedRow({ row, now, active, onPoint, onActivate, onExited }: FeedRowProps) {
  const itemRef = React.useRef<HTMLLIElement>(null);
  const markerRef = React.useRef<HTMLSpanElement>(null);
  const { event, phase } = row;
  const id = event.id;
  const place = React.useMemo(() => placeName(event), [event]);
  const detail = event.label?.trim() || formatLatLon(event, "decimal", 1);

  React.useLayoutEffect(() => {
    const item = itemRef.current;
    if (phase !== "enter" || !item || typeof item.animate !== "function" || prefersReducedMotion()) return;
    const entering = item.animate(ROW_ENTER_KEYFRAMES, ROW_TIMING);
    const flash = markerRef.current?.animate(MARKER_FLASH_KEYFRAMES, { duration: 2400, easing: "cubic-bezier(.2,.8,.2,1)" });
    return () => {
      entering.cancel();
      flash?.cancel();
    };
  }, [phase]);

  React.useLayoutEffect(() => {
    if (phase !== "exit") return;
    const item = itemRef.current;
    if (!item || typeof item.animate !== "function" || prefersReducedMotion()) {
      onExited(id);
      return;
    }
    const leaving = item.animate(ROW_EXIT_KEYFRAMES, { ...ROW_TIMING, fill: "forwards" });
    leaving.onfinish = () => onExited(id);
    return () => {
      leaving.onfinish = null;
      leaving.cancel();
    };
  }, [phase, id, onExited]);

  const leaving = phase === "exit";
  return (
    <li ref={itemRef} inert={leaving} aria-hidden={leaving || undefined} className="grid grid-rows-[1fr]">
      <div className="min-h-0 overflow-hidden">
        <button
          type="button"
          data-active={active ? "" : undefined}
          onPointerEnter={() => onPoint(id)}
          onPointerLeave={() => onPoint(null)}
          onFocus={() => onPoint(id)}
          onBlur={() => onPoint(null)}
          onClick={() => onActivate(event)}
          className="group/row flex h-[36px] w-full cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-2 text-left font-[inherit] text-inherit outline-none transition-colors duration-150 hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec data-[active]:bg-muted motion-reduce:transition-none"
        >
          <span
            ref={markerRef}
            aria-hidden="true"
            className="size-[5px] shrink-0 self-start rounded-[1px] bg-foreground/20 [margin-top:9px] transition-colors duration-200 group-data-[active]/row:bg-lumesec motion-reduce:transition-none"
          />
          <span className="grid min-w-0 flex-1">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate text-[13px] leading-4 text-foreground">{place}</span>
              <span className="ml-auto shrink-0 text-[11.5px] leading-4 text-muted-foreground tabular-nums">
                <RollText text={formatAgo(event.time, now)} />
              </span>
            </span>
            <span className="truncate font-mono text-[11.5px] leading-[15px] text-muted-foreground">{detail}</span>
          </span>
        </button>
      </div>
    </li>
  );
}

/* Header ---------------------------------------------------------------------------------------------- */

/** The 6 px live dot: it pulses every 1.6 s while visits stream in. */
function LiveDot({ paused }: { paused: boolean }) {
  const dotRef = React.useRef<HTMLSpanElement>(null);
  const haloRef = React.useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();

  React.useEffect(() => {
    const dot = dotRef.current;
    const halo = haloRef.current;
    if (paused || reduced || !dot || !halo || typeof dot.animate !== "function") return;
    const timing: KeyframeAnimationOptions = { duration: 1600, iterations: Infinity, easing: "ease-in-out" };
    const pulse = dot.animate(DOT_PULSE_KEYFRAMES, timing);
    const ring = halo.animate(HALO_KEYFRAMES, { ...timing, easing: "cubic-bezier(.2,.7,.3,1)" });
    return () => {
      pulse.cancel();
      ring.cancel();
    };
  }, [paused, reduced]);

  return (
    <span aria-hidden="true" className="relative grid size-1.5 shrink-0 place-items-center">
      <span ref={haloRef} className={cn("absolute inset-0 rounded-full opacity-0", paused ? "bg-muted-foreground" : "bg-lumesec-success")} />
      <span ref={dotRef} className={cn("size-1.5 rounded-full", paused ? "bg-muted-foreground/60" : "bg-lumesec-success")} />
    </span>
  );
}

/**
 * The online count as mechanical figures: each digit rolls on its own, in the direction of the change, so 214 → 215
 * turns only the last wheel.
 */
function RollingCount({ value, animate }: { value: number; animate: boolean }) {
  const [shown, setShown] = React.useState({ value, direction: 1 });
  if (shown.value !== value) setShown({ value, direction: value >= shown.value ? 1 : -1 });
  const characters = Array.from(formatNumber(value));
  return (
    <span aria-hidden="true" className="inline-flex">
      {characters.map((character, i) => (
        // keyed from the right, so the ones digit keeps its wheel when the number grows a digit
        <RollText key={characters.length - i} text={character} direction={shown.direction} animate={animate} />
      ))}
    </span>
  );
}

/* Map overlays ---------------------------------------------------------------------------------------- */

interface MapHover {
  event: VisitorEvent;
  /** The visit's point on the map in CSS px. */
  x: number;
  y: number;
  /** Map width when it was measured, to keep the tooltip inside. */
  width: number;
}

/** The colour scale of the afterglow and its time window, under the map. */
function Legend({ decay }: { decay: number }) {
  return (
    <div aria-hidden="true" className="flex items-center gap-1.5 font-mono text-[10.5px] leading-3 text-muted-foreground">
      <span className="flex gap-[2px]">
        {LEGEND_SWATCHES.map((swatch) => (
          <span key={swatch} className={cn("size-1 rounded-[0.5px]", swatch)} />
        ))}
      </span>
      <span>Last {formatWindow(decay)}</span>
    </div>
  );
}

/** Place, page and time of the visit under the pointer, above its point. Pointer only: the feed has the same data. */
function MapTooltip({ hover, now }: { hover: MapHover; now: number }) {
  const { event, x, y, width } = hover;
  const align = x < 72 ? "start" : x > width - 72 ? "end" : "center";
  const shiftX = align === "start" ? "-14px" : align === "end" ? "calc(-100% + 14px)" : "-50%";
  const below = y < 46;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 z-[4] w-max max-w-[220px] rounded-md border border-border bg-popover px-2 py-1 text-popover-foreground shadow-[0_6px_16px_-8px_rgb(0_0_0/0.35)]"
      style={{ transform: `translate(${x}px, ${y}px) translate(${shiftX}, ${below ? "12px" : "calc(-100% - 12px)"})` }}
    >
      <div className="flex items-baseline gap-2 text-[12px] leading-4">
        <span className="truncate font-medium">{placeName(event)}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{formatAgo(event.time, now)}</span>
      </div>
      <div className="truncate font-mono text-[11px] leading-[14px] text-muted-foreground">
        {event.label?.trim() || formatLatLon(event, "decimal", 1)}
      </div>
    </div>
  );
}

/* Constants ------------------------------------------------------------------------------------------- */

const MAP_CANVAS = { maxDpr: 2 } as const;
/** Width of the SVG outline's coordinate space. */
const NOMINAL_WIDTH = 1000;
/** Lattice pitch and land dot size in CSS px. */
const PITCH = 4;
const DOT_SIZE = 1.5;
/** A visit warms the land dots within 10 px by exp(−d² / 40). */
const HEAT_RADIUS = 10;
const HEAT_KERNEL = 40;
/** Below `HEAT_MIN` the afterglow is not drawn; from `WARM` a dot is in the accent, from `HOT` at the shine. */
const HEAT_MIN = 0.012;
const WARM = 0.6;
const HOT = 4;
/** How much a marked row dims the rest of the afterglow. */
const FOCUS_DIM = 0.5;
/** The marker and focus levels, 0 to 1, follow a critically damped spring that settles within 0.002. */
const LEVEL_SPRING = { stiffness: 260, damping: 1, epsilon: 0.002, velocityEpsilon: 0.01 };
/** The drop: a streak falls for 260 ms, the ring spreads for 700 ms, the landing dot settles for 1.2 s. */
const FALL_MS = 260;
const RING_MS = 700;
const SETTLE_MS = 1200;
const BLOOM_MS = 420;
const STREAK_DOTS = 6;
const STREAK_HEIGHT = 18;
const STREAK_SIZE = 1.5;
/** At most 30 drops in flight; more visits only add to the afterglow. Drops arriving together fall in turn. */
const MAX_DROPS = 30;
const DROP_STAGGER_MS = 70;
const PING_MS = 900;
/** The marked visit's reticle: 12 squares on a 7.5 px circle. */
const RETICLE_DOTS = 12;
const RETICLE_RADIUS = 7.5;
const PING_GAP_MS = 180;
const REVEAL_MS = 1300;
const REVEAL_BAND = 0.06;
const REVEAL_END = 1 + REVEAL_BAND * 1.5;
const HEAT_TICK_MS = 250;
const SUMMARY_MS = 15_000;
/** Online now counts the visits of the last five minutes. */
const RECENT_MS = 300_000;
/** Pointing at the map finds the nearest of the last 50 visits within 12 px. */
const HOVER_POOL = 50;
const HOVER_RADIUS = 12;
const FEED_STEP_MS = 160;
const ROW_HEIGHT = 36;
/** Visits kept for the afterglow, the count and the hover, at most. */
const MAX_VISITS = 4000;

const LANDING_SPARKS: SparkOptions = {
  angle: -Math.PI / 2,
  spread: 2.4,
  speed: [40, 170],
  gravity: 260,
  life: [0.35, 0.8],
  size: [1.5, 2],
  jitter: 1.5,
};

const ROW_TIMING = { duration: 320, easing: "cubic-bezier(.2,.9,.3,1)" } as const;
const ROW_ENTER_KEYFRAMES: Keyframe[] = [
  { gridTemplateRows: "0fr", opacity: 0, transform: "translateY(-6px)" },
  { gridTemplateRows: "1fr", opacity: 1, transform: "translateY(0)" },
];
const ROW_EXIT_KEYFRAMES: Keyframe[] = [
  { gridTemplateRows: "1fr", opacity: 1, transform: "translateY(0)" },
  { gridTemplateRows: "0fr", opacity: 0, transform: "translateY(-6px)" },
];
/** A new row's marker lands in the accent and cools to the resting grey. */
const MARKER_FLASH_KEYFRAMES: Keyframe[] = [
  { backgroundColor: "var(--lumesec)", boxShadow: "0 0 0 3px color-mix(in srgb, var(--lumesec) 22%, transparent)" },
  { backgroundColor: "var(--lumesec)", boxShadow: "0 0 0 0 transparent", offset: 0.4 },
];
const DOT_PULSE_KEYFRAMES: Keyframe[] = [{ opacity: 1 }, { opacity: 0.4, offset: 0.5 }, { opacity: 1 }];
const HALO_KEYFRAMES: Keyframe[] = [
  { opacity: 0.45, transform: "scale(1)" },
  { opacity: 0, transform: "scale(2.8)", offset: 0.7 },
  { opacity: 0, transform: "scale(2.8)" },
];

/** The afterglow ramp as the legend shows it: land grey → accent → shine. */
const LEGEND_SWATCHES = [
  "bg-[color-mix(in_srgb,var(--muted-foreground)_70%,var(--card))]",
  "bg-[color-mix(in_srgb,var(--muted-foreground)_35%,var(--lumesec))]",
  "bg-lumesec",
  "bg-[color-mix(in_srgb,var(--lumesec)_50%,var(--lumesec-shine))]",
  "bg-lumesec-shine",
] as const;

/** Demo pages with invented weights. */
const DEMO_PAGES = [
  { path: "/", weight: 3 },
  { path: "/pricing", weight: 2.2 },
  { path: "/docs/install", weight: 1.8 },
  { path: "/docs", weight: 1.5 },
  { path: "/blog", weight: 1.2 },
  { path: "/changelog", weight: 0.9 },
  { path: "/docs/api", weight: 0.8 },
  { path: "/signup", weight: 0.7 },
  { path: "/blog/dot-maps", weight: 0.5 },
  { path: "/careers", weight: 0.3 },
] as const;

/* Map engine ------------------------------------------------------------------------------------------ */

interface Visit {
  readonly event: VisitorEvent;
  /** Point on the map in CSS px, updated when the map is resized. */
  x: number;
  y: number;
  /** Whether its afterglow is in: after the drop landed, or at once. */
  landed: boolean;
}

interface Drop {
  readonly visit: Visit;
  /** performance.now() when the streak starts to fall. */
  readonly start: number;
  landed: boolean;
}

interface Ping {
  readonly visit: Visit;
  readonly start: number;
}

interface AddOptions {
  /** Drop new visits onto the map (else their afterglow appears at once). */
  animate: boolean;
  /** Queue their rows for the feed. */
  announce: boolean;
}

/**
 * Everything the map draws, outside React: visits and their points, the afterglow per land dot, drops, pings, the
 * marked visit and the sparks. Three canvases: the land lattice (baked, redrawn only on resize, theme change and the
 * first reveal), the afterglow and landings (redrawn on the 250 ms ticks and while something moves) and a larger
 * effects layer for streaks and sparks.
 */
class VisitorMap {
  /** Called when a visit lands (or arrives without a drop), so its row can enter the feed. */
  onLand: (event: VisitorEvent) => void = () => undefined;

  private kind: GeoVisitorsProjection = "equalEarth";
  private decay = 300;
  private ink: GeoInk | null = null;
  private colors = { land: "", accent: "", shine: "", card: "" };
  private batch: DotBatch | null = null;
  private box: { width: number; height: number; dpr: number } | null = null;
  private projection: MapProjection | null = null;
  private lattice: DotLattice | null = null;
  /** Afterglow per lattice dot. */
  private heat = new Float32Array(0);
  /** Reveal threshold per lattice dot (distance from the origin, with jitter). */
  private threshold = new Float32Array(0);
  private heatClock = 0;
  /** Oldest first. */
  private visits: Visit[] = [];
  private readonly ids = new Set<string>();
  private drops: Drop[] = [];
  private pings: Ping[] = [];
  private readonly sparks = new Sparks();
  private nextDrop = 0;
  private dirty = true;
  private baseDirty = true;
  private effectsDirty = false;
  private reveal: "waiting" | "running" | "done" = "waiting";
  private revealStart = 0;
  private marker: Visit | null = null;
  private activeId: string | null = null;
  private readonly markerLevel: Spring = { position: 0, velocity: 0 };
  private markerTarget = 0;
  private readonly focusLevel: Spring = { position: 0, velocity: 0 };
  private focusTarget = 0;
  private effectsX = 0;
  private effectsY = 0;
  private readonly point = createScreenPoint();
  private readonly hoverX = new Float32Array(HOVER_POOL);
  private readonly hoverY = new Float32Array(HOVER_POOL);
  private readonly hoverVisits: Visit[] = [];

  /** Applies the projection and the decay. Returns whether anything changed. */
  configure(kind: GeoVisitorsProjection, decay: number) {
    let changed = false;
    if (decay !== this.decay) {
      this.decay = decay;
      this.rebuildHeat(Date.now());
      changed = true;
    }
    if (kind !== this.kind) {
      this.kind = kind;
      if (this.box) this.layout(this.box.width, this.box.height, this.box.dpr);
      changed = true;
    }
    return changed;
  }

  /** New theme colours: the ramp and the baked land follow. */
  setInk(ink: GeoInk) {
    this.ink = ink;
    this.colors = { land: rgba(ink.land), accent: rgba(ink.accent), shine: rgba(ink.shine), card: rgba(ink.card) };
    // land → accent → shine: the hottest dots read as the most intense in both themes
    const ramp = [ink.land, ink.accent, ink.shine];
    if (this.batch) this.batch.setRamp(ramp);
    else this.batch = createDotBatch(4096, ramp, { tones: 32, levels: 16 });
    this.baseDirty = true;
    this.dirty = true;
  }

  /** New map size: projection, lattice and points follow, and the afterglow is rebuilt from the visits. */
  layout(width: number, height: number, dpr: number) {
    this.box = { width, height, dpr };
    const projection = createProjection(this.kind, { width, height, latRange: MAP_LAT_RANGE });
    const lattice = mapLattice(projection, { pitch: PITCH });
    this.projection = projection;
    this.lattice = lattice;
    this.heat = new Float32Array(lattice.count);
    this.threshold = new Float32Array(lattice.count);
    for (const visit of this.visits) this.place(visit);
    if (this.reveal === "running") this.prepareReveal();
    this.rebuildHeat(Date.now());
    this.baseDirty = true;
  }

  /** The afterglow canvas was cleared (resized): draw it again on the next frame. */
  invalidate() {
    this.dirty = true;
  }

  /** Position of the map's top-left corner on the effects layer. */
  setEffectsOffset(x: number, y: number) {
    this.effectsX = x;
    this.effectsY = y;
  }

  /** Adds visits (any order; ids already known are skipped). `now` is the epoch time their age is measured from. */
  addVisits(events: readonly VisitorEvent[], options: AddOptions, now: number) {
    const reduced = prefersReducedMotion();
    const started = performance.now();
    let inFlight = 0;
    for (const drop of this.drops) if (!drop.landed) inFlight++;
    const sorted = [...events].sort((a, b) => a.time - b.time);
    for (const event of sorted) {
      if (this.ids.has(event.id)) continue;
      this.ids.add(event.id);
      const visit: Visit = { event, x: 0, y: 0, landed: false };
      this.place(visit);
      this.insert(visit);
      const age = Math.max(0, now - event.time);
      // events older than the decay add no afterglow and do not drop
      const warm = age < this.decay * 1000;
      if (options.animate && warm && !reduced && this.projection && inFlight < MAX_DROPS) {
        const start = Math.max(started, this.nextDrop);
        this.nextDrop = start + DROP_STAGGER_MS * (0.6 + 0.8 * Math.random());
        this.drops.push({ visit, start, landed: false });
        inFlight++;
        continue;
      }
      visit.landed = true;
      if (warm) this.addHeat(visit, this.decayFactor(age));
      if (options.announce) this.onLand(event);
    }
    this.trim();
    this.dirty = true;
  }

  /** Removes visits by id and rebuilds the afterglow without them. */
  removeVisits(ids: ReadonlySet<string>) {
    this.visits = this.visits.filter((visit) => !ids.has(visit.event.id));
    this.drops = this.drops.filter((drop) => !ids.has(drop.visit.event.id));
    this.pings = this.pings.filter((ping) => !ids.has(ping.visit.event.id));
    if (this.marker && ids.has(this.marker.event.id)) this.marker = null;
    for (const id of ids) this.ids.delete(id);
    this.rebuildHeat(Date.now());
  }

  /** The newest landed visits, newest first. */
  newest(count: number) {
    const list: VisitorEvent[] = [];
    for (let i = this.visits.length - 1; i >= 0 && list.length < count; i--) {
      if (this.visits[i].landed) list.push(this.visits[i].event);
    }
    return list;
  }

  /** Landed visits of the last five minutes. */
  countRecent(now: number) {
    let count = 0;
    for (let i = this.visits.length - 1; i >= 0; i--) {
      const visit = this.visits[i];
      if (now - visit.event.time >= RECENT_MS) break;
      if (visit.landed) count++;
    }
    return count;
  }

  /** "12 visits in the last 15 seconds, most from São Paulo." or "" when there were none. */
  summary(now: number) {
    const places = new Map<string, number>();
    let total = 0;
    for (let i = this.visits.length - 1; i >= 0; i--) {
      const visit = this.visits[i];
      if (now - visit.event.time > SUMMARY_MS) break;
      if (!visit.landed) continue;
      total++;
      const place = placeName(visit.event);
      places.set(place, (places.get(place) ?? 0) + 1);
    }
    if (total === 0) return "";
    let top = "";
    let most = 0;
    for (const [place, visits] of places) {
      if (visits > most) {
        most = visits;
        top = place;
      }
    }
    return total === 1 ? `1 visit in the last 15 seconds, from ${top}.` : `${total} visits in the last 15 seconds, most from ${top}.`;
  }

  /** The 250 ms tick: fades the afterglow by the time since the last tick and lets go of visits nobody needs. */
  tick(now: number) {
    const elapsed = now - this.heatClock;
    this.heatClock = now;
    if (elapsed > 0) {
      const factor = this.decayFactor(elapsed);
      const heat = this.heat;
      for (let i = 0; i < heat.length; i++) {
        if (heat[i] === 0) continue;
        heat[i] *= factor;
        if (heat[i] < HEAT_MIN * 0.25) heat[i] = 0;
      }
      this.dirty = true;
    }
    this.trim(now);
  }

  /** Marks a visit (or none). A marked row also pings once and dims the rest of the afterglow. */
  setActive(id: string | null, fromRow: boolean) {
    const visit = id ? this.find(id) : undefined;
    if (visit) this.marker = visit;
    this.markerTarget = visit ? 1 : 0;
    this.focusTarget = visit && fromRow ? 1 : 0;
    if (visit && fromRow && id !== this.activeId) this.ping(visit.event.id);
    this.activeId = id;
  }

  /** Two uneven rings of lit dots spread from the visit's point. No sparks. */
  ping(id: string) {
    const visit = this.find(id);
    if (!visit || prefersReducedMotion()) return;
    this.pings.push({ visit, start: performance.now() });
  }

  /** The nearest of the last 50 landed visits within `radius` px of (x, y). */
  nearest(x: number, y: number, radius: number) {
    const pool = this.hoverVisits;
    pool.length = 0;
    for (let i = this.visits.length - 1; i >= 0 && pool.length < HOVER_POOL; i--) {
      const visit = this.visits[i];
      if (!visit.landed) continue;
      this.hoverX[pool.length] = visit.x;
      this.hoverY[pool.length] = visit.y;
      pool.push(visit);
    }
    const index = nearestIndex(this.hoverX, this.hoverY, pool.length, x, y, radius);
    return index >= 0 ? pool[index] : null;
  }

  /** One frame: reveal, landings, springs, then the afterglow and the effects. Returns whether to keep going. */
  step(base: CanvasSurface | null, heat: CanvasSurface | null, effects: CanvasSurface | null, delta: number) {
    if (!this.lattice || !this.ink || !this.batch || !base || !heat) return false;
    const now = performance.now();
    const reduced = prefersReducedMotion();
    let moving = false;

    // The land prints itself once, outward from the newest visit, the first time the map is on screen.
    let front = Infinity;
    if (this.reveal !== "done") {
      if (reduced) {
        this.reveal = "done";
      } else {
        if (this.reveal === "waiting") {
          this.reveal = "running";
          this.revealStart = now;
          this.prepareReveal();
        }
        const t = (now - this.revealStart) / REVEAL_MS;
        if (t >= 1) {
          this.reveal = "done";
          this.baseDirty = true;
          this.dirty = true;
        } else {
          front = easeOutCubic(t) * REVEAL_END;
          this.drawReveal(base, front);
          moving = true;
        }
      }
    }
    if (this.reveal === "done" && this.baseDirty) {
      this.bake(base);
      this.baseDirty = false;
    }

    const epoch = Date.now();
    for (const drop of this.drops) if (!drop.landed && now >= drop.start + FALL_MS) this.land(drop, epoch);
    if (this.drops.length) this.drops = this.drops.filter((drop) => now < drop.start + FALL_MS + SETTLE_MS);
    if (this.pings.length) this.pings = this.pings.filter((ping) => now < ping.start + PING_GAP_MS + PING_MS);
    if (settleSpring(this.markerLevel, this.markerTarget, delta, reduced, LEVEL_SPRING)) moving = true;
    if (settleSpring(this.focusLevel, this.focusTarget, delta, reduced, LEVEL_SPRING)) moving = true;
    if (this.drops.length || this.pings.length) moving = true;

    if (this.dirty || moving) {
      this.drawHeat(heat, now, front);
      this.dirty = false;
    }
    const sparking = effects ? this.drawEffects(effects, now, delta) : false;
    return moving || sparking;
  }

  /* internals */

  private find(id: string) {
    for (let i = this.visits.length - 1; i >= 0; i--) if (this.visits[i].event.id === id) return this.visits[i];
    return undefined;
  }

  private place(visit: Visit) {
    if (!this.projection) return;
    const lat = clamp(visit.event.lat, MAP_LAT_RANGE[0], MAP_LAT_RANGE[1]);
    this.projection.project(lat, wrapLongitude(visit.event.lon), this.point);
    visit.x = this.point.x;
    visit.y = this.point.y;
  }

  /** Keeps `visits` sorted by time; new visits are nearly always the newest. */
  private insert(visit: Visit) {
    const list = this.visits;
    let index = list.length;
    while (index > 0 && list[index - 1].event.time > visit.event.time) index--;
    list.splice(index, 0, visit);
  }

  /** Drops visits older than the afterglow and the count need, keeping the last 50 for the hover. */
  private trim(now = Date.now()) {
    const keep = Math.max(this.decay * 1000, RECENT_MS);
    let remove = Math.max(0, this.visits.length - MAX_VISITS);
    while (remove < this.visits.length - HOVER_POOL) {
      const visit = this.visits[remove];
      if (now - visit.event.time <= keep || !visit.landed) break;
      remove++;
    }
    if (remove === 0) return;
    for (const visit of this.visits.slice(0, remove)) this.ids.delete(visit.event.id);
    this.visits = this.visits.slice(remove);
  }

  private decayFactor(ms: number) {
    // half-life of a quarter of the decay: after `decay` seconds 1/16 is left
    return Math.exp(((-ms / 1000) * Math.LN2) / (this.decay / 4));
  }

  private addHeat(visit: Visit, amount: number) {
    const lattice = this.lattice;
    if (!lattice || !(amount > 0)) return;
    const heat = this.heat;
    lattice.grid.query(visit.x, visit.y, HEAT_RADIUS, (i, distanceSquared) => {
      heat[i] += amount * Math.exp(-distanceSquared / HEAT_KERNEL);
    });
  }

  private rebuildHeat(now: number) {
    this.heat.fill(0);
    this.heatClock = now;
    const limit = this.decay * 1000;
    for (const visit of this.visits) {
      if (!visit.landed) continue;
      const age = Math.max(0, now - visit.event.time);
      if (age < limit) this.addHeat(visit, this.decayFactor(age));
    }
    this.dirty = true;
  }

  /** The streak has arrived: afterglow in, sparks out, the row may enter the feed. */
  private land(drop: Drop, now: number) {
    drop.landed = true;
    const visit = drop.visit;
    visit.landed = true;
    this.addHeat(visit, this.decayFactor(Math.max(0, now - visit.event.time)));
    this.dirty = true;
    const ink = this.ink;
    if (ink) {
      // the glint is near white: on a light card the soft accent carries the third tone instead
      const third = ink.dark ? ink.glint : ink.soft;
      this.sparks.add(visit.x + this.effectsX, visit.y + this.effectsY, 12, [ink.accent, ink.shine, third], LANDING_SPARKS);
    }
    this.onLand(visit.event);
  }

  /** Reveal thresholds: distance from the newest visit (or the middle), plus the dot's jitter for an uneven front. */
  private prepareReveal() {
    const lattice = this.lattice;
    const box = this.box;
    if (!lattice || !box) return;
    let ox = box.width / 2;
    let oy = box.height / 2;
    for (let i = this.visits.length - 1; i >= 0; i--) {
      if (this.visits[i].landed) {
        ox = this.visits[i].x;
        oy = this.visits[i].y;
        break;
      }
    }
    const reach = Math.max(Math.hypot(ox, oy), Math.hypot(box.width - ox, oy), Math.hypot(ox, box.height - oy), Math.hypot(box.width - ox, box.height - oy));
    for (let i = 0; i < lattice.count; i++) {
      const n = Math.hypot(lattice.x[i] - ox, lattice.y[i] - oy) / reach;
      this.threshold[i] = n * 0.82 + lattice.jitter[i] * 0.18;
    }
  }

  /** Queues a lattice dot on the batch, snapped to device pixels so 1.5 px squares stay crisp. */
  private addDot(i: number, size: number, tone: number, alpha: number) {
    const lattice = this.lattice;
    const batch = this.batch;
    const dpr = this.box?.dpr ?? 1;
    if (!lattice || !batch) return;
    const s = Math.max(1, Math.round(size * dpr)) / dpr;
    const x = Math.round((lattice.x[i] - s / 2) * dpr) / dpr + s / 2;
    const y = Math.round((lattice.y[i] - s / 2) * dpr) / dpr + s / 2;
    batch.add(x, y, s, tone, alpha);
  }

  private bake(surface: CanvasSurface) {
    const { context, width, height } = surface;
    const lattice = this.lattice;
    context.clearRect(0, 0, width, height);
    if (!lattice) return;
    const dpr = this.box?.dpr ?? surface.dpr;
    const s = Math.max(1, Math.round(DOT_SIZE * dpr)) / dpr;
    context.fillStyle = this.colors.land;
    for (let i = 0; i < lattice.count; i++) {
      context.fillRect(Math.round((lattice.x[i] - s / 2) * dpr) / dpr, Math.round((lattice.y[i] - s / 2) * dpr) / dpr, s, s);
    }
  }

  /** The first reveal: dots appear behind an uneven front that flashes in the accent as it passes. */
  private drawReveal(surface: CanvasSurface, front: number) {
    const { context, width, height } = surface;
    const lattice = this.lattice;
    const batch = this.batch;
    context.clearRect(0, 0, width, height);
    if (!lattice || !batch) return;
    for (let i = 0; i < lattice.count; i++) {
      const passed = front - this.threshold[i];
      const appear = clamp(passed / REVEAL_BAND, 0, 1);
      if (appear <= 0) continue;
      const flash = Math.exp(-passed / 0.05);
      this.addDot(i, DOT_SIZE + 0.6 * flash, 0.5 * flash, appear);
    }
    batch.flush(context);
  }

  private drawHeat(surface: CanvasSurface, now: number, front: number) {
    const { context, width, height } = surface;
    const lattice = this.lattice;
    const batch = this.batch;
    context.clearRect(0, 0, width, height);
    if (!lattice || !batch) return;
    const heat = this.heat;
    const dim = 1 - FOCUS_DIM * clamp(this.focusLevel.position, 0, 1);
    const revealing = Number.isFinite(front);

    // the afterglow: even a faint trace reads as accent; only busy places climb toward the shine
    for (let i = 0; i < lattice.count; i++) {
      const h = heat[i];
      if (h < HEAT_MIN) continue;
      let alpha = (0.3 + 0.7 * (1 - Math.exp(-2 * h))) * smoothstep(HEAT_MIN, 0.06, h) * dim;
      if (revealing) alpha *= clamp((front - this.threshold[i]) / REVEAL_BAND, 0, 1);
      const tone = 0.5 * Math.min(1, Math.pow(h / WARM, 0.7)) + 0.5 * smoothstep(1, HOT, h);
      this.addDot(i, DOT_SIZE + 0.5 * smoothstep(1, HOT, h), tone, alpha);
    }

    // landing rings: an uneven front of lit dots that spreads 24 px and fades
    for (const drop of this.drops) {
      if (!drop.landed) continue;
      const t = (now - drop.start - FALL_MS) / RING_MS;
      if (t < 1) this.ring(drop.visit, 2 + 22 * easeOutCubic(t), 4, 4, Math.pow(1 - t, 1.2), 0.55);
    }
    // pings: two thinner rings, the second a little later and weaker
    for (const ping of this.pings) {
      for (let k = 0; k < 2; k++) {
        const t = (now - ping.start - k * PING_GAP_MS) / PING_MS;
        if (t >= 0 && t < 1) this.ring(ping.visit, 3 + 28 * easeOutCubic(t), 3.5, 3, Math.pow(1 - t, 1.2) * (k ? 0.75 : 1), 0.55);
      }
    }
    // the marked visit: a still, uneven ring around its point
    const level = clamp(this.markerLevel.position, 0, 1);
    if (this.marker && level > 0.01) this.ring(this.marker, 6, 2.2, 2.5, level * 0.95, 0.6);
    batch.flush(context);

    const dpr = this.box?.dpr ?? surface.dpr;
    for (const drop of this.drops) {
      if (!drop.landed) continue;
      const since = now - drop.start - FALL_MS;
      const { x, y } = drop.visit;
      if (since < BLOOM_MS && this.ink) {
        // a short splash of light under the ring
        const t = since / BLOOM_MS;
        const radius = 5 + 13 * easeOutCubic(t);
        const glow = context.createRadialGradient(x, y, 0, x, y, radius);
        glow.addColorStop(0, rgba(this.ink.accent, 0.36 * Math.pow(1 - t, 1.5)));
        glow.addColorStop(1, rgba(this.ink.accent, 0));
        context.fillStyle = glow;
        context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
      if (since < SETTLE_MS) {
        // the landing dot: 3 px, shrinking into the afterglow
        const t = since / SETTLE_MS;
        context.globalAlpha = 1 - smoothstep(0.3, 1, t);
        context.fillStyle = t < 0.12 ? this.colors.shine : this.colors.accent;
        fillSquare(context, x, y, 3.2 - 1.7 * easeOutCubic(t), dpr);
      }
    }
    if (this.marker && level > 0.01) {
      // a dotted reticle that closes in on the point, legible over land and sea alike
      const { x, y } = this.marker;
      const radius = RETICLE_RADIUS + 5 * (1 - level);
      context.globalAlpha = level;
      context.fillStyle = this.colors.accent;
      for (let k = 0; k < RETICLE_DOTS; k++) {
        const angle = (k / RETICLE_DOTS) * Math.PI * 2;
        fillSquare(context, x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, 1.5, dpr);
      }
      context.fillStyle = this.colors.card;
      fillSquare(context, x, y, 5, dpr);
      context.fillStyle = this.colors.shine;
      fillSquare(context, x, y, 3, dpr);
    }
    context.globalAlpha = 1;
  }

  /** Lattice dots on a ring around a visit, `strength` 0..1, toned from `tone` up to the shine where brightest. */
  private ring(visit: Visit, radius: number, width: number, unevenness: number, strength: number, tone: number) {
    const lattice = this.lattice;
    if (!lattice) return;
    lattice.grid.query(visit.x, visit.y, radius + unevenness + width * 2.5, (i, distanceSquared) => {
      const b = ringFront(Math.sqrt(distanceSquared), radius, width, lattice.jitter[i], unevenness) * strength;
      if (b > 0.05) this.addDot(i, DOT_SIZE + 0.6 * b, tone + (1 - tone) * b, Math.min(1, b));
    });
  }

  /** Falling streaks and sparks on the layer that reaches past the map. Returns whether anything is alive. */
  private drawEffects(surface: CanvasSurface, now: number, delta: number) {
    const { context, width, height } = surface;
    let falling = false;
    for (const drop of this.drops) if (!drop.landed) falling = true;
    if (!falling && !this.sparks.active) {
      if (this.effectsDirty) {
        context.clearRect(0, 0, width, height);
        this.effectsDirty = false;
      }
      return false;
    }
    this.effectsDirty = true;
    context.clearRect(0, 0, width, height);
    const dpr = surface.dpr;
    for (const drop of this.drops) {
      if (drop.landed) continue;
      const t = (now - drop.start) / FALL_MS;
      if (t < 0) continue;
      // a streak of six squares falls from 18 px above the point, speeding up and stretching as it goes
      const fall = easeInCubic(t);
      const x = drop.visit.x + this.effectsX;
      const head = drop.visit.y + this.effectsY - STREAK_HEIGHT * (1 - fall);
      const gap = 1.4 + 2.6 * fall;
      const fadeIn = smoothstep(0, 0.3, t);
      for (let k = 0; k < STREAK_DOTS; k++) {
        context.globalAlpha = fadeIn * Math.pow(1 - k / STREAK_DOTS, 1.3);
        context.fillStyle = k === 0 ? this.colors.shine : this.colors.accent;
        fillSquare(context, x, head - k * gap, STREAK_SIZE, dpr);
      }
    }
    context.globalAlpha = 1;
    this.sparks.step(context, delta);
    return true;
  }
}

/* Feed queue and rows --------------------------------------------------------------------------------- */

type FeedChange = { kind: "add"; event: VisitorEvent } | { kind: "replace"; events: readonly VisitorEvent[] };

interface FeedQueue {
  /** Queues a visit's row. Only the newest `limit` queued rows are kept: older ones would leave at once anyway. */
  add(event: VisitorEvent): void;
  /** Replaces the rows with `events` after the visits in `removed` left, on the next turn. */
  replace(events: readonly VisitorEvent[], removed: ReadonlySet<string>): void;
  /** Holds row changes while the feed is pointed at or focused, so rows do not move under the reader. */
  hold(reason: string, held: boolean): void;
  clear(): void;
}

/** Applies row changes one at a time, at most one per 160 ms, so bursts cascade instead of jumping. */
function createFeedQueue(apply: (change: FeedChange) => void, limit: () => number): FeedQueue {
  let pending: VisitorEvent[] = [];
  let timer = 0;
  let replaceTimer = 0;
  let last = -Infinity;
  const holds = new Set<string>();

  const flush = () => {
    timer = 0;
    if (holds.size > 0) return;
    const event = pending.shift();
    if (!event) return;
    last = performance.now();
    apply({ kind: "add", event });
    schedule();
  };
  const schedule = () => {
    if (timer || holds.size > 0 || pending.length === 0) return;
    timer = window.setTimeout(flush, Math.max(0, last + FEED_STEP_MS - performance.now()));
  };

  return {
    add(event) {
      let index = pending.length;
      while (index > 0 && pending[index - 1].time > event.time) index--;
      pending.splice(index, 0, event);
      if (pending.length > limit()) pending = pending.slice(-limit());
      schedule();
    },
    replace(events, removed) {
      pending = pending.filter((event) => !removed.has(event.id));
      window.clearTimeout(replaceTimer);
      replaceTimer = window.setTimeout(() => {
        replaceTimer = 0;
        apply({ kind: "replace", events });
      }, 0);
    },
    hold(reason, held) {
      if (held) holds.add(reason);
      else holds.delete(reason);
      if (holds.size > 0) {
        window.clearTimeout(timer);
        timer = 0;
      } else {
        schedule();
      }
    },
    clear() {
      window.clearTimeout(timer);
      window.clearTimeout(replaceTimer);
      timer = 0;
      replaceTimer = 0;
      pending = [];
    },
  };
}

function newestRows(visits: readonly VisitorEvent[], limit: number): FeedRowState[] {
  return [...visits]
    .sort((a, b) => b.time - a.time)
    .slice(0, limit)
    .map((event) => ({ event, phase: "idle" as const }));
}

/** A new row at its place by time; the oldest rows past the limit slide out. */
function insertRow(state: FeedState, event: VisitorEvent, reduced: boolean): FeedState {
  if (state.rows.some((row) => row.event.id === event.id)) return state;
  const live = state.rows.filter((row) => row.phase !== "exit");
  // every slot holds a newer visit: this one would leave at once
  if (live.length >= state.limit && live.every((row) => row.event.time >= event.time)) return state;
  const rows = [...state.rows];
  const index = rows.findIndex((row) => row.event.time < event.time);
  rows.splice(index < 0 ? rows.length : index, 0, { event, phase: reduced ? "idle" : "enter" });
  let excess = live.length + 1 - state.limit;
  for (let i = rows.length - 1; i >= 0 && excess > 0; i--) {
    if (rows[i].phase === "exit") continue;
    if (reduced) rows.splice(i, 1);
    else rows[i] = { event: rows[i].event, phase: "exit" };
    excess--;
  }
  return { ...state, rows };
}

function dropRow(state: FeedState, id: string): FeedState {
  return state.rows.some((row) => row.event.id === id) ? { ...state, rows: state.rows.filter((row) => row.event.id !== id) } : state;
}

/** Rows for a new list of newest visits, without animation. */
function replaceRows(state: FeedState, events: readonly VisitorEvent[]): FeedState {
  return { ...state, rows: events.slice(0, state.limit).map((event) => ({ event, phase: "idle" as const })) };
}

/** A new `maxFeed`: extra rows go at once; a larger feed fills up as visits arrive. */
function resizeFeed(state: FeedState, limit: number): FeedState {
  return { limit, rows: state.rows.filter((row) => row.phase !== "exit").slice(0, limit) };
}

/** Moves the demo history's relative times to the clock. */
function shiftRows(state: FeedState, shift: number): FeedState {
  return { ...state, rows: state.rows.map((row) => ({ ...row, event: { ...row.event, time: row.event.time + shift } })) };
}

/* Data helpers ---------------------------------------------------------------------------------------- */

/** Drops only play on screen in a visible page; otherwise the visit's afterglow appears at once. */
function canDrop(onScreen: boolean) {
  return onScreen && document.visibilityState !== "hidden";
}

function isValidEvent(event: VisitorEvent) {
  return (
    typeof event.id === "string" &&
    event.id !== "" &&
    Number.isFinite(event.lat) &&
    Number.isFinite(event.lon) &&
    Number.isFinite(event.time)
  );
}

/** Valid events, first of each id, oldest first. */
function validEvents(events: readonly VisitorEvent[]): VisitorEvent[] {
  const seen = new Set<string>();
  const list: VisitorEvent[] = [];
  for (const event of events) {
    if (!isValidEvent(event) || seen.has(event.id)) continue;
    seen.add(event.id);
    list.push(event);
  }
  return list.sort((a, b) => a.time - b.time);
}

function newestTime(events: readonly VisitorEvent[]) {
  let newest = 0;
  for (const event of events) newest = Math.max(newest, event.time);
  return newest;
}

function countRecent(events: readonly VisitorEvent[], now: number) {
  let count = 0;
  for (const event of events) if (now - event.time < RECENT_MS) count++;
  return count;
}

/** The place a row shows: the event's city, else the country at its point, else its coordinates. */
function placeName(event: VisitorEvent) {
  const city = event.city?.trim();
  if (city) return city;
  return countryAt(clamp(event.lat, -90, 90), wrapLongitude(event.lon))?.name ?? formatLatLon(event, "decimal", 1);
}

/** "5 min", "45 s", "2 h". */
function formatWindow(seconds: number) {
  if (seconds < 90) return `${Math.round(seconds)} s`;
  if (seconds < 90 * 60) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** A demo visit: a city picked by its weight, a point near it and a page. */
function demoVisit(random: () => number, time: number, id: string): VisitorEvent {
  const city = pickWeighted(random, DEMO_CITIES, (item) => item.weight);
  const point = scatterAround(random, city, 30 + 90 * city.weight, true);
  const page = pickWeighted(random, DEMO_PAGES, (item) => item.weight);
  return { id, lat: point.lat, lon: point.lon, city: city.name, label: page.path, time };
}

/**
 * Five minutes of seeded demo history at the stream's own pace (a visit every 0.6 to 2.2 s), with times relative to
 * 0. The same on the server and the client; the clock moves it to now after mount.
 */
function demoHistory(): VisitorEvent[] {
  const random = createRandom("geo-visitors");
  const visits: VisitorEvent[] = [];
  let ago = 0;
  for (let i = 0; ; i++) {
    ago += 600 + random() * 1600;
    if (ago >= RECENT_MS) break;
    visits.push(demoVisit(random, -Math.round(ago), `h${i}`));
  }
  return visits.reverse();
}
