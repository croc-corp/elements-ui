"use client";

import * as React from "react";

import { snapCenter, useCanvas, type CanvasSurface } from "@/lib/lumesec/canvas";
import { usePalette } from "@/lib/lumesec/color";
import {
  ARROW_DIRECTIONS,
  bakeLattice,
  createDotBatch,
  createProjection,
  createScreenPoint,
  flatPaths,
  forEachDot,
  GEO_TOKENS,
  geoInk,
  mapLattice,
  placeLabels,
  pointAtDistance,
  projectionAspect,
  projectionOutlineSvgPath,
  ringFront,
  spatialNavigate,
  type ArcLengthTable,
  type DotBatch,
  type DotLattice,
  type GeoInk,
  type GeoPalette,
  type LabelAnchor,
  type LatLon,
  type MapProjection,
} from "@/lib/lumesec/geo";
import { createRandom, DEMO_REGIONS, formatNumber } from "@/lib/lumesec/geo-data";
import { clamp, easeOutCubic, hash, mixRgb, percent, smoothstep, stringHash } from "@/lib/lumesec/math";
import {
  prefersReducedMotion,
  settleSpring,
  useAnimationLoop,
  useInterval,
  useInView,
  useLazyRef,
  useReducedMotion,
  type Spring,
} from "@/lib/lumesec/motion";
import { RollText } from "@/lib/lumesec/roll-text";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** A region on the map: the id that flows refer to, the text beside its marker, and its position in degrees. */
export interface FlowRegion {
  /** Unique id that `RegionFlow.from` and `RegionFlow.to` refer to. */
  readonly id: string;
  /** Text beside the marker, in the selection chip and in the accessible names. */
  readonly label: string;
  /** Latitude in degrees. */
  readonly lat: number;
  /** Longitude in degrees. */
  readonly lon: number;
}

/** Traffic between two regions, in the component's `unit`. */
export interface RegionFlow {
  /** Id of the region downstream traffic leaves from. */
  readonly from: string;
  /** Id of the region downstream traffic goes to. */
  readonly to: string;
  /** Downstream throughput, from `from` to `to`. */
  readonly down: number;
  /** Upstream throughput, from `to` back to `from`. */
  readonly up: number;
}

/** Map projections the component can draw. */
export type GeoFlowsProjection = "equalEarth" | "equirectangular";

/** Props of `GeoFlows`. Other `div` props go to the root. */
export interface GeoFlowsProps extends Omit<React.ComponentProps<"div">, "defaultValue"> {
  /** The regions on the map. Default: 12 demo cloud regions (`us-east`, `eu-central`, `ap-northeast`, ...). */
  regions?: readonly FlowRegion[];
  /**
   * The traffic between regions, in `unit`. Flows that name an unknown region or carry no traffic are skipped; an
   * empty array shows an empty map. Without `flows` and `regions` the component shows 14 demo flows.
   */
  flows?: readonly RegionFlow[];
  /** The selected region id (controlled), or null for none. Use with `onValueChange`. */
  value?: string | null;
  /** The region selected at first when uncontrolled. */
  defaultValue?: string | null;
  /** Called when a region is selected, or with null when the selection is cleared. */
  onValueChange?: (value: string | null) => void;
  /** Unit of `down` and `up`, shown after the totals. */
  unit?: string;
  /** Formats the totals and the numbers in accessible names. Default: one decimal with grouping ("1,204.5"). */
  format?: (value: number) => string;
  /** Most particles in flight at once; the oldest are dropped first. */
  maxParticles?: number;
  /** Map projection. */
  projection?: GeoFlowsProjection;
  /** Lets the demo flows drift by up to 12 % every 3 s while on screen. No effect when `flows` or `regions` is set. */
  live?: boolean;
}

/**
 * Traffic between regions on a dotted world map. Each flow is a pair of dotted curves, downstream in the accent
 * colour and upstream in the info colour, each bending to its own side of the line. The number of dot rows and the
 * rate of the particles that travel along a curve follow its throughput. Selecting a region keeps its flows lit,
 * brightening outward from the region behind an uneven front, while every other flow collapses to a hairline and
 * drains; the land around the region pings, and the inbound and outbound totals roll to its numbers.
 *
 * @example
 * <GeoFlows
 *   regions={[
 *     { id: "fra", label: "Frankfurt", lat: 50.11, lon: 8.68 },
 *     { id: "iad", label: "Ashburn", lat: 39.04, lon: -77.49 },
 *   ]}
 *   flows={[{ from: "fra", to: "iad", down: 42.5, up: 11.2 }]}
 *   onValueChange={(id) => console.log(id)}
 * />
 */
