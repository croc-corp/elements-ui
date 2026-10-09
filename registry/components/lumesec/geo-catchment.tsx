"use client";

import * as React from "react";

import { localPoint, snapCenter, useCanvas, type CanvasOptions, type CanvasSurface } from "@/lib/lumesec/canvas";
import { usePalette } from "@/lib/lumesec/color";
import {
  ARROW_DIRECTIONS,
  coastlinePath,
  createDotBatch,
  createProjection,
  createScreenPoint,
  distanceKm,
  fiberRttMs,
  flatPaths,
  forEachDot,
  GEO_TOKENS,
  geoInk,
  latLonToVector,
  latticeVectors,
  mapLattice,
  projectionAspect,
  projectionOutlineSvgPath,
  placeLabels,
  ringFront,
  spatialNavigate,
  type ArcLengthTable,
  type DotBatch,
  type DotLattice,
  type GeoInk,
  type MapProjection,
  type Vec3,
} from "@/lib/lumesec/geo";
import { DEMO_CITIES, formatCompact, formatMs } from "@/lib/lumesec/geo-data";
import { clamp, easeOutCubic, percent, rgba, smoothstep } from "@/lib/lumesec/math";
import { prefersReducedMotion, useAnimationLoop, useLazyRef, useReducedMotion } from "@/lib/lumesec/motion";
import { RollText } from "@/lib/lumesec/roll-text";
import { Sparks } from "@/lib/lumesec/sparks";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** A point of presence that answers requests for its catchment. */
export interface CatchmentSite {
  /** Stable id, used by `active` and `value`. */
  readonly id: string;
  /** Display name, for example "Frankfurt". */
  readonly label: string;
  /** Latitude in degrees. */
  readonly lat: number;
  /** Longitude in degrees. */
  readonly lon: number;
  /**
   * Route stretch: how much longer the network path is than the great circle, for example 1.4. It scales the
   * estimated round trips and, with `metric="latency"`, decides which site serves a place. Default 1.5.
   */
  readonly stretch?: number;
}

/** A source of requests, such as a city or a client network, and how many requests it sends. */
export interface CatchmentClient {
  /** Latitude in degrees. */
  readonly lat: number;
  /** Longitude in degrees. */
  readonly lon: number;
  /** Requests per time unit (see `unit`). Entries with a weight of 0 or less are skipped. */
  readonly weight: number;
}

/** How the serving site is chosen: the nearest by great-circle distance, or the lowest estimated round trip. */
export type CatchmentMetric = "distance" | "latency";

/** Flat projection of the map. */
export type CatchmentProjection = "equalEarth" | "equirectangular";

/**
 * The ten demo sites: Frankfurt, London, Ashburn, Dallas, San Francisco, São Paulo, Johannesburg, Mumbai, Singapore
 * and Tokyo, with invented route stretches between 1.2 and 1.8.
 */
export const CATCHMENT_DEMO_SITES: readonly CatchmentSite[] = [
  { id: "fra", label: "Frankfurt", lat: 50.1109, lon: 8.6821, stretch: 1.75 },
  { id: "lhr", label: "London", lat: 51.5072, lon: -0.1276, stretch: 1.53 },
  { id: "iad", label: "Ashburn", lat: 39.0438, lon: -77.4874, stretch: 1.27 },
  { id: "dfw", label: "Dallas", lat: 32.7767, lon: -96.797, stretch: 1.65 },
  { id: "sfo", label: "San Francisco", lat: 37.7749, lon: -122.4194, stretch: 1.54 },
  { id: "gru", label: "São Paulo", lat: -23.5505, lon: -46.6333, stretch: 1.34 },
  { id: "jnb", label: "Johannesburg", lat: -26.2041, lon: 28.0473, stretch: 1.75 },
  { id: "bom", label: "Mumbai", lat: 19.076, lon: 72.8777, stretch: 1.46 },
  { id: "sin", label: "Singapore", lat: 1.3521, lon: 103.8198, stretch: 1.35 },
  { id: "nrt", label: "Tokyo", lat: 35.6762, lon: 139.6503, stretch: 1.55 },
];

/** Props of `GeoCatchment`. Other `div` props go to the root. */
export interface GeoCatchmentProps extends Omit<React.ComponentProps<"div">, "defaultValue" | "children"> {
  /** The points of presence. Default: ten demo sites (`CATCHMENT_DEMO_SITES`). An empty array shows an empty map. */
  sites?: readonly CatchmentSite[];
  /** Ids of the sites in service (controlled). Use with `onActiveChange`. */
  active?: readonly string[];
  /** Sites in service when uncontrolled. Default: every site. */
  defaultActive?: readonly string[];
  /** Called with the new list of ids when a switch turns a site on or off. */
  onActiveChange?: (active: readonly string[]) => void;
  /** The selected site id (controlled), or null for none. Use with `onValueChange`. */
  value?: string | null;
  /** The selected site when uncontrolled. Default: the first site. */
  defaultValue?: string | null;
  /** Called when a marker or a list row selects a site, or with null when the selected one is pressed again. */
  onValueChange?: (value: string | null) => void;
  /**
   * Request sources for the shares, assigned to sites like the map. Default: demo traffic from 60 cities, but only
   * while `sites` is also undefined; with your sites and no clients the share and request columns show '–'.
   */
  clients?: readonly CatchmentClient[];
  /** `distance`: the nearest site serves. `latency`: the site with the lowest estimated round trip serves. */
  metric?: CatchmentMetric;
  /** Unit of the request numbers, shown in the list header and the readout. */
  unit?: string;
  /** Map projection. Both crop the map to 56° S to 76° N. */
  projection?: CatchmentProjection;
  /** Spacing of the land dots in CSS px, 2 to 12. */
  pitch?: number;
}

/**
 * Which point of presence serves which part of the world. Every land dot belongs to its nearest site in service,
 * the borders between catchments are drawn brighter, and the selected site's catchment is lit in the accent colour.
 * Turning a site off leaves a hole that the neighbouring sites flood from their own side; turning it on lets it
 * reclaim its catchment from its centre. Pointing at the map draws a dotted line to the site that serves the spot,
 * with the estimated round trip. Shares and request rates roll to their new values.
 *
 * @example
 * <GeoCatchment defaultValue="fra" onActiveChange={(ids) => console.log(ids)} />
 */
