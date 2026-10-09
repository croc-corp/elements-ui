"use client";

import * as React from "react";

import { snapCenter, useCanvas, type CanvasSurface } from "@/lib/lumesec/canvas";
import { usePalette } from "@/lib/lumesec/color";
import {
  bakeLattice,
  buildArcLength,
  createProjection,
  createScreenPoint,
  distanceKm,
  flatCurve,
  forEachDot,
  GEO_TOKENS,
  geoInk,
  isValidLatLon,
  mapLattice,
  placeLabels,
  pointAtDistance,
  quadPoint,
  resampleArcLength,
  ringFront,
  type ArcLengthTable,
  type DotLattice,
  type GeoInk,
  type GeoPalette,
  type LabelAnchor,
  type LatLon,
  type MapProjection,
  type QuadCurve,
} from "@/lib/lumesec/geo";
import { createRandom, demoLatency, formatNumber } from "@/lib/lumesec/geo-data";
import {
  clamp,
  easeOutCubic,
  hash,
  lerp,
  mixRgb,
  percent,
  rgba,
  smoothstep,
  stringHash,
  type RGB,
} from "@/lib/lumesec/math";
import {
  prefersReducedMotion,
  settleSpring,
  useAnimationLoop,
  useInView,
  useLazyRef,
  useReducedMotion,
  type Spring,
} from "@/lib/lumesec/motion";
import { RollText } from "@/lib/lumesec/roll-text";
import { Sparks } from "@/lib/lumesec/sparks";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** A device of the private network: this device, or one of the peers it connects to. */
export interface MeshDevice {
  /** Unique id. `MeshPath.peer` refers to it. */
  readonly id: string;
  /** Name in the header, the list and the accessible names ("Build server"). */
  readonly label: string;
  /** Where the device is, shown under its name and read in its accessible name ("Milan"). */
  readonly location?: string;
  /** Latitude in degrees. */
  readonly lat: number;
  /** Longitude in degrees. */
  readonly lon: number;
}

/** A relay server that forwards the traffic of a connection when a direct path cannot be opened. */
export interface MeshRelay {
  /** Unique short id, shown on the map and in the row chip ("lhr"). `MeshPath.relay` refers to it. */
  readonly id: string;
  /** Name in the detail line and the accessible names ("London"). */
  readonly label: string;
  /** Latitude in degrees. */
  readonly lat: number;
  /** Longitude in degrees. */
  readonly lon: number;
}

/** How this device currently reaches one peer. */
export interface MeshPath {
  /** Id of the peer. */
  readonly peer: string;
  /** Id of the relay the connection runs through, or null when it is direct. */
  readonly relay: string | null;
  /** Round-trip latency in milliseconds. */
  readonly ms: number;
  /** Traffic from 0 to 1. Sets the rate of the packets drawn along the path; without it they run at the base rate. */
  readonly traffic?: number;
}

/** Props of GeoMesh. The remaining props go to the root `<div>`. */
export interface GeoMeshProps extends Omit<React.ComponentProps<"div">, "defaultValue"> {
  /**
   * This device: every path starts here and the header names it. A demo laptop in Amsterdam is used only while
   * `device`, `peers`, `relays` and `paths` are all undefined.
   */
  device?: MeshDevice;
  /** The other devices of the network. Six demo peers are used only while every data prop is undefined. */
  peers?: readonly MeshDevice[];
  /** The relay servers. Three demo relays (`lhr`, `iad`, `waw`) are used only while every data prop is undefined. */
  relays?: readonly MeshRelay[];
  /**
   * The current path to each peer. A peer without a path is offline. While every data prop is undefined the component
   * runs a seeded demo: the peers start relayed and become direct one by one.
   */
  paths?: readonly MeshPath[];
  /** The selected peer id (controlled), or null for none. Use with `onValueChange`. */
  value?: string | null;
  /** The peer selected at first when uncontrolled. */
  defaultValue?: string | null;
  /** Called with the peer id when a peer is selected, and with null when the selection is cleared. */
  onValueChange?: (value: string | null) => void;
  /**
   * Runs the demo upgrades and fallbacks while the map is on screen. False shows the demo settled: every peer direct
   * except the phone. Has no effect once any data prop is given.
   */
  live?: boolean;
  /** Accessible name of the map. Its `aria-label` adds the device name and the number of direct and relayed peers. */
  label?: string;
}

/**
 * The devices of a private network and how this device reaches each of them, on a dotted map fitted to the network,
 * with the peers listed beside it. A direct connection is a single dotted line in the accent colour; a relayed one runs
 * as two grey dashed legs through its relay server. Packets travel both ways, outbound in the accent colour and inbound
 * in the info colour.
 *
 * When a relayed connection becomes direct, two probes run toward each other along the direct line; where they meet
 * the dots flash, the path lets go of the relay and straightens on an under-damped spring, a few sparks leave the
 * relay, and the row's chip and latency roll to the new values. A connection that falls back bends back through its
 * relay, tinted in the warning colour for a moment.
 *
 * @example
 * <GeoMesh
 *   device={{ id: "laptop", label: "Work laptop", lat: 52.37, lon: 4.9 }}
 *   peers={[{ id: "build", label: "Build server", location: "Milan", lat: 45.46, lon: 9.19 }]}
 *   relays={[{ id: "lhr", label: "London", lat: 51.51, lon: -0.13 }]}
 *   paths={[{ peer: "build", relay: null, ms: 13, traffic: 0.6 }]}
 * />
 */