export function GeoFlows({
  regions,
  flows,
  value,
  defaultValue = null,
  onValueChange,
  unit = "Gbps",
  format = formatThroughput,
  maxParticles = 400,
  projection = "equalEarth",
  live = true,
  className,
  onKeyDown,
  ...props
}: GeoFlowsProps) {
  const demo = flows === undefined && regions === undefined;
  const [drift, setDrift] = React.useState<readonly number[]>(NO_DRIFT);
  const demoFlows = React.useMemo(() => driftedFlows(drift), [drift]);
  const regionList = regions ?? DEMO_FLOW_REGIONS;
  const flowList = flows ?? (demo ? demoFlows : NO_FLOWS);
  const model = React.useMemo(() => resolveModel(regionList, flowList), [regionList, flowList]);
  const kind: GeoFlowsProjection = projection === "equirectangular" ? "equirectangular" : "equalEarth";
  const layout = React.useMemo(() => markerLayout(kind, model.regions), [kind, model.regions]);

  const [selection, setSelection] = useControllableState<string | null>({ value, defaultValue, onChange: onValueChange });
  const selectedIndex = selection === null ? -1 : (model.indexById.get(selection) ?? -1);
  const selectedId = selectedIndex >= 0 ? model.regions[selectedIndex].id : null;
  const reducedMotion = useReducedMotion();

  /** The marker that holds the roving tab stop; -1 follows the selection. */
  const [focusIndex, setFocusIndex] = React.useState(-1);
  /** Width of the map box in CSS px; the server and the first client render assume the nominal width. */
  const [boxWidth, setBoxWidth] = React.useState(NOMINAL_BOX_WIDTH);

  const cardRef = React.useRef<HTMLDivElement>(null);
  const stackRef = React.useRef<HTMLDivElement>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const baseRef = React.useRef<HTMLCanvasElement>(null);
  const flowsRef = React.useRef<HTMLCanvasElement>(null);
  const fxRef = React.useRef<HTMLCanvasElement>(null);
  const markerRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const dotRefs = React.useRef<(HTMLSpanElement | null)[]>([]);
  const driftRandomRef = useLazyRef(() => createRandom("geo-flows"));
  // created on first use, with the first selection and kind
  const engineRef = useLazyRef(() => createEngine(selectedId, kind));

  const loop = useAnimationLoop(cardRef, step);
  const palette = usePalette(cardRef, GEO_TOKENS, () => {
    engineRef.current.inkStale = true;
    loop.kick();
  });
  const base = useCanvas(baseRef, () => loop.kick(), CANVAS_OPTIONS);
  const flowLayer = useCanvas(
    flowsRef,
    () => {
      engineRef.current.flowsDirty = true;
      loop.kick();
    },
    CANVAS_OPTIONS,
  );
  const fx = useCanvas(fxRef, () => loop.kick(), CANVAS_OPTIONS);
  const inView = useInView(cardRef);

  // Paths follow the data: new flows grow in from their origin, removed ones retract, values spring.
  React.useEffect(() => {
    const engine = engineRef.current;
    engine.regions = model.regions;
    engine.indexById = model.indexById;
    engine.kind = kind;
    syncPaths(engine, model);
    loop.kick();
  }, [model, kind, engineRef, loop]);

  React.useEffect(() => {
    engineRef.current.maxParticles = Math.max(0, Math.floor(maxParticles));
  }, [maxParticles, engineRef]);

  // A new selection relights its flows from the region outward, pings the land around it and pops the marker.
  React.useEffect(() => {
    const engine = engineRef.current;
    if (engine.selected === selectedId) return;
    engine.selected = selectedId;
    const reduced = prefersReducedMotion();
    // the new region's flows light up from its end; the previous region's light fades back toward it
    for (const path of engine.paths.values()) {
      if (!isRelated(path, selectedId)) continue;
      path.lit = reduced ? 1 : 0;
      path.litFromEnd = path.endId === selectedId;
    }
    engine.halo = 0;
    engine.ping = selectedId !== null && !reduced ? { id: selectedId, start: performance.now() / 1000 } : null;
    engine.flowsDirty = true;
    const dot = selectedIndex >= 0 ? dotRefs.current[selectedIndex] : null;
    if (dot && !reduced && typeof dot.animate === "function") dot.animate(MARKER_POP, { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" });
    loop.kick();
  }, [selectedId, selectedIndex, engineRef, loop]);

  // Reduced motion drops particles and finishes every transition; restart the loop so it redraws once.
  React.useEffect(() => {
    engineRef.current.flowsDirty = true;
    loop.kick();
  }, [reducedMotion, engineRef, loop]);

  React.useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect.width ?? 0;
      if (width > 0) setBoxWidth(Math.round(width));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  // Demo traffic drifts while it is on screen; real data never changes on its own.
  useInterval(
    () => {
      const random = driftRandomRef.current;
      setDrift((previous) => previous.map((offset) => clamp(offset * 0.55 + (random() - 0.5) * 0.17, -DRIFT, DRIFT)));
    },
    DRIFT_MS,
    demo && live && inView,
  );

  function step(time: number, delta: number) {
    const engine = engineRef.current;
    const baseSurface = base.current;
    const flowSurface = flowLayer.current;
    const fxSurface = fx.current;
    const colors = palette.current;
    if (!baseSurface || !flowSurface || !fxSurface || !colors) return false;
    const reduced = prefersReducedMotion();

    if (engine.inkStale || !engine.ink) refreshInk(engine, colors);
    const layoutKey = `${baseSurface.width}x${baseSurface.height}|${engine.kind}`;
    if (engine.layoutKey !== layoutKey) layoutEngine(engine, baseSurface.width, baseSurface.height, layoutKey);
    const { projection: map, lattice, ink, batches } = engine;
    if (!map || !lattice || !ink || !batches) return false;

    if (!engine.baked) {
      bakeBase(baseSurface, lattice, ink);
      engine.baked = true;
      const stack = stackRef.current;
      if (stack) stack.style.opacity = "1";
    }
    for (const path of engine.paths.values()) {
      if (!path.tracks) buildTracks(path, map);
    }

    const moving = advancePaths(engine, delta, reduced);
    if (moving) engine.flowsDirty = true;
    if (engine.flowsDirty) {
      drawFlows(engine, flowSurface, batches);
      engine.flowsDirty = false;
    }

    if (reduced) engine.particles.length = 0;
    else {
      if (!engine.prespawned) prespawn(engine);
      spawnParticles(engine, delta);
      moveParticles(engine, delta);
    }
    const effects = drawEffects(engine, fxSurface, batches, time, delta, reduced);
    pruneRemoved(engine);

    const flowing = !reduced && engine.maxParticles > 0 && engine.paths.size > 0;
    return moving || effects || flowing || engine.particles.length > 0;
  }

  function moveFocus(index: number) {
    setFocusIndex(index);
    markerRefs.current[index]?.focus();
  }

  function handleMarkerClick(event: React.MouseEvent<HTMLButtonElement>, index: number) {
    let target = index;
    // On small maps the 24 px targets overlap: a tap on a dot goes to the nearest marker centre, a tap on a label to
    // its own region. Enter and Space (detail 0) keep the focused marker.
    const box = boxRef.current;
    const onLabel = event.target instanceof Element && event.target.closest("[data-label]") !== null;
    if (event.detail > 0 && box && !onLabel) {
      const rect = box.getBoundingClientRect();
      let best = Infinity;
      layout.points.forEach((point, i) => {
        const distance = Math.hypot(rect.left + point.x * rect.width - event.clientX, rect.top + point.y * rect.height - event.clientY);
        if (distance < best) {
          best = distance;
          target = i;
        }
      });
    }
    if (target !== index) moveFocus(target);
    const id = model.regions[target].id;
    setSelection(selection === id ? null : id);
  }

  function handleMarkerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const direction = ARROW_DIRECTIONS[event.key];
    if (!direction) return;
    event.preventDefault();
    const next = spatialNavigate(layout.navigation, index, direction);
    if (next !== index) moveFocus(next);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.key !== "Escape" || selection === null) return;
    event.preventDefault();
    setSelection(null);
  }

  function clearSelection() {
    // the chip and its button disappear, so focus goes back to the region it cleared
    if (selectedIndex >= 0) moveFocus(selectedIndex);
    setSelection(null);
  }

  const tabStop = focusIndex >= 0 && focusIndex < model.regions.length ? focusIndex : Math.max(0, selectedIndex);
  const narrow = boxWidth < NARROW_WIDTH;
  const placements = React.useMemo(
    () => placeRegionLabels(model, layout, boxWidth, selectedIndex, narrow),
    [model, layout, boxWidth, selectedIndex, narrow],
  );

  const totals = selectedIndex >= 0 ? { in: model.inbound[selectedIndex], out: model.outbound[selectedIndex] } : { in: model.totalIn, out: model.totalOut };
  const inText = format(totals.in);
  const outText = format(totals.out);
  // both numbers reserve the widest of the visible and the overall totals, so the bar never shifts
  const reserve = [...new Set([format(model.totalIn), format(model.totalOut), inText, outText])];
  const selectedRegion = selectedIndex >= 0 ? model.regions[selectedIndex] : null;
  const scope = selectedRegion ? selectedRegion.label : "All regions";

  // Announce the totals when the selection changes, not on every data update.
  const [announcement, setAnnouncement] = React.useState({ id: selectedId, text: "" });
  if (announcement.id !== selectedId) {
    setAnnouncement({ id: selectedId, text: `${scope}: in ${inText} ${unit}, out ${outText} ${unit}.` });
  }

  return (
    <div data-slot="geo-flows" className={cn("@container grid w-full gap-2 text-foreground", className)} onKeyDown={handleKeyDown} {...props}>
      <div ref={cardRef} className="relative overflow-hidden rounded-xl border border-border bg-card p-3 [-webkit-tap-highlight-color:transparent]">
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${NOMINAL_PROJECTION_WIDTH} ${(NOMINAL_PROJECTION_WIDTH / layout.aspect).toFixed(2)}`}
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-3 block size-[calc(100%-24px)] overflow-visible"
        >
          <path d={layout.outline} vectorEffect="non-scaling-stroke" strokeWidth={1} className="fill-muted/35 stroke-border" />
        </svg>
        <div
          ref={stackRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-700 ease-out motion-reduce:transition-none"
        >
          <canvas ref={baseRef} className="absolute inset-0 block size-full" />
          <canvas ref={flowsRef} className="absolute inset-0 block size-full" />
          <canvas ref={fxRef} className="absolute inset-0 block size-full" />
        </div>
        <div ref={boxRef} className="relative" style={{ aspectRatio: layout.aspect }}>
          <div role="img" aria-label={mapLabel(model, format, unit)} className="absolute inset-0" />
          <div role="group" aria-label="Regions" className="absolute inset-0">
            {model.regions.map((region, i) => {
              const point = layout.points[i];
              const selected = i === selectedIndex;
              const related = selectedIndex >= 0 && model.neighbours[selectedIndex].has(i);
              const placement = placements[i];
              return (
                <button
                  key={region.id}
                  ref={(node) => {
                    markerRefs.current[i] = node;
                  }}
                  type="button"
                  aria-pressed={selected}
                  aria-label={region.label}
                  tabIndex={i === tabStop ? 0 : -1}
                  data-state={selected ? "on" : "off"}
                  data-dimmed={selectedIndex >= 0 && !selected && !related ? "" : undefined}
                  onClick={(event) => handleMarkerClick(event, i)}
                  onFocus={() => setFocusIndex(i)}
                  onKeyDown={(event) => handleMarkerKeyDown(event, i)}
                  className={cn(
                    "group/marker absolute -mt-3 -ml-3 grid size-6 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 font-[inherit] outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-lumesec",
                    selected && "z-[2]",
                  )}
                  style={{ left: percent(point.x), top: percent(point.y) }}
                >
                  <span
                    ref={(node) => {
                      dotRefs.current[i] = node;
                    }}
                    className="block size-[7px] rounded-full bg-foreground shadow-[0_0_0_2px_var(--card)] transition-[background-color,box-shadow,opacity,scale] duration-300 group-hover/marker:scale-[1.3] group-data-[dimmed]/marker:opacity-35 group-data-[state=on]/marker:bg-lumesec group-data-[state=on]/marker:shadow-[0_0_0_2px_var(--card),0_0_0_3.5px_var(--lumesec)] motion-reduce:transition-none"
                  />
                  <span
                    aria-hidden="true"
                    data-label=""
                    className={cn(
                      "absolute font-mono text-[10.5px] leading-[14px] whitespace-nowrap text-muted-foreground transition-[opacity,color] duration-300 [text-shadow:0_0_2px_var(--card),0_0_4px_var(--card)] group-hover/marker:text-foreground group-data-[state=on]/marker:text-foreground motion-reduce:transition-none",
                      !placement.visible && "pointer-events-none opacity-0",
                      !selected && "@max-[480px]:hidden",
                    )}
                    style={LABEL_STYLES[placement.side]}
                  >
                    {region.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        {model.links.length === 0 ? (
          <p className="absolute top-3 left-4 m-0 text-[12px] leading-4 text-muted-foreground">No traffic to show</p>
        ) : null}
      </div>
      <div className="flex min-h-7 flex-wrap items-center gap-x-4 gap-y-1 px-0.5 text-[12.5px] leading-5">
        <TotalReadout direction="in" value={totals.in} text={inText} unit={unit} reserve={reserve} animate={!reducedMotion} />
        <TotalReadout direction="out" value={totals.out} text={outText} unit={unit} reserve={reserve} animate={!reducedMotion} />
        <div className="ml-auto flex min-h-6 items-center @max-[480px]:ml-0 @max-[480px]:basis-full">
          {selectedRegion ? (
            <SelectionChip key={selectedRegion.id} label={selectedRegion.label} onClear={clearSelection} />
          ) : (
            <span className="text-[12px] text-muted-foreground">{scope}</span>
          )}
        </div>
      </div>
      <span aria-live="polite" className="sr-only">
        {announcement.text}
      </span>
    </div>
  );
}

/* Totals bar ---------------------------------------------------------------------------------------- */

/** One total: an arrow in the direction's colour, "In" or "Out", the rolling number and the unit. */
function TotalReadout({
  direction,
  value,
  text,
  unit,
  reserve,
  animate,
}: {
  direction: "in" | "out";
  value: number;
  text: string;
  unit: string;
  reserve: readonly string[];
  animate: boolean;
}) {
  // numbers roll in the direction they change: up when they grow, down when they shrink
  const [state, setState] = React.useState({ value, roll: 1 });
  if (state.value !== value) setState({ value, roll: value >= state.value ? 1 : -1 });
  const inbound = direction === "in";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <svg
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={cn("size-3 shrink-0", inbound ? "text-lumesec" : "text-lumesec-info")}
      >
        {inbound ? <path d="M6 2v7.5M2.75 6.5 6 9.75 9.25 6.5" /> : <path d="M6 10V2.5M2.75 5.5 6 2.25 9.25 5.5" />}
      </svg>
      <span className="text-muted-foreground">{inbound ? "In" : "Out"}</span>
      <RollText
        text={text}
        direction={state.roll}
        animate={animate}
        reserve={reserve}
        className="justify-items-end font-mono font-medium tabular-nums"
      />
      <span className="text-muted-foreground">{unit}</span>
    </span>
  );
}

/** The selected region as a chip with a clear button. Keyed by region, so it pops in on every new selection. */
function SelectionChip({ label, onClear }: { label: string; onClear: () => void }) {
  const chipRef = React.useRef<HTMLSpanElement>(null);
  React.useLayoutEffect(() => {
    const chip = chipRef.current;
    if (!chip || prefersReducedMotion() || typeof chip.animate !== "function") return;
    const animation = chip.animate(CHIP_ENTER, { duration: 260, easing: "cubic-bezier(.2,1.3,.4,1)" });
    return () => animation.cancel();
  }, []);
  return (
    <span
      ref={chipRef}
      className="inline-flex h-6 max-w-[180px] items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--lumesec)_40%,var(--border))] bg-card pr-0.5 pl-2 text-[12px] leading-none"
    >
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-lumesec" />
      <span className="truncate font-mono">{label}</span>
      <button
        type="button"
        aria-label={`Clear selection: ${label}`}
        onClick={onClear}
        className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-muted-foreground outline-none hover:bg-foreground/8 hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-lumesec"
      >
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" aria-hidden="true" className="size-2.5">
          <path d="M3 3l6 6M9 3l-6 6" />
        </svg>
      </button>
    </span>
  );
}

/* Constants ------------------------------------------------------------------------------------------ */

/** The map crop: from the Southern Ocean to the Arctic coast, centred on 10° E. */
const LAT_RANGE: readonly [number, number] = [-50, 72];
const CENTER: LatLon = { lat: 0, lon: 10 };
/** Card padding in px (`p-3`): the canvases cover it, so seam-crossing flows can run to the card's edge. */
const MARGIN = 12;
/** The map box width the server markup and label placement assume before the first measurement. */
const NOMINAL_BOX_WIDTH = 634;
/** Below this map width only the selected region keeps its label. */
const NARROW_WIDTH = 480;
const NOMINAL_PROJECTION_WIDTH = 1000;
const CANVAS_OPTIONS = { maxDpr: 2 };

/** Flow geometry in CSS px. */
const BEND = 0.16;
const DOT_SPACING = 3.5;
const ROW_GAP = 2.2;
const FLOW_DOT = 1.5;
/** Particles: speed at the nominal width, head size, and the gap and brightness of the three tail squares. */
const PARTICLE_SPEED = 80;
const HEAD_SIZE = 2;
const TAIL_SIZE = 1.5;
const TAIL_GAP = 2.4;
const TAIL_ALPHA = [1, 0.55, 0.3, 0.13];
/** Flows and particles fade over this many px toward the map's outline, where seam-crossing paths leave the map. */
const EDGE_FADE = 16;

/** Spring constants: emphasis snaps with a little overshoot, data glides critically damped. */
const EMPHASIS_SPRING = { stiffness: 260, damping: 0.8 };
const DATA_SPRING = { stiffness: 120, damping: 1 };
/** Seconds for a selected region's flows to light up end to end, and for that light to fade on clear. */
const LIT_SECONDS = 0.7;
const UNLIT_SECONDS = 0.3;
/** The lattice ping around a newly selected region. */
const PING_SECONDS = 0.7;
const PING_RADIUS = 64;
/** Arrivals at the selected region light the land under it; the light decays with this time constant. */
const HALO_RADIUS = 22;
const HALO_DECAY = 0.6;

const DRIFT = 0.12;
const DRIFT_MS = 3000;

/** Label boxes sit 8 px from the marker centre, on the side placeLabels chose. */
const LABEL_GAP = 10;
const LABEL_STYLES: Record<"right" | "left" | "top" | "bottom", React.CSSProperties> = {
  right: { left: `calc(50% + ${LABEL_GAP}px)`, top: "50%", transform: "translateY(-50%)" },
  left: { right: `calc(50% + ${LABEL_GAP}px)`, top: "50%", transform: "translateY(-50%)" },
  top: { bottom: `calc(50% + ${LABEL_GAP}px)`, left: "50%", transform: "translateX(-50%)" },
  bottom: { top: `calc(50% + ${LABEL_GAP}px)`, left: "50%", transform: "translateX(-50%)" },
};
/** Geist Mono advances 0.6 em per character; labels are 10.5 px on a 14 px line. */
const LABEL_CHAR_WIDTH = 6.3;
const LABEL_HEIGHT = 14;

const MARKER_POP: Keyframe[] = [
  { transform: "scale(.55)" },
  { transform: "scale(1.45)", offset: 0.38 },
  { transform: "scale(1)" },
];
const CHIP_ENTER: Keyframe[] = [
  { opacity: 0, transform: "scale(.88)" },
  { opacity: 1, transform: "scale(1)" },
];

const formatThroughput = (value: number) => formatNumber(value, { fractionDigits: 1 });

/** The first 12 demo regions, as flow regions. */
const DEMO_FLOW_REGIONS: readonly FlowRegion[] = DEMO_REGIONS.slice(0, 12).map(({ id, label, lat, lon }) => ({ id, label, lat, lon }));

/** Invented demo traffic in Gbps: 412.6 down and 128.4 up in total. */
const DEMO_FLOWS: readonly RegionFlow[] = [
  { from: "us-east", to: "eu-west", down: 86.4, up: 24.6 },
  { from: "us-east", to: "us-west", down: 52.1, up: 18.3 },
  { from: "us-east", to: "sa-east", down: 21.7, up: 6.9 },
  { from: "eu-west", to: "eu-central", down: 49.2, up: 15.8 },
  { from: "eu-central", to: "eu-north", down: 18.6, up: 6.2 },
  { from: "eu-central", to: "me-central", down: 16.9, up: 5.4 },
  { from: "eu-central", to: "ap-south", down: 24.8, up: 7.7 },
  { from: "eu-west", to: "af-south", down: 9.8, up: 3.1 },
  { from: "me-central", to: "ap-south", down: 12.4, up: 4.6 },
  { from: "ap-south", to: "ap-southeast", down: 19.2, up: 6.8 },
  { from: "ap-southeast", to: "ap-northeast", down: 27.5, up: 9.6 },
  { from: "ap-southeast", to: "au-east", down: 15.3, up: 4.9 },
  { from: "us-west", to: "ap-northeast", down: 46.6, up: 11.2 },
  { from: "us-west", to: "au-east", down: 12.1, up: 3.3 },
];

const NO_FLOWS: readonly RegionFlow[] = [];
/** One drift offset per demo value: down and up of each flow. */
const NO_DRIFT: readonly number[] = DEMO_FLOWS.flatMap(() => [0, 0]);

/** The demo flows with their drift applied, rounded to tenths so the totals add up to what is shown. */
function driftedFlows(drift: readonly number[]): readonly RegionFlow[] {
  if (drift === NO_DRIFT) return DEMO_FLOWS;
  return DEMO_FLOWS.map((flow, i) => ({
    ...flow,
    down: Math.round(flow.down * (1 + (drift[i * 2] ?? 0)) * 10) / 10,
    up: Math.round(flow.up * (1 + (drift[i * 2 + 1] ?? 0)) * 10) / 10,
  }));
}

/* Data model ----------------------------------------------------------------------------------------- */

/** A valid flow between two known regions, by region index. */
interface FlowLink {
  key: string;
  from: number;
  to: number;
  down: number;
  up: number;
}

interface FlowModel {
  regions: readonly FlowRegion[];
  indexById: ReadonlyMap<string, number>;
  links: readonly FlowLink[];
  /** Traffic into and out of each region, by region index. */
  inbound: readonly number[];
  outbound: readonly number[];
  /** Regions each region exchanges traffic with. */
  neighbours: readonly ReadonlySet<number>[];
  /** With nothing selected: all downstream traffic (in) and all upstream traffic (out). */
  totalIn: number;
  totalOut: number;
}

const throughput = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0);

/** Validates regions (unique ids, finite coordinates) and flows (known regions, some traffic) and sums the totals. */
function resolveModel(regionList: readonly FlowRegion[], flowList: readonly RegionFlow[]): FlowModel {
  const regions: FlowRegion[] = [];
  const indexById = new Map<string, number>();
  for (const region of regionList) {
    if (typeof region.id !== "string" || indexById.has(region.id)) continue;
    if (!Number.isFinite(region.lat) || !Number.isFinite(region.lon)) continue;
    indexById.set(region.id, regions.length);
    regions.push(region);
  }
  const links: FlowLink[] = [];
  const inbound = regions.map(() => 0);
  const outbound = regions.map(() => 0);
  const neighbours = regions.map(() => new Set<number>());
  const repeats = new Map<string, number>();
  let totalIn = 0;
  let totalOut = 0;
  for (const flow of flowList) {
    const from = indexById.get(flow.from);
    const to = indexById.get(flow.to);
    if (from === undefined || to === undefined || from === to) continue;
    const down = throughput(flow.down);
    const up = throughput(flow.up);
    if (down === 0 && up === 0) continue;
    const pair = `${flow.from}>${flow.to}`;
    const repeat = repeats.get(pair) ?? 0;
    repeats.set(pair, repeat + 1);
    links.push({ key: repeat ? `${pair}#${repeat}` : pair, from, to, down, up });
    // downstream leaves `from` and arrives at `to`; upstream the other way round
    outbound[from] += down;
    inbound[to] += down;
    outbound[to] += up;
    inbound[from] += up;
    neighbours[from].add(to);
    neighbours[to].add(from);
    totalIn += down;
    totalOut += up;
  }
  return { regions, indexById, links, inbound, outbound, neighbours, totalIn, totalOut };
}

