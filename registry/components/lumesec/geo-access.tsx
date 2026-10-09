"use client";

import * as React from "react";

import { fillSquare, localPoint, snapCenter, snapSize, useCanvas, type CanvasSurface } from "@/lib/lumesec/canvas";
import { usePalette } from "@/lib/lumesec/color";
import {
  boundsOf,
  checkTravel,
  createDotBatch,
  createProjection,
  createScreenPoint,
  cubicBezier,
  distanceKm,
  flatPaths,
  forEachDot,
  GEO_TOKENS,
  geoInk,
  isValidLatLon,
  mapLattice,
  placeLabels,
  pointAtDistance,
  ringFront,
  wrapLongitude,
  type ArcLengthTable,
  type DotBatch,
  type DotLattice,
  type GeoBounds,
  type GeoInk,
  type LabelAnchor,
  type MapProjection,
} from "@/lib/lumesec/geo";
import { countryAt } from "@/lib/lumesec/geo-countries";
import { formatDistance, formatLatLon, formatSpeed, formatZonedTime, toEpochMs } from "@/lib/lumesec/geo-data";
import { clamp, easeOutCubic, hash, mixRgb, rgba, smoothstep, type RGB } from "@/lib/lumesec/math";
import {
  prefersReducedMotion,
  springStep,
  useAnimationLoop,
  useLazyRef,
  useReducedMotion,
  type Spring,
} from "@/lib/lumesec/motion";
import { RollText } from "@/lib/lumesec/roll-text";
import { Sparks, type SparkOptions } from "@/lib/lumesec/sparks";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** One sign-in of an account: when it happened, where (located from the IP address) and on what. */
export interface SignIn {
  /** Unique id. `value`, `onValueChange` and `onFlag` refer to sign-ins by it. */
  readonly id: string;
  /** When it happened: epoch ms, an ISO 8601 string (read as UTC when it has no offset) or a Date. */
  readonly time: number | string | Date;
  /** Latitude in degrees, −90 to 90. */
  readonly lat: number;
  /** Longitude in degrees. */
  readonly lon: number;
  /** Place shown in the list and on the map. Without it, the country at the point, or the coordinates. */
  readonly city?: string;
  /** Device or client, such as `Laptop`. */
  readonly device?: string;
  /** IP address, shown in mono after the device. */
  readonly address?: string;
}

/** A move between two consecutive sign-ins that would have needed more than `maxKmh`. */
export interface TravelFlag {
  /** Id of the earlier sign-in. */
  readonly from: string;
  /** Id of the later sign-in. */
  readonly to: string;
  /** Great-circle distance in km. */
  readonly km: number;
  /** Time between the two sign-ins in hours; 0 when they share a timestamp. */
  readonly hours: number;
  /** Speed the move would have needed in km/h; Infinity when no time passed. */
  readonly kmh: number;
}

/** Imperative actions, exposed through `ref`. */
export interface GeoAccessHandle {
  /** Plays the legs again in order from the first sign-in. Does nothing with reduced motion or `replay={false}`. */
  replay(): void;
}

/** Props of `GeoAccess`. Other `div` props go to the root. */
export interface GeoAccessProps extends Omit<React.ComponentProps<"div">, "ref" | "defaultValue"> {
  /**
   * The account's sign-ins, in any order (they are sorted by time). Without it the component shows six demo
   * sign-ins. An empty array shows an empty list. Entries with an invalid time or position are skipped.
   */
  signIns?: readonly SignIn[];
  /** Speeds above this, in km/h, are impossible. */
  maxKmh?: number;
  /** Moves shorter than this, in km, are never flagged: IP locations can be off by a few hundred km. */
  minKm?: number;
  /** Selected sign-in id (controlled). Use with `onValueChange`. */
  value?: string | null;
  /** Selected sign-in id when uncontrolled. */
  defaultValue?: string | null;
  /** Called when a sign-in is selected or the selection is cleared. */
  onValueChange?: (value: string | null) => void;
  /** Called once per impossible leg (keyed by its two ids) when it is first found in the data. */
  onFlag?: (flag: TravelFlag) => void;
  /** Plays the legs in order on first view and when the data changes. */
  replay?: boolean;
  /** Unit of distances and speeds: `km` with km/h, or `mi` with mph. `maxKmh` and `minKm` stay in km. */
  unit?: "km" | "mi";
  /** IANA time zone of the times in the list. */
  timeZone?: string;
  /** BCP 47 locale for numbers and times. Default `en-US`. */
  locale?: string;
  /** Exposes `replay()`. */
  ref?: React.Ref<GeoAccessHandle>;
}

/**
 * An account's sign-ins in order, joined by dotted legs on a map fitted to them, with a timeline that lists the time
 * and distance between each pair. Every leg is checked against travel: a move faster than `maxKmh` over more than
 * `minKm` is impossible, and its line tears. It draws to its midpoint, splits, the two halves spring apart into
 * dashed red, red sparks crackle in the gap and a chip shows the speed the move would have needed.
 *
 * On first view the legs replay in order, each point pinging the land lattice as it is reached while its row lights
 * up. Selecting a sign-in (row or marker) brings its two legs forward and dims the rest.
 *
 * @example
 * <GeoAccess signIns={signIns} onFlag={(flag) => review(flag.from, flag.to)} />
 */
