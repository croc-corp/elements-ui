"use client";

import * as React from "react";

import { localPoint, snap, useCanvas, type CanvasSurface } from "@/lib/lumesec/canvas";
import { usePalette } from "@/lib/lumesec/color";
import {
  angleDelta,
  ARROW_DIRECTIONS,
  createDotBatch,
  DEG,
  createGlobeMotion,
  flyTo,
  GEO_TOKENS,
  geoInk,
  isOccluded,
  latLonToVector,
  nearestIndex,
  nudgeGlobe,
  ringFront,
  rotationFromView,
  shadeRamp,
  spacingForRadius,
  spatialNavigate,
  sphereLattice,
  stepGlobeMotion,
  useGlobeDrag,
  vectorToLatLon,
  type DotBatch,
  type GeoInk,
  type GeoPalette,
  type GlobeMotion,
  type LatLon,
  type NavigationDirection,
  type Rotation,
  type SphereLattice,
  type Vec3,
} from "@/lib/lumesec/geo";
import { createRandom, findCity, formatCompact } from "@/lib/lumesec/geo-data";
import { clamp, rgba, smoothstep, type RGB } from "@/lib/lumesec/math";
import {
  prefersReducedMotion,
  springStep,
  useAnimationLoop,
  useLazyRef,
  useReducedMotion,
  type Spring,
} from "@/lib/lumesec/motion";
import { RollText } from "@/lib/lumesec/roll-text";
import { Sparks } from "@/lib/lumesec/sparks";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** One location and its count. A new `data` array is matched to the previous one by `id`. */
export interface SpikeDatum {
  /** Stable id. A spike keeps its id across updates, so it grows or shrinks from its previous height. */
  readonly id: string;
  /** Place name for the chip, the legend and the accessible list. */
  readonly label: string;
  /** Latitude in degrees. */
  readonly lat: number;
  /** Longitude in degrees. */
  readonly lon: number;
  /** The count at this location. Zero or negative values draw only the footprint. */
  readonly value: number;
}

/** How values map to spike heights. */
export type GeoSpikesScale = "log" | "linear";

/** Props of `GeoSpikes`. Other `div` props, `ref` included, go to the root. */
export interface GeoSpikesProps extends Omit<React.ComponentProps<"div">, "defaultValue"> {
  /**
   * Counts per location, `{ id, label, lat, lon, value }`. Changes are matched by `id` and grow in a wave from the
   * biggest increase. Without it the globe shows demo counts for 24 cities; an empty array shows an empty globe.
   */
  data?: readonly SpikeDatum[];
  /** The selected spike's id (controlled), or null for none. Use with `onValueChange`. */
  value?: string | null;
  /** The spike selected at first when uncontrolled. */
  defaultValue?: string | null;
  /** Called when a spike is selected or the selection is cleared. */
  onValueChange?: (value: string | null) => void;
  /**
   * How values map to heights. `log` spreads the three decades below the largest value evenly, so one busy place
   * does not flatten the rest; `linear` makes height proportional to the value.
   */
  scale?: GeoSpikesScale;
  /** Height of the tallest spike as a share of the globe radius, 0.1 to 0.6. */
  maxHeight?: number;
  /** Formats counts in the chip, the legend and the accessible list. */
  format?: (value: number) => string;
  /** Unit after each count. */
  unit?: string;
  /** Where the globe faces on mount. Default: a view tilted south of the value-weighted centre of the data. */
  defaultCenter?: LatLon;
  /** Accessible name of the globe. */
  label?: string;
}

/**
 * Counts per location as columns of stacked dots standing on a dotted globe. When `data` changes, the spikes grow on
 * springs in a wave that starts at the biggest increase: a ring of light runs across the land and starts each spike
 * as it passes, every tip flickers at the top of its overshoot, and the places that jumped throw a few sparks. Drag
 * to turn the globe; point at a spike, or Tab to it, to roll its count into a chip.
 *
 * @example
 * <GeoSpikes data={signIns} unit="sign-ins" onValueChange={(id) => setCity(id)} />
 */
