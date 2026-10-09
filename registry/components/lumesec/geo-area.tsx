"use client";

import * as React from "react";

import { localPoint, useCanvas, type CanvasSurface } from "@/lib/lumesec/canvas";
import { usePalette } from "@/lib/lumesec/color";
import {
  bakeLattice,
  countryBounds,
  countryMembership,
  createDotBatch,
  createProjection,
  createScreenPoint,
  GEO_TOKENS,
  geoInk,
  mapLattice,
  projectionAspect,
  ringFront,
  wrapLongitude,
  type DotBatch,
  type DotLattice,
  type GeoBounds,
  type GeoInk,
  type MapProjection,
} from "@/lib/lumesec/geo";
import { COUNTRIES, countryAt, type Country } from "@/lib/lumesec/geo-countries";
import { demoPoints, formatNumber } from "@/lib/lumesec/geo-data";
import { clamp, easeOutCubic, hash, mixRgb, percent, rgba } from "@/lib/lumesec/math";
import {
  prefersReducedMotion,
  shake,
  springStep,
  useAnimationLoop,
  useLazyRef,
  type Spring,
} from "@/lib/lumesec/motion";
import { RollText } from "@/lib/lumesec/roll-text";
import { useControllableState, useFormReset } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** A box of latitude and longitude, `{ west, south, east, north }` in degrees, re-exported from the geo module. */
export type { GeoBounds } from "@/lib/lumesec/geo";

/** A point drawn on the map and counted when it lies inside the area. */
export interface AreaPoint {
  /** Latitude in degrees. */
  readonly lat: number;
  /** Longitude in degrees. */
  readonly lon: number;
}

/** Map projection of `GeoArea`. Both keep the selected area a rectangle. */
export type AreaProjection = "equirectangular" | "mercator";

/** Props of `GeoArea`; the remaining `div` props go to the root. */
export interface GeoAreaProps extends Omit<React.ComponentProps<"div">, "defaultValue"> {
  /**
   * Selected area `{ west, south, east, north }` in degrees (controlled). Use with `onValueChange`. `east` may exceed
   * 180 when the area crosses the date line; an `east` smaller than `west` reads the same way. `null` selects nothing.
   */
  value?: GeoBounds | null;
  /**
   * Selected area when uncontrolled. A form reset restores it. Without it the area starts empty, except in the demo
   * (no `points`), which starts with a box over Europe.
   */
  defaultValue?: GeoBounds | null;
  /** Called with the snapped bounds when a gesture, key press or typed edge commits, and with null when cleared. */
  onValueChange?: (value: GeoBounds | null) => void;
  /** Called with unsnapped bounds (rounded to 0.01°) while drawing, moving or resizing. */
  onValueInput?: (value: GeoBounds) => void;
  /**
   * `{ lat, lon }` points drawn on the map and counted inside the area. Without it 2,400 demo points around large
   * cities are shown. An empty list hides the count.
   */
  points?: readonly AreaPoint[];
  /** Snap and keyboard step in degrees, from 0.01 to 30. Released and typed edges snap to multiples of it. */
  step?: number;
  /** Map projection. Both keep the box rectangular. */
  projection?: AreaProjection;
  /** Form field name. With a name and an area, a hidden input submits 'west,south,east,north'. */
  name?: string;
  /** Blocks form submission while no area is selected. */
  required?: boolean;
  /** Dims the selector and disables drawing, the edge fields and Clear. */
  disabled?: boolean;
  /** Accessible name of the map; the selected bounds follow it. */
  label?: string;
}

/**
 * Select an area by drawing a rectangle of latitude and longitude on a dot map, for example to filter events by place.
 * Move it, resize it from its edges and corners, type exact bounds, or double-click a country to fit the box to it.
 *
 * While you draw, the land inside fills behind the pointer with a bright, uneven front: every dot keeps the moment it
 * entered, flashes toward the glint and settles into the accent, and dots that leave fade, so a moved box leaves a
 * short wake. The dotted border marches while the box changes, and the count of points inside rolls. On release the
 * edges snap to multiples of `step` on springs. The box can cross the date line; it is then drawn on both sides of the
 * map.
 *
 * @example
 * <GeoArea points={events} step={1} onValueChange={(area) => setFilter(area)} />
 */
