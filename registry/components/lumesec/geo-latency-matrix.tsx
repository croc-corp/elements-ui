"use client";

import * as React from "react";

import { snap, useCanvas, type CanvasSurface } from "@/lib/lumesec/canvas";
import { usePalette } from "@/lib/lumesec/color";
import {
  bakeLattice,
  buildArcLength,
  createProjection,
  createScreenPoint,
  cubicBezier,
  DEG,
  distanceKm,
  fiberRttMs,
  flatCurve,
  forEachDot,
  GEO_TOKENS,
  geoInk,
  isValidLatLon,
  latLonToVector,
  mapLattice,
  pointAtDistance,
  projectionAspect,
  quadArcLength,
  ringFront,
  slerpVector,
  unwrapLongitude,
  wrapLongitude,
  type ArcLengthTable,
  type DotLattice,
  type GeoInk,
  type LatLon,
  type MapProjection,
  type QuadCurve,
  type Vec3,
} from "@/lib/lumesec/geo";
import { demoLatency, findRegion, formatDistance, formatNumber } from "@/lib/lumesec/geo-data";
import { clamp, easeOutCubic, hash, mixRgb, rgba, smoothstep, TAU, type RGB } from "@/lib/lumesec/math";
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

/**
 * A region of the matrix: the id that measurements refer to, the text in the headers, the place name and where it
 * is. A `GeoRegion` from `@/lib/lumesec/geo-data` fits as it is.
 */
export interface LatencyRegion {
  /** Unique id that `LatencyMeasurement.from` and `.to` refer to, for example `eu-central`. */
  readonly id: string;
  /** Text in the row and column headers and beside the map's endpoints. Default: the id. */
  readonly label?: string;
  /** Place name in the detail panel and the cells' accessible names, for example `Frankfurt`. Default: the label. */
  readonly city?: string;
  /** Latitude in degrees. */
  readonly lat: number;
  /** Longitude in degrees. */
  readonly lon: number;
}

/** A measured round-trip time from one region to another, in milliseconds. */
export interface LatencyMeasurement {
  /** Id of the region the measurement starts from (the row). */
  readonly from: string;
  /** Id of the region it goes to (the column). */
  readonly to: string;
  /** Round-trip time in milliseconds. */
  readonly ms: number;
}

/** A pair of region ids: one cell of the matrix. */
export interface LatencyPair {
  /** Id of the row's region. */
  readonly from: string;
  /** Id of the column's region. */
  readonly to: string;
}

/** Props of GeoLatencyMatrix. Every other `div` prop goes to the root element. */
export interface GeoLatencyMatrixProps extends Omit<React.ComponentProps<"div">, "defaultValue"> {
  /**
   * Rows and columns, in order. Regions with a repeated id, a latitude outside ±90° or a non-finite coordinate are
   * skipped. Default: eight demo cloud regions from `us-west` to `au-east`.
   */
  regions?: readonly LatencyRegion[];
  /**
   * Round-trip times `{ from, to, ms }` with region ids. Entries that name an unknown region or carry no finite,
   * non-negative `ms` are skipped; pairs without a measurement show "no data". Without `measurements` and `regions` the
   * component shows demo latencies.
   */
  measurements?: readonly LatencyMeasurement[];
  /** Uses a measurement for both directions when only one direction is given. */
  symmetric?: boolean;
  /** The selected pair (controlled), or null for none. Use with `onValueChange`. */
  value?: LatencyPair | null;
  /** The pair selected at first when uncontrolled. Default: the first pair off the diagonal. */
  defaultValue?: LatencyPair | null;
  /** Called with the new pair when the user selects a different cell (click, tap, Enter or Space). */
  onValueChange?: (value: LatencyPair | null) => void;
  /** Pairs at or above this round-trip time, in ms, get a warning mark. */
  slowMs?: number;
  /** Accessible name of the grid. */
  label?: string;
}

/**
 * Round-trip times between regions as a grid of dot blocks: the slower the pair, the more dots are lit, in an even
 * dispersed order, and the more they lean toward the accent. Pairs at or above `slowMs` get a warning mark. Point at a
 * cell, or move through the grid with the arrow keys, and the map beside it shows that pair: the measured route as a
 * dotted accent curve with a packet running along it, against a faint great-circle arc for the fibre minimum. The two
 * endpoints are springs, so the route slides and reshapes from pair to pair instead of redrawing, and the
 * milliseconds, the stretch over the fibre minimum and the distance roll in the direction of change.
 *
 * @example
 * <GeoLatencyMatrix
 *   regions={[
 *     { id: "eu-central", city: "Frankfurt", lat: 50.11, lon: 8.68 },
 *     { id: "ap-southeast", city: "Singapore", lat: 1.35, lon: 103.82 },
 *   ]}
 *   measurements={[{ from: "eu-central", to: "ap-southeast", ms: 162 }]}
 *   onValueChange={(pair) => console.log(pair)}
 * />
 */
