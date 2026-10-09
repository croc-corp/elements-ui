"use client";

import * as React from "react";

import { localPoint, useCanvas } from "@/lib/lumesec/canvas";
import { THEME_TOKENS, usePalette, type ColorToken, type Palette } from "@/lib/lumesec/color";
import {
  ARROW_DIRECTIONS,
  createDotBatch,
  cubicBezier,
  DEG,
  destinationPoint,
  distanceKm,
  EARTH_RADIUS_KM,
  FIBER_KM_PER_MS,
  fiberRttMs,
  ringFront,
  spatialNavigate,
  sphereLattice,
  wrapLongitude,
  type DotBatch,
  type LatLon,
  type SphereLattice,
} from "@/lib/lumesec/geo";
import { findCity, formatDistance, formatLatLon, formatMs } from "@/lib/lumesec/geo-data";
import { clamp, easeOutCubic, hash, mixRgb, smoothstep, stringHash, TAU, type RGB } from "@/lib/lumesec/math";
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

/** A place on the map. */
export interface AzimuthalPlace {
  /** Stable id: the value `center` and `onCenterChange` use, and the React key. */
  readonly id: string;
  /** Name shown on the map and in the list. */
  readonly label: string;
  /** Latitude in degrees. */
  readonly lat: number;
  /** Longitude in degrees. */
  readonly lon: number;
}

/** What the rings and the list measure: great-circle distance, or the round trip in fibre. */
export type AzimuthalRings = "distance" | "latency";

/** Distance unit of the rings and the list. */
export type AzimuthalUnit = "km" | "mi";

/** Props of GeoAzimuthal. The root is a `div` at most 660 px wide; pass a `max-w-*` class to change that. */
export interface GeoAzimuthalProps extends Omit<React.ComponentProps<"div">, "children"> {
  /**
   * The centre (controlled): a place id, or any `{ lat, lon }` point. A point at a place's exact coordinates centres
   * on that place; any other point shows as an unlabelled crosshair. Use with `onCenterChange`.
   */
  center?: string | LatLon;
  /** The centre when uncontrolled: a place id or a point. An id that is not in `places` falls back to the first place. */
  defaultCenter?: string | LatLon;
  /**
   * Called when the user picks a new centre: a place id when they pick a place, a `{ lat, lon }` point when they click
   * the map away from the places.
   */
  onCenterChange?: (center: string | LatLon) => void;
  /**
   * The places to measure: `{ id, label, lat, lon }`. Without it the map shows 15 demo cities. An empty array shows the
   * land and the rings with `emptyText` in the list.
   */
  places?: readonly AzimuthalPlace[];
  /** What the rings and the list measure (controlled). Use with `onRingsChange`. */
  rings?: AzimuthalRings;
  /** What the rings and the list measure when uncontrolled. */
  defaultRings?: AzimuthalRings;
  /** Called when the user switches between distance and latency. */
  onRingsChange?: (rings: AzimuthalRings) => void;
  /** Spacing of the rings in the unit shown: km or mi for distance, ms for latency. Default 2,000 km, 1,000 mi or 50 ms. */
  ringStep?: number;
  /** Distance unit. */
  unit?: AzimuthalUnit;
  /** How much longer the fibre path is than the great circle, used to turn distance into a round trip. */
  stretch?: number;
  /** Accessible name of the map. */
  label?: string;
  /** Text shown in the list when `places` is an empty array. */
  emptyText?: string;
}

/**
 * A round map that puts one place at the centre and every other place at its true distance and direction from it
 * (azimuthal equidistant). Dotted rings mark distance or round-trip time, and the rim is the antipode. Picking another
 * place re-centres the map: every land dot travels to its new position, the ones nearest the new centre first, so the
 * map grows outward from it while the list re-sorts and its values roll. Pointing at a place draws its great-circle
 * route, a straight line on this map, and the ring of everything just as far away.
 *
 * @example
 * <GeoAzimuthal
 *   places={[
 *     { id: "fra", label: "Frankfurt", lat: 50.11, lon: 8.68 },
 *     { id: "iad", label: "Ashburn", lat: 39.04, lon: -77.49 },
 *     { id: "nrt", label: "Tokyo", lat: 35.68, lon: 139.65 },
 *   ]}
 *   defaultCenter="fra"
 *   defaultRings="latency"
 * />
 */
