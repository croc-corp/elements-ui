"use client";

import * as React from "react";

import { localPoint, useCanvas, type CanvasSurface } from "@/lib/lumesec/canvas";
import { usePalette } from "@/lib/lumesec/color";
import {
  ARROW_DIRECTIONS,
  bakeLattice,
  createDotBatch,
  createProjection,
  DEG,
  GEO_TOKENS,
  geoInk,
  mapLattice,
  nearestLocation,
  ringFront,
  spatialNavigate,
  wrapLongitude,
  type DotBatch,
  type DotLattice,
  type GeoInk,
  type LatLon,
  type NavigationDirection,
} from "@/lib/lumesec/geo";
import { DEMO_CITIES, demoPoints, findCity, formatCompact, formatLatLon, formatNumber } from "@/lib/lumesec/geo-data";
import { clamp, easeOutCubic, smoothstep, TAU, type RGB } from "@/lib/lumesec/math";
import {
  prefersReducedMotion,
  settleSpring,
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

/** One location on the map. */
export interface ClusterPoint {
  /** Unique id. `value`, `defaultValue` and `onValueChange` use it. */
  readonly id: string;
  /** Latitude in degrees. Values beyond ±78° are drawn at the map's top or bottom edge. */
  readonly lat: number;
  /** Longitude in degrees. */
  readonly lon: number;
  /** Name for the tooltip, the popover and the accessible label. Without it the coordinates are used. */
  readonly label?: string;
}

/** Props of `GeoCluster`. Other `div` props go to the root. */
export interface GeoClusterProps extends Omit<React.ComponentProps<"div">, "defaultValue" | "onChange"> {
  /**
   * The locations to show. Without it the map shows 600 demo points around large cities; an empty array shows an
   * empty map with a note. Entries with a non-finite latitude or longitude are skipped.
   */
  points?: readonly ClusterPoint[];
  /** Controlled zoom, 1 to `maxZoom`. Use with `onZoomChange`. */
  zoom?: number;
  /** Zoom when uncontrolled. */
  defaultZoom?: number;
  /** Called when a zoom gesture, a click or a button press settles, with the zoom rounded to two decimals. */
  onZoomChange?: (zoom: number) => void;
  /** Controlled view centre. Use with `onCenterChange`. It is clamped so the map always fills the frame. */
  center?: LatLon;
  /** View centre when uncontrolled. */
  defaultCenter?: LatLon;
  /** Called when a pan or a zoom settles at a new centre. */
  onCenterChange?: (center: LatLon) => void;
  /** Largest zoom, at most 6 (the land data has a 0.5° grid). */
  maxZoom?: number;
  /** Clustering distance in px: points closer than this on screen merge into one cluster. */
  cellSize?: number;
  /** Selected point id (controlled). Use with `onValueChange`. */
  value?: string | null;
  /** Selected point when uncontrolled. */
  defaultValue?: string | null;
  /** Called when a point is selected or the selection is cleared. */
  onValueChange?: (value: string | null) => void;
  /** Called when a single point is clicked, or picked from a cluster's list. */
  onPointClick?: (point: ClusterPoint) => void;
  /** Called when a cluster is clicked, with its points; return `false` to stop the zoom-in. */
  onClusterClick?: (points: readonly ClusterPoint[]) => boolean | void;
  /** Accessible name of the map. */
  label?: string;
}

/**
 * A zoomable dot map for many points. Nearby points merge into clusters that show their count. Zooming in splits a
 * cluster into its children, which spring out from where the parent was; zooming out pulls them back in while the
 * parent's count rolls up as each one arrives. The land dots are re-sampled at the same pixel pitch for every zoom,
 * so coastlines sharpen as you zoom, and each cluster sits in a pool of lit dots that travels with it.
 *
 * Zoom with Ctrl or ⌘ and the wheel (or the plain wheel while the map has keyboard focus), pinch, double-click, the + and −
 * buttons or the keyboard; drag to pan.
 *
 * @example
 * <GeoCluster points={stores} onPointClick={(store) => open(store.id)} />
 */
export function GeoCluster({
  points,
  zoom,
  defaultZoom = 1,
  onZoomChange,
  center,
  defaultCenter = DEFAULT_CENTER,
  onCenterChange,
  maxZoom = MAX_ZOOM,
  cellSize = 44,
  value,
  defaultValue = null,
  onValueChange,
  onPointClick,
  onClusterClick,
  label = "Clustered map",
  className,
  ...props
}: GeoClusterProps) {
  const zoomLimit = clamp(Number.isFinite(maxZoom) ? maxZoom : MAX_ZOOM, 1, MAX_ZOOM);
  const maxLevel = Math.max(1, Math.floor(zoomLimit + 1e-6));
  const cell = clamp(Number.isFinite(cellSize) ? cellSize : 44, 16, 160);
  const reducedMotion = useReducedMotion();

  const [zoomValue, setZoomValue] = useControllableState<number>({ value: zoom, defaultValue: defaultZoom, onChange: onZoomChange });
  const [centerValue, setCenterValue] = useControllableState<LatLon>({
    value: center,
    defaultValue: defaultCenter,
    onChange: onCenterChange,
  });
  const [selected, setSelected] = useControllableState<string | null>({ value, defaultValue, onChange: onValueChange });

  /** Width the clusters are computed for: a nominal 660 px on the server, then the measured frame width. */
  const [layoutWidth, setLayoutWidth] = React.useState(NOMINAL_WIDTH);
  const data = React.useMemo(() => normalizePoints(points), [points]);
  const tree = React.useMemo(() => buildTree(data, maxLevel, cell, layoutWidth), [data, maxLevel, cell, layoutWidth]);
  const [scene, setScene] = React.useState<Scene>(() =>
    initialScene(tree, startView(zoomValue, centerValue, zoomLimit)),
  );
  const [activeKey, setActiveKey] = React.useState<string | null>(null);
  const [popover, setPopover] = React.useState<PopoverState | null>(null);
  const [hint, setHint] = React.useState(false);
  const [store] = React.useState(() => createViewStore(startView(zoomValue, centerValue, zoomLimit).z, zoomLimit));
  const descriptionId = React.useId();

  // `ref` from props lands on the root through the spread; the loop and the palette watch the map frame
  const frameRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const effectsRef = React.useRef<HTMLCanvasElement>(null);
  const popoverRef = React.useRef<HTMLDivElement>(null);

  // created on first use; the view starts from the first props
  const viewRef = useLazyRef(() => createView(zoomValue, centerValue, zoomLimit));
  const modelRef = useLazyRef(createModel);
  const runtimeRef = useLazyRef(createRuntime);
  const nodeElements = React.useRef(new Map<string, HTMLElement>());
  const treeRef = React.useRef(tree);
  const rendered = React.useRef<RenderedScene>({ view: scene.view, nodes: new Map() });
  const layoutWidthRef = React.useRef(layoutWidth);
  /** Props and callbacks the animation loop and the native listeners read. */
  const latest = React.useRef({ zoomLimit, defaultZoom, defaultCenter, selected, onPointClick, onClusterClick, popoverOpen: false });

  const loop = useAnimationLoop(frameRef, step);
  const colors = usePalette(frameRef, GEO_TOKENS, () => {
    runtimeRef.current.inkStale = true;
    loop.kick();
  });
  const surface = useCanvas(
    canvasRef,
    (next) => {
      runtimeRef.current.resized = true;
      // the clusters are computed for the frame width; small changes keep the current tree
      if (Math.abs(next.width - layoutWidthRef.current) >= 8) setLayoutWidth(Math.round(next.width));
      loop.kick();
    },
    { maxDpr: 2 },
  );
  const effects = useCanvas(effectsRef, () => loop.kick());

  React.useEffect(() => {
    layoutWidthRef.current = layoutWidth;
  }, [layoutWidth]);

  React.useEffect(() => {
    latest.current = { zoomLimit, defaultZoom, defaultCenter, selected, onPointClick, onClusterClick, popoverOpen: popover !== null };
  });

  React.useEffect(() => {
    treeRef.current = tree;
    loop.kick();
  }, [tree, loop]);

  // A zoom set from outside (or a new maxZoom) springs the view there about the frame centre.
  React.useEffect(() => {
    const motion = viewRef.current;
    const next = clamp(Number.isFinite(zoomValue) ? zoomValue : 1, 1, zoomLimit);
    // the zoom is reported rounded to two decimals; echoing it back must not nudge the view
    if (Math.abs(next - 2 ** motion.zoomTarget) < 0.006) {
      // a new maxZoom alone still changes which zoom buttons apply
      store.setTarget(2 ** motion.zoomTarget, zoomLimit);
      return;
    }
    const target = Math.log2(next);
    const size = frameSize();
    holdPoint(motion, size.width / 2, size.height / 2, size);
    motion.zoomTarget = target;
    runtimeRef.current.settled = false;
    store.setTarget(2 ** target, zoomLimit);
    loop.kick();
    // frameSize reads refs only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomValue, zoomLimit, loop, store, viewRef, runtimeRef]);

  // A centre set from outside springs the view there.
  React.useEffect(() => {
    const motion = viewRef.current;
    const world = toWorld(centerValue.lat, centerValue.lon);
    const reported = runtimeRef.current.reportedCenter;
    if (reported && Math.abs(reported.lat - centerValue.lat) < 1e-3 && Math.abs(reported.lon - centerValue.lon) < 1e-3) return;
    if (Math.abs(world.u - motion.u.target) < 1e-6 && Math.abs(world.v - motion.v.target) < 1e-6) return;
    motion.anchor = null;
    motion.u.target = world.u;
    motion.v.target = world.v;
    runtimeRef.current.settled = false;
    loop.kick();
  }, [centerValue, loop, viewRef, runtimeRef]);

  // Reduced motion changes how the springs run; restart the loop so the view settles at once.
  React.useEffect(() => {
    loop.kick();
  }, [reducedMotion, loop]);

  // Native wheel listener: React's onWheel is passive, and zooming has to stop the page from scrolling.
  React.useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let hintTimer = 0;
    const handleWheel = (event: WheelEvent) => {
      const zoomKey = event.ctrlKey || event.metaKey;
      // a plain wheel over the cluster list scrolls the list
      if (!zoomKey && event.target instanceof Node && popoverRef.current?.contains(event.target)) return;
      // a plain wheel zooms only while the keyboard is in the map; after a mouse click the page still scrolls
      if (!zoomKey && !hasKeyboardFocus(frame)) {
        setHint(true);
        window.clearTimeout(hintTimer);
        hintTimer = window.setTimeout(() => setHint(false), 1400);
        return;
      }
      event.preventDefault();
      setHint(false);
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? frame.clientHeight : 1;
      const deltaY = clamp(event.deltaY * unit, -240, 240);
      const point = framePoint(event);
      zoomTo(2 ** (viewRef.current.zoomTarget - deltaY * 0.002), point);
    };
    frame.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      frame.removeEventListener("wheel", handleWheel);
      window.clearTimeout(hintTimer);
    };
    // zoomTo and framePoint read refs only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewRef]);

  // Clear the pending lattice build on unmount.
  React.useEffect(() => {
    const state = runtimeRef.current;
    return () => window.clearTimeout(state.bakeTimer);
  }, [runtimeRef]);

  // The rendered scene is the one node positions are measured against; place the nodes before the browser paints.
  React.useLayoutEffect(() => {
    rendered.current = { view: scene.view, nodes: new Map(scene.items.map((item) => [item.key, item.node])) };
    positionNodes();
    handOffFocus();
    // a hovered node that split or merged away never sends pointerleave
    const state = runtimeRef.current;
    if (state.hoverKey !== null && !nodeElements.current.has(state.hoverKey)) state.hoverKey = null;
    // positionNodes and handOffFocus read refs only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, runtimeRef]);

  // Close the cluster list on a click outside it.
  React.useEffect(() => {
    if (!popover) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && popoverRef.current?.contains(event.target)) return;
      // a press on the cluster that owns the list leaves it to that cluster's click, which closes it
      if (event.target instanceof Node && nodeElements.current.get(popover.key)?.contains(event.target)) return;
      setPopover(null);
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [popover]);

  // Move focus into the list when it opens.
  React.useEffect(() => {
    if (!popover) return;
    popoverRef.current?.querySelector<HTMLElement>("li button")?.focus({ preventScroll: true });
  }, [popover]);

  function frameSize(): FrameSize {
    const current = surface.current;
    if (current) return { width: current.width, height: current.height };
    const frame = frameRef.current;
    const width = frame?.clientWidth || layoutWidthRef.current;
    return { width, height: frame?.clientHeight || width / ASPECT };
  }

  /** A pointer position in frame px. CSS zoom on an ancestor scales the client rect but not the layout size. */
  function framePoint(event: { clientX: number; clientY: number }) {
    const frame = frameRef.current;
    if (!frame) return { x: 0, y: 0 };
    const point = localPoint(frame, event.clientX, event.clientY);
    return { x: point.x - frame.clientLeft, y: point.y - frame.clientTop };
  }

  /** Something changed the view: report again when it settles, close the cluster list and run the loop. */
  function startMotion() {
    const state = runtimeRef.current;
    state.settled = false;
    window.clearTimeout(state.bakeTimer);
    state.bakeTimer = 0;
    store.setTarget(2 ** viewRef.current.zoomTarget, latest.current.zoomLimit);
    if (latest.current.popoverOpen) setPopover(null);
    loop.kick();
  }

  /** Zoom to `target`, keeping the world point under `point` (frame px) in place; the frame centre without one. */
  function zoomTo(target: number, point: { x: number; y: number } | null) {
    const motion = viewRef.current;
    const size = frameSize();
    holdPoint(motion, point?.x ?? size.width / 2, point?.y ?? size.height / 2, size);
    motion.zoomTarget = Math.log2(clamp(target, 1, latest.current.zoomLimit));
    startMotion();
  }

  /** One zoom level in or out: to the next whole zoom. */
  function stepZoom(direction: 1 | -1, point: { x: number; y: number } | null) {
    const current = 2 ** viewRef.current.zoomTarget;
    zoomTo(direction > 0 ? Math.floor(current + 0.05) + 1 : Math.ceil(current - 0.05) - 1, point);
  }

  function resetView() {
    const motion = viewRef.current;
    const { defaultZoom: startZoom, defaultCenter: startCenter, zoomLimit: limit } = latest.current;
    const world = toWorld(startCenter.lat, startCenter.lon);
    motion.anchor = null;
    motion.zoomTarget = Math.log2(clamp(Number.isFinite(startZoom) ? startZoom : 1, 1, limit));
    motion.u.target = world.u;
    motion.v.target = world.v;
    startMotion();
  }

  /** Pan by a distance in frame px (positive x moves the view east, positive y south). */
  function panBy(dx: number, dy: number) {
    const motion = viewRef.current;
    const size = frameSize();
    const scale = size.width * 2 ** motion.zoomTarget;
    motion.anchor = null;
    const [u, v] = clampCenter(motion.u.target + dx / scale, motion.v.target + dy / scale, 2 ** motion.zoomTarget, size);
    motion.u.target = u;
    motion.v.target = v;
    startMotion();
  }

  function step(time: number, delta: number) {
    const canvas = surface.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return false;
    const now = time * 1000;
    const reduced = prefersReducedMotion();
    const state = runtimeRef.current;
    const motion = viewRef.current;
    const current = modelRef.current;
    const activeTree = treeRef.current;
    const size: FrameSize = { width: canvas.width, height: canvas.height };

    const viewMoving = stepView(motion, delta, reduced, size);
    const viewport: Viewport = { cu: motion.u.position, cv: motion.v.position, z: 2 ** motion.zoom.position, ...size };
    const touchAction = viewport.z > 1.01 ? "none" : "pan-y";
    if (frame.style.touchAction !== touchAction) frame.style.touchAction = touchAction;

    // zooming in, the clusters split as soon as the zoom heads past a level, so the split plays during the zoom
    const level = levelFor(Math.max(viewport.z, 2 ** motion.zoomTarget), activeTree.maxLevel);
    if (current.tree !== activeTree) resetModel(current, activeTree, level, viewport);
    else if (level !== current.level) reconcile(current, level, viewport, reduced);
    state.frame++;
    const focusKey = state.hoverKey ?? (state.focusGlow ? state.focusKey : null);
    const nodesMoving = stepEntries(current, delta, reduced, viewport, focusKey);
    // cull while things move, and once more when the nodes come to rest: children that sprang out past the frame go
    if (viewMoved(current, viewport) || (nodesMoving && state.frame % 6 === 0) || (!nodesMoving && state.nodesMoving)) {
      cull(current, viewport);
    }
    state.nodesMoving = nodesMoving;
    positionNodes();

    const palette = colors.current;
    if (palette && (state.inkStale || !state.ink)) {
      state.ink = geoInk(palette);
      state.inkStale = false;
      repaintBakes(state);
    }
    let animating = false;
    const ink = state.ink;
    if (ink) {
      animating = drawMap(canvas, state, current, viewport, ink, now, reduced, latest.current.selected) || animating;
      const fx = effects.current;
      if (fx) animating = drawSparks(fx, state, delta) || animating;
    }

    const settled = !viewMoving && !motion.gesture;
    if (settled && !state.settled) {
      state.settled = true;
      handleSettled(viewport);
    }
    if (state.resized && settled) {
      state.resized = false;
      scheduleBake(viewport, true);
    }
    if (current.dirty) {
      current.dirty = false;
      setScene(sceneOf(current, activeTree, viewport));
    }
    return viewMoving || nodesMoving || animating;
  }

  /** The view came to rest: report zoom and centre, announce the clusters and re-sample the land dots. */
  function handleSettled(viewport: Viewport) {
    const state = runtimeRef.current;
    const zoomNow = Math.round(viewport.z * 100) / 100;
    const centre = fromWorld(viewport.cu, viewport.cv);
    const rounded = { lat: Math.round(centre.lat * 1e4) / 1e4, lon: Math.round(centre.lon * 1e4) / 1e4 };
    const announcement = describeView(modelRef.current, viewport);
    if (state.reportedCenter === null) {
      // the first rest after mount is the starting view: nothing to report or announce
      state.reportedCenter = rounded;
      state.announcement = announcement;
    } else {
      setZoomValue(zoomNow);
      const previous = state.reportedCenter;
      if (Math.abs(previous.lat - rounded.lat) > 1e-4 || Math.abs(previous.lon - rounded.lon) > 1e-4) {
        state.reportedCenter = rounded;
        setCenterValue(rounded);
      }
      if (announcement !== state.announcement) {
        state.announcement = announcement;
        store.announce(announcement);
      }
    }
    scheduleBake(viewport, false);
  }

  /** Builds the land dots for the settled view after a short pause, then crossfades them in. */
  function scheduleBake(viewport: Viewport, force: boolean) {
    const state = runtimeRef.current;
    if (!force && !bakeNeeded(state, viewport)) return;
    window.clearTimeout(state.bakeTimer);
    state.bakeTimer = window.setTimeout(
      () => {
        state.bakeTimer = 0;
        const motion = viewRef.current;
        const size = frameSize();
        const ink = state.ink;
        if (!ink) return;
        const next: Viewport = { cu: motion.u.position, cv: motion.v.position, z: 2 ** motion.zoom.position, ...size };
        addBake(state, next, ink, performance.now(), prefersReducedMotion());
        loop.kick();
      },
      state.bakes.length ? BAKE_DELAY : 0,
    );
  }

  /** Moves every node element from its rendered position to its animated one, before paint. */
  function positionNodes() {
    const size = frameSize();
    const motion = viewRef.current;
    const z = 2 ** motion.zoom.position;
    const scale = size.width * z;
    const snapshot = rendered.current.view;
    const entries = modelRef.current.entries;
    for (const [key, element] of nodeElements.current) {
      const node = rendered.current.nodes.get(key);
      if (!node) continue;
      const entry = entries.get(key);
      const u = entry ? entry.node.u + entry.offsetU.position : node.u;
      const v = entry ? entry.node.v + entry.offsetV.position : node.v;
      const x = size.width / 2 + (u - motion.u.position) * scale;
      const y = size.height / 2 + (v - motion.v.position) * scale;
      const restX = size.width * (0.5 + (node.u - snapshot.cu) * snapshot.z);
      const restY = size.height * (0.5 + (node.v - snapshot.cv) * snapshot.z * ASPECT);
      element.style.translate = `${(x - restX).toFixed(2)}px ${(y - restY).toFixed(2)}px`;
      if (entry?.into) {
        // children fade as they reach the parent they merge into
        const remaining = Math.hypot(entry.offsetU.position - entry.targetU, entry.offsetV.position - entry.targetV) * scale;
        element.style.opacity = clamp((remaining - 2) / 18, 0, 1).toFixed(3);
      } else if (element.style.opacity) {
        element.style.opacity = "";
      }
    }
  }

  /** When the focused node split or merged away, focus the node that took its place. */
  function handOffFocus() {
    const state = runtimeRef.current;
    const key = state.focusKey;
    if (!key || nodeElements.current.has(key)) return;
    const active = document.activeElement;
    if (active && active !== document.body) {
      if (!frameRef.current?.contains(active)) state.focusKey = null;
      return;
    }
    let next: string | undefined = key;
    for (let hops = 0; next && hops < 12 && !nodeElements.current.has(next); hops++) next = modelRef.current.handoff.get(next);
    const target = next ? nodeElements.current.get(next) : undefined;
    // a parent that is still collecting its children takes focus once it shows; try again on the next scene
    if (target?.dataset.state === "live") target.focus({ preventScroll: true });
    else if (!target) frameRef.current?.focus({ preventScroll: true });
  }

  const registerNode = React.useCallback((key: string, element: HTMLElement) => {
    const elements = nodeElements.current;
    elements.set(key, element);
    return () => {
      if (elements.get(key) === element) elements.delete(key);
    };
  }, []);

  /**
   * Selects a point and lights it up: a ring runs out through the land dots and sparks fly off the rim of the node that
   * shows it (the point itself, or the cluster whose list it was picked from).
   */
  function selectPoint(point: ClusterPoint, shownBy: ClusterNode) {
    setSelected(point.id);
    latest.current.onPointClick?.(point);
    const state = runtimeRef.current;
    const entry = modelRef.current.entries.get(shownBy.key);
    const u = shownBy.u + (entry?.offsetU.position ?? 0);
    const v = shownBy.v + (entry?.offsetV.position ?? 0);
    const motion = viewRef.current;
    const size = frameSize();
    const scale = size.width * 2 ** motion.zoom.position;
    const x = size.width / 2 + (u - motion.u.position) * scale;
    const y = size.height / 2 + (v - motion.v.position) * scale;
    const rim = shownBy.point ? 7 : clusterDiameter(shownBy.count) / 2 + 2;
    const palette = colors.current;
    if (!prefersReducedMotion()) {
      state.ripples.push({ u, v, start: performance.now(), reach: rim + 40, strength: 1 });
      // the effects canvas starts FX_INSET px outside the frame's border box
      const border = frameRef.current?.clientLeft ?? 0;
      if (palette) ringBurst(state.sparks, x + FX_INSET + border, y + FX_INSET + border, rim, 22, [palette.accent, palette.glint]);
    }
    loop.kick();
  }

  /** A click (`clicks` from the mouse event, 0 for Enter and Space) or a key press on a node. */
  function activateNode(item: SceneItem, clicks: number) {
    const node = item.node;
    const state = runtimeRef.current;
    const now = performance.now();
    // the second click of a double-click lands on a child that just split out under the pointer: one zoom only
    if (clicks > 0 && now - state.lastActivation < DOUBLE_CLICK_MS) return;
    if (clicks > 0) state.lastActivation = now;
    if (node.point) {
      selectPoint(node.point, node);
      return;
    }
    if (popover?.key === item.key) {
      closeList();
      return;
    }
    if (latest.current.onClusterClick?.(collectPoints(node)) === false) return;
    const level = splitLevel(node, scene.tree.maxLevel);
    if (level === null) {
      setPopover({ key: item.key });
      return;
    }
    // the cluster glides to the centre while the map zooms in, so it splits in front of the viewer
    const motion = viewRef.current;
    const size = frameSize();
    const scale = size.width * 2 ** motion.zoom.position;
    const x = size.width / 2 + (node.u - motion.u.position) * scale;
    const y = size.height / 2 + (node.v - motion.v.position) * scale;
    holdPoint(motion, x, y, size, size.width / 2, size.height / 2);
    motion.zoomTarget = Math.log2(clamp(Math.max(level, 2 ** motion.zoomTarget), 1, latest.current.zoomLimit));
    if (!prefersReducedMotion()) {
      const reach = clusterDiameter(node.count) / 2 + 30;
      runtimeRef.current.ripples.push({ u: node.u, v: node.v, start: performance.now(), reach, strength: 0.9 });
    }
    startMotion();
  }

  function pickFromList(point: ClusterPoint, cluster: ClusterNode) {
    const key = popover?.key;
    setPopover(null);
    selectPoint(point, cluster);
    if (key) nodeElements.current.get(key)?.focus({ preventScroll: true });
  }

  function closeList() {
    const key = popover?.key;
    setPopover(null);
    if (key) nodeElements.current.get(key)?.focus({ preventScroll: true });
  }

  /** Arrow keys between nodes: the nearest node in that direction on screen. Nodes outside the frame are skipped. */
  function navigate(fromKey: string, direction: NavigationDirection) {
    const motion = viewRef.current;
    const size = frameSize();
    const scale = size.width * 2 ** motion.zoom.position;
    const candidates: { key: string; x: number; y: number }[] = [];
    for (const item of scene.items) {
      if (item.exiting || item.shown <= 0) continue;
      const entry = modelRef.current.entries.get(item.key);
      const x = size.width / 2 + (item.node.u + (entry?.offsetU.position ?? 0) - motion.u.position) * scale;
      const y = size.height / 2 + (item.node.v + (entry?.offsetV.position ?? 0) - motion.v.position) * scale;
      const inside = x >= 0 && x <= size.width && y >= 0 && y <= size.height;
      if (inside || item.key === fromKey) candidates.push({ key: item.key, x, y });
    }
    const from = candidates.findIndex((candidate) => candidate.key === fromKey);
    if (from < 0) return;
    const next = spatialNavigate(candidates, from, direction);
    if (next !== from) nodeElements.current.get(candidates[next].key)?.focus({ preventScroll: true });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const list = popoverRef.current;
    if (target && list?.contains(target)) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeList();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
        // the list rows are a column of buttons: arrows step through them, Home and End jump to the ends
        event.preventDefault();
        const rows = [...list.querySelectorAll<HTMLElement>("li button")];
        const index = rows.indexOf(target);
        const last = rows.length - 1;
        const next =
          event.key === "Home" ? 0 : event.key === "End" ? last : clamp(index + (event.key === "ArrowDown" ? 1 : -1), 0, last);
        rows[next]?.focus();
      }
      return;
    }
    const nodeKey = target?.closest("[data-node-key]")?.getAttribute("data-node-key") ?? null;
    const direction = ARROW_DIRECTIONS[event.key];
    if (direction) {
      event.preventDefault();
      if (nodeKey) navigate(nodeKey, direction);
      else panBy(PAN_VECTORS[direction][0] * PAN_STEP, PAN_VECTORS[direction][1] * PAN_STEP);
      return;
    }
    switch (event.key) {
      case "+":
      case "=":
        event.preventDefault();
        stepZoom(1, null);
        break;
      case "-":
      case "_":
        event.preventDefault();
        stepZoom(-1, null);
        break;
      case "0":
        event.preventDefault();
        resetView();
        break;
      case "Escape":
        if (popover) {
          event.preventDefault();
          closeList();
        } else if (selected !== null) {
          event.preventDefault();
          setSelected(null);
        }
        break;
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (isInterface(event.target) || (event.pointerType === "mouse" && event.button !== 0)) return;
    const state = runtimeRef.current;
    const point = framePoint(event);
    // a new primary pointer means no other is down: drop any whose release happened outside the map uncaptured
    if (event.isPrimary) state.pointers.clear();
    state.pointers.set(event.pointerId, point);
    if (state.pointers.size === 2) {
      startPinch(event.currentTarget);
    } else if (state.pointers.size === 1) {
      state.drag = {
        id: event.pointerId,
        startX: point.x,
        startY: point.y,
        lastX: point.x,
        lastY: point.y,
        moved: false,
        touch: event.pointerType === "touch",
        samples: [{ x: point.x, y: point.y, t: event.timeStamp }],
      };
    }
  }

  function startPinch(frame: HTMLDivElement) {
    const state = runtimeRef.current;
    const [a, b] = [...state.pointers.values()];
    const motion = viewRef.current;
    const size = frameSize();
    const z = 2 ** motion.zoom.position;
    const scale = size.width * z;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    state.pinch = {
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      zoom: z,
      u: motion.u.position + (midX - size.width / 2) / scale,
      v: motion.v.position + (midY - size.height / 2) / scale,
    };
    state.drag = null;
    for (const id of state.pointers.keys()) {
      try {
        frame.setPointerCapture(id);
      } catch {
        // the pointer may already be gone
      }
    }
    beginGesture(frame);
  }

  /** A drag or pinch took over the view: springs stop and the pointer moves the map directly. */
  function beginGesture(frame: HTMLDivElement) {
    const motion = viewRef.current;
    motion.gesture = true;
    motion.anchor = null;
    frame.dataset.dragging = "";
    setHint(false);
    startMotion();
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const state = runtimeRef.current;
    if (!state.pointers.has(event.pointerId)) return;
    const point = framePoint(event);
    state.pointers.set(event.pointerId, point);
    const motion = viewRef.current;
    const size = frameSize();
    const pinch = state.pinch;
    if (pinch) {
      const [a, b] = [...state.pointers.values()];
      if (!a || !b) return;
      const z = clamp((pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.distance, 1, latest.current.zoomLimit);
      const scale = size.width * z;
      const [u, v] = clampCenter(
        pinch.u - ((a.x + b.x) / 2 - size.width / 2) / scale,
        pinch.v - ((a.y + b.y) / 2 - size.height / 2) / scale,
        z,
        size,
      );
      motion.zoom.position = motion.zoomTarget = Math.log2(z);
      motion.zoom.velocity = 0;
      setCentre(motion, u, v);
      store.setTarget(z, latest.current.zoomLimit);
      state.suppressClick = true;
      loop.kick();
      return;
    }
    const drag = state.drag;
    if (!drag || drag.id !== event.pointerId) return;
    if (!drag.moved) {
      if (Math.hypot(point.x - drag.startX, point.y - drag.startY) < DRAG_THRESHOLD) return;
      // one finger at the whole-world zoom leaves the gesture to the page, so it can scroll
      if (drag.touch && 2 ** motion.zoom.position <= 1.01) {
        state.drag = null;
        return;
      }
      drag.moved = true;
      const frame = event.currentTarget;
      try {
        frame.setPointerCapture(event.pointerId);
      } catch {
        // capture is optional
      }
      beginGesture(frame);
    }
    const scale = size.width * 2 ** motion.zoom.position;
    const [u, v] = clampCenter(
      motion.u.position - (point.x - drag.lastX) / scale,
      motion.v.position - (point.y - drag.lastY) / scale,
      2 ** motion.zoom.position,
      size,
    );
    setCentre(motion, u, v);
    drag.lastX = point.x;
    drag.lastY = point.y;
    drag.samples.push({ x: point.x, y: point.y, t: event.timeStamp });
    while (drag.samples.length > 2 && event.timeStamp - drag.samples[0].t > 100) drag.samples.shift();
    loop.kick();
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const state = runtimeRef.current;
    if (!state.pointers.delete(event.pointerId)) return;
    const frame = event.currentTarget;
    const motion = viewRef.current;
    if (frame.hasPointerCapture(event.pointerId)) frame.releasePointerCapture(event.pointerId);
    if (state.pinch) {
      if (state.pointers.size < 2) {
        state.pinch = null;
        state.drag = null;
        endGesture(frame);
      }
      return;
    }
    const drag = state.drag;
    if (!drag || drag.id !== event.pointerId) return;
    state.drag = null;
    if (!drag.moved) return;
    // a flick keeps the map gliding: the release velocity feeds the centre springs
    const first = drag.samples[0];
    const elapsed = (event.timeStamp - first.t) / 1000;
    if (event.type === "pointerup" && elapsed > 0.008 && !prefersReducedMotion()) {
      const size = frameSize();
      const scale = size.width * 2 ** motion.zoom.position;
      const velocityX = clamp((drag.lastX - first.x) / elapsed, -2400, 2400);
      const velocityY = clamp((drag.lastY - first.y) / elapsed, -2400, 2400);
      if (Math.hypot(velocityX, velocityY) > 60) {
        motion.u.velocity = -velocityX / scale;
        motion.v.velocity = -velocityY / scale;
        motion.u.target = motion.u.position + motion.u.velocity * GLIDE_SECONDS;
        motion.v.target = motion.v.position + motion.v.velocity * GLIDE_SECONDS;
      }
    }
    endGesture(frame);
  }

  function endGesture(frame: HTMLDivElement) {
    const state = runtimeRef.current;
    viewRef.current.gesture = false;
    delete frame.dataset.dragging;
    state.suppressClick = true;
    window.setTimeout(() => {
      state.suppressClick = false;
    }, 0);
    state.settled = false;
    loop.kick();
  }

  function handleClickCapture(event: React.MouseEvent<HTMLDivElement>) {
    if (!runtimeRef.current.suppressClick) return;
    // the click that ends a drag does not activate the node under the pointer
    event.stopPropagation();
    event.preventDefault();
    runtimeRef.current.suppressClick = false;
  }

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (isInterface(event.target) || isNode(event.target)) return;
    if (selected !== null) setSelected(null);
  }

  function handleDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (isInterface(event.target) || isNode(event.target)) return;
    stepZoom(1, framePoint(event));
  }

  const handleNodeFocus = React.useCallback(
    (key: string, visible: boolean) => {
      runtimeRef.current.focusKey = key;
      // only keyboard focus lights the pool; a clicked node keeps focus without glowing on
      runtimeRef.current.focusGlow = visible;
      setActiveKey(key);
      loop.kick();
    },
    [loop, runtimeRef],
  );
  const handleNodeBlur = React.useCallback(
    (event: React.FocusEvent<HTMLElement>) => {
      const state = runtimeRef.current;
      state.focusGlow = false;
      const next = event.relatedTarget;
      const element = event.currentTarget;
      // focus left the map on purpose (the node is still live in the page): a later split must not pull it back
      const leftMap = !(next instanceof Node && frameRef.current?.contains(next));
      if (leftMap && element.isConnected && element.dataset.state === "live") state.focusKey = null;
      loop.kick();
    },
    [loop, runtimeRef],
  );
  const handleNodeHover = React.useCallback(
    (key: string | null) => {
      runtimeRef.current.hoverKey = key;
      loop.kick();
    },
    [loop, runtimeRef],
  );

  const liveItems = scene.items.filter((item) => !item.exiting && item.shown > 0);
  const rovingKey =
    activeKey && liveItems.some((item) => item.key === activeKey)
      ? activeKey
      : (liveItems.find((item) => insideView(item.node, scene.view)) ?? liveItems[0])?.key ?? null;
  const selectedPath = ancestorKeys(scene.tree, selected);
  const listItem = popover ? (scene.items.find((item) => item.key === popover.key && !item.exiting) ?? null) : null;
  const empty = data.length === 0;

  return (
    <div
      data-slot="geo-cluster"
      className={cn("relative w-full max-w-[660px] text-[13px] leading-[1.3] text-foreground", className)}
      {...props}
    >
      <div
        ref={frameRef}
        role="group"
        aria-roledescription="map"
        aria-label={label}
        aria-describedby={descriptionId}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClickCapture={handleClickCapture}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        className="group/map relative aspect-[2/1] w-full cursor-grab touch-pan-y overflow-hidden rounded-xl border border-border bg-card outline-none select-none [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec data-[dragging]:cursor-grabbing"
      >
        <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 block size-full" />
        <div className="absolute inset-0">
          {scene.items.map((item) => (
            <ClusterNodeButton
              key={item.key}
              item={item}
              view={scene.view}
              tabbable={item.key === rovingKey}
              selected={item.node.point !== null && item.node.point.id === selected}
              containsSelected={item.node.point === null && selectedPath.has(item.key)}
              opensList={item.node.point === null && splitLevel(item.node, scene.tree.maxLevel) === null}
              listOpen={popover?.key === item.key}
              reducedMotion={reducedMotion}
              register={registerNode}
              onActivate={activateNode}
              onFocusKey={handleNodeFocus}
              onBlurNode={handleNodeBlur}
              onHover={handleNodeHover}
            />
          ))}
        </div>
        {empty ? (
          <p className="pointer-events-none absolute inset-0 m-0 grid place-items-center text-[12.5px] text-muted-foreground">
            No locations to show
          </p>
        ) : null}
        <MapControls store={store} reducedMotion={reducedMotion} onZoomIn={() => stepZoom(1, null)} onZoomOut={() => stepZoom(-1, null)} onReset={resetView} />
        {listItem ? (
          <ClusterList ref={popoverRef} item={listItem} view={scene.view} selected={selected} onPick={pickFromList} onClose={closeList} />
        ) : null}
        <div
          aria-hidden="true"
          data-visible={hint ? "" : undefined}
          className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3 opacity-0 transition-opacity duration-300 data-[visible]:opacity-100 motion-reduce:transition-none"
        >
          <span className="rounded-md bg-foreground/85 px-2.5 py-1 text-[12px] text-background shadow-[0_6px_18px_-10px_rgb(0_0_0/0.5)]">
            Use Ctrl or ⌘ with the scroll wheel to zoom
          </span>
        </div>
        <p id={descriptionId} className="sr-only">
          Arrow keys pan the map, plus and minus zoom, 0 resets the view. Tab moves to the clusters, where arrow keys move
          between them.
        </p>
        <LiveRegion store={store} />
      </div>
      <canvas
        ref={effectsRef}
        aria-hidden="true"
        className="pointer-events-none absolute -top-10 -left-10 z-[5] block h-[calc(100%+80px)] w-[calc(100%+80px)]"
      />
    </div>
  );
}

/* Nodes, controls and the cluster list ---------------------------------------------------------------- */

interface NodeButtonProps {
  item: SceneItem;
  view: SceneView;
  /** The roving tab stop: the one node in the tab order. */
  tabbable: boolean;
  selected: boolean;
  containsSelected: boolean;
  /** A cluster that zooming cannot split: activating it opens the list of its points. */
  opensList: boolean;
  listOpen: boolean;
  reducedMotion: boolean;
  register: (key: string, element: HTMLElement) => () => void;
  onActivate: (item: SceneItem, clicks: number) => void;
  /** `visible`: the focus came from the keyboard. */
  onFocusKey: (key: string, visible: boolean) => void;
  onBlurNode: (event: React.FocusEvent<HTMLElement>) => void;
  onHover: (key: string | null) => void;
}

/**
 * One cluster or point. Rendered at its resting position in percent (so the server markup is right); the animation
 * loop moves it from there with the `translate` property while it springs.
 */
function ClusterNodeButton({
  item,
  view,
  tabbable,
  selected,
  containsSelected,
  opensList,
  listOpen,
  reducedMotion,
  register,
  onActivate,
  onFocusKey,
  onBlurNode,
  onHover,
}: NodeButtonProps) {
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const visualRef = React.useRef<HTMLSpanElement>(null);
  const [entrance] = React.useState(item.enter);
  const { key, node, exiting, shown } = item;
  const cluster = node.point === null;
  const collecting = cluster && !exiting && shown <= 0;
  const hidden = exiting || collecting;
  const size = cluster ? clusterDiameter(node.count) : POINT_TARGET;
  const left = 50 + (node.u - view.cu) * view.z * 100;
  const top = 50 + (node.v - view.cv) * view.z * ASPECT * 100;

  React.useLayoutEffect(() => {
    const element = buttonRef.current;
    if (!element) return;
    return register(key, element);
  }, [key, register]);

  // Children of a split grow out of their parent's position.
  React.useLayoutEffect(() => {
    const visual = visualRef.current;
    if (entrance !== "split" || reducedMotion || !visual || typeof visual.animate !== "function") return;
    visual.animate(SPLIT_KEYFRAMES, { duration: 460, easing: "cubic-bezier(.2,.8,.2,1)" });
  }, [entrance, reducedMotion]);

  const place = cluster ? placeName(node) : "";
  const name = node.point ? pointLabel(node.point) : "";
  const accessibleName = cluster
    ? `${formatNumber(node.count)} locations around ${place}${containsSelected ? ", includes the selected location" : ""}`
    : name;
  const below = top < 24;
  const align = left < 16 ? "start" : left > 84 ? "end" : "center";

  return (
    <button
      ref={buttonRef}
      type="button"
      data-node-key={key}
      data-state={exiting ? "exiting" : collecting ? "collecting" : "live"}
      tabIndex={tabbable && !hidden ? 0 : -1}
      aria-hidden={hidden || undefined}
      aria-label={accessibleName}
      aria-pressed={cluster ? undefined : selected}
      aria-haspopup={opensList ? "dialog" : undefined}
      aria-expanded={opensList ? listOpen : undefined}
      inert={hidden}
      onClick={(event) => onActivate(item, event.detail)}
      onFocus={(event) => onFocusKey(key, focusVisible(event.currentTarget))}
      onBlur={onBlurNode}
      onPointerEnter={() => onHover(key)}
      onPointerLeave={() => onHover(null)}
      className="group/node absolute z-[1] grid cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 font-[inherit] text-foreground outline-none [-webkit-tap-highlight-color:transparent] hover:z-10 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec data-[state=exiting]:pointer-events-none"
      style={{ left: `${left}%`, top: `${top}%`, width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 }}
    >
      {cluster ? (
        <span
          ref={visualRef}
          aria-hidden="true"
          className={cn(
            "grid size-full place-items-center rounded-full border border-lumesec/50 bg-[color-mix(in_srgb,var(--lumesec)_14%,var(--card))] shadow-[0_1px_2px_rgb(0_0_0/0.06)] transition-[scale,opacity,border-color,background-color,box-shadow] duration-200 ease-out group-hover/node:scale-[1.06] group-hover/node:border-lumesec group-hover/node:bg-[color-mix(in_srgb,var(--lumesec)_20%,var(--card))] motion-reduce:transition-none",
            collecting && "scale-[.6] opacity-0",
            (containsSelected || listOpen) &&
              "border-lumesec shadow-[0_0_0_3px_color-mix(in_srgb,var(--lumesec)_22%,transparent)]",
          )}
        >
          <RollingCount value={exiting ? node.count : shown} reducedMotion={reducedMotion} />
        </span>
      ) : (
        <span
          ref={visualRef}
          aria-hidden="true"
          className={cn(
            "size-2.5 rounded-full bg-lumesec shadow-[0_0_0_2px_var(--card)] transition-[scale,box-shadow] duration-200 ease-out group-hover/node:scale-125 motion-reduce:transition-none",
            selected && "scale-125 shadow-[0_0_0_2px_var(--card),0_0_0_3.5px_var(--lumesec)]",
          )}
        />
      )}
      {hidden || listOpen ? null : (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute z-10 w-max max-w-[240px] rounded-md border border-border bg-popover px-2 py-1 text-left text-[11.5px] leading-[1.35] whitespace-nowrap text-popover-foreground opacity-0 shadow-[0_8px_20px_-12px_rgb(0_0_0/0.45)] transition-opacity duration-150 group-hover/node:opacity-100 group-focus-visible/node:opacity-100 group-data-[dragging]/map:opacity-0 motion-reduce:transition-none",
            below ? "top-[calc(100%+6px)]" : "bottom-[calc(100%+6px)]",
            align === "center" ? "left-1/2 -translate-x-1/2" : align === "start" ? "left-0" : "right-0",
          )}
        >
          {cluster ? (
            <>
              <span className="font-medium">{formatNumber(node.count)} locations</span>{" "}
              <span className="text-muted-foreground">around {place}</span>
            </>
          ) : (
            <>
              <span className="block font-medium">{name}</span>
              <span className="block font-mono text-[10.5px] text-muted-foreground tabular-nums">{formatLatLon(node, "decimal", 2)}</span>
            </>
          )}
        </span>
      )}
    </button>
  );
}