/** "Traffic between 12 regions. Largest flows: ..." with the three busiest links. */
function mapLabel(model: FlowModel, format: (value: number) => string, unit: string) {
  const intro = `Traffic between ${model.regions.length} regions.`;
  if (model.links.length === 0) return `${intro} No flows.`;
  const largest = [...model.links].sort((a, b) => b.down + b.up - (a.down + a.up)).slice(0, 3);
  const described = largest.map((link) => {
    const from = model.regions[link.from].label;
    const to = model.regions[link.to].label;
    return `${from} to ${to}, ${format(link.down)} ${unit} down and ${format(link.up)} ${unit} up`;
  });
  return `${intro} Largest flows: ${described.join("; ")}.`;
}

/* Markers and labels --------------------------------------------------------------------------------- */

interface MarkerLayout {
  /** Width / height of the map box. */
  aspect: number;
  /** SVG path of the map's outline in nominal px, drawn under the dots (also in the server markup). */
  outline: string;
  /** Marker centres as fractions of the map box. */
  points: readonly { x: number; y: number }[];
  /** The same points in nominal px, for arrow-key navigation. */
  navigation: readonly { x: number; y: number }[];
}

/** Marker positions from a nominal projection: pure, so the server renders them where the client draws the map. */
function markerLayout(kind: GeoFlowsProjection, regions: readonly FlowRegion[]): MarkerLayout {
  const aspect = projectionAspect(kind, LAT_RANGE);
  const width = NOMINAL_PROJECTION_WIDTH;
  const height = width / aspect;
  const projection = createProjection(kind, { width, height, latRange: LAT_RANGE, center: CENTER });
  const point = createScreenPoint();
  const points = regions.map((region) => {
    projection.project(region.lat, region.lon, point);
    return { x: point.x / width, y: point.y / height };
  });
  return {
    aspect,
    outline: projectionOutlineSvgPath(projection),
    points,
    navigation: points.map(({ x, y }) => ({ x: x * width, y: y * height })),
  };
}