export function GeoLatencyMatrix({
  regions,
  measurements,
  symmetric = true,
  value,
  defaultValue,
  onValueChange,
  slowMs = 250,
  label = "Latency between regions",
  className,
  ...props
}: GeoLatencyMatrixProps) {
  const demo = regions === undefined && measurements === undefined;
  const regionList = regions ?? DEMO_MATRIX_REGIONS;
  const measurementList = measurements ?? (demo ? DEMO_MEASUREMENTS : NO_MEASUREMENTS);
  const threshold = Number.isFinite(slowMs) ? slowMs : 250;
  const model = React.useMemo(
    () => buildModel(regionList, measurementList, symmetric, threshold),
    [regionList, measurementList, symmetric, threshold],
  );
  const n = model.size;
  const reducedMotion = useReducedMotion();

  const [selection, setSelection] = useControllableState<LatencyPair | null>({
    value,
    defaultValue: defaultValue === undefined ? firstPair(model) : defaultValue,
    onChange: onValueChange,
  });
  const selectedCell = cellOfPair(model, selection);

  /** The cell under the pointer, or -1. Hover previews a pair; leaving the grid returns to the selection. */
  const [hoverCell, setHoverCell] = React.useState(-1);
  /**
   * The focused cell while focus is inside the grid, or -1. It holds the roving tab stop and previews its pair;
   * when focus leaves the grid, both return to the selection.
   */
  const [focusCell, setFocusCell] = React.useState(-1);
  const cellCount = n * n;
  const hovered = hoverCell < cellCount ? hoverCell : -1;
  const focused = focusCell >= 0 && focusCell < cellCount ? focusCell : -1;
  const tabCell = focused >= 0 ? focused : selectedCell >= 0 ? selectedCell : n > 1 ? 1 : 0;
  const shownCell = hovered >= 0 ? hovered : focused >= 0 ? focused : selectedCell;
  const shownRow = shownCell >= 0 ? Math.floor(shownCell / n) : -1;
  const shownColumn = shownCell >= 0 ? shownCell % n : -1;

  const cardRef = React.useRef<HTMLDivElement>(null);
  const matrixCanvasRef = React.useRef<HTMLCanvasElement>(null);
  const baseRef = React.useRef<HTMLCanvasElement>(null);
  const routeRef = React.useRef<HTMLCanvasElement>(null);
  const fxRef = React.useRef<HTMLCanvasElement>(null);
  const stackRef = React.useRef<HTMLDivElement>(null);
  const fromLabelRef = React.useRef<HTMLSpanElement>(null);
  const toLabelRef = React.useRef<HTMLSpanElement>(null);
  const floorLabelRef = React.useRef<HTMLSpanElement>(null);
  const cellRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  /** Everything the loop mutates, created on first use (never during render). */
  const engineRef = useLazyRef(() => createEngine());

  const loop = useAnimationLoop(cardRef, step);
  const palette = usePalette(cardRef, GEO_TOKENS, () => {
    engineRef.current.inkStale = true;
    loop.kick();
  });
  const matrixLayer = useCanvas(matrixCanvasRef, () => {
    engineRef.current.matrix.dirty = true;
    loop.kick();
  });
  // resizing the backing store clears it, so the land dots are baked again on the next frame
  const baseLayer = useCanvas(
    baseRef,
    () => {
      engineRef.current.baked = false;
      loop.kick();
    },
    MAP_CANVAS,
  );
  const routeLayer = useCanvas(routeRef, () => loop.kick(), MAP_CANVAS);
  const fxLayer = useCanvas(fxRef, () => loop.kick(), MAP_CANVAS);

  // The data: every cell springs to its new dot count, so blocks fill or thin out in rank order.
  React.useEffect(() => {
    const engine = engineRef.current;
    engine.model = model;
    syncMatrix(engine.matrix, model);
    engine.route.targetDirty = true;
    loop.kick();
  }, [model, loop, engineRef]);

  // The pair on show: the frame slides to its cell, the cell twinkles once, and the route slides to the pair.
  React.useEffect(() => {
    const engine = engineRef.current;
    const matrix = engine.matrix;
    if (matrix.active !== shownCell) {
      matrix.active = shownCell;
      if (shownCell >= 0 && !prefersReducedMotion()) {
        matrix.twinkleCell = shownCell;
        matrix.twinkleStart = performance.now() / 1000;
      }
    }
    engine.route.pair = shownCell >= 0 && n > 0 ? { i: Math.floor(shownCell / n), j: shownCell % n } : null;
    engine.route.targetDirty = true;
    matrix.dirty = true;
    loop.kick();
  }, [shownCell, n, loop, engineRef]);

  React.useEffect(() => {
    const matrix = engineRef.current.matrix;
    matrix.selected = selectedCell;
    matrix.dirty = true;
    loop.kick();
  }, [selectedCell, loop, engineRef]);

  // Reduced motion stops the packet and settles every spring; restart the loop so it redraws once.
  React.useEffect(() => {
    engineRef.current.matrix.dirty = true;
    loop.kick();
  }, [reducedMotion, loop, engineRef]);

  const detail = describeCell(model, shownCell);
  // n² names, rebuilt only when the data changes, not on every hover
  const cellLabels = React.useMemo(
    () => Array.from({ length: model.size * model.size }, (_, cell) => cellLabel(model, cell)),
    [model],
  );

  // The endpoint labels follow the springs from the loop, which needs their widths.
  React.useLayoutEffect(() => {
    const widths = engineRef.current.labelWidths;
    widths[0] = fromLabelRef.current?.offsetWidth ?? 0;
    widths[1] = toLabelRef.current?.offsetWidth ?? 0;
    widths[2] = floorLabelRef.current?.offsetWidth ?? 0;
    loop.kick();
  }, [detail.fromText, detail.toText, loop, engineRef]);

  function step(time: number, delta: number) {
    const engine = engineRef.current;
    const colors = palette.current;
    if (!colors) return false;
    const reduced = prefersReducedMotion();
    if (engine.inkStale || !engine.ink) {
      engine.ink = geoInk(colors);
      engine.inkStale = false;
      engine.baked = false;
      engine.matrix.dirty = true;
    }
    const ink = engine.ink;
    let busy = false;

    const matrixSurface = matrixLayer.current;
    if (matrixSurface) {
      const moving = stepMatrix(engine.matrix, time, delta, reduced);
      if (moving || engine.matrix.dirty) {
        drawMatrix(matrixSurface, engine.matrix, ink, time);
        engine.matrix.dirty = false;
      }
      busy = moving;
    }

    const baseSurface = baseLayer.current;
    const routeSurface = routeLayer.current;
    const fxSurface = fxLayer.current;
    if (!baseSurface || !routeSurface || !fxSurface) return busy;
    layoutMap(engine, routeSurface.width, routeSurface.height);
    const { projection, lattice } = engine;
    if (!projection || !lattice) return busy;
    if (!engine.baked) {
      const { context, width, height } = baseSurface;
      context.clearRect(0, 0, width, height);
      bakeLattice(context, lattice, ink.land, MAP_DOT, LAND_ALPHA);
      engine.baked = true;
      const stack = stackRef.current;
      if (stack) stack.style.opacity = "1";
    }
    if (engine.route.targetDirty) retargetRoute(engine, projection);
    resolveCelebration(engine, projection, time, reduced);
    const moving = stepRoute(engine.route, delta, reduced);
    const ambient = drawRoute(engine, routeSurface, projection, lattice, ink, time, reduced);
    placeLabels(engine, projection, [fromLabelRef.current, toLabelRef.current, floorLabelRef.current], delta, reduced);
    const sparks = drawSparks(engine, fxSurface, ink, delta);
    return busy || moving || ambient || sparks;
  }

  function focusCellAt(cell: number) {
    // a resting pointer would keep previewing its own cell; the keyboard takes over
    setHoverCell(-1);
    setFocusCell(cell);
    cellRefs.current[cell]?.focus();
  }

  function commit(cell: number) {
    const pair = pairOfCell(model, cell);
    if (!pair || samePair(pair, selection)) return;
    setSelection(pair);
    const engine = engineRef.current;
    engine.celebrate = cell;
    engine.celebrateAt = performance.now() / 1000;
    loop.kick();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (n === 0) return;
    const current = tabCell;
    let row = Math.floor(current / n);
    let column = current % n;
    switch (event.key) {
      case "ArrowUp":
        row = Math.max(0, row - 1);
        break;
      case "ArrowDown":
        row = Math.min(n - 1, row + 1);
        break;
      case "ArrowLeft":
        column = Math.max(0, column - 1);
        break;
      case "ArrowRight":
        column = Math.min(n - 1, column + 1);
        break;
      case "Home":
        if (event.ctrlKey || event.metaKey) row = 0;
        column = 0;
        break;
      case "End":
        if (event.ctrlKey || event.metaKey) row = n - 1;
        column = n - 1;
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        commit(current);
        return;
      default:
        return;
    }
    event.preventDefault();
    focusCellAt(row * n + column);
  }

  function handleBlur(event: React.FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    // focus left the grid: the tab stop and the preview return to the selected pair
    if (!(next instanceof Node) || !event.currentTarget.contains(next)) setFocusCell(-1);
  }

  const labels = model.regions.map(regionLabel);
  const longest = labels.reduce((max, text) => Math.max(max, Math.min(text.length, MAX_LABEL_CHARS)), 2);
  const lastLength = n > 0 ? Math.min(labels[n - 1].length, MAX_LABEL_CHARS) : 0;
  const rowHeaderWidth = `calc(${longest}ch + 14px)`;
  const headerHeight = `calc(${(longest * Math.SQRT1_2).toFixed(2)}ch + 22px)`;
  // the last column's slanted header reaches past the grid; it may use the gap, never the map beside it
  const overhang = `max(0px, calc(${(lastLength * Math.SQRT1_2).toFixed(2)}ch - var(--cell) / 2 - 18px))`;
  const matrixSize = `calc(var(--cell) * ${n} + ${MATRIX_MARGIN * 2}px)`;

  const rowDirection = useRollDirection(shownRow);
  const columnDirection = useRollDirection(shownColumn);
  const msDirection = useRollDirection(detail.ms);
  const floorDirection = useRollDirection(detail.floor);
  const stretchDirection = useRollDirection(detail.stretch);
  const distanceDirection = useRollDirection(detail.km);
  const animate = !reducedMotion;
  const msText = Number.isFinite(detail.ms) ? formatMsNumber(detail.ms) : "";

  return (
    <div
      data-slot="geo-latency-matrix"
      className={cn("@container w-full max-w-[660px] text-foreground", className)}
      {...props}
    >
      <div
        ref={cardRef}
        className="grid gap-4 rounded-xl border border-border bg-card p-3 [--cell:20px] [-webkit-tap-highlight-color:transparent] @min-[420px]:p-4 @min-[420px]:[--cell:24px] @min-[560px]:grid-cols-[auto_minmax(0,1fr)] @min-[560px]:gap-6"
      >
        <div className="grid content-start justify-items-start gap-3">
          {n === 0 ? (
            <p className="m-0 py-6 text-[12.5px] text-muted-foreground">No regions to compare</p>
          ) : (
            <div
              role="grid"
              aria-label={label}
              aria-readonly="true"
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              className="font-mono text-[10.5px] leading-[14px] select-none"
              style={{ paddingRight: overhang }}
            >
              <div role="rowgroup">
                <div role="row" className="flex" style={{ height: headerHeight }}>
                  <div role="columnheader" className="relative shrink-0" style={{ width: rowHeaderWidth }}>
                    <span className="sr-only">From</span>
                    <span
                      aria-hidden="true"
                      className="absolute right-2.5 bottom-1 grid justify-items-end font-sans text-[10px] leading-[13px] text-muted-foreground/80"
                    >
                      <span>to →</span>
                      <span>from ↓</span>
                    </span>
                  </div>
                  {model.regions.map((region, column) => (
                    <div key={region.id} role="columnheader" className="relative w-(--cell) shrink-0">
                      <span
                        className={cn(
                          "absolute bottom-1.5 left-[calc(var(--cell)/2_-_6px)] block max-w-[14ch] origin-bottom-left -rotate-45 truncate rounded-[3px] px-1 whitespace-nowrap text-muted-foreground transition-colors duration-200 motion-reduce:transition-none",
                          column === shownColumn && "bg-muted text-foreground",
                        )}
                      >
                        {labels[column]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div role="rowgroup" className="relative" onPointerLeave={() => setHoverCell(-1)}>
                <canvas
                  ref={matrixCanvasRef}
                  aria-hidden="true"
                  className="pointer-events-none absolute block"
                  style={{ top: -MATRIX_MARGIN, right: -MATRIX_MARGIN, width: matrixSize, height: matrixSize }}
                />
                {model.regions.map((rowRegion, row) => (
                  <div key={rowRegion.id} role="row" className="flex">
                    <div
                      role="rowheader"
                      className="flex h-(--cell) shrink-0 items-center justify-end pr-1.5"
                      style={{ width: rowHeaderWidth }}
                    >
                      <span
                        className={cn(
                          "truncate rounded-[3px] px-1 text-muted-foreground transition-colors duration-200 motion-reduce:transition-none",
                          row === shownRow && "bg-muted text-foreground",
                        )}
                      >
                        {labels[row]}
                      </span>
                    </div>
                    {model.regions.map((columnRegion, column) => {
                      const cell = row * n + column;
                      return (
                        <div
                          key={columnRegion.id}
                          ref={(node) => {
                            cellRefs.current[cell] = node;
                          }}
                          role="gridcell"
                          tabIndex={cell === tabCell ? 0 : -1}
                          aria-selected={cell === selectedCell}
                          aria-label={cellLabels[cell]}
                          onPointerEnter={() => setHoverCell(cell)}
                          onFocus={() => setFocusCell(cell)}
                          onClick={() => commit(cell)}
                          className="relative size-(--cell) shrink-0 cursor-pointer outline-none"
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
          {n > 0 ? <Legend model={model} slowMs={threshold} /> : null}
        </div>

        <div className="grid min-w-0 content-start gap-3">
          <div className="flex min-h-10 items-start justify-between gap-3">
            {detail.kind === "none" ? (
              <p className="m-0 text-[12.5px] leading-[19px] text-muted-foreground">
                Point at a cell to see the route between two regions.
              </p>
            ) : (
              <div className="min-w-0">
                <p className="sr-only">
                  {detail.kind === "same"
                    ? `${detail.fromText}, ${detail.fromPlace}, same region`
                    : `From ${detail.fromText}, ${detail.fromPlace}, to ${detail.toText}, ${detail.toPlace}`}
                </p>
                {/* one row per endpoint, with the map's endpoint colours; the id column keeps the longest label's
                    width, so nothing shifts while the rows roll */}
                <div
                  aria-hidden="true"
                  className="grid grid-cols-[6px_auto_minmax(0,1fr)] items-center gap-x-2 text-[12.5px] leading-5"
                >
                  <span className="size-1.5 rounded-full bg-foreground" />
                  <RollText
                    text={detail.fromText}
                    direction={rowDirection}
                    animate={animate}
                    reserve={labels}
                    className="font-mono"
                  />
                  <RollText
                    text={detail.fromPlace}
                    direction={rowDirection}
                    animate={animate}
                    className="min-w-0 overflow-hidden text-muted-foreground"
                  />
                  <span
                    className={cn(
                      "size-1.5 rounded-full bg-lumesec transition-opacity duration-200",
                      detail.kind === "same" && "opacity-0",
                    )}
                  />
                  <RollText
                    text={detail.toText}
                    direction={columnDirection}
                    animate={animate}
                    reserve={labels}
                    className="font-mono"
                  />
                  <RollText
                    text={detail.kind === "same" ? "Same region" : detail.toPlace}
                    direction={columnDirection}
                    animate={animate}
                    className="min-w-0 overflow-hidden text-muted-foreground"
                  />
                </div>
              </div>
            )}
            {detail.slow ? (
              <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--lumesec-warning)_45%,var(--border))] px-2 text-[11px] leading-none font-medium text-lumesec-warning">
                <SlowMarkIcon />
                Slow
              </span>
            ) : null}
          </div>

          <div className="rounded-lg border border-border p-1.5">
            <div className="relative w-full" style={{ aspectRatio: MAP_ASPECT }}>
              <div
                ref={stackRef}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-700 ease-out motion-reduce:transition-none"
              >
                <canvas ref={baseRef} className="absolute inset-0 block size-full" />
                <canvas ref={routeRef} className="absolute inset-0 block size-full" />
              </div>
              <canvas
                ref={fxRef}
                aria-hidden="true"
                className="pointer-events-none absolute block"
                style={{
                  inset: -FX_MARGIN,
                  width: `calc(100% + ${FX_MARGIN * 2}px)`,
                  height: `calc(100% + ${FX_MARGIN * 2}px)`,
                }}
              />
              <div role="img" aria-label={mapLabel(detail)} className="absolute inset-0" />
              <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                <span ref={fromLabelRef} className={cn(MAP_LABEL_CLASS, "text-foreground")}>
                  {detail.fromText}
                </span>
                <span ref={toLabelRef} className={cn(MAP_LABEL_CLASS, "text-foreground")}>
                  {detail.toText}
                </span>
                <span
                  ref={floorLabelRef}
                  className={cn(MAP_LABEL_CLASS, "font-sans text-[10px] text-muted-foreground")}
                >
                  fibre minimum
                </span>
              </div>
            </div>
          </div>

          <div className="grid gap-2.5">
            <div className="flex min-h-[34px] items-baseline gap-1.5">
              {msText ? (
                <>
                  <span className="sr-only">{`${msText} milliseconds round trip`}</span>
                  <RollingNumber
                    text={msText}
                    direction={msDirection}
                    animate={animate}
                    className="font-mono text-[28px] leading-[34px] font-medium tracking-[-0.02em] tabular-nums"
                  />
                  <span aria-hidden="true" className="text-[13px] text-muted-foreground">
                    ms
                  </span>
                  <span
                    aria-hidden="true"
                    className="ml-1 inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground"
                  >
                    <RouteSwatch measured />
                    round trip
                  </span>
                </>
              ) : (
                <span className="self-center text-[13px] leading-[34px] text-muted-foreground">{detail.emptyText}</span>
              )}
            </div>
            <dl className="m-0 grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-t border-border pt-2.5">
              <Stat
                label="Fibre minimum"
                text={formatMsText(detail.floor)}
                direction={floorDirection}
                animate={animate}
                swatch={<RouteSwatch />}
              />
              <Stat
                label="Stretch"
                text={formatStretch(detail.stretch)}
                direction={stretchDirection}
                animate={animate}
              />
              <Stat
                label="Distance"
                text={detail.kind === "same" || detail.kind === "none" ? MISSING : formatDistance(detail.km)}
                direction={distanceDirection}
                animate={animate}
              />
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Detail parts ---------------------------------------------------------------------------------------- */

const MAP_LABEL_CLASS =
  "absolute top-0 left-0 rounded-[3px] bg-card/85 px-[3px] font-mono text-[10.5px] leading-[14px] whitespace-nowrap opacity-0 will-change-transform";

/** A number whose characters roll on their own, keyed from the right, so only the digits that change move. */
function RollingNumber({
  text,
  direction,
  animate,
  className,
}: {
  text: string;
  direction: number;
  animate: boolean;
  className?: string;
}) {
  const characters = Array.from(text);
  return (
    <span aria-hidden="true" className={cn("inline-flex", className)}>
      {characters.map((character, index) => (
        <RollText key={characters.length - index} text={character} direction={direction} animate={animate} />
      ))}
    </span>
  );
}

/** One figure under the big number: a small label over a rolling value. */
function Stat({
  label,
  text,
  direction,
  animate,
  swatch,
}: {
  label: string;
  text: string;
  direction: number;
  animate: boolean;
  swatch?: React.ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
        {swatch}
        <span className="truncate">{label}</span>
      </dt>
      <dd className="m-0 font-mono text-[12.5px] leading-[18px] tabular-nums">
        <RollText text={text} direction={direction} animate={animate} />
      </dd>
    </div>
  );
}

/** Three dots in the style of a route: accent for the measured route, faint for the fibre minimum. */
function RouteSwatch({ measured = false }: { measured?: boolean }) {
  return (
    <svg
      viewBox="0 0 12 4"
      aria-hidden="true"
      className={cn("h-1 w-3 shrink-0", measured ? "fill-lumesec" : "fill-foreground/35")}
    >
      {measured ? (
        <>
          <rect x="0" y="1" width="2" height="2" />
          <rect x="5" y="1" width="2" height="2" />
          <rect x="10" y="1" width="2" height="2" />
        </>
      ) : (
        <>
          <rect x="0.25" y="1.25" width="1.5" height="1.5" />
          <rect x="5.25" y="1.25" width="1.5" height="1.5" />
          <rect x="10.25" y="1.25" width="1.5" height="1.5" />
        </>
      )}
    </svg>
  );
}

/** The warning mark of slow cells: a corner bracket. */
function SlowMarkIcon() {
  return (
    <svg viewBox="0 0 8 8" aria-hidden="true" className="size-2 shrink-0 fill-current">
      <rect x="1" y="0" width="7" height="2" />
      <rect x="6" y="0" width="2" height="7" />
    </svg>
  );
}

/** The scale under the matrix: the fastest and slowest pair around five sample blocks, and the marks. */
function Legend({ model, slowMs }: { model: MatrixModel; slowMs: number }) {
  const hasRange = Number.isFinite(model.min) && Number.isFinite(model.max);
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[11px] leading-4 text-muted-foreground">
      {hasRange ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="font-mono tabular-nums">{formatMsText(model.min)}</span>
          <span aria-hidden="true" className="inline-flex gap-[3px]">
            {LEGEND_LEVELS.map((level) => (
              <DotBlock key={level} level={level} />
            ))}
          </span>
          <span className="font-mono tabular-nums">{formatMsText(model.max)}</span>
        </span>
      ) : null}
      <span className="inline-flex items-center gap-1.5">
        <span className="text-lumesec-warning">
          <SlowMarkIcon />
        </span>
        <span className="font-mono tabular-nums">≥ {formatNumber(slowMs)} ms</span>
      </span>
      {model.missing > 0 || !hasRange ? (
        <span className="inline-flex items-center gap-1.5">
          <DotBlock level={-1} />
          No data
        </span>
      ) : null}
    </div>
  );
}

/** A 5 × 5 block as SVG for the legend, lit like a matrix cell at `level` (0 to 1), or the "no data" pattern for -1. */
function DotBlock({ level }: { level: number }) {
  const missing = level < 0;
  const lit = missing ? 0 : litCount(level);
  const color = `color-mix(in srgb, var(--lumesec) ${Math.round(Math.pow(Math.max(0, level), 1.6) * 100)}%, ${LAND_CSS})`;
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" className="size-[15px] shrink-0">
      {RANKS.map((rank, index) => {
        const x = (index % 5) * 4;
        const y = Math.floor(index / 5) * 4;
        if (missing) {
          if ((index + Math.floor(index / 5)) % 2 !== 0) return null;
          return (
            <rect
              key={index}
              x={x}
              y={y}
              width="2"
              height="2"
              style={{ fill: "var(--foreground)", opacity: MISSING_ALPHA }}
            />
          );
        }
        if (rank >= lit)
          return <rect key={index} x={x} y={y} width="2" height="2" style={{ fill: LAND_CSS, opacity: UNLIT_ALPHA }} />;
        return (
          <rect key={index} x={x} y={y} width="2" height="2" style={{ fill: color, opacity: 0.4 + 0.6 * level }} />
        );
      })}
    </svg>
  );
}

/** Roll direction for a number: 1 when it grows (the new value rolls in from below), -1 when it shrinks. */
function useRollDirection(value: number) {
  const [state, setState] = React.useState({ value, direction: 1 });
  if (!Object.is(state.value, value)) {
    const direction =
      Number.isFinite(value) && Number.isFinite(state.value) ? (value >= state.value ? 1 : -1) : state.direction;
    setState({ value, direction });
    return direction;
  }
  return state.direction;
}

/* Data model ------------------------------------------------------------------------------------------ */

const KIND_DATA = 0;
const KIND_MISSING = 1;
const KIND_SAME = 2;

/** Everything the matrix shows, derived once per data change. */
interface MatrixModel {
  readonly regions: readonly LatencyRegion[];
  readonly size: number;
  readonly indexById: ReadonlyMap<string, number>;
  /** Round-trip time per cell (row-major), NaN without a measurement. */
  readonly ms: Float64Array;
  /** Fibre minimum per cell in ms. */
  readonly floor: Float64Array;
  /** Great-circle distance per cell in km. */
  readonly km: Float64Array;
  /** KIND_DATA, KIND_MISSING or KIND_SAME per cell. */
  readonly kinds: Uint8Array;
  /** Lit dots (1 to 25) per data cell. */
  readonly counts: Uint8Array;
  /** 1 for data cells at or above the slow threshold. */
  readonly slow: Uint8Array;
  /** Fastest and slowest off-diagonal measurement; NaN when there is none. */
  readonly min: number;
  readonly max: number;
  /** Off-diagonal cells without a measurement. */
  readonly missing: number;
}

function buildModel(
  regionList: readonly LatencyRegion[],
  measurementList: readonly LatencyMeasurement[],
  symmetric: boolean,
  slowMs: number,
): MatrixModel {
  const regions: LatencyRegion[] = [];
  const indexById = new Map<string, number>();
  for (const region of regionList) {
    if (!region || typeof region.id !== "string" || indexById.has(region.id)) continue;
    if (!isValidLatLon(region)) continue;
    indexById.set(region.id, regions.length);
    regions.push(region);
  }
  const size = regions.length;
  const cells = size * size;
  const ms = new Float64Array(cells).fill(Number.NaN);
  const given = new Uint8Array(cells);
  for (const measurement of measurementList) {
    const row = indexById.get(measurement?.from);
    const column = indexById.get(measurement?.to);
    if (row === undefined || column === undefined) continue;
    if (!Number.isFinite(measurement.ms) || measurement.ms < 0) continue;
    // the last measurement of a direction wins
    ms[row * size + column] = measurement.ms;
    given[row * size + column] = 1;
  }
  if (symmetric) {
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        const cell = row * size + column;
        const mirror = column * size + row;
        if (!given[cell] && given[mirror]) ms[cell] = ms[mirror];
      }
    }
  }

  const floor = new Float64Array(cells);
  const km = new Float64Array(cells);
  const kinds = new Uint8Array(cells);
  const counts = new Uint8Array(cells);
  const slow = new Uint8Array(cells);
  let min = Infinity;
  let max = -Infinity;
  let missing = 0;
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const cell = row * size + column;
      const distance = row === column ? 0 : distanceKm(regions[row], regions[column]);
      km[cell] = distance;
      floor[cell] = fiberRttMs(distance);
      if (row === column) kinds[cell] = KIND_SAME;
      else if (Number.isNaN(ms[cell])) {
        kinds[cell] = KIND_MISSING;
        missing++;
      } else {
        min = Math.min(min, ms[cell]);
        max = Math.max(max, ms[cell]);
      }
    }
  }
  const hasRange = min <= max;
  // log scale, so a few transoceanic pairs do not flatten the regional ones; zero-ms pairs count as 0.1 ms
  const low = Math.max(MIN_SCALE_MS, min);
  const high = Math.max(low, max);
  const span = Math.log(high / low);
  for (let cell = 0; cell < cells; cell++) {
    if (kinds[cell] !== KIND_DATA) continue;
    const level = span > 1e-9 ? Math.log(Math.max(MIN_SCALE_MS, ms[cell]) / low) / span : 0.5;
    counts[cell] = litCount(level);
    slow[cell] = ms[cell] >= slowMs ? 1 : 0;
  }
  return {
    regions,
    size,
    indexById,
    ms,
    floor,
    km,
    kinds,
    counts,
    slow,
    min: hasRange ? min : Number.NaN,
    max: hasRange ? max : Number.NaN,
    missing,
  };
}

/** Lit dots for a level 0 to 1: quantised to 25 steps, so even the fastest pair shows one dot. */
const litCount = (level: number) => 1 + Math.round(clamp(level, 0, 1) * 24);

const regionLabel = (region: LatencyRegion) => region.label || region.id;
const regionPlace = (region: LatencyRegion) => region.city || regionLabel(region);

function firstPair(model: MatrixModel): LatencyPair | null {
  if (model.size < 2) return null;
  return { from: model.regions[0].id, to: model.regions[1].id };
}

function cellOfPair(model: MatrixModel, pair: LatencyPair | null | undefined) {
  if (!pair) return -1;
  const row = model.indexById.get(pair.from);
  const column = model.indexById.get(pair.to);
  return row === undefined || column === undefined ? -1 : row * model.size + column;
}

function pairOfCell(model: MatrixModel, cell: number): LatencyPair | null {
  if (cell < 0 || cell >= model.size * model.size) return null;
  return { from: model.regions[Math.floor(cell / model.size)].id, to: model.regions[cell % model.size].id };
}

const samePair = (a: LatencyPair | null, b: LatencyPair | null) =>
  a === b || (!!a && !!b && a.from === b.from && a.to === b.to);

/** What the detail panel shows for a cell. */
interface CellDetail {
  kind: "none" | "same" | "missing" | "data";
  fromText: string;
  toText: string;
  fromPlace: string;
  toPlace: string;
  /** "Frankfurt to Singapore", or the one place of a diagonal cell. */
  place: string;
  ms: number;
  floor: number;
  /** Measured over fibre minimum, minus 1 (0.38 is 38 % above). */
  stretch: number;
  km: number;
  slow: boolean;
  emptyText: string;
}

function describeCell(model: MatrixModel, cell: number): CellDetail {
  if (cell < 0 || cell >= model.size * model.size) {
    return {
      kind: "none",
      fromText: "",
      toText: "",
      fromPlace: "",
      toPlace: "",
      place: "",
      ms: Number.NaN,
      floor: Number.NaN,
      stretch: Number.NaN,
      km: Number.NaN,
      slow: false,
      emptyText: "No pair selected",
    };
  }
  const row = Math.floor(cell / model.size);
  const column = cell % model.size;
  const from = model.regions[row];
  const to = model.regions[column];
  const kind = model.kinds[cell] === KIND_SAME ? "same" : model.kinds[cell] === KIND_MISSING ? "missing" : "data";
  const ms = model.ms[cell];
  const floor = model.floor[cell];
  return {
    kind,
    fromText: regionLabel(from),
    toText: kind === "same" ? "" : regionLabel(to),
    fromPlace: regionPlace(from),
    toPlace: kind === "same" ? "" : regionPlace(to),
    place: kind === "same" ? regionPlace(from) : `${regionPlace(from)} to ${regionPlace(to)}`,
    ms,
    floor: kind === "same" ? Number.NaN : floor,
    stretch: kind === "data" && floor > 0 ? ms / floor - 1 : Number.NaN,
    km: model.km[cell],
    slow: kind === "data" && model.slow[cell] === 1,
    emptyText: kind === "missing" ? "No data" : "Same region",
  };
}

/** The accessible name of a cell: "Frankfurt to Singapore, 162 milliseconds, 61 % above fibre minimum". */
function cellLabel(model: MatrixModel, cell: number) {
  const detail = describeCell(model, cell);
  const measured = Number.isFinite(detail.ms) ? `${formatMsNumber(detail.ms)} milliseconds` : "";
  if (detail.kind === "same") return `${detail.place}, same region${measured ? `, ${measured}` : ""}`;
  if (detail.kind === "missing") return `${detail.place}, no data`;
  const percent = Math.round(Math.abs(detail.stretch) * 100);
  const relation =
    !Number.isFinite(detail.stretch) || percent === 0
      ? "at the fibre minimum"
      : `${percent} % ${detail.stretch > 0 ? "above" : "below"} fibre minimum`;
  return `${detail.place}, ${measured}, ${relation}${detail.slow ? ", slow" : ""}`;
}

function mapLabel(detail: CellDetail) {
  if (detail.kind === "none") return "Map without a route";
  if (detail.kind === "same") return `Map: ${detail.place}, same region`;
  return `Map: route from ${detail.place}`;
}

const MISSING = "–";

/** Milliseconds as a bare number: one decimal below 10 ms, whole numbers with grouping above. */
const formatMsNumber = (ms: number) => formatNumber(ms, { fractionDigits: ms < 9.95 ? 1 : 0 });

const formatMsText = (ms: number) => (Number.isFinite(ms) ? `${formatMsNumber(ms)} ms` : MISSING);

/** '+38 %' for 0.38, with a true minus sign below the fibre minimum. */
const formatStretch = (stretch: number) =>
  Number.isFinite(stretch)
    ? `${formatNumber(Math.round(stretch * 100), { sign: Math.round(stretch * 100) !== 0 })} %`
    : MISSING;

/* Demo data ------------------------------------------------------------------------------------------- */

/** Eight demo regions in the order of the map, west to east, so the matrix reads like the map. */
const DEMO_REGION_IDS = [
  "us-west",
  "us-east",
  "sa-east",
  "eu-central",
  "af-south",
  "ap-southeast",
  "ap-northeast",
  "au-east",
];

const DEMO_MATRIX_REGIONS: readonly LatencyRegion[] = DEMO_REGION_IDS.flatMap((id) => {
  const region = findRegion(id);
  return region ? [{ id: region.id, label: region.label, city: region.city, lat: region.lat, lon: region.lon }] : [];
});

/** One direction per pair (symmetric fills the other): the fibre minimum times a seeded stretch of 1.3 to 1.9. */
const DEMO_MEASUREMENTS: readonly LatencyMeasurement[] = DEMO_MATRIX_REGIONS.flatMap((from, row) =>
  DEMO_MATRIX_REGIONS.slice(row + 1).map((to) => ({ from: from.id, to: to.id, ms: demoLatency(from, to) })),
);

const NO_MEASUREMENTS: readonly LatencyMeasurement[] = [];

/* Constants ------------------------------------------------------------------------------------------- */

/** Labels longer than this are truncated in the headers. */
const MAX_LABEL_CHARS = 14;
/** The scale treats faster pairs as this many ms, so the log stays finite. */
const MIN_SCALE_MS = 0.1;

/**
 * Rank of each dot of a 5 × 5 block (row-major): a dispersed-dot ordered dither, so every prefix is spread evenly
 * and density grows without clumping (toroidal void-and-cluster, so neighbouring blocks tile evenly). The first four
 * dots form a square; the centre comes late, so the diagonal's lone centre dot never reads as a fast pair.
 */
const RANKS: readonly number[] = [
  10, 20, 6, 13, 4, 14, 0, 17, 3, 21, 7, 12, 22, 8, 18, 23, 2, 15, 1, 11, 5, 19, 9, 24, 16,
];
const RANK_COLUMN = new Uint8Array(25);
const RANK_ROW = new Uint8Array(25);
RANKS.forEach((rank, index) => {
  RANK_COLUMN[rank] = index % 5;
  RANK_ROW[rank] = Math.floor(index / 5);
});
const CENTRE_RANK = RANKS[12];
const LEGEND_LEVELS = [0, 0.25, 0.5, 0.75, 1];

/** The cells' grey (between geoInk's land and landStrong), as CSS, for the legend blocks. */
const LAND_CSS =
  "color-mix(in srgb, color-mix(in srgb, var(--muted-foreground) 70%, var(--card)) 50%, color-mix(in srgb, var(--foreground) 55%, var(--card)))";

/** Room around the cells on the matrix canvas, for the commit ring. */
const MATRIX_MARGIN = 8;
const DOT = 2;
/** The faint checkerboard of a pair without a measurement. */
const MISSING_ALPHA = 0.15;
/** The unlit dots of a block, so every cell reads as a block that fills up. */
const UNLIT_ALPHA = 0.14;
const TWINKLE_SECONDS = 0.22;
/** Each dot of a twinkling block starts this much later than the one before it in rank order. */
const TWINKLE_STAGGER = 0.006;
const POP_SECONDS = 0.5;

/** The route springs: endpoints, bend and shape. */
const ROUTE_STIFFNESS = 420;
const ROUTE_DAMPING = 0.75;

const MAP_LAT_RANGE: readonly [number, number] = [-50, 70];
const MAP_CENTER: LatLon = { lat: 0, lon: 10 };
const MAP_ASPECT = projectionAspect("equirectangular", MAP_LAT_RANGE);
const MAP_PITCH = 3;
const MAP_DOT = 1.5;
const LAND_ALPHA = 0.6;
const MAP_CANVAS = { maxDpr: 2 } as const;
/** How far sparks may fly past the map. */
const FX_MARGIN = 24;
const SHAPE_SAMPLES = 33;
const PACKET_SECONDS = 1;
const PACKET_EASE = cubicBezier(0.45, 0, 0.25, 1);
const PING_SECONDS = 0.95;
const GHOST_ALPHA = 0.6;

/* Engine --------------------------------------------------------------------------------------------- */

const spring = (position = 0): Spring => ({ position, velocity: 0 });

/** The matrix canvas state. Lives in a ref, never in React state. */
interface MatrixState {
  n: number;
  kinds: Uint8Array;
  slow: Uint8Array;
  /** Dot count each cell springs to (presence 1 for diagonal and missing cells). */
  target: Float32Array;
  count: Float32Array;
  velocity: Float32Array;
  /** Reveal delay per cell in seconds: the blocks fill outward from the diagonal. */
  delay: Float32Array;
  /** Time of the first frame in seconds, or -1 before it. */
  revealStart: number;
  active: number;
  selected: number;
  /** The active frame, in cell units. */
  frameX: Spring;
  frameY: Spring;
  frameAlpha: Spring;
  twinkleCell: number;
  twinkleStart: number;
  popCell: number;
  popStart: number;
  dirty: boolean;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  mix: number;
}

/** The route on the map: screen-space springs that the curves are rebuilt from every frame. */
interface RouteState {
  pair: { i: number; j: number } | null;
  targetDirty: boolean;
  ax: Spring;
  ay: Spring;
  bx: Spring;
  by: Spring;
  target: { ax: number; ay: number; bx: number; by: number };
  /** Bend of the measured curve (signed, see flatCurve). */
  bend: Spring;
  bendTarget: number;
  /** 0 to 1 between the previous and the new great-circle shape. */
  mix: Spring;
  /** Great-circle shapes as (u, v) pairs relative to the chord: along it, and along its left normal. */
  shapeFrom: Float32Array;
  shapeTo: Float32Array;
  shape: Float32Array;
  measured: Spring;
  measuredTarget: number;
  ghost: Spring;
  ghostTarget: number;
  visible: Spring;
  visibleTarget: number;
  same: boolean;
  /** Label offsets from their dots, in px. */
  labelA: LabelSpring;
  labelB: LabelSpring;
  curve: QuadCurve;
  table: ArcLengthTable | undefined;
  ghostTable: ArcLengthTable | undefined;
  ghostX: Float32Array;
  ghostY: Float32Array;
}

interface Engine {
  model: MatrixModel | null;
  ink: GeoInk | null;
  inkStale: boolean;
  matrix: MatrixState;
  route: RouteState;
  projection: MapProjection | null;
  lattice: DotLattice | null;
  mapKey: string;
  baked: boolean;
  /** A committed cell waiting for its burst, or -1. */
  celebrate: number;
  celebrateAt: number;
  ping: { x: number; y: number; start: number } | null;
  sparks: Spark[];
  fxDirty: boolean;
  /** Widths of the from, to and fibre-minimum labels in px. */
  labelWidths: [number, number, number];
}

function createEngine(): Engine {
  return {
    model: null,
    ink: null,
    inkStale: true,
    matrix: {
      n: 0,
      kinds: new Uint8Array(0),
      slow: new Uint8Array(0),
      target: new Float32Array(0),
      count: new Float32Array(0),
      velocity: new Float32Array(0),
      delay: new Float32Array(0),
      revealStart: -1,
      active: -1,
      selected: -1,
      frameX: spring(),
      frameY: spring(),
      frameAlpha: spring(),
      twinkleCell: -1,
      twinkleStart: 0,
      popCell: -1,
      popStart: 0,
      dirty: true,
    },
    route: {
      pair: null,
      targetDirty: true,
      ax: spring(),
      ay: spring(),
      bx: spring(),
      by: spring(),
      target: { ax: 0, ay: 0, bx: 0, by: 0 },
      bend: spring(),
      bendTarget: 0,
      mix: spring(1),
      shapeFrom: new Float32Array(SHAPE_SAMPLES * 2),
      shapeTo: new Float32Array(SHAPE_SAMPLES * 2),
      shape: new Float32Array(SHAPE_SAMPLES * 2),
      measured: spring(),
      measuredTarget: 0,
      ghost: spring(),
      ghostTarget: 0,
      visible: spring(),
      visibleTarget: 0,
      same: false,
      labelA: { x: spring(LABEL_GAP), y: spring(-7) },
      labelB: { x: spring(LABEL_GAP), y: spring(-7) },
      curve: { x0: 0, y0: 0, cx: 0, cy: 0, x1: 0, y1: 0 },
      table: undefined,
      ghostTable: undefined,
      ghostX: new Float32Array(SHAPE_SAMPLES),
      ghostY: new Float32Array(SHAPE_SAMPLES),
    },
    projection: null,
    lattice: null,
    mapKey: "",
    baked: false,
    celebrate: -1,
    celebrateAt: 0,
    ping: null,
    sparks: [],
    fxDirty: false,
    labelWidths: [0, 0, 0],
  };
}

/* Matrix --------------------------------------------------------------------------------------------- */

function syncMatrix(matrix: MatrixState, model: MatrixModel) {
  const n = model.size;
  const cells = n * n;
  if (matrix.n !== n) {
    // a new shape fills in from the diagonal again
    matrix.n = n;
    matrix.target = new Float32Array(cells);
    matrix.count = new Float32Array(cells);
    matrix.velocity = new Float32Array(cells);
    matrix.delay = new Float32Array(cells);
    matrix.revealStart = -1;
    for (let row = 0; row < n; row++) {
      for (let column = 0; column < n; column++) {
        const cell = row * n + column;
        matrix.delay[cell] = 0.04 + (Math.abs(row - column) / Math.max(1, n - 1)) * 0.5 + hash(cell * 7.31 + 3.7) * 0.1;
      }
    }
  }
  matrix.kinds = model.kinds;
  matrix.slow = model.slow;
  for (let cell = 0; cell < cells; cell++) {
    matrix.target[cell] = model.kinds[cell] === KIND_DATA ? model.counts[cell] : 1;
  }
  matrix.dirty = true;
}

/** Advances the cell counts, the frame and the one-shot effects. Returns whether anything still moves. */
function stepMatrix(matrix: MatrixState, now: number, delta: number, reduced: boolean) {
  const n = matrix.n;
  if (n === 0) return false;
  if (matrix.revealStart < 0) matrix.revealStart = now;
  const since = now - matrix.revealStart;
  let moving = false;
  for (let cell = 0; cell < n * n; cell++) {
    const target = since >= matrix.delay[cell] ? matrix.target[cell] : 0;
    if (reduced) {
      matrix.count[cell] = matrix.target[cell];
      matrix.velocity[cell] = 0;
      continue;
    }
    const position = matrix.count[cell];
    const velocity = matrix.velocity[cell];
    if (Math.abs(position - target) < 0.002 && Math.abs(velocity) < 0.002) {
      matrix.count[cell] = target;
      matrix.velocity[cell] = 0;
      continue;
    }
    COUNT_SPRING.position = position;
    COUNT_SPRING.velocity = velocity;
    springStep(COUNT_SPRING, target, delta, 240, 0.86);
    matrix.count[cell] = COUNT_SPRING.position;
    matrix.velocity[cell] = COUNT_SPRING.velocity;
    moving = true;
  }

  const active = matrix.active;
  const frameTarget = active >= 0 ? 1 : 0;
  if (active >= 0) {
    const column = active % n;
    const row = Math.floor(active / n);
    // the frame appears where it is needed instead of sliding in from its last place
    if (matrix.frameAlpha.position < 0.02 || reduced) {
      matrix.frameX.position = column;
      matrix.frameY.position = row;
      matrix.frameX.velocity = 0;
      matrix.frameY.velocity = 0;
    } else {
      springStep(matrix.frameX, column, delta, ROUTE_STIFFNESS, ROUTE_DAMPING);
      springStep(matrix.frameY, row, delta, ROUTE_STIFFNESS, ROUTE_DAMPING);
    }
    if (!settled(matrix.frameX, column) || !settled(matrix.frameY, row)) moving = true;
  }
  if (reduced) {
    matrix.frameAlpha.position = frameTarget;
    matrix.frameAlpha.velocity = 0;
  } else {
    springStep(matrix.frameAlpha, frameTarget, delta, 300, 1);
    if (!settled(matrix.frameAlpha, frameTarget)) moving = true;
    else matrix.frameAlpha.position = frameTarget;
  }

  if (matrix.twinkleCell >= 0 && now - matrix.twinkleStart < TWINKLE_SECONDS + 25 * TWINKLE_STAGGER + 0.02 && !reduced)
    moving = true;
  else if (matrix.twinkleCell >= 0) {
    matrix.twinkleCell = -1;
    matrix.dirty = true;
  }
  if (matrix.popCell >= 0 && now - matrix.popStart < POP_SECONDS && !reduced) moving = true;
  else if (matrix.popCell >= 0) {
    matrix.popCell = -1;
    matrix.dirty = true;
  }
  return moving;
}

const COUNT_SPRING: Spring = spring();

const settled = (state: Spring, target: number) =>
  Math.abs(state.position - target) < 0.001 && Math.abs(state.velocity) < 0.001;

/** Draws every cell's dot block, the slow marks, the selection and the active frame. */
function drawMatrix(surface: CanvasSurface, matrix: MatrixState, ink: GeoInk, now: number) {
  const { context, width, height, dpr } = surface;
  context.clearRect(0, 0, width, height);
  const n = matrix.n;
  if (n === 0) return;
  const cellSize = (width - 2 * MATRIX_MARGIN) / n;
  const pitch = cellSize >= 22 ? 4 : 3.5;
  const block = pitch * 4 + DOT;
  const inset = (cellSize - block) / 2;
  const twinkleAge = matrix.twinkleCell >= 0 ? now - matrix.twinkleStart : -1;
  const pen: Pen = { context, fill: "" };

  for (let row = 0; row < n; row++) {
    for (let column = 0; column < n; column++) {
      const cell = row * n + column;
      const shown = matrix.count[cell];
      if (shown <= 0.01) continue;
      const x0 = MATRIX_MARGIN + column * cellSize + inset;
      const y0 = MATRIX_MARGIN + row * cellSize + inset;
      const kind = matrix.kinds[cell];
      const age = cell === matrix.twinkleCell ? twinkleAge : -1;

      if (kind === KIND_SAME) {
        blockDot(
          pen,
          x0,
          y0,
          pitch,
          dpr,
          CENTRE_RANK,
          ink.landStrong,
          0.55 * clamp(shown, 0, 1),
          twinklePulse(age, 0),
          ink.shine,
        );
        continue;
      }
      if (kind === KIND_MISSING) {
        const alpha = MISSING_ALPHA * clamp(shown, 0, 1);
        for (let rank = 0; rank < 25; rank++) {
          if ((RANK_ROW[rank] + RANK_COLUMN[rank]) % 2 !== 0) continue;
          blockDot(pen, x0, y0, pitch, dpr, rank, ink.foreground, alpha, twinklePulse(age, rank), ink.shine);
        }
        continue;
      }

      const level = clamp((shown - 1) / 24, 0, 1);
      const color = cellColor(ink, level);
      const alpha = 0.4 + 0.6 * level;
      const presence = clamp(shown, 0, 1);
      for (let rank = 0; rank < 25; rank++) {
        const lit = clamp(shown - rank, 0, 1);
        if (lit < 1)
          blockDot(pen, x0, y0, pitch, dpr, rank, ink.land, UNLIT_ALPHA * presence * (1 - lit), 0, ink.shine);
        if (lit > 0) blockDot(pen, x0, y0, pitch, dpr, rank, color, alpha * lit, twinklePulse(age, rank), ink.shine);
      }
      if (matrix.slow[cell]) {
        // a 2 px bracket hugging the block's top-right corner
        context.globalAlpha = clamp(shown - 0.5, 0, 1);
        setFill(pen, rgba(ink.warning));
        const right = snap(x0 + block, dpr);
        const top = snap(y0, dpr);
        context.fillRect(right - 4, top - 3, 6, 2);
        context.fillRect(right, top - 3, 2, 6);
      }
    }
  }
  context.globalAlpha = 1;

  // the selection keeps a quiet frame while another pair is previewed
  if (matrix.selected >= 0 && matrix.selected !== matrix.active && matrix.selected < n * n) {
    strokeFrame(context, dpr, matrix.selected % n, Math.floor(matrix.selected / n), cellSize, ink.accent, 0.4, 0);
  }
  const frameAlpha = clamp(matrix.frameAlpha.position, 0, 1);
  if (frameAlpha > 0.01)
    strokeFrame(context, dpr, matrix.frameX.position, matrix.frameY.position, cellSize, ink.accent, frameAlpha, 0);
  if (matrix.popCell >= 0) {
    const t = clamp((now - matrix.popStart) / POP_SECONDS, 0, 1);
    const grow = easeOutCubic(t) * 6;
    strokeFrame(
      context,
      dpr,
      matrix.popCell % n,
      Math.floor(matrix.popCell / n),
      cellSize,
      ink.accent,
      (1 - t) * (1 - t) * 0.9,
      grow,
    );
  }
}

/**
 * Colour of a cell's lit dots: the land grey for fast pairs, leaning toward the accent only in the upper part of the
 * scale, so the slow pairs carry the colour.
 */
function cellColor(ink: GeoInk, level: number) {
  const grey = mixRgb(ink.land, ink.landStrong, 0.5);
  return mixRgb(grey, ink.accent, Math.pow(level, 1.6));
}

/** The fill style in use, so runs of dots in one colour set it once. */
interface Pen {
  context: CanvasRenderingContext2D;
  fill: string;
}

function setFill(pen: Pen, fill: string) {
  if (pen.fill === fill) return;
  pen.context.fillStyle = fill;
  pen.fill = fill;
}

/** Twinkle strength of the dot with this rank `age` seconds after the cell became active: one sine pulse each. */
function twinklePulse(age: number, rank: number) {
  if (age < 0) return 0;
  const t = (age - rank * TWINKLE_STAGGER) / TWINKLE_SECONDS;
  return t > 0 && t < 1 ? Math.sin(Math.PI * t) : 0;
}

/** One dot of a block at its rank's position, pulsed toward the shine while it twinkles. */
function blockDot(
  pen: Pen,
  x0: number,
  y0: number,
  pitch: number,
  dpr: number,
  rank: number,
  color: RGB,
  alpha: number,
  pulse: number,
  shine: RGB,
) {
  const a = Math.min(1, alpha + pulse * 0.55);
  if (a < 0.01) return;
  setFill(pen, rgba(pulse > 0 ? mixRgb(color, shine, pulse * 0.65) : color));
  pen.context.globalAlpha = a;
  pen.context.fillRect(snap(x0 + RANK_COLUMN[rank] * pitch, dpr), snap(y0 + RANK_ROW[rank] * pitch, dpr), DOT, DOT);
}

/** A 1 px rounded frame around a cell at a fractional (column, row), grown by `grow` px. */
function strokeFrame(
  context: CanvasRenderingContext2D,
  dpr: number,
  column: number,
  row: number,
  cellSize: number,
  color: RGB,
  alpha: number,
  grow: number,
) {
  if (alpha <= 0.005) return;
  const x = snap(MATRIX_MARGIN + column * cellSize - grow, dpr) + 0.5;
  const y = snap(MATRIX_MARGIN + row * cellSize - grow, dpr) + 0.5;
  const size = snap(cellSize + grow * 2, dpr) - 1;
  context.globalAlpha = alpha;
  context.strokeStyle = rgba(color);
  context.lineWidth = 1;
  context.beginPath();
  if (typeof context.roundRect === "function") context.roundRect(x, y, size, size, 4 + grow * 0.5);
  else context.rect(x, y, size, size);
  context.stroke();
  context.globalAlpha = 1;
}

/* Map and route -------------------------------------------------------------------------------------- */

function layoutMap(engine: Engine, width: number, height: number) {
  const key = `${width}x${height}`;
  if (engine.mapKey === key) return;
  const previous = engine.projection;
  const projection = createProjection("equirectangular", {
    width,
    height,
    latRange: MAP_LAT_RANGE,
    center: MAP_CENTER,
  });
  engine.projection = projection;
  engine.lattice = mapLattice(projection, { pitch: MAP_PITCH });
  engine.mapKey = key;
  engine.baked = false;
  const route = engine.route;
  if (previous && previous.width > 0 && previous.height > 0) {
    // keep the route where it is on the map; only the scale changed
    const sx = width / previous.width;
    const sy = height / previous.height;
    route.ax.position *= sx;
    route.bx.position *= sx;
    route.ay.position *= sy;
    route.by.position *= sy;
  }
  route.targetDirty = true;
}

const vectorA: Vec3 = [0, 0, 0];
const vectorB: Vec3 = [0, 0, 0];
const vectorP: Vec3 = [0, 0, 0];
const screenScratch = createScreenPoint();
const shapeX = new Float32Array(SHAPE_SAMPLES);
const shapeY = new Float32Array(SHAPE_SAMPLES);

/**
 * Samples the great circle from `from` to `to` on the map, continuing longitudes across the seam (the short way
 * round), and writes it into `shape` as (u, v) pairs relative to the chord. Returns the projected endpoints.
 */
function greatCircleShape(projection: MapProjection, from: LatLon, to: LatLon, shape: Float32Array) {
  latLonToVector(from.lat, from.lon, vectorA);
  latLonToVector(to.lat, to.lon, vectorB);
  const lon0 = projection.centerLon;
  let lambda = wrapLongitude(from.lon - lon0);
  for (let i = 0; i < SHAPE_SAMPLES; i++) {
    slerpVector(vectorA, vectorB, i / (SHAPE_SAMPLES - 1), vectorP);
    const length = Math.hypot(vectorP[0], vectorP[1], vectorP[2]) || 1;
    const lat = Math.asin(clamp(vectorP[1] / length, -1, 1)) / DEG;
    const lon = Math.atan2(vectorP[0], vectorP[2]) / DEG;
    if (i > 0) lambda = unwrapLongitude(lambda, lon - lon0);
    projection.projectRelative(lat, lambda, screenScratch);
    shapeX[i] = screenScratch.x;
    shapeY[i] = screenScratch.y;
  }
  const ax = shapeX[0];
  const ay = shapeY[0];
  const bx = shapeX[SHAPE_SAMPLES - 1];
  const by = shapeY[SHAPE_SAMPLES - 1];
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  for (let i = 0; i < SHAPE_SAMPLES; i++) {
    if (lengthSquared < 1) {
      shape[i * 2] = i / (SHAPE_SAMPLES - 1);
      shape[i * 2 + 1] = 0;
      continue;
    }
    const rx = shapeX[i] - ax;
    const ry = shapeY[i] - ay;
    shape[i * 2] = (rx * dx + ry * dy) / lengthSquared;
    shape[i * 2 + 1] = (rx * dy - ry * dx) / lengthSquared;
  }
  return { ax, ay, bx, by };
}

const nextShape = new Float32Array(SHAPE_SAMPLES * 2);

/** Points the route springs at the pair on show. */
function retargetRoute(engine: Engine, projection: MapProjection) {
  const route = engine.route;
  const model = engine.model;
  route.targetDirty = false;
  const pair = route.pair;
  if (!model || !pair || pair.i >= model.size || pair.j >= model.size) {
    route.visibleTarget = 0;
    route.measuredTarget = 0;
    route.ghostTarget = 0;
    return;
  }
  const from = model.regions[pair.i];
  const to = model.regions[pair.j];
  const cell = pair.i * model.size + pair.j;
  const target = greatCircleShape(projection, from, to, nextShape);
  route.target = target;
  route.same = pair.i === pair.j;

  const hidden = route.visible.position < 0.02;
  if (hidden) {
    route.ax.position = target.ax;
    route.ay.position = target.ay;
    route.bx.position = target.bx;
    route.by.position = target.by;
    route.ax.velocity = route.ay.velocity = route.bx.velocity = route.by.velocity = 0;
  } else {
    // a route shifted by a whole map width looks the same; start from the copy that slides the least
    const world = projection.frame.x1 - projection.frame.x0;
    let best = 0;
    let bestCost = Infinity;
    for (const turns of [0, -1, 1]) {
      const cost = Math.max(
        Math.abs(route.ax.position + turns * world - target.ax),
        Math.abs(route.bx.position + turns * world - target.bx),
      );
      if (cost < bestCost - 0.5) {
        best = turns;
        bestCost = cost;
      }
    }
    route.ax.position += best * world;
    route.bx.position += best * world;
  }

  // blend from the shape on screen right now to the new great circle
  const mix = clamp(route.mix.position, 0, 1.2);
  for (let i = 0; i < SHAPE_SAMPLES * 2; i++) {
    route.shapeFrom[i] = hidden ? nextShape[i] : route.shapeFrom[i] + (route.shapeTo[i] - route.shapeFrom[i]) * mix;
    route.shapeTo[i] = nextShape[i];
  }
  route.mix.position = hidden ? 1 : 0;
  route.mix.velocity = 0;

  // the measured route bends away from the great circle's bulge, more for a larger stretch
  const bulge = nextShape[(SHAPE_SAMPLES >> 1) * 2 + 1];
  const side = Math.abs(bulge) > 0.01 ? -Math.sign(bulge) : target.bx >= target.ax ? 1 : -1;
  const ms = model.ms[cell];
  const floor = model.floor[cell];
  const ratio = Number.isFinite(ms) && floor > 0 ? ms / floor : 1;
  route.bendTarget = route.same ? 0 : side * Math.min(0.3, 0.12 * Math.max(1, ratio));
  if (hidden) {
    route.bend.position = route.bendTarget;
    route.bend.velocity = 0;
  }
  route.visibleTarget = 1;
  route.ghostTarget = route.same ? 0 : 1;
  route.measuredTarget = !route.same && model.kinds[cell] === KIND_DATA ? 1 : 0;
}

/** Advances the route springs. Returns whether anything still moves. */
function stepRoute(route: RouteState, delta: number, reduced: boolean) {
  const { target } = route;
  let moving = false;
  moving = stepSpring(route.ax, target.ax, delta, reduced, ROUTE_STIFFNESS, ROUTE_DAMPING) || moving;
  moving = stepSpring(route.ay, target.ay, delta, reduced, ROUTE_STIFFNESS, ROUTE_DAMPING) || moving;
  moving = stepSpring(route.bx, target.bx, delta, reduced, ROUTE_STIFFNESS, ROUTE_DAMPING) || moving;
  moving = stepSpring(route.by, target.by, delta, reduced, ROUTE_STIFFNESS, ROUTE_DAMPING) || moving;
  moving = stepSpring(route.bend, route.bendTarget, delta, reduced, ROUTE_STIFFNESS, ROUTE_DAMPING) || moving;
  moving = stepSpring(route.mix, 1, delta, reduced, ROUTE_STIFFNESS, ROUTE_DAMPING) || moving;
  // presence fades are critically damped: no overshoot in opacity
  moving = stepSpring(route.measured, route.measuredTarget, delta, reduced, 220, 1) || moving;
  moving = stepSpring(route.ghost, route.ghostTarget, delta, reduced, 220, 1) || moving;
  moving = stepSpring(route.visible, route.visibleTarget, delta, reduced, 220, 1) || moving;
  return moving;
}

/** One spring step that snaps when settled (within a hundredth of a pixel). Returns whether it still moves. */
function stepSpring(state: Spring, goal: number, delta: number, reduced: boolean, stiffness: number, damping: number) {
  if (reduced || (Math.abs(state.position - goal) < 0.01 && Math.abs(state.velocity) < 0.01)) {
    state.position = goal;
    state.velocity = 0;
    return false;
  }
  springStep(state, goal, delta, stiffness, damping);
  return true;
}

/** Where a fired commit lands: a ping through the land dots and sparks past the map's edge. */
function resolveCelebration(engine: Engine, projection: MapProjection, now: number, reduced: boolean) {
  const cell = engine.celebrate;
  if (cell < 0) return;
  const route = engine.route;
  const model = engine.model;
  const n = model?.size ?? 0;
  const matches = route.pair !== null && route.pair.i * n + route.pair.j === cell && !route.targetDirty;
  if (!matches && now - engine.celebrateAt < 0.5) return;
  engine.celebrate = -1;
  if (reduced) return;
  const matrix = engine.matrix;
  matrix.popCell = cell;
  matrix.popStart = now;
  matrix.twinkleCell = cell;
  matrix.twinkleStart = now;
  if (!matches) return;
  const x = wrapX(projection, route.target.bx);
  const y = route.target.by;
  engine.ping = { x, y, start: now };
  for (let i = 0; i < 30; i++) {
    const angle = Math.random() * TAU;
    const speed = 60 + Math.random() * 190;
    engine.sparks.push({
      x: x + (Math.random() - 0.5) * 4,
      y: y + (Math.random() - 0.5) * 4,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      age: 0,
      life: 0.4 + Math.random() * 0.55,
      size: Math.random() < 0.25 ? 2.5 : 1.5,
      mix: Math.random(),
    });
  }
}

/** x moved by whole map widths into the map's window. */
function wrapX(projection: MapProjection, x: number) {
  const { x0, x1 } = projection.frame;
  const world = x1 - x0;
  if (world <= 0) return x;
  return x0 + ((((x - x0) % world) + world) % world);
}

const packetPoint = { x: 0, y: 0, angle: 0 };

/**
 * Draws the ping, the fibre-minimum arc, the measured route with its packet, and the endpoints, once per visible copy
 * across the seam. Returns whether something ambient (packet, ping) is still running.
 */
function drawRoute(
  engine: Engine,
  surface: CanvasSurface,
  projection: MapProjection,
  lattice: DotLattice,
  ink: GeoInk,
  now: number,
  reduced: boolean,
) {
  const { context, width, height } = surface;
  context.clearRect(0, 0, width, height);
  let alive = false;
  if (engine.ping) alive = drawPing(context, lattice, engine, ink, now) || alive;

  const route = engine.route;
  const visible = clamp(route.visible.position, 0, 1);
  if (visible < 0.01) return alive;
  const ax = route.ax.position;
  const ay = route.ay.position;
  const bx = route.bx.position;
  const by = route.by.position;
  const dx = bx - ax;
  const dy = by - ay;
  const chord = Math.hypot(dx, dy);

  // the great circle, rebuilt from the sprung endpoints and the blended shape
  const mix = route.mix.position;
  let minX = Math.min(ax, bx);
  let maxX = Math.max(ax, bx);
  for (let i = 0; i < SHAPE_SAMPLES; i++) {
    const u = route.shapeFrom[i * 2] + (route.shapeTo[i * 2] - route.shapeFrom[i * 2]) * mix;
    const v = route.shapeFrom[i * 2 + 1] + (route.shapeTo[i * 2 + 1] - route.shapeFrom[i * 2 + 1]) * mix;
    route.shape[i * 2] = u;
    route.shape[i * 2 + 1] = v;
    const x = ax + u * dx + v * dy;
    const y = ay + u * dy - v * dx;
    route.ghostX[i] = x;
    route.ghostY[i] = y;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
  }
  const ghostTable = buildArcLength(route.ghostX, route.ghostY, SHAPE_SAMPLES, route.ghostTable);
  route.ghostTable = ghostTable;
  const curve = flatCurve(ax, ay, bx, by, route.bend.position, route.curve);
  const table = quadArcLength(curve, 48, route.table);
  route.table = table;
  minX = Math.min(minX, curve.cx);
  maxX = Math.max(maxX, curve.cx);

  const destination = clamp(route.ghost.position, 0, 1) * visible;
  const ghostAlpha = GHOST_ALPHA * destination;
  const measuredAlpha = clamp(route.measured.position, 0, 1) * visible;
  const packetOn = !reduced && measuredAlpha > 0.05 && chord > 6;
  const phase = (now % PACKET_SECONDS) / PACKET_SECONDS;
  const head = PACKET_EASE(phase) * table.length;
  const envelope = smoothstep(0, 0.08, phase) * (1 - smoothstep(0.9, 1, phase));

  const { x0, x1 } = projection.frame;
  const world = x1 - x0;
  const shifts = [0];
  if (minX < x0 - 2) shifts.push(world);
  if (maxX > x1 + 2) shifts.push(-world);

  for (const shift of shifts) {
    context.save();
    context.translate(shift, 0);

    if (ghostAlpha > 0.01 && ghostTable.length > 8) {
      context.fillStyle = rgba(ink.landStrong);
      context.globalAlpha = ghostAlpha;
      forEachDot(ghostTable, 4, 5, ghostTable.length - 5, (x, y) => context.fillRect(x - 0.75, y - 0.75, 1.5, 1.5));
    }

    if (measuredAlpha > 0.01 && table.length > 8) {
      context.fillStyle = rgba(ink.accent);
      context.globalAlpha = 0.9 * measuredAlpha;
      forEachDot(table, 4, 5, table.length - 5, (x, y) => context.fillRect(x - 1, y - 1, DOT, DOT));
      if (packetOn) {
        // the dots light up as the packet passes, then the packet itself with a short tail
        context.fillStyle = rgba(ink.shine);
        forEachDot(table, 4, Math.max(5, head - 26), Math.min(table.length - 5, head + 8), (x, y, s) => {
          const distance = (head - s) / 12;
          const glow = Math.exp(-distance * distance) * envelope * measuredAlpha;
          if (glow < 0.04) return;
          context.globalAlpha = glow * 0.85;
          context.fillRect(x - 1, y - 1, DOT, DOT);
        });
        for (let k = 0; k < 5; k++) {
          pointAtDistance(table, head - k * 2.5, packetPoint);
          context.globalAlpha = envelope * measuredAlpha * (1 - k / 5);
          const size = k === 0 ? 3 : 2;
          context.fillRect(packetPoint.x - size / 2, packetPoint.y - size / 2, size, size);
        }
      }
    }

    // endpoints: a card-coloured halo keeps them clear of the land dots. The destination fades with the fibre-minimum
    // arc, so on a diagonal cell it merges into the one region instead of covering it
    if (destination > 0.01) drawEndpoint(context, bx, by, ink.accent, ink.card, destination);
    drawEndpoint(context, ax, ay, ink.foreground, ink.card, visible);
    if (packetOn) {
      // the destination answers each arrival with a short ring
      const since = phase * PACKET_SECONDS;
      const flash = Math.exp(-since / 0.2) * measuredAlpha;
      if (flash > 0.03) {
        context.globalAlpha = flash * 0.7;
        context.strokeStyle = rgba(ink.accent);
        context.lineWidth = 1;
        context.beginPath();
        context.arc(bx, by, 4 + (1 - flash) * 5, 0, TAU);
        context.stroke();
      }
    }
    context.restore();
  }
  context.globalAlpha = 1;
  return alive || packetOn;
}

function drawEndpoint(context: CanvasRenderingContext2D, x: number, y: number, color: RGB, halo: RGB, alpha: number) {
  context.globalAlpha = alpha;
  context.fillStyle = rgba(halo);
  context.beginPath();
  context.arc(x, y, 4.75, 0, TAU);
  context.fill();
  context.fillStyle = rgba(color);
  context.beginPath();
  context.arc(x, y, 3, 0, TAU);
  context.fill();
  context.globalAlpha = 1;
}

/** Land dots around the committed destination light up in an uneven ring that runs outward. */
function drawPing(context: CanvasRenderingContext2D, lattice: DotLattice, engine: Engine, ink: GeoInk, now: number) {
  const ping = engine.ping;
  if (!ping) return false;
  const t = (now - ping.start) / PING_SECONDS;
  if (t >= 1 || t < 0) {
    engine.ping = null;
    return false;
  }
  const radius = easeOutCubic(t) * 48;
  const fade = (1 - t) * (1 - t);
  context.fillStyle = rgba(ink.accent);
  lattice.grid.query(ping.x, ping.y, radius + 16, (index, distanceSquared) => {
    const strength = ringFront(Math.sqrt(distanceSquared), radius, 6, lattice.jitter[index]) * fade;
    if (strength < 0.04) return;
    context.globalAlpha = Math.min(1, strength);
    context.fillRect(lattice.x[index] - MAP_DOT / 2, lattice.y[index] - MAP_DOT / 2, MAP_DOT, MAP_DOT);
  });
  context.globalAlpha = 1;
  return true;
}

/** Sparks on the canvas that reaches past the map. Returns whether any are alive. */
function drawSparks(engine: Engine, surface: CanvasSurface, ink: GeoInk, delta: number) {
  const { context, width, height } = surface;
  if (engine.sparks.length === 0) {
    if (engine.fxDirty) {
      context.clearRect(0, 0, width, height);
      engine.fxDirty = false;
    }
    return false;
  }
  engine.fxDirty = true;
  context.clearRect(0, 0, width, height);
  const drag = Math.exp(-delta * 3.2);
  const alive: Spark[] = [];
  for (const spark of engine.sparks) {
    spark.age += delta;
    if (spark.age >= spark.life) continue;
    spark.vx *= drag;
    spark.vy *= drag;
    spark.x += spark.vx * delta;
    spark.y += spark.vy * delta;
    const life = 1 - spark.age / spark.life;
    const hot = Math.max(0, 1 - spark.age / 0.12);
    context.globalAlpha = Math.pow(life, 1.3);
    context.fillStyle = rgba(mixRgb(ink.accent, ink.shine, Math.min(1, spark.mix * 0.6 + hot)));
    context.fillRect(
      Math.round((spark.x + FX_MARGIN) * 2) / 2,
      Math.round((spark.y + FX_MARGIN) * 2) / 2,
      spark.size,
      spark.size,
    );
    alive.push(spark);
  }
  context.globalAlpha = 1;
  engine.sparks = alive;
  return alive.length > 0;
}

/**
 * Places the DOM labels of the endpoints and of the fibre-minimum arc. An endpoint label takes the side of its dot
 * (right, left, above, below) that faces away from the route and fits inside the map; its offset is a spring, so it
 * swings round the dot instead of jumping. The fibre-minimum label sits outside the great circle's bulge.
 */
function placeLabels(
  engine: Engine,
  projection: MapProjection,
  elements: [HTMLElement | null, HTMLElement | null, HTMLElement | null],
  delta: number,
  reduced: boolean,
) {
  const [fromElement, toElement, floorElement] = elements;
  const route = engine.route;
  const { width, height } = projection;
  const visible = clamp(route.visible.position, 0, 1);
  const [widthA, widthB, widthFloor] = engine.labelWidths;
  const rawAx = route.ax.position;
  const rawBx = route.bx.position;
  const ax = wrapX(projection, rawAx);
  const ay = route.ay.position;
  const bx = wrapX(projection, rawBx);
  const by = route.by.position;
  const curve = route.curve;
  const snapLabels = reduced || visible < 0.05;

  // the route leaves each endpoint toward the curve's control point
  const towardA = route.same ? LABEL_RIGHT : unit(curve.cx - rawAx, curve.cy - ay);
  const towardB = route.same ? LABEL_RIGHT : unit(curve.cx - rawBx, curve.cy - by);
  labelOffset(route.labelA, ax, ay, widthA, towardA, width, height, delta, snapLabels);
  labelOffset(route.labelB, bx, by, widthB, towardB, width, height, delta, snapLabels);
  const place = (element: HTMLElement | null, x: number, y: number, labelWidth: number, opacity: number) => {
    if (!element) return;
    const left = clamp(x, 1, width - labelWidth - 1);
    const top = clamp(y, 0, height - LABEL_HEIGHT);
    element.style.transform = `translate3d(${left.toFixed(2)}px,${top.toFixed(2)}px,0)`;
    element.style.opacity = opacity.toFixed(3);
  };
  place(fromElement, ax + route.labelA.x.position, ay + route.labelA.y.position, widthA, visible);
  place(
    toElement,
    bx + route.labelB.x.position,
    by + route.labelB.y.position,
    widthB,
    clamp(route.ghost.position, 0, 1) * visible,
  );

  // the fibre-minimum label sits outside the great circle's bulge, at its middle
  const middle = SHAPE_SAMPLES >> 1;
  const dx = route.bx.position - route.ax.position;
  const dy = by - ay;
  const chord = Math.hypot(dx, dy);
  const bulge = route.shape[middle * 2 + 1];
  const outward = Math.abs(bulge) > 0.01 ? Math.sign(bulge) : -Math.sign(route.bend.position || 1);
  const nx = chord > 0 ? (dy / chord) * outward : 0;
  const ny = chord > 0 ? (-dx / chord) * outward : -1;
  const lx = wrapX(projection, route.ghostX[middle] + nx * 9);
  const ly = route.ghostY[middle] + ny * 9;
  const floorTop = ly - LABEL_HEIGHT / 2 + ny * 5;
  // only where the arc is long enough to carry it, and where its middle is on the map with room for the label
  const onMap = clamp(1 - Math.max(-floorTop, floorTop + LABEL_HEIGHT - height) / 6, 0, 1);
  const floorOpacity = route.same
    ? 0
    : clamp((chord - widthFloor - 14) / 12, 0, 1) * onMap * clamp(route.ghost.position, 0, 1) * visible;
  place(floorElement, lx - widthFloor / 2 + nx * (widthFloor / 2), floorTop, widthFloor, floorOpacity);
}

interface LabelSpring {
  x: Spring;
  y: Spring;
}

const LABEL_RIGHT = { x: -1, y: 0 };

function unit(x: number, y: number) {
  const length = Math.hypot(x, y);
  return length > 1e-6 ? { x: x / length, y: y / length } : LABEL_RIGHT;
}

/** Candidate sides of a label around its dot, as unit directions; sideways is preferred. */
const LABEL_SIDES = [
  { x: 1, y: 0, cost: 0 },
  { x: -1, y: 0, cost: 0 },
  { x: 0, y: -1, cost: 0.35 },
  { x: 0, y: 1, cost: 0.35 },
] as const;

/** Springs a label's top-left offset from its dot toward the best side: inside the map, away from the route. */
function labelOffset(
  label: LabelSpring,
  x: number,
  y: number,
  labelWidth: number,
  toward: { x: number; y: number },
  width: number,
  height: number,
  delta: number,
  snapNow: boolean,
) {
  let bestX = LABEL_GAP;
  let bestY = -LABEL_HEIGHT / 2;
  let bestScore = Infinity;
  for (const side of LABEL_SIDES) {
    const offsetX = side.x > 0 ? LABEL_GAP : side.x < 0 ? -LABEL_GAP - labelWidth : -labelWidth / 2;
    const offsetY = side.y < 0 ? -LABEL_GAP - LABEL_HEIGHT + 2 : side.y > 0 ? LABEL_GAP - 2 : -LABEL_HEIGHT / 2;
    const left = x + offsetX;
    const top = y + offsetY;
    const overflow =
      Math.max(0, 1 - left) +
      Math.max(0, left + labelWidth - (width - 1)) +
      Math.max(0, -top) +
      Math.max(0, top + LABEL_HEIGHT - height);
    const score = overflow * 0.25 + side.x * toward.x + side.y * toward.y + side.cost;
    if (score < bestScore) {
      bestScore = score;
      bestX = offsetX;
      bestY = offsetY;
    }
  }
  stepSpring(label.x, bestX, delta, snapNow, ROUTE_STIFFNESS, 1);
  stepSpring(label.y, bestY, delta, snapNow, ROUTE_STIFFNESS, 1);
}

const LABEL_HEIGHT = 14;
const LABEL_GAP = 7;