export function GeoArea({
  value,
  defaultValue,
  onValueChange,
  onValueInput,
  points,
  step = 1,
  projection = "equirectangular",
  name,
  required = false,
  disabled = false,
  label = "Area",
  ref,
  className,
  ...props
}: GeoAreaProps) {
  const list = points ?? demoAreaPoints();
  const kind: AreaProjection = projection === "mercator" ? "mercator" : "equirectangular";
  const stepDeg = validStep(step);
  // the demo opens with a selection; with real data the area starts empty unless a default is given
  const startValue = defaultValue !== undefined ? defaultValue : points === undefined ? DEMO_VALUE : null;

  const [rawValue, setValue] = useControllableState<GeoBounds | null>({
    value,
    defaultValue: startValue,
    onChange: onValueChange,
  });
  const committed = React.useMemo(() => normalizeBounds(rawValue), [rawValue]);
  const committedCount = React.useMemo(() => countInside(committed, list), [committed, list]);

  /** Bounds (rounded to the step) and count while a gesture runs, pushed at most ten times a second. */
  const [live, setLive] = React.useState<LiveState | null>(null);
  const [gesture, setGesture] = React.useState<PressKind | null>(null);
  /** Text being typed into one of the edge fields, while it has focus. */
  const [draft, setDraft] = React.useState<{ edge: Edge; text: string } | null>(null);
  const [invalid, setInvalid] = React.useState(false);
  const [chip, setChip] = React.useState<{ key: number; name: string } | null>(null);
  /** Bumped on every commit attempt, so a controlled parent that refuses a value still moves the box back. */
  const [revision, setRevision] = React.useState(0);
  // The server markup places the box with percentages; the frame loop moves it in px from there.
  const [initialCopies] = React.useState(() => copyStyles(committed, kind));

  const shown = live ? live.bounds : committed;
  const shownCount = live ? live.count : committedCount;
  const total = list.length;
  const showInvalid = invalid && !committed;

  const baseId = React.useId();
  const helpId = `${baseId}-help`;

  const rootRef = React.useRef<HTMLDivElement>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const baseRef = React.useRef<HTMLCanvasElement>(null);
  const overlayRef = React.useRef<HTMLCanvasElement>(null);
  const copyRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const handleRefs = React.useRef<(HTMLSpanElement | null)[]>([]);
  const fieldRefs = React.useRef<Partial<Record<Edge, HTMLDivElement | null>>>({});
  const validityRef = React.useRef<HTMLInputElement>(null);
  /** The map engine, created on first use in an effect or handler, never during render or on the server. */
  const engineRef = useLazyRef(() => new AreaEngine());
  const pressRef = React.useRef<Press | null>(null);
  /** Spring for the next value change made here; external changes use the snap spring. */
  const pendingSpring = React.useRef<SpringConfig | null>(null);
  /** The first value is placed without springs. */
  const placedRef = React.useRef(false);
  const liveThrottle = React.useRef({ time: 0, key: "" });
  const inputKey = React.useRef("");

  React.useImperativeHandle(ref, () => rootRef.current!, []);

  const loop = useAnimationLoop(rootRef, frame);
  const palette = usePalette(rootRef, GEO_TOKENS, applyTheme);
  const base = useCanvas(
    baseRef,
    (surface) => {
      engineRef.current.layout(surface.width, surface.height, kind);
      loop.kick();
    },
    MAP_CANVAS,
  );
  const overlay = useCanvas(overlayRef, () => loop.kick(), MAP_CANVAS);

  function frame(_time: number, delta: number) {
    const engine = engineRef.current;
    const now = clockNow();
    const moving = engine.step(base.current, overlay.current, delta, now, prefersReducedMotion());
    placeCopies(engine);
    if (pressRef.current?.started) pushLive(engine, now);
    return moving;
  }

  /** Moves the DOM box copies (hit areas and corner handles) to the engine's rectangles. */
  function placeCopies(engine: AreaEngine) {
    if (!engine.ready) return;
    engine.copies.forEach((copy, i) => {
      const node = copyRefs.current[i];
      if (!node) return;
      if (!copy.visible) {
        node.style.visibility = "hidden";
        return;
      }
      node.style.visibility = "visible";
      node.style.left = `${copy.x.toFixed(2)}px`;
      node.style.top = `${copy.y.toFixed(2)}px`;
      node.style.width = `${copy.width.toFixed(2)}px`;
      node.style.height = `${copy.height.toFixed(2)}px`;
    });
  }

  /** Hands the gesture's bounds (rounded to the step) and count to React, at most ten times a second. */
  function pushLive(engine: AreaEngine, now: number) {
    const throttle = liveThrottle.current;
    if (now - throttle.time < LIVE_INTERVAL) return;
    const bounds = engine.bounds();
    if (!bounds) return;
    const rounded = snapLive(bounds, stepDeg);
    const count = engine.insideCount;
    const key = `${boundsKey(rounded)}|${count}`;
    if (key === throttle.key) return;
    throttle.time = now;
    throttle.key = key;
    setLive({ bounds: rounded, count });
  }

  function applyTheme() {
    const colors = palette.current;
    if (!colors) return;
    engineRef.current.setInk(geoInk(colors));
    loop.kick();
  }

  useFormReset(rootRef, () => {
    pendingSpring.current = SNAP_SPRING;
    setValue(normalizeBounds(startValue));
    setDraft(null);
    setLive(null);
    setInvalid(false);
    setRevision((count) => count + 1);
  });

  React.useEffect(() => {
    engineRef.current.setKind(kind);
    loop.kick();
  }, [kind, engineRef, loop]);

  React.useEffect(() => {
    engineRef.current.setPoints(list);
    loop.kick();
  }, [list, engineRef, loop]);

  // Every committed value (or a refused one) springs the box there; the first one is placed directly.
  React.useEffect(() => {
    const spring = pendingSpring.current ?? SNAP_SPRING;
    pendingSpring.current = null;
    const instant = !placedRef.current || prefersReducedMotion();
    placedRef.current = true;
    engineRef.current.setTarget(committed, spring, instant);
    loop.kick();
  }, [committed, revision, engineRef, loop]);

  // `required` blocks submission through a hidden input that is invalid while no area is selected.
  const hasValue = committed !== null;
  React.useEffect(() => {
    validityRef.current?.setCustomValidity(required && !hasValue ? REQUIRED_MESSAGE : "");
  }, [required, hasValue]);

  // A touch draw starts after a hold; from then on the page must not scroll under the finger.
  React.useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const block = (event: TouchEvent) => {
      const press = pressRef.current;
      if (press && press.kind === "draw" && press.armed && event.cancelable) event.preventDefault();
    };
    stage.addEventListener("touchmove", block, { passive: false });
    return () => stage.removeEventListener("touchmove", block);
  }, []);

  /* Committing */

  /** Sets a new value from the latest one and springs the box there with `spring`. */
  function update(next: (current: GeoBounds | null) => GeoBounds | null, spring: SpringConfig) {
    if (disabled) return;
    pendingSpring.current = spring;
    setValue((previous) => {
      const current = normalizeBounds(previous);
      const result = normalizeBounds(next(current));
      return sameBounds(current, result) ? previous : result;
    });
    setRevision((count) => count + 1);
    loop.kick();
  }

  function clearArea() {
    update(() => null, CLEAR_SPRING);
  }

  function popHandles() {
    if (prefersReducedMotion()) return;
    for (const handle of handleRefs.current) {
      if (handle && typeof handle.animate === "function") handle.animate(POP_KEYFRAMES, POP_TIMING);
    }
  }

  /* Map: pointer */

  /** Pointer position in the map's own px (offsets ignore any CSS scale of the gallery card). */
  function stagePoint(clientX: number, clientY: number) {
    const stage = stageRef.current;
    return stage ? localPoint(stage, clientX, clientY) : null;
  }

  function setCursor(cursor: string) {
    const stage = stageRef.current;
    if (stage && stage.style.cursor !== cursor) stage.style.cursor = cursor;
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0 || pressRef.current) return;
    const engine = engineRef.current;
    const point = stagePoint(event.clientX, event.clientY);
    if (!engine.ready || !point) return;
    const hit = engine.hitTest(point.x, point.y);
    const touch = event.pointerType === "touch";
    const press: Press = {
      id: event.pointerId,
      x: point.x,
      y: point.y,
      kind: hit.kind === "none" ? "draw" : hit.kind,
      edges: hit.edges,
      start: engine.bounds(),
      anchorLon: engine.lonAt(point.x),
      anchorLat: engine.latAt(point.y),
      started: false,
      // a touch outside the box scrolls the page unless the finger rests first
      armed: hit.kind !== "none" || !touch,
      timer: 0,
    };
    if (!press.armed) {
      press.timer = window.setTimeout(() => {
        if (pressRef.current !== press) return;
        press.armed = true;
        engine.ping(point.x, point.y, clockNow());
        loop.kick();
      }, HOLD_MS);
    }
    pressRef.current = press;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const press = pressRef.current;
    const point = stagePoint(event.clientX, event.clientY);
    if (!point) return;
    if (!press) {
      if (event.pointerType === "mouse" && !disabled) {
        const hit = engineRef.current.hitTest(point.x, point.y);
        setCursor(cursorFor(hit.kind, hit.edges));
      }
      return;
    }
    if (press.id !== event.pointerId) return;
    const dx = point.x - press.x;
    const dy = point.y - press.y;
    if (!press.started) {
      if (Math.hypot(dx, dy) < SLOP) return;
      if (!press.armed) {
        // a swipe, not a draw: leave it to the page
        releasePress(event.currentTarget, press);
        return;
      }
      press.started = true;
      liveThrottle.current = { time: 0, key: "" };
      inputKey.current = "";
      engineRef.current.beginGesture();
      setGesture(press.kind);
      setCursor(cursorFor(press.kind, press.edges));
    }
    const bounds = gestureBounds(press, point.x, point.y);
    engineRef.current.follow(bounds);
    emitInput(bounds);
    loop.kick();
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const press = pressRef.current;
    if (!press || press.id !== event.pointerId) return;
    releasePress(event.currentTarget, press);
    if (!press.started) return;
    if (cancelled) cancelGesture();
    else commitGesture();
    const point = stagePoint(event.clientX, event.clientY);
    if (point && event.pointerType === "mouse") {
      const hit = engineRef.current.hitTest(point.x, point.y);
      setCursor(cursorFor(hit.kind, hit.edges));
    }
  }

  function releasePress(stage: HTMLElement, press: Press) {
    pressRef.current = null;
    window.clearTimeout(press.timer);
    if (stage.hasPointerCapture(press.id)) stage.releasePointerCapture(press.id);
  }

  /** The box the gesture describes, in unwrapped degrees: drawn from the anchor, moved, or resized at its edges. */
  function gestureBounds(press: Press, x: number, y: number): GeoBounds {
    const engine = engineRef.current;
    const start = press.start;
    if (press.kind === "draw" || !start) {
      const lon = engine.lonAt(x);
      const lat = engine.latAt(y);
      const west = Math.min(press.anchorLon, lon);
      return {
        west,
        east: Math.min(Math.max(press.anchorLon, lon), west + 360),
        south: Math.min(press.anchorLat, lat),
        north: Math.max(press.anchorLat, lat),
      };
    }
    const deltaLon = (x - press.x) / engine.pxPerDegree;
    if (press.kind === "move") {
      const height = start.north - start.south;
      const deltaLat = engine.latAt(y) - engine.latAt(press.y);
      const south = clamp(start.south + deltaLat, CROP_SOUTH, CROP_NORTH - height);
      return { west: start.west + deltaLon, east: start.east + deltaLon, south, north: south + height };
    }
    const minimum = Math.min(stepDeg, (CROP_NORTH - CROP_SOUTH) / 2);
    let { west, east, south, north } = start;
    const dy = y - press.y;
    if (press.edges & WEST) west = clamp(start.west + deltaLon, start.east - 360, start.east - minimum);
    if (press.edges & EAST) east = clamp(start.east + deltaLon, start.west + minimum, start.west + 360);
    if (press.edges & NORTH)
      north = clamp(engine.latAt(engine.yOf(start.north) + dy), start.south + minimum, CROP_NORTH);
    if (press.edges & SOUTH)
      south = clamp(engine.latAt(engine.yOf(start.south) + dy), CROP_SOUTH, start.north - minimum);
    return { west, east, south, north };
  }

  function emitInput(bounds: GeoBounds) {
    if (!onValueInput) return;
    const rounded = roundBounds(normalizeLive(bounds));
    const key = boundsKey(rounded);
    if (key === inputKey.current) return;
    inputKey.current = key;
    onValueInput(rounded);
  }

  /** Release: the edges spring to the nearest multiple of the step, and the snapped bounds are committed. */
  function commitGesture() {
    const engine = engineRef.current;
    const bounds = engine.bounds();
    engine.endGesture();
    setGesture(null);
    setLive(null);
    if (!bounds) return;
    const snapped = snapBounds(bounds, stepDeg);
    const next = normalizeBounds(snapped);
    engine.setTarget(snapped, SNAP_SPRING, prefersReducedMotion());
    popHandles();
    pendingSpring.current = SNAP_SPRING;
    if (next && !sameBounds(next, committed)) setValue(next);
    setRevision((count) => count + 1);
    loop.kick();
  }

  /** Escape or a cancelled pointer: the box springs back to the committed area (or collapses when there is none). */
  function cancelGesture() {
    const engine = engineRef.current;
    engine.endGesture();
    engine.setTarget(committed, SNAP_SPRING, prefersReducedMotion());
    setGesture(null);
    setLive(null);
    loop.kick();
  }

  function handleDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (disabled) return;
    const point = stagePoint(event.clientX, event.clientY);
    const engine = engineRef.current;
    if (!point || !engine.ready) return;
    const country = engine.countryUnder(point.x, point.y);
    const bounds = country ? countryBounds(country.code) : null;
    if (!country || !bounds) return;
    const fitted = fitBounds(bounds, stepDeg);
    if (!fitted) return;
    engine.ping(point.x, point.y, clockNow());
    update(() => fitted, FIT_SPRING);
    setChip((previous) => ({ key: (previous?.key ?? 0) + 1, name: country.name }));
  }

  /* Map: keyboard */

  function handleStageKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const press = pressRef.current;
    if (event.key === "Escape") {
      if (!press) return;
      event.preventDefault();
      releasePress(event.currentTarget, press);
      if (press.started) cancelGesture();
      return;
    }
    if (press || event.altKey || event.ctrlKey || event.metaKey) return;
    const amount = stepDeg * (event.shiftKey ? 10 : 1);
    const arrow = ARROWS[event.key];
    if (arrow) {
      if (!committed) return;
      event.preventDefault();
      update((current) => (current ? moveBounds(current, arrow[0] * amount, arrow[1] * amount) : null), SNAP_SPRING);
      return;
    }
    switch (event.key) {
      case "Delete":
      case "Backspace":
        if (!committed) return;
        event.preventDefault();
        clearArea();
        return;
      case "Enter":
      case " ":
        if (committed) return;
        event.preventDefault();
        update(() => seedBounds(stepDeg), SNAP_SPRING);
        return;
      default:
        return;
    }
  }

  /* Edge fields */

  /** Commits the typed text of a field. Invalid text shakes the field and reverts. Returns whether the text had changed. */
  function commitDraft(edge: Edge) {
    if (!draft || draft.edge !== edge) return false;
    const current = committed ? editText(edgeOf(committed, edge)) : "";
    const text = draft.text.trim();
    if (text === current) return false;
    const parsed = text === "" ? Number.NaN : Number(text.replace("−", "-").replace(",", "."));
    const next = Number.isFinite(parsed) ? applyEdge(committed, edge, snapEdge(parsed, stepDeg), stepDeg) : null;
    if (!next) {
      shake(fieldRefs.current[edge]);
      setDraft({ edge, text: current });
      return true;
    }
    update(() => next, SNAP_SPRING);
    setDraft({ edge, text: editText(edgeOf(next, edge)) });
    return true;
  }

  function handleFieldKeyDown(edge: Edge, event: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    let delta: number;
    switch (event.key) {
      case "ArrowUp":
        delta = 1;
        break;
      case "ArrowDown":
        delta = -1;
        break;
      case "Enter":
        // Enter on unchanged text submits the form, like a native field
        if (commitDraft(edge)) event.preventDefault();
        return;
      case "Escape": {
        const text = committed ? editText(edgeOf(committed, edge)) : "";
        if (draft && draft.edge === edge && draft.text !== text) {
          event.preventDefault();
          setDraft({ edge, text });
        }
        return;
      }
      default:
        return;
    }
    event.preventDefault();
    const next = nudgeEdge(
      committed ?? seedBounds(stepDeg),
      edge,
      delta * stepDeg * (event.shiftKey ? 10 : 1),
      stepDeg,
    );
    if (!next) return;
    update(() => next, SNAP_SPRING);
    setDraft({ edge, text: editText(edgeOf(next, edge)) });
  }

  function renderField(edge: Edge) {
    const inputId = `${baseId}-${edge}`;
    const committedText = committed ? editText(edgeOf(committed, edge)) : "";
    const text = draft !== null && draft.edge === edge ? draft.text : committedText;
    const shownValue = shown ? edgeOf(shown, edge) : null;
    const latitude = edge === "south" || edge === "north";
    return (
      <div key={edge} className="grid gap-1">
        <label htmlFor={inputId} className="text-[11.5px] leading-4 text-muted-foreground">
          {EDGE_LABELS[edge]}
        </label>
        <div
          ref={(node) => {
            fieldRefs.current[edge] = node;
          }}
          className="relative h-8 w-[84px]"
        >
          <input
            id={inputId}
            type="number"
            inputMode="decimal"
            step="any"
            min={latitude ? CROP_SOUTH : -180}
            max={latitude ? CROP_NORTH : 180}
            autoComplete="off"
            disabled={disabled}
            value={text}
            onFocus={(event) => {
              setDraft({ edge, text: committedText });
              event.currentTarget.select();
            }}
            onChange={(event) => setDraft({ edge, text: event.target.value })}
            onBlur={() => {
              commitDraft(edge);
              setDraft(null);
            }}
            onKeyDown={(event) => handleFieldKeyDown(edge, event)}
            className="peer block size-full [appearance:textfield] rounded-md border border-border bg-card px-2 text-right font-mono text-[12.5px] text-transparent tabular-nums caret-foreground transition-[border-color,box-shadow] duration-150 outline-none focus:border-[color-mix(in_srgb,var(--lumesec)_65%,var(--border))] focus:text-foreground focus:ring-[3px] focus:ring-lumesec/14 disabled:cursor-not-allowed motion-reduce:transition-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-2 flex items-center font-mono text-[12.5px] leading-4 text-foreground tabular-nums peer-focus:invisible"
          >
            {shownValue === null ? (
              <span className="text-muted-foreground">–</span>
            ) : (
              <RollingNumber value={shownValue} text={`${displayText(shownValue)}°`} />
            )}
          </span>
        </div>
      </div>
    );
  }

  const areaLabel = committed ? `${label} ${formatArea(committed)}` : `${label}, none selected`;
  const announcement = !committed
    ? "No area selected"
    : total > 0
      ? `${formatNumber(committedCount)} ${committedCount === 1 ? "point" : "points"} in the area`
      : formatArea(committed);

  return (
    <div
      ref={rootRef}
      data-slot="geo-area"
      data-disabled={disabled ? "" : undefined}
      className={cn(
        "@container grid w-full max-w-[660px] gap-2.5 text-foreground [-webkit-tap-highlight-color:transparent] data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <div
        ref={cardRef}
        data-invalid={showInvalid ? "" : undefined}
        className="relative rounded-xl border border-border bg-card p-1.5 shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)] transition-colors duration-150 data-[invalid]:border-destructive motion-reduce:transition-none"
      >
        <div
          ref={stageRef}
          role="group"
          aria-roledescription="area selector"
          aria-label={areaLabel}
          aria-describedby={helpId}
          aria-disabled={disabled || undefined}
          tabIndex={disabled ? -1 : 0}
          data-gesture={gesture ?? undefined}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => handlePointerUp(event, false)}
          onPointerCancel={(event) => handlePointerUp(event, true)}
          onDoubleClick={handleDoubleClick}
          onContextMenu={(event) => {
            if (pressRef.current) event.preventDefault();
          }}
          onKeyDown={handleStageKeyDown}
          className="relative w-full cursor-crosshair touch-pan-y overflow-hidden rounded-lg outline-none select-none [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid"
          style={{ aspectRatio: projectionAspect(kind, CROP) }}
        >
          <canvas ref={baseRef} aria-hidden="true" className="pointer-events-none absolute inset-0 block size-full" />
          <canvas
            ref={overlayRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-[1] block size-full"
          />
          {initialCopies.map((style, copy) => (
            <div
              key={copy}
              ref={(node) => {
                copyRefs.current[copy] = node;
              }}
              aria-hidden="true"
              className="pointer-events-none absolute z-[2]"
              style={style}
            >
              <div className="pointer-events-auto absolute -inset-1.5 touch-none" />
              {CORNERS.map((corner, i) => (
                <span
                  key={corner.id}
                  ref={(node) => {
                    handleRefs.current[copy * CORNERS.length + i] = node;
                  }}
                  className={cn(
                    "pointer-events-auto absolute -mt-1.5 -ml-1.5 block size-3 touch-none rounded-[2px] border border-lumesec bg-card shadow-[0_1px_2px_rgb(0_0_0/0.2)]",
                    corner.className,
                  )}
                />
              ))}
            </div>
          ))}
          {!committed && gesture === null ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-2 z-[3] flex justify-center px-2"
            >
              <span className="rounded-md border border-border bg-card/90 px-2 py-1 text-[12px] leading-4 text-muted-foreground shadow-[0_4px_12px_-8px_rgb(0_0_0/0.5)]">
                <span className="pointer-coarse:hidden">Drag across the map to draw an area</span>
                <span className="hidden pointer-coarse:inline">Press and hold, then drag to draw an area</span>
              </span>
            </div>
          ) : null}
          {chip ? <CountryChip key={chip.key} name={chip.name} onDone={() => setChip(null)} /> : null}
        </div>

        <input
          ref={validityRef}
          tabIndex={-1}
          aria-hidden="true"
          required={required}
          disabled={disabled}
          value={committed ? "set" : ""}
          onChange={() => undefined}
          onInvalid={() => {
            setInvalid(true);
            shake(cardRef.current);
          }}
          className="pointer-events-none absolute bottom-0 left-1/2 size-px border-0 p-0 opacity-0"
        />
      </div>

      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 @min-[480px]:grid-cols-4">{EDGES.map(renderField)}</div>
        <div className="ml-auto flex h-8 items-center gap-1.5">
          {total > 0 ? (
            <span className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[12.5px] leading-4 whitespace-nowrap text-muted-foreground">
              <span aria-hidden="true" className="size-[5px] flex-none rounded-[1px] bg-lumesec" />
              <span className="font-mono text-foreground tabular-nums">
                {shown ? (
                  <RollingNumber value={shownCount} text={formatNumber(shownCount)} reserve={[formatNumber(total)]} />
                ) : (
                  "–"
                )}
              </span>
              <span>
                of <span className="font-mono tabular-nums">{formatNumber(total)}</span>{" "}
                {total === 1 ? "point" : "points"}
              </span>
            </span>
          ) : null}
          <button
            type="button"
            disabled={disabled || !committed}
            onClick={() => {
              clearArea();
              stageRef.current?.focus({ preventScroll: true });
            }}
            className="h-8 cursor-pointer rounded-md border-0 bg-transparent px-2.5 font-[inherit] text-[12.5px] font-medium text-muted-foreground transition-colors duration-150 outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-lumesec focus-visible:outline-solid disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground motion-reduce:transition-none"
          >
            Clear
          </button>
        </div>
      </div>

      <span id={helpId} className="sr-only">
        Arrow keys move the area by one step, Shift by ten steps. Delete clears it. Without an area, Enter adds one. The
        West, South, East and North fields set exact edges.
      </span>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {showInvalid ? REQUIRED_MESSAGE : announcement}
      </span>

      {name && committed ? <input type="hidden" name={name} value={formValue(committed)} disabled={disabled} /> : null}
    </div>
  );
}