interface MapControlsProps {
  store: ViewStore;
  reducedMotion: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

/** −, the zoom readout and + in one pill, and the reset button beside it. */
function MapControls({ store, reducedMotion, onZoomIn, onZoomOut, onReset }: MapControlsProps) {
  const snapshot = React.useSyncExternalStore(store.subscribe, store.get, store.getServer);
  return (
    <div data-map-ui="" className="absolute top-2.5 right-2.5 z-20 flex items-center gap-1.5">
      <div className="flex items-center rounded-lg border border-border bg-card/90 p-px shadow-[0_6px_18px_-12px_rgb(0_0_0/0.45)] backdrop-blur-[6px]">
        <ControlButton label="Zoom out" disabled={!snapshot.canZoomOut} onClick={onZoomOut}>
          <path d="M4.5 8h7" />
        </ControlButton>
        <span aria-hidden="true" className="grid min-w-[38px] place-items-center font-mono text-[11.5px] text-muted-foreground tabular-nums">
          <ZoomReadout zoom={snapshot.zoom} reducedMotion={reducedMotion} />
        </span>
        <ControlButton label="Zoom in" disabled={!snapshot.canZoomIn} onClick={onZoomIn}>
          <path d="M4.5 8h7M8 4.5v7" />
        </ControlButton>
      </div>
      <div className="rounded-lg border border-border bg-card/90 p-px shadow-[0_6px_18px_-12px_rgb(0_0_0/0.45)] backdrop-blur-[6px]">
        <ControlButton label="Reset view" onClick={onReset}>
          <path d="M3.5 6.5v-3h3M9.5 3.5h3v3M12.5 9.5v3h-3M6.5 12.5h-3v-3" />
        </ControlButton>
      </div>
    </div>
  );
}

function ControlButton({
  label,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      // aria-disabled instead of disabled: a button that reaches the zoom limit while focused keeps the focus
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      className="grid size-7 cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-foreground outline-none hover:bg-foreground/8 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-solid focus-visible:outline-lumesec aria-disabled:cursor-default aria-disabled:text-muted-foreground/45 aria-disabled:hover:bg-transparent"
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-3.5">
        {children}
      </svg>
    </button>
  );
}

/** '2.4×', rolling up when the zoom grows and down when it shrinks. */
function ZoomReadout({ zoom, reducedMotion }: { zoom: number; reducedMotion: boolean }) {
  const [state, setState] = React.useState({ zoom, direction: 1 });
  if (state.zoom !== zoom) setState({ zoom, direction: zoom > state.zoom ? 1 : -1 });
  return <RollText text={formatZoom(zoom)} direction={state.direction} animate={!reducedMotion} />;
}

/** A cluster's count: it rolls up as merging children arrive, and down in the rare case one is pulled away mid-flight. */
function RollingCount({ value, reducedMotion }: { value: number; reducedMotion: boolean }) {
  const [state, setState] = React.useState({ value, direction: 1 });
  if (state.value !== value) setState({ value, direction: value > state.value ? 1 : -1 });
  return (
    <RollText
      text={formatCount(value)}
      direction={state.direction}
      animate={!reducedMotion}
      className="font-mono text-[11.5px] leading-none font-medium tabular-nums"
    />
  );
}

function LiveRegion({ store }: { store: ViewStore }) {
  const snapshot = React.useSyncExternalStore(store.subscribe, store.get, store.getServer);
  return (
    <p aria-live="polite" className="sr-only">
      {snapshot.announcement}
    </p>
  );
}

interface ClusterListProps {
  ref: React.Ref<HTMLDivElement>;
  item: SceneItem;
  view: SceneView;
  selected: string | null;
  onPick: (point: ClusterPoint, cluster: ClusterNode) => void;
  onClose: () => void;
}

/** The points of a cluster that zooming cannot split (identical coordinates, or the largest zoom), as a list. */
function ClusterList({ ref, item, view, selected, onPick, onClose }: ClusterListProps) {
  const titleId = React.useId();
  const points = React.useMemo(
    () => collectPoints(item.node).sort((a, b) => LABEL_ORDER.compare(pointLabel(a), pointLabel(b))),
    [item.node],
  );
  const visible = points.slice(0, LIST_LIMIT);
  const x = 50 + (item.node.u - view.cu) * view.z * 100;
  const y = 50 + (item.node.v - view.cv) * view.z * ASPECT * 100;
  const width = "min(264px, 100% - 16px)";
  const maxLeft = `calc(100% - 8px - ${width})`;
  const left =
    x <= 50 ? `clamp(8px, calc(${x}% + 24px), ${maxLeft})` : `clamp(8px, calc(${x}% - 24px - ${width}), ${maxLeft})`;
  const top = `clamp(8px, calc(${y}% - 40px), calc(100% - 8px - min(212px, 100% - 16px)))`;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={titleId}
      data-map-ui=""
      className="absolute z-30 flex max-h-[min(212px,calc(100%-16px))] w-[min(264px,calc(100%-16px))] cursor-default flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-[0_14px_34px_-18px_rgb(0_0_0/0.5)]"
      style={{ left, top }}
    >
      <div className="flex items-center gap-2 border-b border-border py-1 pr-1 pl-3">
        <p id={titleId} className="m-0 min-w-0 flex-1 truncate text-[12.5px]">
          <span className="font-medium">{formatNumber(points.length)} locations</span>{" "}
          <span className="text-muted-foreground">around {placeName(item.node)}</span>
        </p>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-muted-foreground outline-none hover:bg-foreground/8 hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-lumesec"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" aria-hidden="true" className="size-3">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto overscroll-contain p-1">
        {visible.map((point) => (
          <li key={point.id}>
            <button
              type="button"
              aria-pressed={point.id === selected}
              onClick={() => onPick(point, item.node)}
              className="flex w-full cursor-pointer items-baseline gap-3 rounded-md border-0 bg-transparent px-2 py-1 text-left font-[inherit] text-[12.5px] leading-[18px] text-foreground outline-none hover:bg-accent focus-visible:bg-accent aria-pressed:text-lumesec"
            >
              <span className="min-w-0 flex-1 truncate">{pointLabel(point)}</span>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">{formatLatLon(point, "decimal", 1)}</span>
            </button>
          </li>
        ))}
      </ul>
      {points.length > visible.length ? (
        <p className="m-0 border-t border-border px-3 py-1.5 text-[11.5px] text-muted-foreground">
          and {formatNumber(points.length - visible.length)} more
        </p>
      ) : null}
    </div>
  );
}