/**
 * Which labels show, and on which side. With nothing selected every label competes, busiest region first; with a
 * selection only the region and the regions it exchanges traffic with; on narrow maps only the selected one. Every
 * marker stays an obstacle, so labels never cover a dot.
 */
function placeRegionLabels(model: FlowModel, layout: MarkerLayout, boxWidth: number, selectedIndex: number, narrow: boolean) {
  const width = boxWidth;
  const height = boxWidth / layout.aspect;
  const anchors: LabelAnchor[] = model.regions.map((region, i) => {
    const point = layout.points[i];
    const candidate =
      i === selectedIndex ||
      (!narrow && (selectedIndex < 0 || model.neighbours[selectedIndex].has(i)));
    return {
      x: MARGIN + point.x * width,
      y: MARGIN + point.y * height,
      width: candidate ? region.label.length * LABEL_CHAR_WIDTH + 2 : 0.01,
      height: candidate ? LABEL_HEIGHT : 0.01,
      priority: i === selectedIndex ? Number.MAX_SAFE_INTEGER : candidate ? model.inbound[i] + model.outbound[i] : -1,
      gap: LABEL_GAP,
    };
  });
  const placed = placeLabels(anchors, width + 2 * MARGIN, height + 2 * MARGIN);
  return placed.map((placement, i) => {
    const candidate = anchors[i].height === LABEL_HEIGHT;
    // the selected label always shows, on the right when nothing fits
    if (i === selectedIndex && !placement.visible) return { visible: true, side: "right" as const };
    return { visible: candidate && placement.visible, side: placement.side };
  });
}