/**
 * Bounds as one line of text with hemispheres: '12° W to 30° E, 35° N to 60° N'. Longitudes past 180 are shown
 * wrapped ('150° E to 160° W' for a box across the date line).
 */
export function formatArea(bounds: GeoBounds): string {
  const west = wrapLongitude(bounds.west);
  const east = shownEast(bounds.east);
  return `${degreeText(west, "lon")} to ${degreeText(east, "lon")}, ${degreeText(bounds.south, "lat")} to ${degreeText(bounds.north, "lat")}`;
}

/* Parts ----------------------------------------------------------------------------------------------- */

/** Mechanical figures: they roll up when the value grows and down when it shrinks. */
function RollingNumber({ value, text, reserve }: { value: number; text: string; reserve?: readonly string[] }) {
  const [shown, setShown] = React.useState({ text, value, direction: 1 });
  if (shown.text !== text) setShown({ text, value, direction: value < shown.value ? -1 : 1 });
  return <RollText text={text} direction={shown.direction} reserve={reserve} className="justify-items-end" />;
}

/** The name of the country the box was fitted to, over the map's top-left corner for 1.6 s. */
function CountryChip({ name, onDone }: { name: string; onDone: () => void }) {
  const node = React.useRef<HTMLDivElement>(null);
  const done = React.useRef(onDone);
  React.useEffect(() => {
    done.current = onDone;
  });
  React.useEffect(() => {
    const element = node.current;
    if (!element || prefersReducedMotion() || typeof element.animate !== "function") {
      const timer = window.setTimeout(() => done.current(), CHIP_MS);
      return () => window.clearTimeout(timer);
    }
    const animation = element.animate(CHIP_KEYFRAMES, { duration: CHIP_MS, fill: "forwards" });
    animation.onfinish = () => done.current();
    return () => {
      animation.onfinish = null;
      animation.cancel();
    };
  }, []);
  return (
    <div
      ref={node}
      aria-hidden="true"
      className="pointer-events-none absolute top-2 left-2 z-[4] flex items-center gap-1.5 rounded-md border border-border bg-card/90 px-2 py-1 text-[12px] leading-4 font-medium text-foreground shadow-[0_4px_12px_-8px_rgb(0_0_0/0.5)]"
    >
      <span className="size-[5px] flex-none rounded-[1px] bg-lumesec" />
      {name}
    </div>
  );
}