/* View store: the zoom readout and the announcements re-render on their own, not the whole map ------------- */

interface ViewSnapshot {
  zoom: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  announcement: string;
}

interface ViewStore {
  subscribe: (listener: () => void) => () => void;
  get: () => ViewSnapshot;
  getServer: () => ViewSnapshot;
  setTarget: (zoom: number, limit: number) => void;
  announce: (text: string) => void;
}

function createViewStore(zoom: number, limit: number): ViewStore {
  const make = (value: number, max: number, announcement: string): ViewSnapshot => {
    const rounded = Math.round(value * 10) / 10;
    return { zoom: rounded, canZoomIn: value < max - 1e-3, canZoomOut: value > 1 + 1e-3, announcement };
  };
  const server = make(zoom, limit, "");
  let snapshot = server;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => snapshot,
    getServer: () => server,
    setTarget(value, max) {
      const next = make(value, max, snapshot.announcement);
      if (next.zoom === snapshot.zoom && next.canZoomIn === snapshot.canZoomIn && next.canZoomOut === snapshot.canZoomOut) return;
      snapshot = next;
      emit();
    },
    announce(text) {
      if (text === snapshot.announcement) return;
      snapshot = { ...snapshot, announcement: text };
      emit();
    },
  };
}

/* Constants ------------------------------------------------------------------------------------------- */