/* Engine --------------------------------------------------------------------------------------------- */

/** Dots along one projected curve, sampled every DOT_SPACING px, with the normal for offsetting rows. */
interface Track {
  table: ArcLengthTable;
  count: number;
  x: Float32Array;
  y: Float32Array;
  nx: Float32Array;
  ny: Float32Array;
  /** Position along the path, 0 at the travel start and 1 at the end. */
  u: Float32Array;
  jitter: Float32Array;
}

/** One direction of one flow, with everything the loop animates. */
interface FlowPath {
  key: string;
  direction: "down" | "up";
  /** Region ids where the traffic leaves and arrives. */
  startId: string;
  endId: string;
  start: LatLon;
  end: LatLon;
  /** Throughput the data springs toward. */
  target: number;
  amount: Spring;
  /** Dot rows, sprung so rows slide apart rather than pop. Negative until the first frame snaps it. */
  rows: Spring;
  /** 1 when nothing is selected or the flow touches the selection, else 0. */
  emphasis: Spring;
  /** Grows a new flow out of its origin and retracts a removed one into it. */
  presence: Spring;
  removed: boolean;
  /** Progress of the selection light, 0 to 1, travelling from the selected end. */
  lit: number;
  litFromEnd: boolean;
  /** The main curve, then its copies across the map's seam. Null until laid out. */
  tracks: Track[] | null;
  /** Length of the main curve in px. */
  length: number;
  /** Poisson spawning: accumulated rate · dt against an exponential draw. */
  accumulator: number;
  nextSpawn: number;
  seed: number;
  dead: boolean;
}

interface Particle {
  path: FlowPath;
  /** Distance along the main curve in px. */
  s: number;
  /** Dot row the particle rides in. */
  lane: number;
}

interface FlowBatches {
  down: DotBatch;
  up: DotBatch;
  fx: DotBatch;
}

/** Everything the animation loop owns. Lives in a ref, never in React state. */
interface FlowEngine {
  paths: Map<string, FlowPath>;
  particles: Particle[];
  regions: readonly FlowRegion[];
  indexById: ReadonlyMap<string, number>;
  selected: string | null;
  kind: GeoFlowsProjection;
  maxParticles: number;
  synced: boolean;
  prespawned: boolean;
  layoutKey: string;
  projection: MapProjection | null;
  lattice: DotLattice | null;
  /** Map width relative to the nominal width; scales particle speed and the ping. */
  scale: number;
  /** The outline's left and right edge per pixel row, so curves fade where they leave the map. */
  edges: OutlineEdges | null;
  width: number;
  height: number;
  ink: GeoInk | null;
  batches: FlowBatches | null;
  inkStale: boolean;
  baked: boolean;
  flowsDirty: boolean;
  ping: { id: string; start: number } | null;
  /** Light from arrivals at the selected region, 0 to 1. */
  halo: number;
  fxDirty: boolean;
}