/* Types ----------------------------------------------------------------------------------------------- */

type Edge = "west" | "south" | "east" | "north";

type PressKind = "draw" | "move" | "resize";

interface SpringConfig {
  readonly stiffness: number;
  readonly damping: number;
}

interface LiveState {
  readonly bounds: GeoBounds;
  readonly count: number;
}

/** What a press at a point would do: draw a new box, move the box, or resize the `edges` of it (bit flags). */
interface Hit {
  readonly kind: "none" | "move" | "resize";
  readonly edges: number;
}

/** A press on the map. It starts a gesture once it moves `SLOP` px; a touch draw must be armed by a hold first. */
interface Press {
  readonly id: number;
  /** Press point in map px. */
  readonly x: number;
  readonly y: number;
  readonly kind: PressKind;
  readonly edges: number;
  /** The box at the press, in unwrapped degrees. */
  readonly start: GeoBounds | null;
  /** The point a drawn box grows from. */
  readonly anchorLon: number;
  readonly anchorLat: number;
  started: boolean;
  armed: boolean;
  timer: number;
}

/* Constants ------------------------------------------------------------------------------------------- */

/** Equirectangular or Mercator strip from 60° S to 80° N. Latitudes of the area are clamped to it. */
const CROP: readonly [number, number] = [-60, 80];
const CROP_SOUTH = CROP[0];
const CROP_NORTH = CROP[1];
/** Nominal width for the server-side placement of the box, in percentages. */
const NOMINAL_WIDTH = 1000;
const MAP_CANVAS = { maxDpr: 2 } as const;

const EDGES: readonly Edge[] = ["west", "south", "east", "north"];
const EDGE_LABELS: Record<Edge, string> = { west: "West", south: "South", east: "East", north: "North" };
const REQUIRED_MESSAGE = "Select an area on the map.";

/** Starts a selection over Europe in the demo. */
const DEMO_VALUE: GeoBounds = { west: -12, south: 35, east: 30, north: 60 };
/** Enter on an empty map adds this box (snapped to the step). */
const SEED_VALUE: GeoBounds = { west: -20, south: 5, east: 20, north: 35 };

const ARROWS: Partial<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};

/** Edge bit flags of a resize. */
const WEST = 1;
const EAST = 2;
const SOUTH = 4;
const NORTH = 8;

const CORNERS = [
  { id: "nw", className: "top-0 left-0 cursor-nwse-resize" },
  { id: "ne", className: "top-0 left-full cursor-nesw-resize" },
  { id: "se", className: "top-full left-full cursor-nwse-resize" },
  { id: "sw", className: "top-full left-0 cursor-nesw-resize" },
] as const;

/** Edges within this many px of the pointer resize; corners are where two edges meet. */
const EDGE_HIT = 6;
/** A press that moves less than this (px) does nothing. */
const SLOP = 3;
/** A touch outside the box draws only after resting this long; a quicker swipe scrolls the page. */
const HOLD_MS = 250;
/** The count and the edge fields follow a gesture at most this often (ms). */
const LIVE_INTERVAL = 100;
const CHIP_MS = 1600;

/** Release snap; a country fit uses a softer spring; Clear collapses the box into its centre in about 250 ms. */
const SNAP_SPRING: SpringConfig = { stiffness: 520, damping: 0.72 };
const FIT_SPRING: SpringConfig = { stiffness: 260, damping: 0.8 };
const CLEAR_SPRING: SpringConfig = { stiffness: 520, damping: 1 };

/** Lattice pitch and dot sizes in CSS px. */
const PITCH = 4;
const LAND_DOT = 1.6;
const FILL_DOT = 2;
const POINT_DOT = 2;
const POINT_INSIDE_DOT = 2.6;
const POINT_ALPHA = 0.55;
/** Land inside the box: the land grey mixed 60 % toward the accent, settling at this alpha. */
const FILL_MIX = 0.6;
const FILL_ALPHA = 0.8;
/** A faint accent wash over the box, so it reads over water too. */
const TINT_ALPHA = 0.05;

/** Entry: alpha ramps over 180 ms after a jitter of up to 70 ms; the first 90 ms flash toward the glint. */
const RAMP_MS = 180;
const FLASH_MS = 90;
const POINT_FLASH_MS = 120;
const JITTER_MS = 70;
/** Dots that leave fade over 140 ms: a moved box leaves a short wake. */
const FADE_MS = 140;
/** On first view the fill sweeps across the box from west to east. */
const REVEAL_LEAD_MS = 80;
const REVEAL_SWEEP_MS = 560;