/** The land data has a 0.5° grid; past 6× the lattice would be finer than the data. */
const MAX_ZOOM = 6;
const DEFAULT_CENTER: LatLon = { lat: 25, lon: 10 };
/** Width the server markup and the first client render compute clusters for. */
const NOMINAL_WIDTH = 660;
/** Width / height of the frame (`aspect-[2/1]`). */
const ASPECT = 2;
/** Mercator is cut at ±78°, so the polar stretch never fills the frame. */
const LAT_LIMIT = 78;
/** Central meridian of the map: the default centre's longitude, which puts the seam in the Bering Strait. */
const CENTRAL_LON = 10;
const VIEW_STIFFNESS = 220;
const VIEW_DAMPING = 0.9;
const NODE_STIFFNESS = 300;
const NODE_DAMPING = 0.7;
/** Arrow keys pan this many px. */
const PAN_STEP = 60;
/** How long a flick keeps gliding, in seconds of release velocity. */
const GLIDE_SECONDS = 0.32;
const DRAG_THRESHOLD = 4;
/** A second click on a node within this many ms is the rest of a double-click. */
const DOUBLE_CLICK_MS = 400;
/** At most this many nodes are in the DOM. */
const MAX_NODES = 160;
/** Nodes this far outside the frame stay rendered, so panning never shows them pop in. */
const CULL_MARGIN = 56;
const POINT_TARGET = 24;
const LIST_LIMIT = 100;
const DEMO_POINTS = 600;
/** Demo points in tight groups around the cities; the rest are scattered across each city's region. */
const DEMO_METRO_POINTS = 360;
const LATTICE_PITCH = 4;
const DOT_SIZE = 1.7;
/** The settled view's lattice is built this long after the zoom spring comes to rest. */
const BAKE_DELAY = 120;
const CROSSFADE_MS = 200;
/** A view bake covers this share of the frame beyond each edge, so short pans and zooms out stay covered. */
const BAKE_MARGIN = 0.25;
const RIPPLE_MS = 760;
/** The effects canvas extends this far past the map on every side. */
const FX_INSET = 40;
const SPARK_OPTIONS = { speed: [40, 190], life: [0.3, 0.75], size: [1.5, 2.5], drag: 3.6 } as const;