export function GeoCatchment({
  sites,
  active,
  defaultActive,
  onActiveChange,
  value,
  defaultValue,
  onValueChange,
  clients,
  metric = "distance",
  unit = "req/s",
  projection = "equalEarth",
  pitch = 4,
  className,
  ...props
}: GeoCatchmentProps) {
  const reducedMotion = useReducedMotion();
  const siteList = sites ?? CATCHMENT_DEMO_SITES;
  // demo traffic only belongs to the demo sites: real sites never get invented request numbers
  const clientList = clients ?? (sites === undefined ? DEMO_CLIENTS : NO_CLIENTS);
  const kind: CatchmentProjection = projection === "equirectangular" ? "equirectangular" : "equalEarth";
  const rule: CatchmentMetric = metric === "latency" ? "latency" : "distance";
  const dotPitch = Number.isFinite(pitch) ? clamp(pitch, 2, 12) : 4;

  const [activeState, setActiveState] = useControllableState<readonly string[] | undefined>({
    value: active,
    defaultValue: defaultActive,
    onChange: (next) => {
      if (next) onActiveChange?.(next);
    },
  });
  const [selectedState, setSelectedState] = useControllableState<string | null | undefined>({
    value,
    defaultValue,
    onChange: (next) => onValueChange?.(next ?? null),
  });

  // The model keeps its identity while the sites and the service list are equal in content, so inline arrays do not
  // restart the map.
  const sitesKey = siteKeyOf(siteList);
  const activeKey = activeState === undefined ? "*" : activeState.join("\u0001");
  const [model, setModel] = React.useState(() => createModel(siteList, activeState, sitesKey, activeKey));
  if (model.sitesKey !== sitesKey || model.activeKey !== activeKey) {
    setModel(createModel(siteList, activeState, sitesKey, activeKey));
  }
  const traffic = React.useMemo(() => computeTraffic(model, clientList, rule), [model, clientList, rule]);
  const selectedId = selectedState === undefined ? (model.sites[0]?.id ?? null) : selectedState;
  const selectedIndex = selectedId === null ? -1 : model.sites.findIndex((site) => site.id === selectedId);
  const layout = React.useMemo(() => nominalLayout(kind, model.sites), [kind, model.sites]);

  // Announce service changes once per change, with the site that took over the most traffic.
  const [heard, setHeard] = React.useState<Heard>(() => ({
    sitesKey: model.sitesKey,
    activeKey: model.activeKey,
    active: model.active,
    requests: traffic.requests,
    text: "",
  }));
  if (heard.sitesKey !== model.sitesKey || heard.activeKey !== model.activeKey) {
    setHeard({
      sitesKey: model.sitesKey,
      activeKey: model.activeKey,
      active: model.active,
      requests: traffic.requests,
      text: describeChange(heard, model, traffic),
    });
  }

  const [hoverIndex, setHoverIndex] = React.useState(-1);
  const [focusIndex, setFocusIndex] = React.useState(-1);
  const [probeOwner, setProbeOwner] = React.useState(-1);
  /** The map's CSS size, for label placement; null until measured (the server places labels by position). */
  const [mapSize, setMapSize] = React.useState<{ width: number; height: number } | null>(null);

  const mapRef = React.useRef<HTMLDivElement>(null);
  const dotsRef = React.useRef<HTMLCanvasElement>(null);
  const effectsRef = React.useRef<HTMLCanvasElement>(null);
  const chipRef = React.useRef<HTMLDivElement>(null);
  const chipSiteRef = React.useRef<HTMLSpanElement>(null);
  const chipRttRef = React.useRef<HTMLSpanElement>(null);
  const markerRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const markerDotRefs = React.useRef<(HTMLSpanElement | null)[]>([]);
  // created on first use, from the first projection and dot spacing
  const engineRef = useLazyRef(() => createEngine(kind, dotPitch));

  const loop = useAnimationLoop(mapRef, step);
  const colors = usePalette(mapRef, GEO_TOKENS, () => {
    engineRef.current.inkStale = true;
    loop.kick();
  });
  const dots = useCanvas(
    dotsRef,
    (surface) => {
      layoutMap(engineRef.current, surface);
      const { width, height } = surface;
      setMapSize((size) => (size && size.width === width && size.height === height ? size : { width, height }));
      loop.kick();
    },
    MAP_CANVAS,
  );
  const effects = useCanvas(effectsRef, () => loop.kick(), MAP_CANVAS);

  // Projection and dot spacing rebuild the lattice; the assignment snaps to it without animating.
  React.useEffect(() => {
    const state = engineRef.current;
    if (state.kind === kind && state.pitch === dotPitch) return;
    state.kind = kind;
    state.pitch = dotPitch;
    const surface = dots.current;
    if (surface) layoutMap(state, surface);
    loop.kick();
  }, [kind, dotPitch, dots, engineRef, loop]);

  // Sites, the service list or the metric changed: reassign the dots. A site that goes off leaves a hole its
  // neighbours flood; a site that comes on reclaims its area from its centre.
  React.useEffect(() => {
    const state = engineRef.current;
    const previous = state.model;
    if (previous === model && state.metric === rule) return;
    state.model = model;
    state.metric = rule;
    placeSites(state);
    if (!state.lattice) return;
    const now = performance.now() / 1000;
    if (!previous || previous.sitesKey !== model.sitesKey || !state.assigned) {
      assignFresh(state, now, prefersReducedMotion());
    } else {
      retarget(state, now, previous.active, prefersReducedMotion());
      // markers that changed state pop, and the sparks fly from them past the edge of the map
      for (let k = 0; k < model.sites.length; k++) {
        if (previous.active[k] === model.active[k]) continue;
        celebrate(state, k, model.active[k] === 1, markerDotRefs.current[k]);
      }
    }
    state.dirty = true;
    loop.kick();
  }, [model, rule, engineRef, loop]);

  // A new selection: the accent spreads through its catchment from the site behind a ring of light.
  React.useEffect(() => {
    const state = engineRef.current;
    if (state.selected === selectedIndex) return;
    const first = state.selected === UNSET;
    state.previous = first ? -1 : state.selected;
    state.selected = selectedIndex;
    state.selectStart = first || prefersReducedMotion() ? -Infinity : performance.now() / 1000;
    state.selectReach = -1;
    state.dirty = true;
    loop.kick();
  }, [selectedIndex, engineRef, loop]);

  // Pointing at a row, a marker or a spot on the map lifts that catchment a little.
  React.useEffect(() => {
    const state = engineRef.current;
    const next = hoverIndex >= 0 ? hoverIndex : probeOwner;
    if (state.hover === next) return;
    state.hover = next;
    state.dirty = true;
    loop.kick();
  }, [hoverIndex, probeOwner, engineRef, loop]);

  React.useEffect(() => {
    loop.kick();
  }, [reducedMotion, loop]);

  // A probe opened by a tap stays until the next tap outside the map.
  React.useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const map = mapRef.current;
      if (!map || (event.target instanceof Node && map.contains(event.target))) return;
      if (!retireProbe(engineRef.current, chipRef.current)) return;
      setProbeOwner(-1);
      loop.kick();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [engineRef, loop]);

  function step(time: number, delta: number) {
    const state = engineRef.current;
    const palette = colors.current;
    const surface = dots.current;
    if (!palette || !surface || !state.lattice) return false;
    const reduced = prefersReducedMotion();
    if (state.inkStale || !state.ink) {
      state.ink = geoInk(palette);
      state.batches = createBatches(state.ink, state.batches);
      state.inkStale = false;
      state.dirty = true;
    }
    if (state.introPending) startIntro(state, time, reduced);
    const selecting = !reduced && time - state.selectStart < SWEEP_SECONDS + 0.1;
    const live = time < state.transitionEnd || selecting;
    if (live || state.dirty || state.wasLive) drawMap(surface, state, time, reduced);
    state.dirty = false;
    state.wasLive = live;
    const effectsSurface = effects.current;
    const effectsLive = effectsSurface ? drawEffects(effectsSurface, state, time, delta, reduced) : false;
    return live || effectsLive;
  }

  function hideProbe() {
    if (!retireProbe(engineRef.current, chipRef.current)) return;
    setProbeOwner(-1);
    loop.kick();
  }

  function moveProbe(event: React.PointerEvent<HTMLDivElement>) {
    const target = event.target;
    if (target instanceof Element && target.closest("[data-marker]")) {
      hideProbe();
      return;
    }
    const map = event.currentTarget;
    // CSS zoom on an ancestor scales the client rect but not the layout size: work in the map's own px
    const { x, y } = localPoint(map, event.clientX, event.clientY);
    const width = map.offsetWidth;
    const reading = aimProbe(engineRef.current, x, y, performance.now() / 1000);
    if (!reading) {
      hideProbe();
      return;
    }
    const chip = chipRef.current;
    const siteText = chipSiteRef.current;
    const rttText = chipRttRef.current;
    if (chip && siteText && rttText) {
      siteText.textContent = reading.label;
      rttText.textContent = reading.rtt;
      chip.dataset.rtt = reading.rtt ? "true" : "false";
      const chipWidth = chip.offsetWidth;
      const chipHeight = chip.offsetHeight;
      let left = x + 12;
      if (left + chipWidth > width + 8) left = x - 12 - chipWidth;
      left = clamp(left, -8, Math.max(-8, width + 8 - chipWidth));
      let top = y - chipHeight - 10;
      if (top < -6) top = y + 14;
      chip.style.transform = `translate3d(${left.toFixed(1)}px,${top.toFixed(1)}px,0)`;
      chip.dataset.visible = "true";
    }
    if (reading.owner !== probeOwner) setProbeOwner(reading.owner);
    loop.kick();
  }

  function handleMapPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") moveProbe(event);
  }

  function handleMapPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    // touch moves scroll the page; a tap places the probe on pointer down
    if (event.pointerType !== "touch") moveProbe(event);
  }

  function handleMapPointerLeave(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch") hideProbe();
  }

  function toggleSite(index: number) {
    const on = (k: number) => (k === index ? model.active[k] === 0 : model.active[k] === 1);
    setActiveState(model.sites.filter((_, k) => on(k)).map((site) => site.id));
  }

  function selectSite(index: number) {
    const site = model.sites[index];
    if (!site) return;
    setSelectedState(index === selectedIndex ? null : site.id);
  }

  /** Hit areas of close sites overlap: a pointer click goes to the marker nearest to the pointer. */
  function nearestMarker(event: React.MouseEvent<HTMLButtonElement>, fallback: number) {
    const map = mapRef.current;
    if (!map) return fallback;
    const rect = map.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * NOMINAL_WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * layout.height;
    let best = fallback;
    let bestDistance = Infinity;
    layout.points.forEach((point, k) => {
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = k;
      }
    });
    return best;
  }

  function handleMarkerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const direction = ARROW_DIRECTIONS[event.key];
    let next = -1;
    if (direction) next = spatialNavigate(layout.points, index, direction);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = model.sites.length - 1;
    else return;
    event.preventDefault();
    if (next < 0 || next === index) return;
    setFocusIndex(next);
    markerRefs.current[next]?.focus();
  }

  const count = model.sites.length;
  const tabStop = focusIndex >= 0 && focusIndex < count ? focusIndex : Math.max(0, selectedIndex);
  const linked = hoverIndex >= 0 ? hoverIndex : probeOwner;
  const reading = readoutOf(model, traffic, selectedIndex);
  const sides = React.useMemo(() => labelSides(model, layout, mapSize), [model, layout, mapSize]);
  const noneInService = count > 0 && model.activeCount === 0;
  const animate = !reducedMotion;

  return (
    <div
      data-slot="geo-catchment"
      className={cn(
        "@container w-full max-w-[660px] rounded-xl border border-border bg-card p-3 text-foreground [-webkit-tap-highlight-color:transparent]",
        className,
      )}
      {...props}
    >
      <div className="grid gap-3 @min-[560px]:grid-cols-[minmax(0,1fr)_224px] @min-[560px]:gap-4">
        <div className="flex min-w-0 flex-col gap-3">
          <div
            ref={mapRef}
            className="relative touch-pan-y select-none"
            style={{ aspectRatio: layout.aspect }}
            onPointerDown={handleMapPointerDown}
            onPointerMove={handleMapPointerMove}
            onPointerLeave={handleMapPointerLeave}
            onPointerCancel={hideProbe}
          >
            <svg
              aria-hidden="true"
              viewBox={`0 0 ${NOMINAL_WIDTH} ${layout.height}`}
              preserveAspectRatio="none"
              className="absolute inset-0 size-full overflow-visible"
            >
              <path d={layout.outline} fill="none" stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            </svg>
            <canvas ref={dotsRef} aria-hidden="true" className="absolute inset-0 block size-full" />
            <canvas
              ref={effectsRef}
              aria-hidden="true"
              className="pointer-events-none absolute -top-8 -left-8 z-[2] block h-[calc(100%+64px)] w-[calc(100%+64px)]"
            />
            <div role="group" aria-label="Sites on the map" className="absolute inset-0 z-[3]">
              {model.sites.map((site, i) => {
                const point = layout.percent[i];
                const on = model.active[i] === 1;
                const selected = i === selectedIndex;
                const shown = selected || i === linked;
                return (
                  <button
                    key={site.id}
                    ref={(node) => {
                      markerRefs.current[i] = node;
                    }}
                    type="button"
                    data-marker=""
                    data-state={on ? "on" : "off"}
                    data-selected={selected ? "" : undefined}
                    aria-pressed={selected}
                    aria-label={markerLabel(site, on, traffic, i)}
                    tabIndex={i === tabStop ? 0 : -1}
                    onClick={(event) => selectSite(event.detail === 0 ? i : nearestMarker(event, i))}
                    onFocus={() => setFocusIndex(i)}
                    onKeyDown={(event) => handleMarkerKeyDown(event, i)}
                    onPointerEnter={() => setHoverIndex(i)}
                    onPointerLeave={() => setHoverIndex(-1)}
                    className={cn(
                      "group/marker absolute -mt-3 -ml-3 grid size-6 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 font-[inherit] outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-lumesec",
                      selected && "z-[2]",
                    )}
                    style={{ left: point.left, top: point.top }}
                  >
                    <span
                      ref={(node) => {
                        markerDotRefs.current[i] = node;
                      }}
                      className={cn(
                        "block size-[7px] rounded-full transition-[background-color,box-shadow,scale] duration-300 group-hover/marker:scale-[1.3] motion-reduce:transition-none",
                        on ? (selected ? "bg-lumesec" : "bg-foreground") : "bg-destructive",
                        selected
                          ? on
                            ? "shadow-[0_0_0_2px_var(--card),0_0_0_3.5px_var(--lumesec)]"
                            : "shadow-[0_0_0_2px_var(--card),0_0_0_3.5px_var(--destructive)]"
                          : "shadow-[0_0_0_2px_var(--card)]",
                      )}
                    />
                    <span
                      aria-hidden="true"
                      className={cn(
                        "pointer-events-none absolute font-mono text-[10.5px] leading-[14px] whitespace-nowrap transition-opacity duration-200 [text-shadow:0_0_2px_var(--card),0_0_4px_var(--card),0_0_6px_var(--card)] group-hover/marker:opacity-100 group-focus-visible/marker:opacity-100 motion-reduce:transition-none",
                        // an off site's label clears its checker halo
                        labelClass(sides[i], on),
                        shown ? "opacity-100" : "opacity-0",
                        on ? "text-foreground" : "text-destructive",
                      )}
                    >
                      {site.label}
                    </span>
                  </button>
                );
              })}
            </div>
            <div
              ref={chipRef}
              aria-hidden="true"
              data-visible="false"
              data-rtt="false"
              className="group/chip pointer-events-none absolute top-0 left-0 z-[4] flex items-center gap-1.5 rounded-md border border-border bg-card px-1.5 py-[3px] text-[11px] leading-4 whitespace-nowrap text-foreground opacity-0 shadow-[0_6px_16px_-8px_rgb(0_0_0/0.35)] transition-opacity duration-150 data-[visible=true]:opacity-100 motion-reduce:transition-none"
            >
              <span ref={chipSiteRef} className="font-medium" />
              <span className="size-[3px] rounded-full bg-muted-foreground/50 group-data-[rtt=false]/chip:hidden" />
              <span ref={chipRttRef} className="font-mono text-muted-foreground tabular-nums" />
            </div>
          </div>
          <div className="mt-auto grid gap-2.5 border-t border-border pt-2.5">
            <Readout reading={reading} unit={unit} animate={animate} />
            <ShareStrip model={model} traffic={traffic} selected={selectedIndex} linked={linked} onHover={setHoverIndex} />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-1 border-t border-border pt-2.5 @min-[560px]:border-t-0 @min-[560px]:border-l @min-[560px]:pt-0 @min-[560px]:pl-3">
          <div className="flex h-5 items-center gap-1.5 px-1.5 text-[11px] leading-4 whitespace-nowrap text-muted-foreground">
            {noneInService ? (
              <span className="min-w-0 flex-1 truncate text-destructive">No site in service</span>
            ) : count === 0 ? (
              <span className="min-w-0 flex-1">No sites</span>
            ) : (
              <span className="min-w-0 flex-1 truncate">
                Sites <span className="ml-0.5 font-mono tabular-nums">{model.activeCount}/{count}</span>
              </span>
            )}
            <span aria-hidden="true" className="w-[30px] shrink-0 text-right">
              Share
            </span>
            <span aria-hidden="true" className="w-[36px] shrink-0 truncate text-right">
              {unit}
            </span>
          </div>
          <ul className="m-0 flex list-none flex-col gap-px p-0">
            {model.sites.map((site, i) => {
              const on = model.active[i] === 1;
              const selected = i === selectedIndex;
              const requests = traffic.requests[i];
              return (
                <li
                  key={site.id}
                  data-selected={selected ? "" : undefined}
                  data-state={on ? "on" : "off"}
                  data-linked={i === linked && !selected ? "" : undefined}
                  onClick={() => selectSite(i)}
                  onPointerEnter={() => setHoverIndex(i)}
                  onPointerLeave={() => setHoverIndex(-1)}
                  className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-[12.5px] leading-4 transition-colors duration-150 data-[linked]:bg-muted/60 data-[selected]:bg-muted motion-reduce:transition-none @min-[560px]:h-[22px]"
                >
                  <SiteSwitch checked={on} label={`${site.label} in service`} onToggle={() => toggleSite(i)} />
                  <span
                    className={cn(
                      "ml-0.5 min-w-0 flex-1 truncate transition-colors duration-200",
                      selected && "font-medium",
                      on ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {site.label}
                  </span>
                  <RollingNumber
                    value={traffic.served > 0 ? requests / traffic.served : Number.NaN}
                    text={shareText(requests, traffic.served)}
                    animate={animate}
                    className="w-[30px] shrink-0 justify-items-end font-mono text-[12px] tabular-nums"
                  />
                  <span className="sr-only"> of requests, </span>
                  <RollingNumber
                    value={traffic.hasClients ? requests : Number.NaN}
                    text={traffic.hasClients ? formatCompact(requests) : MISSING}
                    animate={animate}
                    className="w-[36px] shrink-0 justify-items-end font-mono text-[12px] text-muted-foreground tabular-nums"
                  />
                  <span className="sr-only"> {unit}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <span aria-live="polite" className="sr-only">
        {heard.text}
      </span>
    </div>
  );
}

/* Parts ------------------------------------------------------------------------------------------------- */

/** A 24 × 14 switch that turns a site on or off. Its label names the site: "<site> in service". */
function SiteSwitch({ checked, label, onToggle }: { checked: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={(event) => {
        // the row selects on click; the switch only toggles
        event.stopPropagation();
        onToggle();
      }}
      className="group/switch relative h-[14px] w-6 shrink-0 cursor-pointer rounded-full border-0 bg-foreground/15 p-0 outline-none transition-colors duration-200 before:absolute before:-inset-x-2 before:-inset-y-1.5 before:content-[''] hover:bg-foreground/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec aria-checked:bg-lumesec motion-reduce:transition-none"
    >
      <span className="absolute top-[2px] left-[2px] size-[10px] rounded-full bg-white shadow-[0_1px_1.5px_rgb(0_0_0/0.3)] transition-transform duration-300 ease-[cubic-bezier(.3,1.45,.5,1)] group-aria-checked/switch:translate-x-[10px] motion-reduce:transition-none" />
    </button>
  );
}

/** A number that rolls up when its value grows and down when it shrinks. */
function RollingNumber({ value, text, animate, className }: { value: number; text: string; animate: boolean; className?: string }) {
  const [state, setState] = React.useState({ value, direction: 1 });
  if (!Object.is(state.value, value)) {
    setState({ value, direction: Number.isNaN(state.value) || Number.isNaN(value) || value >= state.value ? 1 : -1 });
  }
  return <RollText text={text} direction={state.direction} animate={animate} className={className} />;
}

interface Reading {
  name: string;
  status: string;
  tone: "accent" | "off" | "plain";
  share: number;
  shareText: string;
  requests: number;
  requestsText: string;
  rtt: number;
  rttText: string;
}

/** The selected site's share, request rate and estimated round trip, or the totals when nothing is selected. */
function Readout({ reading, unit, animate }: { reading: Reading; unit: string; animate: boolean }) {
  return (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
      <div className="mr-auto min-w-0">
        <div className="flex items-center gap-1.5 text-[13px] leading-5 font-medium">
          <span
            aria-hidden="true"
            className={cn(
              "size-2 shrink-0 rounded-[2px] transition-colors duration-300",
              reading.tone === "accent" ? "bg-lumesec" : reading.tone === "off" ? "bg-destructive" : "bg-foreground/35",
            )}
          />
          <span className="truncate">{reading.name}</span>
        </div>
        <div className={cn("text-[11.5px] leading-4", reading.tone === "off" ? "text-destructive" : "text-muted-foreground")}>
          {reading.status}
        </div>
      </div>
      <Stat label="Share" value={reading.share} text={reading.shareText} animate={animate} />
      <Stat label="Requests" value={reading.requests} text={reading.requestsText} unit={unit} animate={animate} />
      <Stat label="Round trip" value={reading.rtt} text={reading.rttText} animate={animate} />
    </div>
  );
}

function Stat({ label, value, text, unit, animate }: { label: string; value: number; text: string; unit?: string; animate: boolean }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-[11px] leading-4 text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-1 leading-5 whitespace-nowrap">
        <RollingNumber value={value} text={text} animate={animate} className="font-mono text-[14px] font-medium tabular-nums" />
        {unit ? <span className="text-[11.5px] text-muted-foreground">{unit}</span> : null}
      </span>
    </div>
  );
}

/**
 * Share of requests per site as one dotted bar, in list order. The selected site's segment is in the accent colour;
 * a site that goes off collapses and its neighbours in the bar grow, on a slightly springy curve.
 */
function ShareStrip({
  model,
  traffic,
  selected,
  linked,
  onHover,
}: {
  model: SiteModel;
  traffic: Traffic;
  selected: number;
  linked: number;
  onHover: (index: number) => void;
}) {
  if (traffic.served <= 0) {
    return <div aria-hidden="true" className="h-[10px] bg-foreground/12" style={DOT_MASK_STYLE} />;
  }
  return (
    <div aria-hidden="true" className="-mr-[3px] flex h-[10px]">
      {model.sites.map((site, i) => (
        <div
          key={site.id}
          className="min-w-0 basis-0 overflow-hidden transition-[flex-grow] duration-700 ease-[cubic-bezier(.3,1.12,.4,1)] motion-reduce:transition-none"
          style={{ flexGrow: traffic.requests[i] / traffic.served }}
          onPointerEnter={() => onHover(i)}
          onPointerLeave={() => onHover(-1)}
        >
          <div
            className={cn(
              "mr-[3px] h-full transition-[background-color,opacity] duration-300 motion-reduce:transition-none",
              i === selected ? "bg-lumesec" : "bg-foreground",
              i === selected ? "opacity-100" : i === linked ? "opacity-70" : i % 2 === 0 ? "opacity-40" : "opacity-25",
            )}
            style={DOT_MASK_STYLE}
          />
        </div>
      ))}
    </div>
  );
}

/** Square 2 px dots on a 4 px grid, like the map's lattice. */
const DOT_MASK = "linear-gradient(90deg,#000 2px,transparent 2px),linear-gradient(#000 2px,transparent 2px)";
const DOT_MASK_STYLE: React.CSSProperties = {
  maskImage: DOT_MASK,
  WebkitMaskImage: DOT_MASK,
  maskSize: "4px 4px",
  WebkitMaskSize: "4px 4px",
  maskComposite: "intersect",
  WebkitMaskComposite: "source-in",
};

/* Constants ------------------------------------------------------------------------------------------------ */

/** Both projections crop the polar regions, where no point of presence lives. */
const LAT_RANGE: readonly [number, number] = [-56, 76];
/** Width of the render-time projection that places markers in percent. */
const NOMINAL_WIDTH = 1000;
const MAP_CANVAS: CanvasOptions = { maxDpr: 2 };
/** How far the effects canvas reaches past the map, so sparks fly over its edge. */
const FX = 32;
const MISSING = "–";
const UNSET = -2;
const DEFAULT_STRETCH = 1.5;

// Dots in CSS px
const DOT = 1.5;
const EDGE_DOT = 2;
const FLASH_DOT = 3;
const HALO_RADIUS = 14;

// Alphas
const HOLE_ALPHA = 0.2;
const TONE_ALPHAS = [0.28, 0.54] as const;
const EDGE_ALPHA = 0.7;
const ACCENT_ALPHA = 0.75;
const HOVER_LIFT = 0.14;

// Timing in seconds
/** The outage spreads from the failed site to the edge of its catchment. */
const DIE_SECONDS = 0.32;
/** Neighbours flood the hole at one angular speed, so each front starts at its own side. */
const FLOOD_SECONDS = 0.9;
/** A site that comes back reclaims its catchment from its centre. */
const RECLAIM_SECONDS = 0.9;
/** On first view every site grows its catchment at once, and the fronts meet at the borders. */
const INTRO_SECONDS = 1.15;
const JITTER_SECONDS = 0.12;
const FLASH_DECAY = 0.2;
const FLASH_TAIL = 0.7;
const DIE_DECAY = 0.1;
const DIE_TAIL = 0.4;
const SWEEP_SECONDS = 0.95;
const DISSOLVE_SECONDS = 0.3;
const PROBE_DRAW_SECONDS = 0.2;
const PROBE_FADE_SECONDS = 0.16;
/** Front shapes in radians of arc. */
const SWEEP_UNEVEN = 0.05;
const PING_WIDTH = 0.07;

const POP_KEYFRAMES: Keyframe[] = [
  { scale: "1", easing: "cubic-bezier(.2,1.5,.4,1)" },
  { scale: "1.7", offset: 0.35, easing: "cubic-bezier(.3,0,.3,1)" },
  { scale: "1" },
];
const DROP_KEYFRAMES: Keyframe[] = [
  { scale: "1", easing: "ease-out" },
  { scale: "0.45", offset: 0.3, easing: "cubic-bezier(.2,1.4,.4,1)" },
  { scale: "1" },
];

/** Demo traffic: each demo city sends its weight × 1,000 requests. */
const DEMO_CLIENTS: readonly CatchmentClient[] = DEMO_CITIES.map((city) => ({
  lat: city.lat,
  lon: city.lon,
  weight: city.weight * 1000,
}));
const NO_CLIENTS: readonly CatchmentClient[] = [];

/* Model ------------------------------------------------------------------------------------------------------ */

/** The sites in service, with unit vectors and stretches, for assigning places to sites. */
interface SiteModel {
  readonly sitesKey: string;
  readonly activeKey: string;
  readonly sites: readonly CatchmentSite[];
  /** 1 for sites in service. */
  readonly active: Uint8Array;
  readonly activeCount: number;
  /** Unit vectors, three numbers per site. */
  readonly vectors: Float64Array;
  readonly stretch: Float64Array;
}

const siteKeyOf = (sites: readonly CatchmentSite[]) =>
  sites.map((site) => [site.id, site.label, site.lat, site.lon, site.stretch ?? ""].join("\u0001")).join("\u0002");

function createModel(
  input: readonly CatchmentSite[],
  activeIds: readonly string[] | undefined,
  sitesKey: string,
  activeKey: string,
): SiteModel {
  // skip sites without a usable position and repeated ids
  const seen = new Set<string>();
  const sites = input.filter((site) => {
    if (!Number.isFinite(site.lat) || !Number.isFinite(site.lon) || seen.has(site.id)) return false;
    seen.add(site.id);
    return true;
  });
  const wanted = activeIds ? new Set(activeIds) : null;
  const active = new Uint8Array(sites.length);
  const vectors = new Float64Array(sites.length * 3);
  const stretch = new Float64Array(sites.length);
  const vector: Vec3 = [0, 0, 0];
  let activeCount = 0;
  sites.forEach((site, k) => {
    latLonToVector(clamp(site.lat, -90, 90), site.lon, vector);
    vectors.set(vector, k * 3);
    stretch[k] = site.stretch !== undefined && site.stretch > 0 ? site.stretch : DEFAULT_STRETCH;
    if (!wanted || wanted.has(site.id)) {
      active[k] = 1;
      activeCount++;
    }
  });
  return { sitesKey, activeKey, sites, active, activeCount, vectors, stretch };
}

/**
 * Index of the site in service that serves a unit vector, or -1 when none is in service. `distance` takes the
 * largest dot product (the nearest site), `latency` the smallest arc × stretch.
 */
function ownerOf(model: SiteModel, metric: CatchmentMetric, x: number, y: number, z: number) {
  let best = -1;
  let bestScore = Infinity;
  const vectors = model.vectors;
  for (let k = 0; k < model.sites.length; k++) {
    if (model.active[k] === 0) continue;
    const dot = clamp(x * vectors[k * 3] + y * vectors[k * 3 + 1] + z * vectors[k * 3 + 2], -1, 1);
    const score = metric === "latency" ? Math.acos(dot) * model.stretch[k] : -dot;
    if (score < bestScore) {
      bestScore = score;
      best = k;
    }
  }
  return best;
}

/** Arc in radians between a site and a unit vector. */
function siteAngle(model: SiteModel, site: number, x: number, y: number, z: number) {
  const vectors = model.vectors;
  return Math.acos(clamp(x * vectors[site * 3] + y * vectors[site * 3 + 1] + z * vectors[site * 3 + 2], -1, 1));
}

/** Requests per site from the clients, with the request-weighted estimated round trip. */
interface Traffic {
  readonly requests: Float64Array;
  /** Mean estimated round trip of each site's clients in ms, NaN without clients. */
  readonly rtt: Float64Array;
  /** Requests answered by any site. */
  readonly served: number;
  readonly meanRtt: number;
  readonly hasClients: boolean;
}

function computeTraffic(model: SiteModel, clients: readonly CatchmentClient[], metric: CatchmentMetric): Traffic {
  const count = model.sites.length;
  const requests = new Float64Array(count);
  const weighted = new Float64Array(count);
  const vector: Vec3 = [0, 0, 0];
  let served = 0;
  let total = 0;
  for (const client of clients) {
    if (!Number.isFinite(client.lat) || !Number.isFinite(client.lon) || !(client.weight > 0)) continue;
    latLonToVector(client.lat, client.lon, vector);
    const owner = ownerOf(model, metric, vector[0], vector[1], vector[2]);
    if (owner < 0) continue;
    const rtt = fiberRttMs(distanceKm(client, model.sites[owner]), model.stretch[owner]);
    requests[owner] += client.weight;
    weighted[owner] += client.weight * rtt;
    served += client.weight;
    total += client.weight * rtt;
  }
  const rtt = new Float64Array(count);
  for (let k = 0; k < count; k++) rtt[k] = requests[k] > 0 ? weighted[k] / requests[k] : Number.NaN;
  return { requests, rtt, served, meanRtt: served > 0 ? total / served : Number.NaN, hasClients: clients.length > 0 };
}

const shareText = (requests: number, served: number) => (served > 0 ? `${Math.round((requests / served) * 100)}%` : MISSING);

const rttText = (ms: number) => (Number.isFinite(ms) ? `~${formatMs(ms)}` : MISSING);

function readoutOf(model: SiteModel, traffic: Traffic, selected: number): Reading {
  const site = selected >= 0 ? model.sites[selected] : undefined;
  if (site) {
    const on = model.active[selected] === 1;
    const requests = traffic.requests[selected];
    return {
      name: site.label,
      status: on ? "In service" : "Out of service",
      tone: on ? "accent" : "off",
      share: traffic.served > 0 ? requests / traffic.served : Number.NaN,
      shareText: shareText(requests, traffic.served),
      requests: traffic.hasClients ? requests : Number.NaN,
      requestsText: traffic.hasClients ? formatCompact(requests) : MISSING,
      rtt: traffic.rtt[selected],
      rttText: rttText(traffic.rtt[selected]),
    };
  }
  const count = model.sites.length;
  const none = count > 0 && model.activeCount === 0;
  return {
    name: "All sites",
    status: count === 0 ? "No sites" : none ? "No site in service" : `${model.activeCount} of ${count} in service`,
    tone: none ? "off" : "plain",
    share: traffic.served > 0 ? 1 : Number.NaN,
    shareText: traffic.served > 0 ? "100%" : MISSING,
    requests: traffic.hasClients ? traffic.served : Number.NaN,
    requestsText: traffic.hasClients ? formatCompact(traffic.served) : MISSING,
    rtt: traffic.meanRtt,
    rttText: rttText(traffic.meanRtt),
  };
}

function markerLabel(site: CatchmentSite, on: boolean, traffic: Traffic, index: number) {
  if (!on) return `${site.label}, off`;
  if (traffic.served <= 0) return site.label;
  return `${site.label}, serves ${shareText(traffic.requests[index], traffic.served)}`;
}

/** What the live region last reported, to describe the next service change. */
interface Heard {
  sitesKey: string;
  activeKey: string;
  active: Uint8Array;
  requests: Float64Array;
  text: string;
}

/** "Frankfurt off. London now serves 38%." The site that gained the most requests is named. */
function describeChange(previous: Heard, model: SiteModel, traffic: Traffic) {
  if (previous.sitesKey !== model.sitesKey) return "";
  const changes: string[] = [];
  model.sites.forEach((site, k) => {
    if (previous.active[k] !== model.active[k]) changes.push(`${site.label} ${model.active[k] ? "on" : "off"}.`);
  });
  if (changes.length === 0) return previous.text;
  if (model.activeCount === 0) return `${changes.join(" ")} No site in service.`;
  let gainer = -1;
  let gain = 0;
  for (let k = 0; k < model.sites.length; k++) {
    const delta = traffic.requests[k] - previous.requests[k];
    if (model.active[k] && delta > gain) {
      gain = delta;
      gainer = k;
    }
  }
  if (gainer < 0 || traffic.served <= 0) return changes.join(" ");
  const share = shareText(traffic.requests[gainer], traffic.served);
  return `${changes.join(" ")} ${model.sites[gainer].label} now serves ${share}.`;
}

/** Marker positions in percent from a render-time projection, the outline path and which labels sit on the left. */
function nominalLayout(kind: CatchmentProjection, sites: readonly CatchmentSite[]) {
  const aspect = projectionAspect(kind, LAT_RANGE);
  const height = NOMINAL_WIDTH / aspect;
  const projection = createProjection(kind, { width: NOMINAL_WIDTH, height, latRange: LAT_RANGE });
  const point = createScreenPoint();
  const points = sites.map((site) => {
    projection.project(clamp(site.lat, LAT_RANGE[0], LAT_RANGE[1]), site.lon, point);
    return { x: point.x, y: point.y };
  });
  return {
    aspect,
    height,
    outline: projectionOutlineSvgPath(projection),
    points,
    percent: points.map((p) => ({
      left: percent(p.x / NOMINAL_WIDTH),
      top: percent(p.y / height),
    })),
  };
}

type LabelSide = "right" | "left" | "top" | "bottom";

/** Width of one character of the 10.5 px mono marker labels. */
const LABEL_CHAR = 6.3;
const LABEL_HEIGHT = 14;

/**
 * The side of its marker each label goes on: the first of right, left, top and bottom that stays inside the map and
 * clears the other markers. Before the map is measured (on the server) labels in the right fifth go left.
 */
function labelSides(
  model: SiteModel,
  layout: ReturnType<typeof nominalLayout>,
  size: { width: number; height: number } | null,
): LabelSide[] {
  if (!size) return layout.points.map((p) => (p.x > NOMINAL_WIDTH * 0.8 ? "left" : "right"));
  const scale = size.width / NOMINAL_WIDTH;
  const points = layout.points.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  return model.sites.map((site, i) => {
    const gap = model.active[i] === 1 ? 7 : 16;
    const anchors = points.map((p, k) => ({
      x: p.x,
      y: p.y,
      width: k === i ? site.label.length * LABEL_CHAR + 4 : 0,
      height: k === i ? LABEL_HEIGHT : 0,
      priority: k === i ? 1 : 0,
      // other markers take room too: their dot and ring
      gap: k === i ? gap : 0,
    }));
    const placement = placeLabels(anchors, size.width, size.height)[i];
    return placement.visible ? placement.side : "right";
  });
}

const LABEL_SIDES: Record<LabelSide, readonly [on: string, off: string]> = {
  right: ["top-1/2 left-[19px] -translate-y-1/2", "top-1/2 left-[28px] -translate-y-1/2"],
  left: ["top-1/2 right-[19px] -translate-y-1/2", "top-1/2 right-[28px] -translate-y-1/2"],
  top: ["bottom-[19px] left-1/2 -translate-x-1/2", "bottom-[28px] left-1/2 -translate-x-1/2"],
  bottom: ["top-[19px] left-1/2 -translate-x-1/2", "top-[28px] left-1/2 -translate-x-1/2"],
};

const labelClass = (side: LabelSide | undefined, on: boolean) => LABEL_SIDES[side ?? "right"][on ? 0 : 1];

/* Engine ----------------------------------------------------------------------------------------------------- */

/** Neighbouring dots within 1.5 pitches, as offsets into one list. */
interface Neighbours {
  readonly offsets: Int32Array;
  readonly list: Int32Array;
}

interface Batches {
  /** Hole, other catchments and their borders: land → landStrong → foreground. */
  readonly ink: DotBatch;
  /** The selected catchment: accent, toward the shine where the selection ring passes. */
  readonly accent: DotBatch;
  /** Switch flashes. */
  readonly flash: DotBatch;
  /** The outage wave and the halos of sites that are off. */
  readonly alarm: DotBatch;
}

interface Probe {
  visible: boolean;
  /** Map px. */
  x: number;
  y: number;
  owner: number;
  paths: ArcLengthTable[];
  /** When the line started drawing on, in s. */
  start: number;
  hiddenAt: number;
}

/** Everything the frame loop mutates. Lives in a ref, never in React state. */
interface Engine {
  kind: CatchmentProjection;
  pitch: number;
  projection: MapProjection | null;
  lattice: DotLattice | null;
  /** Unit vectors of the lattice dots. */
  vectors: Float32Array | null;
  neighbours: Neighbours | null;
  dpr: number;
  /** Sites on the canvas, two numbers per site. */
  sitePoints: Float32Array;
  /** Checker halo dots around each site (every other lattice position from 8 to 14 px), two numbers per dot. */
  halos: Float32Array[];
  /** 0 or 1 per site, so neighbouring catchments differ in density. */
  tones: Uint8Array;

  model: SiteModel | null;
  metric: CatchmentMetric;
  assigned: boolean;
  /** The site each dot belongs to (or -1), and what it showed before the current transition. */
  owner: Int16Array;
  from: Int16Array;
  /** When a dot drops out (the outage wave) and when it takes its new owner, in s. */
  holeAt: Float64Array;
  switchAt: Float64Array;
  /** What each dot shows this frame, and whether it borders another catchment. */
  shown: Int16Array;
  edge: Uint8Array;
  /** Scratch: the arc from each moving dot to its new site. */
  angle: Float32Array;
  next: Int16Array;
  transitionEnd: number;
  flashStrength: number;
  introPending: boolean;
  introDone: boolean;

  selected: number;
  previous: number;
  selectStart: number;
  /** Largest arc from the selected site to its catchment, -1 until measured. */
  selectReach: number;
  hover: number;

  ink: GeoInk | null;
  inkStale: boolean;
  batches: Batches | null;
  dirty: boolean;
  wasLive: boolean;

  sparks: Sparks;
  probe: Probe;
}

function createEngine(kind: CatchmentProjection, pitch: number): Engine {
  return {
    kind,
    pitch,
    projection: null,
    lattice: null,
    vectors: null,
    neighbours: null,
    dpr: 1,
    sitePoints: new Float32Array(0),
    halos: [],
    tones: new Uint8Array(0),
    model: null,
    metric: "distance",
    assigned: false,
    owner: new Int16Array(0),
    from: new Int16Array(0),
    holeAt: new Float64Array(0),
    switchAt: new Float64Array(0),
    shown: new Int16Array(0),
    edge: new Uint8Array(0),
    angle: new Float32Array(0),
    next: new Int16Array(0),
    transitionEnd: 0,
    flashStrength: 0.8,
    introPending: false,
    introDone: false,
    selected: UNSET,
    previous: -1,
    selectStart: -Infinity,
    selectReach: -1,
    hover: -1,
    ink: null,
    inkStale: true,
    batches: null,
    dirty: true,
    wasLive: false,
    sparks: new Sparks(),
    probe: { visible: false, x: 0, y: 0, owner: -1, paths: [], start: 0, hiddenAt: -Infinity },
  };
}

const neighbourCache = new WeakMap<DotLattice, Neighbours>();

function neighboursOf(lattice: DotLattice): Neighbours {
  const cached = neighbourCache.get(lattice);
  if (cached) return cached;
  const offsets = new Int32Array(lattice.count + 1);
  const list: number[] = [];
  const radius = lattice.pitch * 1.5;
  for (let i = 0; i < lattice.count; i++) {
    lattice.grid.query(lattice.x[i], lattice.y[i], radius, (j) => {
      if (j !== i) list.push(j);
    });
    offsets[i + 1] = list.length;
  }
  const neighbours = { offsets, list: Int32Array.from(list) };
  neighbourCache.set(lattice, neighbours);
  return neighbours;
}

/** Projection and lattice for the canvas size; a new lattice gets a fresh assignment. */
function layoutMap(state: Engine, surface: CanvasSurface) {
  const projection = createProjection(state.kind, { width: surface.width, height: surface.height, latRange: LAT_RANGE });
  const lattice = mapLattice(projection, { pitch: state.pitch });
  state.projection = projection;
  state.dpr = surface.dpr;
  state.dirty = true;
  placeSites(state);
  if (lattice === state.lattice) return;
  state.lattice = lattice;
  state.vectors = latticeVectors(lattice);
  state.neighbours = neighboursOf(lattice);
  const count = lattice.count;
  state.owner = new Int16Array(count);
  state.from = new Int16Array(count);
  state.holeAt = new Float64Array(count);
  state.switchAt = new Float64Array(count);
  state.shown = new Int16Array(count);
  state.edge = new Uint8Array(count);
  state.angle = new Float32Array(count);
  state.next = new Int16Array(count);
  state.assigned = false;
  if (state.model) assignFresh(state, performance.now() / 1000, prefersReducedMotion());
}

/** Site positions on the canvas and the checker halo around each (every other lattice position 8 to 14 px out). */
function placeSites(state: Engine) {
  const { projection, model } = state;
  if (!projection || !model) return;
  const count = model.sites.length;
  const points = new Float32Array(count * 2);
  const point = createScreenPoint();
  const pitch = state.pitch;
  const frame = projection.frame;
  state.halos = model.sites.map((site, k) => {
    projection.project(clamp(site.lat, LAT_RANGE[0], LAT_RANGE[1]), site.lon, point);
    points[k * 2] = point.x;
    points[k * 2 + 1] = point.y;
    const halo: number[] = [];
    const c0 = Math.floor((point.x - HALO_RADIUS - frame.x0) / pitch);
    const r0 = Math.floor((point.y - HALO_RADIUS - frame.y0) / pitch);
    const steps = Math.ceil((HALO_RADIUS * 2) / pitch) + 1;
    for (let r = r0; r <= r0 + steps; r++) {
      for (let c = c0; c <= c0 + steps; c++) {
        if ((((r + c) % 2) + 2) % 2 !== 0) continue;
        const x = frame.x0 + (c + 0.5) * pitch;
        const y = frame.y0 + (r + 0.5) * pitch;
        const d = Math.hypot(x - point.x, y - point.y);
        // leave the marker itself clear
        if (d <= HALO_RADIUS && d > 8) halo.push(x, y);
      }
    }
    return Float32Array.from(halo);
  });
  state.sitePoints = points;
}

/** Owner of every lattice dot for the current model and metric. */
function computeOwners(state: Engine, out: Int16Array) {
  const { lattice, vectors, model } = state;
  if (!lattice || !vectors || !model) return;
  for (let i = 0; i < lattice.count; i++) {
    out[i] = ownerOf(model, state.metric, vectors[i * 3], vectors[i * 3 + 1], vectors[i * 3 + 2]);
  }
}

/**
 * Tones for neighbouring catchments: a greedy two-colouring of the catchments with every site in service, weighted by
 * how long each pair's border is, so the density of neighbours differs wherever the map allows it. Stable while
 * sites go on and off.
 */
function computeTones(state: Engine) {
  const { lattice, vectors, neighbours, model } = state;
  if (!lattice || !vectors || !neighbours || !model) return;
  const count = model.sites.length;
  const everyone: SiteModel = { ...model, active: new Uint8Array(count).fill(1), activeCount: count };
  const owners = new Int16Array(lattice.count);
  for (let i = 0; i < lattice.count; i++) {
    owners[i] = ownerOf(everyone, state.metric, vectors[i * 3], vectors[i * 3 + 1], vectors[i * 3 + 2]);
  }
  const shared = new Float64Array(count * count);
  for (let i = 0; i < lattice.count; i++) {
    for (let k = neighbours.offsets[i]; k < neighbours.offsets[i + 1]; k++) {
      const a = owners[i];
      const b = owners[neighbours.list[k]];
      if (a >= 0 && b >= 0 && a !== b) shared[a * count + b]++;
    }
  }
  const order = model.sites.map((_, k) => k);
  const border = (k: number) => {
    let sum = 0;
    for (let j = 0; j < count; j++) sum += shared[k * count + j];
    return sum;
  };
  order.sort((a, b) => border(b) - border(a) || a - b);
  const tones = new Uint8Array(count);
  const done = new Uint8Array(count);
  for (const k of order) {
    const clash = [0, 0];
    for (let j = 0; j < count; j++) if (done[j]) clash[tones[j]] += shared[k * count + j];
    tones[k] = clash[1] < clash[0] ? 1 : 0;
    done[k] = 1;
  }
  state.tones = tones;
}

/** A new lattice or a new set of sites: assign every dot, and play the intro the first time. */
function assignFresh(state: Engine, now: number, reduced: boolean) {
  if (!state.lattice || !state.model) return;
  computeOwners(state, state.owner);
  computeTones(state);
  state.assigned = true;
  state.selectReach = -1;
  if (!state.introDone && !reduced) {
    // dark until the first visible frame starts the intro
    state.from.fill(-1);
    state.holeAt.fill(-Infinity);
    state.switchAt.fill(Infinity);
    state.introPending = true;
    return;
  }
  state.introPending = false;
  state.from.set(state.owner);
  state.holeAt.fill(Infinity);
  state.switchAt.fill(-Infinity);
  state.transitionEnd = now;
}

/** Every site grows its catchment from its own position at one speed, so the fronts meet at the borders. */
function startIntro(state: Engine, now: number, reduced: boolean) {
  const { lattice, vectors, model } = state;
  state.introPending = false;
  state.introDone = true;
  if (!lattice || !vectors || !model) return;
  if (reduced) {
    state.from.set(state.owner);
    state.holeAt.fill(Infinity);
    state.switchAt.fill(-Infinity);
    state.dirty = true;
    return;
  }
  let reach = 1e-6;
  for (let i = 0; i < lattice.count; i++) {
    const owner = state.owner[i];
    const angle = owner >= 0 ? siteAngle(model, owner, vectors[i * 3], vectors[i * 3 + 1], vectors[i * 3 + 2]) : 0;
    state.angle[i] = angle;
    reach = Math.max(reach, angle);
  }
  let end = now;
  for (let i = 0; i < lattice.count; i++) {
    state.from[i] = -1;
    state.holeAt[i] = -Infinity;
    const at = now + 0.12 + (state.angle[i] / reach) * INTRO_SECONDS + lattice.jitter[i] * JITTER_SECONDS;
    state.switchAt[i] = at;
    end = Math.max(end, at + FLASH_TAIL);
  }
  state.flashStrength = 0.5;
  state.transitionEnd = end;
}

/** What a dot shows at time t. */
const displayed = (state: Engine, i: number, t: number) =>
  t >= state.switchAt[i] ? state.owner[i] : t >= state.holeAt[i] ? -1 : state.from[i];

/**
 * The service list or the metric changed. Each dot whose owner changes is rescheduled from what it shows right now,
 * so a toggle during a transition carries on from the current state. A dot whose site went off drops out in a wave
 * from that site, then the new owner takes it when its front arrives: neighbours flood from their own side (all at
 * one speed), a site that came back reclaims from its centre.
 */
function retarget(state: Engine, now: number, wasActive: Uint8Array, reduced: boolean) {
  const { lattice, vectors, model } = state;
  if (!lattice || !vectors || !model) return;
  const count = lattice.count;
  const sites = model.sites.length;
  const next = state.next;
  computeOwners(state, next);
  state.introPending = false;
  state.introDone = true;
  state.selectReach = -1;
  if (reduced) {
    state.owner.set(next);
    state.from.set(next);
    state.holeAt.fill(Infinity);
    state.switchAt.fill(-Infinity);
    state.transitionEnd = now;
    return;
  }

  const floodMin = new Float64Array(sites).fill(Infinity);
  const floodMax = new Float64Array(sites).fill(-Infinity);
  const reclaimMax = new Float64Array(sites).fill(1e-6);
  const dieMax = new Float64Array(sites).fill(1e-6);
  const dieAngle = new Float32Array(count);
  const fromNow = new Int16Array(count);
  let anyDie = false;

  for (let i = 0; i < count; i++) {
    const target = next[i];
    fromNow[i] = displayed(state, i, now);
    // a dot heading for the same owner keeps its schedule (and its flash)
    if (target === state.owner[i]) continue;
    const vx = vectors[i * 3];
    const vy = vectors[i * 3 + 1];
    const vz = vectors[i * 3 + 2];
    const from = fromNow[i];
    if (from >= 0 && model.active[from] === 0) {
      dieAngle[i] = siteAngle(model, from, vx, vy, vz);
      dieMax[from] = Math.max(dieMax[from], dieAngle[i]);
      anyDie = true;
    }
    if (target < 0 || target === from) continue;
    const angle = siteAngle(model, target, vx, vy, vz);
    state.angle[i] = angle;
    if (wasActive[target] === 0) {
      reclaimMax[target] = Math.max(reclaimMax[target], angle);
    } else {
      floodMin[target] = Math.min(floodMin[target], angle);
      floodMax[target] = Math.max(floodMax[target], angle);
    }
  }
  let span = 1e-6;
  for (let k = 0; k < sites; k++) if (floodMax[k] >= floodMin[k]) span = Math.max(span, floodMax[k] - floodMin[k]);
  const floodStart = anyDie ? DIE_SECONDS + 0.1 : 0.05;

  let end = state.transitionEnd;
  for (let i = 0; i < count; i++) {
    const target = next[i];
    if (target === state.owner[i]) continue;
    const from = fromNow[i];
    const jitter = lattice.jitter[i];
    state.owner[i] = target;
    state.from[i] = from;
    if (target === from) {
      state.holeAt[i] = Infinity;
      state.switchAt[i] = -Infinity;
      continue;
    }
    const dies = from >= 0 && model.active[from] === 0;
    const holeAt = dies ? now + (dieAngle[i] / dieMax[from]) * DIE_SECONDS + jitter * 0.05 : from < 0 ? -Infinity : Infinity;
    let switchAt: number;
    if (target < 0) switchAt = dies ? holeAt : now;
    else if (wasActive[target] === 0) {
      switchAt = now + (state.angle[i] / reclaimMax[target]) * RECLAIM_SECONDS + jitter * JITTER_SECONDS;
    } else {
      const front = (state.angle[i] - floodMin[target]) / span;
      switchAt = now + floodStart + front * FLOOD_SECONDS + jitter * JITTER_SECONDS;
    }
    if (dies && target >= 0) switchAt = Math.max(switchAt, holeAt + 0.1);
    state.holeAt[i] = holeAt;
    state.switchAt[i] = switchAt;
    if (dies) end = Math.max(end, holeAt + DIE_TAIL);
    if (target >= 0) end = Math.max(end, switchAt + FLASH_TAIL);
  }
  state.flashStrength = 0.8;
  state.transitionEnd = end;
}

/** A site changed state: its marker pops (on) or drops (off), and sparks fly from it over the map's edge. */
function celebrate(state: Engine, site: number, on: boolean, marker: HTMLSpanElement | null | undefined) {
  if (prefersReducedMotion()) return;
  if (marker && typeof marker.animate === "function") {
    marker.animate(on ? POP_KEYFRAMES : DROP_KEYFRAMES, { duration: on ? 620 : 520 });
  }
  const ink = state.ink;
  if (!ink || site * 2 + 1 >= state.sitePoints.length) return;
  const x = state.sitePoints[site * 2] + FX;
  const y = state.sitePoints[site * 2 + 1] + FX;
  if (on) {
    state.sparks.add(x, y, 28, [ink.accent, ink.glint, ink.accent], {
      speed: [60, 230],
      life: [0.35, 0.85],
      drag: 3.2,
      jitter: 2,
    });
  } else {
    state.sparks.add(x, y, 14, [ink.destructive], {
      speed: [30, 120],
      life: [0.3, 0.7],
      angle: -Math.PI / 2,
      spread: Math.PI * 1.4,
      gravity: 320,
      drag: 2.5,
    });
  }
}

function createBatches(ink: GeoInk, previous: Batches | null): Batches {
  // light theme: the shine is a deep violet that stays visible on white; dark theme: white
  const flashColor = ink.shine;
  if (previous) {
    previous.ink.setRamp([ink.land, ink.landStrong, ink.foreground]);
    previous.accent.setRamp([ink.accent, flashColor]);
    previous.flash.setRamp([flashColor]);
    previous.alarm.setRamp([ink.destructive]);
    return previous;
  }
  return {
    ink: createDotBatch(4096, [ink.land, ink.landStrong, ink.foreground], { tones: 17 }),
    accent: createDotBatch(2048, [ink.accent, flashColor], { tones: 9 }),
    flash: createDotBatch(1024, [flashColor], { tones: 1 }),
    alarm: createDotBatch(512, [ink.destructive], { tones: 1 }),
  };
}

/** Adds a dot whose square lands on whole device pixels, so dots stay crisp. */
function addDot(batch: DotBatch, x: number, y: number, size: number, tone: number, alpha: number, dpr: number) {
  batch.add(snapCenter(x, size, dpr), snapCenter(y, size, dpr), size, tone, alpha);
}

/** The catchments: redrawn each frame during a transition, once when anything else changes. */
function drawMap(surface: CanvasSurface, state: Engine, t: number, reduced: boolean) {
  const { context, width, height, dpr } = surface;
  context.clearRect(0, 0, width, height);
  const { lattice, vectors, neighbours, model, ink, batches, projection } = state;
  if (!lattice || !vectors || !neighbours || !model || !ink || !batches || !projection) return;
  const count = lattice.count;

  // a hairline coast under the dots keeps the shapes crisp where the lattice is coarse
  context.globalAlpha = ink.dark ? 0.14 : 0.12;
  context.strokeStyle = rgba(ink.coast);
  context.lineWidth = 0.75;
  context.lineJoin = "round";
  context.stroke(coastlinePath(projection));
  context.globalAlpha = 1;

  const shown = state.shown;
  const selectedNow = state.selected;
  for (let i = 0; i < count; i++) shown[i] = displayed(state, i, t);
  const { offsets, list } = neighbours;
  for (let i = 0; i < count; i++) {
    const s = shown[i];
    let edge = 0;
    if (s >= 0) {
      for (let k = offsets[i]; k < offsets[i + 1]; k++) {
        const other = shown[list[k]];
        if (other === s) continue;
        // one dot wide: the selected catchment outlines itself, other borders go to the lower index, holes always
        if (other < 0 || s === selectedNow || (other !== selectedNow && other > s)) {
          edge = 1;
          break;
        }
      }
    }
    state.edge[i] = edge;
  }

  // the selection sweep: the accent spreads from the site, a ring of light at its front
  const selected = state.selected;
  const previous = state.previous;
  const elapsed = reduced ? Infinity : t - state.selectStart;
  const sweeping = selected >= 0 && elapsed < SWEEP_SECONDS + 0.1;
  if (sweeping && state.selectReach < 0) state.selectReach = catchmentReach(state, selected);
  const sweep = clamp(elapsed / SWEEP_SECONDS, 0, 1);
  const radius = sweeping ? (state.selectReach + 0.12) * (1 - (1 - sweep) * (1 - sweep)) : Infinity;
  const pingFade = sweeping ? 1 - smoothstep(0.55, 1.1, elapsed / SWEEP_SECONDS) : 0;
  const dissolve = clamp(elapsed / DISSOLVE_SECONDS, 0, 1);

  for (let i = 0; i < count; i++) {
    const s = shown[i];
    const x = lattice.x[i];
    const y = lattice.y[i];
    const jitter = lattice.jitter[i];
    if (s < 0) {
      addDot(batches.ink, x, y, DOT, 0, HOLE_ALPHA, dpr);
    } else {
      const edge = state.edge[i] === 1;
      let lit = s === selected;
      let ping = 0;
      if (lit && sweeping) {
        const angle = siteAngle(model, s, vectors[i * 3], vectors[i * 3 + 1], vectors[i * 3 + 2]);
        lit = angle + jitter * SWEEP_UNEVEN < radius;
        ping = ringFront(angle, radius, PING_WIDTH, jitter, SWEEP_UNEVEN) * pingFade;
      } else if (!lit && s === previous && previous !== selected) {
        // the old selection dissolves dot by dot
        lit = lattice.density[i] > dissolve;
      }
      if (lit) {
        const alpha = edge ? 1 : Math.min(1, ACCENT_ALPHA + ping * 0.25);
        addDot(batches.accent, x, y, edge ? EDGE_DOT : DOT, ping * 0.85, alpha, dpr);
        if (ping > 0.08) addDot(batches.flash, x, y, FLASH_DOT, 0, ping * 0.55, dpr);
      } else {
        const lift = s === state.hover ? HOVER_LIFT : 0;
        if (edge) addDot(batches.ink, x, y, DOT, 1, Math.min(1, EDGE_ALPHA + lift), dpr);
        else addDot(batches.ink, x, y, DOT, 0.5, TONE_ALPHAS[state.tones[s] ?? 0] + lift, dpr);
      }
    }
    // the outage wave
    const dieAge = t - state.holeAt[i];
    if (dieAge >= 0 && dieAge < DIE_TAIL && t < state.switchAt[i]) {
      addDot(batches.alarm, x, y, EDGE_DOT, 0, 0.75 * Math.exp(-dieAge / DIE_DECAY), dpr);
    }
    // a dot flashes as its new owner takes it
    const age = t - state.switchAt[i];
    if (age >= 0 && age < FLASH_TAIL && s >= 0) {
      addDot(batches.flash, x, y, FLASH_DOT, 0, state.flashStrength * Math.exp(-age / FLASH_DECAY), dpr);
    }
  }

  // sites that are off carry a static checker halo
  for (let k = 0; k < model.sites.length; k++) {
    if (model.active[k] === 1) continue;
    const halo = state.halos[k];
    if (!halo) continue;
    for (let j = 0; j < halo.length; j += 2) addDot(batches.alarm, halo[j], halo[j + 1], DOT, 0, 0.7, dpr);
  }

  batches.ink.flush(context);
  batches.accent.flush(context);
  batches.alarm.flush(context);
  batches.flash.flush(context);
}

/** Largest arc from a site to a dot of its catchment. */
function catchmentReach(state: Engine, site: number) {
  const { lattice, vectors, model } = state;
  if (!lattice || !vectors || !model) return 0;
  let reach = 0;
  for (let i = 0; i < lattice.count; i++) {
    if (state.owner[i] !== site) continue;
    reach = Math.max(reach, siteAngle(model, site, vectors[i * 3], vectors[i * 3 + 1], vectors[i * 3 + 2]));
  }
  return reach;
}

/* Probe and effects ---------------------------------------------------------------------------------------- */

const probeVector: Vec3 = [0, 0, 0];

/** Points the probe at map px (x, y). Returns what the chip shows, or null outside the map. */
function aimProbe(state: Engine, x: number, y: number, now: number) {
  const { projection, model } = state;
  if (!projection || !model || model.sites.length === 0) return null;
  const point = projection.invert(x, y);
  if (!point) return null;
  latLonToVector(point.lat, point.lon, probeVector);
  const owner = ownerOf(model, state.metric, probeVector[0], probeVector[1], probeVector[2]);
  const probe = state.probe;
  if (!probe.visible || probe.owner !== owner) probe.start = now;
  probe.visible = true;
  probe.owner = owner;
  probe.x = x;
  probe.y = y;
  const site = owner >= 0 ? model.sites[owner] : undefined;
  probe.paths = site ? flatPaths(projection, point, site, { bend: 0.1 }) : [];
  return {
    owner,
    label: site ? site.label : "No site in service",
    rtt: site ? rttText(fiberRttMs(distanceKm(point, site), model.stretch[owner])) : "",
  };
}

/** Hides the probe line and chip. Returns whether it was showing. */
function retireProbe(state: Engine, chip: HTMLDivElement | null) {
  const probe = state.probe;
  if (!probe.visible) return false;
  probe.visible = false;
  probe.hiddenAt = performance.now() / 1000;
  probe.owner = -1;
  if (chip) chip.dataset.visible = "false";
  return true;
}

/** The probe line and the sparks, on the canvas that reaches past the map. Returns whether anything moves. */
function drawEffects(surface: CanvasSurface, state: Engine, t: number, delta: number, reduced: boolean) {
  const { context, width, height, dpr } = surface;
  context.clearRect(0, 0, width, height);
  const ink = state.ink;
  if (!ink) return false;
  let live = false;
  const probe = state.probe;
  const fade = probe.visible ? 1 : reduced ? 0 : clamp(1 - (t - probe.hiddenAt) / PROBE_FADE_SECONDS, 0, 1);
  if (fade > 0 && state.projection) {
    const progress = reduced ? 1 : easeOutCubic((t - probe.start) / PROBE_DRAW_SECONDS);
    live = progress < 1 || fade < 1;
    const { width: mapWidth, height: mapHeight } = state.projection;
    context.save();
    context.translate(FX, FX);
    // seam copies of the line stay inside the map
    context.beginPath();
    context.rect(-1, -1, mapWidth + 2, mapHeight + 2);
    context.clip();
    context.fillStyle = rgba(ink.accent);
    for (const table of probe.paths) {
      const end = table.length * progress;
      context.globalAlpha = 0.6 * fade;
      forEachDot(table, 3.5, 0, end, (x, y) => {
        context.fillRect(Math.round((x - 0.75) * dpr) / dpr, Math.round((y - 0.75) * dpr) / dpr, DOT, DOT);
      });
    }
    // the spot being probed
    context.globalAlpha = 0.9 * fade;
    context.strokeStyle = rgba(ink.accent);
    context.lineWidth = 1;
    context.beginPath();
    context.arc(probe.x, probe.y, 4.5, 0, Math.PI * 2);
    context.stroke();
    context.fillRect(Math.round((probe.x - 1) * dpr) / dpr, Math.round((probe.y - 1) * dpr) / dpr, 2, 2);
    context.restore();
  }
  context.globalAlpha = 1;
  if (state.sparks.step(context, delta)) live = true;
  return live;
}