function createEngine(selected: string | null, kind: GeoFlowsProjection): FlowEngine {
  return {
    paths: new Map(),
    particles: [],
    regions: [],
    indexById: new Map(),
    selected,
    kind,
    maxParticles: 400,
    synced: false,
    prespawned: false,
    layoutKey: "",
    projection: null,
    lattice: null,
    scale: 1,
    edges: null,
    width: 0,
    height: 0,
    ink: null,
    batches: null,
    inkStale: true,
    baked: false,
    flowsDirty: true,
    ping: null,
    halo: 0,
    fxDirty: false,
  };
}

/** Whether traffic between these regions touches the selected one. */
const touches = (startId: string, endId: string, selected: string | null) => selected !== null && (startId === selected || endId === selected);

const isRelated = (path: FlowPath, selected: string | null) => touches(path.startId, path.endId, selected);

const spring = (position: number): Spring => ({ position, velocity: 0 });

/** An exponential draw with mean 1: the gap to the next arrival of a Poisson process, in units of rate · time. */
const exponential = () => -Math.log(1 - Math.random());

/** Brings the paths in line with the data. The first sync shows everything at once; later ones animate. */
function syncPaths(engine: FlowEngine, model: FlowModel) {
  const initial = !engine.synced;
  const keep = new Set<string>();
  const upsert = (key: string, direction: "down" | "up", start: FlowRegion, end: FlowRegion, value: number) => {
    if (value <= 0) return;
    keep.add(key);
    const existing = engine.paths.get(key);
    if (existing && !existing.dead) {
      existing.target = value;
      existing.removed = false;
      if (moved(existing.start, start) || moved(existing.end, end)) {
        existing.start = { lat: start.lat, lon: start.lon };
        existing.end = { lat: end.lat, lon: end.lon };
        existing.tracks = null;
      }
      return;
    }
    const related = touches(start.id, end.id, engine.selected);
    const visible = engine.selected === null || related;
    engine.paths.set(key, {
      key,
      direction,
      startId: start.id,
      endId: end.id,
      start: { lat: start.lat, lon: start.lon },
      end: { lat: end.lat, lon: end.lon },
      target: value,
      amount: spring(initial ? value : 0),
      rows: spring(-1),
      emphasis: spring(visible ? 1 : 0),
      presence: spring(initial ? 1 : 0),
      removed: false,
      lit: related && initial ? 1 : 0,
      litFromEnd: end.id === engine.selected,
      tracks: null,
      length: 0,
      accumulator: 0,
      nextSpawn: exponential(),
      seed: (stringHash(key) % 9973) + 0.5,
      dead: false,
    });
  };
  for (const link of model.links) {
    const from = model.regions[link.from];
    const to = model.regions[link.to];
    upsert(`${link.key}:down`, "down", from, to, link.down);
    upsert(`${link.key}:up`, "up", to, from, link.up);
  }
  for (const path of engine.paths.values()) {
    if (keep.has(path.key)) continue;
    path.removed = true;
    path.target = 0;
  }
  engine.synced = true;
  engine.flowsDirty = true;
}

const moved = (a: LatLon, b: LatLon) => Math.abs(a.lat - b.lat) > 1e-9 || Math.abs(a.lon - b.lon) > 1e-9;

/** New ink after a theme change: ramps for the batches and a rebake of the static lattice. */
function refreshInk(engine: FlowEngine, palette: GeoPalette) {
  const ink = geoInk(palette);
  engine.ink = ink;
  // the hot end of each ramp: shine for the accent (deep violet in light, white in dark), toward the text colour for info
  const downStops = [ink.accent, ink.shine];
  const upStops = [ink.info, mixRgb(ink.info, ink.foreground, 0.45)];
  const fxStops = [ink.accent, ink.shine];
  if (engine.batches) {
    engine.batches.down.setRamp(downStops);
    engine.batches.up.setRamp(upStops);
    engine.batches.fx.setRamp(fxStops);
  } else {
    engine.batches = {
      down: createDotBatch(4096, downStops, { tones: 8, levels: 32 }),
      up: createDotBatch(4096, upStops, { tones: 8, levels: 32 }),
      fx: createDotBatch(1024, fxStops, { tones: 8, levels: 32 }),
    };
  }
  engine.inkStale = false;
  engine.baked = false;
  engine.flowsDirty = true;
}

/** A new canvas size or projection: fit the map into the card padding and rebuild the lattice and every curve. */
function layoutEngine(engine: FlowEngine, width: number, height: number, key: string) {
  const projection = createProjection(engine.kind, { width, height, padding: MARGIN, latRange: LAT_RANGE, center: CENTER });
  const innerWidth = width - 2 * MARGIN;
  engine.projection = projection;
  engine.lattice = mapLattice(projection, { pitch: innerWidth < NARROW_WIDTH ? 3 : 4 });
  engine.scale = clamp(innerWidth / NOMINAL_BOX_WIDTH, 0.45, 1.3);
  engine.edges = outlineEdges(projection, height);
  engine.width = width;
  engine.height = height;
  engine.layoutKey = key;
  engine.baked = false;
  engine.flowsDirty = true;
  for (const path of engine.paths.values()) path.tracks = null;
}

const latticeDotSize = (lattice: DotLattice) => (lattice.pitch >= 4 ? 1.6 : 1.3);

/** The land lattice in the quiet land ink at 0.6, so the flows lead. */
function bakeBase(surface: CanvasSurface, lattice: DotLattice, ink: GeoInk) {
  const { context, width, height } = surface;
  context.clearRect(0, 0, width, height);
  bakeLattice(context, lattice, ink.land, latticeDotSize(lattice), 0.6);
}

const trackPoint = { x: 0, y: 0, angle: 0 };

/** Projects a path's curves (with seam copies) and samples their dots. Done on layout, never per frame. */
function buildTracks(path: FlowPath, projection: MapProjection) {
  const tables = flatPaths(projection, path.start, path.end, { bend: BEND, segments: 48 });
  path.length = tables[0]?.length ?? 0;
  path.tracks = tables.map((table) => {
    const capacity = Math.floor(table.length / DOT_SPACING) + 2;
    const track: Track = {
      table,
      count: 0,
      x: new Float32Array(capacity),
      y: new Float32Array(capacity),
      nx: new Float32Array(capacity),
      ny: new Float32Array(capacity),
      u: new Float32Array(capacity),
      jitter: new Float32Array(capacity),
    };
    forEachDot(table, DOT_SPACING, 0, table.length, (x, y, s) => {
      const i = track.count;
      if (i >= capacity) return;
      pointAtDistance(table, s, trackPoint);
      track.x[i] = x;
      track.y[i] = y;
      track.nx[i] = -Math.sin(trackPoint.angle);
      track.ny[i] = Math.cos(trackPoint.angle);
      track.u[i] = table.length > 0 ? s / table.length : 0;
      track.jitter[i] = hash(path.seed + i * 7.31);
      track.count = i + 1;
    });
    return track;
  });
}