/** The dotted border: 1.6 px dots every 4 px that march clockwise at 28 px/s while the box changes. */
const BORDER_DOT = 1.6;
const BORDER_SPACING = 4;
const BORDER_ALPHA = 0.9;
const MARCH_SPEED = 28;

/** A ring of lit dots where a touch draw is armed or a country is fitted. */
const PING_MS = 520;
const PING_RADIUS = 34;

const POP_KEYFRAMES: Keyframe[] = [
  { transform: "scale(1)" },
  { transform: "scale(1.45)", offset: 0.35 },
  { transform: "scale(1)" },
];
const POP_TIMING: KeyframeAnimationOptions = { duration: 340, easing: "cubic-bezier(.2,.8,.2,1)" };
const CHIP_KEYFRAMES: Keyframe[] = [
  { opacity: 0, transform: "translateY(-3px)" },
  { opacity: 1, transform: "translateY(0)", offset: 0.1 },
  { opacity: 1, transform: "translateY(0)", offset: 0.85 },
  { opacity: 0, transform: "translateY(0)" },
];

/* Helpers --------------------------------------------------------------------------------------------- */

let demoCache: readonly AreaPoint[] | null = null;

/** 2,400 seeded demo points scattered around the demo cities by weight; built once, on first use. */
function demoAreaPoints(): readonly AreaPoint[] {
  demoCache ??= demoPoints(2400, "geo-area");
  return demoCache;
}

function validStep(step: number) {
  return Number.isFinite(step) && step > 0 ? clamp(step, 0.01, 30) : 1;
}

/** Rounds away float noise, so snapped edges are clean multiples of the step. */
const clean = (value: number) => Math.round(value * 1e6) / 1e6;

const snapEdge = (value: number, step: number) => clean(Math.round(value / step) * step);

/** The offset of x into [0, 360). */
const wrapOffset = (x: number) => x - Math.floor(x / 360) * 360;

/**
 * A valid area in canonical form, or null: `west` in [−180, 180), `east` = west + width with a width in (0, 360]
 * (an `east` below `west` crosses the date line), latitudes ordered and clamped to the map.
 */
function normalizeBounds(value: GeoBounds | null | undefined): GeoBounds | null {
  if (!value) return null;
  const { west, south, east, north } = value;
  if (![west, south, east, north].every(Number.isFinite)) return null;
  let span = east - west;
  if (span === 0) return null;
  if (span < 0) span += 360;
  span = Math.min(span, 360);
  const low = clamp(Math.min(south, north), CROP_SOUTH, CROP_NORTH);
  const high = clamp(Math.max(south, north), CROP_SOUTH, CROP_NORTH);
  if (high - low <= 0) return null;
  const wrapped = wrapLongitude(west);
  return { west: clean(wrapped), south: clean(low), east: clean(wrapped + span), north: clean(high) };
}

/** Gesture bounds in canonical form; unlike normalizeBounds, a box of zero size stays as it is. */
function normalizeLive(bounds: GeoBounds): GeoBounds {
  const west = wrapLongitude(bounds.west);
  return {
    west,
    east: west + Math.max(0, bounds.east - bounds.west),
    south: Math.min(bounds.south, bounds.north),
    north: Math.max(bounds.south, bounds.north),
  };
}

const round2 = (value: number) => Math.round(value * 100) / 100 || 0;

function roundBounds(bounds: GeoBounds): GeoBounds {
  return {
    west: round2(bounds.west),
    south: round2(bounds.south),
    east: round2(bounds.east),
    north: round2(bounds.north),
  };
}

/** A gesture's bounds as the fields show them: each edge rounded to the step it will snap to. */
function snapLive(bounds: GeoBounds, step: number): GeoBounds {
  const live = normalizeLive(bounds);
  return {
    west: snapEdge(live.west, step),
    south: snapEdge(live.south, step),
    east: snapEdge(live.east, step),
    north: snapEdge(live.north, step),
  };
}

function sameBounds(a: GeoBounds | null, b: GeoBounds | null) {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.west - b.west) < 1e-6 &&
    Math.abs(a.south - b.south) < 1e-6 &&
    Math.abs(a.east - b.east) < 1e-6 &&
    Math.abs(a.north - b.north) < 1e-6
  );
}

const boundsKey = (bounds: GeoBounds) => `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`;

/**
 * Edges snapped to the nearest multiple of `step`, at least one step wide and tall, latitudes clamped to the map. The
 * longitudes stay unwrapped, so the springs run straight to them.
 */
function snapBounds(bounds: GeoBounds, step: number): GeoBounds {
  const west = snapEdge(bounds.west, step);
  let east = snapEdge(bounds.east, step);
  if (east - west < step) east = clean(west + step);
  if (east - west > 360) east = west + 360;
  return { west, east, ...latitudeSpan(snapEdge(bounds.south, step), snapEdge(bounds.north, step), step) };
}

/** A country's box snapped outward to the step, so the whole country stays inside. */
function fitBounds(country: GeoBounds, step: number): GeoBounds | null {
  const west = clean(Math.floor(country.west / step) * step);
  let east = clean(Math.ceil(country.east / step) * step);
  if (east - west < step) east = clean(west + step);
  const south = clean(Math.floor(country.south / step) * step);
  const north = clean(Math.ceil(country.north / step) * step);
  return normalizeBounds({ west, east, ...latitudeSpan(south, north, step) });
}

/** South and north clamped to the map and at least one step apart. */
function latitudeSpan(south: number, north: number, step: number) {
  let low = clamp(south, CROP_SOUTH, CROP_NORTH);
  let high = clamp(north, CROP_SOUTH, CROP_NORTH);
  if (high - low < step) {
    if (low + step <= CROP_NORTH) high = clean(low + step);
    else low = clean(high - step);
  }
  return { south: low, north: high };
}

function seedBounds(step: number): GeoBounds | null {
  return normalizeBounds(snapBounds(SEED_VALUE, step));
}

/** The box moved by whole degrees; it slides along the map's top and bottom instead of leaving it. */
function moveBounds(bounds: GeoBounds, deltaLon: number, deltaLat: number): GeoBounds | null {
  const height = bounds.north - bounds.south;
  const south = clamp(bounds.south + deltaLat, CROP_SOUTH, CROP_NORTH - height);
  return normalizeBounds({ west: bounds.west + deltaLon, east: bounds.east + deltaLon, south, north: south + height });
}

/**
 * One typed edge applied to the box (an empty selection starts from the seed box), or null when the result is not a
 * valid area. A typed longitude keeps the other edge; the box then spans eastward from west to east, across the date
 * line when east is smaller.
 */
function applyEdge(current: GeoBounds | null, edge: Edge, value: number, step: number): GeoBounds | null {
  const base = current ?? seedBounds(step);
  if (!base) return null;
  const minimum = step - 1e-9;
  let { west, south, east, north } = base;
  if (edge === "west" || edge === "east") {
    if (value < -180 || value > 180) return null;
    const span = edge === "west" ? wrapOffset(east - value) : wrapOffset(value - west);
    if (span < minimum) return null;
    if (edge === "west") {
      west = value;
      east = value + span;
    } else {
      east = west + span;
    }
  } else {
    if (value < -90 || value > 90) return null;
    const latitude = clamp(value, CROP_SOUTH, CROP_NORTH);
    if (edge === "south") south = latitude;
    else north = latitude;
    if (north - south < minimum) return null;
  }
  return normalizeBounds({ west, south, east, north });
}

/** One edge moved by `delta` degrees from the keyboard, stopping one step short of the opposite edge. */
function nudgeEdge(base: GeoBounds | null, edge: Edge, delta: number, step: number): GeoBounds | null {
  if (!base) return null;
  let { west, south, east, north } = base;
  switch (edge) {
    case "west":
      west = clamp(west + delta, east - 360, east - step);
      break;
    case "east":
      east = clamp(east + delta, west + step, west + 360);
      break;
    case "south":
      south = clamp(south + delta, CROP_SOUTH, north - step);
      break;
    case "north":
      north = clamp(north + delta, south + step, CROP_NORTH);
      break;
  }
  return normalizeBounds({ west, south, east, north });
}

/** East as the fields show it: wrapped, with the date line itself shown as 180 rather than −180. */
function shownEast(east: number) {
  const wrapped = wrapLongitude(east);
  return wrapped === -180 ? 180 : wrapped;
}

function edgeOf(bounds: GeoBounds, edge: Edge) {
  switch (edge) {
    case "west":
      return wrapLongitude(bounds.west);
    case "east":
      return shownEast(bounds.east);
    case "south":
      return bounds.south;
    case "north":
      return bounds.north;
  }
}

