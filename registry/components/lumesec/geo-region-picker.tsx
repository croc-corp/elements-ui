"use client";

import * as React from "react";

import { fillSquare, useCanvas, type CanvasSurface } from "@/lib/lumesec/canvas";
import { usePalette } from "@/lib/lumesec/color";
import {
  buildArcLength,
  createProjection,
  createScreenPoint,
  cubicBezier,
  distanceKm,
  fiberRttMs,
  flatPaths,
  forEachDot,
  GEO_TOKENS,
  geoInk,
  interpolateGreatCircle,
  mapLattice,
  projectionAspect,
  projectionOutlineSvgPath,
  spatialNavigate,
  unwrapLongitude,
  wrapLongitude,
  type ArcLengthTable,
  type DotLattice,
  type GeoInk,
  type LatLon,
  type MapProjection,
} from "@/lib/lumesec/geo";
import { DEMO_REGIONS, formatNumber, type GeoRegion } from "@/lib/lumesec/geo-data";
import { clamp, mixRgb, percent, rgba, smoothstep, TAU } from "@/lib/lumesec/math";
import { prefersReducedMotion, springStep, useAnimationLoop, useLazyRef } from "@/lib/lumesec/motion";
import { RollText } from "@/lib/lumesec/roll-text";
import { Sparks, type SparkOptions } from "@/lib/lumesec/sparks";
import { useControllableState, useFormReset } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** A region to choose from: `{ id, label, city, timeZone, lat, lon }`, re-exported from the geo data module. */
export type { GeoRegion } from "@/lib/lumesec/geo-data";

/** Props of `GeoRegionPicker`; the remaining `div` props go to the root. */
export interface GeoRegionPickerProps extends Omit<React.ComponentProps<"div">, "defaultValue"> {
  /** Selected region id (controlled). Use with `onValueChange`. An id that is not in `regions` selects nothing. */
  value?: string;
  /** Selected region id when uncontrolled. */
  defaultValue?: string;
  /** Called with the region id when the user picks a region. */
  onValueChange?: (value: string) => void;
  /**
   * Regions to choose from, in list order: `{ id, label, city, timeZone, lat, lon }`. Regions with a repeated id or a
   * non-finite position are skipped. Without it the picker shows the 16 demo regions. An empty array shows
   * "No regions".
   */
  regions?: readonly GeoRegion[];
  /** Location the latency hints are measured from, with the label its map point shows (default `From`). */
  from?: LatLon & { label?: string };
  /** How much longer the network path is than the straight fibre distance, for the hints. */
  stretch?: number;
  /** Which parts are shown: the map above the list, the map with a compact wrap of chips, or the list alone. */
  layout?: "both" | "map" | "list";
  /** Form field name. With a name and a selected region, a hidden input submits the region id. */
  name?: string;
  /** Marks the group as required (`aria-required`). */
  required?: boolean;
  /** Dims the picker and takes it out of the tab order. */
  disabled?: boolean;
  /** Visible heading of the list, and the accessible name of the radiogroup. */
  label?: string;
}

/**
 * Pick a deployment region from a list with a dot map above it. The selection reticle travels to the new region
 * along the great-circle path on a spring (long trips take longer), trailing a short comet, and a lens magnifies the
 * land dots under it as it passes. At rest the lens stays on the selected region.
 *
 * With `from`, every region shows an estimated round trip, and pointing at a row or a map point draws a dotted line
 * from that location to the region. The list is a radiogroup with one tab stop: Up and Down follow the list, Left and
 * Right jump to the nearest region west or east on the map.
 *
 * @example
 * <GeoRegionPicker name="region" defaultValue="eu-west" from={{ lat: 40.42, lon: -3.7, label: "Madrid office" }} />
 */