/** Steps every spring and the selection light. Returns whether anything that shows on the flow canvas moved. */
function advancePaths(engine: FlowEngine, delta: number, reduced: boolean) {
  let max = 0;
  for (const path of engine.paths.values()) if (!path.removed) max = Math.max(max, path.target);
  let moving = false;
  for (const path of engine.paths.values()) {
    const related = isRelated(path, engine.selected);
    const rowsTarget = max > 0 && path.target > 0 ? 1 + Math.round(2 * Math.sqrt(path.target / max)) : 1;
    if (path.rows.position < 0) path.rows = spring(rowsTarget);
    settleSpring(path.amount, path.target, delta, reduced, DATA_SPRING);
    moving = settleSpring(path.rows, rowsTarget, delta, reduced, DATA_SPRING) || moving;
    moving = settleSpring(path.emphasis, engine.selected === null || related ? 1 : 0, delta, reduced, EMPHASIS_SPRING) || moving;
    moving = settleSpring(path.presence, path.removed ? 0 : 1, delta, reduced, DATA_SPRING) || moving;
    const litTarget = related ? 1 : 0;
    if (path.lit !== litTarget) {
      if (reduced) path.lit = litTarget;
      else if (path.lit < litTarget) path.lit = Math.min(litTarget, path.lit + delta / LIT_SECONDS);
      else path.lit = Math.max(litTarget, path.lit - delta / UNLIT_SECONDS);
      moving = true;
    }
  }
  return moving;
}

/** Left and right x of the map's outline for every pixel row of the canvas, and the outline's top and bottom. */
interface OutlineEdges {
  left: Float32Array;
  right: Float32Array;
  top: number;
  bottom: number;
}

const edgePoint = createScreenPoint();

/**
 * The outline's edges per row: Equal Earth's sides curve inward toward the poles, so a flow that crosses the seam has
 * to fade at the curve, not at the card's edge. Rows outside the map get an empty span.
 */
function outlineEdges(projection: MapProjection, height: number): OutlineEdges {
  const rows = Math.ceil(height) + 1;
  const left = new Float32Array(rows);
  const right = new Float32Array(rows);
  const { frame } = projection;
  const middle = (frame.x0 + frame.x1) / 2;
  for (let row = 0; row < rows; row++) {
    const point = projection.invert(middle, row);
    if (!point) {
      left[row] = Infinity;
      right[row] = -Infinity;
      continue;
    }
    projection.projectRelative(point.lat, -180, edgePoint);
    left[row] = edgePoint.x;
    projection.projectRelative(point.lat, 180, edgePoint);
    right[row] = edgePoint.x;
  }
  return { left, right, top: frame.y0, bottom: frame.y1 };
}

/** 1 inside the map, falling to 0 over EDGE_FADE px toward its outline, where seam-crossing curves leave the map. */
function edgeFade(edges: OutlineEdges | null, x: number, y: number) {
  if (!edges) return 1;
  const row = Math.round(y);
  if (row < 0 || row >= edges.left.length) return 0;
  const inside = Math.min(x - edges.left[row], edges.right[row] - x);
  const vertical = Math.min(y - edges.top, edges.bottom - y);
  if (inside >= EDGE_FADE && vertical >= EDGE_FADE / 2) return 1;
  return smoothstep(0, EDGE_FADE, inside) * smoothstep(-2, EDGE_FADE / 2, vertical);
}

/**
 * The flow curves as rows of dots. Plain flows sit at 0.32; a selected region's flows brighten from the region
 * outward behind an uneven front with a hot edge; other flows collapse onto their centre line and fade to 0.08.
 */
function drawFlows(engine: FlowEngine, surface: CanvasSurface, batches: FlowBatches) {
  const { context, width, height, dpr } = surface;
  context.clearRect(0, 0, width, height);
  for (const path of engine.paths.values()) {
    const tracks = path.tracks;
    const presence = clamp(path.presence.position, 0, 1);
    if (!tracks || presence <= 0.002) continue;
    const batch = path.direction === "down" ? batches.down : batches.up;
    const emphasis = clamp(path.emphasis.position, 0, 1);
    const rows = Math.max(1, path.rows.position);
    const rowCount = Math.ceil(rows - 1e-3);
    const related = isRelated(path, engine.selected);
    const lit = related ? easeOutCubic(path.lit) : 0;
    const litFading = related ? 1 : path.lit;
    const flashWindow = related ? 1 - smoothstep(0.82, 1, path.lit) : 0;
    const base = 0.08 + 0.28 * emphasis;
    for (const track of tracks) {
      for (let j = 0; j < track.count; j++) {
        const n = track.u[j];
        const jitter = track.jitter[j];
        let appear = 1;
        if (presence < 1) {
          // grows out of the origin (and retracts into it) behind an uneven front
          appear = clamp((presence - (n * 0.82 + jitter * 0.18)) / 0.06, 0, 1);
          if (appear <= 0) continue;
        }
        let boost = 0;
        let flash = 0;
        if (litFading > 0) {
          const along = path.litFromEnd ? 1 - n : n;
          const threshold = along * 0.82 + jitter * 0.18;
          const reveal = related ? lit : path.lit;
          boost = clamp((reveal - threshold) / 0.08, 0, 1);
          if (boost > 0 && flashWindow > 0) flash = Math.exp(-(reveal - threshold) / 0.06) * flashWindow;
        }
        const x = track.x[j];
        const y = track.y[j];
        const alpha = (base + 0.34 * boost + 0.4 * flash) * appear * edgeFade(engine.edges, x, y);
        if (alpha < 0.02) continue;
        const nx = track.nx[j];
        const ny = track.ny[j];
        for (let k = 0; k < rowCount; k++) {
          const share = clamp(rows - k, 0, 1);
          const offset = (k - (rows - 1) / 2) * ROW_GAP * emphasis;
          // collapsed rows overlap on the centre line; only one of them keeps its full alpha
          const rowAlpha = alpha * share * (k === 0 ? 1 : emphasis);
          // squares on the device pixel grid read as crisp pixel rows, like the lattice, not as an anti-aliased smear
          batch.add(snapCenter(x + nx * offset, FLOW_DOT, dpr), snapCenter(y + ny * offset, FLOW_DOT, dpr), FLOW_DOT, flash, rowAlpha);
        }
      }
    }
  }
  batches.down.flush(context);
  batches.up.flush(context);
}

/** Particles flowing on first view, at random positions, so the map never starts empty. */
function prespawn(engine: FlowEngine) {
  const speed = PARTICLE_SPEED * engine.scale;
  let max = 0;
  for (const path of engine.paths.values()) max = Math.max(max, path.target);
  for (const path of engine.paths.values()) {
    if (!path.tracks || path.length <= 0 || max <= 0) continue;
    const rate = spawnRate(path, max);
    const expected = (rate * path.length) / speed;
    const count = Math.floor(expected + Math.random());
    for (let i = 0; i < count && engine.particles.length < engine.maxParticles; i++) {
      engine.particles.push({ path, s: Math.random() * path.length, lane: randomLane(path) });
    }
  }
  engine.prespawned = engine.paths.size > 0;
}