const PAN_VECTORS: Record<NavigationDirection, readonly [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
};

const SPLIT_KEYFRAMES: Keyframe[] = [
  { transform: "scale(.55)", opacity: 0.4 },
  { transform: "scale(1.08)", opacity: 1, offset: 0.6 },
  { transform: "scale(1)", opacity: 1 },
];

/* World coordinates ----------------------------------------------------------------------------------- */

const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (clamp(lat, -LAT_LIMIT, LAT_LIMIT) * DEG) / 2));
const Y_MAX = mercatorY(LAT_LIMIT);
/** Height of the world in map widths (about 0.72). */
const WORLD_HEIGHT = (2 * Y_MAX) / TAU;

/**
 * World coordinates: `u` 0..1 from 170° W eastward around the globe (the seam runs through the Bering Strait, so no
 * landmass and no cluster is cut in half at the map's side edges), `v` 0..WORLD_HEIGHT from 78° N down, both in map
 * widths at zoom 1. A point is at frame x = W/2 + (u − cu)·W·z, y = H/2 + (v − cv)·W·z.
 */
function toWorld(lat: number, lon: number) {
  return { u: (wrapLongitude(lon - CENTRAL_LON) + 180) / 360, v: (Y_MAX - mercatorY(lat)) / TAU };
}

function fromWorld(u: number, v: number): LatLon {
  const y = Y_MAX - v * TAU;
  return { lat: (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / DEG, lon: wrapLongitude(u * 360 - 180 + CENTRAL_LON) };
}

interface FrameSize {
  width: number;
  height: number;
}

/** The view at one instant: centre in world units, linear zoom and the frame size. */
interface Viewport extends FrameSize {
  cu: number;
  cv: number;
  z: number;
}

/** The centre clamped so the map always covers the frame at zoom `z`. */
function clampCenter(u: number, v: number, z: number, size: FrameSize): [number, number] {
  const halfU = 0.5 / z;
  const halfV = size.height / (2 * size.width * z);
  return [
    halfU >= 0.5 ? 0.5 : clamp(u, halfU, 1 - halfU),
    halfV >= WORLD_HEIGHT / 2 ? WORLD_HEIGHT / 2 : clamp(v, halfV, WORLD_HEIGHT - halfV),
  ];
}

/** Whether an event target is part of the controls or the cluster list, which handle their own pointer input. */
const isInterface = (target: EventTarget | null) => target instanceof Element && target.closest("[data-map-ui]") !== null;

/** Whether a node's resting position is inside the frame of a rendered view. */
function insideView(node: ClusterNode, view: SceneView) {
  const x = 0.5 + (node.u - view.cu) * view.z;
  const y = 0.5 + (node.v - view.cv) * view.z * ASPECT;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1;
}

/** Whether an event target is a cluster or point button. */
const isNode = (target: EventTarget | null) => target instanceof Element && target.closest("[data-node-key]") !== null;

/** Whether focus came from the keyboard; browsers without `:focus-visible` count every focus. */
function focusVisible(element: Element) {
  try {
    return element.matches(":focus-visible");
  } catch {
    return element === document.activeElement;
  }
}

/** Whether the map frame, or a node or control inside it, has keyboard focus. */
function hasKeyboardFocus(frame: HTMLElement) {
  const active = document.activeElement;
  return active !== null && frame.contains(active) && focusVisible(active);
}

const levelFor = (z: number, maxLevel: number) => clamp(Math.floor(z + 1e-4), 1, maxLevel);

const formatZoom = (zoom: number) => `${(Math.round(zoom * 10) / 10).toFixed(1)}×`;

const formatCount = (count: number) => (count >= 1000 ? formatCompact(count) : formatNumber(count));

/** A point's name: its `label`, else its coordinates. */
const pointLabel = (point: ClusterPoint) => point.label ?? formatLatLon(point, "decimal", 2);

/** Orders list rows by name, with numbers in numeric order ('Site 2' before 'Site 10'). */
const LABEL_ORDER = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** 24 px for two points, 30 for ten, 36 for a hundred, at most 40. */
const clusterDiameter = (count: number) => Math.round(Math.min(40, 24 + 6 * Math.log10(Math.max(2, count))));

/* View motion ----------------------------------------------------------------------------------------- */

interface TargetSpring extends Spring {
  /** Where the spring settles. */
  target: number;
}

const spring = (value: number): TargetSpring => ({ position: value, velocity: 0, target: value });

interface ViewMotion {
  /** log2 of the zoom. */
  zoom: Spring;
  zoomTarget: number;
  u: TargetSpring;
  v: TargetSpring;
  /**
   * While set, the world point (u, v) is held at the screen offset (dx, dy) from the frame centre as the zoom moves,
   * and the offset itself springs toward its target: the point under the cursor stays put, a clicked cluster glides
   * to the centre.
   */
  anchor: { u: number; v: number; dx: TargetSpring; dy: TargetSpring } | null;
  /** A drag or pinch sets the view directly. */
  gesture: boolean;
}

function startView(zoom: number, center: LatLon, limit: number): SceneView {
  const z = clamp(Number.isFinite(zoom) ? zoom : 1, 1, limit);
  const world = toWorld(center.lat, center.lon);
  const [cu, cv] = clampCenter(world.u, world.v, z, { width: ASPECT, height: 1 });
  return { cu, cv, z };
}

function createView(zoom: number, center: LatLon, limit: number): ViewMotion {
  const start = startView(zoom, center, limit);
  const log = Math.log2(start.z);
  return { zoom: { position: log, velocity: 0 }, zoomTarget: log, u: spring(start.cu), v: spring(start.cv), anchor: null, gesture: false };
}

/** Holds the world point under (x, y) there while the zoom moves, gliding it to (toX, toY) on the way. */
function holdPoint(motion: ViewMotion, x: number, y: number, size: FrameSize, toX = x, toY = y) {
  const scale = size.width * 2 ** motion.zoom.position;
  const dx = x - size.width / 2;
  const dy = y - size.height / 2;
  motion.anchor = {
    u: motion.u.position + dx / scale,
    v: motion.v.position + dy / scale,
    dx: { position: dx, velocity: 0, target: toX - size.width / 2 },
    dy: { position: dy, velocity: 0, target: toY - size.height / 2 },
  };
}

function setCentre(motion: ViewMotion, u: number, v: number) {
  motion.u.position = motion.u.target = u;
  motion.v.position = motion.v.target = v;
  motion.u.velocity = 0;
  motion.v.velocity = 0;
}

/** The view springs settle within `epsilon` and below ten times that speed: the zoom in log2 units, the anchor in px. */
const ZOOM_SPRING = { stiffness: VIEW_STIFFNESS, damping: VIEW_DAMPING, epsilon: 1e-4, velocityEpsilon: 1e-3 };
const ANCHOR_SPRING = { stiffness: VIEW_STIFFNESS, damping: VIEW_DAMPING, epsilon: 0.05, velocityEpsilon: 0.5 };

/** Advances zoom and centre one frame; returns whether the view still moves. */
function stepView(motion: ViewMotion, delta: number, reduced: boolean, size: FrameSize): boolean {
  if (motion.gesture) return false;
  const zoomMoving = settleSpring(motion.zoom, motion.zoomTarget, delta, reduced, ZOOM_SPRING);
  const z = 2 ** motion.zoom.position;
  const scale = size.width * z;
  const anchor = motion.anchor;
  if (anchor) {
    const movingX = settleSpring(anchor.dx, anchor.dx.target, delta, reduced, ANCHOR_SPRING);
    const movingY = settleSpring(anchor.dy, anchor.dy.target, delta, reduced, ANCHOR_SPRING);
    const [u, v] = clampCenter(anchor.u - anchor.dx.position / scale, anchor.v - anchor.dy.position / scale, z, size);
    setCentre(motion, u, v);
    if (!zoomMoving && !movingX && !movingY) motion.anchor = null;
    return zoomMoving || movingX || movingY;
  }
  // targets are clamped for the zoom the view is heading to, positions for the zoom it has now
  [motion.u.target, motion.v.target] = clampCenter(motion.u.target, motion.v.target, 2 ** motion.zoomTarget, size);
  // the centre settles within 0.04 px on screen
  const epsilon = 0.04 / scale;
  const centerSpring = { stiffness: VIEW_STIFFNESS, damping: VIEW_DAMPING, epsilon, velocityEpsilon: epsilon * 10 };
  const movingU = settleSpring(motion.u, motion.u.target, delta, reduced, centerSpring);
  const movingV = settleSpring(motion.v, motion.v.target, delta, reduced, centerSpring);
  [motion.u.position, motion.v.position] = clampCenter(motion.u.position, motion.v.position, z, size);
  return zoomMoving || movingU || movingV;
}

/* Clustering ------------------------------------------------------------------------------------------ */

/** A cluster or a single point at one zoom level. */
interface ClusterNode {
  /** Stable across levels while a node does not split: a node with one child shares its key. */
  readonly key: string;
  /** 1 to maxLevel; single points below the deepest level are maxLevel + 1. */
  readonly level: number;
  /** Count-weighted centroid in world units. */
  readonly u: number;
  readonly v: number;
  readonly lat: number;
  readonly lon: number;
  readonly count: number;
  readonly children: readonly ClusterNode[];
  parent: ClusterNode | null;
  /** The point, when the node holds exactly one. */
  readonly point: ClusterPoint | null;
  /** Whether the points have more than one distinct position (zooming can split them). */
  readonly distinct: boolean;
}

interface ClusterTree {
  readonly points: readonly ClusterPoint[];
  readonly maxLevel: number;
  /** Nodes per level, index 1 to maxLevel, largest first. */
  readonly levels: readonly (readonly ClusterNode[])[];
  readonly leafById: ReadonlyMap<string, ClusterNode>;
}

let demoCache: readonly ClusterPoint[] | null = null;

/**
 * 600 seeded demo points around the demo cities, picked by weight: most sit in tight metro groups (which stay
 * clusters even at the largest zoom), the rest are scattered across the surrounding region (which split into single
 * points as you zoom). Each is named after the nearest city.
 */
function demoClusterPoints(): readonly ClusterPoint[] {
  if (demoCache) return demoCache;
  const perCity = new Map<string, number>();
  const metro = demoPoints(DEMO_METRO_POINTS, "geo-cluster", { spreadKm: 60 });
  const region = demoPoints(DEMO_POINTS - DEMO_METRO_POINTS, "geo-cluster-region", { spreadKm: 420 });
  demoCache = [...metro, ...region].map((point, index) => {
    const nearest = nearestLocation(DEMO_CITIES, point);
    const city = nearest ? DEMO_CITIES[nearest.index].name : (findCity(point.city)?.name ?? point.city);
    const n = (perCity.get(city) ?? 0) + 1;
    perCity.set(city, n);
    const place = nearest && nearest.km > 150 ? `${city} region` : city;
    return { id: `p${index}`, lat: Math.round(point.lat * 1e4) / 1e4, lon: Math.round(point.lon * 1e4) / 1e4, label: `Site ${n}, ${place}` };
  });
  return demoCache;
}

/** Demo points without a prop; otherwise the valid entries with unique ids. */
function normalizePoints(points: readonly ClusterPoint[] | undefined): readonly ClusterPoint[] {
  if (points === undefined) return demoClusterPoints();
  const seen = new Set<string>();
  const valid: ClusterPoint[] = [];
  for (const point of points) {
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon) || seen.has(String(point.id))) continue;
    seen.add(String(point.id));
    valid.push(point);
  }
  return valid;
}