export function GeoMesh({
  device,
  peers,
  relays,
  paths,
  value,
  defaultValue = null,
  onValueChange,
  live = true,
  label = "Mesh connections",
  className,
  onKeyDown,
  ...props
}: GeoMeshProps) {
  // demo data only while no data at all is given, so nothing invented mixes with real devices
  const demo = device === undefined && peers === undefined && relays === undefined && paths === undefined;
  const reducedMotion = useReducedMotion();

  const cardRef = React.useRef<HTMLDivElement>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const baseRef = React.useRef<HTMLCanvasElement>(null);
  const pathsRef = React.useRef<HTMLCanvasElement>(null);
  const fxRef = React.useRef<HTMLCanvasElement>(null);
  const liveRef = React.useRef<HTMLSpanElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const rowRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const markerRefs = React.useRef(new Map<string, HTMLSpanElement>());
  /** Everything the loop mutates, created on first use (never during render). */
  const engineRef = useLazyRef(() => createEngine());
  const inView = useInView(cardRef, "80px");

  // The demo clock advances from event to event while the demo is on screen.
  const [demoTime, setDemoTime] = React.useState(0);
  const demoRunning = demo && live && inView;
  React.useEffect(() => {
    if (!demoRunning) return;
    const next = nextDemoEvent(demoTime);
    const timer = window.setTimeout(() => setDemoTime(next), next - demoTime);
    return () => window.clearTimeout(timer);
  }, [demoRunning, demoTime]);

  const demoPaths = React.useMemo(
    () => (demo ? createDemoPaths(demoDirectSet(live ? demoTime : DEMO_SETTLED_MS)) : NO_PATHS),
    [demo, live, demoTime],
  );
  const model = React.useMemo(
    () =>
      demo
        ? resolveModel(DEMO_DEVICE, DEMO_PEERS, DEMO_RELAYS, demoPaths)
        : resolveModel(device, peers ?? NO_PEERS, relays ?? NO_RELAYS, paths ?? NO_PATHS),
    [demo, demoPaths, device, peers, relays, paths],
  );
  const view = React.useMemo(() => fitView(model), [model]);
  const layout = React.useMemo(() => markerLayout(model, view), [model, view]);

  const [selection, setSelection] = useControllableState<string | null>({
    value,
    defaultValue,
    onChange: onValueChange,
  });
  const selectedId = selection !== null && model.peerById.has(selection) ? selection : null;

  // An upgrade keeps showing the relayed values in the list until the path lets go of its relay on the map.
  const animateChanges = !reducedMotion && inView;
  const [holds, setHolds] = React.useState<HoldState>(() => ({ model, held: NO_HOLDS }));
  if (holds.model !== model) setHolds({ model, held: nextHolds(holds, model, animateChanges) });
  const release = React.useCallback((id: string) => {
    setHolds((state) => {
      if (!state.held.has(id)) return state;
      const held = new Map(state.held);
      held.delete(id);
      return { model: state.model, held };
    });
  }, []);

  const rows = React.useMemo(() => model.peers.map((peer) => rowView(peer, holds.held)), [model, holds.held]);
  const counts = React.useMemo(() => countRows(rows), [rows]);
  const statuses = React.useMemo(() => rowStatuses(rows), [rows]);

  /** The row that holds the roving tab stop; -1 follows the selection. */
  const [focusIndex, setFocusIndex] = React.useState(-1);
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);
  /** Width of the map box in CSS px, for label placement; the server assumes the nominal width. */
  const [boxWidth, setBoxWidth] = React.useState(NOMINAL_BOX_WIDTH);

  const loop = useAnimationLoop(cardRef, step);
  const palette = usePalette(cardRef, GEO_TOKENS, () => {
    engineRef.current.inkStale = true;
    loop.kick();
  });
  const base = useCanvas(
    baseRef,
    () => {
      // resizing the backing store clears it, so the lattice is baked again
      engineRef.current.baked = false;
      loop.kick();
    },
    CANVAS_OPTIONS,
  );
  const pathLayer = useCanvas(
    pathsRef,
    () => {
      engineRef.current.pathsDirty = true;
      loop.kick();
    },
    CANVAS_OPTIONS,
  );
  const fx = useCanvas(fxRef, () => loop.kick(), CANVAS_OPTIONS);

  React.useEffect(() => {
    engineRef.current.onRelease = release;
  }, [release, engineRef]);

  React.useEffect(() => {
    engineRef.current.visible = inView;
  }, [inView, engineRef]);

  // Paths follow the data: upgrades probe and let go of their relay, fallbacks bend back through it.
  React.useEffect(() => {
    syncEngine(engineRef.current, model, view, performance.now() / 1000);
    loop.kick();
  }, [model, view, loop, engineRef]);

  // A new selection keeps its path lit and sends a pulse along it from this device.
  React.useEffect(() => {
    const engine = engineRef.current;
    if (engine.selected === selectedId) return;
    engine.selected = selectedId;
    engine.pathsDirty = true;
    const track = selectedId === null ? undefined : engine.tracks.get(selectedId);
    if (track && !prefersReducedMotion()) track.pulseStart = performance.now() / 1000;
    const marker = selectedId === null ? undefined : markerRefs.current.get(selectedId);
    if (marker && !prefersReducedMotion() && typeof marker.animate === "function") {
      marker.animate(MARKER_POP, { duration: 480, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
    loop.kick();
  }, [selectedId, loop, engineRef]);

  // Reduced motion drops packets and finishes every transition; restart the loop so it redraws once.
  React.useEffect(() => {
    engineRef.current.pathsDirty = true;
    loop.kick();
  }, [reducedMotion, loop, engineRef]);

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

  // Path changes are announced politely, at most every 5 s; changes in between are collected.
  const announcer = React.useRef<Announcer>({ last: new Map(), pending: [], time: -Infinity, timer: 0 });
  React.useEffect(() => {
    const state = announcer.current;
    const first = state.last.size === 0;
    for (const [id, status] of statuses) {
      const before = state.last.get(id);
      if (!first && before && before.key !== status.key) state.pending.push(status.message);
    }
    state.last = statuses;
    if (state.pending.length === 0 || state.timer) return;
    const flush = () => {
      state.timer = 0;
      state.time = performance.now();
      const messages = state.pending.splice(0);
      const node = liveRef.current;
      if (node) node.textContent = messages.slice(-3).join(" ");
    };
    const wait = state.time + ANNOUNCE_MS - performance.now();
    if (wait <= 0) flush();
    else state.timer = window.setTimeout(flush, wait);
  }, [statuses]);
  React.useEffect(() => {
    const state = announcer.current;
    return () => window.clearTimeout(state.timer);
  }, []);

  function step(time: number, delta: number) {
    const engine = engineRef.current;
    const baseSurface = base.current;
    const pathSurface = pathLayer.current;
    const fxSurface = fx.current;
    const colors = palette.current;
    if (!baseSurface || !pathSurface || !fxSurface || !colors) return false;
    const reduced = prefersReducedMotion();

    if (engine.inkStale || !engine.ink) refreshInk(engine, colors);
    const layoutKey = `${baseSurface.width}|${engine.view?.key ?? ""}`;
    if (engine.layoutKey !== layoutKey) layoutEngine(engine, baseSurface.width, layoutKey);
    const ink = engine.ink;
    const lattice = engine.lattice;
    if (!lattice || !ink) return false;
    // the effects canvas reaches past the map by the same amount on opposite sides
    engine.fxX = Math.max(0, (fxSurface.width - engine.width) / 2);
    engine.fxY = Math.max(0, (fxSurface.height - engine.height) / 2);

    const revealing = drawBase(engine, baseSurface, lattice, ink, time, reduced);
    const moving = advanceTracks(engine, time, delta, reduced);
    if (moving || engine.pathsDirty) {
      drawPaths(engine, pathSurface, ink, time);
      engine.pathsDirty = false;
    }
    if (reduced) engine.packets.length = 0;
    else {
      if (!engine.prespawned) prespawn(engine);
      spawnPackets(engine, delta);
      movePackets(engine, delta);
    }
    const effects = drawEffects(engine, fxSurface, ink, time, delta, reduced);
    pruneTracks(engine);
    const flowing = !reduced && (engine.packets.length > 0 || anyCarrier(engine));
    return revealing || moving || effects || flowing;
  }

  function moveFocus(index: number) {
    setFocusIndex(index);
    rowRefs.current[index]?.focus();
  }

  function toggle(id: string) {
    setSelection(selectedId === id ? null : id);
  }

  /** How many rows share a line of the list grid (two when the list sits under a narrow map). */
  function listColumns() {
    const items = Array.from(listRef.current?.children ?? []).filter((item) => item instanceof HTMLElement);
    if (items.length === 0) return 1;
    const top = items[0].offsetTop;
    let columns = 0;
    while (columns < items.length && items[columns].offsetTop === top) columns++;
    return Math.max(1, columns);
  }

  function handleRowKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = rows.length - 1;
    let target: number | null = null;
    if (event.key === "ArrowDown") {
      const columns = listColumns();
      target = index + columns <= last ? index + columns : index;
    } else if (event.key === "ArrowUp") {
      const columns = listColumns();
      target = index - columns >= 0 ? index - columns : index;
    } else if (event.key === "ArrowRight") target = Math.min(last, index + 1);
    else if (event.key === "ArrowLeft") target = Math.max(0, index - 1);
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = last;
    if (target === null) return;
    event.preventDefault();
    if (target !== index) moveFocus(target);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.key !== "Escape" || selectedId === null) return;
    event.preventDefault();
    setSelection(null);
  }

  /** The peer marker nearest to a pointer position on the map, within reach of a finger. */
  function peerAt(clientX: number, clientY: number) {
    const box = boxRef.current;
    if (!box) return null;
    const rect = box.getBoundingClientRect();
    let best: string | null = null;
    let bestDistance = HIT_RADIUS;
    for (const peer of layout.peers) {
      const distance = Math.hypot(rect.left + peer.x * rect.width - clientX, rect.top + peer.y * rect.height - clientY);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = peer.id;
      }
    }
    return best;
  }

  function handleMapPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") return;
    const id = peerAt(event.clientX, event.clientY);
    if (id !== hoveredId) setHoveredId(id);
  }

  function handleMapClick(event: React.MouseEvent<HTMLDivElement>) {
    const id = peerAt(event.clientX, event.clientY);
    if (id) {
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) setFocusIndex(index);
      toggle(id);
    } else if (selectedId !== null) setSelection(null);
  }

  const selectedIndex = selectedId === null ? -1 : rows.findIndex((row) => row.id === selectedId);
  const tabStop = focusIndex >= 0 && focusIndex < rows.length ? focusIndex : Math.max(0, selectedIndex);
  const labelled = selectedId ?? hoveredId;
  const placements = React.useMemo(
    () => placeMapLabels(layout, model, labelled, boxWidth),
    [layout, model, labelled, boxWidth],
  );
  const chipReserve = React.useMemo(
    () => ["direct", "offline", ...model.relays.map((relay) => `via ${relay.id}`)],
    [model.relays],
  );
  const selectedRow = selectedIndex >= 0 ? rows[selectedIndex] : null;
  const animate = !reducedMotion;

  return (
    <div
      data-slot="geo-mesh"
      className={cn(
        "@container grid w-full max-w-[660px] gap-2 text-foreground [-webkit-tap-highlight-color:transparent]",
        className,
      )}
      onKeyDown={handleKeyDown}
      {...props}
    >
      <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 bg-lumesec shadow-[0_0_0_2px_var(--background),0_0_0_3px_color-mix(in_srgb,var(--lumesec)_60%,transparent)]"
          />
          <span className="shrink-0 text-[12.5px] leading-5 text-muted-foreground">This device</span>
          <span
            className={cn(
              "min-w-0 truncate text-[13.5px] leading-5 font-medium tracking-[-0.005em]",
              !model.device && "text-muted-foreground",
            )}
          >
            {model.device?.label ?? "–"}
          </span>
          {model.device?.location ? (
            <span className="hidden shrink-0 text-[12.5px] leading-5 text-muted-foreground @min-[460px]:inline">
              {model.device.location}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[12.5px] leading-5">
          <Count kind="direct" value={counts.direct} animate={animate} />
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <Count kind="relayed" value={counts.relayed} animate={animate} />
          {counts.offline > 0 ? (
            <>
              <span aria-hidden="true" className="text-muted-foreground">
                ·
              </span>
              <Count kind="offline" value={counts.offline} animate={animate} />
            </>
          ) : null}
        </div>
      </div>

      <div
        ref={cardRef}
        className="relative grid rounded-[14px] border border-border bg-card text-card-foreground shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)] @min-[560px]:grid-cols-[minmax(0,1fr)_200px]"
      >
        <div className="flex min-w-0 flex-col">
          <div
            ref={boxRef}
            className={cn("relative w-full select-none", hoveredId !== null && "cursor-pointer")}
            style={{ aspectRatio: ASPECT }}
            onPointerMove={handleMapPointerMove}
            onPointerLeave={() => setHoveredId(null)}
            onClick={handleMapClick}
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 overflow-hidden rounded-tl-[13px] @max-[559px]:rounded-tr-[13px]"
            >
              <canvas ref={baseRef} className="absolute inset-0 block size-full" />
              <canvas ref={pathsRef} className="absolute inset-0 block size-full" />
            </div>
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              {layout.relays.map((relay, i) => {
                const placement = placements.relays[i];
                return (
                  <span
                    key={relay.id}
                    data-used={selectedRow?.shown?.relayId === relay.id ? "" : undefined}
                    className="group/relay absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ left: percent(relay.x), top: percent(relay.y) }}
                  >
                    <span className="block size-2 border border-[color-mix(in_srgb,var(--foreground)_45%,transparent)] bg-card shadow-[0_0_0_2px_var(--card)] transition-[border-color] duration-300 group-data-[used]/relay:border-foreground motion-reduce:transition-none @max-[420px]:size-[7px]" />
                    <span
                      className={cn(
                        "absolute font-mono text-[10.5px] leading-[14px] whitespace-nowrap text-muted-foreground transition-[color,opacity] duration-300 [text-shadow:0_0_2px_var(--card),0_0_4px_var(--card)] group-data-[used]/relay:text-foreground motion-reduce:transition-none",
                        !placement.visible && "opacity-0",
                      )}
                      style={LABEL_STYLES[placement.side]}
                    >
                      {relay.id}
                    </span>
                  </span>
                );
              })}
              {layout.peers.map((peer, i) => {
                const row = rows[i];
                const placement = placements.peers[i];
                const selected = peer.id === selectedId;
                const state =
                  row.shown === null ? "offline" : selected ? "selected" : peer.id === hoveredId ? "hover" : "idle";
                return (
                  <span
                    key={peer.id}
                    data-state={state}
                    data-dimmed={selectedId !== null && !selected ? "" : undefined}
                    className="group/peer absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ left: percent(peer.x), top: percent(peer.y) }}
                  >
                    <span
                      ref={(node) => {
                        if (node) markerRefs.current.set(peer.id, node);
                        else markerRefs.current.delete(peer.id);
                      }}
                      className="block size-[7px] rounded-full bg-[color-mix(in_srgb,var(--foreground)_55%,var(--card))] shadow-[0_0_0_2px_var(--card)] transition-[background-color,box-shadow,opacity,scale] duration-300 group-data-[dimmed]/peer:opacity-55 group-data-[state=hover]/peer:scale-125 group-data-[state=offline]/peer:border group-data-[state=offline]/peer:border-[color-mix(in_srgb,var(--foreground)_45%,var(--card))] group-data-[state=offline]/peer:bg-card group-data-[state=selected]/peer:bg-foreground group-data-[state=selected]/peer:shadow-[0_0_0_2.5px_var(--card),0_0_0_3.5px_var(--lumesec)] motion-reduce:transition-none @max-[420px]:size-1.5"
                    />
                    <span
                      className={cn(
                        "absolute text-[11px] leading-[14px] font-medium whitespace-nowrap text-foreground transition-opacity duration-200 [text-shadow:0_0_2px_var(--card),0_0_4px_var(--card),0_0_6px_var(--card)] motion-reduce:transition-none",
                        !placement.visible && "opacity-0",
                      )}
                      style={LABEL_STYLES[placement.side]}
                    >
                      {row.label}
                    </span>
                  </span>
                );
              })}
              {layout.device ? (
                <span
                  className="absolute block size-[9px] -translate-x-1/2 -translate-y-1/2 bg-lumesec shadow-[0_0_0_3px_var(--card),0_0_0_4px_color-mix(in_srgb,var(--lumesec)_70%,transparent)] @max-[420px]:size-[7px] @max-[420px]:shadow-[0_0_0_2px_var(--card),0_0_0_3px_color-mix(in_srgb,var(--lumesec)_70%,transparent)]"
                  style={{ left: percent(layout.device.x), top: percent(layout.device.y) }}
                />
              ) : null}
            </div>
            <canvas
              ref={fxRef}
              aria-hidden="true"
              className="pointer-events-none absolute -top-10 -left-4 z-[3] block h-[calc(100%+80px)] w-[calc(100%+32px)] @min-[560px]:-left-10 @min-[560px]:w-[calc(100%+80px)]"
            />
            <div role="img" aria-label={mapLabel(label, model, counts)} className="absolute inset-0" />
          </div>
          <div className="flex h-8 min-w-0 shrink-0 items-center gap-2 border-t border-border px-3 text-[12px] leading-4">
            {selectedRow ? (
              <>
                <span className="shrink-0 font-medium text-foreground">{selectedRow.label}</span>
                <span aria-hidden="true" className="text-muted-foreground">
                  ·
                </span>
                <span className="min-w-0 truncate text-muted-foreground">{detailText(selectedRow.shown)}</span>
              </>
            ) : model.relays.length > 0 ? (
              <span className="flex min-w-0 items-center gap-2.5 overflow-hidden whitespace-nowrap text-muted-foreground">
                <span className="shrink-0">Relays</span>
                {model.relays.map((relay) => (
                  <span key={relay.id} className="inline-flex shrink-0 items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="size-[7px] border border-[color-mix(in_srgb,var(--foreground)_45%,transparent)]"
                    />
                    <span className="font-mono text-[11px] text-foreground">{relay.id}</span>
                    <span className="@max-[420px]:hidden">{relay.label}</span>
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-muted-foreground">No relays</span>
            )}
          </div>
        </div>

        <div className="relative min-w-0 border-t border-border @min-[560px]:border-t-0 @min-[560px]:border-l">
          {rows.length === 0 ? (
            <p className="m-0 grid min-h-16 place-items-center px-3 text-[12.5px] leading-5 text-muted-foreground @min-[560px]:absolute @min-[560px]:inset-0">
              No other devices
            </p>
          ) : (
            <ul
              ref={listRef}
              aria-label="Devices"
              className="m-0 grid list-none grid-cols-1 content-start gap-x-1 p-1 @min-[320px]:grid-cols-2 @min-[560px]:absolute @min-[560px]:inset-0 @min-[560px]:[scrollbar-width:thin] @min-[560px]:grid-cols-1 @min-[560px]:overflow-y-auto"
            >
              {rows.map((row, i) => (
                <li key={row.id}>
                  <PeerRow
                    ref={(node) => {
                      rowRefs.current[i] = node;
                    }}
                    row={row}
                    selected={row.id === selectedId}
                    focusable={i === tabStop}
                    reserve={chipReserve}
                    animate={animate}
                    onClick={() => {
                      setFocusIndex(i);
                      toggle(row.id);
                    }}
                    onFocus={() => setFocusIndex(i)}
                    onKeyDown={(event) => handleRowKeyDown(event, i)}
                    onPointerEnter={() => setHoveredId(row.id)}
                    onPointerLeave={() => setHoveredId(null)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <span ref={liveRef} aria-live="polite" className="sr-only" />
    </div>
  );
}

/* Header counts and list rows ----------------------------------------------------------------------- */

type CountKind = "direct" | "relayed" | "offline";

/** One header count: a sample of the line style, the word, and the number rolling in the direction of change. */
function Count({ kind, value, animate }: { kind: CountKind; value: number; animate: boolean }) {
  const [state, setState] = React.useState({ value, direction: 1 });
  if (state.value !== value) setState({ value, direction: value >= state.value ? 1 : -1 });
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden="true" className="flex items-center gap-[2px]">
        {COUNT_SAMPLES[kind].map((on, i) => (
          <span
            key={i}
            className={cn(
              "size-[2px]",
              kind === "direct" ? "bg-lumesec" : "bg-[color-mix(in_srgb,var(--foreground)_50%,var(--card))]",
              !on && "opacity-0",
            )}
          />
        ))}
      </span>
      <span className="text-muted-foreground">{COUNT_WORDS[kind]}</span>
      <RollText
        text={String(value)}
        direction={state.direction}
        animate={animate}
        className="font-mono font-medium text-foreground tabular-nums"
      />
    </span>
  );
}

/** The line style each count stands for: accent dots, grey dashes two on and one off, an open gap. */
const COUNT_SAMPLES: Record<CountKind, readonly boolean[]> = {
  direct: [true, true, true, true],
  relayed: [true, true, false, true],
  offline: [true, false, false, true],
};
const COUNT_WORDS: Record<CountKind, string> = { direct: "Direct", relayed: "Relayed", offline: "Offline" };

interface PeerRowProps extends Omit<React.ComponentProps<"button">, "children"> {
  row: RowView;
  selected: boolean;
  focusable: boolean;
  reserve: readonly string[];
  animate: boolean;
}

type ChangeKind = "none" | "up" | "down";

/** What a row last showed, and how its values roll toward the next ones. */
interface RowRollState {
  ms: number;
  /** 0 offline, 1 relayed, 2 direct. */
  rank: number;
  msDirection: number;
  chipDirection: number;
  /** Counts path changes, so each one plays its chip animation once. */
  change: number;
  kind: ChangeKind;
}

/** A peer in the list: name and place, the latency rolling in tabular figures, and the path chip. */
function PeerRow({ row, selected, focusable, reserve, animate, ref, ...props }: PeerRowProps) {
  const shown = row.shown;
  const rank = shown === null ? 0 : shown.relayId === null ? 2 : 1;
  const ms = shown === null ? Number.NaN : shown.ms;
  // numbers roll up when they grow and down when they shrink; the chip rolls up on an upgrade
  const [state, setState] = React.useState<RowRollState>({
    ms,
    rank,
    msDirection: 1,
    chipDirection: 1,
    change: 0,
    kind: "none",
  });
  if (!Object.is(state.ms, ms) || state.rank !== rank) {
    const kind: ChangeKind = rank === state.rank ? "none" : rank > state.rank ? "up" : "down";
    setState({
      ms,
      rank,
      msDirection: Number.isFinite(ms) && Number.isFinite(state.ms) && ms < state.ms ? -1 : 1,
      chipDirection: rank >= state.rank ? 1 : -1,
      change: kind === "none" ? state.change : state.change + 1,
      kind: kind === "none" ? state.kind : kind,
    });
  }

  const chipRef = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    const chip = chipRef.current;
    if (state.change === 0 || !chip || !animate || typeof chip.animate !== "function") return;
    const animation =
      state.kind === "down"
        ? chip.animate(FALLBACK_CHIP, { duration: WARN_SECONDS * 1000, easing: "ease-out" })
        : chip.animate(UPGRADE_CHIP, { duration: 700, easing: "cubic-bezier(.2,.8,.2,1)" });
    return () => animation.cancel();
  }, [state.change, state.kind, animate]);

  const status = shown === null ? "offline" : shown.relayId === null ? "direct" : "relayed";
  const chipText = shown === null ? "offline" : shown.relayId === null ? "direct" : `via ${shown.relayId}`;
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={selected}
      aria-label={rowName(row)}
      tabIndex={focusable ? 0 : -1}
      data-status={status}
      className="group/row grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 rounded-md border-0 bg-transparent px-2.5 py-[3px] text-left font-[inherit] text-foreground transition-[background-color,box-shadow] duration-200 outline-none hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid aria-pressed:bg-muted aria-pressed:shadow-[inset_2px_0_0_var(--lumesec)] motion-reduce:transition-none @max-[420px]:gap-x-1.5 @max-[420px]:px-2"
      {...props}
    >
      <span className="truncate text-[12.5px] leading-[15px] font-medium group-data-[status=offline]/row:text-muted-foreground">
        {row.label}
      </span>
      <span className="justify-self-end font-mono text-[12px] leading-[15px] whitespace-nowrap tabular-nums">
        <RollText text={msText(ms)} direction={state.msDirection} animate={animate} className="justify-items-end" />
        {Number.isFinite(ms) ? <span className="text-muted-foreground"> ms</span> : null}
      </span>
      <span className="truncate text-[11.5px] leading-[15px] text-muted-foreground">{row.location}</span>
      <span
        ref={chipRef}
        className="justify-self-end overflow-hidden rounded-[4px] bg-card px-1 font-mono text-[10.5px] leading-[15px] whitespace-nowrap text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)] group-data-[status=direct]/row:bg-lumesec/10 group-data-[status=direct]/row:text-lumesec group-data-[status=direct]/row:shadow-none group-data-[status=offline]/row:bg-transparent group-data-[status=offline]/row:shadow-none"
      >
        <RollText
          text={chipText}
          direction={state.chipDirection}
          animate={animate}
          reserve={reserve}
          className="justify-items-end"
        />
      </span>
    </button>
  );
}

/* Constants ------------------------------------------------------------------------------------------ */

/**
 * Width / height of the map box: wide, since most networks spread east and west more than north and south, and as
 * tall as the six-row list beside it at full width.
 */
const ASPECT = 2.2;
/** The map's latitude crop, from the Southern Ocean to the Arctic coast. */
const LAT_RANGE: readonly [number, number] = [-50, 72];
/** Width the pure marker layout is computed at. */
const NOMINAL_WIDTH = 1000;
/** The map box width at the full 660 px (the list column takes 201 px), assumed by the server for label placement. */
const NOMINAL_BOX_WIDTH = 457;
/** The fitted view never zooms in further than this, so a local network still shows its surroundings. */
const MAX_ZOOM = 6;
/** Room around the network in the fitted view, as shares of the box. */
const FIT_MARGIN_X = 0.08;
const FIT_MARGIN_Y = 0.13;
const CANVAS_OPTIONS = { maxDpr: 2 };
/** Pointer reach of a peer marker on the map. */
const HIT_RADIUS = 14;

/** The land lattice rests at this alpha, so the paths lead. */
const BASE_ALPHA = 0.6;
/** First view: the land lights up from this device outward, and the paths start growing a moment later. */
const REVEAL_SECONDS = 1.1;
const REVEAL_SOFTNESS = 0.08;
const REVEAL_TINTS = 5;
const PATH_DELAY = 0.25;

/** Every path is resampled to this many points, so a relayed and a direct path blend point by point. */
const SAMPLES = 96;
const LEG_SEGMENTS = 32;
const DIRECT_BEND = 0.14;
const RELAY_BEND = 0.08;
const DOT_SPACING = 3.5;
const PATH_DOT = 1.5;
const DIRECT_ALPHA = 0.65;
/** Stronger than the land lattice under it, which uses a lighter grey at 0.6. */
const RELAYED_ALPHA = 0.85;
/** Other paths dim to this while a peer is selected. */
const DIMMED = 0.3;
/** Dots stop this far from a marker's centre: the device square with its ring, a peer dot, a relay square plus 3 px. */
const DEVICE_GAP = 9;
const PEER_GAP = 6;
const RELAY_GAP = 7;
/** The uneven front a path grows (and retracts) behind. */
const GROWTH_SOFTNESS = 0.06;

/** Packets: speed at the nominal map width, the most in flight, head and tail squares. */
const PACKET_SPEED = 90;
const PACKET_LIMIT = 160;
const HEAD_SIZE = 2;
const TAIL_SIZE = 1.5;
const TAIL_GAP = 2.4;
const TAIL_ALPHA = [1, 0.55, 0.3, 0.13];

/** Upgrade: probe speed and duration limits, the flash where they meet, the sparks at the relay. */
const PROBE_SPEED = 260;
const PROBE_MIN_SECONDS = 0.16;
const PROBE_MAX_SECONDS = 0.45;
const FLASH_SECONDS = 0.4;
/** How long the probes' trace lingers after the release. */
const TRACE_SECONDS = 0.45;
const FLASH_RADIUS = 18;
const SPARK_COUNT = 12;
/** Springs: the upgrade overshoots to about 1.18 like a released string; the fallback bends back without overshoot. */
const UPGRADE_SPRING = { stiffness: 220, damping: 0.48 };
const FALLBACK_SPRING = { stiffness: 160, damping: 1 };
const SWITCH_SPRING = { stiffness: 180, damping: 0.75 };
const EMPHASIS_SPRING = { stiffness: 260, damping: 1 };
const PRESENCE_SECONDS = 0.6;
const WARN_SECONDS = 1.2;
const CROSSFADE_SECONDS = 0.15;
const PULSE_SECONDS = 0.6;
const ANNOUNCE_MS = 5000;

/** The config of a direct path; any other config is a relay id. */
const DIRECT = "\u0000direct";

/** Label boxes sit 9 px from the marker centre, on the side placeLabels chose. */
const LABEL_GAP = 9;
const LABEL_STYLES: Record<"right" | "left" | "top" | "bottom", React.CSSProperties> = {
  right: { left: `calc(50% + ${LABEL_GAP}px)`, top: "50%", transform: "translateY(-50%)" },
  left: { right: `calc(50% + ${LABEL_GAP}px)`, top: "50%", transform: "translateY(-50%)" },
  top: { bottom: `calc(50% + ${LABEL_GAP}px)`, left: "50%", transform: "translateX(-50%)" },
  bottom: { top: `calc(50% + ${LABEL_GAP}px)`, left: "50%", transform: "translateX(-50%)" },
};
/** Geist Mono advances 0.6 em; Geist averages about 0.56 em at this size. */
const MONO_CHAR_WIDTH = 6.3;
const SANS_CHAR_WIDTH = 6.2;
const LABEL_HEIGHT = 14;

const MARKER_POP: Keyframe[] = [{ scale: "0.6" }, { scale: "1.5", offset: 0.4 }, { scale: "1" }];
const FALLBACK_CHIP: Keyframe[] = [
  { color: "var(--lumesec-warning)", boxShadow: "inset 0 0 0 1px var(--lumesec-warning)" },
  { color: "var(--lumesec-warning)", boxShadow: "inset 0 0 0 1px var(--lumesec-warning)", offset: 0.55 },
  { color: "var(--muted-foreground)", boxShadow: "inset 0 0 0 1px var(--border)" },
];
const UPGRADE_CHIP: Keyframe[] = [
  { boxShadow: "0 0 0 0 color-mix(in srgb, var(--lumesec) 45%, transparent)" },
  { boxShadow: "0 0 0 4px color-mix(in srgb, var(--lumesec) 0%, transparent)" },
];

/* Demo data ------------------------------------------------------------------------------------------- */

const DEMO_DEVICE: MeshDevice = {
  id: "laptop",
  label: "Work laptop",
  location: "Amsterdam",
  lat: 52.3676,
  lon: 4.9041,
};

/** Invented devices. The phone sits behind a network that never allows a direct path, so it stays relayed. */
const DEMO_PEERS: readonly MeshDevice[] = [
  { id: "build", label: "Build server", location: "Milan", lat: 45.4642, lon: 9.19 },
  { id: "nas", label: "NAS", location: "Dublin", lat: 53.3498, lon: -6.2603 },
  { id: "phone", label: "Phone", location: "Madrid", lat: 40.4168, lon: -3.7038 },
  { id: "desktop", label: "Desktop", location: "Toronto", lat: 43.6532, lon: -79.3832 },
  { id: "ci", label: "CI runner", location: "Chicago", lat: 41.8781, lon: -87.6298 },
  { id: "staging", label: "Staging server", location: "Helsinki", lat: 60.1699, lon: 24.9384 },
];

const DEMO_RELAYS: readonly MeshRelay[] = [
  { id: "lhr", label: "London", lat: 51.5072, lon: -0.1276 },
  { id: "iad", label: "Ashburn", lat: 39.0438, lon: -77.4874 },
  { id: "waw", label: "Warsaw", lat: 52.2297, lon: 21.0122 },
];

const DEMO_TRAFFIC: Readonly<Record<string, number>> = {
  build: 0.8,
  nas: 0.45,
  phone: 0.2,
  desktop: 0.35,
  ci: 0.65,
  staging: 0.3,
};
const DEMO_STAYS_RELAYED = "phone";

function seededOrder(ids: readonly string[], seed: string) {
  const random = createRandom(seed);
  const order = [...ids];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** The peers that become direct, in seeded order. */
const DEMO_ORDER: readonly string[] = seededOrder(
  DEMO_PEERS.map((peer) => peer.id).filter((id) => id !== DEMO_STAYS_RELAYED),
  "geo-mesh",
);
/**
 * Upgrades: the first once the map has drawn itself in, then one every 1.1 s. Every 14 s one direct peer falls back
 * for 3 s.
 */
const DEMO_FIRST_MS = 1500;
const DEMO_STEP_MS = 1100;
const DEMO_FALLBACK_EVERY_MS = 14000;
const DEMO_FALLBACK_MS = 3000;
/** A demo time after every upgrade and before the first fallback, shown when `live` is false. */
const DEMO_SETTLED_MS = DEMO_FIRST_MS + DEMO_ORDER.length * DEMO_STEP_MS;

const NO_PEERS: readonly MeshDevice[] = [];
const NO_RELAYS: readonly MeshRelay[] = [];
const NO_PATHS: readonly MeshPath[] = [];

/** The peer that falls back in round k (k ≥ 1). */
const demoFallbackPeer = (round: number) =>
  DEMO_ORDER[Math.floor(createRandom(`geo-mesh:${round}`)() * DEMO_ORDER.length)];

/** Which demo peers are direct at a demo time in ms. */
function demoDirectSet(time: number): ReadonlySet<string> {
  const direct = new Set<string>();
  DEMO_ORDER.forEach((id, i) => {
    if (time >= DEMO_FIRST_MS + i * DEMO_STEP_MS) direct.add(id);
  });
  const round = Math.floor(time / DEMO_FALLBACK_EVERY_MS);
  if (round >= 1 && time < round * DEMO_FALLBACK_EVERY_MS + DEMO_FALLBACK_MS) direct.delete(demoFallbackPeer(round));
  return direct;
}

/** The next demo time at which a path changes. */
function nextDemoEvent(time: number) {
  const round = Math.floor(time / DEMO_FALLBACK_EVERY_MS);
  const events = DEMO_ORDER.map((_, i) => DEMO_FIRST_MS + i * DEMO_STEP_MS);
  events.push((round + 1) * DEMO_FALLBACK_EVERY_MS, round * DEMO_FALLBACK_EVERY_MS + DEMO_FALLBACK_MS);
  let next = Infinity;
  for (const event of events) if (event > time && event < next) next = event;
  return next;
}

/** The relay nearest to a peer: its home relay, which a mesh client uses when a direct path cannot be opened. */
function homeRelay(peer: LatLon, relays: readonly MeshRelay[]) {
  let best: MeshRelay | null = null;
  let bestKm = Infinity;
  for (const relay of relays) {
    const km = distanceKm(peer, relay);
    if (km < bestKm) {
      bestKm = km;
      best = relay;
    }
  }
  return best;
}

/** Demo paths: direct peers at the direct latency, the others through their home relay at the sum of both legs. */
function createDemoPaths(direct: ReadonlySet<string>): readonly MeshPath[] {
  return DEMO_PEERS.map((peer) => {
    const traffic = DEMO_TRAFFIC[peer.id] ?? 0.3;
    const relay = direct.has(peer.id) ? null : homeRelay(peer, DEMO_RELAYS);
    if (!relay) return { peer: peer.id, relay: null, ms: demoLatency(DEMO_DEVICE, peer), traffic };
    const ms = demoLatency(DEMO_DEVICE, relay) + demoLatency(relay, peer) + 4;
    return { peer: peer.id, relay: relay.id, ms, traffic };
  });
}

/* Data model ----------------------------------------------------------------------------------------- */

/** A peer's path as the component uses it: the relay resolved (null when unknown), latency and traffic clamped. */
interface ShownPath {
  relayId: string | null;
  relay: MeshRelay | null;
  ms: number;
  traffic: number;
}

interface MeshPeer {
  device: MeshDevice;
  /** Null when the peer is offline (no path, or no device to start from). */
  path: ShownPath | null;
}

interface MeshModel {
  device: MeshDevice | null;
  peers: readonly MeshPeer[];
  peerById: ReadonlyMap<string, MeshPeer>;
  relays: readonly MeshRelay[];
  relayById: ReadonlyMap<string, MeshRelay>;
}

/** Validates the input: unique ids, finite coordinates, the first path per peer. Pure. */
function resolveModel(
  device: MeshDevice | undefined,
  peerList: readonly MeshDevice[],
  relayList: readonly MeshRelay[],
  pathList: readonly MeshPath[],
): MeshModel {
  const origin = device && typeof device.id === "string" && isValidLatLon(device) ? device : null;
  const relays: MeshRelay[] = [];
  const relayById = new Map<string, MeshRelay>();
  for (const relay of relayList) {
    if (typeof relay.id !== "string" || relayById.has(relay.id) || !isValidLatLon(relay)) continue;
    relayById.set(relay.id, relay);
    relays.push(relay);
  }
  const pathByPeer = new Map<string, ShownPath>();
  for (const path of pathList) {
    if (typeof path.peer !== "string" || pathByPeer.has(path.peer)) continue;
    const relayId = typeof path.relay === "string" ? path.relay : null;
    const traffic = path.traffic;
    pathByPeer.set(path.peer, {
      relayId,
      relay: relayId === null ? null : (relayById.get(relayId) ?? null),
      ms: Number.isFinite(path.ms) ? Math.max(0, path.ms) : Number.NaN,
      traffic: traffic !== undefined && Number.isFinite(traffic) ? clamp(traffic, 0, 1) : 0,
    });
  }
  const peers: MeshPeer[] = [];
  const peerById = new Map<string, MeshPeer>();
  for (const peer of peerList) {
    if (typeof peer.id !== "string" || peerById.has(peer.id) || peer.id === origin?.id || !isValidLatLon(peer))
      continue;
    const entry: MeshPeer = { device: peer, path: origin ? (pathByPeer.get(peer.id) ?? null) : null };
    peerById.set(peer.id, entry);
    peers.push(entry);
  }
  return { device: origin, peers, peerById, relays, relayById };
}

/** The relayed values an upgrading row keeps showing until the map releases it. */
interface HoldState {
  model: MeshModel;
  held: ReadonlyMap<string, ShownPath>;
}

const NO_HOLDS: ReadonlyMap<string, ShownPath> = new Map();

function nextHolds(previous: HoldState, model: MeshModel, animate: boolean): ReadonlyMap<string, ShownPath> {
  if (!animate) return NO_HOLDS;
  const held = new Map<string, ShownPath>();
  for (const peer of model.peers) {
    const id = peer.device.id;
    const before = previous.held.get(id) ?? previous.model.peerById.get(id)?.path ?? null;
    if (before && before.relayId !== null && peer.path && peer.path.relayId === null) held.set(id, before);
  }
  return held.size > 0 ? held : NO_HOLDS;
}

interface RowView {
  id: string;
  label: string;
  location: string;
  shown: ShownPath | null;
}

const rowView = (peer: MeshPeer, held: ReadonlyMap<string, ShownPath>): RowView => ({
  id: peer.device.id,
  label: peer.device.label,
  location: peer.device.location ?? "",
  shown: held.get(peer.device.id) ?? peer.path,
});

interface MeshCounts {
  direct: number;
  relayed: number;
  offline: number;
}

function countRows(rows: readonly RowView[]): MeshCounts {
  let direct = 0;
  let relayed = 0;
  let offline = 0;
  for (const row of rows) {
    if (row.shown === null) offline++;
    else if (row.shown.relayId === null) direct++;
    else relayed++;
  }
  return { direct, relayed, offline };
}

const msText = (ms: number) =>
  Number.isFinite(ms) ? formatNumber(ms, { fractionDigits: ms < 10 && !Number.isInteger(ms) ? 1 : 0 }) : "–";

const relayName = (shown: ShownPath) => shown.relay?.label ?? shown.relayId ?? "";

/** 'Direct, 38 ms', 'Relayed through London, 142 ms' or 'Offline'. */
function detailText(shown: ShownPath | null) {
  if (!shown) return "Offline";
  const ms = Number.isFinite(shown.ms) ? `, ${msText(shown.ms)} ms` : "";
  return shown.relayId === null ? `Direct${ms}` : `Relayed through ${relayName(shown)}${ms}`;
}

/** 'Build server, Milan, direct, 13 milliseconds'. */
function rowName(row: RowView) {
  const parts = [row.label];
  if (row.location) parts.push(row.location);
  const shown = row.shown;
  if (!shown) parts.push("offline");
  else {
    parts.push(shown.relayId === null ? "direct" : `relayed through ${relayName(shown)}`);
    if (Number.isFinite(shown.ms)) parts.push(`${msText(shown.ms)} milliseconds`);
  }
  return parts.join(", ");
}

interface RowStatus {
  key: string;
  message: string;
}

/** Per row: a key that changes with the path, and the sentence announced when it does. */
function rowStatuses(rows: readonly RowView[]): ReadonlyMap<string, RowStatus> {
  const statuses = new Map<string, RowStatus>();
  for (const row of rows) {
    const shown = row.shown;
    const key = shown === null ? "offline" : (shown.relayId ?? DIRECT);
    const ms = shown && Number.isFinite(shown.ms) ? `, ${msText(shown.ms)} ms` : "";
    const state =
      shown === null
        ? "offline"
        : shown.relayId === null
          ? `now direct${ms}`
          : `now relayed through ${relayName(shown)}${ms}`;
    statuses.set(row.id, { key, message: `${row.label} is ${state}.` });
  }
  return statuses;
}

interface Announcer {
  last: ReadonlyMap<string, RowStatus>;
  pending: string[];
  time: number;
  timer: number;
}

function mapLabel(label: string, model: MeshModel, counts: MeshCounts) {
  const parts = [`${counts.direct} direct`, `${counts.relayed} relayed`];
  if (counts.offline > 0) parts.push(`${counts.offline} offline`);
  const origin = model.device ? ` from ${model.device.label}` : "";
  return `${label}${origin}: ${parts.join(", ")}.`;
}

/* Fitted view and markers ---------------------------------------------------------------------------- */

/** The map's view: Equal Earth centred on this device's meridian, zoomed to fit every device, relay and curve. */
interface MeshView {
  key: string;
  center: LatLon;
  zoom: number;
  focus: LatLon | undefined;
}

const viewPoint = createScreenPoint();
const viewCurve: QuadCurve = { x0: 0, y0: 0, cx: 0, cy: 0, x1: 0, y1: 0 };

/** Bends a curve to the side that bulges upward on screen, like a flight arc. */
const upward = (x0: number, x1: number, bend: number) => (x1 >= x0 ? bend : -bend);

/**
 * Fits the view to the network. Every leg a path could take is included (direct, and through every relay), so the
 * view stays put while paths change. Centring on this device's meridian puts every place within 180° of it, so all
 * paths live in one frame without seam copies. Pure: the server and the client compute the same view.
 */
function fitView(model: MeshModel): MeshView {
  const center: LatLon = { lat: 0, lon: model.device?.lon ?? 0 };
  const world: MeshView = { key: `world|${center.lon.toFixed(3)}`, center, zoom: 1, focus: undefined };
  const width = NOMINAL_WIDTH;
  const height = width / ASPECT;
  const base = createProjection("equalEarth", { width, height, latRange: LAT_RANGE, center });
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const grow = (x: number, y: number) => {
    box.x0 = Math.min(box.x0, x);
    box.y0 = Math.min(box.y0, y);
    box.x1 = Math.max(box.x1, x);
    box.y1 = Math.max(box.y1, y);
  };
  const place = (point: LatLon) => {
    base.project(point.lat, point.lon, viewPoint);
    grow(viewPoint.x, viewPoint.y);
    return { x: viewPoint.x, y: viewPoint.y };
  };
  const apex = (a: { x: number; y: number }, b: { x: number; y: number }, bend: number) => {
    flatCurve(a.x, a.y, b.x, b.y, upward(a.x, b.x, bend), viewCurve);
    quadPoint(viewCurve, 0.5, viewPoint);
    grow(viewPoint.x, viewPoint.y);
  };
  const origin = model.device ? place(model.device) : null;
  const relays = model.relays.map(place);
  const peers = model.peers.map((peer) => place(peer.device));
  if (origin) {
    for (const peer of peers) {
      apex(origin, peer, DIRECT_BEND);
      for (const relay of relays) {
        apex(origin, relay, RELAY_BEND);
        apex(relay, peer, RELAY_BEND);
      }
    }
  }
  if (!Number.isFinite(box.x0)) return world;
  const spanX = Math.max(1, box.x1 - box.x0);
  const spanY = Math.max(1, box.y1 - box.y0);
  const zoom = clamp(
    Math.min((width * (1 - 2 * FIT_MARGIN_X)) / spanX, (height * (1 - 2 * FIT_MARGIN_Y)) / spanY),
    1,
    MAX_ZOOM,
  );
  if (zoom < 1.02) return world;
  // keep the window inside the map's frame, so it never shows the empty space past the crop
  const { frame } = base;
  const halfWidth = width / (2 * zoom);
  const halfHeight = height / (2 * zoom);
  const middleX = (frame.x0 + frame.x1) / 2;
  const middleY = (frame.y0 + frame.y1) / 2;
  let cx =
    frame.x1 - frame.x0 >= 2 * halfWidth
      ? clamp((box.x0 + box.x1) / 2, frame.x0 + halfWidth, frame.x1 - halfWidth)
      : middleX;
  let cy =
    frame.y1 - frame.y0 >= 2 * halfHeight
      ? clamp((box.y0 + box.y1) / 2, frame.y0 + halfHeight, frame.y1 - halfHeight)
      : middleY;
  let focus = base.invert(cx, cy);
  // Equal Earth's sides curve inward: step toward the middle until the centre lies on the map
  for (let i = 0; !focus && i < 10; i++) {
    cx = lerp(cx, middleX, 0.5);
    cy = lerp(cy, middleY, 0.5);
    focus = base.invert(cx, cy);
  }
  if (!focus) return world;
  return {
    key: `${center.lon.toFixed(3)}|${zoom.toFixed(4)}|${focus.lat.toFixed(4)},${focus.lon.toFixed(4)}`,
    center,
    zoom,
    focus,
  };
}

/** The projection of a view at a box width; the height always follows the fixed aspect. */
const viewProjection = (view: MeshView, width: number) =>
  createProjection("equalEarth", {
    width,
    height: width / ASPECT,
    latRange: LAT_RANGE,
    center: view.center,
    zoom: view.zoom > 1 ? view.zoom : undefined,
    focus: view.focus,
  });

interface MarkerPoint {
  id: string;
  /** Position as a share of the map box. */
  x: number;
  y: number;
}

interface MarkerLayout {
  device: MarkerPoint | null;
  peers: readonly MarkerPoint[];
  relays: readonly MarkerPoint[];
}

/** Marker positions from the nominal projection: pure, so the server places them where the client draws the map. */
function markerLayout(model: MeshModel, view: MeshView): MarkerLayout {
  const projection = viewProjection(view, NOMINAL_WIDTH);
  const height = NOMINAL_WIDTH / ASPECT;
  const point = createScreenPoint();
  const locate = (id: string, place: LatLon): MarkerPoint => {
    projection.project(place.lat, place.lon, point);
    return { id, x: point.x / NOMINAL_WIDTH, y: point.y / height };
  };
  return {
    device: model.device ? locate(model.device.id, model.device) : null,
    peers: model.peers.map((peer) => locate(peer.device.id, peer.device)),
    relays: model.relays.map((relay) => locate(relay.id, relay)),
  };
}

interface PlacedLabel {
  visible: boolean;
  side: "right" | "left" | "top" | "bottom";
}

/**
 * Relay ids always compete for a place; the selected (or hovered) peer's name comes first. Every marker is an
 * obstacle, so a label never covers a dot.
 */
function placeMapLabels(layout: MarkerLayout, model: MeshModel, labelled: string | null, boxWidth: number) {
  const width = boxWidth;
  const height = boxWidth / ASPECT;
  const anchors: LabelAnchor[] = [];
  for (const relay of layout.relays) {
    anchors.push({
      x: relay.x * width,
      y: relay.y * height,
      width: relay.id.length * MONO_CHAR_WIDTH + 2,
      height: LABEL_HEIGHT,
      priority: 1,
      gap: LABEL_GAP,
    });
  }
  layout.peers.forEach((peer, i) => {
    const shown = peer.id === labelled;
    const text = model.peers[i].device.label;
    anchors.push({
      x: peer.x * width,
      y: peer.y * height,
      width: shown ? text.length * SANS_CHAR_WIDTH + 4 : 0.01,
      height: shown ? LABEL_HEIGHT : 0.01,
      priority: shown ? 10 : -1,
      gap: LABEL_GAP,
    });
  });
  if (layout.device) {
    anchors.push({
      x: layout.device.x * width,
      y: layout.device.y * height,
      width: 0.01,
      height: 0.01,
      priority: -2,
      gap: 0,
    });
  }
  const placed = placeLabels(anchors, width, height);
  const relays: PlacedLabel[] = layout.relays.map((_, i) => ({ visible: placed[i].visible, side: placed[i].side }));
  const peers: PlacedLabel[] = layout.peers.map((peer, i) => {
    const placement = placed[layout.relays.length + i];
    if (peer.id !== labelled) return { visible: false, side: placement.side };
    return { visible: true, side: placement.visible ? placement.side : "top" };
  });
  return { relays, peers };
}

/* Engine --------------------------------------------------------------------------------------------- */

interface SpringConstants {
  stiffness: number;
  damping: number;
}

/** A path's screen geometry: SAMPLES points evenly spaced by arc length, and the relay it bends through. */
interface PathShape {
  points: Float32Array;
  /** The relay marker the path runs through, or NaN when direct. */
  relayX: number;
  relayY: number;
  /** Sample index nearest to the relay, or −1. */
  vertex: number;
  /** 0 is the relayed style (grey dashes), 1 the direct style (accent dots). */
  style: number;
}

interface Probe {
  start: number;
  duration: number;
  target: PathShape;
  table: ArcLengthTable;
}

/** One peer's path with everything the loop animates. */
interface PeerTrack {
  id: string;
  place: LatLon;
  point: { x: number; y: number };
  config: string;
  traffic: number;
  from: PathShape | null;
  to: PathShape | null;
  /** Blend from `from` (0) to `to` (1); overshoots on the upgrade spring. */
  blend: Spring;
  spring: SpringConstants;
  blending: boolean;
  current: Float32Array;
  table: ArcLengthTable;
  /** Reduced motion: the previous shape fades out over CROSSFADE_SECONDS. */
  fade: { shape: PathShape; progress: number } | null;
  probe: Probe | null;
  /** The direct line the probes traced, fading out while the released path swings across it. */
  trace: { table: ArcLengthTable; start: number } | null;
  warnStart: number;
  pulseStart: number;
  emphasis: Spring;
  presence: number;
  removed: boolean;
  outbound: Emitter;
  inbound: Emitter;
  seed: number;
}

/** Poisson spawning: accumulated rate · dt against an exponential draw. */
interface Emitter {
  accumulator: number;
  next: number;
}

interface Packet {
  track: PeerTrack;
  outbound: boolean;
  /** Progress along the path, 0 at the sender. */
  u: number;
}

interface Flash {
  x: number;
  y: number;
  start: number;
  /** The path it belongs to: a dimmed path flashes dimmed. */
  track: PeerTrack;
}

/** Everything the animation loop owns. Lives in a ref, never in React state. */
interface MeshEngine {
  tracks: Map<string, PeerTrack>;
  packets: Packet[];
  flashes: Flash[];
  sparks: Sparks;
  model: MeshModel | null;
  view: MeshView | null;
  selected: string | null;
  visible: boolean;
  synced: boolean;
  prespawned: boolean;
  layoutKey: string;
  projection: MapProjection | null;
  lattice: DotLattice | null;
  /** Map width relative to the nominal box; scales packet and probe speed. */
  scale: number;
  width: number;
  height: number;
  /** Where the map sits on the effects canvas, which reaches past it on every side. */
  fxX: number;
  fxY: number;
  devicePoint: { x: number; y: number } | null;
  relayPoints: Map<string, { x: number; y: number }>;
  ink: GeoInk | null;
  inkStale: boolean;
  baked: boolean;
  /** Start of the first-view reveal in seconds, or null before it. */
  revealStart: number | null;
  /** The reveal has played (or was skipped); later bakes draw the lattice at once. */
  revealed: boolean;
  pathsDirty: boolean;
  fxDirty: boolean;
  onRelease: (id: string) => void;
}

function createEngine(): MeshEngine {
  return {
    tracks: new Map(),
    packets: [],
    flashes: [],
    sparks: new Sparks(),
    model: null,
    view: null,
    selected: null,
    visible: false,
    synced: false,
    prespawned: false,
    layoutKey: "",
    projection: null,
    lattice: null,
    scale: 1,
    width: 0,
    height: 0,
    fxX: 0,
    fxY: 0,
    devicePoint: null,
    relayPoints: new Map(),
    ink: null,
    inkStale: true,
    baked: false,
    revealStart: null,
    revealed: false,
    pathsDirty: true,
    fxDirty: false,
    onRelease: () => {},
  };
}

/** An exponential draw with mean 1: the gap to the next arrival of a Poisson process, in units of rate · time. */
const exponential = () => -Math.log(1 - Math.random());

const configOf = (path: ShownPath) => (path.relayId === null ? DIRECT : path.relayId);

/**
 * Brings the tracks in line with the data. The first sync shows everything as it is (the paths grow in with the
 * first-view reveal); later ones animate.
 */
function syncEngine(engine: MeshEngine, model: MeshModel, view: MeshView, now: number) {
  const initial = !engine.synced;
  const reduced = prefersReducedMotion();
  engine.model = model;
  if (engine.view?.key !== view.key) {
    engine.view = view;
    engine.layoutKey = "";
  }
  const animate = !initial && engine.visible && engine.projection !== null && !reduced;
  const keep = new Set<string>();
  for (const peer of model.peers) {
    const path = peer.path;
    if (!path || !model.device) continue;
    const id = peer.device.id;
    keep.add(id);
    const config = configOf(path);
    const existing = engine.tracks.get(id);
    if (existing && !existing.removed) {
      existing.traffic = path.traffic;
      if (existing.place.lat !== peer.device.lat || existing.place.lon !== peer.device.lon) {
        existing.place = { lat: peer.device.lat, lon: peer.device.lon };
        existing.config = config;
        if (engine.projection) placeTrack(engine, existing);
        continue;
      }
      retarget(engine, existing, config, now, animate);
      continue;
    }
    // a new path grows out of this device, with the first-view reveal or on screen; elsewhere it is simply there
    const present = reduced || (engine.revealed && (initial || !animate));
    const track = createTrack(id, peer.device, config, path.traffic, present);
    engine.tracks.set(id, track);
    if (engine.projection) placeTrack(engine, track);
  }
  for (const track of engine.tracks.values()) {
    if (keep.has(track.id) || track.removed) continue;
    track.removed = true;
    track.probe = null;
  }
  engine.synced = true;
  engine.pathsDirty = true;
}

function createTrack(id: string, place: LatLon, config: string, traffic: number, present: boolean): PeerTrack {
  return {
    id,
    place: { lat: place.lat, lon: place.lon },
    point: { x: 0, y: 0 },
    config,
    traffic,
    from: null,
    to: null,
    blend: { position: 1, velocity: 0 },
    spring: FALLBACK_SPRING,
    blending: false,
    current: new Float32Array(SAMPLES * 2),
    table: buildArcLength(NO_POINTS, NO_POINTS, 0),
    fade: null,
    probe: null,
    trace: null,
    warnStart: -Infinity,
    pulseStart: -Infinity,
    emphasis: { position: 1, velocity: 0 },
    presence: present ? 1 : 0,
    removed: false,
    outbound: { accumulator: 0, next: exponential() },
    inbound: { accumulator: 0, next: exponential() },
    seed: (stringHash(id) % 9973) + 0.5,
  };
}

const NO_POINTS = new Float32Array(0);

/** Computes a track's screen point and settles it on its current config (layout, moves). */
function placeTrack(engine: MeshEngine, track: PeerTrack) {
  const projection = engine.projection;
  if (!projection) return;
  const point = createScreenPoint();
  projection.project(track.place.lat, track.place.lon, point);
  track.point = { x: point.x, y: point.y };
  const shape = shapeFor(engine, track, track.config);
  // a direct path is settled at once, so the list never keeps waiting for probes that will not meet (no-op otherwise)
  if (track.config === DIRECT) engine.onRelease(track.id);
  track.from = shape;
  track.to = shape;
  track.blend = { position: 1, velocity: 0 };
  track.blending = false;
  track.fade = null;
  track.probe = null;
  track.trace = null;
  track.current.set(shape.points);
  rebuildTable(track);
}

function rebuildTable(track: PeerTrack) {
  const points = track.current;
  for (let i = 0; i < SAMPLES; i++) {
    tableX[i] = points[i * 2];
    tableY[i] = points[i * 2 + 1];
  }
  track.table = buildArcLength(tableX, tableY, SAMPLES, track.table);
}

const tableX = new Float32Array(SAMPLES);
const tableY = new Float32Array(SAMPLES);
const legX = new Float32Array(LEG_SEGMENTS * 2 + 1);
const legY = new Float32Array(LEG_SEGMENTS * 2 + 1);
const legCurve: QuadCurve = { x0: 0, y0: 0, cx: 0, cy: 0, x1: 0, y1: 0 };
const legPoint = { x: 0, y: 0 };
let legTable: ArcLengthTable | undefined;
let resampledTable: ArcLengthTable | undefined;

/** Samples one curved leg into the scratch polyline from `offset`; the joint is not repeated. */
function sampleLeg(x0: number, y0: number, x1: number, y1: number, bend: number, offset: number) {
  flatCurve(x0, y0, x1, y1, upward(x0, x1, bend), legCurve);
  let count = offset;
  for (let i = offset === 0 ? 0 : 1; i <= LEG_SEGMENTS; i++) {
    quadPoint(legCurve, i / LEG_SEGMENTS, legPoint);
    legX[count] = legPoint.x;
    legY[count] = legPoint.y;
    count++;
  }
  return count;
}

/**
 * The shape of a config: a direct curve, or two legs through the relay. Both are resampled to SAMPLES points by arc
 * length, so a relayed and a direct path blend point by point. Longitudes are relative to this device's meridian, so
 * every shape lives in one frame. A relay id that is not in `relays` gives the direct curve in the relayed style.
 */
function shapeFor(engine: MeshEngine, track: PeerTrack, config: string): PathShape {
  const device = engine.devicePoint ?? track.point;
  const relay = config === DIRECT ? undefined : engine.relayPoints.get(config);
  let count: number;
  let joint = -1;
  if (relay) {
    count = sampleLeg(device.x, device.y, relay.x, relay.y, RELAY_BEND, 0);
    joint = count - 1;
    count = sampleLeg(relay.x, relay.y, track.point.x, track.point.y, RELAY_BEND, count);
  } else {
    count = sampleLeg(device.x, device.y, track.point.x, track.point.y, DIRECT_BEND, 0);
  }
  legTable = buildArcLength(legX, legY, count, legTable);
  const vertexShare = joint >= 0 && legTable.length > 0 ? legTable.distances[joint] / legTable.length : -1;
  resampledTable = resampleArcLength(legTable, SAMPLES, resampledTable);
  const points = new Float32Array(SAMPLES * 2);
  for (let i = 0; i < SAMPLES; i++) {
    points[i * 2] = resampledTable.xs[i];
    points[i * 2 + 1] = resampledTable.ys[i];
  }
  return {
    points,
    relayX: relay ? relay.x : Number.NaN,
    relayY: relay ? relay.y : Number.NaN,
    vertex: vertexShare >= 0 ? Math.round(vertexShare * (SAMPLES - 1)) : -1,
    style: config === DIRECT ? 1 : 0,
  };
}

/** The style a track shows now: the upgrade turns accent in the first part of its swing. */
function currentStyle(track: PeerTrack) {
  const from = track.from?.style ?? 0;
  const to = track.to?.style ?? 0;
  return lerp(from, to, smoothstep(0, 0.65, track.blend.position));
}

/** The shape a track shows now, as a new shape (for the start of the next blend). */
function snapshot(track: PeerTrack): PathShape {
  const anchor = (track.blend.position >= 0.5 ? track.to : track.from) ?? track.to;
  return {
    points: Float32Array.from(track.current),
    relayX: anchor ? anchor.relayX : Number.NaN,
    relayY: anchor ? anchor.relayY : Number.NaN,
    vertex: anchor ? anchor.vertex : -1,
    style: currentStyle(track),
  };
}

function startBlend(track: PeerTrack, target: PathShape, spring: SpringConstants) {
  track.from = snapshot(track);
  track.to = target;
  track.blend = { position: 0, velocity: 0 };
  track.spring = spring;
  track.blending = true;
}

/** Jumps a track to a shape and lets the previous one fade out: reduced motion and off-screen changes. */
function settleWithCrossfade(track: PeerTrack, target: PathShape) {
  track.fade = { shape: snapshot(track), progress: 0 };
  track.from = target;
  track.to = target;
  track.blend = { position: 1, velocity: 0 };
  track.blending = false;
  track.probe = null;
  track.current.set(target.points);
  rebuildTable(track);
}

/** A track's config changed: probe and release (upgrade), bend back (fallback), or swap relays. */
function retarget(engine: MeshEngine, track: PeerTrack, config: string, now: number, animate: boolean) {
  if (track.config === config) return;
  const previous = track.config;
  track.config = config;
  if (!engine.projection || !track.to) {
    // not laid out yet: the layout settles it on the new config
    if (config === DIRECT) engine.onRelease(track.id);
    return;
  }
  const target = shapeFor(engine, track, config);
  if (track.probe) {
    // the probes had not met yet: the path never left its relay, so it only swaps relays (or stays)
    track.probe = null;
    startBlend(track, target, SWITCH_SPRING);
    return;
  }
  if (!animate) {
    settleWithCrossfade(track, target);
    if (config === DIRECT) engine.onRelease(track.id);
    return;
  }
  if (config === DIRECT && previous !== DIRECT) {
    // two probes run toward each other along the direct line; the path lets go when they meet
    const xs = new Float32Array(SAMPLES);
    const ys = new Float32Array(SAMPLES);
    for (let i = 0; i < SAMPLES; i++) {
      xs[i] = target.points[i * 2];
      ys[i] = target.points[i * 2 + 1];
    }
    const table = buildArcLength(xs, ys, SAMPLES);
    const duration = clamp(table.length / 2 / (PROBE_SPEED * engine.scale), PROBE_MIN_SECONDS, PROBE_MAX_SECONDS);
    track.probe = { start: now, duration, target, table };
    return;
  }
  if (previous === DIRECT) track.warnStart = now;
  startBlend(track, target, previous === DIRECT ? FALLBACK_SPRING : SWITCH_SPRING);
}

const meetPoint = { x: 0, y: 0, angle: 0 };

/** The probes met: flash the dots there, release the path on the string spring, throw sparks off the relay. */
function releaseTrack(engine: MeshEngine, track: PeerTrack, probe: Probe, now: number, late: boolean) {
  const anchor = track.blend.position >= 0.5 ? track.to : track.from;
  const relayX = anchor?.relayX ?? Number.NaN;
  const relayY = anchor?.relayY ?? Number.NaN;
  const vertex = anchor?.vertex ?? -1;
  startBlend(track, probe.target, UPGRADE_SPRING);
  track.probe = null;
  engine.onRelease(track.id);
  // a probe that ran while the map was off screen releases without the flash
  if (late) return;
  track.trace = { table: probe.table, start: now };
  pointAtDistance(probe.table, probe.table.length / 2, meetPoint);
  engine.flashes.push({ x: meetPoint.x, y: meetPoint.y, start: now, track });
  const ink = engine.ink;
  if (ink && Number.isFinite(relayX) && vertex >= 0) {
    // the sparks leave the relay in the direction the path pulled away
    const angle = Math.atan2(probe.target.points[vertex * 2 + 1] - relayY, probe.target.points[vertex * 2] - relayX);
    const count = Math.max(3, Math.round(SPARK_COUNT * clamp(track.emphasis.position, 0, 1)));
    engine.sparks.add(relayX + engine.fxX, relayY + engine.fxY, count, [hotColor(ink), ink.accent], {
      angle,
      spread: 1.2,
      speed: [50, 180],
      life: [0.35, 0.8],
      size: [1.5, 2],
      drag: 2.2,
      jitter: 1.5,
    });
  }
}

/** Theme change: new ink, and the static lattice is baked again. */
function refreshInk(engine: MeshEngine, palette: GeoPalette) {
  engine.ink = geoInk(palette);
  engine.inkStale = false;
  engine.baked = false;
  engine.pathsDirty = true;
}

/** A new box width or view: rebuild the projection, the lattice and every path. */
function layoutEngine(engine: MeshEngine, width: number, key: string) {
  const view = engine.view;
  const model = engine.model;
  if (!view || !model) return;
  const projection = viewProjection(view, width);
  engine.projection = projection;
  engine.width = width;
  engine.height = width / ASPECT;
  engine.lattice = mapLattice(projection, { pitch: width < 420 ? 3 : 4 });
  engine.scale = clamp(width / NOMINAL_BOX_WIDTH, 0.6, 1.25);
  const point = createScreenPoint();
  if (model.device) {
    projection.project(model.device.lat, model.device.lon, point);
    engine.devicePoint = { x: point.x, y: point.y };
  } else engine.devicePoint = null;
  engine.relayPoints = new Map();
  for (const relay of model.relays) {
    projection.project(relay.lat, relay.lon, point);
    engine.relayPoints.set(relay.id, { x: point.x, y: point.y });
  }
  engine.layoutKey = key;
  engine.baked = false;
  engine.pathsDirty = true;
  for (const track of engine.tracks.values()) placeTrack(engine, track);
  engine.packets.length = 0;
  // the first layout leaves the paths to grow in with the reveal; later ones refill them at once
  engine.prespawned = !engine.revealed;
}

const latticeDotSize = (lattice: DotLattice) => (lattice.pitch >= 4 ? 1.6 : 1.3);

/** Bakes the land lattice, or draws a frame of the first-view reveal. Returns whether the reveal is still running. */
function drawBase(
  engine: MeshEngine,
  surface: CanvasSurface,
  lattice: DotLattice,
  ink: GeoInk,
  time: number,
  reduced: boolean,
) {
  if (engine.baked) return false;
  if (!engine.revealed && !reduced) {
    const start = engine.revealStart ?? time;
    engine.revealStart = start;
    const progress = (time - start) / REVEAL_SECONDS;
    if (progress < 1) {
      drawReveal(surface, lattice, ink, engine.devicePoint, easeOutCubic(progress));
      return true;
    }
  }
  const { context, width, height } = surface;
  context.clearRect(0, 0, width, height);
  bakeLattice(context, lattice, ink.land, latticeDotSize(lattice), BASE_ALPHA);
  engine.baked = true;
  engine.revealed = true;
  return false;
}

/**
 * The first view: the land lights up from this device outward behind an uneven front (threshold = n·0.82 + jitter·0.18),
 * the dots at the front briefly in the accent colour before they settle into the quiet land ink.
 */
function drawReveal(
  surface: CanvasSurface,
  lattice: DotLattice,
  ink: GeoInk,
  origin: { x: number; y: number } | null,
  progress: number,
) {
  const { context, width, height } = surface;
  context.clearRect(0, 0, width, height);
  const ox = origin ? origin.x : width / 2;
  const oy = origin ? origin.y : height / 2;
  const reach = Math.max(
    1,
    Math.hypot(ox, oy),
    Math.hypot(width - ox, oy),
    Math.hypot(ox, height - oy),
    Math.hypot(width - ox, height - oy),
  );
  const size = latticeDotSize(lattice);
  const half = size / 2;
  const front = progress * (1 + REVEAL_SOFTNESS);
  const level = (i: number) => {
    const threshold = (Math.hypot(lattice.x[i] - ox, lattice.y[i] - oy) / reach) * 0.82 + lattice.jitter[i] * 0.18;
    return clamp((front - threshold) / REVEAL_SOFTNESS, 0, 1);
  };
  // settled dots in one fill, then the front dot by dot
  context.fillStyle = rgba(ink.land);
  context.globalAlpha = BASE_ALPHA;
  for (let i = 0; i < lattice.count; i++) {
    if (level(i) >= 1) context.fillRect(lattice.x[i] - half, lattice.y[i] - half, size, size);
  }
  const tints: string[] = [];
  for (let k = 0; k < REVEAL_TINTS; k++) tints.push(rgba(mixRgb(ink.accent, ink.land, k / (REVEAL_TINTS - 1))));
  for (let i = 0; i < lattice.count; i++) {
    const t = level(i);
    if (t <= 0 || t >= 1) continue;
    context.fillStyle = tints[Math.min(REVEAL_TINTS - 1, Math.floor(t * REVEAL_TINTS))];
    context.globalAlpha = lerp(0.95, BASE_ALPHA, t) * smoothstep(0, 0.2, t);
    context.fillRect(lattice.x[i] - half, lattice.y[i] - half, size, size);
  }
  context.globalAlpha = 1;
}

/** Whether new paths may grow yet: after the land front has left this device on first view. */
const pathsMayGrow = (engine: MeshEngine, time: number) =>
  engine.revealed || (engine.revealStart !== null && time - engine.revealStart >= PATH_DELAY);

/** Steps probes, blends, emphasis, presence, warning tints and crossfades. Returns whether the paths canvas changed. */
function advanceTracks(engine: MeshEngine, time: number, delta: number, reduced: boolean) {
  let moving = false;
  for (const track of engine.tracks.values()) {
    if (!track.to) continue;
    const probe = track.probe;
    if (probe) {
      const progress = (time - probe.start) / probe.duration;
      if (reduced) {
        settleWithCrossfade(track, probe.target);
        engine.onRelease(track.id);
        moving = true;
      } else if (progress >= 1) {
        releaseTrack(engine, track, probe, time, progress > 3);
        moving = true;
      }
    }
    if (track.blending && track.from && track.to) {
      const still = !settleSpring(track.blend, 1, delta, reduced, track.spring);
      const b = track.blend.position;
      const from = track.from.points;
      const to = track.to.points;
      for (let i = 0; i < SAMPLES * 2; i++) track.current[i] = from[i] + (to[i] - from[i]) * b;
      rebuildTable(track);
      if (still) {
        track.blending = false;
        track.from = track.to;
      }
      moving = true;
    }
    const emphasisTarget = engine.selected === null || engine.selected === track.id ? 1 : DIMMED;
    if (settleSpring(track.emphasis, emphasisTarget, delta, reduced, EMPHASIS_SPRING)) moving = true;
    const presenceTarget = track.removed ? 0 : 1;
    if (track.presence !== presenceTarget) {
      if (reduced) track.presence = presenceTarget;
      else if (presenceTarget < track.presence) {
        track.presence = Math.max(0, track.presence - delta / (PRESENCE_SECONDS * 0.6));
      } else if (pathsMayGrow(engine, time)) {
        track.presence = Math.min(1, track.presence + delta / PRESENCE_SECONDS);
      }
      moving = true;
    }
    if (time - track.warnStart < WARN_SECONDS + 0.05) moving = true;
    if (track.fade) {
      track.fade.progress += delta / CROSSFADE_SECONDS;
      if (track.fade.progress >= 1) track.fade = null;
      moving = true;
    }
  }
  return moving;
}

/** Forgets tracks that have faded out, with their packets. */
function pruneTracks(engine: MeshEngine) {
  for (const track of engine.tracks.values()) {
    if (!track.removed || track.presence > 0) continue;
    engine.tracks.delete(track.id);
    engine.packets = engine.packets.filter((packet) => packet.track !== track);
  }
}

/** The warm end of an effect: the glint on dark cards, a deeper violet on light ones, where the glint would wash out. */
const hotColor = (ink: GeoInk): RGB => (ink.dark ? ink.glint : mixRgb(ink.accent, ink.shine, 0.45));

/** 1 outside a marker's gap, rising from 0 at the gap's edge over 4 px. */
const gapFade = (x: number, y: number, cx: number, cy: number, gap: number) =>
  smoothstep(gap, gap + 4, Math.hypot(x - cx, y - cy));

/** One shape to draw: its points, its style and the relays it runs through, as the blend stands. */
interface ShapeFrame {
  points: Float32Array;
  style: number;
  from: PathShape | null;
  to: PathShape | null;
  blend: number;
}

/**
 * Every path as dots every 3.5 px from this device. Relayed: grey dashes, two dots on and one off, with a gap around
 * the relay. Direct: accent dots. A blend mixes the two styles; a fallback tints the path in the warning colour for a
 * moment; with a selection the other paths dim to 0.3.
 */
function drawPaths(engine: MeshEngine, surface: CanvasSurface, ink: GeoInk, time: number) {
  const { context, width, height, dpr } = surface;
  context.clearRect(0, 0, width, height);
  for (const track of engine.tracks.values()) {
    if (!track.to || track.presence <= 0.002) continue;
    const emphasis = clamp(track.emphasis.position, 0, 1);
    const warn = 1 - clamp((time - track.warnStart) / WARN_SECONDS, 0, 1);
    const current: ShapeFrame = {
      points: track.current,
      style: currentStyle(track),
      from: track.from,
      to: track.to,
      blend: track.blend.position,
    };
    const fade = track.fade;
    if (fade) {
      const f = clamp(fade.progress, 0, 1);
      const previous: ShapeFrame = {
        points: fade.shape.points,
        style: fade.shape.style,
        from: fade.shape,
        to: null,
        blend: 0,
      };
      drawShape(context, engine, track, previous, (1 - f) * emphasis, warn, ink, dpr);
      drawShape(context, engine, track, { ...current, blend: 1 }, f * emphasis, warn, ink, dpr);
    } else {
      drawShape(context, engine, track, current, emphasis, warn, ink, dpr);
    }
  }
  context.globalAlpha = 1;
}

const shapeX = new Float32Array(SAMPLES);
const shapeY = new Float32Array(SAMPLES);
let shapeTable: ArcLengthTable | undefined;

function drawShape(
  context: CanvasRenderingContext2D,
  engine: MeshEngine,
  track: PeerTrack,
  shape: ShapeFrame,
  strength: number,
  warn: number,
  ink: GeoInk,
  dpr: number,
) {
  if (strength <= 0.01) return;
  for (let i = 0; i < SAMPLES; i++) {
    shapeX[i] = shape.points[i * 2];
    shapeY[i] = shape.points[i * 2 + 1];
  }
  shapeTable = buildArcLength(shapeX, shapeY, SAMPLES, shapeTable);
  const table = shapeTable;
  const length = table.length;
  if (length <= 0) return;
  const device = engine.devicePoint;
  const peer = track.point;
  const { from, to } = shape;
  // the relay gaps follow the share of the path that still runs through each relay
  const fromWeight = from && Number.isFinite(from.relayX) ? clamp(1 - shape.blend, 0, 1) : 0;
  const toWeight = to && Number.isFinite(to.relayX) ? clamp(shape.blend, 0, 1) : 0;
  const s = clamp(shape.style, 0, 1);
  const selected = engine.selected === track.id;
  const directAlpha = selected ? 0.9 : DIRECT_ALPHA;
  const relayedAlpha = selected ? 1 : RELAYED_ALPHA;
  const base = mixRgb(ink.landStrong, ink.accent, s);
  const color = warn > 0 ? mixRgb(base, ink.warning, warn * 0.9) : base;
  context.fillStyle = rgba(color);
  const presence = track.presence;
  let lastAlpha = -1;
  forEachDot(table, DOT_SPACING, 0, length, (x, y, distance) => {
    let fade = gapFade(x, y, peer.x, peer.y, PEER_GAP);
    if (device) fade *= gapFade(x, y, device.x, device.y, DEVICE_GAP);
    if (fromWeight > 0 && from) fade *= 1 - fromWeight * (1 - gapFade(x, y, from.relayX, from.relayY, RELAY_GAP));
    if (toWeight > 0 && to) fade *= 1 - toWeight * (1 - gapFade(x, y, to.relayX, to.relayY, RELAY_GAP));
    if (fade <= 0.02) return;
    const on = Math.round(distance / DOT_SPACING) % 3 !== 2;
    let alpha = (on ? lerp(relayedAlpha, directAlpha, s) : directAlpha * s) * fade * strength;
    if (presence < 1) {
      // a new path grows out of this device behind an uneven front, and retracts into it when it goes offline
      const threshold = (distance / length) * 0.82 + hash(track.seed + distance * 0.37) * 0.18;
      alpha *= clamp((presence * (1 + GROWTH_SOFTNESS) - threshold) / GROWTH_SOFTNESS, 0, 1);
    }
    if (alpha < 0.02) return;
    const quantised = Math.round(alpha * 32) / 32;
    if (quantised !== lastAlpha) {
      context.globalAlpha = quantised;
      lastAlpha = quantised;
    }
    // on the device pixel grid, so paths read as crisp pixel rows like the lattice under them, not a soft smear
    context.fillRect(
      snapCenter(x, PATH_DOT, dpr) - PATH_DOT / 2,
      snapCenter(y, PATH_DOT, dpr) - PATH_DOT / 2,
      PATH_DOT,
      PATH_DOT,
    );
  });
}

/** Packets per second in one direction. */
const packetRate = (track: PeerTrack) => 0.5 + 2.5 * track.traffic;

/** Whether a track carries packets now: present, and selected or nothing is selected. */
const carriesPackets = (engine: MeshEngine, track: PeerTrack) =>
  !track.removed &&
  track.presence >= 1 &&
  track.table.length > 0 &&
  (engine.selected === null || engine.selected === track.id);

function anyCarrier(engine: MeshEngine) {
  for (const track of engine.tracks.values()) if (carriesPackets(engine, track)) return true;
  return false;
}

/** Packets already on their way after a relayout, so the paths never stand empty. */
function prespawn(engine: MeshEngine) {
  const speed = PACKET_SPEED * engine.scale;
  for (const track of engine.tracks.values()) {
    if (!carriesPackets(engine, track)) continue;
    const expected = (packetRate(track) * track.table.length) / speed;
    for (const outbound of [true, false]) {
      const count = Math.floor(expected + Math.random());
      for (let i = 0; i < count && engine.packets.length < PACKET_LIMIT; i++) {
        engine.packets.push({ track, outbound, u: Math.random() });
      }
    }
  }
  engine.prespawned = engine.tracks.size > 0;
}

function spawnPackets(engine: MeshEngine, delta: number) {
  const speed = PACKET_SPEED * engine.scale;
  for (const track of engine.tracks.values()) {
    if (!carriesPackets(engine, track)) continue;
    const rate = packetRate(track);
    for (const outbound of [true, false]) {
      const emitter = outbound ? track.outbound : track.inbound;
      emitter.accumulator += rate * delta;
      while (emitter.accumulator >= emitter.next) {
        emitter.accumulator -= emitter.next;
        emitter.next = exponential();
        // the oldest packet makes room
        if (engine.packets.length >= PACKET_LIMIT) engine.packets.shift();
        // start a little along the path, by how long ago within this frame the arrival fell
        const u = Math.min(1, ((emitter.accumulator / rate) * speed) / Math.max(1, track.table.length));
        engine.packets.push({ track, outbound, u });
      }
    }
  }
}

function movePackets(engine: MeshEngine, delta: number) {
  const speed = PACKET_SPEED * engine.scale;
  const packets = engine.packets;
  let alive = 0;
  for (let i = 0; i < packets.length; i++) {
    const packet = packets[i];
    const length = packet.track.table.length;
    if (length <= 0 || packet.track.removed) continue;
    packet.u += (speed * delta) / length;
    if (packet.u >= 1) continue;
    packets[alive++] = packet;
  }
  packets.length = alive;
}

const fxPoint = { x: 0, y: 0, angle: 0 };

/**
 * The effects canvas reaches past the map. Packets, probes, the selection pulse and the meet flash stay inside the
 * map; sparks fly past its edge. Returns whether anything is still animating.
 */
function drawEffects(
  engine: MeshEngine,
  surface: CanvasSurface,
  ink: GeoInk,
  time: number,
  delta: number,
  reduced: boolean,
) {
  const { context, width, height, dpr } = surface;
  engine.flashes = reduced ? [] : engine.flashes.filter((flash) => time - flash.start < FLASH_SECONDS);
  if (reduced) engine.sparks.clear();
  let probing = false;
  let pulsing = false;
  for (const track of engine.tracks.values()) {
    if (track.trace && (reduced || time - track.trace.start >= TRACE_SECONDS)) track.trace = null;
    if (track.probe || track.trace) probing = true;
    if (time - track.pulseStart < PULSE_SECONDS) pulsing = true;
  }
  const busy = engine.packets.length > 0 || engine.flashes.length > 0 || engine.sparks.active || probing || pulsing;
  if (!busy) {
    if (engine.fxDirty) {
      context.clearRect(0, 0, width, height);
      engine.fxDirty = false;
    }
    return false;
  }
  engine.fxDirty = true;
  context.clearRect(0, 0, width, height);
  context.save();
  context.beginPath();
  context.rect(engine.fxX, engine.fxY, engine.width, engine.height);
  context.clip();
  context.translate(engine.fxX, engine.fxY);
  const hot = hotColor(ink);
  drawFlashes(context, engine, ink, hot, time);
  drawPackets(context, engine, ink, dpr);
  drawProbes(context, engine, ink, hot, time, dpr);
  drawPulses(context, engine, hot, time, dpr);
  context.restore();
  engine.sparks.step(context, delta);
  context.globalAlpha = 1;
  return true;
}

/** Light at the meet point: the dot grid lights in an uneven ring that runs out to 18 px, over land and water alike. */
function drawFlashes(context: CanvasRenderingContext2D, engine: MeshEngine, ink: GeoInk, hot: RGB, time: number) {
  const lattice = engine.lattice;
  const projection = engine.projection;
  if (!lattice || !projection || engine.flashes.length === 0) return;
  const pitch = lattice.pitch;
  const size = latticeDotSize(lattice);
  const { x0, y0 } = projection.frame;
  for (const flash of engine.flashes) {
    const age = clamp((time - flash.start) / FLASH_SECONDS, 0, 1);
    const radius = easeOutCubic(age) * FLASH_RADIUS;
    const fade = (1 - age * age) * clamp(flash.track.emphasis.position, 0, 1);
    const reach = radius + 10;
    const firstColumn = Math.ceil((flash.x - reach - x0) / pitch - 0.5);
    const lastColumn = Math.floor((flash.x + reach - x0) / pitch - 0.5);
    const firstRow = Math.ceil((flash.y - reach - y0) / pitch - 0.5);
    const lastRow = Math.floor((flash.y + reach - y0) / pitch - 0.5);
    for (let row = firstRow; row <= lastRow; row++) {
      const y = y0 + (row + 0.5) * pitch;
      for (let column = firstColumn; column <= lastColumn; column++) {
        const x = x0 + (column + 0.5) * pitch;
        const distance = Math.hypot(x - flash.x, y - flash.y);
        if (distance > reach) continue;
        const jitter = hash(row * 57.31 + column * 13.17);
        const front = ringFront(distance, radius, 4, jitter, 4);
        const core = distance < radius ? 0.35 * (1 - distance / Math.max(1, radius)) * (1 - age) : 0;
        const alpha = clamp((front + core) * fade, 0, 1);
        if (alpha < 0.04) continue;
        context.globalAlpha = Math.round(alpha * 24) / 24;
        context.fillStyle = rgba(mixRgb(ink.accent, hot, clamp(front, 0, 1)));
        context.fillRect(x - size / 2, y - size / 2, size, size);
      }
    }
  }
  context.globalAlpha = 1;
}

/** Packets: a 2 px head and three fading tail squares, outbound in the accent colour and inbound in the info colour. */
function drawPackets(context: CanvasRenderingContext2D, engine: MeshEngine, ink: GeoInk, dpr: number) {
  const device = engine.devicePoint;
  for (const outbound of [true, false]) {
    context.fillStyle = rgba(outbound ? ink.accent : ink.info);
    for (const packet of engine.packets) {
      if (packet.outbound !== outbound) continue;
      const track = packet.track;
      const table = track.table;
      const length = table.length;
      const strength = clamp(track.emphasis.position, 0, 1) * track.presence;
      if (length <= 0 || strength <= 0.02) continue;
      const head = outbound ? packet.u * length : (1 - packet.u) * length;
      const relay = track.blend.position >= 0.5 ? track.to : track.from;
      for (let k = 0; k < TAIL_ALPHA.length; k++) {
        const s = outbound ? head - k * TAIL_GAP : head + k * TAIL_GAP;
        if (s < 0 || s > length) break;
        pointAtDistance(table, s, fxPoint);
        // packets slip into the markers and out of them, instead of running across them
        let fade = gapFade(fxPoint.x, fxPoint.y, track.point.x, track.point.y, PEER_GAP - 2);
        if (device) fade *= gapFade(fxPoint.x, fxPoint.y, device.x, device.y, DEVICE_GAP - 2);
        if (relay && Number.isFinite(relay.relayX)) {
          fade *= gapFade(fxPoint.x, fxPoint.y, relay.relayX, relay.relayY, RELAY_GAP - 3);
        }
        const alpha = TAIL_ALPHA[k] * strength * fade;
        if (alpha < 0.03) continue;
        const size = k === 0 ? HEAD_SIZE : TAIL_SIZE;
        context.globalAlpha = Math.round(alpha * 24) / 24;
        context.fillRect(
          snapCenter(fxPoint.x, size, dpr) - size / 2,
          snapCenter(fxPoint.y, size, dpr) - size / 2,
          size,
          size,
        );
      }
    }
  }
  context.globalAlpha = 1;
}

/** The probes of an upgrade, leaving a faint trace of the direct line behind them. */
function drawProbes(
  context: CanvasRenderingContext2D,
  engine: MeshEngine,
  ink: GeoInk,
  hot: RGB,
  time: number,
  dpr: number,
) {
  const device = engine.devicePoint;
  for (const track of engine.tracks.values()) {
    const strength = clamp(track.emphasis.position, 0, 1);
    const afterglow = track.trace;
    if (afterglow) {
      const fade = 1 - clamp((time - afterglow.start) / TRACE_SECONDS, 0, 1);
      drawTrace(
        context,
        afterglow.table,
        track,
        device,
        0,
        afterglow.table.length,
        0.32 * fade * strength,
        ink.accent,
        dpr,
      );
    }
    const probe = track.probe;
    if (!probe) continue;
    const table = probe.table;
    const reach = clamp((time - probe.start) / probe.duration, 0, 1) * (table.length / 2);
    drawTrace(context, table, track, device, 0, reach, 0.32 * strength, ink.accent, dpr);
    drawTrace(context, table, track, device, table.length - reach, table.length, 0.32 * strength, ink.accent, dpr);
    // one probe leaves this device, the other the peer; each trails three fading squares
    context.fillStyle = rgba(hot);
    for (const [head, direction] of PROBE_HEADS) {
      const start = head === 0 ? reach : table.length - reach;
      for (let k = 0; k < TAIL_ALPHA.length; k++) {
        const s = start + direction * k * TAIL_GAP;
        if (s < 0 || s > table.length) break;
        pointAtDistance(table, s, fxPoint);
        const size = k === 0 ? HEAD_SIZE : TAIL_SIZE;
        context.globalAlpha = TAIL_ALPHA[k] * strength;
        context.fillRect(
          snapCenter(fxPoint.x, size, dpr) - size / 2,
          snapCenter(fxPoint.y, size, dpr) - size / 2,
          size,
          size,
        );
      }
    }
  }
  context.globalAlpha = 1;
}

/** The two probes: which end each starts from (0 this device, 1 the peer) and which way its tail points. */
const PROBE_HEADS: readonly (readonly [head: 0 | 1, direction: -1 | 1])[] = [
  [0, -1],
  [1, 1],
];

/** The faint direct line behind the probes, between two distances along it. */
function drawTrace(
  context: CanvasRenderingContext2D,
  table: ArcLengthTable,
  track: PeerTrack,
  device: { x: number; y: number } | null,
  from: number,
  to: number,
  alpha: number,
  color: RGB,
  dpr: number,
) {
  if (alpha <= 0.01) return;
  context.fillStyle = rgba(color);
  forEachDot(table, DOT_SPACING, from, to, (x, y) => {
    let fade = gapFade(x, y, track.point.x, track.point.y, PEER_GAP);
    if (device) fade *= gapFade(x, y, device.x, device.y, DEVICE_GAP);
    context.globalAlpha = alpha * fade;
    context.fillRect(
      snapCenter(x, PATH_DOT, dpr) - PATH_DOT / 2,
      snapCenter(y, PATH_DOT, dpr) - PATH_DOT / 2,
      PATH_DOT,
      PATH_DOT,
    );
  });
}

/** A selected path is traced once from this device to the peer by a short comet. */
function drawPulses(context: CanvasRenderingContext2D, engine: MeshEngine, hot: RGB, time: number, dpr: number) {
  context.fillStyle = rgba(hot);
  for (const track of engine.tracks.values()) {
    const age = (time - track.pulseStart) / PULSE_SECONDS;
    if (age < 0 || age >= 1 || track.table.length <= 0) continue;
    const head = easeOutCubic(age) * track.table.length;
    const fade = 1 - smoothstep(0.7, 1, age);
    for (let k = 0; k < 7; k++) {
      const s = head - k * 2.6;
      if (s < 0) break;
      pointAtDistance(track.table, s, fxPoint);
      const size = k === 0 ? HEAD_SIZE : TAIL_SIZE;
      context.globalAlpha = (1 - k / 7) * fade;
      context.fillRect(
        snapCenter(fxPoint.x, size, dpr) - size / 2,
        snapCenter(fxPoint.y, size, dpr) - size / 2,
        size,
        size,
      );
    }
  }
  context.globalAlpha = 1;
}