/** Particles per second: 1.2 plus up to 10 by throughput, times emphasis² so unrelated flows drain. */
function spawnRate(path: FlowPath, max: number) {
  const emphasis = clamp(path.emphasis.position, 0, 1);
  const presence = clamp(path.presence.position, 0, 1);
  return (1.2 + (10 * Math.max(0, path.amount.position)) / max) * emphasis * emphasis * presence;
}

const randomLane = (path: FlowPath) => Math.floor(Math.random() * Math.max(1, Math.round(path.rows.position)));

function spawnParticles(engine: FlowEngine, delta: number) {
  if (engine.maxParticles <= 0) return;
  let max = 0;
  for (const path of engine.paths.values()) max = Math.max(max, path.target, path.amount.position);
  if (max <= 0) return;
  const speed = PARTICLE_SPEED * engine.scale;
  for (const path of engine.paths.values()) {
    if (!path.tracks || path.length <= 0) continue;
    const rate = spawnRate(path, max);
    if (rate <= 0) continue;
    path.accumulator += rate * delta;
    while (path.accumulator >= path.nextSpawn) {
      path.accumulator -= path.nextSpawn;
      path.nextSpawn = exponential();
      // the oldest particle makes room
      if (engine.particles.length >= engine.maxParticles) engine.particles.shift();
      // start a little along the curve, by how long ago within this frame the arrival fell
      engine.particles.push({ path, s: Math.min(path.length, (path.accumulator / rate) * speed), lane: randomLane(path) });
    }
  }
}

/** Moves particles at constant speed; arrivals at the selected region feed its halo. */
function moveParticles(engine: FlowEngine, delta: number) {
  const speed = PARTICLE_SPEED * engine.scale;
  const particles = engine.particles;
  let alive = 0;
  for (let i = 0; i < particles.length; i++) {
    const particle = particles[i];
    if (particle.path.dead) continue;
    particle.s += speed * delta;
    if (particle.s >= particle.path.length) {
      if (engine.selected !== null && particle.path.endId === engine.selected) engine.halo = Math.min(1, engine.halo + 0.12);
      continue;
    }
    particles[alive++] = particle;
  }
  particles.length = alive;
}

const particlePoint = { x: 0, y: 0, angle: 0 };
const markerPoint = createScreenPoint();

/** Particles, the selection ping and the arrival halo. Returns whether anything is still animating. */
function drawEffects(engine: FlowEngine, surface: CanvasSurface, batches: FlowBatches, time: number, delta: number, reduced: boolean) {
  const { context, width, height, dpr } = surface;
  const { lattice, projection } = engine;
  engine.halo *= Math.exp(-delta / HALO_DECAY);
  if (engine.halo < 0.01) engine.halo = 0;
  const pingAge = engine.ping ? (time - engine.ping.start) / PING_SECONDS : 1;
  if (engine.ping && (pingAge >= 1 || reduced)) engine.ping = null;
  const busy = engine.particles.length > 0 || engine.ping !== null || engine.halo > 0;
  if (!busy) {
    if (engine.fxDirty) {
      context.clearRect(0, 0, width, height);
      engine.fxDirty = false;
    }
    return false;
  }
  engine.fxDirty = true;
  context.clearRect(0, 0, width, height);

  // the land under the selected region: a one-shot ping, then a glow fed by arrivals
  const selectedIndex = engine.selected === null ? undefined : engine.indexById.get(engine.selected);
  if (lattice && projection && selectedIndex !== undefined && (engine.ping || engine.halo > 0)) {
    const region = engine.regions[selectedIndex];
    projection.project(region.lat, region.lon, markerPoint);
    const cx = markerPoint.x;
    const cy = markerPoint.y;
    const size = latticeDotSize(lattice);
    if (engine.ping && engine.ping.id === region.id) {
      const t = clamp(pingAge, 0, 1);
      const radius = easeOutCubic(t) * PING_RADIUS * engine.scale;
      const fade = 1 - t * t;
      lattice.grid.query(cx, cy, radius + 18, (i, distanceSquared) => {
        const distance = Math.sqrt(distanceSquared);
        const front = ringFront(distance, radius, 9, lattice.jitter[i], 7);
        const wake = distance < radius ? 0.25 * (1 - distance / Math.max(1, radius)) : 0;
        batches.fx.add(lattice.x[i], lattice.y[i], size, front, (front + wake) * fade);
      });
    }
    if (engine.halo > 0) {
      const radius = HALO_RADIUS * Math.max(0.6, engine.scale);
      const halo = engine.halo;
      lattice.grid.query(cx, cy, radius, (i, distanceSquared) => {
        const falloff = 1 - distanceSquared / (radius * radius);
        // the dots light in their seeded order, so a stronger halo is a denser one, with an uneven edge
        if (lattice.density[i] > halo * 1.6 - (1 - falloff) * 0.5) return;
        batches.fx.add(lattice.x[i], lattice.y[i], size, 0.15 + 0.5 * halo * falloff, (0.25 + 0.75 * halo) * falloff * 0.85);
      });
    }
    batches.fx.flush(context);
  }

  const selected = engine.selected;
  for (const particle of engine.particles) {
    const path = particle.path;
    const tracks = path.tracks;
    if (!tracks || path.length <= 0) continue;
    const emphasis = clamp(path.emphasis.position, 0, 1);
    const related = isRelated(path, selected);
    const alpha = (selected === null ? 1 : related ? 1 : 0.35 + 0.3 * emphasis) * clamp(path.presence.position, 0, 1);
    // heads run hot (toward shine): brighter than the curve they ride, hottest on the selected region's flows
    const tone = related ? 1 : selected === null ? 0.5 : 0;
    const rows = Math.max(1, path.rows.position);
    const lane = Math.min(particle.lane, Math.ceil(rows - 1e-3) - 1);
    const offset = (lane - (rows - 1) / 2) * ROW_GAP * emphasis;
    const progress = particle.s / path.length;
    const batch = path.direction === "down" ? batches.down : batches.up;
    for (const track of tracks) {
      const s = progress * track.table.length;
      for (let k = 0; k < TAIL_ALPHA.length; k++) {
        const along = s - k * TAIL_GAP;
        if (along < 0) break;
        pointAtDistance(track.table, along, particlePoint);
        const x = particlePoint.x - Math.sin(particlePoint.angle) * offset;
        const y = particlePoint.y + Math.cos(particlePoint.angle) * offset;
        if (x < -4 || y < -4 || x > width + 4 || y > height + 4) continue;
        const size = k === 0 ? HEAD_SIZE : TAIL_SIZE;
        const fade = edgeFade(engine.edges, x, y);
        batch.add(snapCenter(x, size, dpr), snapCenter(y, size, dpr), size, k === 0 ? tone : tone * 0.4, alpha * TAIL_ALPHA[k] * fade);
      }
    }
  }
  batches.down.flush(context);
  batches.up.flush(context);
  return true;
}

/** Forgets removed paths once they have retracted and their last particle has arrived. */
function pruneRemoved(engine: FlowEngine) {
  for (const path of engine.paths.values()) {
    if (!path.removed || path.presence.position > 0.002) continue;
    if (engine.particles.some((particle) => particle.path === path)) continue;
    path.dead = true;
    engine.paths.delete(path.key);
  }
}