/**
 * Builds the cluster tree from the deepest level up. At level L, nodes of level L + 1 whose centroids lie within
 * `cellSize` screen px of a seed (cellSize / (width · L) in world units) join it; seeds are taken largest first. Every
 * node therefore has its children at the next level, which is what the split and merge animations walk.
 */
function buildTree(points: readonly ClusterPoint[], maxLevel: number, cellSize: number, width: number): ClusterTree {
  const leafById = new Map<string, ClusterNode>();
  let below: ClusterNode[] = points.map((point) => {
    const world = toWorld(point.lat, point.lon);
    const leaf: ClusterNode = {
      key: `p:${point.id}`,
      level: maxLevel + 1,
      u: world.u,
      v: world.v,
      lat: point.lat,
      lon: wrapLongitude(point.lon),
      count: 1,
      children: [],
      parent: null,
      point,
      distinct: false,
    };
    leafById.set(point.id, leaf);
    return leaf;
  });
  const levels: ClusterNode[][] = [];
  for (let level = maxLevel; level >= 1; level--) {
    below = clusterLevel(below, level, cellSize / (Math.max(1, width) * level));
    levels[level] = below;
  }
  levels[0] = [];
  return { points, maxLevel, levels, leafById };
}

function clusterLevel(nodes: readonly ClusterNode[], level: number, radius: number): ClusterNode[] {
  const order = nodes.map((_, index) => index).sort((a, b) => nodes[b].count - nodes[a].count || a - b);
  const cells = new Map<number, number[]>();
  const cellOf = (value: number) => Math.floor(value / radius);
  const cellKey = (x: number, y: number) => x * 131071 + y;
  nodes.forEach((node, index) => {
    const key = cellKey(cellOf(node.u), cellOf(node.v));
    const bucket = cells.get(key);
    if (bucket) bucket.push(index);
    else cells.set(key, [index]);
  });
  const claimed = new Uint8Array(nodes.length);
  const result: ClusterNode[] = [];
  const limit = radius * radius;
  for (const seedIndex of order) {
    if (claimed[seedIndex]) continue;
    claimed[seedIndex] = 1;
    const seed = nodes[seedIndex];
    const group = [seed];
    const cx = cellOf(seed.u);
    const cy = cellOf(seed.v);
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (const index of cells.get(cellKey(x, y)) ?? []) {
          if (claimed[index]) continue;
          const other = nodes[index];
          const du = other.u - seed.u;
          const dv = other.v - seed.v;
          if (du * du + dv * dv > limit) continue;
          claimed[index] = 1;
          group.push(other);
        }
      }
    }
    result.push(groupNode(group, level, result.length));
  }
  return result.sort((a, b) => b.count - a.count);
}

function groupNode(group: readonly ClusterNode[], level: number, index: number): ClusterNode {
  if (group.length === 1) {
    const only = group[0];
    const node: ClusterNode = { ...only, level, children: [only], parent: null };
    only.parent = node;
    return node;
  }
  let count = 0;
  let u = 0;
  let v = 0;
  let distinct = false;
  for (const child of group) {
    count += child.count;
    u += child.u * child.count;
    v += child.v * child.count;
    distinct ||= child.distinct || child.u !== group[0].u || child.v !== group[0].v;
  }
  u /= count;
  v /= count;
  const centre = fromWorld(u, v);
  const node: ClusterNode = {
    key: `c${level}.${index}.${group[0].key}`,
    level,
    u,
    v,
    lat: centre.lat,
    lon: centre.lon,
    count,
    children: group,
    parent: null,
    point: null,
    distinct,
  };
  for (const child of group) child.parent = node;
  return node;
}

function ancestorAt(node: ClusterNode, level: number): ClusterNode {
  let current = node;
  while (current.level > level && current.parent) current = current.parent;
  return current;
}

function descendantsAt(node: ClusterNode, level: number, out: ClusterNode[] = []): ClusterNode[] {
  if (node.level >= level || node.children.length === 0) out.push(node);
  else for (const child of node.children) descendantsAt(child, level, out);
  return out;
}

/** Every point under a node, in tree order. */
function collectPoints(node: ClusterNode, out: ClusterPoint[] = []): ClusterPoint[] {
  if (node.children.length === 0) {
    if (node.point) out.push(node.point);
  } else {
    for (const child of node.children) collectPoints(child, out);
  }
  return out;
}

/** The zoom level at which a cluster first shows more than one node, or null when zooming cannot split it. */
function splitLevel(node: ClusterNode, maxLevel: number): number | null {
  if (!node.distinct) return null;
  let current = node;
  while (current.children.length === 1 && current.level < maxLevel) current = current.children[0];
  return current.level < maxLevel && current.children.length > 1 ? current.level + 1 : null;
}

/** Keys of the selected point's node and all its ancestors, so the cluster that holds it can show that. */
function ancestorKeys(tree: ClusterTree, id: string | null): Set<string> {
  const keys = new Set<string>();
  let node = id === null ? undefined : tree.leafById.get(id);
  while (node) {
    keys.add(node.key);
    node = node.parent ?? undefined;
  }
  return keys;
}

const placeNames = new WeakMap<ClusterNode, string>();

/** The nearest demo city within 900 km of a cluster, else its coordinates. */
function placeName(node: ClusterNode): string {
  const cached = placeNames.get(node);
  if (cached) return cached;
  const hit = nearestLocation(DEMO_CITIES, node, 900);
  const name = hit ? DEMO_CITIES[hit.index].name : formatLatLon(node, "decimal", 1);
  placeNames.set(node, name);
  return name;
}

/* Scene: what React renders --------------------------------------------------------------------------- */

interface SceneView {
  cu: number;
  cv: number;
  z: number;
}

interface SceneItem {
  key: string;
  node: ClusterNode;
  /** Merging into a parent: hidden from assistive technology and pointer events, removed on arrival. */
  exiting: boolean;
  /** The count the node shows: a merging parent counts up as its children arrive. */
  shown: number;
  /** How the node appeared: "split" grows out of its parent. */
  enter: "split" | "none";
}

interface Scene {
  tree: ClusterTree;
  view: SceneView;
  level: number;
  items: SceneItem[];
}

interface RenderedScene {
  view: SceneView;
  nodes: Map<string, ClusterNode>;
}

interface PopoverState {
  key: string;
}

/** Nodes of a level near the frame, largest first, at most MAX_NODES. */
function visibleNodes(tree: ClusterTree, level: number, viewport: Viewport): ClusterNode[] {
  const nodes = tree.levels[level] ?? [];
  const scale = viewport.width * viewport.z;
  const result: ClusterNode[] = [];
  for (const node of nodes) {
    const x = viewport.width / 2 + (node.u - viewport.cu) * scale;
    const y = viewport.height / 2 + (node.v - viewport.cv) * scale;
    if (x < -CULL_MARGIN || x > viewport.width + CULL_MARGIN || y < -CULL_MARGIN || y > viewport.height + CULL_MARGIN) continue;
    result.push(node);
    if (result.length >= MAX_NODES) break;
  }
  return result;
}

function initialScene(tree: ClusterTree, view: SceneView): Scene {
  const level = levelFor(view.z, tree.maxLevel);
  const viewport: Viewport = { ...view, width: NOMINAL_WIDTH, height: NOMINAL_WIDTH / ASPECT };
  const items = visibleNodes(tree, level, viewport).map(
    (node): SceneItem => ({ key: node.key, node, exiting: false, shown: node.count, enter: "none" }),
  );
  return { tree, view, level, items };
}

/* Model: the nodes the loop animates ------------------------------------------------------------------ */

interface Entry {
  readonly key: string;
  node: ClusterNode;
  /** Offset from the node's centroid in world units, springing toward targetU/targetV. */
  offsetU: Spring;
  offsetV: Spring;
  targetU: number;
  targetV: number;
  /** The node this one merges into, or null while it is live. */
  into: ClusterNode | null;
  /** The count it adds to its parent on arrival. */
  carry: number;
  /** For a live node: the count still flying in. */
  pending: number;
  /** Pool boost when a child arrives, decaying. */
  pulse: number;
  /** Pool boost while hovered or focused. */
  glow: number;
  enter: "split" | "none";
}

interface Model {
  tree: ClusterTree | null;
  level: number;
  entries: Map<string, Entry>;
  dirty: boolean;
  /** The view of the last culling pass. */
  cullView: SceneView | null;
  /** Where focus goes when a node is removed: its parent after a merge, its largest child after a split. */
  handoff: Map<string, string>;
}

const createModel = (): Model => ({ tree: null, level: 0, entries: new Map(), dirty: false, cullView: null, handoff: new Map() });

const liveEntry = (node: ClusterNode): Entry => ({
  key: node.key,
  node,
  offsetU: { position: 0, velocity: 0 },
  offsetV: { position: 0, velocity: 0 },
  targetU: 0,
  targetV: 0,
  into: null,
  carry: 0,
  pending: 0,
  pulse: 0,
  glow: 0,
  enter: "none",
});

function resetModel(model: Model, tree: ClusterTree, level: number, viewport: Viewport) {
  model.tree = tree;
  model.level = level;
  model.entries.clear();
  model.handoff.clear();
  for (const node of visibleNodes(tree, level, viewport)) model.entries.set(node.key, liveEntry(node));
  model.cullView = { cu: viewport.cu, cv: viewport.cv, z: viewport.z };
  model.dirty = true;
}

/**
 * The zoom crossed a level. Finer nodes fly into their ancestor at the new level (which counts them in as they
 * arrive); coarser nodes split, their children starting where the parent is and springing to their own centroids.
 * In-flight merges and splits are retargeted, so fast zooming chains cleanly. Reduced motion swaps without motion.
 */
function reconcile(model: Model, level: number, viewport: Viewport, reduced: boolean) {
  const old = [...model.entries.values()];
  const next = new Map<string, Entry>();
  const scale = viewport.width * viewport.z;
  const makeLive = (entry: Entry, node: ClusterNode) => {
    entry.node = node;
    entry.into = null;
    entry.targetU = 0;
    entry.targetV = 0;
    next.set(entry.key, entry);
  };

  for (const entry of old) if (entry.node.level === level) makeLive(entry, entry.node);

  for (const entry of old) {
    if (entry.node.level <= level) continue;
    const ancestor = ancestorAt(entry.node, level);
    if (ancestor.key === entry.key) {
      makeLive(entry, ancestor);
      continue;
    }
    model.handoff.set(entry.key, ancestor.key);
    if (!next.has(ancestor.key)) next.set(ancestor.key, liveEntry(ancestor));
    if (reduced) continue;
    entry.carry = entry.into ? entry.carry : Math.max(0, entry.node.count - entry.pending);
    entry.into = ancestor;
    entry.targetU = ancestor.u - entry.node.u;
    entry.targetV = ancestor.v - entry.node.v;
    next.set(entry.key, entry);
  }

  // coarser nodes split; finer ones first, so children of an in-flight node start from it
  const coarser = old.filter((entry) => entry.node.level < level).sort((a, b) => b.node.level - a.node.level);
  let spawned = 0;
  for (const entry of coarser) {
    const children = descendantsAt(entry.node, level).sort((a, b) => b.count - a.count);
    if (children.length === 1 && children[0].key === entry.key) {
      if (!next.has(entry.key)) makeLive(entry, children[0]);
      continue;
    }
    model.handoff.set(entry.key, children[0].key);
    const fromU = entry.node.u + entry.offsetU.position;
    const fromV = entry.node.v + entry.offsetV.position;
    for (const child of children) {
      if (next.has(child.key) || spawned >= MAX_NODES) continue;
      const x = viewport.width / 2 + (child.u - viewport.cu) * scale;
      const y = viewport.height / 2 + (child.v - viewport.cv) * scale;
      const margin = CULL_MARGIN * 3;
      if (x < -margin || x > viewport.width + margin || y < -margin || y > viewport.height + margin) continue;
      const created = liveEntry(child);
      if (!reduced) {
        created.offsetU = { position: fromU - child.u, velocity: entry.offsetU.velocity };
        created.offsetV = { position: fromV - child.v, velocity: entry.offsetV.velocity };
        created.enter = "split";
      }
      next.set(child.key, created);
      spawned++;
    }
  }

  for (const entry of next.values()) if (!entry.into) entry.pending = 0;
  for (const entry of next.values()) {
    if (!entry.into) continue;
    const host = next.get(entry.into.key);
    if (host) host.pending += entry.carry;
    else next.delete(entry.key);
  }
  model.entries = next;
  model.level = level;
  model.dirty = true;
  cull(model, viewport);
}