/** Field and form text: at most two decimals, an ASCII minus, never '-0'. */
const editText = (value: number) => String(round2(value));

/** Display text: as editText, with the true minus sign. */
const displayText = (value: number) => editText(value).replace("-", "−");

/** '12° W', '35° N', '0°', '180°'. */
function degreeText(value: number, axis: "lat" | "lon") {
  const rounded = round2(value);
  const magnitude = Math.abs(rounded);
  if (magnitude === 0) return "0°";
  if (axis === "lon" && magnitude === 180) return "180°";
  const hemisphere = axis === "lat" ? (rounded < 0 ? "S" : "N") : rounded < 0 ? "W" : "E";
  return `${magnitude}° ${hemisphere}`;
}

const formValue = (bounds: GeoBounds) =>
  [bounds.west, bounds.south, bounds.east, bounds.north].map((edge) => editText(edge)).join(",");

/** Whether a point lies in the box `west` .. `west + span`, south .. north; longitudes compare around the globe. */
function inBox(lat: number, lon: number, west: number, span: number, south: number, north: number) {
  return lat >= south && lat <= north && wrapOffset(lon - west) <= span;
}

function countInside(bounds: GeoBounds | null, points: readonly AreaPoint[]) {
  if (!bounds) return 0;
  const span = bounds.east - bounds.west;
  let count = 0;
  for (const point of points) {
    if (inBox(point.lat, point.lon, bounds.west, span, bounds.south, bounds.north)) count++;
  }
  return count;
}

function cursorFor(kind: Hit["kind"] | PressKind, edges: number) {
  if (kind === "move") return "move";
  if (kind !== "resize") return "crosshair";
  const horizontal = (edges & (WEST | EAST)) !== 0;
  const vertical = (edges & (SOUTH | NORTH)) !== 0;
  if (horizontal && vertical) return ((edges & WEST) !== 0) === ((edges & NORTH) !== 0) ? "nwse-resize" : "nesw-resize";
  return horizontal ? "ew-resize" : "ns-resize";
}

/** Server placement of the two box copies (the second one shows the part past the date line), in percentages. */
function copyStyles(bounds: GeoBounds | null, kind: AreaProjection): readonly React.CSSProperties[] {
  const hidden: React.CSSProperties = { left: 0, top: 0, width: 0, height: 0, visibility: "hidden" };
  if (!bounds) return [hidden, hidden];
  const height = NOMINAL_WIDTH / projectionAspect(kind, CROP);
  const projection = createProjection(kind, { width: NOMINAL_WIDTH, height, latRange: CROP });
  const point = createScreenPoint();
  projection.projectRelative(bounds.north, 0, point);
  const top = point.y / height;
  projection.projectRelative(bounds.south, 0, point);
  const bottom = point.y / height;
  const left = (bounds.west + 180) / 360;
  const width = (bounds.east - bounds.west) / 360;
  const style = (shift: number, visible: boolean): React.CSSProperties => ({
    left: percent(left + shift),
    top: percent(top),
    width: percent(width),
    height: percent(bottom - top),
    visibility: visible ? "visible" : "hidden",
  });
  return [style(0, true), style(-1, left + width > 1.0001)];
}

/* Map engine ------------------------------------------------------------------------------------------ */

/** A box copy in map px. */
interface CopyRect {
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Per dot (or point): whether it is inside, when it entered, when it left and the level it faded from. */
interface FillTrack {
  inside: Uint8Array;
  enter: Float64Array;
  leave: Float64Array;
  fade: Float32Array;
}

/** Out parameter of shadeFill: the entry ramp (or the fade-out level), the glint flash, and whether it still changes. */
interface Shade {
  level: number;
  flash: number;
  busy: boolean;
}

/** How newly entering dots appear this frame: at once, with the entry ramp and flash, or in the first-view sweep. */
const INSTANT = 0;
const LIVE = 1;
const REVEAL = 2;

/** An entry time far in the past: the dot is fully lit with no flash. */
const LONG_AGO = -1e9;

function createTrack(count: number): FillTrack {
  return {
    inside: new Uint8Array(count),
    enter: new Float64Array(count),
    leave: new Float64Array(count),
    fade: new Float32Array(count),
  };
}

/**
 * Updates one dot's entry state and writes how it looks now. A dot that enters keeps the time it entered (plus its
 * delay); its level ramps over RAMP_MS and it flashes for `flashMs`. A dot that leaves fades from the level it had
 * over FADE_MS. A negative delay lights it at once.
 */
function shadeFill(
  track: FillTrack,
  i: number,
  inside: boolean,
  now: number,
  delay: number,
  flashMs: number,
  reduced: boolean,
  out: Shade,
) {
  out.level = 0;
  out.flash = 0;
  out.busy = false;
  if (inside) {
    if (!track.inside[i]) {
      track.inside[i] = 1;
      track.enter[i] = delay < 0 ? LONG_AGO : now + delay;
      track.fade[i] = 0;
    }
    const t = now - track.enter[i];
    if (t <= 0) {
      out.busy = true;
      return;
    }
    out.level = Math.min(1, t / RAMP_MS);
    out.flash = reduced ? 0 : Math.max(0, 1 - t / flashMs);
    out.busy = t < Math.max(RAMP_MS, flashMs);
    return;
  }
  if (track.inside[i]) {
    track.inside[i] = 0;
    track.fade[i] = reduced ? 0 : clamp((now - track.enter[i]) / RAMP_MS, 0, 1);
    track.leave[i] = now;
  }
  if (track.fade[i] > 0) {
    const k = (now - track.leave[i]) / FADE_MS;
    if (k >= 1) {
      track.fade[i] = 0;
      return;
    }
    out.level = track.fade[i] * (1 - k);
    out.busy = true;
  }
}

/** A dotted rectangle, dots placed by distance clockwise from the top-left corner plus `offset`. */
function drawDottedRect(context: CanvasRenderingContext2D, rect: CopyRect, offset: number) {
  const { x: x0, y: y0, width, height } = rect;
  const perimeter = 2 * (width + height);
  if (perimeter < BORDER_SPACING) return;
  const half = BORDER_DOT / 2;
  for (let s = offset; s < perimeter; s += BORDER_SPACING) {
    let x: number;
    let y: number;
    if (s < width) {
      x = x0 + s;
      y = y0;
    } else if (s < width + height) {
      x = x0 + width;
      y = y0 + s - width;
    } else if (s < 2 * width + height) {
      x = x0 + width - (s - width - height);
      y = y0 + height;
    } else {
      x = x0;
      y = y0 + height - (s - 2 * width - height);
    }
    context.fillRect(x - half, y - half, BORDER_DOT, BORDER_DOT);
  }
}

/**
 * Everything the map draws, outside React. The four edges are springs in degrees (longitudes unwrapped, so a box can
 * run across the date line and keep going). The base canvas holds the land lattice and the points, baked when the
 * size, theme or data change. The overlay is redrawn while anything moves: the accent wash, the lit land inside the
 * box, the points inside, the dotted border and the ping. The box is drawn twice, the second copy shifted one map
 * width to the left, so a box past the right edge continues on the left.
 */
class AreaEngine {
  /** Points inside the box drawn in the last frame. */
  insideCount = 0;
  /** The two box copies in map px, updated every frame. */
  readonly copies: readonly [CopyRect, CopyRect] = [
    { visible: false, x: 0, y: 0, width: 0, height: 0 },
    { visible: false, x: 0, y: 0, width: 0, height: 0 },
  ];

  private ink: GeoInk | null = null;
  private fillBatch: DotBatch | null = null;
  private pointBatch: DotBatch | null = null;
  private borderStyle = "";
  private tintStyle = "";
  private kind: AreaProjection = "equirectangular";
  private width = 0;
  private height = 0;
  private projection: MapProjection | null = null;
  private lattice: DotLattice | null = null;
  private membership: Int16Array | null = null;
  private dots: FillTrack = createTrack(0);

  private pointLat = new Float32Array(0);
  private pointLon = new Float32Array(0);
  private pointX = new Float32Array(0);
  private pointY = new Float32Array(0);
  private pointJitter = new Float32Array(0);
  private pointTrack: FillTrack = createTrack(0);
  private pointSource: readonly AreaPoint[] | null = null;

  private readonly west: Spring = { position: 0, velocity: 0 };
  private readonly east: Spring = { position: 0, velocity: 0 };
  private readonly south: Spring = { position: 0, velocity: 0 };
  private readonly north: Spring = { position: 0, velocity: 0 };
  private readonly target = { west: 0, east: 0, south: 0, north: 0 };
  private config: SpringConfig = SNAP_SPRING;
  private present = false;
  private clearing = false;
  private gesture = false;
  private march = 0;
  private firstDraw = true;
  private instantNext = false;
  private pingState: { x: number; y: number; start: number } | null = null;
  private baseDirty = true;
  private readonly shade: Shade = { level: 0, flash: 0, busy: false };
  private readonly scratch = createScreenPoint();