export function GeoAzimuthal({
  center,
  defaultCenter = "lhr",
  onCenterChange,
  places,
  rings,
  defaultRings = "distance",
  onRingsChange,
  ringStep,
  unit = "km",
  stretch = DEFAULT_STRETCH,
  label = "Distance from the centre",
  emptyText = "No places",
  className,
  ...props
}: GeoAzimuthalProps) {
  const [centerValue, setCenterValue] = useControllableState<string | LatLon>({
    value: center,
    defaultValue: defaultCenter,
    onChange: onCenterChange,
  });
  const [mode, setMode] = useControllableState<AzimuthalRings>({ value: rings, defaultValue: defaultRings, onChange: onRingsChange });
  const reducedMotion = useReducedMotion();
  const [size, setSize] = React.useState<number | null>(null);
  const [hovered, setHovered] = React.useState<string | null>(null);
  const [focused, setFocused] = React.useState<string | null>(null);
  /** The place that holds the roving tab stop. */
  const [active, setActive] = React.useState<string | null>(null);

  const items = cleanPlaces(places ?? DEMO_PLACES);
  const placesKey = items.map((place) => `${place.id}:${place.lat}:${place.lon}`).join("|");
  const resolved = resolveCenter(centerValue, items);
  const fibreStretch = Number.isFinite(stretch) && stretch > 0 ? stretch : DEFAULT_STRETCH;
  const spec = ringSpec(mode === "latency" ? "latency" : "distance", ringStep, unit === "mi" ? "mi" : "km", fibreStretch);

  // Pure layout: the server lays the map out at a nominal size; positions are fractions of the disc, so CSS places
  // them exactly at any size, and the measured size only refines label placement.
  const stageSize = size ?? NOMINAL_SIZE;
  const radius = (stageSize - 2 * GUTTER) / 2;
  const basis = basisOf(resolved.point);
  const projected: Projected = { u: 0, v: 0, angle: 0 };
  const placed: PlacedPlace[] = items.map((place) => {
    projectLatLon(basis, place.lat, place.lon, projected);
    const km = distanceKm(resolved.point, place);
    const isCenter = resolved.place?.id === place.id;
    const measure = measureOf(spec.mode, km, spec.unit, fibreStretch);
    return {
      place,
      u: projected.u,
      v: projected.v,
      x: stageSize / 2 + projected.u * radius,
      y: stageSize / 2 + projected.v * radius,
      km,
      isCenter,
      text: measure.text,
      value: measure.value,
      bucket: bucketOf(projected.angle, placeJitter(place.id)),
    };
  });
  const rows = placed.filter((entry) => !entry.isCenter).sort((a, b) => a.km - b.km || a.place.label.localeCompare(b.place.label));
  const ringLabels = ringLabelVisibility(spec.units, radius);

  // Which kind of change the list rolls for: a new centre rolls with the map's wave, new rings roll down the list.
  const [change, setChange] = React.useState<ChangeState>({ centerKey: resolved.key, ringKey: spec.key, kind: "none" });
  if (change.centerKey !== resolved.key || change.ringKey !== spec.key) {
    setChange({ centerKey: resolved.key, ringKey: spec.key, kind: change.centerKey !== resolved.key ? "center" : "rings" });
  }
  const rowDelay = (entry: PlacedPlace, rank: number) => {
    if (reducedMotion || change.kind === "none") return 0;
    if (change.kind === "rings") return RING_FADE * 1000 + rank * ROW_STAGGER_MS;
    return (RING_FADE + entry.bucket * BUCKET_STEP + ARRIVAL_LAG) * 1000;
  };

  const pointedId = hovered ?? focused;
  const placedIds = new Set(placed.map((entry) => entry.place.id));
  const tabStop =
    active !== null && placedIds.has(active) ? active : (resolved.place?.id ?? (placed.length ? placed[0].place.id : null));
  /** The place whose route is drawn: the pointed one, unless it is the centre. */
  const routeTarget = pointedId !== null && pointedId !== resolved.place?.id && placedIds.has(pointedId) ? pointedId : null;

  // Labels: the centre first, then the nearest places; the pointed place always gets its label.
  const labelEntries: LabelEntry[] = placed.map((entry) => {
    const rank = rows.indexOf(entry);
    const pointed = entry.place.id === pointedId;
    return {
      id: entry.place.id,
      x: entry.x,
      y: entry.y,
      gap: entry.isCenter ? CENTER_LABEL_GAP : PLACE_LABEL_GAP,
      priority: entry.isCenter ? 3 * FORCED_PRIORITY : (pointed ? FORCED_PRIORITY : 0) + (rows.length - rank),
      estimate: estimateLabelWidth(entry.place.label),
    };
  });
  const ringAngle = ringLabelAngle(spec, ringLabels, placed, radius, stageSize);
  const ringKey = `${spec.key}@${ringAngle.toFixed(3)}`;
  const estimated = arrangeLabels(
    labelEntries,
    null,
    [...fixedBoxes(stageSize), ...ringLabelBoxes(spec, ringLabels, radius, stageSize, ringAngle, null)],
    stageSize,
  );

  const stageRef = React.useRef<HTMLDivElement>(null);
  const dotsRef = React.useRef<HTMLCanvasElement>(null);
  const effectsRef = React.useRef<HTMLCanvasElement>(null);
  const crosshairRef = React.useRef<HTMLSpanElement>(null);
  /** The mutable drawing state, created on first use (never during render). */
  const engineRef = useLazyRef(createEngine);
  const placeRefs = React.useRef(new Map<string, HTMLDivElement>());
  const labelRefs = React.useRef(new Map<string, HTMLSpanElement>());
  const nameRefs = React.useRef(new Map<string, HTMLSpanElement>());
  const buttonRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const ringLabelRefs = React.useRef<(HTMLSpanElement | null)[]>([]);
  const pointRef = React.useRef<HTMLDivElement>(null);

  const loop = useAnimationLoop(stageRef, step);
  const palette = usePalette(stageRef, MAP_COLORS, () => {
    engineRef.current.inkDirty = true;
    loop.kick();
  });
  const dots = useCanvas(
    dotsRef,
    (surface) => {
      const engine = engineRef.current;
      resizeEngine(engine, surface.width);
      setSize((previous) => (previous === surface.width ? previous : surface.width));
      loop.kick();
    },
    { maxDpr: 2 },
  );
  const effects = useCanvas(
    effectsRef,
    (surface) => {
      const engine = engineRef.current;
      engine.fxX = -surface.canvas.offsetLeft;
      engine.fxY = -surface.canvas.offsetTop;
    },
    { maxDpr: 2 },
  );

  // Hand the latest centre, places and rings to the engine before paint, so a new centre starts its flight in the
  // same frame React moves the place elements to their new targets.
  React.useLayoutEffect(() => {
    const engine = engineRef.current;
    const now = nowSeconds();
    const reduced = prefersReducedMotion();
    if (engine.placesKey !== placesKey) {
      engine.placesKey = placesKey;
      engine.items = items;
      if (engine.basis) retarget(engine, engine.center, false, now);
    }
    if (engine.centerKey !== resolved.key) {
      const first = engine.centerKey === "";
      engine.centerKey = resolved.key;
      const animate = !first && !reduced && engine.reveal.state === "done" && engine.count > 0;
      retarget(engine, resolved.point, animate, now);
      if (animate) popCrosshair(crosshairRef.current, engine.ringLead);
    }
    // a new label angle redraws the rings like a new step does: their gaps move with the labels
    if (engine.rings.latest?.key !== ringKey) setRings(engine, { key: ringKey, units: spec.units, angle: ringAngle }, now, reduced);
    writePlaces(engine, placeRefs.current, labelRefs.current, pointRef.current, now);
    writeRingLabels(engine, ringLabelRefs.current, now);
    loop.kick();
  });

  // Measure the labels and place them for real; the render placed them with estimated widths.
  React.useLayoutEffect(() => {
    const engine = engineRef.current;
    const ringWidths = spec.labels.map((_, k) => ringLabelRefs.current[k]?.offsetWidth ?? 0);
    engine.rings.gaps = ringWidths.map((width, k) => (ringLabels[k] && width ? width / 2 + RING_LABEL_CLEARANCE : 0));
    if (size === null) return;
    const widths = new Map<string, number>();
    for (const entry of labelEntries) widths.set(entry.id, nameRefs.current.get(entry.id)?.offsetWidth ?? entry.estimate);
    const obstacles = [...fixedBoxes(stageSize), ...ringLabelBoxes(spec, ringLabels, radius, stageSize, ringAngle, ringWidths)];
    const placements = arrangeLabels(labelEntries, widths, obstacles, stageSize);
    labelEntries.forEach((entry, i) => {
      const element = labelRefs.current.get(entry.id);
      if (element) applySide(element, placements[i], entry.priority >= FORCED_PRIORITY);
    });
  });

  // The pointed place grows its route and its ring of equal distance.
  React.useEffect(() => {
    const hover = engineRef.current.hover;
    if (routeTarget !== null && routeTarget !== hover.id) {
      hover.id = routeTarget;
      hover.position = 0;
      hover.velocity = 0;
    }
    hover.target = routeTarget === null ? 0 : 1;
    loop.kick();
  }, [routeTarget, engineRef, loop]);

  // The land appears outward from the centre the first time a third of the map is on screen.
  React.useEffect(() => {
    const engine = engineRef.current;
    const stage = stageRef.current;
    if (engine.reveal.state !== "pending" || !stage) return;
    if (prefersReducedMotion()) {
      finishReveal(engine);
      loop.kick();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting) || engine.reveal.state !== "pending") return;
        engine.reveal.state = "running";
        engine.reveal.start = nowSeconds();
        observer.disconnect();
        loop.kick();
      },
      { threshold: 0.3 },
    );
    observer.observe(stage);
    return () => observer.disconnect();
  }, [engineRef, loop]);

  // A switch to reduced motion settles everything at once.
  React.useEffect(() => {
    loop.kick();
  }, [reducedMotion, loop]);

  function step(time: number, delta: number) {
    const engine = engineRef.current;
    if (engine.inkDirty && palette.current) {
      engine.ink = inkOf(palette.current);
      const stops = rampOf(engine.ink);
      if (engine.batch) engine.batch.setRamp(stops);
      else engine.batch = createDotBatch(4096, stops, { tones: 32, levels: 16 });
      engine.inkDirty = false;
    }
    const surface = dots.current;
    if (!surface || !engine.ink || !engine.batch) return false;
    const reduced = prefersReducedMotion();
    let busy = false;

    const reveal = engine.reveal;
    let front = Infinity;
    if (reveal.state === "pending") front = -1;
    if (reveal.state === "running") {
      const t = (time - reveal.start) / REVEAL_SECONDS;
      if (reduced || t >= 1) finishReveal(engine);
      else {
        front = easeOutCubic(t) * (1 + REVEAL_BAND);
        busy = true;
      }
    }

    if (engine.moving) {
      let settled = true;
      // indexed rather than for-of: the React Compiler lint loses the ref through for-of and rejects the writes
      for (let i = 0; i < engine.buckets.length; i++) {
        const bucket = engine.buckets[i];
        if (reduced) {
          bucket.position = 1;
          bucket.velocity = 0;
          continue;
        }
        if (time < bucket.start) {
          settled = false;
          continue;
        }
        springStep(bucket, 1, delta, MOVE_STIFFNESS, MOVE_DAMPING);
        if (Math.abs(1 - bucket.position) < 0.0015 && Math.abs(bucket.velocity) < 0.02) {
          bucket.position = 1;
          bucket.velocity = 0;
        } else settled = false;
      }
      if (settled) finishMove(engine);
      else busy = true;
    }

    if (stepRings(engine, time, reduced)) busy = true;

    const hover = engine.hover;
    if (reduced) {
      hover.position = hover.target;
      hover.velocity = 0;
    } else if (Math.abs(hover.position - hover.target) > 0.001 || Math.abs(hover.velocity) > 0.01) {
      springStep(hover, hover.target, delta, HOVER_STIFFNESS, HOVER_DAMPING);
      busy = true;
    } else {
      hover.position = hover.target;
      hover.velocity = 0;
    }
    if (hover.target === 0 && hover.position <= 0.001) hover.id = null;

    if (drawMap(engine, surface.context, surface.width, time, front, reduced)) busy = true;
    writePlaces(engine, placeRefs.current, labelRefs.current, pointRef.current, time);
    writeRingLabels(engine, ringLabelRefs.current, time);

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

  /** Re-centres on a place or a point; sparks fly from where the pick happened. */
  function pick(next: string | LatLon, x: number, y: number) {
    const engine = engineRef.current;
    const ink = engine.ink;
    if (ink) engine.sparks.add(x + engine.fxX, y + engine.fxY, typeof next === "string" ? 18 : 12, [ink.accent, ink.glint, ink.soft], SPARK_OPTIONS);
    setCenterValue(next);
    loop.kick();
  }

  function pickPlace(id: string) {
    if (id === resolved.place?.id) return;
    const engine = engineRef.current;
    const motion = engine.places.get(id);
    const r = engine.radius || radius;
    const half = (engine.size || stageSize) / 2;
    const progress = motion && engine.moving ? engine.buckets[motion.bucket].position : 1;
    const u = motion ? motion.fromU + (motion.toU - motion.fromU) * progress : 0;
    const v = motion ? motion.fromV + (motion.toV - motion.fromV) * progress : 0;
    pick(id, half + u * r, half + v * r);
  }

  function handleStageClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (target instanceof Element && target.closest("button")) return;
    const stage = event.currentTarget;
    // localPoint undoes CSS zoom on an ancestor; the stage has no border, so its offset and client widths match
    const { x, y } = localPoint(stage, event.clientX, event.clientY);
    const half = stage.clientWidth / 2;
    const r = half - GUTTER;
    const dx = x - half;
    const dy = y - half;
    const distance = Math.hypot(dx, dy);
    if (distance > r || distance < 3) return;
    const bearing = ((Math.atan2(dx, -dy) / DEG) % 360 + 360) % 360;
    const point = destinationPoint(resolved.point, bearing, (distance / r) * HALF_CIRCUMFERENCE_KM);
    const engine = engineRef.current;
    engine.pointFrom = { u: dx / r, v: dy / r };
    pick({ lat: round4(point.lat), lon: round4(point.lon) }, x, y);
  }

  function focusPlace(id: string) {
    setActive(id);
    buttonRefs.current.get(id)?.focus();
  }

  function handlePlaceKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const direction = ARROW_DIRECTIONS[event.key];
    if (direction) {
      event.preventDefault();
      const next = spatialNavigate(placed, index, direction);
      if (next !== index) focusPlace(placed[next].place.id);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const target = event.key === "Home" ? (resolved.place ?? rows[0]?.place) : rows[rows.length - 1]?.place;
      if (target) focusPlace(target.id);
    }
  }

  const stageLabel = `${label}: ${resolved.name}. Rings every ${spec.stepText}.`;
  const heading = spec.mode === "latency" ? "Round trip from" : "Distance from";
  // one short line, so the list column beside the map is no taller than the map
  const footnote = spec.mode === "latency" ? `Fibre estimate, stretch ${formatStretch(fibreStretch)}` : "Great-circle distance";
  const listRows: ListRow[] = rows.map((entry, rank) => ({
    id: entry.place.id,
    label: entry.place.label,
    text: entry.text,
    value: entry.value,
    delay: rowDelay(entry, rank),
  }));
  const gapFraction = (ANTIPODE_GAP / (Math.PI * (stageSize - 2 * GUTTER))) * RIM_LENGTH;

  return (
    <div data-slot="geo-azimuthal" className={cn("@container w-full max-w-[660px] text-foreground", className)} {...props}>
      <div className="grid gap-4 @min-[560px]:grid-cols-[minmax(0,1fr)_196px] @min-[560px]:gap-x-5">
        <div
          ref={stageRef}
          role="group"
          aria-roledescription="map"
          aria-label={stageLabel}
          onClick={handleStageClick}
          className="relative aspect-square w-full cursor-crosshair touch-manipulation select-none [-webkit-tap-highlight-color:transparent]"
        >
          <div aria-hidden="true" className="absolute inset-2 rounded-full bg-muted/40" />
          <svg aria-hidden="true" viewBox="0 0 100 100" className="pointer-events-none absolute inset-2 block size-[calc(100%-16px)] overflow-visible">
            <circle
              cx={50}
              cy={50}
              r={50}
              pathLength={RIM_LENGTH}
              strokeDasharray={`${RIM_LENGTH - gapFraction} ${gapFraction}`}
              strokeDashoffset={RIM_LENGTH * 0.75 - gapFraction / 2}
              vectorEffect="non-scaling-stroke"
              strokeWidth={1}
              className="fill-none stroke-border"
            />
          </svg>
          <canvas ref={dotsRef} aria-hidden="true" className="absolute inset-0 block size-full" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            {spec.labels.map((text, k) => (
              <span
                key={`${spec.key}:${text}`}
                ref={(node) => {
                  ringLabelRefs.current[k] = node;
                }}
                hidden={!ringLabels[k]}
                className="absolute -translate-x-1/2 -translate-y-1/2 font-mono text-[10px] leading-3 whitespace-nowrap text-muted-foreground tabular-nums opacity-0 [text-shadow:0_0_2px_var(--card),0_0_3px_var(--card)]"
                style={{
                  left: `calc(50% + (50% - ${GUTTER}px) * ${round4(spec.units[k] * Math.sin(ringAngle))})`,
                  top: `calc(50% - (50% - ${GUTTER}px) * ${round4(spec.units[k] * Math.cos(ringAngle))})`,
                }}
              >
                {text}
              </span>
            ))}
            <span className="absolute bottom-2 left-1/2 -translate-x-1/2 translate-y-1/2 font-mono text-[10px] leading-3 whitespace-nowrap text-muted-foreground [text-shadow:0_0_2px_var(--card),0_0_3px_var(--card)]">
              Antipode
            </span>
          </div>
          <div className="pointer-events-none absolute inset-0 z-[2]">
            {resolved.place === null && (
              <div ref={pointRef} className="absolute top-1/2 left-1/2 size-0 will-change-transform">
                <Crosshair ref={crosshairRef} />
              </div>
            )}
            {placed.map((entry, index) => {
              const { place, isCenter } = entry;
              const pointed = place.id === pointedId;
              const placement = estimated[index];
              return (
                <div
                  key={place.id}
                  ref={(node) => {
                    if (node) placeRefs.current.set(place.id, node);
                    else placeRefs.current.delete(place.id);
                  }}
                  data-center={isCenter ? "" : undefined}
                  data-pointed={pointed ? "" : undefined}
                  className="group/place absolute size-0 will-change-transform data-[center]:z-[2] data-[pointed]:z-[3]"
                  style={{ left: discOffset(entry.u), top: discOffset(entry.v) }}
                >
                  <button
                    ref={(node) => {
                      if (node) buttonRefs.current.set(place.id, node);
                      else buttonRefs.current.delete(place.id);
                    }}
                    type="button"
                    data-slot="geo-azimuthal-place"
                    aria-pressed={isCenter}
                    aria-label={isCenter ? `${place.label}, centre` : `${place.label}, ${entry.text}`}
                    tabIndex={place.id === tabStop ? 0 : -1}
                    onClick={() => pickPlace(place.id)}
                    onKeyDown={(event) => handlePlaceKeyDown(event, index)}
                    onFocus={(event) => {
                      setActive(place.id);
                      if (event.currentTarget.matches(":focus-visible")) setFocused(place.id);
                    }}
                    onBlur={() => setFocused((current) => (current === place.id ? null : current))}
                    onPointerEnter={(event) => {
                      if (event.pointerType === "mouse") setHovered(place.id);
                    }}
                    onPointerLeave={() => setHovered((current) => (current === place.id ? null : current))}
                    className={cn(
                      "pointer-events-auto absolute -top-3 -left-3 grid size-6 place-items-center rounded-full border-0 bg-transparent p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-solid focus-visible:outline-lumesec",
                      isCenter ? "cursor-default" : "cursor-pointer",
                    )}
                  >
                    {isCenter ? (
                      <Crosshair ref={crosshairRef} />
                    ) : (
                      <span className="block size-2 rounded-full bg-foreground shadow-[0_0_0_1.5px_var(--card)] [transition:scale_.2s_cubic-bezier(.3,1.4,.5,1),background-color_.2s_ease] group-data-[pointed]/place:scale-[1.3] group-data-[pointed]/place:bg-lumesec motion-reduce:transition-none" />
                    )}
                  </button>
                  <span
                    ref={(node) => {
                      if (node) labelRefs.current.set(place.id, node);
                      else labelRefs.current.delete(place.id);
                    }}
                    aria-hidden="true"
                    {...sideAttributes(placement.side)}
                    data-hidden={placement.visible || pointed || isCenter ? undefined : ""}
                    className={cn(
                      "group/label pointer-events-none absolute w-max text-[11.5px] leading-4 whitespace-nowrap [text-shadow:0_0_2px_var(--card),0_0_2px_var(--card),0_0_4px_var(--card)] [transition:opacity_.2s_ease] opacity-[var(--flight,1)] motion-reduce:transition-none data-[align=center]:text-center data-[align=end]:text-right data-[hidden]:opacity-0",
                      "data-[side=right]:top-0 data-[side=right]:left-(--gap) data-[side=right]:-translate-y-1/2",
                      "data-[side=left]:top-0 data-[side=left]:right-(--gap) data-[side=left]:-translate-y-1/2",
                      "data-[side=top]:bottom-(--gap) data-[side=top]:left-0 data-[side=top]:-translate-x-1/2",
                      "data-[side=bottom]:top-(--gap) data-[side=bottom]:left-0 data-[side=bottom]:-translate-x-1/2",
                      "data-[side=top-right]:bottom-(--diagonal) data-[side=top-right]:left-(--diagonal)",
                      "data-[side=bottom-right]:top-(--diagonal) data-[side=bottom-right]:left-(--diagonal)",
                      "data-[side=top-left]:right-(--diagonal) data-[side=top-left]:bottom-(--diagonal)",
                      "data-[side=bottom-left]:top-(--diagonal) data-[side=bottom-left]:right-(--diagonal)",
                      isCenter ? "font-semibold text-foreground" : "font-medium text-foreground/85",
                    )}
                    style={labelGapStyle(isCenter ? CENTER_LABEL_GAP : PLACE_LABEL_GAP)}
                  >
                    <span
                      ref={(node) => {
                        if (node) nameRefs.current.set(place.id, node);
                        else nameRefs.current.delete(place.id);
                      }}
                    >
                      {place.label}
                    </span>
                    {pointed && !isCenter && (
                      <span className="absolute top-full left-0 mt-px font-mono text-[10.5px] leading-3.5 font-normal text-muted-foreground tabular-nums group-data-[above]/label:top-auto group-data-[above]/label:bottom-full group-data-[above]/label:mt-0 group-data-[above]/label:mb-px group-data-[align=center]/label:left-1/2 group-data-[align=center]/label:-translate-x-1/2 group-data-[align=end]/label:right-0 group-data-[align=end]/label:left-auto">
                        {entry.text}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          <canvas
            ref={effectsRef}
            aria-hidden="true"
            className="pointer-events-none absolute -top-10 -left-6 z-[3] block h-[calc(100%+80px)] w-[calc(100%+48px)] @min-[560px]:-left-10 @min-[560px]:w-[calc(100%+80px)]"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 @min-[560px]:flex-col @min-[560px]:items-stretch">
            <p aria-live="polite" aria-atomic="true" className="m-0 grid min-w-0 gap-0.5">
              <RollText text={heading} className="text-[11.5px] leading-4 text-muted-foreground" />
              <RollText text={resolved.name} className="max-w-full overflow-hidden text-[16px] leading-5 font-medium tracking-[-0.01em]" />
            </p>
            <RingsToggle value={spec.mode} onValueChange={setMode} className="w-[176px] @min-[560px]:w-full" />
          </div>
          <PlaceList
            rows={listRows}
            hovered={pointedId}
            emptyText={emptyText}
            center={resolved.name}
            moveDelay={change.kind === "center" && !reducedMotion ? RING_FADE * 1000 : 0}
            onHover={setHovered}
            onPick={pickPlace}
          />
          <p className="m-0 mt-auto text-[11px] leading-[15px] text-muted-foreground">{footnote}</p>
        </div>
      </div>
    </div>
  );
}

/* Rings toggle ------------------------------------------------------------------------------------------- */

const RING_OPTIONS: readonly { value: AzimuthalRings; label: string }[] = [
  { value: "distance", label: "Distance" },
  { value: "latency", label: "Latency" },
];

/** A two-way segmented radiogroup; the thumb slides on an overshooting curve. */
function RingsToggle({
  value,
  onValueChange,
  className,
}: {
  value: AzimuthalRings;
  onValueChange: (value: AzimuthalRings) => void;
  className?: string;
}) {
  const buttons = React.useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(0, RING_OPTIONS.findIndex((option) => option.value === value));

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + RING_OPTIONS.length) % RING_OPTIONS.length;
    onValueChange(RING_OPTIONS[next].value);
    buttons.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Rings"
      className={cn("relative grid h-[30px] grid-cols-2 rounded-lg border border-border bg-muted p-0.5", className)}
    >
      <span
        aria-hidden="true"
        className="absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-2px)] rounded-md border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.06)] [transition:translate_.36s_cubic-bezier(.3,1.3,.5,1)] motion-reduce:transition-none"
        style={{ translate: `${index * 100}% 0` }}
      />
      {RING_OPTIONS.map((option, i) => {
        const checked = i === index;
        return (
          <button
            key={option.value}
            ref={(node) => {
              buttons.current[i] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onValueChange(option.value)}
            onKeyDown={handleKeyDown}
            className="relative z-[1] cursor-pointer rounded-md border-0 bg-transparent px-2.5 font-[inherit] text-[12px] leading-none font-medium text-muted-foreground outline-none [transition:color_.2s_ease] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-solid focus-visible:outline-lumesec aria-checked:text-foreground"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* Place list --------------------------------------------------------------------------------------------- */

interface ListRow {
  id: string;
  label: string;
  text: string;
  value: number;
  /** Milliseconds before the value rolls to its new text. */
  delay: number;
}

/** Each row's layout slot inside the list, by place id. */
type RowPositions = Map<string, { left: number; top: number }>;

/** Layout slots ignore transforms, so a row in the middle of its slide still reports where it is going. */
function readPositions(elements: ReadonlyMap<string, HTMLElement>): RowPositions {
  const positions: RowPositions = new Map();
  for (const [id, element] of elements) positions.set(id, { left: element.offsetLeft, top: element.offsetTop });
  return positions;
}

/**
 * The places sorted by distance. A new order slides each row to its new slot on a spring (FLIP), and each value rolls
 * after its own delay, so the list updates top to bottom as the map grows outward.
 */
function PlaceList({
  rows,
  hovered,
  emptyText,
  center,
  moveDelay,
  onHover,
  onPick,
}: {
  rows: readonly ListRow[];
  hovered: string | null;
  emptyText: string;
  center: string;
  moveDelay: number;
  onHover: (id: string | null) => void;
  onPick: (id: string) => void;
}) {
  const listRef = React.useRef<HTMLOListElement>(null);
  const items = React.useRef(new Map<string, HTMLLIElement>());
  const positions = React.useRef<RowPositions>(new Map());
  const order = rows.map((row) => row.id).join("|");
  const empty = rows.length === 0;

  React.useLayoutEffect(() => {
    const reduced = prefersReducedMotion();
    const previous = positions.current;
    const next = readPositions(items.current);
    for (const [id, now] of next) {
      const element = items.current.get(id);
      const before = previous.get(id);
      if (reduced || !element || !before || typeof element.animate !== "function") continue;
      const dx = before.left - now.left;
      const dy = before.top - now.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      for (const animation of element.getAnimations()) animation.cancel();
      element.animate(
        SPRING_CURVE.map((p) => ({ translate: `${(dx * (1 - p)).toFixed(2)}px ${(dy * (1 - p)).toFixed(2)}px` })),
        { duration: SPRING_CURVE_MS, delay: moveDelay, easing: "linear", fill: "backwards" },
      );
    }
    positions.current = next;
  }, [order, moveDelay]);

  // A resize moves rows without an animation (the list switches between one and two columns); remember where they
  // are now, so the next new order slides each row from its real slot.
  React.useEffect(() => {
    const list = listRef.current;
    if (empty || !list) return;
    const observer = new ResizeObserver(() => {
      positions.current = readPositions(items.current);
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [empty]);

  if (empty) {
    return <p className="m-0 py-1 text-[12.5px] leading-5 text-muted-foreground">{emptyText}</p>;
  }

  const half = Math.ceil(rows.length / 2);
  return (
    <ol
      ref={listRef}
      aria-label={`Places by distance from ${center}`}
      className="relative m-0 grid list-none grid-cols-1 gap-x-5 p-0 @min-[400px]:grid-flow-col @min-[400px]:grid-cols-2 @min-[400px]:[grid-template-rows:repeat(var(--rows),auto)] @min-[560px]:grid-flow-row @min-[560px]:grid-cols-1 @min-[560px]:[grid-template-rows:none]"
      style={{ "--rows": half } as React.CSSProperties}
    >
      {rows.map((row) => (
        <li
          key={row.id}
          ref={(node) => {
            if (node) items.current.set(row.id, node);
            else items.current.delete(row.id);
          }}
          data-pointed={row.id === hovered ? "" : undefined}
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") onHover(row.id);
          }}
          onPointerLeave={() => onHover(null)}
          onClick={() => onPick(row.id)}
          className="group/row -mx-1.5 flex h-5 min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 text-[12.5px] leading-4 [transition:background-color_.15s_ease] data-[pointed]:bg-muted"
        >
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-foreground/55 [transition:background-color_.15s_ease] group-data-[pointed]/row:bg-lumesec" />
          <span className="min-w-0 flex-1 truncate">{row.label}</span>
          <RowValue text={row.text} value={row.value} delay={row.delay} />
        </li>
      ))}
    </ol>
  );
}

/** A list value: tabular figures that roll in the direction of change once the row's delay has passed. */
function RowValue({ text, value, delay }: { text: string; value: number; delay: number }) {
  const [shown, setShown] = React.useState({ text, value, direction: 1 });
  // nothing to wait for (reduced motion, or a change that is not a move): the new value shows in the same render
  if (delay <= 0 && shown.text !== text) {
    setShown({ text, value, direction: value >= shown.value ? 1 : -1 });
  }

  React.useEffect(() => {
    if (delay <= 0 || shown.text === text) return;
    const timer = window.setTimeout(() => {
      setShown((previous) => ({ text, value, direction: value >= previous.value ? 1 : -1 }));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [text, value, delay, shown.text]);

  return (
    <RollText
      text={shown.text}
      direction={shown.direction}
      className="shrink-0 justify-items-end font-mono text-[11.5px] text-muted-foreground tabular-nums"
    />
  );
}

/* Crosshair --------------------------------------------------------------------------------------------- */

/** The centre mark: an accent square with four hairline arms. */
function Crosshair({ ref }: { ref: React.Ref<HTMLSpanElement> }) {
  return (
    <span ref={ref} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-1/2 block size-0">
      <span className="absolute -top-1 -left-1 size-2 rounded-[2px] bg-lumesec shadow-[0_0_0_2px_var(--card),0_0_10px_2px_color-mix(in_srgb,var(--lumesec)_35%,transparent)]" />
      <span className="absolute top-[-0.5px] left-1.5 h-px w-2 bg-lumesec" />
      <span className="absolute top-[-0.5px] right-1.5 h-px w-2 bg-lumesec" />
      <span className="absolute top-1.5 left-[-0.5px] h-2 w-px bg-lumesec" />
      <span className="absolute bottom-1.5 left-[-0.5px] h-2 w-px bg-lumesec" />
    </span>
  );
}

/** The crosshair opens once it has landed in the middle. */
function popCrosshair(element: HTMLElement | null, lead: number) {
  if (!element || typeof element.animate !== "function") return;
  element.animate(CROSSHAIR_KEYFRAMES, { duration: 520, delay: (lead + 0.28) * 1000, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" });
}

/* Constants ---------------------------------------------------------------------------------------------- */

/** Stage size the server lays the map out at; positions are fractions of the disc, so they hold at any size. */
const NOMINAL_SIZE = 400;
/** Space between the stage edge and the rim, in px. */
const GUTTER = 8;
const DEFAULT_STRETCH = 1.5;
const KM_PER_MILE = 1.609344;
/** Half the Earth's circumference: the distance to the antipode, which is the rim. */
const HALF_CIRCUMFERENCE_KM = Math.PI * EARTH_RADIUS_KM;
/** Land dot spacing at the centre of the map, in px. */
const DOT_PITCH = 2.6;
const DOT_SIZE = 1.5;
/** Dots on the rings, the route and the equal-distance circle, every this many px. */
const DOTTED_SPACING = 4;
const RING_ALPHA = 0.4;
const MAX_RINGS = 48;
/** Ring labels closer than this to the centre or to the previous shown label stay hidden. */
const RING_LABEL_MIN_RADIUS = 30;
const RING_LABEL_MIN_GAP = 26;
const RING_LABEL_CLEARANCE = 4;
/** Length of the rim gap around the Antipode label, in px. */
const ANTIPODE_GAP = 58;
const RIM_LENGTH = 1000;
/** Dots fade out between these angles from the centre, so nothing piles up on the rim. */
const FAR_FADE_START = 172 * DEG;
const FAR_LIMIT = 179 * DEG;

// Re-centre timing, in seconds
const RING_FADE = 0.15;
const RING_DRAW = 0.4;
const RING_STAGGER = 0.03;
/** Delay from the centre to the rim, plus the per-dot jitter that makes the front uneven. */
const MOVE_SPREAD = 0.5;
const MOVE_JITTER = 0.06;
const BUCKETS = 16;
const BUCKET_STEP = (MOVE_SPREAD + MOVE_JITTER) / BUCKETS;
const MOVE_STIFFNESS = 160;
const MOVE_DAMPING = 0.82;
/** How long after a dot leaves its value rolls, so the list changes as the dots arrive. */
const ARRIVAL_LAG = 0.14;
const ROW_STAGGER_MS = 28;
const PING_DELAY = 0.1;
const PING_SECONDS = 0.85;
const PING_GAP = 0.16;
/** How far the ping travels, as a share of the map radius. */
const PING_REACH = 0.42;
const PING_BAND = 6;
const REVEAL_SECONDS = 1.3;
const REVEAL_BAND = 0.06;
const HOVER_STIFFNESS = 240;
const HOVER_DAMPING = 0.9;
/** How much the land dims while it waits for its turn to move. */
const WAIT_DIM = 0.5;
/** Seconds for the labels to fade as a move starts. */
const LABEL_FADE = 0.1;

// Labels
const PLACE_LABEL_GAP = 8;
const CENTER_LABEL_GAP = 17;
/** The crosshair keeps labels this far away. */
const CROSSHAIR_REACH = 15;
const LABEL_HEIGHT = 16;
/** Labels at or above this priority show even where they overlap. */
const FORCED_PRIORITY = 1000;

const SPARK_OPTIONS = { speed: [60, 210], life: [0.35, 0.85], size: [1.5, 2.5], drag: 3.2, jitter: 2 } as const;

const MAP_COLORS = {
  foreground: THEME_TOKENS.foreground,
  card: THEME_TOKENS.card,
  accent: THEME_TOKENS.accent,
  soft: THEME_TOKENS.accentSoft,
  glint: THEME_TOKENS.glint,
} as const satisfies Record<string, ColorToken>;

const CROSSHAIR_KEYFRAMES: Keyframe[] = [
  { scale: "0.4", opacity: 0.4 },
  { scale: "1.25", opacity: 1, offset: 0.45 },
  { scale: "1", opacity: 1 },
];

/** The ring draw-on eases like the arcs in the other Location components. */
const RING_EASE = cubicBezier(0.45, 0, 0.25, 1);

/** London and 14 cities around the world, from the shared demo set. */
const DEMO_IDS = ["lhr", "jfk", "gru", "los", "jnb", "dxb", "bom", "sin", "nrt", "syd", "akl", "lax", "mex", "nbo", "ist"];
const DEMO_PLACES: readonly AzimuthalPlace[] = DEMO_IDS.flatMap((id) => {
  const city = findCity(id);
  return city ? [{ id, label: city.name, lat: city.lat, lon: city.lon }] : [];
});

/**
 * A damped spring from 0 to 1 sampled at 60 fps, for one-shot WAAPI moves (the list rows): a real spring rather than
 * a tween, played back with linear easing between the samples.
 */
const SPRING_CURVE: readonly number[] = (() => {
  const state = { position: 0, velocity: 0 };
  const samples = [0];
  for (let i = 0; i < 120; i++) {
    springStep(state, 1, 1 / 60, 230, 0.8);
    samples.push(state.position);
    if (i > 12 && Math.abs(1 - state.position) < 0.002 && Math.abs(state.velocity) < 0.02) break;
  }
  samples[samples.length - 1] = 1;
  return samples;
})();
const SPRING_CURVE_MS = ((SPRING_CURVE.length - 1) * 1000) / 60;

/* Layout ------------------------------------------------------------------------------------------------- */

type ChangeKind = "none" | "center" | "rings";

/** The centre and rings the list last rolled for, and what changed then. */
interface ChangeState {
  centerKey: string;
  ringKey: string;
  kind: ChangeKind;
}

interface ResolvedCenter {
  point: LatLon;
  /** The place at the centre, or null for a free point (an unlabelled crosshair). */
  place: AzimuthalPlace | null;
  /** Changes whenever the centre moves. */
  key: string;
  /** The place name, or the point's coordinates. */
  name: string;
}

interface PlacedPlace {
  place: AzimuthalPlace;
  /** Position as a fraction of the map radius from the centre, y down. */
  u: number;
  v: number;
  /** Position in px at the laid-out stage size. */
  x: number;
  y: number;
  km: number;
  isCenter: boolean;
  text: string;
  value: number;
  bucket: number;
}

interface LabelEntry {
  id: string;
  x: number;
  y: number;
  gap: number;
  priority: number;
  estimate: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RingSpecResult {
  mode: AzimuthalRings;
  unit: AzimuthalUnit;
  key: string;
  /** Ring radii as a share of the map radius. */
  units: number[];
  labels: string[];
  stepText: string;
}

function cleanPlaces(list: readonly AzimuthalPlace[]): AzimuthalPlace[] {
  const seen = new Set<string>();
  const result: AzimuthalPlace[] = [];
  for (const place of list) {
    // ids are keys: a repeated id keeps its first place
    if (!place || seen.has(place.id) || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) continue;
    seen.add(place.id);
    result.push({ id: place.id, label: place.label || place.id, lat: clamp(place.lat, -90, 90), lon: wrapLongitude(place.lon) });
  }
  return result;
}

function isPoint(value: unknown): value is LatLon {
  return (
    typeof value === "object" &&
    value !== null &&
    "lat" in value &&
    "lon" in value &&
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lon)
  );
}

function pointCenter(point: LatLon): ResolvedCenter {
  const clean = { lat: clamp(point.lat, -90, 90), lon: wrapLongitude(point.lon) };
  return { point: clean, place: null, key: `point:${clean.lat.toFixed(5)},${clean.lon.toFixed(5)}`, name: formatLatLon(clean, "decimal", 2) };
}

function placeCenter(place: AzimuthalPlace): ResolvedCenter {
  return { point: place, place, key: `place:${place.id}:${place.lat}:${place.lon}`, name: place.label };
}

function resolveCenter(value: string | LatLon, items: readonly AzimuthalPlace[]): ResolvedCenter {
  if (isPoint(value)) {
    // a point that is one of the places centres on that place, with its label
    const { lat } = value;
    const lon = wrapLongitude(value.lon);
    const match = items.find((entry) => Math.abs(entry.lat - lat) < 1e-6 && Math.abs(entry.lon - lon) < 1e-6);
    return match ? placeCenter(match) : pointCenter(value);
  }
  const place = items.find((entry) => entry.id === value) ?? items[0];
  return place ? placeCenter(place) : pointCenter({ lat: 0, lon: 0 });
}

function measureOf(mode: AzimuthalRings, km: number, unit: AzimuthalUnit, stretch: number) {
  if (mode === "latency") {
    const ms = fiberRttMs(km, stretch);
    return { text: formatMs(ms), value: ms };
  }
  return { text: formatDistance(km, unit), value: unit === "mi" ? km / KM_PER_MILE : km };
}

function ringSpec(mode: AzimuthalRings, ringStep: number | undefined, unit: AzimuthalUnit, stretch: number): RingSpecResult {
  const latency = mode === "latency";
  const fallback = latency ? 50 : unit === "mi" ? 1000 : 2000;
  const step = ringStep !== undefined && Number.isFinite(ringStep) && ringStep > 0 ? ringStep : fallback;
  const kmPerStep = latency ? (FIBER_KM_PER_MS * step) / 2 / stretch : unit === "mi" ? step * KM_PER_MILE : step;
  const format = (value: number) => (latency ? formatMs(value) : formatDistance(unit === "mi" ? value * KM_PER_MILE : value, unit));
  const units: number[] = [];
  const labels: string[] = [];
  for (let k = 1; k <= MAX_RINGS; k++) {
    const share = (k * kmPerStep) / HALF_CIRCUMFERENCE_KM;
    if (share >= 0.985) break;
    units.push(share);
    labels.push(format(k * step));
  }
  return {
    mode,
    unit,
    key: latency ? `latency|${step}|${stretch}` : `distance|${step}|${unit}`,
    units,
    labels,
    stepText: format(step),
  };
}

/** Which ring labels show: none too near the centre or the rim, and none closer than RING_LABEL_MIN_GAP to the last. */
function ringLabelVisibility(units: readonly number[], radius: number): boolean[] {
  let last = -Infinity;
  return units.map((unitRadius) => {
    const r = unitRadius * radius;
    if (r < RING_LABEL_MIN_RADIUS || r > radius - 10 || r - last < RING_LABEL_MIN_GAP) return false;
    last = r;
    return true;
  });
}

/** The boxes of the visible ring labels, a column at `angle` (radians clockwise from north). */
function ringLabelBoxes(
  spec: RingSpecResult,
  visible: readonly boolean[],
  radius: number,
  size: number,
  angle: number,
  widths: readonly number[] | null,
): Box[] {
  const half = size / 2;
  const boxes: Box[] = [];
  spec.units.forEach((unitRadius, k) => {
    if (!visible[k]) return;
    const width = widths?.[k] || spec.labels[k].length * 6 + 2;
    const x = half + unitRadius * radius * Math.sin(angle);
    const y = half - unitRadius * radius * Math.cos(angle);
    boxes.push({ x: x - width / 2, y: y - 6, width, height: 12 });
  });
  return boxes;
}

/** Boxes the place labels keep clear of besides the ring labels: the crosshair and the Antipode label. */
function fixedBoxes(size: number): Box[] {
  const half = size / 2;
  return [
    { x: half - CROSSHAIR_REACH, y: half - CROSSHAIR_REACH, width: 2 * CROSSHAIR_REACH, height: 2 * CROSSHAIR_REACH },
    { x: half - 26, y: size - GUTTER - 7, width: 52, height: 14 },
  ];
}

/** Angles the ring label column may take, clockwise from north: straight up unless places crowd it. */
const RING_LABEL_ANGLES = [0, 30, -30, 150, -150, 180].map((degrees) => degrees * DEG);

/** The first angle at which no place point sits on a ring label, or the least crowded one. */
function ringLabelAngle(spec: RingSpecResult, visible: readonly boolean[], placed: readonly PlacedPlace[], radius: number, size: number) {
  let best = 0;
  let bestScore = Infinity;
  for (const angle of RING_LABEL_ANGLES) {
    let score = 0;
    for (const box of ringLabelBoxes(spec, visible, radius, size, angle, null)) {
      for (const entry of placed) {
        const near = entry.x > box.x - 6 && entry.x < box.x + box.width + 6 && entry.y > box.y - 6 && entry.y < box.y + box.height + 6;
        if (near) score++;
      }
    }
    if (score < bestScore) {
      best = angle;
      bestScore = score;
    }
    if (score === 0) break;
  }
  return best;
}

/** Where a label sits around its point: the four sides of `placeLabels`, then the four diagonals. */
type LabelSide = "right" | "left" | "top" | "bottom" | "top-right" | "bottom-right" | "top-left" | "bottom-left";

interface LabelSpot {
  visible: boolean;
  side: LabelSide;
}

const LABEL_SIDES: readonly LabelSide[] = ["right", "left", "top", "bottom", "top-right", "bottom-right", "top-left", "bottom-left"];
/** Labels keep this far from other places' points in the first pass. */
const POINT_CLEARANCE = 4;
/** A diagonal label's corner sits this share of the gap away from its point on each axis. */
const DIAGONAL = 0.75;

/** The attributes that style a label on its side: which way its text aligns, and whether the hover value goes above. */
function sideAttributes(side: LabelSide) {
  const align = side === "top" || side === "bottom" ? "center" : side.endsWith("left") ? "end" : "start";
  return { "data-side": side, "data-align": align, "data-above": side.startsWith("top") ? "" : undefined };
}

/** Writes a label's side attributes after measuring; the render wrote the estimated ones. */
function applySide(element: HTMLElement, spot: LabelSpot, forced: boolean) {
  const attributes = sideAttributes(spot.side);
  if (element.dataset.side !== spot.side) {
    element.dataset.side = attributes["data-side"];
    element.dataset.align = attributes["data-align"];
    element.toggleAttribute("data-above", attributes["data-above"] !== undefined);
  }
  element.toggleAttribute("data-hidden", !spot.visible && !forced);
}

/** The top-left corner of a label box of `w` × `h` on `side` of a point, `gap` away. */
function labelBox(side: LabelSide, x: number, y: number, w: number, h: number, gap: number) {
  const d = gap * DIAGONAL;
  switch (side) {
    case "right":
      return { x: x + gap, y: y - h / 2 };
    case "left":
      return { x: x - gap - w, y: y - h / 2 };
    case "top":
      return { x: x - w / 2, y: y - gap - h };
    case "bottom":
      return { x: x - w / 2, y: y + gap };
    case "top-right":
      return { x: x + d, y: y - d - h };
    case "bottom-right":
      return { x: x + d, y: y + d };
    case "top-left":
      return { x: x - d - w, y: y - d - h };
    case "bottom-left":
      return { x: x - d - w, y: y + d };
  }
}

/**
 * Greedy label placement with the rules of `placeLabels` from the geo module (by priority; first clear of other
 * points, then allowing them), plus the four diagonal positions and boxes that are already taken (the ring labels,
 * the Antipode label and the crosshair), which `placeLabels` has no input for. Near the centre the crosshair leaves
 * the four sides no room, and the diagonals usually still fit.
 */
function arrangeLabels(entries: readonly LabelEntry[], widths: Map<string, number> | null, fixed: readonly Box[], size: number) {
  const taken: Box[] = [...fixed];
  const placements: LabelSpot[] = entries.map(() => ({ visible: false, side: "right" }));
  const order = entries.map((_, index) => index).sort((a, b) => entries[b].priority - entries[a].priority || a - b);
  const overlapsTaken = (x: number, y: number, w: number, h: number) =>
    taken.some((box) => x < box.x + box.width && x + w > box.x && y < box.y + box.height && y + h > box.y);
  const coversPoint = (index: number, x: number, y: number, w: number, h: number) =>
    entries.some(
      (other, j) =>
        j !== index &&
        other.x > x - POINT_CLEARANCE &&
        other.x < x + w + POINT_CLEARANCE &&
        other.y > y - POINT_CLEARANCE &&
        other.y < y + h + POINT_CLEARANCE,
    );
  for (const index of order) {
    const entry = entries[index];
    const w = (widths?.get(entry.id) ?? entry.estimate) + 1;
    const h = LABEL_HEIGHT;
    placing: for (const avoidPoints of [true, false]) {
      for (const side of LABEL_SIDES) {
        const { x, y } = labelBox(side, entry.x, entry.y, w, h, entry.gap);
        if (x < 0 || y < 0 || x + w > size || y + h > size) continue;
        if (overlapsTaken(x, y, w, h) || (avoidPoints && coversPoint(index, x, y, w, h))) continue;
        placements[index] = { visible: true, side };
        taken.push({ x, y, width: w, height: h });
        break placing;
      }
    }
  }
  return placements;
}

/** The CSS variables a label's side classes position it with. */
const labelGapStyle = (gap: number) => ({ "--gap": `${gap}px`, "--diagonal": `${gap * DIAGONAL}px` }) as React.CSSProperties;

/** About 6.3 px per character for 11.5 px Geist medium; replaced by the measured width after mount. */
const estimateLabelWidth = (text: string) => text.length * 6.3 + 2;

/** CSS offset of a point at `fraction` of the radius from the centre, inside the rim. */
const discOffset = (fraction: number) => `calc(${GUTTER}px + (100% - ${2 * GUTTER}px) * ${round4((1 + fraction) / 2)})`;

const round4 = (value: number) => Math.round(value * 10000) / 10000;

const placeJitter = (id: string) => hash((stringHash(id) % 9973) + 0.5);

const formatStretch = (stretch: number) => `${Number(stretch.toFixed(2))}×`;

/* Projection --------------------------------------------------------------------------------------------- */

/** The centre's unit vector and its local east and north directions. */
interface AzimuthalBasis {
  cx: number;
  cy: number;
  cz: number;
  ex: number;
  ey: number;
  ez: number;
  nx: number;
  ny: number;
  nz: number;
}

/** A projected point: its offset from the centre as a share of the map radius (y down), and its angle in radians. */
interface Projected {
  u: number;
  v: number;
  angle: number;
}

function basisOf(point: LatLon): AzimuthalBasis {
  const phi = point.lat * DEG;
  const lambda = point.lon * DEG;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinLambda = Math.sin(lambda);
  const cosLambda = Math.cos(lambda);
  return {
    cx: cosPhi * sinLambda,
    cy: sinPhi,
    cz: cosPhi * cosLambda,
    ex: cosLambda,
    ey: 0,
    ez: -sinLambda,
    nx: -sinPhi * sinLambda,
    ny: cosPhi,
    nz: -sinPhi * cosLambda,
  };
}

/**
 * Azimuthal equidistant projection of a unit vector: the distance from the centre is the central angle (π at the
 * rim) and the direction is the initial bearing, north up. Allocation-free.
 */
function projectVector(basis: AzimuthalBasis, x: number, y: number, z: number, out: Projected): Projected {
  const along = x * basis.cx + y * basis.cy + z * basis.cz;
  const east = x * basis.ex + y * basis.ey + z * basis.ez;
  const north = x * basis.nx + y * basis.ny + z * basis.nz;
  const tangent = Math.hypot(east, north);
  const angle = Math.atan2(tangent, along);
  if (tangent < 1e-9) {
    // the centre itself, or its antipode, which sits at the bottom of the rim by its label
    out.u = 0;
    out.v = along < 0 ? 1 : 0;
  } else {
    const rho = angle / Math.PI;
    out.u = (rho * east) / tangent;
    out.v = (-rho * north) / tangent;
  }
  out.angle = angle;
  return out;
}

function projectLatLon(basis: AzimuthalBasis, lat: number, lon: number, out: Projected): Projected {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  const cosPhi = Math.cos(phi);
  return projectVector(basis, cosPhi * Math.sin(lambda), Math.sin(phi), cosPhi * Math.cos(lambda), out);
}

/** Dots fade toward the far side, and out just before the rim: 0.25 + 0.6·(1 − α/π)^0.5. */
function alphaAt(angle: number) {
  const far = clamp((FAR_LIMIT - angle) / (FAR_LIMIT - FAR_FADE_START), 0, 1);
  return (0.25 + 0.6 * Math.sqrt(Math.max(0, 1 - angle / Math.PI))) * far;
}

/** The delay bucket of a dot: nearer the new centre leaves sooner, with a little jitter for an uneven front. */
function bucketOf(angle: number, jitter: number) {
  const delay = (angle / Math.PI) * MOVE_SPREAD + jitter * MOVE_JITTER;
  return clamp(Math.floor((delay / (MOVE_SPREAD + MOVE_JITTER)) * BUCKETS), 0, BUCKETS - 1);
}

/* Engine ------------------------------------------------------------------------------------------------- */

interface Bucket extends Spring {
  /** Time in seconds when this bucket starts moving. */
  start: number;
}

/** A place or the free crosshair in flight: from its old position to its new one, on its bucket's spring. */
interface Flight {
  fromU: number;
  fromV: number;
  toU: number;
  toV: number;
  bucket: number;
  /** The transform last written, so settled frames skip the DOM. */
  written: string;
}

interface RingSet {
  key: string;
  units: readonly number[];
  /** Where the labels sit, in radians clockwise from north; each ring breaks there. */
  angle: number;
}

type RingPhase = "hidden" | "fading" | "drawing" | "shown";

interface Ink {
  dot: RGB;
  soft: RGB;
  accent: RGB;
  glint: RGB;
}

/** Everything the animation loop mutates. Lives in a ref, never in React state. */
interface Engine {
  size: number;
  radius: number;
  lattice: SphereLattice | null;
  count: number;
  fromU: Float32Array;
  fromV: Float32Array;
  toU: Float32Array;
  toV: Float32Array;
  fromA: Float32Array;
  toA: Float32Array;
  bucket: Uint8Array;
  center: LatLon;
  centerKey: string;
  basis: AzimuthalBasis | null;
  items: readonly AzimuthalPlace[];
  placesKey: string;
  places: Map<string, Flight>;
  /** The crosshair of a centre that is not one of the places. */
  point: Flight;
  /** Where a click on the map put the next free centre, as a share of the radius, so its crosshair flies from there. */
  pointFrom: { u: number; v: number } | null;
  buckets: Bucket[];
  moving: boolean;
  /** Seconds between a re-centre and the first dots leaving: the rings fade first. */
  ringLead: number;
  /** Time in seconds of the last re-centre. */
  moveStart: number;
  /** Start time of the centre ping, or -1. */
  ping: number;
  reveal: { state: "pending" | "running" | "done"; start: number };
  rings: {
    phase: RingPhase;
    alpha: number;
    fadeFrom: number;
    fadeStart: number;
    drawStart: number;
    /** The rings on the canvas; `latest` replaces them once they have faded out. */
    drawn: RingSet | null;
    latest: RingSet | null;
    /** Half the width of each ring's label plus clearance, in px; 0 where the label is hidden. */
    gaps: number[];
  };
  hover: Spring & { id: string | null; target: number };
  ink: Ink | null;
  inkDirty: boolean;
  batch: DotBatch | null;
  sparks: Sparks;
  fxDirty: boolean;
  fxX: number;
  fxY: number;
  scratch: Projected;
}

function createFlight(): Flight {
  return { fromU: 0, fromV: 0, toU: 0, toV: 0, bucket: 0, written: "" };
}

function createEngine(): Engine {
  return {
    size: 0,
    radius: 0,
    lattice: null,
    count: 0,
    fromU: new Float32Array(0),
    fromV: new Float32Array(0),
    toU: new Float32Array(0),
    toV: new Float32Array(0),
    fromA: new Float32Array(0),
    toA: new Float32Array(0),
    bucket: new Uint8Array(0),
    center: { lat: 0, lon: 0 },
    centerKey: "",
    basis: null,
    items: [],
    placesKey: "",
    places: new Map(),
    point: createFlight(),
    pointFrom: null,
    buckets: Array.from({ length: BUCKETS }, () => ({ position: 1, velocity: 0, start: 0 })),
    moving: false,
    ringLead: RING_FADE,
    moveStart: 0,
    ping: -1,
    reveal: { state: "pending", start: 0 },
    rings: { phase: "hidden", alpha: 0, fadeFrom: 0, fadeStart: 0, drawStart: 0, drawn: null, latest: null, gaps: [] },
    hover: { id: null, target: 0, position: 0, velocity: 0 },
    ink: null,
    inkDirty: true,
    batch: null,
    sparks: new Sparks(),
    fxDirty: false,
    fxX: 0,
    fxY: 0,
    scratch: { u: 0, v: 0, angle: 0 },
  };
}

function inkOf(palette: Palette<keyof typeof MAP_COLORS>): Ink {
  // the strong land grey of the other Location components: the foreground 45% of the way to the card
  return { dot: mixRgb(palette.foreground, palette.card, 0.45), soft: palette.soft, accent: palette.accent, glint: palette.glint };
}

/** Tone 0 is the land grey, 0.5 the soft accent dots tint toward in flight, 1 the accent of pings and routes. */
const rampOf = (ink: Ink): RGB[] => [ink.dot, ink.soft, ink.accent];

/** A new stage size: a new radius, and a new lattice when the dot spacing changes. */
function resizeEngine(engine: Engine, width: number) {
  engine.size = width;
  engine.radius = Math.max(1, (width - 2 * GUTTER) / 2);
  const spacing = Math.max(1.2, Math.round(((180 * DOT_PITCH) / engine.radius) * 10) / 10);
  const lattice = sphereLattice({ spacingDeg: spacing, landOnly: true });
  if (lattice === engine.lattice) return;
  engine.lattice = lattice;
  engine.count = lattice.count;
  engine.fromU = new Float32Array(lattice.count);
  engine.fromV = new Float32Array(lattice.count);
  engine.toU = new Float32Array(lattice.count);
  engine.toV = new Float32Array(lattice.count);
  engine.fromA = new Float32Array(lattice.count);
  engine.toA = new Float32Array(lattice.count);
  engine.bucket = new Uint8Array(lattice.count);
  // a new lattice lands in place; a flight in progress finishes at once
  if (engine.basis) retarget(engine, engine.center, false, nowSeconds());
}

function flightPosition(flight: Flight, engine: Engine, out: Projected) {
  const progress = engine.moving ? engine.buckets[flight.bucket].position : 1;
  out.u = flight.fromU + (flight.toU - flight.fromU) * progress;
  out.v = flight.fromV + (flight.toV - flight.fromV) * progress;
  return out;
}

/**
 * Points every dot and place at the projection about `center`. With `animate`, each starts from where it is now
 * (mid-flight too) and waits for its bucket; without, everything lands at once.
 */
function retarget(engine: Engine, center: LatLon, animate: boolean, now: number) {
  const previous = engine.basis;
  const basis = basisOf(center);
  const scratch = engine.scratch;
  const lattice = engine.lattice;
  const { fromU, fromV, toU, toV, fromA, toA, bucket } = engine;

  if (lattice) {
    const { xyz, jitter } = lattice;
    for (let i = 0; i < engine.count; i++) {
      const progress = engine.moving ? engine.buckets[bucket[i]].position : 1;
      const u = fromU[i] + (toU[i] - fromU[i]) * progress;
      const v = fromV[i] + (toV[i] - fromV[i]) * progress;
      const alpha = fromA[i] + (toA[i] - fromA[i]) * clamp(progress, 0, 1);
      projectVector(basis, xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2], scratch);
      fromU[i] = animate ? u : scratch.u;
      fromV[i] = animate ? v : scratch.v;
      fromA[i] = animate ? alpha : alphaAt(scratch.angle);
      toU[i] = scratch.u;
      toV[i] = scratch.v;
      toA[i] = alphaAt(scratch.angle);
      bucket[i] = bucketOf(scratch.angle, jitter[i]);
    }
  }

  const live = new Set<string>();
  for (const place of engine.items) {
    live.add(place.id);
    let flight = engine.places.get(place.id);
    const known = flight !== undefined;
    flight ??= createFlight();
    flightPosition(flight, engine, scratch);
    const u = scratch.u;
    const v = scratch.v;
    projectLatLon(basis, place.lat, place.lon, scratch);
    flight.fromU = animate && known ? u : scratch.u;
    flight.fromV = animate && known ? v : scratch.v;
    flight.toU = scratch.u;
    flight.toV = scratch.v;
    flight.bucket = bucketOf(scratch.angle, placeJitter(place.id));
    engine.places.set(place.id, flight);
  }
  for (const id of engine.places.keys()) if (!live.has(id)) engine.places.delete(id);

  // a free centre's crosshair flies in from the click, or from where the point was on the old map
  const from = engine.pointFrom ?? (previous ? projectLatLon(previous, center.lat, center.lon, scratch) : { u: 0, v: 0 });
  engine.point.fromU = animate ? from.u : 0;
  engine.point.fromV = animate ? from.v : 0;
  engine.point.toU = 0;
  engine.point.toV = 0;
  engine.point.bucket = 0;
  engine.pointFrom = null;

  // the rings fade before the move, unless they are already gone (a re-centre during a flight)
  const lead = engine.rings.phase === "hidden" ? 0.04 : RING_FADE;
  engine.ringLead = lead;
  engine.buckets.forEach((entry, b) => {
    entry.position = animate ? 0 : 1;
    entry.velocity = 0;
    entry.start = now + lead + b * BUCKET_STEP;
  });
  engine.moving = animate;
  if (animate) engine.moveStart = now;
  engine.basis = basis;
  engine.center = center;
  if (animate) {
    fadeRings(engine, now);
    engine.ping = now + lead + PING_DELAY;
  }
}

function finishMove(engine: Engine) {
  engine.moving = false;
  engine.fromU.set(engine.toU);
  engine.fromV.set(engine.toV);
  engine.fromA.set(engine.toA);
  for (const flight of engine.places.values()) {
    flight.fromU = flight.toU;
    flight.fromV = flight.toV;
  }
  engine.point.fromU = 0;
  engine.point.fromV = 0;
}

function finishReveal(engine: Engine) {
  engine.reveal.state = "done";
}

function fadeRings(engine: Engine, now: number) {
  const rings = engine.rings;
  if (rings.phase === "hidden" || rings.phase === "fading") return;
  rings.fadeFrom = rings.phase === "shown" ? 1 : rings.alpha || 1;
  rings.fadeStart = now;
  rings.phase = "fading";
}

/** New ring geometry: swapped in at once with reduced motion or before anything is drawn, else after a fade. */
function setRings(engine: Engine, set: RingSet, now: number, reduced: boolean) {
  const rings = engine.rings;
  rings.latest = set;
  if (rings.drawn === null || rings.phase === "hidden") {
    rings.drawn = set;
    return;
  }
  if (reduced) {
    rings.drawn = set;
    rings.phase = "shown";
    return;
  }
  fadeRings(engine, now);
}

/** Advances the ring fade and draw-on. Returns whether they are still changing. */
function stepRings(engine: Engine, time: number, reduced: boolean) {
  const rings = engine.rings;
  const ready = engine.reveal.state === "done" && (!engine.moving || nearlySettled(engine));
  if (reduced) {
    rings.drawn = rings.latest;
    rings.phase = engine.reveal.state === "done" ? "shown" : "hidden";
    rings.alpha = rings.phase === "shown" ? 1 : 0;
    return false;
  }
  if (rings.phase === "fading") {
    rings.alpha = rings.fadeFrom * (1 - (time - rings.fadeStart) / RING_FADE);
    if (rings.alpha > 0) return true;
    rings.alpha = 0;
    rings.phase = "hidden";
    rings.drawn = rings.latest;
  }
  if (rings.phase === "hidden") {
    if (!ready || !rings.drawn) return engine.moving;
    rings.phase = "drawing";
    rings.drawStart = time;
  }
  if (rings.phase === "drawing") {
    rings.alpha = 1;
    const count = rings.drawn?.units.length ?? 0;
    if (time - rings.drawStart < RING_DRAW + Math.max(0, count - 1) * RING_STAGGER) return true;
    rings.phase = "shown";
  }
  return false;
}

/** The ring draw-on may start before the last dots have quite settled. */
function nearlySettled(engine: Engine) {
  return engine.buckets.every((bucket) => bucket.position >= 0.9);
}

/** The animation clock in seconds: the timeline requestAnimationFrame reports. */
const nowSeconds = () => performance.now() / 1000;

/**
 * Writes each place's offset from its rendered target, so places ride the same delay springs as the land dots. Labels
 * fade out as a move starts and back in as their place lands, so they never pile up in flight.
 */
function writePlaces(
  engine: Engine,
  elements: ReadonlyMap<string, HTMLElement>,
  labels: ReadonlyMap<string, HTMLElement>,
  point: HTMLElement | null,
  time: number,
) {
  const leaving = engine.moving ? 1 - clamp((time - engine.moveStart) / LABEL_FADE, 0, 1) : 1;
  for (const [id, flight] of engine.places) {
    writeOffset(elements.get(id), flight, engine, engine.radius);
    const label = labels.get(id);
    if (!label) continue;
    let opacity = 1;
    if (engine.moving) {
      const bucket = engine.buckets[flight.bucket];
      const landing = time >= bucket.start ? smoothstep(0.8, 1, bucket.position) : 0;
      opacity = Math.max(leaving, landing);
    }
    const text = opacity >= 0.995 ? "1" : opacity.toFixed(2);
    if (label.style.getPropertyValue("--flight") !== text) label.style.setProperty("--flight", text);
  }
  writeOffset(point, engine.point, engine, engine.radius);
}

/** Draw-on progress of ring `k`, 0 to 1, eased. */
function ringSweep(engine: Engine, k: number, time: number) {
  const rings = engine.rings;
  if (rings.phase !== "drawing") return 1;
  return RING_EASE(clamp((time - rings.drawStart - k * RING_STAGGER) / RING_DRAW, 0, 1));
}

/** Angle of `angle` along the clockwise sweep from north, in [0, 2π). */
const sweepAngle = (angle: number) => ((angle % TAU) + TAU) % TAU;

/** Ring labels fade with their rings and appear as the draw-on sweep passes them. */
function writeRingLabels(engine: Engine, elements: readonly (HTMLElement | null)[], time: number) {
  const rings = engine.rings;
  const set = rings.drawn;
  const same = set !== null && set.key === rings.latest?.key;
  const at = set ? sweepAngle(set.angle) : 0;
  elements.forEach((element, k) => {
    if (!element) return;
    let opacity = 0;
    if (same) {
      if (rings.phase === "shown") opacity = 1;
      else if (rings.phase === "fading") opacity = rings.alpha;
      else if (rings.phase === "drawing") opacity = clamp((ringSweep(engine, k, time) * TAU - at + 0.35) / 0.7, 0, 1);
    }
    const text = opacity >= 1 ? "1" : opacity <= 0 ? "0" : opacity.toFixed(2);
    if (element.style.opacity !== text) element.style.opacity = text;
  });
}

function writeOffset(element: HTMLElement | null | undefined, flight: Flight, engine: Engine, radius: number) {
  if (!element) return;
  const progress = engine.moving ? engine.buckets[flight.bucket].position : 1;
  const dx = (flight.fromU - flight.toU) * (1 - progress) * radius;
  const dy = (flight.fromV - flight.toV) * (1 - progress) * radius;
  const transform = Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01 ? "" : `translate3d(${dx.toFixed(2)}px,${dy.toFixed(2)}px,0)`;
  if (flight.written === transform && element.style.transform === transform) return;
  element.style.transform = transform;
  flight.written = transform;
}

/* Drawing ------------------------------------------------------------------------------------------------ */

const pingRadii = new Float32Array(2);
const pingAmps = new Float32Array(2);

/**
 * Draws the rings, the land dots (in flight, revealed, pinged) and the pointed place's route and equal-distance
 * circle, through one DotBatch. Returns whether the ping is still running.
 */
function drawMap(engine: Engine, context: CanvasRenderingContext2D, size: number, time: number, front: number, reduced: boolean) {
  const batch = engine.batch;
  context.clearRect(0, 0, size, size);
  if (!batch || front < 0) return false;
  const radius = engine.radius;
  const cx = size / 2;
  const cy = size / 2;

  drawRings(engine, batch, cx, cy, radius, time);

  // the ping: two uneven rings of light leave the new centre once its dots have arrived
  let pinging = false;
  let pings = 0;
  const pingAge = time - engine.ping;
  if (!reduced && engine.ping > 0 && pingAge < PING_SECONDS + PING_GAP) {
    pinging = true;
    for (let j = 0; j < 2; j++) {
      const t = (pingAge - j * PING_GAP) / PING_SECONDS;
      if (t <= 0 || t >= 1) continue;
      pingRadii[pings] = easeOutCubic(t) * PING_REACH * radius;
      pingAmps[pings] = Math.pow(1 - t, 1.4) * (j === 0 ? 1 : 0.7);
      pings++;
    }
  }

  const lattice = engine.lattice;
  if (lattice) {
    const { fromU, fromV, toU, toV, fromA, toA, bucket, buckets, moving } = engine;
    const jitter = lattice.jitter;
    const revealing = Number.isFinite(front);
    // the old map dims while it waits for the wave, so the new one reads as it builds outward
    const waiting = moving ? 1 - WAIT_DIM * clamp((time - engine.moveStart) / RING_FADE, 0, 1) : 1;
    for (let i = 0; i < engine.count; i++) {
      const progress = moving ? buckets[bucket[i]].position : 1;
      const settled = clamp(progress, 0, 1);
      const departure = fromA[i] * waiting;
      let alpha = departure + (toA[i] - departure) * settled;
      if (alpha < 0.02) continue;
      const u = fromU[i] + (toU[i] - fromU[i]) * progress;
      const v = fromV[i] + (toV[i] - fromV[i]) * progress;
      const x = cx + u * radius;
      const y = cy + v * radius;
      // in flight, dots tint toward the soft accent and back
      let tone = moving && settled > 0 && settled < 1 ? 0.25 * Math.sin(Math.PI * settled) : 0;

      if (revealing) {
        const threshold = Math.hypot(toU[i], toV[i]) * 0.82 + jitter[i] * 0.18;
        const lead = front - threshold;
        if (lead <= 0) continue;
        alpha *= Math.min(1, lead / REVEAL_BAND);
        const glow = Math.exp(-(lead / 0.05) * (lead / 0.05));
        tone = Math.max(tone, glow * 0.9);
        alpha = Math.min(1, alpha + glow * 0.45);
      }

      if (pings) {
        const distance = Math.hypot(x - cx, y - cy);
        let light = 0;
        for (let j = 0; j < pings; j++) light += ringFront(distance, pingRadii[j], PING_BAND, jitter[i], 5) * pingAmps[j];
        if (light > 0.02) {
          light = Math.min(1, light);
          tone = Math.max(tone, light);
          alpha = Math.min(1, alpha + light * 0.55);
        }
      }
      batch.add(x, y, DOT_SIZE, tone, alpha);
    }
  }

  // the ping rings also run over the sea, as sparse dotted circles, so a coastal centre still sends them out
  for (let j = 0; j < pings; j++) {
    const r = pingRadii[j];
    if (r < 6) continue;
    const count = Math.round((TAU * r) / DOTTED_SPACING);
    for (let k = 0; k < count; k++) {
      const phi = (k / count) * TAU;
      const sparkle = 0.45 + 0.55 * hash(k * 7.13 + j * 31.7);
      batch.add(cx + r * Math.sin(phi), cy - r * Math.cos(phi), DOT_SIZE, 1, pingAmps[j] * 0.6 * sparkle);
    }
  }

  drawPointed(engine, batch, cx, cy, radius);
  batch.flush(context);
  return pinging;
}

/** Dotted rings, a dot every 4 px, broken where their labels sit; drawn on clockwise from the top after a move. */
function drawRings(engine: Engine, batch: DotBatch, cx: number, cy: number, radius: number, time: number) {
  const rings = engine.rings;
  const set = rings.drawn;
  if (!set || rings.phase === "hidden") return;
  const withGaps = set.key === rings.latest?.key;
  const at = sweepAngle(set.angle);
  let last = -Infinity;
  set.units.forEach((unitRadius, k) => {
    const r = unitRadius * radius;
    // rings closer than 5 px merge into a grey band; skip them
    if (r - last < 5) return;
    last = r;
    const sweep = ringSweep(engine, k, time);
    if (sweep <= 0) return;
    const alphaScale = rings.phase === "fading" ? rings.alpha : 1;
    const gap = withGaps && rings.gaps[k] ? rings.gaps[k] / r : 0;
    const count = Math.max(12, Math.round((TAU * r) / DOTTED_SPACING));
    const head = sweep * TAU;
    for (let j = 0; j < count; j++) {
      const phi = (j / count) * TAU;
      if (phi > head) break;
      if (gap) {
        const offset = Math.abs(phi - at);
        if (Math.min(offset, TAU - offset) < gap) continue;
      }
      // the head of the sweep glows toward the accent
      const glow = sweep < 1 ? Math.exp(-(head - phi) / 0.35) : 0;
      batch.add(cx + r * Math.sin(phi), cy - r * Math.cos(phi), DOT_SIZE, glow * 0.8, (RING_ALPHA + glow * 0.45) * alphaScale);
    }
  });
}

/** The pointed place's great-circle route (a straight line on this map) and the circle of places just as far. */
function drawPointed(engine: Engine, batch: DotBatch, cx: number, cy: number, radius: number) {
  const hover = engine.hover;
  const flight = hover.id ? engine.places.get(hover.id) : undefined;
  if (!flight || hover.position <= 0.005) return;
  const point = flightPosition(flight, engine, engine.scratch);
  const dx = point.u * radius;
  const dy = point.v * radius;
  const length = Math.hypot(dx, dy);
  if (length < 12) return;
  const growth = clamp(hover.position, 0, 1.15);
  const reach = Math.min(length - 6, growth * length);
  for (let s = 8; s <= reach; s += DOTTED_SPACING) {
    batch.add(cx + (dx * s) / length, cy + (dy * s) / length, DOT_SIZE, 1, 0.95 * Math.min(1, hover.position * 1.5));
  }
  // the circle opens both ways from the place; dots sit at fixed angles so they do not crawl as it grows
  const start = Math.atan2(dx, -dy);
  const span = Math.min(1, growth) * Math.PI;
  const count = Math.max(12, Math.round((TAU * length) / DOTTED_SPACING));
  for (let j = 0; j < count; j++) {
    const phi = (j / count) * TAU;
    let offset = Math.abs(phi - start) % TAU;
    if (offset > Math.PI) offset = TAU - offset;
    if (offset > span || offset < 7 / length) continue;
    batch.add(cx + length * Math.sin(phi), cy - length * Math.cos(phi), DOT_SIZE, 0.78, 0.6 * Math.min(1, hover.position * 1.5));
  }
}
