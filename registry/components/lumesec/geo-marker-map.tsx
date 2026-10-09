"use client";

import * as React from "react";

import { snapCenter, useCanvas, type CanvasSurface } from "@/lib/lumesec/canvas";
import { usePalette } from "@/lib/lumesec/color";
import {
  ARROW_DIRECTIONS,
  createDotBatch,
  createProjection,
  createScreenPoint,
  GEO_TOKENS,
  geoInk,
  MAP_LAT_RANGE,
  mapLattice,
  placeLabels,
  projectionAspect,
  projectionOutlineSvgPath,
  ringFront,
  spatialNavigate,
  toneColor,
  type DotBatch,
  type DotLattice,
  type GeoInk,
  type LabelAnchor,
  type LabelPlacement,
  type LatLon,
  type MapProjection,
} from "@/lib/lumesec/geo";
import { DEMO_CITIES, formatCompact } from "@/lib/lumesec/geo-data";
import { clamp, easeOutCubic, mixRgb, percent, rgba, smoothstep, stringHash, type RGB } from "@/lib/lumesec/math";
import { prefersReducedMotion, springStep, useAnimationLoop, useLazyRef, type Spring } from "@/lib/lumesec/motion";
import { RollText } from "@/lib/lumesec/roll-text";
import { Sparks } from "@/lib/lumesec/sparks";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** Colour of a marker's centre dot and its halo. `accent` is the LumeSec accent; the rest are status colours. */
export type MapMarkerTone = "accent" | "info" | "success" | "warning" | "destructive" | "muted";

/** Diameter of a marker's centre dot: 6, 8 or 10 px. */
export type MapMarkerSize = "sm" | "md" | "lg";

/** One place on the map. */
export interface MapMarker {
  /** Stable id: the selection value and the React key. */
  readonly id: string;
  /** Name shown in the label chip and read by screen readers. Without it the id is read. */
  readonly label?: string;
  /** Latitude in degrees. */
  readonly lat: number;
  /** Longitude in degrees. */
  readonly lon: number;
  /** A count or measure. Values above 0 grow a halo whose area is proportional to the value. */
  readonly value?: number;
  /** Colour of the dot and the halo. Default `accent`. */
  readonly tone?: MapMarkerTone;
  /** Size of the centre dot. Default `md`. */
  readonly size?: MapMarkerSize;
  /** Sends a ring of light through the land dots every 2.4 s. */
  readonly pulse?: boolean;
}

/** Flat projections the map can use. */
export type GeoMarkerMapProjection = "equalEarth" | "equirectangular" | "mercator";

/** Arrangement of the land dots. */
export type GeoMarkerMapGrid = "honeycomb" | "square";

/** Which label chips are shown. */
export type GeoMarkerMapLabels = "all" | "selected" | "none";

/** When the land reveal plays. */
export type GeoMarkerMapReveal = "view" | "mount" | "none";

/** Props of GeoMarkerMap. The remaining props go to the root `<div>`. */
export interface GeoMarkerMapProps extends Omit<React.ComponentProps<"div">, "defaultValue" | "children"> {
  /**
   * The places to mark. Without it the map shows 14 demo cities with invented values. An empty array shows the plain
   * land with `emptyText`. Markers outside `latRange` are skipped.
   */
  markers?: readonly MapMarker[];
  /** The selected marker id (controlled), or null for none. Use with `onValueChange`. */
  value?: string | null;
  /** The marker selected at first when uncontrolled. */
  defaultValue?: string | null;
  /** Called when the user selects a marker, or clears the selection (Escape, a second press, a click on the map). */
  onValueChange?: (value: string | null) => void;
  /** Map projection. Equal Earth keeps areas true, so halos compare fairly everywhere. */
  projection?: GeoMarkerMapProjection;
  /** Dot arrangement of the land. */
  grid?: GeoMarkerMapGrid;
  /** Dot spacing in px, 3 to 8. */
  pitch?: number;
  /** Latitude crop as `[south, north]` in degrees. The default drops Antarctica and the far north. */
  latRange?: readonly [number, number];
  /** Halo radius in px for the largest value on a map 660 px wide. Smaller maps scale it down to 60%. */
  maxHalo?: number;
  /**
   * Which label chips are shown: every marker that has room, only the selected (and hovered or focused) one, or none.
   * Default `all`, or `selected` while the map is narrower than 480 px.
   */
  labels?: GeoMarkerMapLabels;
  /** When the land appears: the first time the map scrolls into view, right after mount, or never (drawn at once). */
  reveal?: GeoMarkerMapReveal;
  /** Marker id or point the reveal grows from. Default the first marker. */
  revealFrom?: string | LatLon;
  /** Formats values for the label chips and the markers' accessible names. Default compact (`48.2K`). */
  format?: (value: number) => string;
  /** Accessible name of the map. */
  label?: string;
  /** Text shown when `markers` is an empty array. */
  emptyText?: string;
}

/**
 * A flat map of land dots with markers. A marker with a value lights a halo of land dots around it, sized by area,
 * so the busiest places read at a glance with no circles drawn over the map. Halos grow out of their markers behind
 * an uneven bright front and spring to new sizes when values change; pulsing markers send rings of light through the
 * lattice, and the label chips place themselves so they never overlap. Markers are real buttons in one tab stop.
 *
 * @example
 * <GeoMarkerMap
 *   markers={[
 *     { id: "lhr", label: "London", lat: 51.51, lon: -0.13, value: 4200 },
 *     { id: "nrt", label: "Tokyo", lat: 35.68, lon: 139.65, value: 3100, pulse: true },
 *   ]}
 *   onValueChange={(id) => setSelected(id)}
 * />
 */