  /** Whether the map has been laid out. */
  get ready() {
    return this.projection !== null && this.width > 0;
  }

  /** Map px per degree of longitude. */
  get pxPerDegree() {
    return Math.max(1e-6, this.mapWidth / 360);
  }

  private get mapWidth() {
    const frame = this.projection?.frame;
    return frame ? frame.x1 - frame.x0 : this.width;
  }

  setInk(ink: GeoInk) {
    this.ink = ink;
    const fill = mixRgb(ink.land, ink.accent, FILL_MIX);
    if (this.fillBatch) this.fillBatch.setRamp([fill, ink.glint]);
    else this.fillBatch = createDotBatch(2048, [fill, ink.glint]);
    if (this.pointBatch) this.pointBatch.setRamp([ink.accent, ink.glint]);
    else this.pointBatch = createDotBatch(512, [ink.accent, ink.glint]);
    this.borderStyle = rgba(ink.accent);
    this.tintStyle = rgba(ink.accent, TINT_ALPHA);
    this.baseDirty = true;
  }

  setKind(kind: AreaProjection) {
    if (kind === this.kind) return;
    this.kind = kind;
    if (this.width > 0) this.layout(this.width, this.height, kind);
  }

  /** New map size or projection: the lattice is rebuilt and the dots inside the box light at once. */
  layout(width: number, height: number, kind: AreaProjection) {
    this.kind = kind;
    this.width = width;
    this.height = height;
    this.projection = createProjection(kind, { width, height, latRange: CROP });
    this.lattice = mapLattice(this.projection, { pitch: PITCH });
    this.membership = null;
    this.dots = createTrack(this.lattice.count);
    this.projectPoints();
    this.instantNext = true;
    this.baseDirty = true;
  }

  /** New data: the points are re-projected and drawn at once. An equal list (a new array with the same points) is ignored. */
  setPoints(points: readonly AreaPoint[]) {
    if (points === this.pointSource || this.samePoints(points)) {
      this.pointSource = points;
      return;
    }
    this.pointSource = points;
    const count = points.length;
    this.pointLat = new Float32Array(count);
    this.pointLon = new Float32Array(count);
    this.pointX = new Float32Array(count);
    this.pointY = new Float32Array(count);
    this.pointJitter = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const point = points[i];
      const valid = Number.isFinite(point.lat) && Number.isFinite(point.lon);
      this.pointLat[i] = valid ? point.lat : Number.NaN;
      this.pointLon[i] = valid ? wrapLongitude(point.lon) : Number.NaN;
      this.pointJitter[i] = hash(i * 31 + 7);
    }
    this.pointTrack = createTrack(count);
    this.projectPoints();
    this.instantNext = true;
    this.baseDirty = true;
  }

  /** Longitude under map px x, unwrapped: left of the map is below −180, right of it above 180. */
  lonAt(x: number) {
    const frame = this.projection?.frame;
    if (!frame) return 0;
    return ((x - frame.x0) / this.mapWidth) * 360 - 180;
  }

  /** Latitude under map px y, clamped to the map. */
  latAt(y: number) {
    const projection = this.projection;
    if (!projection) return 0;
    const frame = projection.frame;
    const point = projection.invert((frame.x0 + frame.x1) / 2, clamp(y, frame.y0, frame.y1));
    if (point) return clamp(point.lat, CROP_SOUTH, CROP_NORTH);
    return y < (frame.y0 + frame.y1) / 2 ? CROP_NORTH : CROP_SOUTH;
  }

  /** Map px y of a latitude. */
  yOf(lat: number) {
    if (!this.projection) return 0;
    this.projection.projectRelative(clamp(lat, CROP_SOUTH, CROP_NORTH), 0, this.scratch);
    return this.scratch.y;
  }

  /** The box drawn now, in unwrapped degrees, or null when there is none (or it is collapsing). */
  bounds(): GeoBounds | null {
    if (!this.present || this.clearing) return null;
    return {
      west: this.west.position,
      south: this.south.position,
      east: this.east.position,
      north: this.north.position,
    };
  }

  beginGesture() {
    this.gesture = true;
  }

  /** The pointer drives the box directly while a gesture runs. */
  follow(bounds: GeoBounds) {
    this.present = true;
    this.clearing = false;
    this.target.west = bounds.west;
    this.target.east = bounds.east;
    this.target.south = bounds.south;
    this.target.north = bounds.north;
    this.jump();
  }

  endGesture() {
    this.gesture = false;
  }

  /**
   * Springs the box to an area (null collapses it into its centre). Longitudes are taken the short way from where the
   * box is now, so a move across the date line keeps going. A new box grows out of its centre. `instant` jumps.
   */
  setTarget(bounds: GeoBounds | null, config: SpringConfig, instant: boolean) {
    if (this.gesture) return;
    if (!bounds) {
      if (!this.present) return;
      if (!this.clearing) {
        const lon = (this.west.position + this.east.position) / 2;
        const lat = (this.south.position + this.north.position) / 2;
        this.target.west = lon;
        this.target.east = lon;
        this.target.south = lat;
        this.target.north = lat;
        this.clearing = true;
        this.config = config;
      }
      if (instant) {
        this.jump();
        this.present = false;
        this.clearing = false;
      }
      return;
    }
    const current = this.present && !this.clearing ? normalizeLive(this.target) : null;
    if (current && sameBounds(current, bounds)) {
      if (instant) this.jump();
      return;
    }
    let west = bounds.west;
    let east = bounds.east;
    if (this.present) {
      const shift = Math.round((this.west.position - west) / 360) * 360;
      west += shift;
      east += shift;
    } else {
      const lon = (west + east) / 2;
      const lat = (bounds.south + bounds.north) / 2;
      this.place(this.west, lon);
      this.place(this.east, lon);
      this.place(this.south, lat);
      this.place(this.north, lat);
      this.present = true;
    }
    this.clearing = false;
    this.target.west = west;
    this.target.east = east;
    this.target.south = bounds.south;
    this.target.north = bounds.north;
    this.config = config;
    if (instant) this.jump();
  }

  /** A ring of lit dots around map px (x, y). */
  ping(x: number, y: number, now: number) {
    this.pingState = { x, y, start: now };
  }

  /** The country under map px (x, y), or at the nearest land dot within a pitch and a half. */
  countryUnder(x: number, y: number): Country | undefined {
    const projection = this.projection;
    const lattice = this.lattice;
    if (!projection || !lattice) return undefined;
    const point = projection.invert(x, y);
    if (!point) return undefined;
    const direct = countryAt(point.lat, point.lon);
    if (direct) return direct;
    const index = lattice.grid.nearest(x, y, PITCH * 1.5);
    if (index < 0) return undefined;
    this.membership ??= countryMembership(lattice);
    const country = this.membership[index];
    return country >= 0 ? COUNTRIES[country] : undefined;
  }

  /** What a press at map px (x, y) would do. */
  hitTest(x: number, y: number): Hit {
    this.updateCopies();
    if (!this.present || this.clearing) return NO_HIT;
    for (const copy of this.copies) {
      if (!copy.visible) continue;
      const x0 = copy.x;
      const y0 = copy.y;
      const x1 = copy.x + copy.width;
      const y1 = copy.y + copy.height;
      if (x < x0 - EDGE_HIT || x > x1 + EDGE_HIT || y < y0 - EDGE_HIT || y > y1 + EDGE_HIT) continue;
      // inside a small box the edge zones shrink, so its middle still moves it
      const innerX = Math.min(EDGE_HIT, copy.width / 4);
      const innerY = Math.min(EDGE_HIT, copy.height / 4);
      let edges = 0;
      if (x <= x0 + innerX) edges |= WEST;
      else if (x >= x1 - innerX) edges |= EAST;
      if (y <= y0 + innerY) edges |= NORTH;
      else if (y >= y1 - innerY) edges |= SOUTH;
      return edges ? { kind: "resize", edges } : { kind: "move", edges: 0 };
    }
    return NO_HIT;
  }

  /** One frame. Returns whether to keep going. */
  step(base: CanvasSurface | null, overlay: CanvasSurface | null, delta: number, now: number, reduced: boolean) {
    if (!this.projection || !this.lattice || !this.ink || !base || !overlay) {
      this.updateCopies();
      return false;
    }
    const moving = this.stepSprings(delta, reduced);
    this.updateCopies();
    if (this.baseDirty) {
      this.drawBase(base);
      this.baseDirty = false;
    }
    const changing = this.gesture || moving;
    if (changing && !reduced) this.march = (this.march + delta * MARCH_SPEED) % BORDER_SPACING;
    const busy = this.drawOverlay(overlay, now, reduced);
    return moving || busy || this.gesture;
  }

  /* internals */

  private place(spring: Spring, position: number) {
    spring.position = position;
    spring.velocity = 0;
  }