/** Springs every node one frame; merging nodes that reach their parent are removed. Returns whether any moves. */
function stepEntries(model: Model, delta: number, reduced: boolean, viewport: Viewport, focusKey: string | null): boolean {
  const scale = viewport.width * viewport.z;
  let moving = false;
  for (const entry of model.entries.values()) {
    const glowTarget = entry.key === focusKey ? 1 : 0;
    if (reduced || Math.abs(glowTarget - entry.glow) < 0.01) entry.glow = glowTarget;
    else {
      entry.glow += (glowTarget - entry.glow) * (1 - Math.exp(-delta / 0.09));
      moving = true;
    }
    if (entry.pulse > 0) {
      entry.pulse = reduced || entry.pulse < 0.01 ? 0 : entry.pulse * Math.exp(-delta / 0.3);
      moving = true;
    }
    if (reduced) {
      entry.offsetU = { position: entry.targetU, velocity: 0 };
      entry.offsetV = { position: entry.targetV, velocity: 0 };
    } else {
      springStep(entry.offsetU, entry.targetU, delta, NODE_STIFFNESS, NODE_DAMPING);
      springStep(entry.offsetV, entry.targetV, delta, NODE_STIFFNESS, NODE_DAMPING);
    }
    const distance = Math.hypot(entry.offsetU.position - entry.targetU, entry.offsetV.position - entry.targetV) * scale;
    if (entry.into) {
      const host = model.entries.get(entry.into.key);
      if (!host || distance < 2 || reduced) {
        model.entries.delete(entry.key);
        if (host) {
          host.pending = Math.max(0, host.pending - entry.carry);
          host.pulse = 1;
        }
        model.dirty = true;
      }
      moving = true;
      continue;
    }
    const speed = Math.hypot(entry.offsetU.velocity, entry.offsetV.velocity) * scale;
    if (distance < 0.05 && speed < 1) {
      entry.offsetU = { position: entry.targetU, velocity: 0 };
      entry.offsetV = { position: entry.targetV, velocity: 0 };
    } else {
      moving = true;
    }
  }
  return moving;
}

function viewMoved(model: Model, viewport: Viewport) {
  const last = model.cullView;
  if (!last) return true;
  const scale = viewport.width * viewport.z;
  return (
    Math.abs(viewport.cu - last.cu) * scale > 12 || Math.abs(viewport.cv - last.cv) * scale > 12 || Math.abs(Math.log2(viewport.z / last.z)) > 0.04
  );
}

/** Adds nodes that came into view and removes resting nodes that left it. */
function cull(model: Model, viewport: Viewport) {
  const tree = model.tree;
  if (!tree) return;
  model.cullView = { cu: viewport.cu, cv: viewport.cv, z: viewport.z };
  const visible = visibleNodes(tree, model.level, viewport);
  const keep = new Set<string>();
  for (const node of visible) {
    keep.add(node.key);
    if (model.entries.has(node.key)) continue;
    model.entries.set(node.key, liveEntry(node));
    model.dirty = true;
  }
  for (const entry of model.entries.values()) {
    if (entry.into || entry.pending > 0 || keep.has(entry.key)) continue;
    const resting = entry.offsetU.velocity === 0 && entry.offsetV.velocity === 0 && entry.offsetU.position === 0 && entry.offsetV.position === 0;
    if (!resting) continue;
    model.entries.delete(entry.key);
    model.dirty = true;
  }
}

/** The model as React state. `tree` is the tree the model was built from (step resets the model on a new tree). */
function sceneOf(model: Model, tree: ClusterTree, viewport: Viewport): Scene {
  const items: SceneItem[] = [];
  for (const entry of model.entries.values()) {
    items.push({
      key: entry.key,
      node: entry.node,
      exiting: entry.into !== null,
      shown: entry.into ? entry.carry : Math.max(0, entry.node.count - entry.pending),
      enter: entry.enter,
    });
    entry.enter = "none";
  }
  // live nodes first, largest first: the DOM order screen readers and Tab follow
  items.sort((a, b) => Number(a.exiting) - Number(b.exiting) || b.node.count - a.node.count || (a.key < b.key ? -1 : 1));
  return { tree, view: { cu: viewport.cu, cv: viewport.cv, z: viewport.z }, level: model.level, items };
}

/** 'Zoom 3×, 12 clusters, 4 points' for the nodes inside the frame. */
function describeView(model: Model, viewport: Viewport) {
  const scale = viewport.width * viewport.z;
  let clusters = 0;
  let single = 0;
  for (const entry of model.entries.values()) {
    if (entry.into) continue;
    const x = viewport.width / 2 + (entry.node.u - viewport.cu) * scale;
    const y = viewport.height / 2 + (entry.node.v - viewport.cv) * scale;
    if (x < 0 || x > viewport.width || y < 0 || y > viewport.height) continue;
    if (entry.node.point) single++;
    else clusters++;
  }
  const zoom = Math.round(viewport.z * 10) / 10;
  const zoomText = formatNumber(zoom, { fractionDigits: Number.isInteger(zoom) ? 0 : 1 });
  const plural = (n: number, word: string) => `${formatNumber(n)} ${word}${n === 1 ? "" : "s"}`;
  return `Zoom ${zoomText}×, ${plural(clusters, "cluster")}, ${plural(single, "point")}`;
}

/* Runtime: land bakes, light and sparks --------------------------------------------------------------- */

/** A ring of light running out through the land dots from a split or a selection. */
interface Ripple {
  u: number;
  v: number;
  start: number;
  /** Final radius in px. */
  reach: number;
  strength: number;
}

/** A land lattice for one settled view, drawn once into an offscreen canvas and scaled while the view moves. */
interface Bake {
  /** The whole-world lattice at zoom 1: always kept, used at zoom 1 and as the fallback around zoomed bakes. */
  readonly world: boolean;
  readonly lattice: DotLattice;
  /** The view it was built for. */
  readonly view: Viewport;
  /** The area it covers, in that view's frame px. */
  readonly rect: { x0: number; y0: number; x1: number; y1: number };
  readonly canvas: HTMLCanvasElement;
  readonly dpr: number;
}

interface DragState {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  touch: boolean;
  samples: { x: number; y: number; t: number }[];
}

interface PinchState {
  distance: number;
  zoom: number;
  /** World point under the pinch midpoint when it started. */
  u: number;
  v: number;
}

interface Runtime {
  ink: GeoInk | null;
  inkStale: boolean;
  resized: boolean;
  world: Bake | null;
  /** The newest bake last; an older one fades out under it. */
  bakes: Bake[];
  fadeStart: number;
  fadeDuration: number;
  /** The first lattice grows out from the centre behind an uneven front. */
  revealStart: number;
  bakeTimer: number;
  batch: DotBatch | null;
  heat: Float32Array;
  tone: Float32Array;
  touched: Int32Array;
  ripples: Ripple[];
  sparks: Sparks;
  sparksDirty: boolean;
  settled: boolean;
  reportedCenter: LatLon | null;
  announcement: string;
  pointers: Map<number, { x: number; y: number }>;
  drag: DragState | null;
  pinch: PinchState | null;
  suppressClick: boolean;
  hoverKey: string | null;
  focusKey: string | null;
  /** Whether the focused node got focus from the keyboard (only then does its pool glow). */
  focusGlow: boolean;
  frame: number;
  /** performance.now() of the last node activated by a click. */
  lastActivation: number;
  /** Whether any node moved in the last frame. */
  nodesMoving: boolean;
}

const createRuntime = (): Runtime => ({
  ink: null,
  inkStale: true,
  resized: false,
  world: null,
  bakes: [],
  fadeStart: 0,
  fadeDuration: CROSSFADE_MS,
  revealStart: -1,
  bakeTimer: 0,
  batch: null,
  heat: new Float32Array(0),
  tone: new Float32Array(0),
  touched: new Int32Array(0),
  ripples: [],
  sparks: new Sparks(),
  sparksDirty: false,
  settled: false,
  reportedCenter: null,
  announcement: "",
  pointers: new Map(),
  drag: null,
  pinch: null,
  suppressClick: false,
  hoverKey: null,
  focusKey: null,
  focusGlow: false,
  frame: 0,
  lastActivation: -Infinity,
  nodesMoving: false,
});

const REVEAL_MS = 900;

/** Maps a bake's frame px into the current view: x = s·xBake + ox. */
function bakeTransform(from: Viewport, to: Viewport) {
  const s = (to.width * to.z) / (from.width * from.z);
  return {
    s,
    ox: to.width / 2 + (from.cu - to.cu) * to.width * to.z - (s * from.width) / 2,
    oy: to.height / 2 + (from.cv - to.cv) * to.width * to.z - (s * from.height) / 2,
  };
}

/** Builds the land lattice for a view: Mercator to ±78° with the width fitted at zoom 1, re-sampled at 4 px. */
function createBake(view: Viewport, world: boolean, ink: GeoInk): Bake {
  const { width, height } = view;
  const fit = Math.min(width / TAU, height / (2 * Y_MAX));
  const projection = createProjection("mercator", {
    width,
    height,
    latRange: [-LAT_LIMIT, LAT_LIMIT],
    center: { lat: 0, lon: CENTRAL_LON },
    zoom: (view.z * width) / TAU / fit,
    focus: fromWorld(view.cu, view.cv),
  });
  const frame = projection.frame;
  const box = world
    ? { x0: frame.x0, y0: frame.y0, x1: frame.x1, y1: frame.y1 }
    : { x0: -BAKE_MARGIN * width, y0: -BAKE_MARGIN * height, x1: (1 + BAKE_MARGIN) * width, y1: (1 + BAKE_MARGIN) * height };
  const lattice = mapLattice(projection, { pitch: LATTICE_PITCH, viewport: box });
  const rect = {
    x0: Math.max(box.x0, frame.x0),
    y0: Math.max(box.y0, frame.y0),
    x1: Math.min(box.x1, frame.x1),
    y1: Math.min(box.y1, frame.y1),
  };
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil((rect.x1 - rect.x0) * dpr));
  canvas.height = Math.max(1, Math.ceil((rect.y1 - rect.y0) * dpr));
  const bake: Bake = { world, lattice, view: { ...view }, rect, canvas, dpr };
  paintBake(bake, ink);
  return bake;
}

function paintBake(bake: Bake, ink: GeoInk) {
  const context = bake.canvas.getContext("2d");
  if (!context) return;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, bake.canvas.width, bake.canvas.height);
  context.setTransform(bake.dpr, 0, 0, bake.dpr, -bake.rect.x0 * bake.dpr, -bake.rect.y0 * bake.dpr);
  bakeLattice(context, bake.lattice, ink.land, DOT_SIZE);
}

/** Theme change: repaint every bake in the new colours. */
function repaintBakes(state: Runtime) {
  const ink = state.ink;
  if (!ink) return;
  if (state.world) paintBake(state.world, ink);
  for (const bake of state.bakes) if (bake !== state.world) paintBake(bake, ink);
  state.batch?.setRamp(lightRamp(ink));
}

const lightRamp = (ink: GeoInk) => [ink.land, ink.accent, ink.glint];

const worldView = (size: FrameSize): Viewport => ({ cu: 0.5, cv: WORLD_HEIGHT / 2, z: 1, ...size });

/** Whether the newest bake no longer matches the settled view. */
function bakeNeeded(state: Runtime, viewport: Viewport) {
  const newest = state.bakes[state.bakes.length - 1];
  if (!newest) return true;
  if (viewport.z < 1.01) return !newest.world || newest.view.width !== viewport.width;
  if (newest.world) return true;
  const view = newest.view;
  if (view.width !== viewport.width || Math.abs(Math.log2(view.z / viewport.z)) > 0.005) return true;
  const scale = viewport.width * viewport.z;
  return Math.abs(view.cu - viewport.cu) * scale > 0.5 || Math.abs(view.cv - viewport.cv) * scale > 0.5;
}