export function GeoMarkerMap({
  markers,
  value,
  defaultValue = null,
  onValueChange,
  projection = "equalEarth",
  grid = "honeycomb",
  pitch = 4,
  latRange = MAP_LAT_RANGE,
  maxHalo = 28,
  labels,
  reveal = "view",
  revealFrom,
  format = formatCompact,
  label = "Map",
  emptyText = "No locations",
  className,
  style,
  ...props
}: GeoMarkerMapProps) {
  const [selected, setSelected] = useControllableState<string | null>({ value, defaultValue, onChange: onValueChange });
  const [size, setSize] = React.useState<{ width: number; height: number } | null>(null);
  const [hovered, setHovered] = React.useState<string | null>(null);
  const [focused, setFocused] = React.useState<string | null>(null);
  /** The marker that holds the roving tab stop. */
  const [active, setActive] = React.useState<string | null>(null);

  const items = markers ?? DEMO_MARKERS;
  const south = Math.min(latRange[0], latRange[1]);
  const north = Math.max(latRange[0], latRange[1]);
  const dotPitch = clamp(Number.isFinite(pitch) ? pitch : 4, 3, 8);
  const aspect = projectionAspect(projection, [south, north]);

  // Pure layout: the server places markers with a nominal 1000 px projection, the client with the measured one.
  const layout = React.useMemo(() => {
    const width = size?.width ?? NOMINAL_WIDTH;
    const height = size?.height ?? NOMINAL_WIDTH / aspect;
    const map = createProjection(projection, { width, height, latRange: [south, north] });
    const point = createScreenPoint();
    const placed: PlacedMarker[] = [];
    const seen = new Set<string>();
    for (const marker of items) {
      // ids are keys: a repeated id keeps its first marker
      if (seen.has(marker.id) || !Number.isFinite(marker.lat) || !Number.isFinite(marker.lon)) continue;
      seen.add(marker.id);
      if (!map.project(marker.lat, marker.lon, point)) continue;
      placed.push({ marker, x: point.x, y: point.y, left: point.x / width, top: point.y / height });
    }
    return { width, height, placed, outline: projectionOutlineSvgPath(map) };
  }, [size, aspect, projection, south, north, items]);
  const { placed } = layout;

  const placedIds = new Set(placed.map((entry) => entry.marker.id));
  const shownSelection = selected !== null && placedIds.has(selected) ? selected : null;
  const tabStop =
    active !== null && placedIds.has(active)
      ? active
      : (shownSelection ?? (placed.length ? placed[0].marker.id : null));
  const labelMode: GeoMarkerMapLabels = labels ?? (size && size.width < NARROW_WIDTH ? "selected" : "all");
  const maxValue = placed.reduce((best, entry) => Math.max(best, positive(entry.marker.value)), 0);

  // Chips to place: the largest values (one chip per LABEL_SPACING px of width, so the halos stay readable), or
  // only the selected one; the hovered and focused markers always get theirs.
  const labelBudget = labelMode === "all" ? Math.max(3, Math.floor(layout.width / LABEL_SPACING)) : 0;
  const labelled = new Set(
    placed
      .filter((entry) => entry.marker.label)
      .sort((a, b) => positive(b.marker.value) - positive(a.marker.value))
      .slice(0, labelBudget)
      .map((entry) => entry.marker.id),
  );
  const chipEntries: ChipEntry[] = [];
  if (labelMode !== "none") {
    placed.forEach((entry, order) => {
      const { marker } = entry;
      if (!marker.label) return;
      const isSelected = marker.id === shownSelection;
      const isPointed = marker.id === hovered || marker.id === focused;
      if (!labelled.has(marker.id) && !isSelected && !isPointed) return;
      const share = maxValue > 0 ? positive(marker.value) / maxValue : 0;
      chipEntries.push({
        id: marker.id,
        x: entry.x,
        y: entry.y,
        // clear of the dot, and of the 2 px ring (plus its 2 px inset) on the selected one
        gap: DOT_SIZE[marker.size ?? "md"] / 2 + (isSelected ? 9 : 6),
        priority:
          (isSelected ? 2 * FORCED_PRIORITY : 0) + (isPointed ? FORCED_PRIORITY : 0) + share * 1000 - order * 0.01,
        marker,
        selected: isSelected,
      });
    });
  }

  const stageRef = React.useRef<HTMLDivElement>(null);
  const baseRef = React.useRef<HTMLCanvasElement>(null);
  const liveRef = React.useRef<HTMLCanvasElement>(null);
  const effectsRef = React.useRef<HTMLCanvasElement>(null);
  /** The mutable drawing state, created on first use (never during render). */
  const engineRef = useLazyRef(() => createEngine());
  const configRef = React.useRef<MapConfig | null>(null);
  const buttonRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const dotRefs = React.useRef(new Map<string, HTMLSpanElement>());
  const chipRefs = React.useRef(new Map<string, HTMLSpanElement>());

  // The drawing code reads the latest props from here. Declared before the canvases so it runs first.
  React.useEffect(() => {
    configRef.current = { projection, grid, pitch: dotPitch, south, north, maxHalo, reveal, revealFrom, items };
  });

  const loop = useAnimationLoop(stageRef, step);
  const palette = usePalette(stageRef, GEO_TOKENS, () => {
    engineRef.current.inkDirty = true;
    loop.kick();
  });
  const base = useCanvas(
    baseRef,
    (surface) => {
      const engine = engineRef.current;
      rebuild(engine, configRef.current, surface.width, surface.height, baseRef.current);
      engine.baseDirty = true;
      setSize((previous) =>
        previous && previous.width === surface.width && previous.height === surface.height
          ? previous
          : { width: surface.width, height: surface.height },
      );
      loop.kick();
    },
    { maxDpr: 2 },
  );
  const live = useCanvas(liveRef, () => loop.kick(), { maxDpr: 2 });
  const effects = useCanvas(
    effectsRef,
    (surface) => {
      const engine = engineRef.current;
      engine.fxOffsetX = -surface.canvas.offsetLeft;
      engine.fxOffsetY = -surface.canvas.offsetTop;
    },
    { maxDpr: 2 },
  );

  // Props that change the geometry or the markers re-sync the engine (the canvas resize path covers size changes).
  // rebuild reads the latest props through configRef.
  React.useEffect(() => {
    const engine = engineRef.current;
    if (engine.width && engine.height) rebuild(engine, configRef.current, engine.width, engine.height, baseRef.current);
    loop.kick();
  }, [projection, grid, dotPitch, south, north, maxHalo, items, loop, engineRef]);

  // The reveal: decided once on mount (the mode comes through configRef, so a later change does not re-run it);
  // "view" waits until a third of the map is on screen.
  React.useEffect(() => {
    const engine = engineRef.current;
    const stage = stageRef.current;
    if (engine.reveal.state === "init") {
      const mode = configRef.current?.reveal ?? "view";
      if (mode === "none" || prefersReducedMotion()) {
        engine.reveal.state = "done";
        engine.baseDirty = true;
        loop.kick();
        return;
      }
      engine.reveal.state = "pending";
      if (mode === "mount") {
        engine.reveal.triggered = true;
        engine.reveal.start = performance.now() / 1000;
        loop.kick();
        return;
      }
    }
    // effects run twice in development: the second run sets the observer up again
    if (engine.reveal.state !== "pending" || engine.reveal.triggered || !stage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        engine.reveal.triggered = true;
        observer.disconnect();
        loop.kick();
      },
      { threshold: 0.3 },
    );
    observer.observe(stage);
    return () => observer.disconnect();
  }, [loop, engineRef]);

  // Selection and hover reach the halos; a new selection fires a ring and a few sparks from its marker.
  React.useEffect(() => {
    const engine = engineRef.current;
    const previous = engine.selected;
    engine.selected = shownSelection;
    engine.hovered = hovered ?? focused;
    if (shownSelection !== null && shownSelection !== previous && engine.started) {
      fireSelection(engine, shownSelection, dotRefs.current.get(shownSelection));
    }
    engine.started = true;
    loop.kick();
  }, [shownSelection, hovered, focused, loop, engineRef]);

  // Label chips: measured after every render and placed so they never overlap. Positions are written to the DOM
  // directly, anchored on the marker's side, so a chip whose value rolls to a new width stays attached.
  React.useLayoutEffect(() => {
    if (!size) return;
    const anchors: LabelAnchor[] = [];
    const chips: HTMLSpanElement[] = [];
    for (const entry of chipEntries) {
      const chip = chipRefs.current.get(entry.id);
      if (!chip) continue;
      anchors.push({
        x: entry.x,
        y: entry.y,
        width: chip.offsetWidth,
        height: chip.offsetHeight,
        priority: entry.priority,
        gap: entry.gap,
      });
      chips.push(chip);
    }
    // markers without a chip join as empty anchors, so chips steer clear of their dots too
    const chipCount = anchors.length;
    for (const entry of placed) {
      if (!chipRefs.current.has(entry.marker.id))
        anchors.push({ x: entry.x, y: entry.y, width: 0, height: 0, priority: -1 });
    }
    const placements = placeLabels(anchors, size.width, size.height);
    for (let i = 0; i < chipCount; i++) {
      const placement = placements[i];
      // a chip that only fits over another marker stays hidden, unless the user is pointing at its marker
      if (placement.visible && chipEntries[i].priority < FORCED_PRIORITY && coversMarker(placement, anchors, i)) {
        placement.visible = false;
      }
      placeChip(chips[i], placement, anchors[i], size.width, size.height);
    }
  });

  function step(time: number, delta: number) {
    const engine = engineRef.current;
    if (engine.inkDirty && palette.current) {
      engine.ink = geoInk(palette.current);
      applyInk(engine);
      engine.inkDirty = false;
      engine.baseDirty = true;
    }
    const surface = live.current;
    const lattice = engine.lattice;
    if (!surface || !lattice || !engine.ink || !engine.buffers) return false;
    const baseSurface = base.current;
    if (engine.baseDirty && baseSurface) {
      bakeLand(baseSurface, lattice, engine.ink.land);
      engine.baseDirty = false;
      setCanvasVisible(baseSurface.canvas, engine.reveal.state === "done" || engine.reveal.state === "fading");
    }
    const reduced = prefersReducedMotion();
    const config = configRef.current;
    let busy = false;

    // the reveal front, in threshold units (n·0.82 + jitter·0.18), or Infinity once the land is all there
    const reveal = engine.reveal;
    if (reveal.state === "pending" && reveal.triggered) {
      if (reduced) {
        finishReveal(engine);
      } else {
        reveal.state = "running";
        if (reveal.start < 0) reveal.start = time;
        placeRevealOrigin(engine, config?.revealFrom);
      }
    }
    if (reveal.state === "running" && reduced) finishReveal(engine);
    let front = reveal.state === "pending" ? -1 : Infinity;
    if (reveal.state === "running") {
      const t = (time - reveal.start) / reveal.duration;
      front = easeOutCubic(t) * (1 + REVEAL_BAND + 0.02);
      if (t >= 1) {
        reveal.state = "fading";
        reveal.fadeEnd = time + CROSSFADE_MS / 1000;
        setCanvasVisible(baseRef.current, true, true);
      }
      busy = true;
    }
    if (reveal.state === "fading") {
      front = Infinity;
      if (time >= reveal.fadeEnd) reveal.state = "done";
      busy = true;
    }

    // halos open as the front passes them, then grow on their springs
    const emphasisFocus = engine.selected;
    for (const halo of engine.halos.values()) {
      if (!halo.open && halo.live) {
        const reach =
          reveal.state === "running" ? markerThreshold(engine, halo) : reveal.state === "pending" ? Infinity : -1;
        if (front > reach) {
          halo.open = true;
          halo.growth.target = 1;
          if (reveal.state === "running") popDot(dotRefs.current.get(halo.id));
        }
      }
      halo.emphasis.target =
        emphasisFocus === null || halo.id === emphasisFocus ? 1 : halo.id === engine.hovered ? 0.8 : DIMMED;
      if (reduced) {
        settle(halo.growth);
        settle(halo.radius);
        settle(halo.emphasis);
      } else {
        springStep(halo.growth, halo.growth.target, delta, 180, 0.82);
        springStep(halo.radius, halo.radius.target, delta, 180, 0.82);
        springStep(halo.emphasis, halo.emphasis.target, delta, 240, 1);
        halo.growth.position = Math.max(0, halo.growth.position);
        halo.radius.position = Math.max(0, halo.radius.position);
        if (isMoving(halo.growth) || isMoving(halo.radius) || isMoving(halo.emphasis)) busy = true;
      }
      if (!halo.live && halo.radius.position < 0.3 && halo.growth.position < 0.02) engine.halos.delete(halo.id);
    }

    const pulsing = drawLive(engine, surface, time, front, reduced);
    if (pulsing && !reduced) busy = true;
    if (engine.pings.length) busy = true;

    const fx = effects.current;
    if (fx) {
      if (engine.sparks.active) {
        fx.context.clearRect(0, 0, fx.width, fx.height);
        engine.sparks.step(fx.context, delta);
        engine.fxDirty = true;
        busy = true;
      } else if (engine.fxDirty) {
        fx.context.clearRect(0, 0, fx.width, fx.height);
        engine.fxDirty = false;
      }
    }
    return busy;
  }

  function focusMarker(id: string) {
    setActive(id);
    buttonRefs.current.get(id)?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const direction = ARROW_DIRECTIONS[event.key];
    if (direction) {
      event.preventDefault();
      const next = spatialNavigate(placed, index, direction);
      if (next !== index) focusMarker(placed[next].marker.id);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusMarker(placed[event.key === "Home" ? 0 : placed.length - 1].marker.id);
      return;
    }
    if (event.key === "Escape" && shownSelection !== null) {
      event.preventDefault();
      event.stopPropagation();
      setSelected(null);
    }
  }

  function handleStageClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (target instanceof Element && target.closest("[data-slot=geo-marker-map-marker]")) return;
    setSelected(null);
  }

  return (
    <div
      data-slot="geo-marker-map"
      role="group"
      aria-roledescription="map"
      aria-label={label}
      className={cn("relative w-full select-none [-webkit-tap-highlight-color:transparent]", className)}
      style={{ aspectRatio: aspect, ...style }}
      {...props}
    >
      <div ref={stageRef} className="absolute inset-0" onClick={handleStageClick}>
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${round2(layout.width)} ${round2(layout.height)}`}
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 block size-full overflow-visible"
        >
          <path
            d={layout.outline}
            vectorEffect="non-scaling-stroke"
            className="fill-muted/35 stroke-border"
            strokeWidth={1}
          />
        </svg>
        <canvas ref={baseRef} aria-hidden="true" className="absolute inset-0 block size-full" />
        <canvas ref={liveRef} aria-hidden="true" className="absolute inset-0 block size-full" />
        <canvas
          ref={effectsRef}
          aria-hidden="true"
          className="pointer-events-none absolute -top-10 -left-4 z-[3] block h-[calc(100%+80px)] w-[calc(100%+32px)] sm:-left-10 sm:w-[calc(100%+80px)]"
        />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[1]">
          {chipEntries.map((entry) => (
            <span
              key={entry.id}
              ref={(node) => {
                if (node) chipRefs.current.set(entry.id, node);
                else chipRefs.current.delete(entry.id);
              }}
              data-selected={entry.selected ? "" : undefined}
              className="absolute top-0 left-0 flex w-max items-baseline gap-1.5 rounded-md border border-border bg-card/90 px-1.5 py-0.5 text-[11.5px] leading-4 whitespace-nowrap text-foreground opacity-0 shadow-[0_1px_2px_rgb(0_0_0/0.06)] backdrop-blur-[2px] transition-opacity duration-150 data-[selected]:border-[color-mix(in_srgb,var(--lumesec)_55%,var(--border))] motion-reduce:transition-none"
            >
              <span className="font-medium">{entry.marker.label}</span>
              {entry.marker.value !== undefined && Number.isFinite(entry.marker.value) && (
                <ChipValue value={entry.marker.value} text={format(entry.marker.value)} />
              )}
            </span>
          ))}
        </div>
        <div className="absolute inset-0 z-[2]">
          {placed.map((entry, index) => {
            const { marker } = entry;
            const isSelected = marker.id === shownSelection;
            const tone = marker.tone ?? "accent";
            const valueText =
              marker.value !== undefined && Number.isFinite(marker.value) ? `, ${format(marker.value)}` : "";
            return (
              <button
                key={marker.id}
                ref={(node) => {
                  if (node) buttonRefs.current.set(marker.id, node);
                  else buttonRefs.current.delete(marker.id);
                }}
                type="button"
                data-slot="geo-marker-map-marker"
                data-state={isSelected ? "on" : "off"}
                aria-pressed={isSelected}
                aria-label={`${marker.label ?? marker.id}${valueText}`}
                tabIndex={marker.id === tabStop ? 0 : -1}
                onClick={() => {
                  setActive(marker.id);
                  setSelected((current) => (current === marker.id ? null : marker.id));
                }}
                onKeyDown={(event) => handleKeyDown(event, index)}
                onFocus={(event) => {
                  setActive(marker.id);
                  if (event.currentTarget.matches(":focus-visible")) setFocused(marker.id);
                }}
                onBlur={() => setFocused((current) => (current === marker.id ? null : current))}
                onPointerEnter={(event) => {
                  if (event.pointerType === "mouse") setHovered(marker.id);
                }}
                onPointerLeave={() => setHovered((current) => (current === marker.id ? null : current))}
                className="group/marker absolute -mt-3 -ml-3 grid size-6 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-lumesec focus-visible:outline-solid"
                style={{ left: percent(entry.left), top: percent(entry.top) }}
              >
                <span
                  ref={(node) => {
                    if (node) dotRefs.current.set(marker.id, node);
                    else dotRefs.current.delete(marker.id);
                  }}
                  className={cn(
                    "block rounded-full shadow-[0_0_0_1.5px_var(--card)] [transition:box-shadow_.2s_ease,scale_.18s_cubic-bezier(.2,.8,.2,1)] group-hover/marker:scale-125 group-data-[state=on]/marker:shadow-[0_0_0_2px_var(--card),0_0_0_4px_var(--lumesec)] motion-reduce:transition-none",
                    TONE_CLASSES[tone] ?? TONE_CLASSES.accent,
                    SIZE_CLASSES[marker.size ?? "md"] ?? SIZE_CLASSES.md,
                  )}
                />
              </button>
            );
          })}
        </div>
        {items.length === 0 && (
          <p className="pointer-events-none absolute inset-x-0 bottom-[12%] z-[1] m-0 text-center text-[12px] leading-4 text-muted-foreground">
            {emptyText}
          </p>
        )}
      </div>
    </div>
  );
}

/** A chip's value: tabular figures that roll up when the value grows and down when it shrinks. */
function ChipValue({ value, text }: { value: number; text: string }) {
  // derived state: which way the figures roll
  const [shown, setShown] = React.useState({ value, direction: 1 });
  if (shown.value !== value) setShown({ value, direction: value >= shown.value ? 1 : -1 });
  return (
    <RollText
      text={text}
      direction={shown.direction}
      className="font-mono text-[11px] text-muted-foreground tabular-nums"
    />
  );
}

/* Constants ------------------------------------------------------------------------------------------ */

/** Width the server lays markers out at; percentages make it exact at any width with the same aspect. */
const NOMINAL_WIDTH = 1000;
/** Width at which `maxHalo` applies in full. */
const REFERENCE_WIDTH = 660;
/** Below this width the default label mode shows only the selected marker. */
const NARROW_WIDTH = 480;
/** Chips at or above this priority (selected, hovered, focused) show even when they must cover another marker. */
const FORCED_PRIORITY = 2000;
/** In the `all` mode, at most one label chip per this many px of map width. */
const LABEL_SPACING = 120;
/** Halo scale relative to REFERENCE_WIDTH: smaller maps shrink halos to 60%, larger ones grow them to 150%. */
const haloScale = (width: number) => clamp(width / REFERENCE_WIDTH, 0.6, 1.5);
/** Land dot sizes in CSS px: an odd device-pixel size would blur, so both snap to whole device pixels. */
const LAND_DOT = 1.5;
const LIT_DOT = 2;
const CORE_DOT = 2.5;
/** Width of a halo's growth front in threshold units. */
const HALO_BAND = 0.07;
/** Width of the reveal's bright front in threshold units. */
const REVEAL_BAND = 0.06;
const REVEAL_SECONDS = 1.4;
const REPLAY_SECONDS = 0.95;
const CROSSFADE_MS = 120;
const PULSE_PERIOD = 2.4;
const PULSE_SECONDS = 1.2;
const PING_SECONDS = 0.75;
/** Halo brightness of the markers that are not selected while one is. */
const DIMMED = 0.45;

const DOT_SIZE: Record<MapMarkerSize, number> = { sm: 6, md: 8, lg: 10 };
const SIZE_CLASSES: Record<MapMarkerSize, string> = { sm: "size-1.5", md: "size-2", lg: "size-2.5" };
const TONE_CLASSES: Record<MapMarkerTone, string> = {
  accent: "bg-lumesec",
  info: "bg-lumesec-info",
  success: "bg-lumesec-success",
  warning: "bg-lumesec-warning",
  destructive: "bg-destructive",
  muted: "bg-muted-foreground",
};
const TONES: readonly MapMarkerTone[] = ["accent", "info", "success", "warning", "destructive", "muted"];

const POP_KEYFRAMES: Keyframe[] = [
  { scale: "1" },
  { scale: "1.7", offset: 0.32 },
  { scale: "0.9", offset: 0.68 },
  { scale: "1" },
];

const SPARK_OPTIONS = { speed: [50, 190], life: [0.35, 0.85], size: [1.5, 2.5], drag: 3.2, jitter: 2 } as const;

/** 14 demo cities with invented request counts per minute. */
const DEMO_VALUES: readonly (readonly [id: string, value: number, extra?: Partial<MapMarker>])[] = [
  ["lhr", 48200, { pulse: true }],
  ["jfk", 52600],
  ["nrt", 41200, { pulse: true }],
  ["sfo", 36400],
  ["sin", 33900],
  ["fra", 31800],
  ["bom", 27300],
  ["gru", 21400, { tone: "warning", pulse: true }],
  ["ord", 18900],
  ["dxb", 14800],
  ["syd", 12600],
  ["mex", 9800],
  ["los", 7600],
  ["jnb", 6400],
];

const DEMO_MARKERS: readonly MapMarker[] = DEMO_VALUES.flatMap(([id, value, extra]) => {
  const city = DEMO_CITIES.find((entry) => entry.id === id);
  return city ? [{ id, label: city.name, lat: city.lat, lon: city.lon, value, ...extra }] : [];
});

/* Layout ---------------------------------------------------------------------------------------------- */

/** A marker that lies inside the map, with its position in px and as shares of the box's width and height. */
interface PlacedMarker {
  marker: MapMarker;
  x: number;
  y: number;
  left: number;
  top: number;
}

interface ChipEntry {
  id: string;
  x: number;
  y: number;
  gap: number;
  priority: number;
  marker: MapMarker;
  selected: boolean;
}

const positive = (value: number | undefined) =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
const round2 = (value: number) => Math.round(value * 100) / 100;

/** Whether a placed chip box covers the dot of any other anchor. */
function coversMarker(placement: LabelPlacement, anchors: readonly LabelAnchor[], own: number) {
  const box = anchors[own];
  const margin = 4;
  for (let j = 0; j < anchors.length; j++) {
    if (j === own) continue;
    const { x, y } = anchors[j];
    const inside =
      x > placement.x - margin &&
      x < placement.x + box.width + margin &&
      y > placement.y - margin &&
      y < placement.y + box.height + margin;
    if (inside) return true;
  }
  return false;
}

/** Writes a placement to a chip, anchored on the marker's side so later width changes keep it attached. */
function placeChip(
  chip: HTMLSpanElement,
  placement: LabelPlacement,
  anchor: LabelAnchor,
  width: number,
  height: number,
) {
  const style = chip.style;
  if (!placement.visible) {
    style.opacity = "0";
    return;
  }
  const gap = anchor.gap ?? 6;
  style.opacity = "1";
  style.left = "auto";
  style.right = "auto";
  style.top = "auto";
  style.bottom = "auto";
  if (placement.side === "right" || placement.side === "left") {
    if (placement.side === "right") style.left = `${anchor.x + gap}px`;
    else style.right = `${width - anchor.x + gap}px`;
    style.top = `${anchor.y}px`;
    style.transform = "translateY(-50%)";
  } else {
    style.left = `${anchor.x}px`;
    if (placement.side === "top") style.bottom = `${height - anchor.y + gap}px`;
    else style.top = `${anchor.y + gap}px`;
    style.transform = "translateX(-50%)";
  }
}

/* Engine ---------------------------------------------------------------------------------------------- */

interface TargetSpring extends Spring {
  /** Where the spring settles. */
  target: number;
}

const spring = (value: number): TargetSpring => ({ position: value, velocity: 0, target: value });

function settle(state: TargetSpring) {
  state.position = state.target;
  state.velocity = 0;
}

const isMoving = (state: TargetSpring) =>
  Math.abs(state.position - state.target) > 0.002 || Math.abs(state.velocity) > 0.01;

/** The latest props the drawing code needs. */
interface MapConfig {
  projection: GeoMarkerMapProjection;
  grid: GeoMarkerMapGrid;
  pitch: number;
  south: number;
  north: number;
  maxHalo: number;
  reveal: GeoMarkerMapReveal;
  revealFrom: string | LatLon | undefined;
  items: readonly MapMarker[];
}

/** A marker's halo. Lives on after its marker is removed, until it has shrunk away. */
interface Halo {
  id: string;
  lat: number;
  lon: number;
  x: number;
  y: number;
  /** Whether the marker lies inside the map crop. */
  inside: boolean;
  /** Index into TONES. */
  tone: number;
  pulse: boolean;
  /** Pulse offset in seconds, so pulsing markers do not ring in step. */
  phase: number;
  /** Radius in px; springs from the old size to the new one when the value changes. */
  radius: TargetSpring;
  /** 0 to 1: the growth front, from the marker outward. */
  growth: TargetSpring;
  /** 1, or dimmed while another marker is selected. */
  emphasis: TargetSpring;
  /** Whether the reveal front has passed the marker, so its halo may grow. */
  open: boolean;
  /** False once the marker is gone; the halo then shrinks and is dropped. */
  live: boolean;
}

/** A one-shot lattice ring from a newly selected marker. */
interface Ping {
  x: number;
  y: number;
  start: number;
  tone: number;
}

interface RevealState {
  state: "init" | "pending" | "running" | "fading" | "done";
  /** Set once the trigger (mount or view) has fired. */
  triggered: boolean;
  /** Start time in seconds, or −1 to start on the next frame. */
  start: number;
  duration: number;
  fadeEnd: number;
  /** Origin in px and the distance to the farthest corner. */
  x: number;
  y: number;
  reach: number;
  /** The requested origin, resolved on the first frame. */
  from: string | LatLon | undefined;
}

/** Per-dot scratch for compositing halos and rings: the brightest offer wins, so overlapping halos never stack. */
interface DotBuffers {
  alpha: Float32Array;
  shade: Float32Array;
  owner: Uint8Array;
  stamp: Uint32Array;
  touched: Int32Array;
}

/** Everything the animation loop mutates. Lives in a ref, never in React state. */
interface Engine {
  projection: MapProjection | null;
  lattice: DotLattice | null;
  buffers: DotBuffers | null;
  width: number;
  height: number;
  /** Projection, grid, pitch and crop; a change after the reveal replays it. */
  geometry: string;
  ink: GeoInk | null;
  halos: Map<string, Halo>;
  reveal: RevealState;
  pings: Ping[];
  sparks: Sparks;
  fxDirty: boolean;
  fxOffsetX: number;
  fxOffsetY: number;
  selected: string | null;
  hovered: string | null;
  /** Set after the first selection sync, so an initial selection does not fire sparks. */
  started: boolean;
  /** One batch per tone; each ramps land → tone → shine. */
  batches: DotBatch[];
  /** The reveal's batch: land → shine. */
  landBatch: DotBatch;
  /** The theme changed: re-read the ink on the next frame. */
  inkDirty: boolean;
  /** The land layer needs repainting (new lattice or theme). */
  baseDirty: boolean;
  frame: number;
  touchedCount: number;
  /** The grid-query visitor and its parameters, reused for every halo and ring. */
  visit: Visit;
  visitDot: (index: number, distanceSquared: number) => void;
}

function createEngine(): Engine {
  const grey: RGB = [128, 128, 128];
  const engine: Engine = {
    projection: null,
    lattice: null,
    buffers: null,
    width: 0,
    height: 0,
    geometry: "",
    ink: null,
    halos: new Map(),
    reveal: {
      state: "init",
      triggered: false,
      start: -1,
      duration: REVEAL_SECONDS,
      fadeEnd: 0,
      x: 0,
      y: 0,
      reach: 1,
      from: undefined,
    },
    pings: [],
    sparks: new Sparks(),
    fxDirty: false,
    fxOffsetX: 40,
    fxOffsetY: 40,
    selected: null,
    hovered: null,
    started: false,
    batches: TONES.map(() => createDotBatch(1024, [grey, grey, grey], { tones: 24 })),
    landBatch: createDotBatch(4096, [grey, grey], { tones: 12 }),
    inkDirty: true,
    baseDirty: true,
    frame: 0,
    touchedCount: 0,
    visit: {
      kind: "halo",
      tone: 0,
      radius: 1,
      growth: 0,
      emphasis: 1,
      activity: 0,
      ringWidth: 5,
      ringAlpha: 1,
      unevenness: 4,
    },
    visitDot: () => {},
  };
  engine.visitDot = createVisitor(engine, engine.visit);
  return engine;
}

function createBuffers(count: number): DotBuffers {
  return {
    alpha: new Float32Array(count),
    shade: new Float32Array(count),
    owner: new Uint8Array(count),
    stamp: new Uint32Array(count),
    touched: new Int32Array(count),
  };
}

/**
 * Re-ramps every batch after a theme change: land → tone → highlight. The accent highlights toward the shine token
 * (made for dot fields); status tones intensify toward the foreground instead, since a warm tone mixed with violet
 * turns brown.
 */
function applyInk(engine: Engine) {
  const ink = engine.ink;
  if (!ink) return;
  engine.batches.forEach((batch, tone) => {
    const color = toneColor(ink, TONES[tone]);
    const highlight = TONES[tone] === "accent" ? ink.shine : mixRgb(color, ink.foreground, 0.4);
    batch.setRamp([ink.land, color, highlight]);
  });
  engine.landBatch.setRamp([ink.land, ink.shine]);
}

/** Matches the halos to the markers: new ones start closed, changed values spring, removed ones shrink away. */
function syncHalos(engine: Engine, config: MapConfig, jump: boolean) {
  const map = engine.projection;
  if (!map) return;
  const point = createScreenPoint();
  const scale = haloScale(engine.width);
  const minimum = config.pitch * 1.5;
  const reduced = prefersReducedMotion();
  let maxValue = 0;
  for (const marker of config.items) maxValue = Math.max(maxValue, positive(marker.value));
  const seen = new Set<string>();
  for (const marker of config.items) {
    if (seen.has(marker.id) || !Number.isFinite(marker.lat) || !Number.isFinite(marker.lon)) continue;
    seen.add(marker.id);
    const inside = map.project(marker.lat, marker.lon, point);
    const amount = positive(marker.value);
    const target =
      inside && maxValue > 0 && amount > 0
        ? Math.max(minimum, config.maxHalo * Math.sqrt(amount / maxValue) * scale)
        : 0;
    const tone = Math.max(0, TONES.indexOf(marker.tone ?? "accent"));
    let halo = engine.halos.get(marker.id);
    if (!halo) {
      const opened = engine.reveal.state === "done" || engine.reveal.state === "fading";
      halo = {
        id: marker.id,
        lat: marker.lat,
        lon: marker.lon,
        x: point.x,
        y: point.y,
        inside,
        tone,
        pulse: Boolean(marker.pulse),
        phase: ((stringHash(marker.id) % 997) / 997) * PULSE_PERIOD,
        radius: spring(target),
        growth: { position: 0, velocity: 0, target: opened ? 1 : 0 },
        emphasis: spring(1),
        open: opened,
        live: true,
      };
      engine.halos.set(marker.id, halo);
    }
    halo.lat = marker.lat;
    halo.lon = marker.lon;
    halo.x = point.x;
    halo.y = point.y;
    halo.inside = inside;
    halo.tone = tone;
    halo.pulse = Boolean(marker.pulse) && inside;
    halo.live = true;
    halo.radius.target = target;
    if (halo.open) halo.growth.target = 1;
    if (jump || reduced) settle(halo.radius);
  }
  for (const halo of engine.halos.values()) {
    if (seen.has(halo.id)) continue;
    // a removed marker: re-project in case the box changed, then collapse into the point
    halo.inside = map.project(halo.lat, halo.lon, point);
    halo.x = point.x;
    halo.y = point.y;
    halo.live = false;
    halo.pulse = false;
    halo.radius.target = 0;
    halo.growth.target = 0;
    if (jump || reduced) {
      settle(halo.radius);
      settle(halo.growth);
    }
  }
}

function startReveal(engine: Engine, duration: number, from: string | LatLon | undefined) {
  const reveal = engine.reveal;
  reveal.state = "pending";
  reveal.triggered = true;
  reveal.start = -1;
  reveal.duration = duration;
  reveal.from = from;
}

function finishReveal(engine: Engine) {
  engine.reveal.state = "done";
  for (const halo of engine.halos.values()) {
    if (!halo.live) continue;
    halo.open = true;
    halo.growth.target = 1;
  }
}

/** Resolves the reveal origin (a marker id, a point, or the first marker) to px, and the reach to the far corner. */
function placeRevealOrigin(engine: Engine, fallback: string | LatLon | undefined) {
  const reveal = engine.reveal;
  const map = engine.projection;
  const from = reveal.from ?? fallback;
  let x = engine.width / 2;
  let y = engine.height / 2;
  const point = createScreenPoint();
  if (typeof from === "string") {
    const halo = engine.halos.get(from);
    if (halo?.inside) ({ x, y } = halo);
  } else if (from && map) {
    map.project(from.lat, from.lon, point);
    x = clamp(point.x, 0, engine.width);
    y = clamp(point.y, 0, engine.height);
  } else {
    const first = [...engine.halos.values()].find((halo) => halo.live && halo.inside);
    if (first) ({ x, y } = first);
  }
  reveal.x = x;
  reveal.y = y;
  reveal.reach = Math.max(1, Math.hypot(Math.max(x, engine.width - x), Math.max(y, engine.height - y)));
  reveal.from = undefined;
}

/** The front value at which a halo opens: as the reveal passes its marker. */
function markerThreshold(engine: Engine, halo: Halo) {
  const { x, y, reach } = engine.reveal;
  return (Math.hypot(halo.x - x, halo.y - y) / reach) * 0.82 + 0.09;
}

/** Builds the projection and lattice for the box and the latest props, and re-places the halos. */
function rebuild(
  engine: Engine,
  config: MapConfig | null,
  width: number,
  height: number,
  base: HTMLCanvasElement | null,
) {
  if (!config || !width || !height) return;
  const map = createProjection(config.projection, { width, height, latRange: [config.south, config.north] });
  const lattice = mapLattice(map, {
    pitch: config.pitch,
    layout: config.grid === "honeycomb" ? "honeycomb" : "square",
  });
  const geometry = `${config.projection}|${config.grid}|${config.pitch}|${config.south}|${config.north}`;
  const resized = engine.width !== width || engine.height !== height;
  const replay = engine.geometry !== "" && engine.geometry !== geometry && engine.reveal.state === "done";
  engine.projection = map;
  engine.width = width;
  engine.height = height;
  engine.geometry = geometry;
  if (engine.lattice !== lattice) {
    engine.lattice = lattice;
    engine.buffers = createBuffers(lattice.count);
    engine.baseDirty = true;
  }
  syncHalos(engine, config, resized);
  if (replay && config.reveal !== "none" && !prefersReducedMotion()) {
    // a new grid prints itself again from the selection (or the reveal origin)
    startReveal(engine, REPLAY_SECONDS, engine.selected ?? config.revealFrom);
    setCanvasVisible(base, false);
  }
}

/** A new selection: the dot pops, a ring runs through the lattice and sparks fly, past the map's edge if need be. */
function fireSelection(engine: Engine, id: string, dot: HTMLElement | undefined) {
  const halo = engine.halos.get(id);
  if (!halo || !halo.inside || prefersReducedMotion()) return;
  popDot(dot);
  engine.pings.push({ x: halo.x, y: halo.y, start: performance.now() / 1000, tone: halo.tone });
  const ink = engine.ink;
  if (ink) {
    const colors = [ink.accent, ink.glint, toneColor(ink, TONES[halo.tone])];
    engine.sparks.add(halo.x + engine.fxOffsetX, halo.y + engine.fxOffsetY, 22, colors, SPARK_OPTIONS);
  }
}

/** Pops a marker's dot: when the reveal reaches it and when it is selected. */
function popDot(dot: HTMLElement | undefined) {
  if (dot && typeof dot.animate === "function" && !prefersReducedMotion()) {
    dot.animate(POP_KEYFRAMES, { duration: 460, easing: "cubic-bezier(.2,.8,.2,1)" });
  }
}

/** Shows or hides the baked land layer, fading it in when asked. */
function setCanvasVisible(canvas: HTMLCanvasElement | null, visible: boolean, fade = false) {
  if (!canvas) return;
  canvas.style.opacity = visible ? "1" : "0";
  if (visible && fade && typeof canvas.animate === "function") {
    canvas.animate([{ opacity: 0 }, { opacity: 1 }], { duration: CROSSFADE_MS, easing: "linear" });
  }
}

/* Drawing --------------------------------------------------------------------------------------------- */

/** The static land layer: one colour, every dot snapped to device pixels. */
function bakeLand(surface: CanvasSurface, lattice: DotLattice, color: RGB) {
  const { context, width, height, dpr } = surface;
  context.clearRect(0, 0, width, height);
  context.fillStyle = rgba(color);
  const half = LAND_DOT / 2;
  for (let i = 0; i < lattice.count; i++) {
    const x = Math.round((lattice.x[i] - half) * dpr) / dpr;
    const y = Math.round((lattice.y[i] - half) * dpr) / dpr;
    context.fillRect(x, y, LAND_DOT, LAND_DOT);
  }
}

/** State of the dot visitor, so a grid query needs no closure per halo and frame. */
interface Visit {
  kind: "halo" | "ring";
  tone: number;
  radius: number;
  growth: number;
  emphasis: number;
  /** 0..1: how fast the front moves, so a settled rim does not keep flashing. */
  activity: number;
  ringWidth: number;
  ringAlpha: number;
  unevenness: number;
}

/**
 * The grid-query visitor of an engine: lights one dot for the halo or ring described by `visit`. Offers composite per
 * dot: the brightest offer keeps its colour and the shade (toward shine) never drops, so overlapping halos never stack.
 */
function createVisitor(engine: Engine, visit: Visit) {
  function offer(index: number, alpha: number, shade: number) {
    const buffers = engine.buffers;
    if (!buffers) return;
    if (buffers.stamp[index] !== engine.frame) {
      buffers.stamp[index] = engine.frame;
      buffers.alpha[index] = 0;
      buffers.shade[index] = 0;
      buffers.touched[engine.touchedCount++] = index;
    }
    if (alpha > buffers.alpha[index]) {
      buffers.alpha[index] = alpha;
      buffers.owner[index] = visit.tone;
    }
    if (shade > buffers.shade[index]) buffers.shade[index] = shade;
  }

  return function visitDot(index: number, distanceSquared: number) {
    const lattice = engine.lattice;
    if (!lattice) return;
    const distance = Math.sqrt(distanceSquared);
    const jitter = lattice.jitter[index];
    if (visit.kind === "ring") {
      const strength = ringFront(distance, visit.radius, visit.ringWidth, jitter, visit.unevenness) * visit.ringAlpha;
      if (strength >= 0.04) offer(index, 0.3 + 0.7 * strength, 0.5 + 0.5 * Math.min(1, strength * 1.4));
      return;
    }
    const n = distance / visit.radius;
    // the uneven front: near dots first, jitter scatters the rim
    const lead = visit.growth - (n * 0.82 + jitter * 0.18);
    if (lead <= 0) return;
    // the rim thins out: fewer dots toward the edge
    if (lattice.density[index] > 1 - smoothstep(0.7, 1.22, n) * 0.85) return;
    const appear = Math.min(1, lead / HALO_BAND);
    const core = Math.max(0, 1 - n);
    // pure tone: the falloff is in alpha, so a warm tone never muddies toward the grey of the land
    let alpha = (0.42 + 0.58 * Math.sqrt(core)) * appear * visit.emphasis;
    let shade = 0.5;
    if (visit.activity > 0 && lead < HALO_BAND) {
      const flash = (1 - lead / HALO_BAND) * visit.activity;
      alpha += flash * 0.5;
      shade += (1 - shade) * flash * 0.85;
    }
    offer(index, alpha, shade);
  };
}

/**
 * Draws the live layer: the reveal (while it runs), then every halo, pulse and selection ring composited per dot.
 * Returns whether a marker pulses (the loop keeps running for it).
 */
function drawLive(engine: Engine, surface: CanvasSurface, time: number, front: number, reduced: boolean) {
  const { context, width, height, dpr } = surface;
  const lattice = engine.lattice;
  const buffers = engine.buffers;
  if (!lattice || !buffers) return false;
  context.clearRect(0, 0, width, height);

  if (engine.reveal.state === "running" || engine.reveal.state === "fading")
    drawReveal(engine, context, lattice, front, dpr);

  const { visit, visitDot } = engine;
  engine.frame = (engine.frame + 1) >>> 0 || 1;
  engine.touchedCount = 0;
  const scale = haloScale(engine.width);
  let pulsing = false;

  for (const halo of engine.halos.values()) {
    if (!halo.inside) continue;
    const radius = halo.radius.position;
    const growth = halo.growth.position;
    if (radius > 0.3 && growth > 0.001) {
      visit.kind = "halo";
      visit.tone = halo.tone;
      visit.radius = radius;
      visit.growth = growth;
      visit.emphasis = halo.emphasis.position;
      visit.activity = reduced
        ? 0
        : clamp(Math.abs(halo.growth.velocity) * 0.35 + Math.abs(halo.radius.velocity) / 24, 0, 1);
      lattice.grid.query(halo.x, halo.y, radius / 0.82 + 1, visitDot);
    }
    if (halo.pulse && halo.open) {
      pulsing = true;
      visit.kind = "ring";
      visit.tone = halo.tone;
      if (reduced) {
        // a still ring of brighter dots stands in for the pulse
        visit.radius = 13 * scale;
        visit.ringWidth = 3;
        visit.ringAlpha = 0.7;
        visit.unevenness = 2;
        lattice.grid.query(halo.x, halo.y, visit.radius + 12, visitDot);
      } else {
        const t = ((((time + halo.phase) % PULSE_PERIOD) + PULSE_PERIOD) % PULSE_PERIOD) / PULSE_SECONDS;
        if (t < 1) {
          visit.radius = (3 + 34 * t) * scale;
          visit.ringWidth = 5;
          visit.ringAlpha = Math.pow(1 - t, 1.4);
          visit.unevenness = 4;
          lattice.grid.query(halo.x, halo.y, visit.radius + 14, visitDot);
        }
      }
    }
  }

  // selection rings: fast, then gone
  if (engine.pings.length) engine.pings = engine.pings.filter((ping) => time - ping.start < PING_SECONDS);
  for (const ping of engine.pings) {
    const t = Math.max(0, time - ping.start) / PING_SECONDS;
    visit.kind = "ring";
    visit.tone = ping.tone;
    visit.radius = 2 + 46 * easeOutCubic(t) * scale;
    visit.ringWidth = 4;
    visit.ringAlpha = Math.pow(1 - t, 1.5);
    visit.unevenness = 3;
    lattice.grid.query(ping.x, ping.y, visit.radius + 12, visitDot);
  }

  for (let k = 0; k < engine.touchedCount; k++) {
    const i = buffers.touched[k];
    // the hot middle of a halo, and ring crests, print a size larger
    const size = buffers.alpha[i] >= 0.84 || buffers.shade[i] >= 0.75 ? CORE_DOT : LIT_DOT;
    engine.batches[buffers.owner[i]].add(
      snapCenter(lattice.x[i], size, dpr),
      snapCenter(lattice.y[i], size, dpr),
      size,
      buffers.shade[i],
      Math.min(1, buffers.alpha[i]),
    );
  }
  for (const batch of engine.batches) batch.flush(context);
  return pulsing;
}

/** The land prints itself outward from the origin behind a bright, uneven front. */
function drawReveal(
  engine: Engine,
  context: CanvasRenderingContext2D,
  lattice: DotLattice,
  front: number,
  dpr: number,
) {
  const { x: ox, y: oy, reach } = engine.reveal;
  const batch = engine.landBatch;
  for (let i = 0; i < lattice.count; i++) {
    const dx = lattice.x[i] - ox;
    const dy = lattice.y[i] - oy;
    const lead = front - ((Math.sqrt(dx * dx + dy * dy) / reach) * 0.82 + lattice.jitter[i] * 0.18);
    if (lead <= 0) continue;
    const flash = lead < REVEAL_BAND ? 1 - lead / REVEAL_BAND : 0;
    const size = flash > 0.4 ? LIT_DOT : LAND_DOT;
    batch.add(
      snapCenter(lattice.x[i], size, dpr),
      snapCenter(lattice.y[i], size, dpr),
      size,
      flash,
      Math.min(1, lead / 0.025),
    );
  }
  batch.flush(context);
}