export function GeoRegionPicker({
  value,
  defaultValue = "eu-central",
  onValueChange,
  regions,
  from,
  stretch = 1.5,
  layout = "both",
  name,
  required = false,
  disabled = false,
  label = "Region",
  ref,
  className,
  ...props
}: GeoRegionPickerProps) {
  const list = React.useMemo(() => usableRegions(regions ?? DEMO_REGIONS), [regions]);
  const [selectedId, setSelectedId] = useControllableState<string>({ value, defaultValue, onChange: onValueChange });
  const selectedIndex = list.findIndex((region) => region.id === selectedId);
  const selected = selectedIndex >= 0 ? list[selectedIndex] : null;
  const labelId = React.useId();

  const origin = from && Number.isFinite(from.lat) && Number.isFinite(from.lon) ? from : null;
  const fromLat = origin?.lat;
  const fromLon = origin?.lon;
  const fromLabel = origin?.label || "From";
  const factor = Number.isFinite(stretch) && stretch > 0 ? stretch : 1.5;

  const [rowHover, setRowHover] = React.useState<number | null>(null);
  const [mapHover, setMapHover] = React.useState<number | null>(null);
  const [focusPreview, setFocusPreview] = React.useState<number | null>(null);
  const previewCandidate = rowHover ?? mapHover ?? focusPreview;
  const previewIndex = previewCandidate !== null && previewCandidate < list.length ? previewCandidate : null;
  const hoverRegion = mapHover !== null ? list[mapHover] : undefined;

  /** Region positions on the nominal 1000 px map: SSR-safe percentages and the spatial keyboard order. */
  const points = React.useMemo(() => list.map((region) => nominalPoint(region)), [list]);
  const hints = React.useMemo(() => {
    if (fromLat === undefined || fromLon === undefined) return null;
    const start: LatLon = { lat: fromLat, lon: fromLon };
    return list.map((region) => roundTripMs(start, region, factor));
  }, [list, fromLat, fromLon, factor]);
  const fromPoint = React.useMemo(
    () => (fromLat === undefined || fromLon === undefined ? null : nominalPoint({ lat: fromLat, lon: fromLon })),
    [fromLat, fromLon],
  );
  const fromSide = React.useMemo(
    () => (fromPoint ? labelSide(fromPoint, fromLabel, points) : "right"),
    [fromPoint, fromLabel, points],
  );

  // The server markup places the reticle with `left` and `top`; the frame loop moves it from there with a transform.
  const [reticleOrigin] = React.useState(() => (selectedIndex >= 0 ? points[selectedIndex] : MAP_MIDDLE));

  const rootRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<HTMLDivElement>(null);
  const baseRef = React.useRef<HTMLCanvasElement>(null);
  const marksRef = React.useRef<HTMLCanvasElement>(null);
  const effectsRef = React.useRef<HTMLCanvasElement>(null);
  const reticleRef = React.useRef<HTMLDivElement>(null);
  const bracketsRef = React.useRef<HTMLDivElement>(null);
  const groupRef = React.useRef<HTMLDivElement>(null);
  /** The map engine, created on first use in an effect, handler or frame (never during render). */
  const engineRef = useLazyRef(() => new RegionMap());
  /** The first scroll of the list jumps; later ones glide. */
  const scrolledRef = React.useRef(false);

  React.useImperativeHandle(ref, () => rootRef.current!, []);

  /** Where the map's top-left corner sits on the effects layer, in CSS px (offsets ignore the gallery's zoom). */
  function measureEffects() {
    const layer = effectsRef.current;
    if (layer) engineRef.current.setEffectsOffset(-layer.offsetLeft, -layer.offsetTop);
  }

  const loop = useAnimationLoop(rootRef, step);
  const palette = usePalette(rootRef, GEO_TOKENS, applyTheme);
  const base = useCanvas(
    baseRef,
    (surface) => {
      engineRef.current.layout(surface.width, surface.height, surface.dpr);
      loop.kick();
    },
    MAP_CANVAS,
  );
  const marks = useCanvas(
    marksRef,
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

  function step(_time: number, delta: number) {
    const engine = engineRef.current;
    const moving = engine.step(base.current, marks.current, effects.current, delta);
    placeReticle(engine);
    return moving;
  }

  /** Moves the DOM reticle to the engine's point, relative to where the server markup put it. */
  function placeReticle(engine: RegionMap) {
    const node = reticleRef.current;
    const box = engine.size;
    const point = engine.reticle;
    if (!node || !box || !point.shown) return;
    const dx = point.x - (reticleOrigin.x / NOMINAL_WIDTH) * box.width;
    const dy = point.y - (reticleOrigin.y / NOMINAL_HEIGHT) * box.height;
    node.style.transform = `translate3d(${dx.toFixed(2)}px,${dy.toFixed(2)}px,0)`;
  }

  function applyTheme() {
    const colors = palette.current;
    if (!colors) return;
    engineRef.current.setInk(geoInk(colors));
    loop.kick();
  }

  useFormReset(rootRef, () => setSelectedId(defaultValue));

  // The engine reports the reticle's arrival from the frame loop: the brackets snap in.
  React.useEffect(() => {
    engineRef.current.onArrive = () => {
      const node = bracketsRef.current;
      if (!node || typeof node.animate !== "function" || prefersReducedMotion()) return;
      node.animate(SNAP_KEYFRAMES, SNAP_TIMING);
    };
  });

  React.useEffect(() => {
    engineRef.current.setRegions(list, selectedIndex);
    loop.kick();
  }, [list, selectedIndex, engineRef, loop]);

  React.useEffect(() => {
    engineRef.current.setSelected(selectedIndex, !prefersReducedMotion());
    loop.kick();
  }, [selectedIndex, engineRef, loop]);

  React.useEffect(() => {
    engineRef.current.setFrom(fromLat === undefined || fromLon === undefined ? null : { lat: fromLat, lon: fromLon });
    loop.kick();
  }, [fromLat, fromLon, engineRef, loop]);

  React.useEffect(() => {
    engineRef.current.setPreview(previewIndex ?? -1);
    loop.kick();
  }, [previewIndex, engineRef, loop]);

  // Keep the selected row inside the scrolling list, whichever way it was picked.
  React.useEffect(() => {
    const group = groupRef.current;
    if (!group || selectedIndex < 0 || group.scrollHeight <= group.clientHeight) return;
    const row = group.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    if (!row) return;
    const top = row.offsetTop - SCROLL_MARGIN;
    const bottom = row.offsetTop + row.offsetHeight + SCROLL_MARGIN;
    let next = group.scrollTop;
    if (top < group.scrollTop) next = top;
    else if (bottom > group.scrollTop + group.clientHeight) next = bottom - group.clientHeight;
    const glide = scrolledRef.current && !prefersReducedMotion();
    scrolledRef.current = true;
    if (Math.abs(next - group.scrollTop) > 0.5) group.scrollTo({ top: next, behavior: glide ? "smooth" : "auto" });
  }, [selectedIndex, layout]);

  function select(index: number) {
    const region = list[index];
    if (disabled || !region) return;
    setSelectedId(region.id);
  }

  function focusRadio(index: number) {
    groupRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus({ preventScroll: true });
  }

  function handleGroupKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled || list.length === 0) return;
    const radio = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-index]") : null;
    const index = radio ? Number(radio.dataset.index) : NaN;
    if (!Number.isInteger(index) || index < 0 || index >= list.length) return;
    const last = list.length - 1;
    let next: number;
    switch (event.key) {
      case "ArrowDown":
        next = index >= last ? 0 : index + 1;
        break;
      case "ArrowUp":
        next = index <= 0 ? last : index - 1;
        break;
      case "ArrowRight":
        next = neighbourOnMap(points, index, "right");
        break;
      case "ArrowLeft":
        next = neighbourOnMap(points, index, "left");
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    select(next);
    if (next !== index) focusRadio(next);
  }

  /** The region nearest to a pointer position on the map, within the hit radius, or −1. */
  function regionAt(clientX: number, clientY: number) {
    const box = mapRef.current;
    if (!box || !box.offsetWidth) return -1;
    const rect = box.getBoundingClientRect();
    if (!rect.width || !rect.height) return -1;
    // nominal map units, so the gallery's zoom does not matter
    const x = ((clientX - rect.left) / rect.width) * NOMINAL_WIDTH;
    const y = ((clientY - rect.top) / rect.height) * NOMINAL_HEIGHT;
    const radius = (HIT_RADIUS / box.offsetWidth) * NOMINAL_WIDTH;
    let best = -1;
    let bestDistance = radius * radius;
    points.forEach((point, i) => {
      const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    return best;
  }

  function handleMapPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch" || disabled) return;
    const index = regionAt(event.clientX, event.clientY);
    setMapHover(index >= 0 ? index : null);
  }

  /** A press on a map target picks the region nearest to the pointer (targets of close regions overlap). */
  function handleMarkerClick(event: React.MouseEvent<HTMLButtonElement>, own: number) {
    const index = regionAt(event.clientX, event.clientY);
    const pick = index >= 0 ? index : own;
    select(pick);
    focusRadio(pick);
  }

  function radioProps(region: GeoRegion, i: number) {
    const checked = i === selectedIndex;
    const tabStop = selectedIndex >= 0 ? selectedIndex : 0;
    const hint = hints ? hints[i] : null;
    return {
      type: "button" as const,
      role: "radio",
      "aria-checked": checked,
      "aria-label": `${region.label}, ${region.city}${hint !== null ? `, about ${spokenMs(hint)} round trip` : ""}`,
      "data-index": i,
      "data-state": checked ? "checked" : "unchecked",
      "data-active": i === previewIndex ? "" : undefined,
      tabIndex: disabled || i !== tabStop ? -1 : 0,
      disabled,
      onClick: () => select(i),
      onPointerEnter: (event: React.PointerEvent<HTMLButtonElement>) => {
        if (event.pointerType !== "touch") setRowHover(i);
      },
      onPointerLeave: () => setRowHover(null),
      onFocus: (event: React.FocusEvent<HTMLButtonElement>) => {
        // keyboard focus previews the line from `from`; focus that follows a click does not
        if (event.currentTarget.matches(":focus-visible")) setFocusPreview(i);
      },
      onBlur: () => setFocusPreview(null),
    };
  }

  return (
    <div
      ref={rootRef}
      data-slot="geo-region-picker"
      data-disabled={disabled ? "" : undefined}
      className={cn(
        "grid w-full max-w-[400px] gap-3 text-foreground [-webkit-tap-highlight-color:transparent] data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <div
        hidden={layout === "list"}
        className="rounded-xl border border-border bg-card p-2 shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)]"
      >
        <div
          ref={mapRef}
          aria-hidden="true"
          className="relative w-full select-none"
          style={{ aspectRatio: MAP_ASPECT }}
          onPointerMove={handleMapPointerMove}
          onPointerLeave={() => setMapHover(null)}
        >
          <canvas ref={baseRef} className="pointer-events-none absolute inset-0 block size-full" />
          <canvas
            ref={marksRef}
            className="pointer-events-none absolute block"
            style={{
              inset: -MARK_PAD,
              width: `calc(100% + ${MARK_PAD * 2}px)`,
              height: `calc(100% + ${MARK_PAD * 2}px)`,
            }}
          />
          {list.map((region, i) => (
            <button
              key={region.id}
              type="button"
              tabIndex={-1}
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => handleMarkerClick(event, i)}
              className="absolute -mt-3 -ml-3 size-6 cursor-pointer rounded-full border-0 bg-transparent p-0 outline-none"
              style={{ left: percentX(points[i]), top: percentY(points[i]) }}
            />
          ))}
          {fromPoint ? (
            <span
              className="pointer-events-none absolute rounded-[4px] bg-card/85 px-1 text-[10.5px] leading-[15px] font-medium whitespace-nowrap text-foreground"
              style={sideLabelStyle(fromPoint, fromSide)}
            >
              {fromLabel}
            </span>
          ) : null}
          {hoverRegion && mapHover !== null ? (
            <span
              className="pointer-events-none absolute z-[1] flex items-center gap-1.5 rounded-md border border-border bg-card/95 px-1.5 py-0.5 text-[11.5px] leading-4 whitespace-nowrap shadow-[0_6px_16px_-10px_rgb(0_0_0/0.5)]"
              style={hoverLabelStyle(points[mapHover])}
            >
              <span className="font-medium text-foreground">{hoverRegion.label}</span>
              <span className="text-muted-foreground">{hoverRegion.city}</span>
              {hints ? (
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                  {hintText(hints[mapHover])}
                </span>
              ) : null}
            </span>
          ) : null}
          <div
            ref={reticleRef}
            data-hidden={selectedIndex < 0 ? "" : undefined}
            className="pointer-events-none absolute z-[2] -mt-2.5 -ml-2.5 size-5 transition-opacity duration-150 will-change-transform data-[hidden]:opacity-0 motion-reduce:transition-none"
            style={{ left: percentX(reticleOrigin), top: percentY(reticleOrigin) }}
          >
            <div ref={bracketsRef} className="absolute inset-0">
              <span className="absolute top-0 left-0 size-[5px] border-t-[1.5px] border-l-[1.5px] border-lumesec" />
              <span className="absolute top-0 right-0 size-[5px] border-t-[1.5px] border-r-[1.5px] border-lumesec" />
              <span className="absolute bottom-0 left-0 size-[5px] border-b-[1.5px] border-l-[1.5px] border-lumesec" />
              <span className="absolute right-0 bottom-0 size-[5px] border-r-[1.5px] border-b-[1.5px] border-lumesec" />
            </div>
            <span className="absolute top-1/2 left-1/2 -mt-[1.5px] -ml-[1.5px] size-[3px] bg-lumesec" />
          </div>
          <canvas
            ref={effectsRef}
            className="pointer-events-none absolute -inset-x-3 -inset-y-8 z-[3] block h-[calc(100%+64px)] w-[calc(100%+24px)] min-[480px]:-inset-x-10 min-[480px]:w-[calc(100%+80px)]"
          />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)]">
        <div className="flex h-7 items-center justify-between gap-3 border-b border-border px-3 text-[12px] leading-4">
          <span id={labelId} className="shrink-0 font-medium text-foreground">
            {label}
          </span>
          {origin ? (
            layout === "map" ? (
              selected && hints ? (
                <span aria-hidden="true" className="flex min-w-0 items-center gap-1 text-muted-foreground">
                  <span className="font-mono text-foreground tabular-nums">
                    <LatencyHint ms={hints[selectedIndex]} />
                  </span>
                  <span className="truncate">from {fromLabel}</span>
                </span>
              ) : null
            ) : (
              <span aria-hidden="true" className="min-w-0 truncate text-muted-foreground">
                Round trip from {fromLabel}
              </span>
            )
          ) : null}
        </div>
        <div
          ref={groupRef}
          role="radiogroup"
          aria-labelledby={labelId}
          aria-required={required || undefined}
          aria-disabled={disabled || undefined}
          onKeyDown={handleGroupKeyDown}
          className={cn(
            "relative",
            layout === "map"
              ? "flex flex-wrap gap-1.5 p-2"
              : "grid max-h-[191px] [scrollbar-width:thin] overflow-y-auto p-1",
          )}
        >
          {list.length === 0 ? (
            <p className="m-0 grid h-[68px] w-full place-items-center text-[12.5px] text-muted-foreground">
              No regions
            </p>
          ) : layout === "map" ? (
            list.map((region, i) => (
              <button
                key={region.id}
                {...radioProps(region, i)}
                className="group/chip inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-2 font-[inherit] text-[12px] leading-4 font-medium text-foreground transition-colors duration-150 outline-none hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-lumesec focus-visible:outline-solid data-[active]:bg-muted/60 data-[state=checked]:border-[color-mix(in_srgb,var(--lumesec)_55%,var(--border))] data-[state=checked]:bg-lumesec/8 motion-reduce:transition-none"
              >
                <RadioDot />
                {region.label}
              </button>
            ))
          ) : (
            list.map((region, i) => (
              <button
                key={region.id}
                {...radioProps(region, i)}
                className="group/chip flex h-[34px] w-full min-w-0 shrink-0 cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2.5 text-left font-[inherit] transition-colors duration-150 outline-none hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid data-[active]:bg-muted/60 motion-reduce:transition-none"
              >
                <RadioDot />
                <span className="shrink-0 text-[13px] leading-4 font-medium text-foreground">{region.label}</span>
                <span className="min-w-0 truncate text-[12.5px] leading-4 text-muted-foreground">{region.city}</span>
                {hints ? (
                  <span className="ml-auto shrink-0 pl-2 text-right font-mono text-[12px] leading-4 text-muted-foreground tabular-nums group-data-[state=checked]/chip:text-foreground">
                    <LatencyHint ms={hints[i]} />
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>

      {name && selected ? <input type="hidden" name={name} value={selected.id} /> : null}
    </div>
  );
}

/* Parts ----------------------------------------------------------------------------------------------- */

/** The 8 px radio square: a hairline frame, filled with the accent when checked. */
function RadioDot() {
  return (
    <span
      aria-hidden="true"
      className="size-2 shrink-0 rounded-[2px] border border-[color-mix(in_srgb,var(--foreground)_30%,var(--border))] transition-colors duration-150 group-data-[state=checked]/chip:border-lumesec group-data-[state=checked]/chip:bg-lumesec motion-reduce:transition-none"
    />
  );
}

/** A round-trip hint as mechanical figures: it rolls up when the time grows and down when it shrinks. */
function LatencyHint({ ms }: { ms: number }) {
  const [shown, setShown] = React.useState({ ms, direction: 1 });
  if (shown.ms !== ms) setShown({ ms, direction: ms >= shown.ms ? 1 : -1 });
  return <RollText text={hintText(ms)} direction={shown.direction} className="justify-items-end" />;
}

/* Helpers --------------------------------------------------------------------------------------------- */

interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Regions with a finite position, the first of each id (ids are React keys and the form value). Returns the list
 * itself when nothing is skipped.
 */
function usableRegions(regions: readonly GeoRegion[]): readonly GeoRegion[] {
  const seen = new Set<string>();
  const usable = regions.filter((region) => {
    if (seen.has(region.id) || !Number.isFinite(region.lat) || !Number.isFinite(region.lon)) return false;
    seen.add(region.id);
    return true;
  });
  return usable.length === regions.length ? regions : usable;
}

/** Estimated round trip in whole ms over fibre, `stretch` times the great-circle distance. */
function roundTripMs(start: LatLon, region: LatLon, stretch: number) {
  return Math.round(fiberRttMs(distanceKm(start, region), stretch));
}

const hintText = (ms: number) => (ms < 1 ? "<1 ms" : `~${formatNumber(ms)} ms`);
const spokenMs = (ms: number) => (ms < 1 ? "under 1 ms" : `${formatNumber(ms)} ms`);

/** Position on the nominal map (1000 px wide), with the latitude held inside the map's crop. */
function nominalPoint(place: LatLon): Point {
  const point = createScreenPoint();
  NOMINAL_PROJECTION.project(clamp(place.lat, LAT_RANGE[0], LAT_RANGE[1]), wrapLongitude(place.lon), point);
  return { x: point.x, y: point.y };
}

const percentX = (point: Point) => percent(point.x / NOMINAL_WIDTH);
const percentY = (point: Point) => percent(point.y / NOMINAL_HEIGHT);

type LabelSide = "right" | "left" | "top" | "bottom";

/** Sides in order of preference. */
const LABEL_SIDES: readonly LabelSide[] = ["right", "left", "top", "bottom"];

/** The `from` label beside its point, on the side `labelSide` chose. */
function sideLabelStyle(point: Point, side: LabelSide): React.CSSProperties {
  const transform =
    side === "right"
      ? `translate(${LABEL_GAP}px, -50%)`
      : side === "left"
        ? `translate(calc(-100% - ${LABEL_GAP}px), -50%)`
        : side === "top"
          ? `translate(-50%, calc(-100% - ${LABEL_GAP}px))`
          : `translate(-50%, ${LABEL_GAP}px)`;
  return { left: percentX(point), top: percentY(point), transform };
}

/**
 * The side of the `from` point whose label box covers the fewest region squares and stays on the map, so the label
 * never hides a region. The box is estimated in nominal units for a map about 380 px wide (the label is DOM text).
 */
function labelSide(anchor: Point, text: string, points: readonly Point[]): LabelSide {
  const scale = NOMINAL_WIDTH / LABEL_MAP_WIDTH;
  const width = (text.length * LABEL_CHAR_WIDTH + 8) * scale;
  const height = LABEL_HEIGHT * scale;
  const gap = LABEL_GAP * scale;
  const reach = (MARKER / 2 + 1) * scale;
  let best: LabelSide = "right";
  let fewest = Infinity;
  for (const side of LABEL_SIDES) {
    const x0 = side === "right" ? anchor.x + gap : side === "left" ? anchor.x - gap - width : anchor.x - width / 2;
    const y0 = side === "top" ? anchor.y - gap - height : side === "bottom" ? anchor.y + gap : anchor.y - height / 2;
    const x1 = x0 + width;
    const y1 = y0 + height;
    let score = x0 < 0 || x1 > NOMINAL_WIDTH || y0 < 0 || y1 > NOMINAL_HEIGHT ? 0.5 : 0;
    for (const point of points) {
      if (point.x > x0 - reach && point.x < x1 + reach && point.y > y0 - reach && point.y < y1 + reach) score += 1;
    }
    if (score < fewest) {
      fewest = score;
      best = side;
    }
  }
  return best;
}

/** The hover label above the point (below it near the top edge), kept inside the map near the sides. */
function hoverLabelStyle(point: Point): React.CSSProperties {
  const fx = point.x / NOMINAL_WIDTH;
  const below = point.y / NOMINAL_HEIGHT < 0.32;
  const x = fx < 0.18 ? "-10px" : fx > 0.82 ? "calc(-100% + 10px)" : "-50%";
  return {
    left: percentX(point),
    top: percentY(point),
    transform: `translate(${x}, ${below ? "10px" : "calc(-100% - 10px)"})`,
  };
}

/**
 * The nearest region west or east on the map (`spatialNavigate`). Past the last region that way it continues around
 * the globe: the other regions are shifted one map width over and searched again.
 */
function neighbourOnMap(points: readonly Point[], index: number, direction: "left" | "right") {
  const next = spatialNavigate(points, index, direction);
  if (next !== index) return next;
  const shift = direction === "right" ? NOMINAL_WIDTH : -NOMINAL_WIDTH;
  const others: number[] = [];
  points.forEach((_, i) => {
    if (i !== index) others.push(i);
  });
  const wrapped = [points[index], ...others.map((i) => ({ x: points[i].x + shift, y: points[i].y }))];
  const found = spatialNavigate(wrapped, 0, direction);
  return found > 0 ? others[found - 1] : index;
}

/* Constants ------------------------------------------------------------------------------------------- */

const LAT_RANGE: readonly [number, number] = [-50, 72];
const MAP_ASPECT = projectionAspect("equalEarth", LAT_RANGE);
const NOMINAL_WIDTH = 1000;
const NOMINAL_HEIGHT = NOMINAL_WIDTH / MAP_ASPECT;
const NOMINAL_PROJECTION = createProjection("equalEarth", {
  width: NOMINAL_WIDTH,
  height: NOMINAL_HEIGHT,
  latRange: LAT_RANGE,
});
const MAP_MIDDLE: Point = { x: NOMINAL_WIDTH / 2, y: NOMINAL_HEIGHT / 2 };
const MAP_CANVAS = { maxDpr: 2 } as const;
/** The marks canvas reaches this far past the map (the map card's padding), so the lens is not cut at the edge. */
const MARK_PAD = 8;
/** Pointer reach of a map region in CSS px (the 24 px targets). */
const HIT_RADIUS = 12;
const SCROLL_MARGIN = 4;

/** Lattice pitch, dot and marker sizes in CSS px. */
const PITCH = 3.5;
const DOT = 1.5;
const MARKER = 7;
const FROM_POINT = 4;

/** The `from` label: its gap to the point and the estimates used to choose its side. */
const LABEL_GAP = 6;
const LABEL_HEIGHT = 15;
const LABEL_CHAR_WIDTH = 5.8;
const LABEL_MAP_WIDTH = 380;

/** The lens: a 28 px disc; dots are pushed out by r' = r·(1 + 0.55·k·(1 − r/28)²) and drawn up to 1.3 times larger. */
const LENS_RADIUS = 28;
const LENS_PUSH = 0.55;
const LENS_GROW = 0.3;
/** Lens strength at rest; it reaches 1 at this travel speed in px/s. */
const LENS_REST = 0.6;
const LENS_FULL_SPEED = 240;

/** The great-circle path is sampled at 64 segments. */
const TRAVEL_SEGMENTS = 64;
const TRAVEL_DAMPING = 0.9;
/** Progress at which the reticle counts as arrived: the brackets snap and the sparks fly. */
const ARRIVAL = 0.985;
/** A retarget carries the reticle's speed into the new path, up to this many paths per second. */
const MAX_CARRY = 4;

/** The comet: 14 squares behind the reticle, spaced by speed, 2 → 1 px and alpha 0.8 → 0. */
const COMET_LENGTH = 14;
const COMET_SPACING_MAX = 4.5;
const COMET_SPACING_PER_SPEED = 0.012;
const COMET_FADE: readonly [number, number] = [24, 160];

/** The line from `from`: drawn on over 250 ms, faded over 180 ms. */
const ARC_MS = 250;
const ARC_FADE_MS = 180;
const ARC_SPACING = 3.5;
const ARC_SEGMENTS = 48;
const ARC_EASE = cubicBezier(0.45, 0, 0.25, 1);

const SNAP_KEYFRAMES: Keyframe[] = [{ transform: "scale(1.4)" }, { transform: "scale(1)" }];
const SNAP_TIMING: KeyframeAnimationOptions = { duration: 260, easing: "cubic-bezier(.2,1.4,.4,1)" };
const ARRIVAL_SPARKS: SparkOptions = { speed: [50, 170], life: [0.3, 0.7], size: [1.5, 2], jitter: 1.5 };

/** Spring stiffness of a trip: stiffer for short hops, softer for long ones, so long trips take longer. */
const travelStiffness = (km: number) => 180 * Math.sqrt(5000 / Math.max(km, 500));

/* Map engine ------------------------------------------------------------------------------------------ */

interface Place {
  /** Latitude held inside the map's crop. */
  readonly lat: number;
  readonly lon: number;
  /** Position on the map in CSS px, updated on resize. */
  x: number;
  y: number;
}

/** One trip of the reticle: the sampled great circle and its projected arc-length table. */
interface Travel {
  readonly lats: Float64Array;
  /** Longitudes east of the central meridian, unwrapped, so the path is continuous across the seam. */
  readonly lambdas: Float64Array;
  readonly xs: Float32Array;
  readonly ys: Float32Array;
  readonly table: ArcLengthTable;
  readonly km: number;
  readonly stiffness: number;
  arrived: boolean;
}

interface Arc {
  readonly index: number;
  readonly tables: ArcLengthTable[];
  readonly start: number;
  /** When the fade started, or −1 while shown. */
  fade: number;
}

/**
 * Everything the map draws, outside React. Three canvases: the land lattice (baked), the marks (the lens, the line
 * from `from`, the region squares and the comet; it reaches 8 px past the map) and a larger effects layer for the
 * arrival sparks, which may fly past the map's edge. The reticle itself is DOM; the component moves it to `reticle`.
 */
class RegionMap {
  /** Called on the frame the reticle arrives at the selected region. */
  onArrive: () => void = () => undefined;

  private ink: GeoInk | null = null;
  private styles = { land: "", landStrong: "", card: "", accent: "", glint: "", preview: "" };
  private box: { width: number; height: number; dpr: number } | null = null;
  private projection: MapProjection | null = null;
  private outline: Path2D | null = null;
  private lattice: DotLattice | null = null;
  private regionsKey: string | null = null;
  private places: Place[] = [];
  private selected = -1;
  private preview = -1;
  private fromKey = "";
  private from: Place | null = null;
  private travel: Travel | null = null;
  private readonly progress = { position: 1, velocity: 0 };
  private readonly point = { lat: 0, lon: 0, x: 0, y: 0, shown: false };
  /** Travel speed in px/s; it drives the comet's spacing and the lens strength. */
  private speed = 0;
  private lens = LENS_REST;
  private arcs: Arc[] = [];
  private readonly sparks = new Sparks();
  private effectsX = 0;
  private effectsY = 0;
  private dirty = true;
  private baseDirty = true;
  private effectsDirty = false;
  private wasMoving = false;
  private readonly scratch = createScreenPoint();
  private readonly sample = { lat: 0, lambda: 0 };

  /** The map's size in CSS px, once laid out. */
  get size(): { readonly width: number; readonly height: number } | null {
    return this.box;
  }

  /** Where the reticle is, in map CSS px, and whether it shows. */
  get reticle(): { readonly x: number; readonly y: number; readonly shown: boolean } {
    return this.point;
  }

  /** New theme colours: the baked land and the marks follow. */
  setInk(ink: GeoInk) {
    this.ink = ink;
    this.styles = {
      land: rgba(ink.land),
      landStrong: rgba(ink.landStrong),
      card: rgba(ink.card),
      accent: rgba(ink.accent),
      glint: rgba(ink.glint),
      preview: rgba(mixRgb(ink.landStrong, ink.accent, 0.55)),
    };
    this.baseDirty = true;
    this.dirty = true;
  }

  /** New map size: projection, lattice, places, the trip and the lines follow. */
  layout(width: number, height: number, dpr: number) {
    this.box = { width, height, dpr };
    const projection = createProjection("equalEarth", { width, height, latRange: LAT_RANGE });
    this.projection = projection;
    this.outline = new Path2D(projectionOutlineSvgPath(projection));
    this.lattice = mapLattice(projection, { pitch: PITCH });
    for (const place of this.places) this.place(place);
    if (this.from) this.place(this.from);
    if (this.travel) this.projectTravel(this.travel);
    this.arcs = this.arcs.flatMap((arc) => {
      if (arc.fade >= 0) return [];
      const next = this.arcTo(arc.index, arc.start);
      return next ? [next] : [];
    });
    this.baseDirty = true;
    this.dirty = true;
  }

  /** The marks canvas was resized (and cleared). */
  invalidate() {
    this.dirty = true;
  }

  /** Position of the map's top-left corner on the effects layer. */
  setEffectsOffset(x: number, y: number) {
    this.effectsX = x;
    this.effectsY = y;
  }

  /** The regions to show. A different set drops any trip and puts the reticle on `selected` at once. */
  setRegions(regions: readonly LatLon[], selected: number) {
    const key = regions.map((region) => `${region.lat},${region.lon}`).join(";");
    if (key === this.regionsKey) return;
    this.regionsKey = key;
    this.places = regions.map((region) => {
      const place: Place = {
        lat: clamp(region.lat, LAT_RANGE[0], LAT_RANGE[1]),
        lon: wrapLongitude(region.lon),
        x: 0,
        y: 0,
      };
      this.place(place);
      return place;
    });
    this.selected = selected < this.places.length ? selected : -1;
    this.jumpTo(this.selected);
    const preview = this.preview;
    this.preview = -1;
    this.arcs = [];
    this.setPreview(preview < this.places.length ? preview : -1);
    this.dirty = true;
  }

  /**
   * Selects a region. With `animate`, the reticle travels there along the great circle from wherever it is now (a
   * change during travel retargets from the current point); otherwise it jumps.
   */
  setSelected(index: number, animate: boolean) {
    if (index === this.selected) return;
    this.selected = index;
    this.dirty = true;
    const target = this.places[index];
    const projection = this.projection;
    if (!target || !animate || !projection || !this.point.shown) {
      this.jumpTo(index);
      return;
    }
    const start: LatLon = { lat: this.point.lat, lon: this.point.lon };
    const km = distanceKm(start, target);
    if (!(km >= 1)) {
      this.jumpTo(index);
      return;
    }
    const carried = this.travel ? Math.abs(this.progress.velocity) * this.travel.table.length : 0;
    const travel = createTravel(start, target, km, projection.centerLon);
    this.projectTravel(travel);
    this.travel = travel;
    this.progress.position = 0;
    this.progress.velocity = travel.table.length > 0 ? Math.min(carried / travel.table.length, MAX_CARRY) : 0;
  }

  /** The location the hints are measured from, or null. */
  setFrom(from: LatLon | null) {
    const key = from ? `${from.lat},${from.lon}` : "";
    if (key === this.fromKey) return;
    this.fromKey = key;
    this.from = from
      ? { lat: clamp(from.lat, LAT_RANGE[0], LAT_RANGE[1]), lon: wrapLongitude(from.lon), x: 0, y: 0 }
      : null;
    if (this.from) this.place(this.from);
    const preview = this.preview;
    this.preview = -1;
    this.arcs = [];
    this.setPreview(preview);
    this.dirty = true;
  }

  /** The region the pointer (or keyboard focus) is on: a dotted line draws to it from `from`. −1 for none. */
  setPreview(index: number) {
    if (index === this.preview) return;
    const now = performance.now();
    const reduced = prefersReducedMotion();
    for (const arc of this.arcs) if (arc.fade < 0) arc.fade = reduced ? now - ARC_FADE_MS : now;
    this.preview = index;
    this.dirty = true;
    const arc = this.arcTo(index, reduced ? now - ARC_MS : now);
    if (arc) this.arcs.push(arc);
  }

  /** One frame. Returns whether to keep going. */
  step(base: CanvasSurface | null, marks: CanvasSurface | null, effects: CanvasSurface | null, delta: number) {
    const ink = this.ink;
    const projection = this.projection;
    if (!ink || !this.box || !projection || !this.lattice || !base || !marks) return false;
    const now = performance.now();
    const reduced = prefersReducedMotion();
    let moving = false;

    if (this.baseDirty) {
      this.bake(base);
      this.baseDirty = false;
    }

    // The trip: progress springs to 1, and the reticle follows the path at that share of its length.
    this.speed = 0;
    const travel = this.travel;
    if (travel) {
      if (reduced) {
        this.progress.position = 1;
        this.progress.velocity = 0;
      } else if (delta > 0) {
        springStep(this.progress, 1, delta, travel.stiffness, TRAVEL_DAMPING);
      }
      const length = travel.table.length;
      this.speed = Math.abs(this.progress.velocity) * length;
      if (!travel.arrived && this.progress.position >= ARRIVAL) {
        travel.arrived = true;
        if (!reduced) this.arrive(travel);
      }
      const resting = Math.abs(1 - this.progress.position) * length < 0.25 && this.speed < 2;
      if (reduced || resting) {
        this.jumpTo(this.selected);
        this.speed = 0;
      } else {
        this.pointOnTravel(travel, clamp(this.progress.position, 0, 1) * length);
        this.point.x = this.scratch.x;
        this.point.y = this.scratch.y;
        this.point.lat = this.sample.lat;
        this.point.lon = wrapLongitude(this.sample.lambda + projection.centerLon);
        moving = true;
      }
    }
    if (!this.travel && this.point.shown) {
      const place = this.places[this.selected];
      if (place) {
        this.point.x = place.x;
        this.point.y = place.y;
      }
    }

    // The lens follows the speed: full strength in flight, 0.6 at rest.
    const lens = reduced ? LENS_REST : LENS_REST + (1 - LENS_REST) * clamp(this.speed / LENS_FULL_SPEED, 0, 1);
    if (Math.abs(lens - this.lens) > 0.001) {
      this.lens = lens;
      this.dirty = true;
    }

    if (this.arcs.length) {
      this.arcs = this.arcs.filter((arc) => arc.fade < 0 || now - arc.fade < ARC_FADE_MS);
      if (this.arcs.some((arc) => arc.fade >= 0 || now - arc.start < ARC_MS)) moving = true;
    }

    // one more frame after the last movement, so everything rests at its final state
    if (this.dirty || moving || this.wasMoving) {
      this.drawMarks(marks, ink, now, reduced);
      this.dirty = false;
    }
    this.wasMoving = moving;
    const sparking = effects ? this.drawEffects(effects, delta) : false;
    return moving || sparking;
  }

  /* internals */

  private place(place: Place) {
    if (!this.projection) return;
    this.projection.project(place.lat, place.lon, this.scratch);
    place.x = this.scratch.x;
    place.y = this.scratch.y;
  }

  /** Ends any trip and puts the reticle on region `index` (hidden for −1). */
  private jumpTo(index: number) {
    this.travel = null;
    this.progress.position = 1;
    this.progress.velocity = 0;
    const place = this.places[index];
    if (!place) {
      this.point.shown = false;
      return;
    }
    this.point.lat = place.lat;
    this.point.lon = place.lon;
    this.point.x = place.x;
    this.point.y = place.y;
    this.point.shown = true;
  }

  /** Projects the trip's samples (unwrapped, so the path runs on past the seam) and measures it. */
  private projectTravel(travel: Travel) {
    const projection = this.projection;
    if (!projection) return;
    for (let i = 0; i < travel.lats.length; i++) {
      projection.projectRelative(travel.lats[i], travel.lambdas[i], this.scratch);
      travel.xs[i] = this.scratch.x;
      travel.ys[i] = this.scratch.y;
    }
    buildArcLength(travel.xs, travel.ys, travel.lats.length, travel.table);
  }

  /**
   * The point `s` px along the trip, into `sample` (lat/lon) and `scratch` (map px). The longitude is wrapped back
   * into the map, so a trip across the seam leaves one edge and comes back in at the other.
   */
  private pointOnTravel(travel: Travel, s: number) {
    const { table, lats, lambdas } = travel;
    const d = clamp(s, 0, table.length);
    let low = 0;
    let high = table.count - 2;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (table.distances[middle] <= d) low = middle;
      else high = middle - 1;
    }
    const span = table.distances[low + 1] - table.distances[low];
    const t = span > 0 ? clamp((d - table.distances[low]) / span, 0, 1) : 0;
    this.sample.lat = lats[low] + (lats[low + 1] - lats[low]) * t;
    this.sample.lambda = lambdas[low] + (lambdas[low + 1] - lambdas[low]) * t;
    this.projection?.projectRelative(this.sample.lat, wrapLongitude(this.sample.lambda), this.scratch);
  }

  /** A dotted great-circle line from `from` to region `index`, or null when there is nothing to draw. */
  private arcTo(index: number, start: number): Arc | null {
    const from = this.from;
    const place = this.places[index];
    const projection = this.projection;
    if (!from || !place || !projection) return null;
    if (Math.hypot(place.x - from.x, place.y - from.y) < 6) return null;
    return {
      index,
      tables: flatPaths(projection, from, place, { geodesic: true, segments: ARC_SEGMENTS }),
      start,
      fade: -1,
    };
  }

  /** The reticle reached the region: the component snaps the brackets; sparks fly, more for longer trips. */
  private arrive(travel: Travel) {
    const ink = this.ink;
    const place = this.places[this.selected];
    if (!ink || !place) return;
    this.onArrive();
    const count = Math.round(6 + 8 * clamp(travel.km / 8000, 0, 1));
    this.sparks.add(place.x + this.effectsX, place.y + this.effectsY, count, [ink.accent, ink.glint], ARRIVAL_SPARKS);
  }

  private bake(surface: CanvasSurface) {
    const { context, width, height, dpr } = surface;
    const lattice = this.lattice;
    context.clearRect(0, 0, width, height);
    if (!lattice) return;
    context.fillStyle = this.styles.land;
    for (let i = 0; i < lattice.count; i++) fillSquare(context, lattice.x[i], lattice.y[i], DOT, dpr);
  }

  private drawMarks(surface: CanvasSurface, ink: GeoInk, now: number, reduced: boolean) {
    const { context, width, height, dpr } = surface;
    context.clearRect(0, 0, width, height);
    context.save();
    context.translate(MARK_PAD, MARK_PAD);
    if (this.point.shown) this.drawLens(context, ink, dpr);
    if (this.arcs.length && this.outline) {
      context.save();
      context.clip(this.outline);
      for (const arc of this.arcs) this.drawArc(context, arc, now, dpr);
      context.restore();
    }
    this.drawPlaces(context, dpr);
    if (this.from) {
      context.fillStyle = this.styles.card;
      fillSquare(context, this.from.x, this.from.y, FROM_POINT + 2, dpr);
      context.fillStyle = this.styles.accent;
      fillSquare(context, this.from.x, this.from.y, FROM_POINT, dpr);
    }
    if (this.travel && !reduced) this.drawComet(context, this.travel, dpr);
    context.restore();
  }

  /**
   * The lens: a card-coloured disc over the baked dots, and the lattice dots inside it pushed outward, enlarged and
   * tinted toward the accent, most at the centre.
   */
  private drawLens(context: CanvasRenderingContext2D, ink: GeoInk, dpr: number) {
    const lattice = this.lattice;
    if (!lattice) return;
    const { x: cx, y: cy } = this.point;
    const strength = this.lens;
    context.save();
    context.beginPath();
    context.arc(cx, cy, LENS_RADIUS, 0, TAU);
    context.fillStyle = this.styles.card;
    context.fill();
    context.clip();
    lattice.grid.query(cx, cy, LENS_RADIUS, (i, distanceSquared) => {
      const r = Math.sqrt(distanceSquared);
      if (r >= LENS_RADIUS) return;
      const u = 1 - r / LENS_RADIUS;
      const push = 1 + LENS_PUSH * strength * u * u;
      // the growth fades out toward the rim, so the lens has no hard edge against the lattice outside
      const size = DOT * (1 + LENS_GROW * strength * Math.min(1, u * 3));
      context.fillStyle = rgba(mixRgb(ink.land, ink.accent, clamp(strength * u, 0, 1)));
      fillSquare(context, cx + (lattice.x[i] - cx) * push, cy + (lattice.y[i] - cy) * push, size, dpr);
    });
    context.restore();
  }

  /** The line from `from`: dotted, brighter toward the region, with a glint head while it draws on. */
  private drawArc(context: CanvasRenderingContext2D, arc: Arc, now: number, dpr: number) {
    const progress = ARC_EASE(clamp((now - arc.start) / ARC_MS, 0, 1));
    const fade = arc.fade < 0 ? 1 : 1 - clamp((now - arc.fade) / ARC_FADE_MS, 0, 1);
    if (fade <= 0) return;
    for (const table of arc.tables) {
      const drawn = table.length * progress;
      const length = Math.max(1, table.length);
      forEachDot(table, ARC_SPACING, 0, drawn, (x, y, s) => {
        const head = progress < 1 ? Math.exp(-(drawn - s) / 10) : 0;
        context.globalAlpha = fade * clamp(0.4 + 0.45 * (s / length) + 0.4 * head, 0, 1);
        context.fillStyle = head > 0.5 ? this.styles.glint : this.styles.accent;
        fillSquare(context, x, y, DOT + 0.5 * head, dpr);
      });
    }
    context.globalAlpha = 1;
  }

  /** Region squares with a 1 px card ring: quiet ones first, then the pointed one, then the selected one on top. */
  private drawPlaces(context: CanvasRenderingContext2D, dpr: number) {
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < this.places.length; i++) {
        const rank = i === this.selected ? 2 : i === this.preview ? 1 : 0;
        if (rank !== pass) continue;
        const place = this.places[i];
        const size = MARKER + (rank > 0 ? 1 : 0);
        context.fillStyle = this.styles.card;
        fillSquare(context, place.x, place.y, size + 2, dpr);
        context.fillStyle = rank === 2 ? this.styles.accent : rank === 1 ? this.styles.preview : this.styles.landStrong;
        fillSquare(context, place.x, place.y, size, dpr);
      }
    }
  }

  /** The comet behind the reticle: spaced by speed, so it stretches in flight and folds into the reticle on arrival. */
  private drawComet(context: CanvasRenderingContext2D, travel: Travel, dpr: number) {
    const spacing = Math.min(COMET_SPACING_MAX, this.speed * COMET_SPACING_PER_SPEED);
    const fade = smoothstep(COMET_FADE[0], COMET_FADE[1], this.speed);
    if (spacing < 0.2 || fade <= 0) return;
    const head = clamp(this.progress.position, 0, 1) * travel.table.length;
    for (let i = 1; i <= COMET_LENGTH; i++) {
      const s = head - i * spacing;
      if (s < 0) break;
      this.pointOnTravel(travel, s);
      const f = (i - 1) / (COMET_LENGTH - 1);
      context.globalAlpha = 0.8 * (1 - f) * fade;
      context.fillStyle = i === 1 ? this.styles.glint : this.styles.accent;
      fillSquare(context, this.scratch.x, this.scratch.y, 2 - f, dpr);
    }
    context.globalAlpha = 1;
  }

  private drawEffects(surface: CanvasSurface, delta: number) {
    const { context, width, height } = surface;
    if (!this.sparks.active) {
      if (this.effectsDirty) {
        context.clearRect(0, 0, width, height);
        this.effectsDirty = false;
      }
      return false;
    }
    context.clearRect(0, 0, width, height);
    this.effectsDirty = true;
    return this.sparks.step(context, delta);
  }
}

/** Samples the great circle from `start` to `target` (latitudes held inside the crop, longitudes unwrapped). */
function createTravel(start: LatLon, target: LatLon, km: number, centerLon: number): Travel {
  const along = interpolateGreatCircle(start, target);
  const count = TRAVEL_SEGMENTS + 1;
  const lats = new Float64Array(count);
  const lambdas = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const point = i === 0 ? start : i === count - 1 ? target : along(i / TRAVEL_SEGMENTS);
    lats[i] = clamp(point.lat, LAT_RANGE[0], LAT_RANGE[1]);
    const lambda = point.lon - centerLon;
    lambdas[i] = i === 0 ? wrapLongitude(lambda) : unwrapLongitude(lambdas[i - 1], lambda);
  }
  const xs = new Float32Array(count);
  const ys = new Float32Array(count);
  return {
    lats,
    lambdas,
    xs,
    ys,
    table: buildArcLength(xs, ys, count),
    km,
    stiffness: travelStiffness(km),
    arrived: false,
  };
}