/** Builds the bake for a settled view and crossfades it in (the first one grows in from the centre). */
function addBake(state: Runtime, viewport: Viewport, ink: GeoInk, now: number, reduced: boolean) {
  const size = { width: viewport.width, height: viewport.height };
  if (!state.world || state.world.view.width !== size.width) state.world = createBake(worldView(size), true, ink);
  const bake = viewport.z < 1.01 ? state.world : createBake(viewport, false, ink);
  const newest = state.bakes[state.bakes.length - 1];
  if (newest === bake) return;
  if (!newest && !reduced) state.revealStart = now;
  state.bakes = newest && !reduced ? [newest, bake] : [bake];
  state.fadeStart = now;
  state.fadeDuration = CROSSFADE_MS;
  if (!state.batch) state.batch = createDotBatch(2048, lightRamp(ink), { tones: 24, levels: 12 });
}

/** Draws the land and its light for the current view. Returns whether a fade, reveal or ripple is still running. */
function drawMap(
  surface: CanvasSurface,
  state: Runtime,
  model: Model,
  viewport: Viewport,
  ink: GeoInk,
  now: number,
  reduced: boolean,
  selected: string | null,
): boolean {
  const { context, width, height } = surface;
  context.clearRect(0, 0, width, height);
  const newest = state.bakes[state.bakes.length - 1];
  if (!newest) return false;
  const fade = reduced ? 1 : clamp((now - state.fadeStart) / state.fadeDuration, 0, 1);
  const reveal = state.revealStart < 0 || reduced ? 1 : clamp((now - state.revealStart) / REVEAL_MS, 0, 1);
  const t = bakeTransform(newest.view, viewport);
  const rect = {
    x: t.ox + t.s * newest.rect.x0,
    y: t.oy + t.s * newest.rect.y0,
    w: t.s * (newest.rect.x1 - newest.rect.x0),
    h: t.s * (newest.rect.y1 - newest.rect.y0),
  };

  // around a zoomed bake, the world lattice's dots fill in until the new view's lattice is ready
  const world = state.world;
  if (world && newest !== world && (rect.x > 0 || rect.y > 0 || rect.x + rect.w < width || rect.y + rect.h < height)) {
    // skipped per dot rather than clipped: a clip with a hole is slow on a GPU canvas
    drawLatticeDots(context, world, viewport, ink, rect);
  }
  if (fade < 1) {
    for (const bake of state.bakes) {
      if (bake === newest) continue;
      context.save();
      context.beginPath();
      context.rect(rect.x, rect.y, rect.w, rect.h);
      context.clip();
      context.globalAlpha = 1 - fade * fade;
      drawBakeImage(context, bake, viewport, ink);
      context.restore();
    }
  } else if (state.bakes.length > 1) {
    state.bakes = [newest];
  }
  const alpha = 1 - (1 - fade) * (1 - fade);
  if (reveal < 1) {
    drawReveal(context, state, newest, viewport, reveal);
  } else {
    if (state.revealStart >= 0) state.revealStart = -1;
    context.globalAlpha = alpha;
    drawBakeImage(context, newest, viewport, ink);
    context.globalAlpha = 1;
  }
  drawLight(context, state, model, newest, viewport, now, selected, alpha);
  return fade < 1 || reveal < 1 || state.ripples.length > 0;
}

/**
 * A bake in the current view. At its own scale it is one drawImage; while the view zooms the dots are drawn one by
 * one, spreading apart at their true size when zooming in (never blown up into blocks) and shrinking when zooming out.
 */
function drawBakeImage(context: CanvasRenderingContext2D, bake: Bake, viewport: Viewport, ink: GeoInk) {
  const t = bakeTransform(bake.view, viewport);
  if (Math.abs(t.s - 1) > 0.002) {
    drawLatticeDots(context, bake, viewport, ink);
    return;
  }
  context.drawImage(
    bake.canvas,
    t.ox + t.s * bake.rect.x0,
    t.oy + t.s * bake.rect.y0,
    t.s * (bake.rect.x1 - bake.rect.x0),
    t.s * (bake.rect.y1 - bake.rect.y0),
  );
}

/** A lattice as individual dots at their true size (sparser while zoomed in, never blown up). */
function drawLatticeDots(
  context: CanvasRenderingContext2D,
  bake: Bake,
  viewport: Viewport,
  ink: GeoInk,
  skip: { x: number; y: number; w: number; h: number } | null = null,
) {
  const t = bakeTransform(bake.view, viewport);
  const { lattice } = bake;
  const detail = detailOf(t.s);
  const half = DOT_SIZE / 2;
  const base = context.globalAlpha;
  context.fillStyle = `rgb(${ink.land[0] | 0},${ink.land[1] | 0},${ink.land[2] | 0})`;
  // one pass for the dots drawn in full, a second, fainter one for the dots thinning out
  const passes = detail.thinned ? 2 : 1;
  for (let pass = 1; pass <= passes; pass++) {
    if (pass === 2 && detail.fade <= 0) break;
    context.globalAlpha = base * (pass === 1 ? 1 : detail.fade);
    for (let i = 0; i < lattice.count; i++) {
      const x = t.s * lattice.x[i] + t.ox;
      const y = t.s * lattice.y[i] + t.oy;
      if (x < -2 || y < -2 || x > viewport.width + 2 || y > viewport.height + 2) continue;
      if (skip && x >= skip.x && x <= skip.x + skip.w && y >= skip.y && y <= skip.y + skip.h) continue;
      if (detail.thinned && dotRank(lattice, i, detail.stride) !== pass) continue;
      context.fillRect(x - half, y - half, DOT_SIZE, DOT_SIZE);
    }
  }
  context.globalAlpha = base;
}

/**
 * Level of detail for a lattice drawn smaller than it was built (zooming out): the dots would crowd together, so only
 * every `stride`-th row and column is kept, and the dots between every 2·stride-th fade out as the scale falls toward
 * the next halving. The lattice keeps about its own pitch on screen and meets the coarser lattice around it.
 */
function detailOf(scale: number) {
  if (scale >= 0.999) return { thinned: false, stride: 1, fade: 1 };
  const stride = 2 ** Math.floor(Math.log2(1 / scale) + 1e-9);
  return { thinned: true, stride, fade: clamp((scale * stride - 0.5) / 0.5, 0, 1) };
}

/** 0: hidden at this stride; 1: drawn in full; 2: thinning out. */
type DotRank = 0 | 1 | 2;

function dotRank(lattice: DotLattice, index: number, stride: number): DotRank {
  const row = lattice.row[index];
  const column = lattice.column[index];
  if (row % stride !== 0 || column % stride !== 0) return 0;
  return row % (stride * 2) === 0 && column % (stride * 2) === 0 ? 1 : 2;
}

/** The first lattice grows out from the frame centre: near dots first, with jitter so the front is uneven. */
function drawReveal(context: CanvasRenderingContext2D, state: Runtime, bake: Bake, viewport: Viewport, progress: number) {
  const batch = state.batch;
  if (!batch) return;
  const t = bakeTransform(bake.view, viewport);
  const { lattice } = bake;
  const growth = easeOutCubic(progress) * 1.12;
  const reach = Math.hypot(viewport.width, viewport.height) / 2;
  const detail = detailOf(t.s);
  for (let i = 0; i < lattice.count; i++) {
    const x = t.s * lattice.x[i] + t.ox;
    const y = t.s * lattice.y[i] + t.oy;
    if (x < -2 || y < -2 || x > viewport.width + 2 || y > viewport.height + 2) continue;
    const rank = detail.thinned ? dotRank(lattice, i, detail.stride) : 1;
    if (rank === 0) continue;
    const n = Math.hypot(x - viewport.width / 2, y - viewport.height / 2) / reach;
    const threshold = n * 0.82 + lattice.jitter[i] * 0.18;
    const appear = clamp((growth - threshold) / 0.08, 0, 1);
    if (appear <= 0) continue;
    // the front itself is lit, then cools to the land grey
    const front = Math.exp(-(growth - threshold) / 0.06);
    batch.add(x, y, DOT_SIZE * (1 + front * 0.3), front * 0.55, rank === 1 ? appear : appear * detail.fade);
  }
  batch.flush(context);
}

/** Pools of light under the nodes and the ripples, as tinted lattice dots over the land. */
function drawLight(
  context: CanvasRenderingContext2D,
  state: Runtime,
  model: Model,
  bake: Bake,
  viewport: Viewport,
  now: number,
  selected: string | null,
  alpha: number,
) {
  const batch = state.batch;
  if (!batch) return;
  const { lattice } = bake;
  if (state.heat.length < lattice.count) {
    state.heat = new Float32Array(lattice.count);
    state.tone = new Float32Array(lattice.count);
    state.touched = new Int32Array(lattice.count);
  }
  const { heat, tone, touched } = state;
  let touchedCount = 0;
  const t = bakeTransform(bake.view, viewport);
  const scale = viewport.width * viewport.z;
  const light = (x: number, y: number, radius: number, shade: (index: number, distance: number) => void) => {
    if (x < -radius || y < -radius || x > viewport.width + radius || y > viewport.height + radius) return;
    lattice.grid.query((x - t.ox) / t.s, (y - t.oy) / t.s, radius / t.s, (index, distanceSquared) => shade(index, Math.sqrt(distanceSquared) * t.s));
  };
  const record = (index: number, value: number, shadeTone: number) => {
    if (value <= heat[index] || value < 0.03) return;
    if (heat[index] === 0) touched[touchedCount++] = index;
    heat[index] = value;
    tone[index] = shadeTone;
  };

  for (const entry of model.entries.values()) {
    const node = entry.node;
    const x = viewport.width / 2 + (node.u + entry.offsetU.position - viewport.cu) * scale;
    const y = viewport.height / 2 + (node.v + entry.offsetV.position - viewport.cv) * scale;
    const cluster = node.point === null;
    const shown = entry.into ? entry.carry : node.count - entry.pending;
    if (shown <= 0) continue;
    let fadeOut = 1;
    if (entry.into) {
      const remaining = Math.hypot(entry.offsetU.position - entry.targetU, entry.offsetV.position - entry.targetV) * scale;
      fadeOut = clamp((remaining - 2) / 18, 0, 1);
    }
    const isSelected = node.point !== null && node.point.id === selected;
    // the light is brightest at the rim of the circle and thins out over an uneven edge; busier clusters cast wider pools
    const rim = cluster ? clusterDiameter(node.count) / 2 : 3;
    const spread = cluster ? 12 + 3 * Math.log10(node.count) : isSelected ? 13 : 9;
    const strength = ((cluster ? 0.7 : 0.5) + entry.glow * 0.3 + entry.pulse * 0.45 + (isSelected ? 0.4 : 0)) * fadeOut;
    light(x, y, rim + spread * 1.2 + 2, (index, distance) => {
      const edge = rim + spread * (0.7 + lattice.jitter[index] * 0.5);
      const value = strength * smoothstep(edge, rim * 0.85, distance);
      record(index, value, Math.min(0.5, value * 0.5 + entry.pulse * 0.15));
    });
  }

  const ripples: Ripple[] = [];
  for (const ripple of state.ripples) {
    const age = (now - ripple.start) / RIPPLE_MS;
    if (age >= 1) continue;
    ripples.push(ripple);
    const x = viewport.width / 2 + (ripple.u - viewport.cu) * scale;
    const y = viewport.height / 2 + (ripple.v - viewport.cv) * scale;
    const radius = ripple.reach * easeOutCubic(age);
    const fadeOut = (1 - age) * ripple.strength;
    light(x, y, radius + 12, (index, distance) => {
      const value = ringFront(distance, radius, 6, lattice.jitter[index], 6) * fadeOut;
      record(index, value, 0.42 + value * 0.5);
    });
  }
  state.ripples = ripples;

  // lit dots follow the same level of detail as the land under them
  const detail = detailOf(t.s);
  for (let k = 0; k < touchedCount; k++) {
    const index = touched[k];
    const value = heat[index];
    heat[index] = 0;
    const rank = detail.thinned ? dotRank(lattice, index, detail.stride) : 1;
    if (rank === 0) continue;
    const weight = rank === 1 ? alpha : alpha * detail.fade;
    batch.add(t.s * lattice.x[index] + t.ox, t.s * lattice.y[index] + t.oy, DOT_SIZE * (1 + value * 0.45), tone[index], weight);
  }
  batch.flush(context);
}

/** Sparks thrown outward from a ring of `radius` px around (x, y), so none crosses the node's own count. */
function ringBurst(sparks: Sparks, x: number, y: number, radius: number, count: number, colors: readonly RGB[]) {
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * TAU + Math.random() * 0.5;
    const color = colors[i % colors.length];
    sparks.add(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, 1, [color], { ...SPARK_OPTIONS, angle, spread: 0.7, jitter: 0.5 });
  }
}

/** Sparks on the canvas that reaches past the map. Returns whether any are alive. */
function drawSparks(surface: CanvasSurface, state: Runtime, delta: number) {
  if (!state.sparks.active && !state.sparksDirty) return false;
  surface.context.clearRect(0, 0, surface.width, surface.height);
  const alive = state.sparks.step(surface.context, delta);
  state.sparksDirty = alive;
  return alive;
}