  private jump() {
    this.place(this.west, this.target.west);
    this.place(this.east, this.target.east);
    this.place(this.south, this.target.south);
    this.place(this.north, this.target.north);
  }

  /** Advances the edge springs. Returns whether they move. */
  private stepSprings(delta: number, reduced: boolean) {
    if (this.gesture || !this.present) return false;
    const { stiffness, damping } = this.config;
    if (!reduced) {
      springStep(this.west, this.target.west, delta, stiffness, damping);
      springStep(this.east, this.target.east, delta, stiffness, damping);
      springStep(this.south, this.target.south, delta, stiffness, damping);
      springStep(this.north, this.target.north, delta, stiffness, damping);
    }
    // a collapsing box ends once it is a fraction of a degree across
    const tolerance = this.clearing ? 0.4 : 0.005;
    const resting =
      reduced ||
      (atRest(this.west, this.target.west, tolerance) &&
        atRest(this.east, this.target.east, tolerance) &&
        atRest(this.south, this.target.south, tolerance) &&
        atRest(this.north, this.target.north, tolerance));
    if (!resting) return true;
    this.jump();
    if (this.clearing) {
      this.present = false;
      this.clearing = false;
    } else {
      // keep the unwrapped longitudes near the map; the copies make the shift invisible
      const shift = wrapLongitude(this.target.west) - this.target.west;
      if (shift !== 0) {
        this.target.west += shift;
        this.target.east += shift;
        this.jump();
      }
    }
    return false;
  }

  private updateCopies() {
    const [main, wrapped] = this.copies;
    const frame = this.projection?.frame;
    if (!frame || !this.present) {
      main.visible = false;
      wrapped.visible = false;
      return;
    }
    const west = this.west.position;
    const span = Math.max(0, this.east.position - west);
    const x = frame.x0 + ((wrapLongitude(west) + 180) / 360) * this.mapWidth;
    const top = this.yOf(Math.max(this.north.position, this.south.position));
    const bottom = this.yOf(Math.min(this.north.position, this.south.position));
    main.visible = true;
    main.x = x;
    main.y = top;
    main.width = span * this.pxPerDegree;
    main.height = Math.max(0, bottom - top);
    wrapped.visible = x + main.width > frame.x1 + 0.5;
    wrapped.x = x - this.mapWidth;
    wrapped.y = main.y;
    wrapped.width = main.width;
    wrapped.height = main.height;
  }

  private samePoints(points: readonly AreaPoint[]) {
    if (!this.pointSource || points.length !== this.pointLat.length) return false;
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      const valid = Number.isFinite(point.lat) && Number.isFinite(point.lon);
      const storedValid = !Number.isNaN(this.pointLat[i]);
      if (valid !== storedValid) return false;
      if (!valid) continue;
      // stored as float32, so compare at that precision
      if (Math.fround(point.lat) !== this.pointLat[i] || Math.fround(wrapLongitude(point.lon)) !== this.pointLon[i])
        return false;
    }
    return true;
  }

  private projectPoints() {
    const projection = this.projection;
    if (!projection) return;
    const frame = projection.frame;
    for (let i = 0; i < this.pointLat.length; i++) {
      const lat = this.pointLat[i];
      if (!(lat >= CROP_SOUTH && lat <= CROP_NORTH)) {
        this.pointX[i] = Number.NaN;
        continue;
      }
      this.pointX[i] = frame.x0 + ((this.pointLon[i] + 180) / 360) * this.mapWidth;
      this.pointY[i] = this.yOf(lat);
    }
  }

  private drawBase(surface: CanvasSurface) {
    const lattice = this.lattice;
    const ink = this.ink;
    if (!lattice || !ink) return;
    const { context, width, height } = surface;
    context.clearRect(0, 0, width, height);
    bakeLattice(context, lattice, ink.land, LAND_DOT);
    context.fillStyle = rgba(ink.landStrong);
    context.globalAlpha = POINT_ALPHA;
    const half = POINT_DOT / 2;
    for (let i = 0; i < this.pointX.length; i++) {
      const x = this.pointX[i];
      if (Number.isNaN(x)) continue;
      context.fillRect(x - half, this.pointY[i] - half, POINT_DOT, POINT_DOT);
    }
    context.globalAlpha = 1;
  }

  /** Draws the box and its fill. Returns whether any dot is still entering, fading or pinging. */
  private drawOverlay(surface: CanvasSurface, now: number, reduced: boolean) {
    const lattice = this.lattice;
    const fill = this.fillBatch;
    const pointBatch = this.pointBatch;
    if (!lattice || !fill || !pointBatch) return false;
    const { context, width, height } = surface;
    context.clearRect(0, 0, width, height);

    const mode = this.firstDraw ? (reduced ? INSTANT : REVEAL) : this.instantNext || reduced ? INSTANT : LIVE;
    this.firstDraw = false;
    this.instantNext = false;

    const present = this.present;
    const west = this.west.position;
    const span = Math.max(0, this.east.position - west);
    const south = Math.min(this.south.position, this.north.position);
    const north = Math.max(this.south.position, this.north.position);
    const shade = this.shade;
    let busy = false;

    if (present) {
      context.fillStyle = this.tintStyle;
      for (const copy of this.copies) if (copy.visible) context.fillRect(copy.x, copy.y, copy.width, copy.height);
    }

    // land inside the box: each dot keeps the time it entered, so the fill follows the pointer with an uneven front
    for (let i = 0; i < lattice.count; i++) {
      const lat = lattice.lat[i];
      const lon = lattice.lon[i];
      const inside = present && inBox(lat, lon, west, span, south, north);
      const delay =
        mode === INSTANT
          ? -1
          : lattice.jitter[i] * JITTER_MS +
            (mode === REVEAL && span > 0 ? REVEAL_LEAD_MS + (wrapOffset(lon - west) / span) * REVEAL_SWEEP_MS : 0);
      shadeFill(this.dots, i, inside, now, delay, FLASH_MS, reduced, shade);
      if (shade.busy) busy = true;
      if (shade.level <= 0 && shade.flash <= 0) continue;
      fill.add(
        lattice.x[i],
        lattice.y[i],
        FILL_DOT + shade.flash * 0.8,
        shade.flash,
        Math.min(1, shade.level * FILL_ALPHA + shade.flash * 0.5),
      );
    }

    const ping = this.pingState;
    if (ping) {
      const k = (now - ping.start) / PING_MS;
      if (k >= 1 || reduced) {
        this.pingState = null;
      } else {
        busy = true;
        const radius = PING_RADIUS * easeOutCubic(k);
        lattice.grid.query(ping.x, ping.y, PING_RADIUS + 8, (index, distanceSquared) => {
          const strength = ringFront(Math.sqrt(distanceSquared), radius, 5, lattice.jitter[index]) * (1 - k);
          fill.add(lattice.x[index], lattice.y[index], FILL_DOT, 1, strength * 0.9);
        });
      }
    }
    fill.flush(context);

    // points inside: larger, in the accent, with a glint on entry
    let insideCount = 0;
    for (let i = 0; i < this.pointX.length; i++) {
      const x = this.pointX[i];
      if (Number.isNaN(x)) continue;
      const lon = this.pointLon[i];
      const inside = present && inBox(this.pointLat[i], lon, west, span, south, north);
      if (inside) insideCount++;
      const delay =
        mode === INSTANT
          ? -1
          : this.pointJitter[i] * JITTER_MS +
            (mode === REVEAL && span > 0 ? REVEAL_LEAD_MS + (wrapOffset(lon - west) / span) * REVEAL_SWEEP_MS : 0);
      shadeFill(this.pointTrack, i, inside, now, delay, POINT_FLASH_MS, reduced, shade);
      if (shade.busy) busy = true;
      if (shade.level <= 0 && shade.flash <= 0) continue;
      pointBatch.add(
        x,
        this.pointY[i],
        POINT_INSIDE_DOT + shade.flash * 1.2,
        shade.flash,
        Math.min(1, shade.level + shade.flash * 0.5),
      );
    }
    pointBatch.flush(context);
    this.insideCount = present && !this.clearing ? insideCount : 0;

    if (present) {
      context.fillStyle = this.borderStyle;
      context.globalAlpha = BORDER_ALPHA;
      for (const copy of this.copies) if (copy.visible) drawDottedRect(context, copy, this.march);
      context.globalAlpha = 1;
    }
    return busy;
  }
}

const NO_HIT: Hit = { kind: "none", edges: 0 };

/** Whether a spring has come to rest within `tolerance` degrees of its target. */
function atRest(spring: Spring, target: number, tolerance: number) {
  return Math.abs(spring.position - target) < tolerance && Math.abs(spring.velocity) < tolerance * 2;
}

/** The current time in ms, for the animation loop and event handlers (never read during render). */
function clockNow() {
  return performance.now();
}