export function GeoSpikes({
  data,
  value,
  defaultValue = null,
  onValueChange,
  scale = "log",
  maxHeight = 0.5,
  format = formatCompact,
  unit = "events",
  defaultCenter,
  label = "Events by location",
  className,
  ...props
}: GeoSpikesProps) {
  const reducedMotion = useReducedMotion();
  const prepared = React.useMemo(() => prepareData(data ?? DEMO_DATA), [data]);
  const points = prepared.points;
  const [selection, setSelection] = useControllableState<string | null>({ value, defaultValue, onChange: onValueChange });
  const [hovered, setHovered] = React.useState<string | null>(null);
  const [focused, setFocused] = React.useState<string | null>(null);
  const [roving, setRoving] = React.useState<string | null>(null);

  // Counts on screen wait for the wave: each one rolls when the ring reaches its spike.
  const [display, setDisplay] = React.useState<DisplayState>(() => ({ points, held: NO_HOLDS, legend: [] }));
  if (display.points !== points) {
    setDisplay({
      points,
      held: reducedMotion ? NO_HOLDS : holdPrevious(display.points, points, display.held),
      legend: legendOf(display),
    });
  }
  const shownValue = (point: SpikePoint) => display.held.get(point.id) ?? point.value;

  const has = (id: string | null): id is string => id !== null && points.some((point) => point.id === id);
  const selected = has(selection) ? selection : null;
  const chipId = has(hovered) ? hovered : has(focused) ? focused : selected;
  const [chipShown, setChipShown] = React.useState(chipId);
  if (chipId !== null && chipId !== chipShown) setChipShown(chipId);
  const chipPoint = points.find((point) => point.id === chipShown) ?? null;
  const rovingId = has(roving) ? roving : (selected ?? points[0]?.id ?? null);
  const legend = legendOf(display);
  const hintId = React.useId();

  const stageRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const chipRef = React.useRef<HTMLDivElement>(null);
  const buttons = React.useRef(new Map<string, HTMLButtonElement>());
  const engineRef = useLazyRef(() => createEngine());
  // the globe starts on the first render's data and keeps its own view from then on
  const motionRef = useLazyRef(() => {
    const view = startView(points, defaultCenter);
    return createGlobeMotion({ lon: view.lon, lat: view.lat, stiffness: 120, damping: 0.85, latLimit: LAT_LIMIT });
  });

  const loop = useAnimationLoop(stageRef, step);
  const palette = usePalette(stageRef, GEO_TOKENS, () => loop.kick());
  const surfaceRef = useCanvas(
    canvasRef,
    (surface) => {
      layoutEngine(engineRef.current, surface);
      loop.kick();
    },
    { maxDpr: 2 },
  );

  useGlobeDrag(stageRef, motionRef, {
    radius: () => engineRef.current.layout.radius * motionRef.current.zoom,
    onChange: () => {
      engineRef.current.interactionAt = performance.now() / 1000;
      loop.kick();
    },
    onTap: (x, y) => {
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const id = hitTest(engineRef.current, x * zoomOf(stage, rect), y * zoomOf(stage, rect), TAP_RADIUS);
      if (id === null) {
        setSelection(null);
        return;
      }
      setRoving(id);
      setSelection((previous) => (previous === id ? null : id));
    },
  });

  // New data: diff by id, retarget the springs and ask the loop for a wave. Scale changes retarget without a wave.
  React.useEffect(() => {
    applyData(engineRef.current, points, scale, maxHeight);
    loop.kick();
  }, [points, scale, maxHeight, engineRef, loop]);

  // The loop reads which spikes are lit; a selection made elsewhere turns the globe when its spike is out of view.
  React.useEffect(() => {
    const engine = engineRef.current;
    engine.chipId = chipId;
    engine.selectedId = selected;
    loop.kick();
  }, [chipId, selected, engineRef, loop]);

  React.useEffect(() => {
    if (selected !== null && faceSpike(engineRef.current, motionRef.current, selected, 0.05)) loop.kick();
  }, [selected, engineRef, motionRef, loop]);

  // A fallback for holds the loop did not release (the globe was off screen during the wave).
  React.useEffect(() => {
    if (display.held.size === 0) return;
    const timer = window.setTimeout(() => setDisplay((current) => ({ ...current, held: NO_HOLDS })), HOLD_TIMEOUT);
    return () => window.clearTimeout(timer);
  }, [display.held]);

  function step(time: number, delta: number) {
    const engine = engineRef.current;
    const surface = surfaceRef.current;
    const colors = palette.current;
    if (!surface || !colors || !engine.lattice) return false;
    if (engine.inkSource !== colors) applyInk(engine, colors);
    if (!engine.ink) return false;
    const reduced = prefersReducedMotion();
    const motion = motionRef.current;

    let busy = stepGlobeMotion(motion, delta, reduced);
    if (engine.request) beginWave(engine, motion, time, reduced);
    rotationFromView(motion.lon, motion.lat, engine.rotation);
    const released: string[] = [];
    busy = stepSpikes(engine, time, delta, reduced, released) || busy;
    busy = drawScene(engine, surface, motion.zoom, time, delta) || busy;
    busy = placeOverlay(engine, buttons.current, chipRef.current, delta, reduced) || busy;
    if (released.length) setDisplay((current) => releaseHolds(current, released));
    return busy || engine.request !== null;
  }

  function focusSpike(id: string) {
    setRoving(id);
    buttons.current.get(id)?.focus({ preventScroll: true });
  }

  function handleSpikeKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, id: string) {
    const direction = ARROW_DIRECTIONS[event.key];
    if (direction) {
      event.preventDefault();
      event.stopPropagation();
      const next = navigateFrom(engineRef.current, id, direction);
      if (next !== null && next !== id) focusSpike(next);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      event.stopPropagation();
      const target = event.key === "Home" ? points[0] : points[points.length - 1];
      if (target) focusSpike(target.id);
      return;
    }
    if (event.key === "Escape" && selected !== null) {
      event.preventDefault();
      event.stopPropagation();
      setSelection(null);
    }
  }

  function handleSpikeFocus(id: string) {
    setFocused(id);
    setRoving(id);
    if (faceSpike(engineRef.current, motionRef.current, id, 0.2)) loop.kick();
  }

  function handleStageKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const turn = GLOBE_KEYS[event.key];
    if (turn) {
      event.preventDefault();
      nudgeGlobe(motionRef.current, turn[0], turn[1]);
      engineRef.current.interactionAt = performance.now() / 1000;
      loop.kick();
      return;
    }
    if (event.key === "Escape" && selected !== null) {
      event.preventDefault();
      setSelection(null);
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch" || motionRef.current.dragging) return;
    const stage = event.currentTarget;
    const { x, y } = localPoint(stage, event.clientX, event.clientY);
    const id = hitTest(engineRef.current, x, y, HOVER_RADIUS);
    setHovered(id);
    stage.style.cursor = id ? "pointer" : "";
  }

  function handlePointerLeave(event: React.PointerEvent<HTMLDivElement>) {
    setHovered(null);
    event.currentTarget.style.cursor = "";
  }

  return (
    <div
      data-slot="geo-spikes"
      className={cn("@container relative grid w-full rounded-xl border border-border bg-card text-card-foreground", className)}
      {...props}
    >
      <div
        ref={stageRef}
        role="group"
        aria-roledescription="globe"
        aria-label={label}
        aria-describedby={hintId}
        tabIndex={0}
        onKeyDown={handleStageKeyDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        className="group/stage relative aspect-[25/23] w-full cursor-grab touch-pan-y rounded-t-xl outline-none select-none [-webkit-tap-highlight-color:transparent] active:cursor-grabbing"
      >
        <div
          aria-hidden="true"
          className="absolute top-[52%] left-1/2 aspect-square w-[62%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-[color-mix(in_srgb,var(--card),var(--foreground)_3%)] [transition:border-color_.2s_ease,box-shadow_.2s_ease] group-focus-visible/stage:border-lumesec group-focus-visible/stage:shadow-[0_0_0_3px_color-mix(in_srgb,var(--lumesec)_22%,transparent)]"
        />
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="pointer-events-none absolute -inset-x-4 -inset-y-8 z-[1] block h-[calc(100%+64px)] w-[calc(100%+32px)] min-[480px]:-inset-x-8 min-[480px]:w-[calc(100%+64px)]"
        />
        {points.map((point) => (
          <button
            key={point.id}
            ref={(node) => {
              if (node) buttons.current.set(point.id, node);
              else buttons.current.delete(point.id);
            }}
            type="button"
            tabIndex={point.id === rovingId ? 0 : -1}
            aria-pressed={point.id === selected}
            aria-label={`${point.label}, ${format(point.value)} ${unit}`}
            onClick={() => {
              setRoving(point.id);
              setSelection((previous) => (previous === point.id ? null : point.id));
            }}
            onKeyDown={(event) => handleSpikeKeyDown(event, point.id)}
            onFocus={() => handleSpikeFocus(point.id)}
            onBlur={() => setFocused((current) => (current === point.id ? null : current))}
            className="pointer-events-none absolute top-0 left-0 z-[2] size-6 rounded-full border-0 bg-transparent p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-solid focus-visible:outline-lumesec"
          />
        ))}
        <div
          ref={chipRef}
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0 z-[3] flex items-center gap-1.5 rounded-md border border-border bg-popover px-2 py-1 text-[12px] leading-4 whitespace-nowrap text-popover-foreground opacity-0 shadow-[0_8px_22px_-12px_rgb(0_0_0/0.45)] transition-opacity duration-150 will-change-transform motion-reduce:transition-none"
        >
          {chipPoint && (
            <>
              <RollText text={chipPoint.label} className="font-medium" />
              <span className="font-mono tabular-nums">
                <RollingNumber value={shownValue(chipPoint)} text={format(shownValue(chipPoint))} />
              </span>
              <span className="text-muted-foreground">{unit}</span>
            </>
          )}
        </div>
        <p id={hintId} className="sr-only">
          Drag or press the arrow keys to turn the globe. Tab moves to the spikes; arrow keys move between them and Enter
          selects one.
        </p>
      </div>
      <div aria-hidden="true" className="grid min-h-[50px] grid-cols-3 border-t border-border">
        {legend.length === 0 ? (
          <p className="col-span-3 m-0 self-center px-3 text-[12px] text-muted-foreground">No locations to show.</p>
        ) : (
          legend.map((slot, rank) => {
            const lit = slot.id === chipId || slot.id === selected;
            return (
              <div
                key={rank}
                data-lit={lit ? "" : undefined}
                onPointerEnter={() => setHovered(slot.id)}
                onPointerLeave={() => setHovered((current) => (current === slot.id ? null : current))}
                className="group/item min-w-0 overflow-hidden px-2.5 py-1.5 @min-[380px]:px-3 [&:not(:first-child)]:border-l [&:not(:first-child)]:border-border"
              >
                <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] leading-4 text-muted-foreground">
                  <span className="font-mono text-[10px] tabular-nums transition-colors group-data-[lit]/item:text-lumesec">
                    {String(rank + 1).padStart(2, "0")}
                  </span>
                  <RollText text={slot.label} className="min-w-0" />
                </div>
                <div className="mt-0.5 flex items-baseline gap-1 leading-5">
                  <span className="font-mono text-[15px] tracking-[-0.01em] text-foreground tabular-nums">
                    <RollingNumber value={slot.value} text={format(slot.value)} />
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">{unit}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="sr-only">
        {prepared.total > points.length && (
          <p>
            The globe shows the {points.length} largest of {prepared.total} locations.
          </p>
        )}
        <ul aria-label={label}>
          {points.map((point) => (
            <li key={point.id}>
              {point.label}: {format(point.value)} {unit}
            </li>
          ))}
          {points.length === 0 && <li>No locations to show.</li>}
        </ul>
      </div>
    </div>
  );
}

/** A RollText for a number that rolls up when the value grows and down when it shrinks. */
function RollingNumber({ value, text }: { value: number; text: string }) {
  const [state, setState] = React.useState({ value, direction: 1 });
  if (state.value !== value) setState({ value, direction: value >= state.value ? 1 : -1 });
  return <RollText text={text} direction={state.direction} />;
}

/* Constants ------------------------------------------------------------------------------------------ */

/** Globe radius as a share of the stage width; tips at 1.5 radii stay inside the stage. */
const GLOBE_SCALE = 0.31;
/** The globe sits a little below the middle: with the tilted views most spikes stand on the upper half. */
const GLOBE_Y = 0.52;
const LAT_LIMIT = 35;
/**
 * The start view sits this far south of the data, so the spikes stand up instead of pointing at the viewer (an
 * orthographic globe shows a spike at the centre of the disc end-on).
 */
const VIEW_TILT = 30;
/** Turning toward one spike puts it this far from the centre (up to FOCUS_TILT of it in latitude), so it stands tall. */
const FOCUS_ANGLE = 50;
const FOCUS_TILT = 35;
const MAX_SPIKES = 64;

const LAND_PITCH = 4;
const LAND_DOT = 1.5;
const SPIKE_STEP = 3;
const SPIKE_DOT = 2;
const TIP_DOT = 2.5;
const FOOT_DOT = 1.5;
/** Distance of the three footprint dots from the base, in px on the globe surface. */
const FOOT_PX = 3.2;
const FOOT_ANGLES = [Math.PI / 2, (Math.PI * 7) / 6, (Math.PI * 11) / 6];
const COLUMN_TONES = 16;
/** Alpha of the spikes that are not lit while one is. */
const DIM_ALPHA = 0.55;
/** Alpha of spike dots behind the globe that show above its limb. */
const BEHIND_ALPHA = 0.36;
/** The same for a lit spike, which should read clearly even from behind. */
const LIT_BEHIND_ALPHA = 0.8;

const SPIKE_STIFFNESS = 170;
const SPIKE_DAMPING = 0.62;
/** Seconds for the wave to reach the far side of the globe. */
const WAVE_SECONDS = 0.7;
/** Seconds the land keeps a fading glow behind the ring. */
const WAKE_SECONDS = 0.6;
const RING_WIDTH = 8;
const FLARE_SECONDS = 0.22;
/** Time constant of the highlight when a spike is pointed at or selected. */
const HIGHLIGHT_SECONDS = 0.07;
/** Seconds the wave waits while the globe turns toward a far-side epicentre. */
const FLY_LEAD = 0.5;
/** Seconds without a drag before an update may turn the globe. */
const IDLE_BEFORE_FLY = 4;
/** Rotated depth below which a spike counts as being on the far side. */
const FAR_SIDE = 0;
const HOVER_RADIUS = 14;
const TAP_RADIUS = 20;
const HOLD_TIMEOUT = 2600;
/** Three decades below the largest value fill the height on the log scale. */
const LOG_RANGE = 999;

/** startAt while a spike waits for the wave to begin; −1 when nothing is pending. */
const WAITING = Number.POSITIVE_INFINITY;
const IDLE = -1;

/** Arrow keys move the view in the arrow's direction, 10° at a time. */
const GLOBE_KEYS: Record<string, readonly [number, number] | undefined> = {
  ArrowLeft: [-10, 0],
  ArrowRight: [10, 0],
  ArrowUp: [0, 10],
  ArrowDown: [0, -10],
};

/** The 24 cities of the built-in demo, spread over every continent. */
const DEMO_CITY_IDS = "lhr cdg fra ams mad ist jfk ord sfo lax yyz mex gru bog eze los cai jnb dxb bom sin nrt icn syd".split(" ");

/** Invented counts for the demo cities, deterministic so server and client render the same numbers. */
const DEMO_DATA: readonly SpikeDatum[] = buildDemoData();

function buildDemoData(): SpikeDatum[] {
  const random = createRandom("geo-spikes");
  const result: SpikeDatum[] = [];
  for (const id of DEMO_CITY_IDS) {
    const city = findCity(id);
    if (!city) continue;
    const value = Math.round(42000 * Math.pow(city.weight, 2.2) * (0.7 + 0.6 * random()));
    result.push({ id, label: city.name, lat: city.lat, lon: city.lon, value });
  }
  return result;
}

/* Data ----------------------------------------------------------------------------------------------- */

/** A valid datum, after filtering. */
type SpikePoint = SpikeDatum;

interface PreparedData {
  /** The (at most 64) largest valid entries, largest first. */
  points: readonly SpikePoint[];
  /** How many valid entries the data had. */
  total: number;
}

/**
 * Valid entries only (finite numbers, a latitude within ±90°, a non-empty id, the first of duplicate ids), the 64
 * largest, largest first.
 */
function prepareData(data: readonly SpikeDatum[]): PreparedData {
  const seen = new Set<string>();
  const valid: SpikePoint[] = [];
  for (const datum of data) {
    if (!datum || typeof datum.id !== "string" || datum.id === "" || seen.has(datum.id)) continue;
    if (!Number.isFinite(datum.lat) || !Number.isFinite(datum.lon) || !Number.isFinite(datum.value)) continue;
    if (Math.abs(datum.lat) > 90) continue;
    seen.add(datum.id);
    valid.push(datum);
  }
  const sorted = valid
    .map((point, index) => ({ point, index }))
    .sort((a, b) => b.point.value - a.point.value || a.index - b.index)
    .map((entry) => entry.point);
  return { points: sorted.slice(0, MAX_SPIKES), total: sorted.length };
}

/** Height of a spike in globe radii. */
function heightFor(value: number, max: number, scale: GeoSpikesScale, maxHeight: number) {
  if (!(value > 0) || !(max > 0)) return 0;
  const share =
    scale === "linear" ? value / max : Math.log10(1 + (LOG_RANGE * value) / max) / Math.log10(1 + LOG_RANGE);
  return clamp(Number.isFinite(maxHeight) ? maxHeight : 0.5, 0.1, 0.6) * clamp(share, 0, 1);
}

/** The view on mount: `defaultCenter` as given, else tilted south of the value-weighted centre of the data. */
function startView(points: readonly SpikePoint[], center: LatLon | undefined): LatLon {
  if (center && Number.isFinite(center.lat) && Number.isFinite(center.lon)) return center;
  const sum: Vec3 = [0, 0, 0];
  const v: Vec3 = [0, 0, 0];
  const anyPositive = points.some((point) => point.value > 0);
  for (const point of points) {
    const weight = anyPositive ? Math.max(0, point.value) : 1;
    latLonToVector(point.lat, point.lon, v);
    sum[0] += v[0] * weight;
    sum[1] += v[1] * weight;
    sum[2] += v[2] * weight;
  }
  if (Math.hypot(sum[0], sum[1], sum[2]) < 1e-9) return { lat: 20, lon: 0 };
  const centroid = vectorToLatLon(sum);
  return { lon: centroid.lon, lat: tiltedLatitude(centroid.lat, VIEW_TILT) };
}

/**
 * A view that shows a place FOCUS_ANGLE degrees from the centre: up (or, far south, down) by up to FOCUS_TILT and the
 * rest to the side, on the side that needs the shorter turn from `fromLon`.
 */
function focusView(lat: number, lon: number, fromLon: number): LatLon {
  const centerLat = tiltedLatitude(lat, FOCUS_TILT);
  const phi = lat * DEG;
  const centerPhi = centerLat * DEG;
  const cosLon =
    (Math.cos(FOCUS_ANGLE * DEG) - Math.sin(phi) * Math.sin(centerPhi)) / Math.max(1e-6, Math.cos(phi) * Math.cos(centerPhi));
  const offset = Math.acos(clamp(cosLon, -1, 1)) / DEG;
  const side = angleDelta(fromLon, lon) >= 0 ? 1 : -1;
  return { lat: centerLat, lon: lon - side * offset };
}

/** A centre latitude that puts a place `tilt` degrees into the upper half (far south: the lower half) of the disc. */
function tiltedLatitude(lat: number, tilt: number) {
  return clamp(lat >= -12 ? lat - tilt : lat + tilt, -LAT_LIMIT, LAT_LIMIT);
}

/** One legend entry as shown. */
interface LegendSlot {
  readonly id: string;
  readonly label: string;
  readonly value: number;
}

interface DisplayState {
  points: readonly SpikePoint[];
  /** Previous values shown until the wave reaches each spike. */
  held: ReadonlyMap<string, number>;
  /** The legend shown before this data arrived; each slot keeps it until the wave reaches the slot's new place. */
  legend: readonly LegendSlot[];
}

/** The three largest places (points come sorted), each slot rolling over once its new place is reached. */
function legendOf(state: DisplayState): LegendSlot[] {
  return state.points.slice(0, 3).map((point, slot) => {
    const previous = state.legend[slot];
    if (previous && state.held.has(point.id)) return previous;
    return { id: point.id, label: point.label, value: point.value };
  });
}

const NO_HOLDS: ReadonlyMap<string, number> = new Map();

function holdPrevious(previous: readonly SpikePoint[], next: readonly SpikePoint[], held: ReadonlyMap<string, number>) {
  const before = new Map(previous.map((point) => [point.id, held.get(point.id) ?? point.value]));
  const holds = new Map<string, number>();
  for (const point of next) {
    const old = before.get(point.id) ?? 0;
    if (old !== point.value) holds.set(point.id, old);
  }
  return holds.size ? holds : NO_HOLDS;
}

function releaseHolds(current: DisplayState, ids: readonly string[]): DisplayState {
  if (!ids.some((id) => current.held.has(id))) return current;
  const held = new Map(current.held);
  for (const id of ids) held.delete(id);
  return { ...current, held: held.size ? held : NO_HOLDS };
}

/* Engine --------------------------------------------------------------------------------------------- */

/** The stage inside the canvas, in canvas px: its size, the canvas's reach past it, the globe's centre and radius. */
interface StageLayout {
  width: number;
  height: number;
  bleedX: number;
  bleedY: number;
  radius: number;
  cx: number;
  cy: number;
}

/** One spike's animation state. Lives in the engine ref, never in React state. */
interface SpikeState {
  readonly id: string;
  lat: number;
  lon: number;
  vector: Vec3;
  /** Unit east and north at the base, for the footprint. */
  east: Vec3;
  north: Vec3;
  /** Height in globe radii (the spring position). */
  position: number;
  velocity: number;
  /** Where the spring pulls now. */
  target: number;
  /** The height the wave hands over at `startAt`. */
  next: number;
  /** Loop time in seconds when `next` becomes the target, WAITING before the wave starts, IDLE when nothing waits. */
  startAt: number;
  /** Removed from the data: shrinks with the wave, then goes. */
  leaving: boolean;
  /** Growing toward a higher target: the tip flares at the top of the overshoot. */
  armed: boolean;
  flare: number;
  /** 0 to 1: eases to 1 while the spike is hovered, focused or selected. */
  light: number;
  /** Sparks to throw at the top of the overshoot (0 for none). */
  burst: number;
  fire: boolean;
  /** Frame values: rotated depth of the base, screen positions in canvas px. */
  depth: number;
  baseX: number;
  baseY: number;
  tipX: number;
  tipY: number;
  tipVisible: boolean;
  /** The button position last written, to skip unchanged style writes. */
  domX: number;
  domY: number;
}

interface Engine {
  spikes: Map<string, SpikeState>;
  /** Spikes in data order (leaving ones at the end). */
  list: SpikeState[];
  /** Painter order, rebuilt every frame by insertion sort. */
  order: Int16Array;
  points: readonly SpikePoint[] | null;
  /** A wave the loop starts on its next frame, so it plays when the globe is on screen. */
  request: { epicentre: string | null; intro: boolean; ring: boolean } | null;
  wave: { start: number; ring: boolean; epicentre: Vec3 };
  /** Angle from the epicentre per lattice dot, built when a wave starts. */
  angles: Float32Array | null;
  anglesFor: SphereLattice | null;
  lattice: SphereLattice | null;
  layout: StageLayout;
  rotation: Rotation;
  ink: GeoInk | null;
  inkSource: GeoPalette | null;
  landBatch: DotBatch;
  columnRamp: string[];
  litColor: string;
  tipColor: string;
  footColor: string;
  sparkColors: RGB[];
  sparks: Sparks;
  /** Visible tips of the last frame, in canvas px, for hover and taps. */
  hitX: Float32Array;
  hitY: Float32Array;
  hitIds: string[];
  hitCount: number;
  chipId: string | null;
  selectedId: string | null;
  /** 0 to 1: eases to 1 while any spike is lit, dimming the rest. */
  dim: number;
  chip: { id: string | null; x: number; y: number; visible: boolean; offsetX: Spring; offsetY: Spring };
  /** Loop-clock seconds of the last drag or key turn. */
  interactionAt: number;
}

function createEngine(): Engine {
  return {
    spikes: new Map(),
    list: [],
    order: new Int16Array(MAX_SPIKES * 2),
    points: null,
    request: null,
    wave: { start: -10, ring: false, epicentre: [0, 0, 1] },
    angles: null,
    anglesFor: null,
    lattice: null,
    layout: { width: 0, height: 0, bleedX: 0, bleedY: 0, radius: 0, cx: 0, cy: 0 },
    rotation: new Float64Array(9),
    ink: null,
    inkSource: null,
    landBatch: createDotBatch(4096, [
      [128, 128, 128],
      [128, 128, 128],
    ]),
    columnRamp: [],
    litColor: "rgb(128,128,128)",
    tipColor: "rgb(128,128,128)",
    footColor: "rgb(128,128,128)",
    sparkColors: [],
    sparks: new Sparks(),
    hitX: new Float32Array(MAX_SPIKES),
    hitY: new Float32Array(MAX_SPIKES),
    hitIds: [],
    hitCount: 0,
    chipId: null,
    selectedId: null,
    dim: 0,
    chip: { id: null, x: 0, y: 0, visible: false, offsetX: { position: 0, velocity: 0 }, offsetY: { position: 0, velocity: 0 } },
    interactionAt: Number.NEGATIVE_INFINITY,
  };
}

/**
 * Sizes follow the stage. The canvas reaches past it so sparks never clip: 32 px on every side, but only 16 px to the
 * sides on screens narrower than 480 px, where a wider reach would scroll the page sideways. Measured, not assumed.
 */
function layoutEngine(engine: Engine, surface: CanvasSurface) {
  const bleedX = Math.max(0, -surface.canvas.offsetLeft);
  const bleedY = Math.max(0, -surface.canvas.offsetTop);
  const width = surface.width - bleedX * 2;
  const height = surface.height - bleedY * 2;
  const radius = width * GLOBE_SCALE;
  engine.layout = { width, height, bleedX, bleedY, radius, cx: bleedX + width / 2, cy: bleedY + height * GLOBE_Y };
  // quantised, so small resizes reuse the cached lattice
  const spacing = Math.round(spacingForRadius(radius, LAND_PITCH) * 20) / 20;
  engine.lattice = sphereLattice({ spacingDeg: spacing, landOnly: true });
}

function applyInk(engine: Engine, palette: GeoPalette) {
  const ink = geoInk(palette);
  engine.ink = ink;
  engine.inkSource = palette;
  engine.landBatch.setRamp([ink.land, ink.accent]);
  engine.columnRamp = shadeRamp([ink.land, ink.accent], COLUMN_TONES);
  engine.litColor = rgba(ink.accent);
  engine.tipColor = rgba(ink.shine);
  engine.footColor = rgba(ink.accent);
  engine.sparkColors = [ink.accent, ink.soft, ink.shine];
}

function createSpike(point: SpikePoint): SpikeState {
  const spike: SpikeState = {
    id: point.id,
    lat: point.lat,
    lon: point.lon,
    vector: [0, 0, 1],
    east: [1, 0, 0],
    north: [0, 1, 0],
    position: 0,
    velocity: 0,
    target: 0,
    next: 0,
    startAt: IDLE,
    leaving: false,
    armed: false,
    flare: 0,
    light: 0,
    burst: 0,
    fire: false,
    depth: 0,
    baseX: 0,
    baseY: 0,
    tipX: 0,
    tipY: 0,
    tipVisible: false,
    domX: Number.NaN,
    domY: Number.NaN,
  };
  placeSpike(spike, point);
  return spike;
}

function placeSpike(spike: SpikeState, point: SpikePoint) {
  spike.lat = point.lat;
  spike.lon = point.lon;
  latLonToVector(point.lat, point.lon, spike.vector);
  const lambda = (point.lon * Math.PI) / 180;
  const phi = (point.lat * Math.PI) / 180;
  spike.east[0] = Math.cos(lambda);
  spike.east[1] = 0;
  spike.east[2] = -Math.sin(lambda);
  spike.north[0] = -Math.sin(phi) * Math.sin(lambda);
  spike.north[1] = Math.cos(phi);
  spike.north[2] = -Math.sin(phi) * Math.cos(lambda);
}

/**
 * Diffs new data against the spikes by id. A new array schedules a wave from the biggest increase (the first one
 * grows every spike from zero); the same array with another scale or height only retargets the springs.
 */
function applyData(engine: Engine, points: readonly SpikePoint[], scale: GeoSpikesScale, maxHeight: number) {
  const max = points.reduce((largest, point) => Math.max(largest, point.value), 0);
  const fresh = engine.points !== points;
  const intro = engine.points === null;

  if (!fresh) {
    for (const point of points) {
      const spike = engine.spikes.get(point.id);
      if (!spike) continue;
      const height = heightFor(point.value, max, scale, maxHeight);
      if (spike.startAt === IDLE) spike.target = height;
      spike.next = height;
    }
    return;
  }

  const previous = new Map((engine.points ?? []).map((point) => [point.id, point.value]));
  engine.points = points;
  let epicentre: string | null = points[0]?.id ?? null;
  let biggest = 0;
  const present = new Set<string>();
  for (const point of points) {
    present.add(point.id);
    const before = previous.get(point.id);
    const delta = point.value - (before ?? 0);
    if (!intro && delta > biggest) {
      biggest = delta;
      epicentre = point.id;
    }
    let spike = engine.spikes.get(point.id);
    if (!spike) {
      spike = createSpike(point);
      engine.spikes.set(point.id, spike);
    } else {
      placeSpike(spike, point);
      spike.leaving = false;
    }
    spike.next = heightFor(point.value, max, scale, maxHeight);
    spike.startAt = WAITING;
    // places that jumped by half or more throw sparks at the top of their overshoot
    const jumped = before !== undefined && before > 0 ? point.value / before >= 1.5 : point.value > 0 && !intro;
    spike.burst = jumped && delta > 0 ? 14 : 0;
  }
  if (epicentre !== null) {
    const spike = engine.spikes.get(epicentre);
    if (spike && spike.next > 0) spike.burst = Math.max(spike.burst, 18);
  }
  for (const spike of engine.spikes.values()) {
    if (present.has(spike.id)) continue;
    spike.leaving = true;
    spike.next = 0;
    spike.startAt = WAITING;
    spike.burst = 0;
  }
  // data order first, so the buttons and the painter sort start from a stable order
  engine.list = [
    ...points.map((point) => engine.spikes.get(point.id)).filter((spike): spike is SpikeState => spike !== undefined),
    ...[...engine.spikes.values()].filter((spike) => spike.leaving),
  ];
  if (engine.list.length > engine.order.length) engine.order = new Int16Array(engine.list.length * 2);
  // shrinking alone uses the same delays without the ring
  engine.request = { epicentre, intro, ring: intro || biggest > 0 };
}

/** View-space depth of a unit vector: above 0 faces the viewer. */
function depthOf(rotation: Rotation, v: Readonly<Vec3>) {
  return rotation[6] * v[0] + rotation[7] * v[1] + rotation[8] * v[2];
}

/**
 * Turns the globe toward a spike whose base faces away more than `threshold` allows (0 is the limb), with a spring, or
 * at once with reduced motion. Returns whether it turns.
 */
function faceSpike(engine: Engine, motion: GlobeMotion, id: string, threshold: number) {
  const spike = engine.spikes.get(id);
  if (!spike || motion.dragging) return false;
  const view = motion.target ?? motion;
  rotationFromView(view.lon, view.lat, depthScratchRotation);
  if (depthOf(depthScratchRotation, spike.vector) >= threshold) return false;
  flyTo(motion, focusView(spike.lat, spike.lon, view.lon));
  return true;
}

const depthScratchRotation: Rotation = new Float64Array(9);

/** Starts a requested wave: turns toward a far-side epicentre if the user is idle, then times every spike. */
function beginWave(engine: Engine, motion: GlobeMotion, time: number, reduced: boolean) {
  const request = engine.request;
  engine.request = null;
  if (!request) return;
  const epicentre = request.epicentre !== null ? engine.spikes.get(request.epicentre) : undefined;
  let start = time;
  if (
    epicentre &&
    !reduced &&
    !request.intro &&
    engine.selectedId === null &&
    !motion.dragging &&
    time - engine.interactionAt > IDLE_BEFORE_FLY
  ) {
    rotationFromView(motion.lon, motion.lat, depthScratchRotation);
    if (depthOf(depthScratchRotation, epicentre.vector) < FAR_SIDE) {
      flyTo(motion, focusView(epicentre.lat, epicentre.lon, motion.lon));
      start = time + FLY_LEAD;
    }
  }
  const origin = epicentre?.vector;
  if (origin) {
    engine.wave.epicentre[0] = origin[0];
    engine.wave.epicentre[1] = origin[1];
    engine.wave.epicentre[2] = origin[2];
  }
  engine.wave.start = start;
  engine.wave.ring = !reduced && request.ring && origin !== undefined;
  engine.angles = null;
  for (const spike of engine.list) {
    if (spike.startAt !== WAITING) continue;
    // each spike starts as the ring reaches it: its angle from the epicentre over π, times the wave's duration
    spike.startAt = reduced || !origin ? time : start + (angleBetween(origin, spike.vector) / Math.PI) * WAVE_SECONDS;
  }
}

/** Exponential approach that lands exactly on the target once close. */
function approach(value: number, target: number, ease: number) {
  const next = value + (target - value) * ease;
  return Math.abs(target - next) < 0.004 ? target : next;
}

function angleBetween(a: Readonly<Vec3>, b: Readonly<Vec3>) {
  return Math.acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1));
}

/** Angle from the wave's epicentre for every lattice dot; rebuilt per wave and per lattice. */
function landAngles(engine: Engine, lattice: SphereLattice) {
  if (engine.angles && engine.anglesFor === lattice) return engine.angles;
  const angles = new Float32Array(lattice.count);
  const e = engine.wave.epicentre;
  const xyz = lattice.xyz;
  for (let i = 0; i < lattice.count; i++) {
    const dot = e[0] * xyz[i * 3] + e[1] * xyz[i * 3 + 1] + e[2] * xyz[i * 3 + 2];
    angles[i] = Math.acos(clamp(dot, -1, 1));
  }
  engine.angles = angles;
  engine.anglesFor = lattice;
  return angles;
}

/** Hands waiting targets over as the wave passes and steps every spring. Returns whether anything still moves. */
function stepSpikes(engine: Engine, time: number, delta: number, reduced: boolean, released: string[]) {
  let busy = false;
  const { chipId, selectedId } = engine;
  const anyLit = (chipId !== null && engine.spikes.has(chipId)) || (selectedId !== null && engine.spikes.has(selectedId));
  const ease = reduced ? 1 : 1 - Math.exp(-delta / HIGHLIGHT_SECONDS);
  engine.dim = approach(engine.dim, anyLit ? 1 : 0, ease);
  if (engine.dim !== (anyLit ? 1 : 0)) busy = true;
  for (let i = engine.list.length - 1; i >= 0; i--) {
    const spike = engine.list[i];
    if (spike.startAt === WAITING) {
      busy = true;
      continue;
    }
    if (spike.startAt !== IDLE) {
      if (time >= spike.startAt) {
        spike.startAt = IDLE;
        spike.armed = !reduced && spike.next > spike.position + 0.002;
        spike.target = spike.next;
        if (!spike.leaving) released.push(spike.id);
      } else {
        busy = true;
      }
    }
    if (reduced) {
      spike.position = spike.target;
      spike.velocity = 0;
      spike.flare = 0;
      spike.armed = false;
    } else {
      const before = spike.velocity;
      springStep(spike, spike.target, delta, SPIKE_STIFFNESS, SPIKE_DAMPING);
      if (spike.armed && before > 0 && spike.velocity <= 0) {
        // the top of the overshoot
        spike.armed = false;
        spike.flare = 1;
        if (spike.burst > 0) spike.fire = true;
      }
      spike.flare = spike.flare > 0.01 ? spike.flare * Math.exp(-delta / FLARE_SECONDS) : 0;
    }
    const settled = Math.abs(spike.position - spike.target) < 1e-4 && Math.abs(spike.velocity) < 1e-3;
    if (settled) {
      spike.position = spike.target;
      spike.velocity = 0;
    } else {
      busy = true;
    }
    if (spike.flare > 0) busy = true;
    const light = spike.id === chipId || spike.id === selectedId ? 1 : 0;
    spike.light = approach(spike.light, light, ease);
    if (spike.light !== light) busy = true;
    if (spike.leaving && settled && spike.startAt === IDLE && spike.target === 0) {
      engine.list.splice(i, 1);
      engine.spikes.delete(spike.id);
    }
  }
  return busy;
}

/** Land, ring, spikes and sparks on the one canvas. Returns whether the ring or sparks still animate. */
function drawScene(engine: Engine, surface: CanvasSurface, zoom: number, time: number, delta: number) {
  const { context, width, height, dpr } = surface;
  context.clearRect(0, 0, width, height);
  const radius = engine.layout.radius * zoom;
  const ringBusy = drawLand(engine, context, radius, dpr, time);
  drawSpikes(engine, context, radius, dpr);
  const sparksBusy = engine.sparks.step(context, delta);
  return ringBusy || sparksBusy;
}

function drawLand(engine: Engine, context: CanvasRenderingContext2D, radius: number, dpr: number, time: number) {
  const lattice = engine.lattice;
  if (!lattice) return false;
  const { cx, cy } = engine.layout;
  const m = engine.rotation;
  const xyz = lattice.xyz;
  const jitter = lattice.jitter;
  const wave = engine.wave;
  const elapsed = time - wave.start;
  const ringOn = wave.ring && elapsed >= 0 && elapsed < WAVE_SECONDS + WAKE_SECONDS;
  const angles = ringOn ? landAngles(engine, lattice) : null;
  const front = (elapsed / WAVE_SECONDS) * Math.PI * radius;
  // the ring loses a little light as it travels; the wake behind it fades out after the ring has passed
  const ringStrength = 1 - 0.35 * clamp(elapsed / WAVE_SECONDS, 0, 1);
  const wakeFade = 1 - smoothstep(WAVE_SECONDS * 0.5, WAVE_SECONDS + WAKE_SECONDS, elapsed);
  const wakeLength = radius * 0.45;
  const half = LAND_DOT / 2;
  const batch = engine.landBatch;
  for (let i = 0; i < lattice.count; i++) {
    const x0 = xyz[i * 3];
    const y0 = xyz[i * 3 + 1];
    const z0 = xyz[i * 3 + 2];
    const z = m[6] * x0 + m[7] * y0 + m[8] * z0;
    if (z <= 0) continue;
    const x = m[0] * x0 + m[1] * y0 + m[2] * z0;
    const y = m[3] * x0 + m[4] * y0 + m[5] * z0;
    let alpha = 0.16 + 0.5 * Math.pow(z, 0.6);
    let tone = 0;
    if (angles) {
      const distance = angles[i] * radius;
      const ring = ringFront(distance, front, RING_WIDTH, jitter[i], 5) * ringStrength;
      const behind = front - distance;
      const wake = behind > 0 ? Math.exp(-behind / wakeLength) * wakeFade : 0;
      tone = Math.min(1, ring + wake * 0.5);
      alpha += 0.7 * ring + 0.14 * wake;
      if (ring > 0.5) {
        // the front itself is drawn a size up, so the ring reads as light rather than tint
        batch.add(snap(cx + x * radius - 1, dpr) + 1, snap(cy - y * radius - 1, dpr) + 1, 2, tone, Math.min(1, alpha));
        continue;
      }
    }
    batch.add(snap(cx + x * radius - half, dpr) + half, snap(cy - y * radius - half, dpr) + half, LAND_DOT, tone, Math.min(1, alpha));
  }
  batch.flush(context);
  return ringOn;
}

function drawSpikes(engine: Engine, context: CanvasRenderingContext2D, radius: number, dpr: number) {
  const list = engine.list;
  const m = engine.rotation;
  const order = engine.order;
  let count = 0;
  // painter order: farthest first, by insertion sort on the reused index array
  for (let i = 0; i < list.length; i++) {
    const spike = list[i];
    spike.depth = depthOf(m, spike.vector);
    let j = count;
    while (j > 0 && list[order[j - 1]].depth > spike.depth) {
      order[j] = order[j - 1];
      j--;
    }
    order[j] = i;
    count++;
  }
  engine.hitCount = 0;
  engine.hitIds.length = 0;
  for (let k = 0; k < count; k++) drawSpike(engine, context, list[order[k]], radius, dpr);
  context.globalAlpha = 1;
}

const footScratch: Vec3 = [0, 0, 0];

function drawSpike(
  engine: Engine,
  context: CanvasRenderingContext2D,
  spike: SpikeState,
  radius: number,
  dpr: number,
) {
  const { cx, cy } = engine.layout;
  const m = engine.rotation;
  const v = spike.vector;
  const bx = m[0] * v[0] + m[1] * v[1] + m[2] * v[2];
  const by = m[3] * v[0] + m[4] * v[1] + m[5] * v[2];
  const bz = spike.depth;
  const light = spike.light;
  // the others step back while one spike is lit
  const fade = 1 - (1 - DIM_ALPHA) * engine.dim * (1 - light);
  const behindAlpha = BEHIND_ALPHA + (LIT_BEHIND_ALPHA - BEHIND_ALPHA) * light;

  // footprint: three dots on the surface around the base
  const footAngle = FOOT_PX / radius;
  context.fillStyle = engine.footColor;
  for (const angle of FOOT_ANGLES) {
    const c = Math.cos(angle) * footAngle;
    const s = Math.sin(angle) * footAngle;
    footScratch[0] = v[0] + spike.east[0] * c + spike.north[0] * s;
    footScratch[1] = v[1] + spike.east[1] * c + spike.north[1] * s;
    footScratch[2] = v[2] + spike.east[2] * c + spike.north[2] * s;
    const z = m[6] * footScratch[0] + m[7] * footScratch[1] + m[8] * footScratch[2];
    if (z <= 0) continue;
    const x = m[0] * footScratch[0] + m[1] * footScratch[1] + m[2] * footScratch[2];
    const y = m[3] * footScratch[0] + m[4] * footScratch[1] + m[5] * footScratch[2];
    context.globalAlpha = 0.5 * fade;
    context.fillRect(snap(cx + x * radius - FOOT_DOT / 2, dpr), snap(cy - y * radius - FOOT_DOT / 2, dpr), FOOT_DOT, FOOT_DOT);
  }

  // column: dots SPIKE_STEP px apart from the base up to the tip, grey at the foot and accent at the top
  const height = Math.max(0, spike.position);
  const dots = Math.floor((height * radius) / SPIKE_STEP);
  const ramp = engine.columnRamp;
  for (let k = 0; k < dots; k++) {
    const lift = 1 + (k * SPIKE_STEP) / radius;
    const x = bx * lift;
    const y = by * lift;
    const z = bz * lift;
    if (isOccluded(x, y, z)) continue;
    const t = k / dots;
    const tone = Math.pow(t, 0.7);
    context.fillStyle = ramp[Math.round((tone + (1 - tone) * light) * (ramp.length - 1))];
    context.globalAlpha = 0.95 * fade * (z < 0 ? behindAlpha : 1);
    context.fillRect(snap(cx + x * radius - SPIKE_DOT / 2, dpr), snap(cy - y * radius - SPIKE_DOT / 2, dpr), SPIKE_DOT, SPIKE_DOT);
  }

  // tip (the base for zero values, which only show their footprint)
  const lift = 1 + height;
  const tx = cx + bx * lift * radius;
  const ty = cy - by * lift * radius;
  const visible = height > 0.0005 ? !isOccluded(bx * lift, by * lift, bz * lift) : bz > 0;
  spike.baseX = cx + bx * radius;
  spike.baseY = cy - by * radius;
  spike.tipX = tx;
  spike.tipY = ty;
  spike.tipVisible = visible;
  if (!visible) return;
  if (height > 0.0005) {
    const size = TIP_DOT + spike.flare * 1.5;
    const behind = bz * lift < 0;
    context.fillStyle = behind && light < 0.5 ? engine.litColor : engine.tipColor;
    context.globalAlpha = fade * (behind ? behindAlpha + 0.14 * (1 - light) : 1);
    context.fillRect(snap(tx - size / 2, dpr), snap(ty - size / 2, dpr), size, size);
    if (spike.flare > 0.02) {
      // a pixel twinkle: four dots around the tip at the top of the overshoot
      const reach = 3 + spike.flare * 1.5;
      context.globalAlpha = spike.flare * 0.85 * fade;
      for (const [ox, oy] of TWINKLE) {
        context.fillRect(snap(tx + ox * reach - 0.75, dpr), snap(ty + oy * reach - 0.75, dpr), 1.5, 1.5);
      }
    }
  }
  if (spike.fire) {
    spike.fire = false;
    const dx = tx - spike.baseX;
    const dy = ty - spike.baseY;
    const along = Math.hypot(dx, dy) > 3;
    engine.sparks.add(tx, ty, spike.burst, engine.sparkColors, {
      angle: along ? Math.atan2(dy, dx) : 0,
      spread: along ? 1.5 : Math.PI * 2,
      speed: [50, 190],
      life: [0.35, 0.8],
      size: [1.5, 2],
      drag: 3.5,
      jitter: 1.5,
    });
  }
  if (!spike.leaving && engine.hitCount < engine.hitX.length) {
    engine.hitX[engine.hitCount] = tx;
    engine.hitY[engine.hitCount] = ty;
    engine.hitIds[engine.hitCount] = spike.id;
    engine.hitCount++;
  }
}

const TWINKLE: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Moves the invisible buttons onto the tips and the chip beside the lit tip. Returns whether the chip still springs. */
function placeOverlay(
  engine: Engine,
  buttons: ReadonlyMap<string, HTMLButtonElement>,
  chip: HTMLDivElement | null,
  delta: number,
  reduced: boolean,
) {
  // read the chip's size before any style writes, so the frame never forces a second layout
  const chipWidth = chip && engine.chipId !== null ? chip.offsetWidth : 0;
  const chipHeight = chip && engine.chipId !== null ? chip.offsetHeight : 0;
  for (const spike of engine.list) {
    const button = buttons.get(spike.id);
    if (!button) continue;
    const x = Math.round(spike.tipX - engine.layout.bleedX - 12);
    const y = Math.round(spike.tipY - engine.layout.bleedY - 12);
    if (x === spike.domX && y === spike.domY) continue;
    spike.domX = x;
    spike.domY = y;
    button.style.transform = `translate3d(${x}px,${y}px,0)`;
  }
  if (!chip) return false;
  const state = engine.chip;
  const spike = engine.chipId !== null ? engine.spikes.get(engine.chipId) : undefined;
  const visible = spike !== undefined && spike.tipVisible && !spike.leaving;
  if (!visible || !spike) {
    if (state.visible) {
      state.visible = false;
      chip.style.opacity = "0";
    }
    return false;
  }
  const { x, y } = chipPlacement(spike, chipWidth, chipHeight, engine.layout);
  const jumped = state.id === spike.id && Math.abs(x - state.x) + Math.abs(y - state.y) > 24;
  if (state.id !== spike.id || jumped) {
    // a new spike or a new side: glide over from where the chip was, or appear in place
    if (state.visible && !reduced) {
      state.offsetX.position = state.x + state.offsetX.position - x;
      state.offsetY.position = state.y + state.offsetY.position - y;
    } else {
      state.offsetX.position = 0;
      state.offsetY.position = 0;
      state.offsetX.velocity = 0;
      state.offsetY.velocity = 0;
    }
    state.id = spike.id;
  }
  let busy = false;
  if (reduced) {
    state.offsetX.position = 0;
    state.offsetY.position = 0;
  } else {
    springStep(state.offsetX, 0, delta);
    springStep(state.offsetY, 0, delta);
    busy = Math.abs(state.offsetX.position) + Math.abs(state.offsetY.position) > 0.1 || Math.abs(state.offsetX.velocity) + Math.abs(state.offsetY.velocity) > 1;
    if (!busy) {
      state.offsetX.position = 0;
      state.offsetY.position = 0;
      state.offsetX.velocity = 0;
      state.offsetY.velocity = 0;
    }
  }
  state.x = x;
  state.y = y;
  chip.style.transform = `translate3d(${Math.round(x + state.offsetX.position)}px,${Math.round(y + state.offsetY.position)}px,0)`;
  if (!state.visible) {
    state.visible = true;
    chip.style.opacity = "1";
  }
  return busy;
}

const CHIP_GAP = 10;
const CHIP_MARGIN = 4;

/**
 * Where the chip goes: beyond the tip on the side the spike leans to, else above or below the tip (away from the
 * base), else on the other side, so it never covers its own column. Stage px, clamped inside the stage.
 */
function chipPlacement(spike: SpikeState, chipWidth: number, chipHeight: number, layout: StageLayout) {
  const { width, height } = layout;
  const tipX = spike.tipX - layout.bleedX;
  const tipY = spike.tipY - layout.bleedY;
  const lean = spike.tipX - spike.baseX >= -1 ? 1 : -1;
  const rise = spike.tipY - spike.baseY > 1 ? 1 : -1;
  const clampX = (x: number) => clamp(x, CHIP_MARGIN, Math.max(CHIP_MARGIN, width - chipWidth - CHIP_MARGIN));
  const clampY = (y: number) => clamp(y, CHIP_MARGIN, Math.max(CHIP_MARGIN, height - chipHeight - CHIP_MARGIN));
  const beside = (side: number) => ({
    x: side > 0 ? tipX + CHIP_GAP : tipX - CHIP_GAP - chipWidth,
    y: clampY(tipY - chipHeight / 2),
  });
  const over = (side: number) => ({
    x: clampX(tipX - chipWidth / 2),
    y: side > 0 ? tipY + CHIP_GAP : tipY - CHIP_GAP - chipHeight,
  });
  const fits = (box: { x: number; y: number }) =>
    box.x >= CHIP_MARGIN &&
    box.x + chipWidth <= width - CHIP_MARGIN &&
    box.y >= CHIP_MARGIN &&
    box.y + chipHeight <= height - CHIP_MARGIN;
  const candidates = [beside(lean), over(rise), beside(-lean), over(-rise)];
  const box = candidates.find(fits) ?? candidates[0];
  return { x: clampX(box.x), y: clampY(box.y) };
}

/** CSS px of the stage per client px: corrects for CSS zoom and transforms on an ancestor. */
function zoomOf(stage: HTMLElement, rect: DOMRect) {
  return rect.width > 0 ? stage.offsetWidth / rect.width : 1;
}

/** The visible tip nearest to a stage point, or null. */
function hitTest(engine: Engine, x: number, y: number, radius: number) {
  const { bleedX, bleedY } = engine.layout;
  const index = nearestIndex(engine.hitX, engine.hitY, engine.hitCount, x + bleedX, y + bleedY, radius);
  return index >= 0 ? (engine.hitIds[index] ?? null) : null;
}

/** The spike an arrow key moves to among the visible tips, by screen direction. */
function navigateFrom(engine: Engine, id: string, direction: NavigationDirection) {
  const candidates: { id: string; x: number; y: number }[] = [];
  for (const spike of engine.list) {
    if (spike.leaving || (!spike.tipVisible && spike.id !== id)) continue;
    candidates.push({ id: spike.id, x: spike.tipX, y: spike.tipY });
  }
  const from = candidates.findIndex((candidate) => candidate.id === id);
  if (from < 0) return candidates[0]?.id ?? null;
  return candidates[spatialNavigate(candidates, from, direction)]?.id ?? null;
}