export function GeoAccess({
  signIns,
  maxKmh = 1000,
  minKm = 500,
  value,
  defaultValue = null,
  onValueChange,
  onFlag,
  replay = true,
  unit = "km",
  timeZone = "UTC",
  locale,
  ref,
  className,
  ...props
}: GeoAccessProps) {
  const reducedMotion = useReducedMotion();
  const animated = replay && !reducedMotion;
  const speedLimit = Number.isFinite(maxKmh) && maxKmh > 0 ? maxKmh : 1000;
  const distanceFloor = Number.isFinite(minKm) && minKm >= 0 ? minKm : 500;

  const built = React.useMemo(
    () => buildModel(signIns ?? DEMO_SIGN_INS, speedLimit, distanceFloor),
    [signIns, speedLimit, distanceFloor],
  );
  // A new array with the same sign-ins keeps the model, so nothing replays or re-fits.
  const [stable, setStable] = React.useState(built);
  if (stable.key !== built.key) setStable(built);
  const model = stable.key === built.key ? stable : built;
  const nominal = React.useMemo(() => nominalLayout(model), [model]);

  const [selected, setSelected] = useControllableState<string | null>({ value, defaultValue, onChange: onValueChange });
  const selectedIndex = selected === null ? -1 : model.entries.findIndex((entry) => entry.id === selected);
  const selectedEntry = selectedIndex >= 0 ? model.entries[selectedIndex] : null;

  const [progress, setProgress] = React.useState<Progress>(EMPTY_PROGRESS);
  const [hover, setHover] = React.useState<Hover | null>(null);
  const [labels, setLabels] = React.useState<LabelState | null>(null);
  const [focusId, setFocusId] = React.useState<string | null>(null);

  const baseId = React.useId();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLOListElement>(null);
  const baseRef = React.useRef<HTMLCanvasElement>(null);
  const legsRef = React.useRef<HTMLCanvasElement>(null);
  const effectsRef = React.useRef<HTMLCanvasElement>(null);
  const liveRef = React.useRef<HTMLDivElement>(null);
  const rowRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const chipRefs = React.useRef(new Map<string, HTMLSpanElement>());
  const labelRefs = React.useRef<(HTMLSpanElement | null)[]>([]);
  /** The map engine, created on first use in an effect or handler, never during render or on the server. */
  const engineRef = useLazyRef(() => new TravelMap());
  const modelRef = React.useRef(model);
  const nominalRef = React.useRef(nominal);
  const firedRef = React.useRef(new Set<string>());
  const onFlagRef = React.useRef(onFlag);

  /** Where the effects layer sits relative to the map, in CSS px (offsets ignore the gallery's zoom). */
  function measureEffects() {
    const layer = effectsRef.current;
    if (layer) engineRef.current.setEffectsOffset(-layer.offsetLeft, -layer.offsetTop);
  }

  /** Places the place names around their markers, avoiding each other, in px of the current map box. */
  function placeMapLabels(current: Model, layout: NominalLayout) {
    const box = boxRef.current;
    if (!box) return;
    const width = box.offsetWidth;
    const height = box.offsetHeight;
    if (!width || !height) return;
    const anchors: LabelAnchor[] = current.places.map((place, i) => ({
      x: ((layout.places[i]?.x ?? 0) / 100) * width,
      y: ((layout.places[i]?.y ?? 0) / 100) * height,
      // a count badge sits right of the dot: the label box reserves its width
      width: (labelRefs.current[i]?.offsetWidth ?? 0) + badgeRoom(place),
      height: LABEL_HEIGHT,
      priority: (place.flagged ? 100 : 0) + place.members.length,
      gap: LABEL_GAP,
    }));
    const placements = placeLabels(anchors, width, height).map(({ visible, x, y }, i) => ({
      visible,
      x: x + badgeRoom(current.places[i]),
      y,
    }));
    setLabels({ key: current.key, placements });
  }

  const loop = useAnimationLoop(rootRef, step);
  const palette = usePalette(rootRef, GEO_TOKENS, applyTheme);
  const base = useCanvas(
    baseRef,
    (surface) => {
      engineRef.current.layout(surface.width, surface.height, surface.dpr);
      measureEffects();
      placeMapLabels(modelRef.current, nominalRef.current);
      loop.kick();
    },
    MAP_CANVAS,
  );
  const legs = useCanvas(
    legsRef,
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
    return engineRef.current.step(base.current, legs.current, effects.current, delta);
  }

  function applyTheme() {
    const colors = palette.current;
    if (!colors) return;
    engineRef.current.setInk(geoInk(colors));
    loop.kick();
  }

  React.useLayoutEffect(() => {
    modelRef.current = model;
    nominalRef.current = nominal;
    onFlagRef.current = onFlag;
  });

  // The replay reports what it reached; rows light up and chips pop in sync with the map.
  React.useEffect(() => {
    const engine = engineRef.current;
    engine.onProgress = setProgress;
    engine.onReach = (entry) => {
      const row = rowRefs.current.get(entry.id);
      if (!row || typeof row.animate !== "function" || prefersReducedMotion()) return;
      row.animate(ROW_FLASH_KEYFRAMES, { duration: 1100, easing: "cubic-bezier(.2,.8,.2,1)" });
      const dot = row.querySelector("[data-rail-dot]");
      if (dot instanceof HTMLElement) dot.animate(RAIL_DOT_KEYFRAMES, { duration: 520, easing: "cubic-bezier(.2,1.4,.4,1)" });
    };
    engine.onTear = (leg) => {
      const chip = chipRefs.current.get(leg.key);
      if (chip && typeof chip.animate === "function" && !prefersReducedMotion()) chip.animate(POP_KEYFRAMES, POP_TIMING);
    };
  }, [engineRef]);

  React.useEffect(() => {
    engineRef.current.setAnimated(animated);
    loop.kick();
  }, [animated, engineRef, loop]);

  React.useEffect(() => {
    engineRef.current.setModel(model);
    loop.kick();
  }, [model, engineRef, loop]);

  React.useEffect(() => {
    engineRef.current.setSelection(selectedIndex);
    loop.kick();
  }, [selectedIndex, model, engineRef, loop]);

  React.useLayoutEffect(() => {
    // label widths depend on the names; a new box size is handled by the canvas resize
    placeMapLabels(model, nominal);
  }, [model, nominal]);

  // Each impossible leg is reported and announced once, when it first appears in the data.
  React.useEffect(() => {
    const fired = firedRef.current;
    const lines: string[] = [];
    for (const leg of model.legs) {
      if (!leg.flagged || fired.has(leg.key)) continue;
      fired.add(leg.key);
      onFlagRef.current?.({ from: leg.from.id, to: leg.to.id, km: leg.km, hours: leg.hours, kmh: leg.kmh });
      lines.push(
        `Impossible travel: ${leg.from.name} to ${leg.to.name}, ${formatDistance(leg.km, unit, locale)} in ${spokenDuration(leg.elapsed)}.`,
      );
    }
    if (lines.length > 0 && liveRef.current) liveRef.current.textContent = lines.join(" ");
  }, [model, unit, locale]);

  // Skipped entries are said once per data set while developing.
  const skippedKey = model.skipped.join(", ");
  const warned = React.useRef("");
  React.useEffect(() => {
    if (!skippedKey || warned.current === skippedKey || process.env.NODE_ENV === "production") return;
    warned.current = skippedKey;
    console.warn(`GeoAccess: skipped sign-ins with a missing or repeated id or an invalid time or position: ${skippedKey}.`);
  }, [skippedKey]);

  React.useImperativeHandle(
    ref,
    () => ({
      replay() {
        engineRef.current.replay();
        loop.kick();
      },
    }),
    [engineRef, loop],
  );

  const entries = model.entries;
  const rovingId =
    focusId !== null && entries.some((entry) => entry.id === focusId) ? focusId : (selectedEntry?.id ?? entries[0]?.id ?? null);
  const isReached = (id: string) => !animated || progress.reached.has(id);
  const isTorn = (key: string) => !animated || progress.torn.has(key);

  // A marker clicked repeatedly steps through the sign-ins at that place, then clears.
  function selectPlace(placeIndex: number) {
    const members = model.places[placeIndex]?.members ?? [];
    if (members.length === 0) return;
    const at = members.indexOf(selectedIndex);
    const next = at < 0 ? members[0] : at + 1 < members.length ? members[at + 1] : -1;
    const id = next >= 0 ? entries[next].id : null;
    setSelected(id);
    if (id !== null) {
      setFocusId(id);
      revealRow(id);
    }
  }

  /** Scrolls the list (never the page) so a row is visible. The list is the rows' offset parent. */
  function revealRow(id: string) {
    const list = listRef.current;
    const row = rowRefs.current.get(id);
    if (!list || !row) return;
    const top = row.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top - 4;
    else if (top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + row.offsetHeight - list.clientHeight + 4;
  }

  /** The visible place under the pointer, within the marker's 24 px, or −1. */
  function placeAt(event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) {
    const box = event.currentTarget;
    // the gallery may zoom the demo: localPoint converts to CSS px of the map
    const { x, y } = localPoint(box, event.clientX, event.clientY);
    let best = -1;
    let bestDistance = HIT_RADIUS * HIT_RADIUS;
    model.places.forEach((place, i) => {
      if (!place.members.some((member) => isReached(entries[member].id))) return;
      const point = nominal.places[i];
      const dx = (point.x / 100) * box.offsetWidth - x;
      const dy = (point.y / 100) * box.offsetHeight - y;
      const distance = dx * dx + dy * dy;
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    return best;
  }

  function handleMapPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") return;
    const place = placeAt(event);
    setHover((current) => {
      if (place < 0) return current?.source === "map" ? null : current;
      return current?.place === place && current.source === "map" ? current : { place, source: "map" };
    });
  }

  function handleMapClick(event: React.MouseEvent<HTMLDivElement>) {
    const place = placeAt(event);
    if (place >= 0) selectPlace(place);
    else setSelected(null);
  }

  function handleListKeyDown(event: React.KeyboardEvent<HTMLOListElement>) {
    if (event.key === "Escape") {
      if (selected === null) return;
      event.preventDefault();
      setSelected(null);
      return;
    }
    const index = entries.findIndex((entry) => entry.id === rovingId);
    const last = entries.length - 1;
    const target =
      event.key === "ArrowDown"
        ? Math.min(last, index + 1)
        : event.key === "ArrowUp"
          ? Math.max(0, index - 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1;
    if (target < 0 || index < 0) return;
    event.preventDefault();
    const id = entries[target].id;
    setFocusId(id);
    rowRefs.current.get(id)?.focus();
  }

  const selectedPlace = selectedEntry?.place ?? -1;
  const nearPlaces = new Set<number>();
  if (selectedEntry) {
    if (selectedIndex > 0) nearPlaces.add(entries[selectedIndex - 1].place);
    if (selectedIndex < entries.length - 1) nearPlaces.add(entries[selectedIndex + 1].place);
  }
  const hoverPlace = hover?.place ?? -1;
  const speedUnit = unit === "mi" ? "mph" : "km/h";
  const incoming = selectedIndex > 0 ? model.legs[selectedIndex - 1] : null;

  return (
    <div
      ref={rootRef}
      data-slot="geo-access"
      role="group"
      aria-label="Sign-in travel"
      className={cn(
        "@container w-full max-w-[660px] rounded-[14px] border border-border bg-card p-3 text-card-foreground shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)] [-webkit-tap-highlight-color:transparent]",
        className,
      )}
      {...props}
    >
      <div className="grid gap-3 @min-[560px]:grid-cols-[minmax(0,1fr)_220px] @min-[560px]:gap-0">
        <div className="grid content-start gap-2 @min-[560px]:pr-3">
          <div
            ref={boxRef}
            aria-hidden="true"
            data-hover={hover?.source === "map" ? "" : undefined}
            className="relative w-full select-none data-[hover]:cursor-pointer"
            style={{ aspectRatio: MAP_ASPECT }}
            onPointerMove={handleMapPointerMove}
            onPointerLeave={() => setHover((current) => (current?.source === "map" ? null : current))}
            onClick={handleMapClick}
          >
            <div className="absolute inset-0 overflow-hidden rounded-[10px] bg-muted/40">
              <canvas ref={baseRef} className="absolute inset-0 block size-full" />
              <canvas ref={legsRef} className="absolute inset-0 block size-full" />
            </div>
            <span className="pointer-events-none absolute inset-0 rounded-[10px] border border-border/70" />
            {model.places.map((place, i) => {
              const reachedCount = place.members.reduce((count, member) => count + (isReached(entries[member].id) ? 1 : 0), 0);
              const placement = labels?.key === model.key ? labels.placements[i] : undefined;
              const point = nominal.places[i];
              return (
                <React.Fragment key={place.index}>
                  <span
                    ref={(node) => {
                      labelRefs.current[i] = node;
                    }}
                    data-strong={selectedPlace === i || hoverPlace === i ? "" : undefined}
                    className={cn(
                      "pointer-events-none absolute top-0 left-0 z-[1] text-[11px] leading-[14px] whitespace-nowrap text-muted-foreground transition-[opacity,color] duration-300 [text-shadow:0_0_2px_var(--card),0_0_4px_var(--card),0_0_6px_var(--card)] data-[strong]:text-foreground motion-reduce:transition-none",
                      (!placement?.visible || reachedCount === 0) && "opacity-0",
                      selectedPlace >= 0 && selectedPlace !== i && !nearPlaces.has(i) && "opacity-40",
                    )}
                    style={{ transform: `translate(${placement?.x ?? 0}px, ${placement?.y ?? 0}px)` }}
                  >
                    {place.name}
                  </span>
                  <PlaceMarker
                    x={point.x}
                    y={point.y}
                    visible={reachedCount > 0}
                    count={animated ? reachedCount : place.members.length}
                    flagged={place.flagged && place.members.some((member) => isTornInto(model, member, isTorn))}
                    selected={selectedPlace === i}
                    dimmed={selectedPlace >= 0 && selectedPlace !== i && !nearPlaces.has(i)}
                    hovered={hoverPlace === i}
                    animate={animated}
                  />
                </React.Fragment>
              );
            })}
            {model.legs.map((leg) => {
              const anchor = nominal.chips.get(leg.key);
              if (!anchor) return null;
              const dimmed = selectedIndex >= 0 && leg.index !== selectedIndex - 1 && leg.index !== selectedIndex;
              return (
                <TearChip
                  key={leg.key}
                  anchor={anchor}
                  visible={isTorn(leg.key)}
                  dimmed={dimmed}
                  animate={animated}
                  speed={Number.isFinite(leg.kmh) ? formatSpeed(leg.kmh, speedUnit, locale) : "No time"}
                  elapsed={shortDuration(leg.elapsed)}
                />
              );
            })}
            <canvas
              ref={effectsRef}
              className="pointer-events-none absolute -top-10 -left-4 z-[3] block h-[calc(100%+80px)] w-[calc(100%+32px)] @min-[560px]:-left-10 @min-[560px]:w-[calc(100%+80px)]"
            />
          </div>
          <div aria-hidden="true" className="flex h-4 min-w-0 items-center gap-3 text-[11.5px] leading-4">
            {selectedEntry ? (
              <SelectionReadout
                leg={incoming}
                index={selectedIndex}
                speed={incoming && Number.isFinite(incoming.kmh) && !incoming.still ? incoming.kmh : null}
                speedText={
                  incoming
                    ? incoming.still
                      ? "same place"
                      : Number.isFinite(incoming.kmh)
                        ? formatSpeed(incoming.kmh, speedUnit, locale)
                        : "no time between"
                    : ""
                }
                animate={!reducedMotion}
              />
            ) : (
              <Legend limit={formatSpeed(speedLimit, speedUnit, locale)} />
            )}
          </div>
        </div>
        <div className="min-w-0 border-t border-border pt-2 @min-[560px]:border-t-0 @min-[560px]:border-l @min-[560px]:pt-0 @min-[560px]:pl-2">
          {entries.length === 0 ? (
            <p className="m-0 grid min-h-[120px] place-items-center text-[12.5px] leading-5 text-muted-foreground">No sign-ins yet</p>
          ) : (
            <ol
              ref={listRef}
              aria-label="Sign-ins, oldest first"
              onKeyDown={handleListKeyDown}
              className="relative m-0 grid max-h-[420px] list-none content-start overflow-y-auto p-0 [scrollbar-width:thin]"
            >
              {entries.map((entry, i) => {
                const leg = i > 0 ? model.legs[i - 1] : null;
                const outgoing = i < entries.length - 1 ? model.legs[i] : null;
                const connectorId = `${baseId}-leg-${i}`;
                const time = formatZonedTime(timeZone, entry.time, { date: "short", locale });
                const isSelected = entry.id === selected;
                return (
                  <li key={entry.id} className="grid">
                    {leg ? (
                      <LegConnector
                        id={connectorId}
                        leg={leg}
                        unit={unit}
                        locale={locale}
                        speedUnit={speedUnit}
                        chipRef={(node) => {
                          if (node) chipRefs.current.set(leg.key, node);
                          else chipRefs.current.delete(leg.key);
                        }}
                      />
                    ) : null}
                    <button
                      ref={(node) => {
                        if (node) rowRefs.current.set(entry.id, node);
                        else rowRefs.current.delete(entry.id);
                      }}
                      type="button"
                      tabIndex={entry.id === rovingId ? 0 : -1}
                      aria-pressed={isSelected}
                      aria-label={[entry.name, time, entry.device, entry.address].filter(Boolean).join(", ")}
                      aria-describedby={leg ? connectorId : undefined}
                      data-selected={isSelected ? "" : undefined}
                      data-hover={hover?.source === "map" && hoverPlace === entry.place ? "" : undefined}
                      onClick={() => setSelected(isSelected ? null : entry.id)}
                      onFocus={() => setFocusId(entry.id)}
                      onPointerEnter={() => setHover({ place: entry.place, source: "list" })}
                      onPointerLeave={() => setHover((current) => (current?.source === "list" ? null : current))}
                      className="group/row relative flex w-full cursor-pointer items-start gap-2 rounded-md border-0 bg-transparent py-[3px] pr-1.5 pl-1 text-left font-[inherit] text-inherit outline-none transition-colors duration-150 hover:bg-muted/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec data-[hover]:bg-muted/70 data-[selected]:bg-muted motion-reduce:transition-none"
                    >
                      <Rail incoming={leg} outgoing={outgoing} flaggedArrival={leg?.flagged ?? false} />
                      <span className="grid min-w-0 flex-1">
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className="truncate text-[13px] leading-4 text-foreground">{entry.name}</span>
                          <span className="ml-auto shrink-0 font-mono text-[11px] leading-4 text-muted-foreground tabular-nums">{time}</span>
                        </span>
                        <span className="truncate text-[11.5px] leading-[15px] text-muted-foreground">
                          {entry.device ?? (entry.address ? "" : formatLatLon(entry, "decimal", 1))}
                          {entry.address ? (
                            <span className="font-mono text-[11px]">
                              {entry.device ? " · " : ""}
                              {entry.address}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {entries.length === 1 ? (
            <p className="m-0 pt-1 pl-[27px] text-[11.5px] leading-4 text-muted-foreground">Nothing to compare yet</p>
          ) : null}
          <p className="m-0 mt-2 pl-1 text-[11px] leading-[14px] text-muted-foreground">
            Locations are approximate (IP based).
          </p>
        </div>
      </div>
      <div ref={liveRef} aria-live="polite" className="sr-only" />
    </div>
  );
}

/* Map overlays ---------------------------------------------------------------------------------------- */

interface PlaceMarkerProps {
  /** Position in % of the map box. */
  x: number;
  y: number;
  visible: boolean;
  count: number;
  flagged: boolean;
  selected: boolean;
  dimmed: boolean;
  hovered: boolean;
  animate: boolean;
}

/** A 24 px marker with a 7 px dot. Repeated sign-ins stack with a count; an impossible arrival gets a red ring. */
function PlaceMarker({ x, y, visible, count, flagged, selected, dimmed, hovered, animate }: PlaceMarkerProps) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const shown = React.useRef(visible);

  React.useLayoutEffect(() => {
    const was = shown.current;
    shown.current = visible;
    const element = ref.current;
    if (!visible || was || !animate || !element || typeof element.animate !== "function" || prefersReducedMotion()) return;
    element.animate(MARKER_POP_KEYFRAMES, { duration: 460, easing: "cubic-bezier(.2,.9,.3,1)" });
  }, [visible, animate]);

  return (
    <span
      ref={ref}
      data-selected={selected ? "" : undefined}
      data-hover={hovered ? "" : undefined}
      className={cn(
        "group/marker pointer-events-none absolute z-[2] grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center transition-opacity duration-300 motion-reduce:transition-none",
        !visible && "opacity-0",
        visible && dimmed && "opacity-35",
      )}
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <span
        className={cn(
          "absolute size-[19px] rounded-full border-[1.5px] border-destructive transition-[opacity,scale] duration-300 motion-reduce:transition-none",
          flagged ? "scale-100 opacity-100" : "scale-50 opacity-0",
        )}
      />
      <span className="absolute size-[15px] rounded-full bg-lumesec/20 opacity-0 transition-opacity duration-200 group-data-[selected]/marker:opacity-100 motion-reduce:transition-none" />
      <span className="size-[7px] rounded-full bg-foreground shadow-[0_0_0_2px_var(--card)] transition-[background-color,scale] duration-200 group-data-[hover]/marker:scale-[1.3] group-data-[selected]/marker:bg-lumesec motion-reduce:transition-none" />
      {count > 1 ? (
        <span className="absolute top-[-1px] left-[14px] flex h-[13px] min-w-[13px] items-center justify-center rounded-full bg-foreground px-[3px] font-mono text-[9.5px] leading-[13px] font-medium text-background tabular-nums shadow-[0_0_0_1.5px_var(--card)]">
          <RollText text={String(count)} animate={animate} className="leading-[13px]" />
        </span>
      ) : null}
    </span>
  );
}

interface TearChipProps {
  anchor: ChipAnchor;
  visible: boolean;
  dimmed: boolean;
  animate: boolean;
  speed: string;
  elapsed: string;
}

/** The speed a torn leg would have needed, beside the gap on the outside of the bend. */
function TearChip({ anchor, visible, dimmed, animate, speed, elapsed }: TearChipProps) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const shown = React.useRef(visible);

  React.useLayoutEffect(() => {
    const was = shown.current;
    shown.current = visible;
    const element = ref.current;
    if (!visible || was || !animate || !element || typeof element.animate !== "function" || prefersReducedMotion()) return;
    element.animate(POP_KEYFRAMES, POP_TIMING);
  }, [visible, animate]);

  // the chip grows away from the line toward where the bend points: above, beside or diagonally off the gap
  const shiftX = anchor.nx > 0.35 ? 0 : anchor.nx < -0.35 ? -1 : -0.5;
  const shiftY = anchor.ny > 0.35 ? 0 : anchor.ny < -0.35 ? -1 : -0.5;
  // keep it inside the map: the edges allow for a chip about CHIP_WIDTH wide
  const left = `clamp(${CHIP_WIDTH * -shiftX + 6}px, ${anchor.x}%, calc(100% - ${CHIP_WIDTH * (1 + shiftX) + 6}px))`;
  return (
    <span
      ref={ref}
      className={cn(
        "pointer-events-none absolute z-[2] rounded-md bg-destructive px-1.5 font-mono text-[11px] leading-[18px] whitespace-nowrap text-background tabular-nums shadow-[0_4px_12px_-6px_rgb(0_0_0/0.5)] transition-opacity duration-300 motion-reduce:transition-none",
        !visible && "opacity-0",
        visible && dimmed && "opacity-40",
      )}
      style={{
        left,
        top: `${anchor.y}%`,
        transform: `translate(${anchor.nx * CHIP_OFFSET}px, ${anchor.ny * CHIP_OFFSET}px) translate(${shiftX * 100}%, ${shiftY * 100}%)`,
      }}
    >
      {speed}
      <span className="opacity-75"> · {elapsed}</span>
    </span>
  );
}

/** The two leg styles, under the map while nothing is selected. */
function Legend({ limit }: { limit: string }) {
  return (
    <span className="flex min-w-0 items-center gap-3 text-muted-foreground">
      <span className="flex shrink-0 items-center gap-1.5">
        <span className="flex gap-[2px]">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-[2px] rounded-[0.5px] bg-[color-mix(in_srgb,var(--foreground)_55%,var(--card))]" />
          ))}
        </span>
        Travel
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="flex shrink-0 gap-[2px]">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className={cn("size-[2px] rounded-[0.5px] bg-destructive", i === 2 && "opacity-0")} />
          ))}
        </span>
        <span className="truncate">Faster than {limit}</span>
      </span>
    </span>
  );
}

interface SelectionReadoutProps {
  leg: Leg | null;
  index: number;
  /** The incoming speed in km/h for the rolling direction, or null. */
  speed: number | null;
  speedText: string;
  animate: boolean;
}

/** The selected sign-in's arrival: where from, and the speed it needed, in rolling figures. */
function SelectionReadout({ leg, index, speed, speedText, animate }: SelectionReadoutProps) {
  const route = leg ? `${leg.from.name} → ${leg.to.name}` : "First sign-in";
  const [shown, setShown] = React.useState({ route, index, speed: speed ?? -1, routeDirection: 1, speedDirection: 1 });
  const speedKey = speed ?? -1;
  if (shown.route !== route || shown.speed !== speedKey) {
    setShown({
      route,
      index,
      speed: speedKey,
      routeDirection: index >= shown.index ? 1 : -1,
      speedDirection: speedKey >= shown.speed ? 1 : -1,
    });
  }
  const characters = Array.from(speedText);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <RollText text={route} direction={shown.routeDirection} animate={animate} className="min-w-0 truncate text-foreground" />
      {characters.length > 0 ? (
        <span
          className={cn(
            "ml-auto inline-flex shrink-0 font-mono text-[11.5px] tabular-nums",
            leg?.flagged ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {characters.map((character, i) => (
            // keyed from the right, so the units keep their wheels and the digits roll
            <RollText key={characters.length - i} text={character} direction={shown.speedDirection} animate={animate} />
          ))}
        </span>
      ) : null}
    </span>
  );
}

/* Timeline ---------------------------------------------------------------------------------------------- */

/** The rail beside a row: the line from the previous sign-in, the dot, and the line to the next. */
function Rail({ incoming, outgoing, flaggedArrival }: { incoming: Leg | null; outgoing: Leg | null; flaggedArrival: boolean }) {
  return (
    <span aria-hidden="true" className="relative -my-[3px] w-[15px] shrink-0 self-stretch">
      {incoming ? <RailLine flagged={incoming.flagged} className="top-0 h-2" /> : null}
      <span
        data-rail-dot=""
        className={cn(
          "absolute top-2 left-1 size-[7px] rounded-full bg-foreground/45 transition-colors duration-200 group-data-[selected]/row:bg-lumesec motion-reduce:transition-none",
          flaggedArrival && "bg-destructive",
        )}
      />
      {outgoing ? <RailLine flagged={outgoing.flagged} className="top-[15px] bottom-0" /> : null}
    </span>
  );
}

function RailLine({ flagged, className }: { flagged: boolean; className: string }) {
  return (
    <span
      className={cn("absolute left-[7px]", flagged ? "w-0 border-l border-dashed border-destructive" : "w-px bg-foreground/15", className)}
    />
  );
}

interface LegConnectorProps {
  id: string;
  leg: Leg;
  unit: "km" | "mi";
  locale: string | undefined;
  speedUnit: "km/h" | "mph";
  chipRef: (node: HTMLSpanElement | null) => void;
}

/** Between two rows: the time and distance between the sign-ins, and the chip when the move was impossible. */
function LegConnector({ id, leg, unit, locale, speedUnit, chipRef }: LegConnectorProps) {
  const distance = leg.still ? "same place" : formatDistance(leg.km, unit, locale);
  const spoken = leg.flagged
    ? `${spokenDuration(leg.elapsed)} later, ${distance} away: impossible travel${Number.isFinite(leg.kmh) ? ` at ${formatSpeed(leg.kmh, speedUnit, locale)}` : ""}.`
    : `${spokenDuration(leg.elapsed)} later, ${leg.still ? "same place" : `${distance} away`}.`;
  return (
    <div className="flex gap-2 pr-1.5 pl-1">
      <span aria-hidden="true" className="relative w-[15px] shrink-0">
        {leg.flagged ? (
          <>
            {/* the rail tears like the line on the map */}
            <span className="absolute top-0 left-[6px] h-[36%] border-l border-dashed border-destructive" />
            <span className="absolute bottom-0 left-[8px] h-[36%] border-l border-dashed border-destructive" />
          </>
        ) : (
          <span className="absolute inset-y-0 left-[7px] w-px bg-foreground/15" />
        )}
      </span>
      <span className="grid min-w-0 flex-1 justify-items-start gap-0.5 py-px">
        <span aria-hidden="true" className="max-w-full truncate font-mono text-[11px] leading-[14px] text-muted-foreground tabular-nums">
          {shortDuration(leg.elapsed)} · {distance}
        </span>
        {leg.flagged ? (
          <span
            ref={chipRef}
            aria-hidden="true"
            className="rounded-[5px] bg-destructive px-1.5 text-[10.5px] leading-4 font-medium text-background"
          >
            Impossible travel
          </span>
        ) : null}
        <span id={id} className="sr-only">
          {spoken}
        </span>
      </span>
    </div>
  );
}

/* Model ------------------------------------------------------------------------------------------------ */

interface Entry {
  readonly id: string;
  readonly index: number;
  readonly time: number;
  readonly lat: number;
  readonly lon: number;
  readonly name: string;
  readonly device: string | null;
  readonly address: string | null;
  /** Index of its place (marker). */
  readonly place: number;
}

interface Leg {
  /** `fromId→toId`: the flag key. */
  readonly key: string;
  readonly index: number;
  readonly from: Entry;
  readonly to: Entry;
  readonly km: number;
  /** ms between the two sign-ins. */
  readonly elapsed: number;
  readonly hours: number;
  readonly kmh: number;
  readonly flagged: boolean;
  /** Both ends share one marker: nothing to draw, and no time in the replay. */
  readonly still: boolean;
}

interface Place {
  readonly index: number;
  readonly lat: number;
  readonly lon: number;
  readonly name: string;
  /** Entry indices, oldest first. */
  readonly members: readonly number[];
  /** Whether an impossible leg arrives here. */
  readonly flagged: boolean;
}

interface Model {
  /** Changes with anything shown: ids, times, positions, names, thresholds. */
  readonly key: string;
  /** One key per entry (id, time, position), to tell appended sign-ins from new data. */
  readonly entryKeys: readonly string[];
  readonly entries: readonly Entry[];
  readonly legs: readonly Leg[];
  readonly places: readonly Place[];
  readonly bounds: GeoBounds;
  readonly skipped: readonly string[];
}

interface Progress {
  /** Ids of the sign-ins the replay has reached. */
  readonly reached: ReadonlySet<string>;
  /** Keys of the legs that have torn. */
  readonly torn: ReadonlySet<string>;
}

interface Hover {
  place: number;
  source: "map" | "list";
}

interface LabelState {
  key: string;
  placements: { visible: boolean; x: number; y: number }[];
}

/** A chip's anchor: the leg's midpoint in % of the map box and the unit normal toward the outside of the bend. */
interface ChipAnchor {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

interface NominalLayout {
  /** Marker positions in % of the map box. */
  readonly places: readonly { x: number; y: number }[];
  readonly chips: ReadonlyMap<string, ChipAnchor>;
}

const EMPTY_PROGRESS: Progress = { reached: new Set(), torn: new Set() };

/** Sorts and checks the sign-ins: entries, places (markers), legs with their travel check, and the map bounds. */
function buildModel(signIns: readonly SignIn[], maxKmh: number, minKm: number): Model {
  const skipped: string[] = [];
  const seen = new Set<string>();
  const valid: { signIn: SignIn; id: string; time: number; lat: number; lon: number }[] = [];
  for (const signIn of signIns) {
    const id = typeof signIn.id === "string" ? signIn.id : "";
    const time = toEpochMs(signIn.time);
    if (id === "" || seen.has(id) || time === null || !isValidLatLon(signIn)) {
      skipped.push(id || "(no id)");
      continue;
    }
    seen.add(id);
    valid.push({ signIn, id, time, lat: signIn.lat, lon: wrapLongitude(signIn.lon) });
  }
  valid.sort((a, b) => a.time - b.time);

  // sign-ins within 25 km share a marker: IP locations of one city scatter a little
  const groups: { lat: number; lon: number; members: number[] }[] = [];
  const placeOf = valid.map((point, index) => {
    let place = groups.findIndex((group) => distanceKm(group, point) < PLACE_KM);
    if (place < 0) {
      place = groups.length;
      groups.push({ lat: point.lat, lon: point.lon, members: [] });
    }
    groups[place].members.push(index);
    return place;
  });

  const entries: Entry[] = valid.map((point, index) => ({
    id: point.id,
    index,
    time: point.time,
    lat: point.lat,
    lon: point.lon,
    name: placeName(point.signIn, point.lat, point.lon),
    device: point.signIn.device?.trim() || null,
    address: point.signIn.address?.trim() || null,
    place: placeOf[index],
  }));

  const legs: Leg[] = [];
  for (let i = 1; i < entries.length; i++) {
    const from = entries[i - 1];
    const to = entries[i];
    const elapsed = to.time - from.time;
    const check = checkTravel(from, to, elapsed, { maxKmh, minKm });
    legs.push({
      key: `${from.id}→${to.id}`,
      index: i - 1,
      from,
      to,
      km: check.km,
      elapsed,
      hours: check.hours,
      kmh: check.kmh,
      flagged: check.impossible,
      still: from.place === to.place,
    });
  }

  const flaggedPlaces = new Set(legs.filter((leg) => leg.flagged).map((leg) => leg.to.place));
  const places: Place[] = groups.map((group, index) => ({
    index,
    lat: group.lat,
    lon: group.lon,
    name: entries[group.members[0]].name,
    members: group.members,
    flagged: flaggedPlaces.has(index),
  }));

  const entryKeys = entries.map((entry) => `${entry.id}@${entry.time}@${entry.lat.toFixed(4)},${entry.lon.toFixed(4)}`);
  const shownKeys = entries.map((entry, i) => `${entryKeys[i]}@${entry.name}@${entry.device ?? ""}@${entry.address ?? ""}`);
  return {
    key: `${shownKeys.join("|")}#${maxKmh}#${minKm}`,
    entryKeys,
    entries,
    legs,
    places,
    bounds: boundsOf(entries, BOUNDS_MARGIN, BOUNDS_MIN_SPAN),
    skipped,
  };
}

function placeName(signIn: SignIn, lat: number, lon: number) {
  return signIn.city?.trim() || countryAt(lat, lon)?.name || formatLatLon({ lat, lon }, "decimal", 1);
}

/** Whether an impossible leg that has torn arrives at this entry. */
function isTornInto(model: Model, entryIndex: number, isTorn: (key: string) => boolean) {
  const leg = entryIndex > 0 ? model.legs[entryIndex - 1] : null;
  return leg !== null && leg.flagged && isTorn(leg.key);
}

/**
 * Equal Earth with the central meridian in the middle of the bounds, zoomed until the bounds fill the box. Zooming
 * the whole world (rather than cropping it) keeps the map's curved edges out of the box.
 */
function fitProjection(bounds: GeoBounds, width: number, height: number): MapProjection {
  const span = Math.min(360, bounds.east - bounds.west);
  const center = { lat: 0, lon: wrapLongitude(bounds.west + span / 2) };
  const world = createProjection("equalEarth", { width, height, center });
  if (span >= 360 || !(width > 0) || !(height > 0)) return world;
  const point = createScreenPoint();
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const visit = (lat: number, lambda: number) => {
    world.projectRelative(lat, lambda, point);
    x0 = Math.min(x0, point.x);
    y0 = Math.min(y0, point.y);
    x1 = Math.max(x1, point.x);
    y1 = Math.max(y1, point.y);
  };
  const half = span / 2;
  for (let i = 0; i <= FIT_STEPS; i++) {
    const k = i / FIT_STEPS;
    const lat = bounds.south + (bounds.north - bounds.south) * k;
    visit(lat, -half);
    visit(lat, half);
    visit(bounds.south, -half + span * k);
    visit(bounds.north, -half + span * k);
  }
  // the sides bulge furthest at the equator
  if (bounds.south < 0 && bounds.north > 0) {
    visit(0, -half);
    visit(0, half);
  }
  const zoom = Math.min((width * (1 - 2 * FIT_PAD)) / Math.max(1, x1 - x0), (height * (1 - 2 * FIT_PAD)) / Math.max(1, y1 - y0));
  if (!(zoom > 1.01)) return world;
  const focus = world.invert((x0 + x1) / 2, (y0 + y1) / 2) ?? { lat: (bounds.south + bounds.north) / 2, lon: center.lon };
  return createProjection("equalEarth", { width, height, center, zoom: Math.min(zoom, MAX_ZOOM), focus });
}

/** Marker and chip positions at a nominal size, as % of the map box, for the server markup and the DOM overlays. */
function nominalLayout(model: Model): NominalLayout {
  const projection = fitProjection(model.bounds, NOMINAL_WIDTH, NOMINAL_HEIGHT);
  const point = createScreenPoint();
  const places = model.places.map((place) => {
    projection.project(place.lat, place.lon, point);
    return { x: (point.x / NOMINAL_WIDTH) * 100, y: (point.y / NOMINAL_HEIGHT) * 100 };
  });
  const chips = new Map<string, ChipAnchor>();
  const cursor = { x: 0, y: 0, angle: 0 };
  for (const leg of model.legs) {
    if (!leg.flagged || leg.still) continue;
    const main = flatPaths(projection, leg.from, leg.to, { bend: LEG_BEND })[0];
    if (!main || main.count < 2) continue;
    pointAtDistance(main, main.length / 2, cursor);
    const normal = chordNormal(main);
    chips.set(leg.key, { x: (cursor.x / NOMINAL_WIDTH) * 100, y: (cursor.y / NOMINAL_HEIGHT) * 100, nx: normal.x, ny: normal.y });
  }
  return { places, chips };
}

/** Unit left normal of a table's chord (y down): the side a positive bend bulges toward. */
function chordNormal(table: ArcLengthTable) {
  const last = table.count - 1;
  const dx = table.xs[last] - table.xs[0];
  const dy = table.ys[last] - table.ys[0];
  const length = Math.hypot(dx, dy) || 1;
  return { x: dy / length, y: -dx / length };
}

/** '40 min', '2 h 10 min', '1 d 2 h': minutes spelled `min`, since a distance sits right next to it. */
function shortDuration(ms: number) {
  const minutes = Math.round(Math.max(0, ms) / 60_000);
  if (minutes < 1) return `${Math.round(Math.max(0, ms) / 1000)} s`;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const totalHours = Math.round(minutes / 60);
  const days = Math.floor(totalHours / 24);
  return totalHours % 24 ? `${days} d ${totalHours % 24} h` : `${days} d`;
}

/** '40 minutes', '2 hours 10 minutes', '1 day 2 hours', for screen readers. */
function spokenDuration(ms: number) {
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const minutes = Math.round(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${plural(hours, "hour")} ${plural(minutes % 60, "minute")}` : plural(hours, "hour");
  const totalHours = Math.round(minutes / 60);
  const days = Math.floor(totalHours / 24);
  return totalHours % 24 ? `${plural(days, "day")} ${plural(totalHours % 24, "hour")}` : plural(days, "day");
}

/* Constants ------------------------------------------------------------------------------------------- */

/** Invented demo trail over two days: London, London, Paris, London, then Singapore 40 minutes later. */
const DEMO_SIGN_INS: readonly SignIn[] = [
  { id: "s1", time: "2026-09-30T08:12:00Z", lat: 51.5072, lon: -0.1276, city: "London", device: "Laptop", address: "198.51.100.24" },
  { id: "s2", time: "2026-09-30T12:47:00Z", lat: 51.5072, lon: -0.1276, city: "London", device: "Phone", address: "198.51.100.61" },
  { id: "s3", time: "2026-09-30T18:05:00Z", lat: 48.8566, lon: 2.3522, city: "Paris", device: "Phone", address: "192.0.2.140" },
  { id: "s4", time: "2026-10-01T07:30:00Z", lat: 51.5072, lon: -0.1276, city: "London", device: "Laptop", address: "198.51.100.24" },
  { id: "s5", time: "2026-10-01T08:10:00Z", lat: 1.3521, lon: 103.8198, city: "Singapore", device: "Desktop", address: "203.0.113.77" },
  { id: "s6", time: "2026-10-01T10:55:00Z", lat: 1.3521, lon: 103.8198, city: "Singapore", device: "Desktop", address: "203.0.113.77" },
];

const MAP_ASPECT = 1.5;
const NOMINAL_WIDTH = 1000;
const NOMINAL_HEIGHT = NOMINAL_WIDTH / MAP_ASPECT;
const MAP_CANVAS = { maxDpr: 2 } as const;
/** boundsOf margin and minimum span: the trail never touches the edge, and a single city still shows its region. */
const BOUNDS_MARGIN = 0.3;
const BOUNDS_MIN_SPAN = 70;
const FIT_STEPS = 16;
const FIT_PAD = 0.04;
const MAX_ZOOM = 8;
const PLACE_KM = 25;
/** Pointer reach of a marker: its 24 px box. */
const HIT_RADIUS = 12;
const LABEL_HEIGHT = 14;
const LABEL_GAP = 9;
/** The tear chip sits 14 px outside the bend, growing away from the line; it is about 150 px wide at most. */
const CHIP_OFFSET = 14;
const CHIP_WIDTH = 150;

/** Land lattice. */
const PITCH = 4;
const LAND_SIZE = 1.5;
const LAND_ALPHA = 0.85;
/** Legs: dots every 3.5 px; calm legs in the strong land ink. */
const LEG_BEND = 0.12;
const LEG_SPACING = 3.5;
const LEG_SIZE = 1.75;
const FLAGGED_SIZE = 2;
const CALM_ALPHA = 0.8;
const FLAGGED_ALPHA = 1;
const TRAIL_PX = 16;
/** The tear: a 7 px gap on an under-damped spring, ragged over the last 9 px of each half. */
const GAP_PX = 7;
const GAP_STIFFNESS = 300;
const GAP_DAMPING = 0.45;
const GAP_SNAP_VELOCITY = 150;
const GAP_KICK_VELOCITY = 80;
const RAGGED_PX = 9;
const TEAR_REACH = 60;
const TEAR_FLASH_MS = 320;
/** Replay timing in ms. */
const LEAD_MS = 260;
const NEXT_LEAD_MS = 120;
const FIRST_HOLD_MS = 220;
const DRAW_MS = 600;
const STILL_MS = 240;
const GAP_MS = 90;
const HALF_MS = 560;
const PAUSE_MS = 140;
const B_MS = 440;
const PAST = -1e9;
/** First view: the land prints outward from the first sign-in. */
const REVEAL_MS = 1100;
const REVEAL_BAND = 0.06;
const REVEAL_END = 1 + REVEAL_BAND * 1.5;
/** A reached point pings the lattice: an uneven ring out to 6 dots; a tear pings 9 dots in red. */
const PING_MS = 760;
const PING_RADIUS = 6 * PITCH;
const TEAR_PING_RADIUS = 9 * PITCH;
/** The lattice stays scorched red for 14 px around a gap. */
const SCORCH_RADIUS = 14;
/** Sparks crackle in a fresh gap for 1.4 s, three every 90 ms; a selection crackles it again for 0.6 s. */
const CRACKLE_MS = 1400;
const KICK_CRACKLE_MS = 600;
const CRACKLE_EVERY_MS = 90;
const CRACKLE_COUNT = 3;

const ARC_EASE = cubicBezier(0.45, 0, 0.25, 1);

const CRACKLE_SPARKS: SparkOptions = { speed: [30, 140], life: [0.2, 0.5], size: [1.5, 2], drag: 4, jitter: 0.5 };
const TEAR_SPARKS: SparkOptions = { speed: [60, 220], life: [0.3, 0.7], size: [1.5, 2.5], drag: 3.5, jitter: 2 };

const POP_KEYFRAMES: Keyframe[] = [
  { scale: "0.6", opacity: 0 },
  { scale: "1.12", opacity: 1, offset: 0.55 },
  { scale: "1", opacity: 1 },
];
const POP_TIMING = { duration: 360, easing: "cubic-bezier(.2,.8,.2,1)" } as const;
const MARKER_POP_KEYFRAMES: Keyframe[] = [
  { scale: "0.2", opacity: 0 },
  { scale: "1.35", opacity: 1, offset: 0.45 },
  { scale: "1", opacity: 1 },
];
/** A reached row lights in the accent and cools to its own background. */
const ROW_FLASH_KEYFRAMES: Keyframe[] = [
  { backgroundColor: "color-mix(in srgb, var(--lumesec) 14%, transparent)", offset: 0 },
  { backgroundColor: "color-mix(in srgb, var(--lumesec) 8%, transparent)", offset: 0.35 },
];
const RAIL_DOT_KEYFRAMES: Keyframe[] = [
  { scale: "1.7", backgroundColor: "var(--lumesec)" },
  { scale: "1" },
];

/* Map engine ------------------------------------------------------------------------------------------ */

interface LegPath {
  readonly tables: readonly ArcLengthTable[];
  /** Length of the main table in px. */
  readonly length: number;
  /** Unit left normal of the chord: the halves of a torn leg move apart along it. */
  readonly nx: number;
  readonly ny: number;
  /** The midpoint and the unit tangent there, for sparks in the gap. */
  readonly midX: number;
  readonly midY: number;
  readonly tx: number;
  readonly ty: number;
}

interface TearState {
  gap: Spring;
  openedAt: number;
  crackleUntil: number;
  nextSpark: number;
}

/** When everything happens, in ms from the replay start. Legs drawn before the replay have PAST times. */
interface Schedule {
  readonly start: Float64Array;
  readonly tearAt: Float64Array;
  readonly bStart: Float64Array;
  readonly end: Float64Array;
  readonly reachAt: Float64Array;
  readonly total: number;
}

interface Ping {
  readonly x: number;
  readonly y: number;
  readonly start: number;
  readonly radius: number;
  readonly flagged: boolean;
}

interface RunStyle {
  color: RGB;
  alpha: number;
  size: number;
  dashed: boolean;
  /** Current tear gap in px, 0 for a whole leg. */
  gap: number;
  /** −1 for the first half, 1 for the second. */
  side: number;
  /** Distance of the packet head, or −1; the trail runs behind it in `direction`. */
  head: number;
  direction: number;
  trail: RGB;
}

/**
 * Everything the map draws, outside React: the land lattice (baked, redrawn on resize, theme change and the first
 * reveal), the legs with their packets, pings and tears (redrawn while anything moves), and the larger effects layer
 * for sparks. The replay is a schedule of reach and tear times; the engine reports progress back to React.
 */
class TravelMap {
  onProgress: (progress: Progress) => void = () => undefined;
  onReach: (entry: Entry) => void = () => undefined;
  onTear: (leg: Leg) => void = () => undefined;

  private model: Model | null = null;
  private animated = true;
  private ink: GeoInk | null = null;
  private landColor = "";
  private batch: DotBatch | null = null;
  private box: { width: number; height: number; dpr: number } | null = null;
  private projection: MapProjection | null = null;
  private lattice: DotLattice | null = null;
  private paths: (LegPath | null)[] = [];
  private placeX = new Float32Array(0);
  private placeY = new Float32Array(0);
  private reached = new Uint8Array(0);
  private torn = new Uint8Array(0);
  private tears: TearState[] = [];
  private emphasis: Spring[] = [];
  private dimming: Spring[] = [];
  private schedule: Schedule | null = null;
  private replayStart = 0;
  private replayFrom = 0;
  /** Entry index to replay from when the map next runs (it only runs on screen), or −1. */
  private pendingFrom = -1;
  /** Legs that became impossible because the thresholds changed: they tear on the next frame. */
  private pendingTears: number[] = [];
  private selected = -1;
  private selectedId: string | null = null;
  private pings: Ping[] = [];
  private readonly sparks = new Sparks();
  private reveal: "waiting" | "running" | "done" = "waiting";
  private revealStart = 0;
  private threshold = new Float32Array(0);
  private baseDirty = true;
  private legsDirty = true;
  private effectsDirty = false;
  private progressDirty = false;
  private effectsX = 0;
  private effectsY = 0;
  private readonly point = createScreenPoint();
  private readonly cursor = { x: 0, y: 0, angle: 0 };

  setInk(ink: GeoInk) {
    this.ink = ink;
    this.landColor = rgba(ink.land);
    const ramp = [ink.land, ink.accent];
    if (this.batch) this.batch.setRamp(ramp);
    else this.batch = createDotBatch(4096, ramp, { tones: 16, levels: 16 });
    this.baseDirty = true;
    this.legsDirty = true;
  }

  /** Off: the replay finishes at once, sparks and pings stop, the land shows without its reveal. */
  setAnimated(animated: boolean) {
    if (animated === this.animated) return;
    this.animated = animated;
    if (!animated) {
      this.finish();
      this.sparks.clear();
      this.pings = [];
      for (const tear of this.tears) tear.crackleUntil = 0;
      if (this.reveal !== "done") {
        this.reveal = "done";
        this.baseDirty = true;
      }
    }
    this.legsDirty = true;
  }

  /**
   * New data. The first data waits for the first view; appended sign-ins replay from the first new one; other data
   * replays from the start; changed thresholds tear newly impossible legs in place.
   */
  setModel(model: Model) {
    const previous = this.model;
    if (previous === model) return;
    const wasTorn = new Set<string>();
    if (previous) previous.legs.forEach((leg, i) => this.torn[i] && wasTorn.add(leg.key));
    const running = this.pendingFrom >= 0 ? this.pendingFrom : this.schedule ? this.replayFrom : -1;

    this.model = model;
    this.reached = new Uint8Array(model.entries.length);
    this.torn = new Uint8Array(model.legs.length);
    this.tears = model.legs.map(() => ({ gap: { position: 0, velocity: 0 }, openedAt: -Infinity, crackleUntil: 0, nextSpark: 0 }));
    this.emphasis = model.legs.map(() => ({ position: 0, velocity: 0 }));
    this.dimming = model.legs.map(() => ({ position: 0, velocity: 0 }));
    this.schedule = null;
    this.pendingFrom = -1;
    this.pendingTears = [];
    this.pings = [];
    // the selection effect sets the new index; the id is kept, so an unchanged selection does not crackle again
    this.selected = -1;
    this.layoutPaths();

    if (!this.animated || !previous) {
      this.finish();
      if (this.animated) this.pendingFrom = 0;
      return;
    }
    const keys = model.entryKeys;
    const old = previous.entryKeys;
    const prefix = old.length <= keys.length && old.every((key, i) => key === keys[i]);
    if (prefix && old.length === keys.length) {
      this.finish();
      model.legs.forEach((leg, i) => {
        if (!leg.flagged || wasTorn.has(leg.key)) return;
        this.torn[i] = 0;
        this.tears[i].gap.position = 0;
        this.pendingTears.push(i);
      });
      return;
    }
    this.finish();
    this.pendingFrom = prefix ? Math.min(old.length, running >= 0 ? running : old.length) : 0;
  }

  /** Plays every leg again from the first sign-in. */
  replay() {
    if (!this.model || !this.animated) return;
    this.pendingFrom = 0;
  }

  /** The selected entry index, or −1. Selecting an end of a torn leg wobbles its gap and crackles it again. */
  setSelection(index: number) {
    const model = this.model;
    const id = model && index >= 0 ? (model.entries[index]?.id ?? null) : null;
    this.selected = id === null ? -1 : index;
    if (id === this.selectedId) return;
    this.selectedId = id;
    this.legsDirty = true;
    if (id === null || !model || !this.animated || prefersReducedMotion()) return;
    const now = performance.now();
    for (const i of [index - 1, index]) {
      const leg = model.legs[i];
      if (!leg?.flagged || !this.torn[i]) continue;
      const tear = this.tears[i];
      tear.gap.velocity += GAP_KICK_VELOCITY;
      tear.crackleUntil = Math.max(tear.crackleUntil, now + KICK_CRACKLE_MS);
      tear.nextSpark = Math.max(tear.nextSpark, now);
    }
  }

  layout(width: number, height: number, dpr: number) {
    this.box = { width, height, dpr };
    this.layoutPaths();
    if (this.reveal === "running") this.prepareReveal();
    this.baseDirty = true;
    this.legsDirty = true;
  }

  /** The legs canvas was cleared (resized): draw it again on the next frame. */
  invalidate() {
    this.legsDirty = true;
  }

  /** Position of the map's top-left corner on the effects layer. */
  setEffectsOffset(x: number, y: number) {
    this.effectsX = x;
    this.effectsY = y;
  }

  /** One frame: replay events, springs, then the land, the legs and the sparks. Returns whether to keep going. */
  step(base: CanvasSurface | null, legs: CanvasSurface | null, effects: CanvasSurface | null, delta: number) {
    const model = this.model;
    if (!model || !this.ink || !this.lattice || !base || !legs) return false;
    const now = performance.now();
    const still = !this.animated || prefersReducedMotion();
    let moving = false;

    if (this.pendingFrom >= 0) {
      const from = this.pendingFrom;
      this.pendingFrom = -1;
      if (still) this.finish();
      else this.begin(from, now);
    }
    if (this.pendingTears.length > 0) {
      for (const i of this.pendingTears) this.openTear(i, now, still);
      this.pendingTears = [];
    }

    // The land prints itself once, outward from the first sign-in, the first time the map is on screen.
    if (this.reveal === "waiting") {
      if (still) {
        this.reveal = "done";
      } else {
        this.reveal = "running";
        this.revealStart = now;
        this.prepareReveal();
      }
    }
    if (this.reveal === "running") {
      const t = (now - this.revealStart) / REVEAL_MS;
      if (t >= 1 || still) {
        this.reveal = "done";
        this.baseDirty = true;
      } else {
        this.drawReveal(base, easeOutCubic(t) * REVEAL_END);
        moving = true;
      }
    }
    if (this.reveal === "done" && this.baseDirty) {
      this.bake(base);
      this.baseDirty = false;
    }

    if (this.schedule) {
      if (still) this.finish();
      else {
        this.advance(now);
        moving = true;
      }
    }

    for (let i = 0; i < model.legs.length; i++) {
      const tear = this.tears[i];
      if (stepSpring(tear.gap, this.torn[i] ? GAP_PX : 0, delta, still, GAP_STIFFNESS, GAP_DAMPING)) moving = true;
      const near = this.selected >= 0 && (i === this.selected - 1 || i === this.selected);
      if (stepSpring(this.emphasis[i], near ? 1 : 0, delta, still, 420, 0.85)) moving = true;
      if (stepSpring(this.dimming[i], this.selected >= 0 && !near ? 1 : 0, delta, still, 420, 0.85)) moving = true;
      if (!still && (tear.crackleUntil > now || now - tear.openedAt < TEAR_FLASH_MS)) moving = true;
    }
    if (this.pings.length > 0) {
      this.pings = still ? [] : this.pings.filter((ping) => now - ping.start < PING_MS);
      moving = true;
    }

    if (moving || this.legsDirty) {
      this.drawLegs(legs, now);
      this.legsDirty = false;
    }
    const sparking = effects ? this.drawEffects(effects, now, delta, still) : false;
    if (this.progressDirty) {
      this.progressDirty = false;
      this.postProgress();
    }
    return moving || sparking;
  }

  /* internals */

  private layoutPaths() {
    const model = this.model;
    const box = this.box;
    if (!model || !box) return;
    const projection = fitProjection(model.bounds, box.width, box.height);
    this.projection = projection;
    this.lattice = mapLattice(projection, { pitch: PITCH });
    this.placeX = new Float32Array(model.places.length);
    this.placeY = new Float32Array(model.places.length);
    model.places.forEach((place, i) => {
      projection.project(place.lat, place.lon, this.point);
      this.placeX[i] = this.point.x;
      this.placeY[i] = this.point.y;
    });
    this.paths = model.legs.map((leg) => {
      if (leg.still) return null;
      const tables = flatPaths(projection, leg.from, leg.to, { bend: LEG_BEND });
      const main = tables[0];
      if (!main || main.count < 2 || main.length < 1) return null;
      const normal = chordNormal(main);
      pointAtDistance(main, main.length / 2, this.cursor);
      return {
        tables,
        length: main.length,
        nx: normal.x,
        ny: normal.y,
        midX: this.cursor.x,
        midY: this.cursor.y,
        tx: Math.cos(this.cursor.angle),
        ty: Math.sin(this.cursor.angle),
      };
    });
    this.legsDirty = true;
  }

  /** Schedules the replay from entry `from`: earlier entries stay reached and earlier legs stay drawn. */
  private begin(from: number, now: number) {
    const model = this.model;
    if (!model) return;
    const count = model.entries.length;
    const legCount = model.legs.length;
    if (from >= count) {
      this.finish();
      return;
    }
    const start = new Float64Array(legCount).fill(PAST);
    const tearAt = new Float64Array(legCount).fill(PAST);
    const bStart = new Float64Array(legCount).fill(PAST);
    const end = new Float64Array(legCount).fill(PAST);
    const reachAt = new Float64Array(count).fill(PAST);
    let t = from === 0 ? LEAD_MS : NEXT_LEAD_MS;
    if (from === 0) {
      reachAt[0] = t;
      t += FIRST_HOLD_MS;
    }
    for (let i = Math.max(0, from - 1); i < legCount; i++) {
      const leg = model.legs[i];
      if (leg.still) {
        // nothing to draw: a short beat, so the row and the count still move in order
        t += STILL_MS;
        start[i] = tearAt[i] = bStart[i] = end[i] = reachAt[i + 1] = t;
        continue;
      }
      start[i] = t;
      if (leg.flagged) {
        tearAt[i] = t + HALF_MS;
        bStart[i] = tearAt[i] + PAUSE_MS;
        end[i] = bStart[i] + B_MS;
        reachAt[i + 1] = bStart[i];
      } else {
        end[i] = t + DRAW_MS;
        tearAt[i] = bStart[i] = reachAt[i + 1] = end[i];
      }
      t = end[i] + GAP_MS;
    }
    for (let i = 0; i < count; i++) this.reached[i] = i < from ? 1 : 0;
    model.legs.forEach((leg, i) => {
      const done = i < from - 1 && leg.flagged;
      this.torn[i] = done ? 1 : 0;
      this.tears[i].gap.position = done ? GAP_PX : 0;
      this.tears[i].gap.velocity = 0;
      this.tears[i].crackleUntil = 0;
    });
    this.schedule = { start, tearAt, bStart, end, reachAt, total: t };
    this.replayStart = now;
    this.replayFrom = from;
    this.pings = [];
    this.progressDirty = true;
    this.legsDirty = true;
  }

  /** Reach and tear events up to now. */
  private advance(now: number) {
    const model = this.model;
    const schedule = this.schedule;
    if (!model || !schedule) return;
    const elapsed = now - this.replayStart;
    for (let i = 0; i < model.entries.length; i++) {
      if (this.reached[i] || schedule.reachAt[i] > elapsed) continue;
      this.reached[i] = 1;
      this.progressDirty = true;
      const place = model.entries[i].place;
      this.pings.push({
        x: this.placeX[place],
        y: this.placeY[place],
        start: now,
        radius: PING_RADIUS,
        flagged: model.legs[i - 1]?.flagged ?? false,
      });
      this.onReach(model.entries[i]);
    }
    for (let i = 0; i < model.legs.length; i++) {
      if (model.legs[i].flagged && !this.torn[i] && schedule.tearAt[i] <= elapsed) this.openTear(i, now, false);
    }
    if (elapsed >= schedule.total) this.schedule = null;
  }

  /** Everything at once: every point reached, every impossible leg torn, no sparks. */
  private finish() {
    const model = this.model;
    if (!model) return;
    this.schedule = null;
    this.pendingFrom = -1;
    this.reached.fill(1);
    model.legs.forEach((leg, i) => {
      this.torn[i] = leg.flagged ? 1 : 0;
      this.tears[i].gap.position = leg.flagged ? GAP_PX : 0;
      this.tears[i].gap.velocity = 0;
    });
    this.progressDirty = true;
    this.legsDirty = true;
  }

  /** The leg splits: the gap snaps open on its spring, sparks burst and keep crackling for 1.4 s. */
  private openTear(i: number, now: number, still: boolean) {
    const model = this.model;
    if (!model) return;
    this.torn[i] = 1;
    this.progressDirty = true;
    const tear = this.tears[i];
    if (still) {
      tear.gap.position = GAP_PX;
      tear.gap.velocity = 0;
    } else {
      tear.openedAt = now;
      tear.gap.position = 0;
      tear.gap.velocity = GAP_SNAP_VELOCITY;
      tear.crackleUntil = now + CRACKLE_MS;
      tear.nextSpark = now + CRACKLE_EVERY_MS;
      this.emitGapSparks(i, 14, TEAR_SPARKS);
      const path = this.paths[i];
      if (path) this.pings.push({ x: path.midX, y: path.midY, start: now, radius: TEAR_PING_RADIUS, flagged: true });
    }
    this.onTear(model.legs[i]);
  }

  private postProgress() {
    const model = this.model;
    if (!model) return;
    const reached = new Set<string>();
    model.entries.forEach((entry, i) => this.reached[i] && reached.add(entry.id));
    const torn = new Set<string>();
    model.legs.forEach((leg, i) => this.torn[i] && torn.add(leg.key));
    this.onProgress({ reached, torn });
  }

  /** Reveal thresholds: distance from the first sign-in (or the middle), plus the dot's jitter for an uneven front. */
  private prepareReveal() {
    const lattice = this.lattice;
    const box = this.box;
    if (!lattice || !box) return;
    const first = this.model?.entries[0];
    const ox = first ? this.placeX[first.place] : box.width / 2;
    const oy = first ? this.placeY[first.place] : box.height / 2;
    const reach = Math.max(
      Math.hypot(ox, oy),
      Math.hypot(box.width - ox, oy),
      Math.hypot(ox, box.height - oy),
      Math.hypot(box.width - ox, box.height - oy),
    );
    this.threshold = new Float32Array(lattice.count);
    for (let i = 0; i < lattice.count; i++) {
      const n = Math.hypot(lattice.x[i] - ox, lattice.y[i] - oy) / reach;
      this.threshold[i] = n * 0.82 + lattice.jitter[i] * 0.18;
    }
  }

  private bake(surface: CanvasSurface) {
    const { context, width, height } = surface;
    const lattice = this.lattice;
    context.clearRect(0, 0, width, height);
    if (!lattice) return;
    const dpr = this.box?.dpr ?? surface.dpr;
    context.fillStyle = this.landColor;
    context.globalAlpha = LAND_ALPHA;
    for (let i = 0; i < lattice.count; i++) fillSquare(context, lattice.x[i], lattice.y[i], LAND_SIZE, dpr);
    context.globalAlpha = 1;
  }

  /** The first reveal: dots appear behind an uneven front that flashes in the accent as it passes. */
  private drawReveal(surface: CanvasSurface, front: number) {
    const { context, width, height } = surface;
    const lattice = this.lattice;
    const batch = this.batch;
    context.clearRect(0, 0, width, height);
    if (!lattice || !batch) return;
    const dpr = this.box?.dpr ?? surface.dpr;
    for (let i = 0; i < lattice.count; i++) {
      const passed = front - this.threshold[i];
      const appear = clamp(passed / REVEAL_BAND, 0, 1);
      if (appear <= 0) continue;
      const flash = Math.exp(-passed / 0.05);
      const size = snapSize(LAND_SIZE + 0.6 * flash, dpr);
      batch.add(snapCenter(lattice.x[i], size, dpr), snapCenter(lattice.y[i], size, dpr), size, 0.85 * flash, appear * LAND_ALPHA);
    }
    batch.flush(context);
  }

  private drawLegs(surface: CanvasSurface, now: number) {
    const { context, width, height } = surface;
    context.clearRect(0, 0, width, height);
    const model = this.model;
    const ink = this.ink;
    if (!model || !ink) return;
    const schedule = this.schedule;
    const elapsed = schedule ? now - this.replayStart : Infinity;

    for (let i = 0; i < model.legs.length; i++) {
      const path = this.paths[i];
      if (!path) continue;
      const leg = model.legs[i];
      const emphasis = clamp(this.emphasis[i].position, 0, 1);
      const fade = 1 - 0.7 * clamp(this.dimming[i].position, 0, 1);
      const size = LEG_SIZE * (1 + 0.5 * emphasis);
      const length = path.length;
      const calm: RunStyle = {
        color: mixRgb(ink.landStrong, ink.accent, emphasis),
        alpha: (CALM_ALPHA + (1 - CALM_ALPHA) * emphasis) * fade,
        size,
        dashed: false,
        gap: 0,
        side: 0,
        head: -1,
        direction: 1,
        trail: ink.accent,
      };

      if (!leg.flagged || !this.torn[i]) {
        // a calm leg, or an impossible one still on its way to the midpoint
        const reach = leg.flagged ? length / 2 : length;
        let p = 1;
        if (schedule) {
          const begin = schedule.start[i];
          const finish = leg.flagged ? schedule.tearAt[i] : schedule.end[i];
          if (elapsed < begin) continue;
          p = finish > begin ? clamp((elapsed - begin) / (finish - begin), 0, 1) : 1;
        }
        const drawn = ARC_EASE(p) * reach;
        const moving = schedule !== null && p < 1;
        calm.head = moving ? drawn : -1;
        this.run(context, path, i, 0, drawn, calm);
        if (moving) this.packet(context, path, drawn, 0, 0, ink.accent, fade);
        continue;
      }

      const tear = this.tears[i];
      const gap = Math.max(0, tear.gap.position);
      const gapHalf = gapAlong(gap);
      const flash = 1 - smoothstep(0, TEAR_FLASH_MS, now - tear.openedAt);
      const torn: RunStyle = {
        color: mixRgb(ink.destructive, ink.glint, 0.65 * flash),
        alpha: (FLAGGED_ALPHA + (1 - FLAGGED_ALPHA) * emphasis) * fade,
        size: FLAGGED_SIZE * (1 + 0.5 * emphasis) + 0.6 * flash,
        dashed: true,
        gap,
        side: -1,
        head: -1,
        direction: 1,
        trail: ink.destructive,
      };
      const mid = length / 2;
      this.drawScorch(context, path, gap, fade);
      this.run(context, path, i, 0, mid - gapHalf, torn);

      // the far half grows back from the destination toward the gap, and never meets the near half
      let grown = 1;
      if (schedule && elapsed < schedule.end[i]) {
        const span = schedule.end[i] - schedule.bStart[i];
        grown = elapsed < schedule.bStart[i] ? 0 : ARC_EASE(span > 0 ? (elapsed - schedule.bStart[i]) / span : 1);
      }
      if (grown <= 0) continue;
      const from = length - grown * (mid - gapHalf);
      const growing = grown < 1;
      torn.side = 1;
      torn.head = growing ? from : -1;
      torn.direction = -1;
      this.run(context, path, i, from, length, torn);
      if (growing) this.packet(context, path, from, gap, 1, ink.destructive, fade);
    }

    this.drawPings(context, now);
  }

  /** Dots along a leg from `from` to `to` px, phase-locked to the leg start, optionally dashed and torn apart. */
  private run(context: CanvasRenderingContext2D, path: LegPath, leg: number, from: number, to: number, style: RunStyle) {
    if (!(to > from) || style.alpha <= 0.01) return;
    const dpr = this.box?.dpr ?? 1;
    const base = rgba(style.color);
    const trail = rgba(style.trail);
    const length = path.length;
    const visit = (x: number, y: number, s: number) => {
      const k = Math.round(s / LEG_SPACING);
      if (style.dashed && k % 4 >= 2) return;
      let px = x;
      let py = y;
      if (style.gap > 0) {
        const offset = tearOffset(s, length, style.gap, style.side, k, leg);
        if (offset === null) return;
        px += path.nx * offset;
        py += path.ny * offset;
      }
      let alpha = style.alpha;
      let size = style.size;
      let color = base;
      if (style.head >= 0) {
        const behind = (style.head - s) * style.direction;
        if (behind >= 0 && behind < TRAIL_PX) {
          const heat = 1 - behind / TRAIL_PX;
          alpha = Math.min(1, alpha + 0.6 * heat);
          size += 0.7 * heat;
          color = trail;
        }
      }
      context.globalAlpha = alpha;
      context.fillStyle = color;
      fillSquare(context, px, py, size, dpr);
    };
    for (const table of path.tables) forEachDot(table, LEG_SPACING, from, to, visit);
    context.globalAlpha = 1;
  }

  /** The packet at the head of a drawing leg: a soft halo and a 3 px square. */
  private packet(context: CanvasRenderingContext2D, path: LegPath, s: number, gap: number, side: number, color: RGB, fade: number) {
    const dpr = this.box?.dpr ?? 1;
    for (const table of path.tables) {
      pointAtDistance(table, s, this.cursor);
      const offset = gap > 0 ? (tearOffset(s, path.length, gap, side, -1, 0) ?? 0) : 0;
      const x = this.cursor.x + path.nx * offset;
      const y = this.cursor.y + path.ny * offset;
      const halo = context.createRadialGradient(x, y, 0, x, y, 8);
      halo.addColorStop(0, rgba(color, 0.4 * fade));
      halo.addColorStop(1, rgba(color, 0));
      context.fillStyle = halo;
      context.fillRect(x - 8, y - 8, 16, 16);
      context.globalAlpha = fade;
      context.fillStyle = rgba(color);
      fillSquare(context, x, y, 3, dpr);
      context.globalAlpha = 1;
    }
  }

  /** The lattice around a gap stays lit in red, densest at the centre, so the tear reads at a glance. */
  private drawScorch(context: CanvasRenderingContext2D, path: LegPath, gap: number, fade: number) {
    const projection = this.projection;
    const ink = this.ink;
    if (!projection || !ink) return;
    const dpr = this.box?.dpr ?? 1;
    const strength = clamp(gap / GAP_PX, 0, 1) * fade;
    if (strength <= 0.02) return;
    const { x0, y0 } = projection.frame;
    context.fillStyle = rgba(ink.destructive);
    const firstColumn = Math.floor((path.midX - SCORCH_RADIUS - x0) / PITCH);
    const lastColumn = Math.ceil((path.midX + SCORCH_RADIUS - x0) / PITCH);
    const firstRow = Math.floor((path.midY - SCORCH_RADIUS - y0) / PITCH);
    const lastRow = Math.ceil((path.midY + SCORCH_RADIUS - y0) / PITCH);
    for (let row = firstRow; row <= lastRow; row++) {
      const y = y0 + (row + 0.5) * PITCH;
      for (let column = firstColumn; column <= lastColumn; column++) {
        const x = x0 + (column + 0.5) * PITCH;
        const jitter = hash(column * 31 + row * 7 + 1.13);
        const reach = 1 - Math.hypot(x - path.midX, y - path.midY) / (SCORCH_RADIUS * (0.75 + 0.25 * jitter));
        if (reach <= 0) continue;
        const light = Math.pow(reach, 1.4) * (0.45 + 0.55 * hash(column * 31 + row * 7 + 7)) * 0.85 * strength;
        if (light < 0.08) continue;
        context.globalAlpha = light;
        fillSquare(context, x, y, LAND_SIZE, dpr);
      }
    }
    context.globalAlpha = 1;
  }

  /** Reached points ping the lattice grid around them: an uneven ring of dots out to 6 dots, over land and sea. */
  private drawPings(context: CanvasRenderingContext2D, now: number) {
    const projection = this.projection;
    const ink = this.ink;
    if (!projection || !ink || this.pings.length === 0) return;
    const dpr = this.box?.dpr ?? 1;
    const { x0, y0 } = projection.frame;
    const accent = rgba(ink.accent);
    const destructive = rgba(ink.destructive);
    for (const ping of this.pings) {
      const t = (now - ping.start) / PING_MS;
      if (t < 0 || t >= 1) continue;
      const radius = 2 + (ping.radius - 2) * easeOutCubic(t);
      const fade = Math.pow(1 - t, 1.2);
      context.fillStyle = ping.flagged ? destructive : accent;
      const reach = ping.radius + PITCH * 2;
      const firstColumn = Math.floor((ping.x - reach - x0) / PITCH);
      const lastColumn = Math.ceil((ping.x + reach - x0) / PITCH);
      const firstRow = Math.floor((ping.y - reach - y0) / PITCH);
      const lastRow = Math.ceil((ping.y + reach - y0) / PITCH);
      for (let row = firstRow; row <= lastRow; row++) {
        const y = y0 + (row + 0.5) * PITCH;
        for (let column = firstColumn; column <= lastColumn; column++) {
          const x = x0 + (column + 0.5) * PITCH;
          const distance = Math.hypot(x - ping.x, y - ping.y);
          const light = ringFront(distance, radius, 3.2, hash(column * 31 + row * 7 + 1.13), 4) * fade;
          if (light < 0.05) continue;
          context.globalAlpha = Math.min(1, light);
          fillSquare(context, x, y, LAND_SIZE + light, dpr);
        }
      }
    }
    context.globalAlpha = 1;
  }

  /** Sparks crackling in the gaps, on the layer that reaches past the map. Returns whether anything is alive. */
  private drawEffects(surface: CanvasSurface, now: number, delta: number, still: boolean) {
    let crackling = false;
    if (!still) {
      for (let i = 0; i < this.tears.length; i++) {
        const tear = this.tears[i];
        if (tear.crackleUntil <= now) continue;
        crackling = true;
        while (tear.nextSpark <= now && tear.nextSpark < tear.crackleUntil) {
          this.emitGapSparks(i, CRACKLE_COUNT, CRACKLE_SPARKS);
          tear.nextSpark += CRACKLE_EVERY_MS;
        }
      }
    }
    const { context, width, height } = surface;
    if (!this.sparks.active) {
      if (this.effectsDirty) {
        context.clearRect(0, 0, width, height);
        this.effectsDirty = false;
      }
      return crackling;
    }
    this.effectsDirty = true;
    context.clearRect(0, 0, width, height);
    return this.sparks.step(context, delta) || crackling;
  }

  /** Sparks from random points inside a torn leg's gap: mostly red, some in the glint (soft accent on light cards). */
  private emitGapSparks(i: number, count: number, options: SparkOptions) {
    const path = this.paths[i];
    const ink = this.ink;
    if (!path || !ink) return;
    const gap = Math.max(1.5, this.tears[i].gap.position);
    const along = gapAlong(gap);
    const third = ink.dark ? ink.glint : ink.soft;
    for (let n = 0; n < count; n++) {
      const a = (Math.random() * 2 - 1) * along;
      const b = (Math.random() * 2 - 1) * gap;
      const x = path.midX + path.tx * a + path.nx * b + this.effectsX;
      const y = path.midY + path.ty * a + path.ny * b + this.effectsY;
      this.sparks.add(x, y, 1, [Math.random() < 0.7 ? ink.destructive : third], options);
    }
  }
}

/**
 * Perpendicular offset of a torn leg's dot at `s`: g·(1 − d / reach)² to its half's side, d being the distance from the
 * midpoint and reach at most 60 px, so the halves kink apart at the gap instead of bending along the whole leg. The
 * last few px before the gap get a ragged jitter, and null drops a dot so the torn ends fray. `k` −1 skips both (the
 * packet).
 */
function tearOffset(s: number, length: number, gap: number, side: number, k: number, leg: number): number | null {
  const reach = Math.min(length / 2, TEAR_REACH);
  const w = Math.max(0, 1 - Math.abs(s - length / 2) / reach);
  let offset = gap * w * w * side;
  if (k < 0) return offset;
  const near = 1 - Math.min(1, Math.abs(s - length / 2) / RAGGED_PX);
  if (near > 0) {
    if (hash(k * 7.31 + leg * 13.7) < near * 0.32) return null;
    offset += (hash(k * 3.17 + leg * 5.3) - 0.5) * gap * 0.7 * near;
  }
  return offset;
}

/** Half the gap along the leg for a gap of `gap` px across it: wider than a dash gap, so the tear reads as a tear. */
const gapAlong = (gap: number) => 3 + 0.9 * gap;

/** Room a count badge takes right of a marker's dot, in px. */
const badgeRoom = (place: Place | undefined) => (place && place.members.length > 1 ? 10 : 0);

/** One spring step toward `target`; snaps and reports a final change once settled (or always with reduced motion). */
function stepSpring(spring: Spring, target: number, delta: number, still: boolean, stiffness: number, damping: number) {
  if (still || (Math.abs(spring.position - target) < 0.002 && Math.abs(spring.velocity) < 0.002)) {
    const changed = spring.position !== target || spring.velocity !== 0;
    spring.position = target;
    spring.velocity = 0;
    return changed;
  }
  springStep(spring, target, delta, stiffness, damping);
  return true;
}
