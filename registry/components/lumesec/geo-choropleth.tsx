"use client";

import * as React from "react";

import { localPoint, snapCenter, snapSize, useCanvas, type CanvasSurface } from "@/lib/lumesec/canvas";
import { usePalette } from "@/lib/lumesec/color";
import {
  ARROW_DIRECTIONS,
  BAYER4,
  bayer4,
  countryIndex,
  countryMembership,
  countryOutline,
  createDotBatch,
  createProjection,
  createScreenPoint,
  cubicBezier,
  GEO_TOKENS,
  geoInk,
  mapLattice,
  projectionAspect,
  projectionOutlineSvgPath,
  spatialNavigate,
  wrapLongitude,
  type DotBatch,
  type GeoInk,
  type MapProjection,
} from "@/lib/lumesec/geo";
import { COUNTRIES, countryAt } from "@/lib/lumesec/geo-countries";
import { formatCompact, quantile } from "@/lib/lumesec/geo-data";
import { clamp, hash, rgba, smoothstep } from "@/lib/lumesec/math";
import { prefersReducedMotion, springStep, useAnimationLoop, useLazyRef, useReducedMotion } from "@/lib/lumesec/motion";
import { RollText } from "@/lib/lumesec/roll-text";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** One record: an ISO 3166-1 alpha-2 country code and its value. */
export interface CountryValue {
  /** ISO 3166-1 alpha-2 code, for example `DE`. Case does not matter; Kosovo is `XK`. */
  readonly code: string;
  /** The value for the country. Non-finite values are skipped. */
  readonly value: number;
}

/** How values are split into density classes. */
export type GeoChoroplethScale = "quantile" | "linear" | "log";

/** The flat projections the map can use. */
export type GeoChoroplethProjection = "equalEarth" | "equirectangular";

/** Props of `GeoChoropleth`. Other `div` props go to the root. */
export interface GeoChoroplethProps extends Omit<React.ComponentProps<"div">, "defaultValue"> {
  /**
   * Values per country. Without it the map shows demo values for 41 countries. An empty array shows the plain base and
   * "No data". Unknown codes are skipped with one development warning; a code listed twice keeps its last value.
   */
  data?: readonly CountryValue[];
  /** The selected country code (controlled), or null. Use with `onValueChange`. */
  value?: string | null;
  /** The country selected at first when uncontrolled. */
  defaultValue?: string | null;
  /** Called with the upper-case code when a country is selected, and with null when the selection is cleared. */
  onValueChange?: (value: string | null) => void;
  /** Number of density classes, 3 to 7. Class `k` of `n` lights `(k + 1) / n` of a country's dots. */
  classes?: number;
  /** How values are split into classes: equal counts per class, equal value steps, or equal steps of the logarithm. */
  scale?: GeoChoroplethScale;
  /** Formats values in the list, the legend, the hover chip and the hidden table. */
  format?: (value: number) => string;
  /** Unit shown after values in the hover chip and the hidden table, and above the list. */
  unit?: string;
  /** Rows in the ranked list. 0 hides the list. */
  listSize?: number;
  /** The map projection. */
  projection?: GeoChoroplethProjection;
  /** Accessible name of the map, also the caption of the hidden table. */
  label?: string;
}

/**
 * Values per country as dot density. Each country's land dots switch on in a 4×4 ordered-dither pattern, so a higher
 * class reads as a denser print; countries without data stay as the plain base. When the data changes, every country
 * that moves to another class rebuilds its print dot by dot, outward from its middle, with a bright front where dots
 * switch. Pointing at a country runs a short light around its border and rolls its value in a chip, and the ranked
 * list beside the map follows. Small countries that get fewer than three dots are drawn as a 2×2 cluster at their
 * label point, so their values stay visible and can be pointed at.
 *
 * @example
 * <GeoChoropleth
 *   label="Requests by country"
 *   unit="requests"
 *   data={[{ code: "US", value: 412000 }, { code: "DE", value: 168000 }, { code: "JP", value: 118000 }]}
 *   onValueChange={(code) => setCountry(code)}
 * />
 */
export function GeoChoropleth({
  data,
  value,
  defaultValue = null,
  onValueChange,
  classes = 5,
  scale = "quantile",
  format = formatCompact,
  unit,
  listSize = 6,
  projection = "equalEarth",
  label = "Values by country",
  className,
  ...props
}: GeoChoroplethProps) {
  const [selected, setSelected] = useControllableState<string | null>({
    value: value === undefined ? undefined : normalizeCode(value),
    defaultValue: normalizeCode(defaultValue),
    onChange: onValueChange,
  });
  const reducedMotion = useReducedMotion();
  const baseId = React.useId();
  const classCount = Number.isFinite(classes) ? clamp(Math.round(classes), 3, 7) : 5;
  const rowCount = Number.isFinite(listSize) ? clamp(Math.round(listSize), 0, 50) : 6;
  const records = data ?? DEMO_DATA;
  const model = React.useMemo(() => buildModel(records, classCount, scale), [records, classCount, scale]);
  const { entries } = model;
  const texts = entries.map((entry) => format(entry.value));
  const textOf = (entry: Entry) => texts[entry.rank - 1];
  const withUnit = (text: string) => (unit ? `${text} ${unit}` : text);

  /** The country under the pointer, the keyboard focus on the map, or the list row in focus. */
  const [active, setActive] = React.useState<ActiveCountry | null>(null);
  /** Bumped when a country is selected, so its border light runs again even when it was already lit. */
  const [trace, setTrace] = React.useState(0);
  const [announcement, setAnnouncement] = React.useState("");

  const activeEntry = active ? (model.byCode.get(active.code) ?? null) : null;
  const selectedEntry = selected ? (model.byCode.get(selected) ?? null) : null;
  const shownEntry = activeEntry ?? selectedEntry;

  // The chip keeps its last country while it fades out.
  const [chipCode, setChipCode] = React.useState<string | null>(shownEntry?.code ?? null);
  if (shownEntry && shownEntry.code !== chipCode) setChipCode(shownEntry.code);
  const chipEntry = chipCode ? (model.byCode.get(chipCode) ?? null) : null;

  const rows = entries.slice(0, rowCount);
  // the country in focus gets its own row under the top rows when it is not among them
  const extraEntry = rowCount > 0 && shownEntry && shownEntry.rank > rowCount ? shownEntry : null;
  const options = extraEntry ? [...rows, extraEntry] : rows;
  const showList = rowCount > 0;

  const mapRef = React.useRef<HTMLDivElement>(null);
  const dotsRef = React.useRef<HTMLCanvasElement>(null);
  const lightRef = React.useRef<HTMLCanvasElement>(null);
  const chipRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  // created on first use, for the first projection; it holds the state of every country
  const engineRef = useLazyRef(() => createEngine(projection));

  const aspect = projectionAspect(projection, LAT_RANGE);
  const outlinePath = React.useMemo(() => outlineSvgPath(projection), [projection]);

  const loop = useAnimationLoop(mapRef, step);
  const palette = usePalette(mapRef, GEO_TOKENS, () => {
    // the loop re-reads the ink and repaints everything
    engineRef.current.inkStale = true;
    loop.kick();
  });

  // New data, classes or scale: every country whose level changes rebuilds its print. Declared before the canvases,
  // so the first lattice is laid out for the data and the first data dithers in from nothing.
  React.useEffect(() => {
    const state = engineRef.current;
    setTargets(state, model);
    const relayout = state.scene !== null && state.scene.codesKey !== model.codesKey;
    if (state.scene && relayout) {
      state.scene = layoutDots(state.scene.base, state.hasData, state.scene);
      state.fullPaint = true;
    }
    scheduleTransitions(state, prefersReducedMotion(), relayout);
    state.overlayDirty = true;
    loop.kick();
  }, [model, engineRef, loop]);

  const dots = useCanvas(
    dotsRef,
    (surface) => {
      rebuildScene(engineRef.current, surface);
      if (dotsRef.current) dotsRef.current.dataset.ready = "";
      loop.kick();
    },
    { maxDpr: 2 },
  );
  const light = useCanvas(
    lightRef,
    () => {
      engineRef.current.overlayDirty = true;
      loop.kick();
    },
    { maxDpr: 2 },
  );

  // Another projection needs another lattice.
  React.useEffect(() => {
    const state = engineRef.current;
    if (state.projection === projection) return;
    state.projection = projection;
    const surface = dots.current;
    if (!surface) return;
    rebuildScene(state, surface);
    loop.kick();
  }, [projection, dots, engineRef, loop]);

  // Unknown codes are skipped; say so once per data set while developing.
  const unknownKey = model.unknown.join(",");
  const warned = React.useRef("");
  React.useEffect(() => {
    if (!unknownKey || warned.current === unknownKey || process.env.NODE_ENV === "production") return;
    warned.current = unknownKey;
    console.warn(`GeoChoropleth: skipped unknown country codes: ${unknownKey.replaceAll(",", ", ")}.`);
  }, [unknownKey]);

  // The shown country gets the border light, the static outline and the chip.
  const shownIndex = shownEntry ? shownEntry.index : -1;
  const activeIndex = activeEntry ? activeEntry.index : -1;
  const selectedIndex = selectedEntry ? selectedEntry.index : -1;
  const chipAtPointer = active?.source === "pointer" && activeEntry !== null;
  React.useEffect(() => {
    const state = engineRef.current;
    const reduced = prefersReducedMotion();
    state.outlines.active = activeIndex;
    state.outlines.selected = selectedIndex;
    if (shownIndex !== state.light.country || trace !== state.light.trace) {
      state.light.country = shownIndex;
      state.light.trace = trace;
      // the loop stamps the start time on its next frame
      state.light.start = shownIndex >= 0 && !reduced ? LIGHT_PENDING : -1;
    }
    const chip = state.chip;
    if (shownIndex >= 0 && !chip.visible) chip.jump = true;
    chip.visible = shownIndex >= 0;
    chip.country = shownIndex;
    chip.atPointer = chipAtPointer;
    state.overlayDirty = true;
    loop.kick();
  }, [shownIndex, activeIndex, selectedIndex, chipAtPointer, trace, engineRef, loop]);

  // The chip is measured once per content change; the loop places it.
  const chipText = chipEntry ? textOf(chipEntry) : "";
  React.useLayoutEffect(() => {
    const element = chipRef.current;
    if (!element) return;
    engineRef.current.chip.width = element.offsetWidth;
    engineRef.current.chip.height = element.offsetHeight;
  }, [chipCode, chipText, unit, engineRef]);

  function step(time: number, delta: number) {
    const state = engineRef.current;
    const reduced = prefersReducedMotion();
    const scene = state.scene;
    if (state.inkStale && palette.current) {
      state.inkStale = false;
      state.ink = geoInk(palette.current);
      state.batch?.setRamp(rampOf(state.ink));
      state.fullPaint = true;
      state.overlayDirty = true;
    }
    if (state.light.start === LIGHT_PENDING) state.light.start = time;
    let busy = false;
    if (scene) {
      state.intro = false;
      busy = advanceCountries(state, scene, delta, reduced);
    }

    const surface = dots.current;
    if (scene && surface && state.ink) {
      state.batch ??= createDotBatch(scene.count, rampOf(state.ink), { tones: RAMP_TONES, levels: 32 });
      if (state.fullPaint) paintAll(surface, scene, state, state.batch);
      else if (state.dirty.size) paintDirty(surface, scene, state, state.batch);
      state.fullPaint = false;
      state.dirty.clear();
    }

    const overlay = light.current;
    if (overlay && state.ink && (state.overlayDirty || state.light.start >= 0)) {
      busy = paintOverlay(overlay, scene, state, state.ink, time, reduced) || busy;
      state.overlayDirty = false;
    }

    busy = moveChip(chipRef.current, scene, state, delta, reduced) || busy;
    return busy;
  }

  /* Interaction ------------------------------------------------------------------------------------- */

  function select(code: string | null) {
    setSelected(code);
    if (code) setTrace((count) => count + 1);
  }

  function describe(entry: Entry, isSelected: boolean) {
    const rank = `rank ${entry.rank} of ${entries.length}`;
    return `${entry.name}, ${withUnit(textOf(entry))}, ${rank}${isSelected ? ", selected" : ""}`;
  }

  function codeAt(x: number, y: number) {
    const scene = engineRef.current.scene;
    if (!scene) return null;
    const index = hitTest(scene, engineRef.current.hasData, x, y);
    return index >= 0 ? COUNTRIES[index].code : null;
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") return;
    // the map's own px: localPoint undoes CSS zoom on an ancestor
    const point = localPoint(event.currentTarget, event.clientX, event.clientY);
    const chip = engineRef.current.chip;
    chip.pointerX = point.x;
    chip.pointerY = point.y;
    const code = codeAt(point.x, point.y);
    if (code) {
      if (active?.code !== code || active.source !== "pointer") setActive({ code, source: "pointer" });
    } else if (active?.source === "pointer") {
      setActive(null);
    }
    loop.kick();
  }

  function handlePointerLeave() {
    if (active?.source === "pointer") setActive(null);
  }

  function handleMapClick(event: React.MouseEvent<HTMLDivElement>) {
    const point = localPoint(event.currentTarget, event.clientX, event.clientY);
    const code = codeAt(point.x, point.y);
    select(code && code !== selected ? code : null);
  }

  function handleMapKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const scene = engineRef.current.scene;
    const direction = ARROW_DIRECTIONS[event.key];
    if (direction) {
      event.preventDefault();
      if (!scene || !entries.length) return;
      const candidates = entries.filter((entry) => Number.isFinite(scene.anchorX[entry.index]));
      if (!candidates.length) return;
      const points = candidates.map((entry) => ({ x: scene.anchorX[entry.index], y: scene.anchorY[entry.index] }));
      const fromCode = active?.source === "map-key" ? active.code : (selected ?? null);
      const from = candidates.findIndex((entry) => entry.code === fromCode);
      const next = from < 0 ? candidates[0] : candidates[spatialNavigate(points, from, direction)];
      setActive({ code: next.code, source: "map-key" });
      setAnnouncement(describe(next, next.code === selected));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (activeEntry) {
        select(activeEntry.code);
        setAnnouncement(describe(activeEntry, true));
      }
      return;
    }
    if (event.key === "Escape" && (selected || active)) {
      event.preventDefault();
      select(null);
      setActive(null);
      setAnnouncement("Selection cleared");
    }
  }

  function handleMapBlur() {
    if (active?.source === "map-key") setActive(null);
  }

  function handleListKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!options.length) return;
    const current = active ? options.findIndex((entry) => entry.code === active.code) : -1;
    const start =
      current >= 0
        ? current
        : Math.max(
            0,
            options.findIndex((entry) => entry.code === selected),
          );
    let next = -1;
    if (event.key === "ArrowDown") next = current < 0 ? start : Math.min(options.length - 1, current + 1);
    else if (event.key === "ArrowUp") next = current < 0 ? start : Math.max(0, current - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    if (next >= 0) {
      event.preventDefault();
      setActive({ code: options[next].code, source: "list" });
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && current >= 0) {
      event.preventDefault();
      select(options[current].code);
      return;
    }
    if (event.key === "Escape" && (selected || active)) {
      event.preventDefault();
      select(null);
      setActive(null);
    }
  }

  function handleListFocus(event: React.FocusEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || active?.source === "list" || !options.length) return;
    const start = options.findIndex((entry) => entry.code === selected);
    setActive({ code: options[Math.max(0, start)].code, source: "list" });
  }

  function handleListBlur() {
    if (active?.source === "list") setActive(null);
  }

  function handleListPointerLeave() {
    if (active?.source === "list" && document.activeElement !== listRef.current) setActive(null);
  }

  const optionId = (code: string) => `${baseId}-row-${code}`;
  const activeOption =
    active && options.some((entry) => entry.code === active.code) ? optionId(active.code) : undefined;
  const legendLevels = Array.from({ length: classCount }, (_, i) => (i + 1) / classCount);

  return (
    <div
      data-slot="geo-choropleth"
      className={cn(
        "@container grid w-full max-w-[660px] gap-3 rounded-xl border border-border bg-card p-3 text-[13px] leading-[1.35] text-card-foreground",
        className,
      )}
      {...props}
    >
      {/* the card is at least 560px wide when its content box reaches 534px */}
      <div className={cn("grid gap-3", showList && "@[534px]:grid-cols-[minmax(0,1fr)_180px] @[534px]:items-center")}>
        <div
          ref={mapRef}
          tabIndex={0}
          role="group"
          aria-roledescription="map"
          aria-label={label}
          aria-describedby={`${baseId}-hint`}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          onClick={handleMapClick}
          onKeyDown={handleMapKeyDown}
          onBlur={handleMapBlur}
          data-hover={chipAtPointer ? "" : undefined}
          className="relative w-full touch-manipulation rounded-lg outline-none select-none [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lumesec focus-visible:outline-solid data-[hover]:cursor-pointer"
          style={{ aspectRatio: aspect }}
        >
          <svg
            aria-hidden="true"
            viewBox={`0 0 ${OUTLINE_WIDTH} ${round2(OUTLINE_WIDTH / aspect)}`}
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 size-full overflow-visible text-border"
          >
            <path d={outlinePath} fill="none" stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          </svg>
          <canvas
            ref={dotsRef}
            aria-hidden="true"
            className="absolute inset-0 block size-full opacity-0 transition-opacity duration-500 ease-out data-[ready]:opacity-100 motion-reduce:transition-none"
          />
          <canvas
            ref={lightRef}
            aria-hidden="true"
            className="pointer-events-none absolute -inset-2 block h-[calc(100%+16px)] w-[calc(100%+16px)]"
          />
          {!entries.length ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <span className="rounded-md border border-border bg-card px-2 py-0.5 text-[12px] text-muted-foreground">
                No data
              </span>
            </div>
          ) : null}
          <div
            ref={chipRef}
            aria-hidden="true"
            data-visible={shownEntry ? "" : undefined}
            className="pointer-events-none absolute top-0 left-0 z-10 flex items-center gap-2 rounded-md border border-border bg-popover px-2 py-[3px] text-[12px] leading-[18px] whitespace-nowrap text-popover-foreground opacity-0 shadow-[0_8px_24px_-12px_rgb(0_0_0/0.35)] transition-opacity duration-150 will-change-transform data-[visible]:opacity-100 motion-reduce:transition-none"
          >
            {chipEntry ? (
              <>
                <span className="font-medium">{chipEntry.name}</span>
                <span className="flex items-baseline gap-1">
                  <ValueRoll value={chipEntry.value} text={textOf(chipEntry)} className="font-mono tabular-nums" />
                  {unit ? <span className="text-muted-foreground">{unit}</span> : null}
                </span>
              </>
            ) : null}
          </div>
          <span id={`${baseId}-hint`} className="sr-only">
            Arrow keys move between countries with data, Enter selects, Escape clears the selection.
          </span>
          <span aria-live="polite" className="sr-only">
            {announcement}
          </span>
        </div>

        {showList ? (
          <div className="grid min-w-0 content-start gap-1">
            <div className="flex items-baseline justify-between gap-2 px-2 text-[11.5px] text-muted-foreground">
              <span>{entries.length ? `Top ${rows.length}` : "Ranked"}</span>
              {unit ? <span className="truncate">{unit}</span> : null}
            </div>
            <div
              ref={listRef}
              role="listbox"
              tabIndex={entries.length ? 0 : -1}
              aria-label={`${label}, ranked`}
              aria-activedescendant={activeOption}
              onKeyDown={handleListKeyDown}
              onFocus={handleListFocus}
              onBlur={handleListBlur}
              onPointerLeave={handleListPointerLeave}
              className="grid rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid"
            >
              {rows.length ? (
                <RankedRows
                  entries={options}
                  extra={extraEntry}
                  textOf={textOf}
                  optionId={optionId}
                  activeCode={active?.code ?? null}
                  selectedCode={selectedEntry?.code ?? null}
                  reducedMotion={reducedMotion}
                  unit={unit}
                  onHover={(code) => setActive({ code, source: "list" })}
                  onChoose={(code) => select(code === selected ? null : code)}
                />
              ) : (
                <div className="px-2 py-1.5 text-[12.5px] text-muted-foreground">No data</div>
              )}
            </div>
            {/* keeps the room for the out-of-list row, so the card never changes height */}
            {rows.length > 0 && !extraEntry && rows.length < entries.length ? (
              <div aria-hidden="true" className="-mt-1 h-[29px]" />
            ) : null}
          </div>
        ) : null}
      </div>

      <Legend
        levels={entries.length ? legendLevels : []}
        breaks={entries.length ? model.breaks.map((value) => format(value)) : []}
      />

      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Country</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.code}>
              <th scope="row">{entry.name}</th>
              <td>{withUnit(textOf(entry))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* Ranked list ---------------------------------------------------------------------------------------- */

interface RankedRowsProps {
  entries: readonly Entry[];
  extra: Entry | null;
  textOf: (entry: Entry) => string;
  optionId: (code: string) => string;
  activeCode: string | null;
  selectedCode: string | null;
  reducedMotion: boolean;
  unit: string | undefined;
  onHover: (code: string) => void;
  onChoose: (code: string) => void;
}

/** The ranked rows. Rows that change rank slide to their new place on a spring (FLIP). */
function RankedRows({
  entries,
  extra,
  textOf,
  optionId,
  activeCode,
  selectedCode,
  reducedMotion,
  unit,
  onHover,
  onChoose,
}: RankedRowsProps) {
  const nodes = React.useRef(new Map<string, HTMLDivElement>());
  const tops = React.useRef(new Map<string, number>());
  const order = entries.map((entry) => entry.code).join(",");

  React.useLayoutEffect(() => {
    const previous = tops.current;
    const next = new Map<string, number>();
    let entering = 0;
    for (const [code, node] of nodes.current) {
      const top = node.offsetTop;
      next.set(code, top);
      if (reducedMotion || typeof node.animate !== "function" || previous.size === 0) continue;
      const before = previous.get(code);
      if (before === undefined) {
        node.animate(
          [
            { opacity: 0, transform: "translateY(6px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 320, delay: 40 * entering++, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" },
        );
      } else if (before !== top) {
        node.animate([{ transform: `translateY(${before - top}px)` }, { transform: "none" }], {
          duration: 560,
          easing: "cubic-bezier(.3,1.2,.4,1)",
        });
      }
    }
    tops.current = next;
  }, [order, reducedMotion]);

  return entries.map((entry) => {
    const isExtra = entry === extra;
    const isSelected = entry.code === selectedCode;
    return (
      <div
        key={entry.code}
        ref={(node) => {
          if (node) nodes.current.set(entry.code, node);
          else nodes.current.delete(entry.code);
        }}
        id={optionId(entry.code)}
        role="option"
        aria-selected={isSelected}
        aria-label={`${entry.name}, ${textOf(entry)}${unit ? ` ${unit}` : ""}, rank ${entry.rank}`}
        data-active={entry.code === activeCode ? "" : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch") onHover(entry.code);
        }}
        onClick={() => onChoose(entry.code)}
        className={cn(
          "relative grid h-6 cursor-pointer grid-cols-[14px_minmax(0,1fr)_auto_14px] items-center gap-x-1.5 rounded-md pr-1.5 pl-1 transition-colors duration-150 data-[active]:bg-muted motion-reduce:transition-none",
          isExtra &&
            "mt-[5px] before:pointer-events-none before:absolute before:inset-x-1 before:-top-[3px] before:border-t before:border-dashed before:border-border",
        )}
      >
        <span
          className={cn(
            "text-right font-mono text-[10.5px] text-muted-foreground tabular-nums",
            isSelected && "font-medium text-lumesec",
          )}
        >
          {entry.rank}
        </span>
        <span
          className={cn("truncate text-[12.5px]", isSelected ? "font-medium text-foreground" : "text-foreground/85")}
        >
          {entry.name}
        </span>
        <ValueRoll
          value={entry.value}
          text={textOf(entry)}
          className="justify-self-end font-mono text-[12px] tabular-nums"
        />
        <DitherTile level={entry.level} columns={4} rows={4} />
      </div>
    );
  });
}

/* Legend --------------------------------------------------------------------------------------------- */

/** Dots per legend tile row; the tiles join into one strip that gets denser to the right. */
const LEGEND_COLUMNS = 10;
const LEGEND_GAP = 2;

/**
 * One dither tile per class, joined into a strip that gets denser to the right: the lowest and the largest value at
 * its ends, the class breaks under the joins. Then the "No data" swatch.
 */
function Legend({ levels, breaks }: { levels: readonly number[]; breaks: readonly string[] }) {
  const tileWidth = LEGEND_COLUMNS * DOT_PITCH;
  const stride = tileWidth + LEGEND_GAP;
  const total = levels.length ? levels.length * stride - LEGEND_GAP : 0;
  const inner = breaks.slice(1, -1);
  const longest = inner.reduce((max, text) => Math.max(max, text.length), 0);
  // Geist Mono at 10.5px is about 6.3px per character: show every other break when neighbours would touch
  const every = longest * 6.3 > stride - 3 ? 2 : 1;
  const ends = "font-mono text-[10.5px] leading-[14px] tabular-nums text-muted-foreground";
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-2">
      {levels.length ? (
        <div className="grid grid-cols-[auto_auto_auto] items-center gap-x-1.5 gap-y-1">
          <span className={cn(ends, "text-right")}>{breaks[0]}</span>
          <div className="flex" style={{ gap: LEGEND_GAP }}>
            {levels.map((level, i) => (
              <DitherTile key={i} level={level} columns={LEGEND_COLUMNS} rows={4} offset={i * LEGEND_COLUMNS} />
            ))}
          </div>
          <span className={ends}>{breaks[breaks.length - 1]}</span>
          <div aria-hidden="true" className={cn(ends, "relative col-start-2 h-3.5")} style={{ width: total }}>
            {inner.map((text, i) =>
              (i + 1) % every === 0 ? (
                <span
                  key={i}
                  className="absolute top-0 -translate-x-1/2 whitespace-nowrap"
                  style={{ left: (i + 1) * stride - LEGEND_GAP / 2 }}
                >
                  {text}
                </span>
              ) : null,
            )}
          </div>
        </div>
      ) : null}
      <div className="flex h-3.5 items-center gap-2 text-[11.5px] leading-[14px] text-muted-foreground">
        <DitherTile level={null} columns={4} rows={4} />
        No data
      </div>
    </div>
  );
}

/**
 * A tile of dots lit in the same 4×4 ordered-dither pattern as the map. When the level changes, dots switch one after
 * another in dither order (rising) or in reverse order (falling), like a country on the map.
 */
function DitherTile({
  level,
  columns,
  rows,
  offset = 0,
}: {
  level: number | null;
  columns: number;
  rows: number;
  offset?: number;
}) {
  const [state, setState] = React.useState({ level, direction: 1 });
  if (state.level !== level) setState({ level, direction: (level ?? 0) >= (state.level ?? 0) ? 1 : -1 });
  const width = columns * DOT_PITCH;
  const height = rows * DOT_PITCH;
  const inset = (DOT_PITCH - TILE_DOT) / 2;
  const dots: React.ReactNode[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const order = BAYER4[(row & 3) * 4 + ((column + offset) & 3)];
      const lit = level !== null && bayer4(row, column + offset) < level;
      const delay = (state.direction > 0 ? order : 15 - order) * 22;
      dots.push(
        <rect
          key={`${row}:${column}`}
          x={column * DOT_PITCH + inset}
          y={row * DOT_PITCH + inset}
          width={TILE_DOT}
          height={TILE_DOT}
          className={cn(
            "transition-[fill,fill-opacity] duration-150 ease-out motion-reduce:transition-none",
            lit ? "fill-lumesec" : "fill-[color-mix(in_srgb,var(--muted-foreground)_70%,var(--card))]",
          )}
          style={{
            fillOpacity: lit && level !== null ? 0.35 + 0.55 * level : level === null ? NO_DATA_ALPHA : UNLIT_ALPHA,
            transitionDelay: `${delay}ms`,
          }}
        />,
      );
    }
  }
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="block flex-none"
      shapeRendering="crispEdges"
    >
      {dots}
    </svg>
  );
}

/** Rolling value text that rolls up when the value grows and down when it shrinks. */
function ValueRoll({ value, text, className }: { value: number; text: string; className?: string }) {
  const [state, setState] = React.useState({ value, direction: 1 });
  if (state.value !== value) setState({ value, direction: value >= state.value ? 1 : -1 });
  return <RollText text={text} direction={state.direction} className={className} />;
}

/* Data model ----------------------------------------------------------------------------------------- */

interface Entry {
  readonly code: string;
  /** Index into COUNTRIES. */
  readonly index: number;
  readonly name: string;
  readonly value: number;
  /** 1 is the largest value. */
  readonly rank: number;
  /** Density class, 0 to classes − 1. */
  readonly klass: number;
  /** Target dot level: (class + 1) / classes. */
  readonly level: number;
}

interface Model {
  /** Countries with data, largest value first. */
  readonly entries: readonly Entry[];
  readonly byCode: ReadonlyMap<string, Entry>;
  /** classes + 1 values: the lowest value, the class boundaries and the largest value. */
  readonly breaks: readonly number[];
  readonly unknown: readonly string[];
  /** The sorted codes with data; the cluster layout depends on it. */
  readonly codesKey: string;
}

interface ActiveCountry {
  code: string;
  source: "pointer" | "map-key" | "list";
}

function normalizeCode(code: string | null | undefined) {
  return code ? code.trim().toUpperCase() : null;
}

function buildModel(records: readonly CountryValue[], classes: number, scale: GeoChoroplethScale): Model {
  const values = new Map<number, number>();
  const unknown: string[] = [];
  for (const record of records) {
    if (!record || typeof record.code !== "string") continue;
    const index = countryIndex(record.code.trim());
    if (index < 0) {
      if (!unknown.includes(record.code)) unknown.push(record.code);
      continue;
    }
    if (typeof record.value !== "number" || !Number.isFinite(record.value)) continue;
    values.set(index, record.value);
  }
  const list = [...values.values()];
  const classify = classifier(list, classes, scale);
  const sorted = [...values.entries()].sort(
    ([a, va], [b, vb]) => vb - va || COUNTRIES[a].name.localeCompare(COUNTRIES[b].name),
  );
  const entries = sorted.map(([index, value], i): Entry => {
    const klass = classify.classOf(value);
    return {
      code: COUNTRIES[index].code,
      index,
      name: COUNTRIES[index].name,
      value,
      rank: i + 1,
      klass,
      level: (klass + 1) / classes,
    };
  });
  return {
    entries,
    byCode: new Map(entries.map((entry) => [entry.code, entry])),
    breaks: classify.breaks,
    unknown,
    codesKey: entries
      .map((entry) => entry.code)
      .sort()
      .join(","),
  };
}

/** Class of a value and the class breaks for quantile, linear and log scales. */
function classifier(values: readonly number[], classes: number, scale: GeoChoroplethScale) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const min = n ? sorted[0] : 0;
  const max = n ? sorted[n - 1] : 0;
  const top = classes - 1;
  if (scale === "quantile") {
    // the middle rank of a value among equal values, so ties share a class
    const classOf = (value: number) => {
      if (n <= 1) return top;
      let below = 0;
      let equal = 0;
      for (const other of sorted) {
        if (other < value) below++;
        else if (other === value) equal++;
      }
      const position = (below + Math.max(0, equal - 1) / 2) / (n - 1);
      return Math.min(top, Math.floor(position * classes));
    };
    const breaks = Array.from({ length: classes + 1 }, (_, i) => (n ? quantile(sorted, i / classes) : 0));
    return { classOf, breaks };
  }
  if (scale === "log") {
    const positive = sorted.filter((v) => v > 0);
    const low = positive.length ? Math.log(positive[0]) : 0;
    const high = positive.length ? Math.log(positive[positive.length - 1]) : 0;
    const classOf = (value: number) => {
      if (high <= low) return top;
      if (value <= 0) return 0;
      return Math.min(top, Math.max(0, Math.floor(((Math.log(value) - low) / (high - low)) * classes)));
    };
    const breaks = Array.from({ length: classes + 1 }, (_, i) => Math.exp(low + ((high - low) * i) / classes));
    return { classOf, breaks: positive.length ? breaks : breaks.map(() => 0) };
  }
  const classOf = (value: number) =>
    max <= min ? top : Math.min(top, Math.floor(((value - min) / (max - min)) * classes));
  const breaks = Array.from({ length: classes + 1 }, (_, i) => min + ((max - min) * i) / classes);
  return { classOf, breaks };
}

/* Map scene ------------------------------------------------------------------------------------------ */

/** Latitude crop: the inhabited world without Antarctica, so the dots stay large. */
const LAT_RANGE: readonly [number, number] = [-56, 78];
/** Lattice pitch and dot sizes in CSS px. */
const DOT_PITCH = 3.5;
const DOT_SIZE = 2;
/** Front dots draw this much larger. */
const FRONT_GROW = 0.6;
/** Dot size inside the SVG tiles of the list and the legend. */
const TILE_DOT = 2;
/** Countries with data that get fewer dots than this are drawn as a 2×2 cluster. */
const SMALL_COUNTRY = 3;
/** Base alpha of the unlit dots: countries with data, then countries without. */
const UNLIT_ALPHA = 0.5;
const NO_DATA_ALPHA = 0.35;
/** The overlay canvas reaches this far past the map, so border light near the edge is not cut. */
const OVERLAY_PAD = 8;
/** Width of the SVG outline's viewBox; the height follows the projection's aspect. */
const OUTLINE_WIDTH = 1000;

/** Each country's print is a spring from its old to its new level (progress 0 to 1). */
const LEVEL_STIFFNESS = 64;
const LEVEL_DAMPING = 0.9;
/** Seconds between the starts of countries, the largest change first. */
const STAGGER = 0.025;
/** Share of the progress over which the change travels from the country's middle to its far edge. */
const SPREAD = 0.78;
/** How far toward the accent the dots in the moving front brighten (0 to 0.5). */
const FRONT_BAND = 0.3;
/** Half-width of a switching dot's flare, in units of its own change (0 to 1). */
const FRONT_WINDOW = 0.45;

/** Ramp of the dot batch: land at tone 0, the accent at 0.5, the glint at 1. */
const RAMP_TONES = 9;
const TONE_LAND = 0;
const TONE_ACCENT = 0.5;

/** Border light: the dash length and the run time. */
const LIGHT_DASH = 28;
const LIGHT_SECONDS = 0.7;
/** Light start marker: the loop sets the real start time on its next frame. */
const LIGHT_PENDING = -2;
const lightEase = cubicBezier(0.3, 0, 0.2, 1);

const round2 = (value: number) => Math.round(value * 100) / 100;

/** SVG path of the projection's border at a nominal width, for the server markup. */
function outlineSvgPath(kind: GeoChoroplethProjection) {
  const aspect = projectionAspect(kind, LAT_RANGE);
  return projectionOutlineSvgPath(
    createProjection(kind, { width: OUTLINE_WIDTH, height: round2(OUTLINE_WIDTH / aspect), latRange: LAT_RANGE }),
  );
}

/** The lattice for one canvas size: dot positions on the device grid, dither thresholds and owners. */
interface BaseScene {
  readonly projection: MapProjection;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly row: Int16Array;
  readonly column: Int16Array;
  readonly jitter: Float32Array;
  /** COUNTRIES index per dot, or −1. */
  readonly owner: Int16Array;
  /** Dots per country. */
  readonly counts: Int32Array;
  /** Lattice cell grid anchored to the projection frame: cell → dot index or −1. */
  readonly columns: number;
  readonly rows: number;
  readonly cells: Int32Array;
  /** Projected label point per country (NaN outside the map). */
  readonly labelX: Float32Array;
  readonly labelY: Float32Array;
  readonly dotSize: number;
  readonly frontSize: number;
}

/** The dots of the current data: the lattice plus the cluster dots of small countries, with their state. */
interface Scene {
  readonly base: BaseScene;
  readonly codesKey: string;
  readonly count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly threshold: Float32Array;
  /** Effective owner per dot after clusters claim their cells. */
  readonly owner: Int16Array;
  /** 1 for cluster dots outside the land lattice; they only show while their country has data. */
  readonly added: Uint8Array;
  /** Order in which a dot changes, 0 (the middle) to 1 (the far edge, a little uneven). */
  readonly reach: Float32Array;
  /** Dot level and presence (1 with data), and their values when the current change started. */
  readonly level: Float32Array;
  readonly levelFrom: Float32Array;
  readonly presence: Float32Array;
  readonly presenceFrom: Float32Array;
  /** The dot's own progress through the current change, 0 to 1. */
  readonly progress: Float32Array;
  /** Dots of country c: order[start[c]] to order[start[c + 1] − 1]. */
  readonly start: Int32Array;
  readonly order: Int32Array;
  readonly cells: Int32Array;
  /** Where a country's chip, keyboard focus and light anchor: its label point or its cluster's centre. */
  readonly anchorX: Float32Array;
  readonly anchorY: Float32Array;
  /** Cluster box per country (x0, y0, x1, y1), NaN when not clustered. */
  readonly clusterBox: Float32Array;
}

interface CountryMotion {
  /** Level the country moves to: its class level, 0 without data. */
  target: number;
  /** 1 with data, 0 without. */
  presence: number;
  /** Spring progress through the change, 0 to 1. */
  position: number;
  velocity: number;
  /** Seconds before the change starts (stagger). */
  delay: number;
}

interface Engine {
  projection: GeoChoroplethProjection;
  scene: Scene | null;
  ink: GeoInk | null;
  /** Set when the theme changed; the loop re-reads the ink. */
  inkStale: boolean;
  batch: DotBatch | null;
  /** True until the first lattice is built: the first data then dithers in from nothing. */
  intro: boolean;
  motion: CountryMotion[];
  /** Target level per country and whether it has data. */
  targets: Float32Array;
  hasData: Uint8Array;
  /** Rank per country (1 is the largest value), so equal changes start with the larger value. */
  ranks: Int32Array;
  codesKey: string;
  running: Set<number>;
  dirty: Set<number>;
  fullPaint: boolean;
  overlayDirty: boolean;
  outlines: { active: number; selected: number };
  /** The border light: its country, the selection count that started it, and its start in seconds (−1: none). */
  light: { country: number; trace: number; start: number };
  chip: ChipMotion;
  outlineCache: Map<string, { path: Path2D; length: number }>;
}

interface ChipMotion {
  visible: boolean;
  country: number;
  atPointer: boolean;
  /** Place at once instead of springing (it was hidden). */
  jump: boolean;
  pointerX: number;
  pointerY: number;
  x: { position: number; velocity: number };
  y: { position: number; velocity: number };
  width: number;
  height: number;
}

function createEngine(projection: GeoChoroplethProjection): Engine {
  return {
    projection,
    scene: null,
    ink: null,
    inkStale: true,
    batch: null,
    intro: true,
    motion: COUNTRIES.map(() => ({ target: 0, presence: 0, position: 1, velocity: 0, delay: 0 })),
    targets: new Float32Array(COUNTRIES.length),
    hasData: new Uint8Array(COUNTRIES.length),
    ranks: new Int32Array(COUNTRIES.length),
    codesKey: "",
    running: new Set(),
    dirty: new Set(),
    fullPaint: true,
    overlayDirty: true,
    outlines: { active: -1, selected: -1 },
    light: { country: -1, trace: 0, start: -1 },
    chip: {
      visible: false,
      country: -1,
      atPointer: false,
      jump: true,
      pointerX: 0,
      pointerY: 0,
      x: { position: 0, velocity: 0 },
      y: { position: 0, velocity: 0 },
      width: 0,
      height: 0,
    },
    outlineCache: new Map(),
  };
}

function setTargets(state: Engine, model: Model) {
  state.targets.fill(0);
  state.hasData.fill(0);
  state.ranks.fill(COUNTRIES.length + 1);
  for (const entry of model.entries) {
    state.targets[entry.index] = entry.level;
    state.hasData[entry.index] = 1;
    state.ranks[entry.index] = entry.rank;
  }
  state.codesKey = model.codesKey;
}

function buildBase(width: number, height: number, dpr: number, kind: GeoChoroplethProjection): BaseScene {
  const projection = createProjection(kind, { width, height, latRange: LAT_RANGE });
  const lattice = mapLattice(projection, { pitch: DOT_PITCH, layout: "square" });
  const owner = Int16Array.from(countryMembership(lattice));
  // A land dot on the coast can have its centre just outside every outline: give it to the country around it.
  for (let i = 0; i < lattice.count; i++) {
    if (owner[i] < 0) owner[i] = nearbyCountry(projection, lattice.x[i], lattice.y[i]);
  }
  const counts = new Int32Array(COUNTRIES.length);
  for (let i = 0; i < lattice.count; i++) if (owner[i] >= 0) counts[owner[i]]++;

  const frame = projection.frame;
  const columns = Math.floor((frame.x1 - frame.x0) / DOT_PITCH) + 1;
  const rows = Math.floor((frame.y1 - frame.y0) / DOT_PITCH) + 1;
  const cells = new Int32Array(columns * rows).fill(-1);
  const dotSize = snapSize(DOT_SIZE, dpr);
  const x = new Float32Array(lattice.count);
  const y = new Float32Array(lattice.count);
  for (let i = 0; i < lattice.count; i++) {
    // centre each dot so its left and top edges fall on device pixels: crisp squares
    x[i] = snapCenter(lattice.x[i], dotSize, dpr);
    y[i] = snapCenter(lattice.y[i], dotSize, dpr);
    const row = lattice.row[i];
    const column = lattice.column[i];
    if (row >= 0 && row < rows && column >= 0 && column < columns) cells[row * columns + column] = i;
  }
  const labelX = new Float32Array(COUNTRIES.length).fill(Number.NaN);
  const labelY = new Float32Array(COUNTRIES.length).fill(Number.NaN);
  const point = createScreenPoint();
  COUNTRIES.forEach((country, index) => {
    // wrapped, so a label longitude given past 180° still lands on the map
    if (projection.project(country.lat, wrapLongitude(country.lon), point)) {
      labelX[index] = point.x;
      labelY[index] = point.y;
    }
  });
  return {
    projection,
    width,
    height,
    dpr,
    count: lattice.count,
    x,
    y,
    row: lattice.row,
    column: lattice.column,
    jitter: lattice.jitter,
    owner,
    counts,
    columns,
    rows,
    cells,
    labelX,
    labelY,
    dotSize,
    frontSize: snapSize(DOT_SIZE + FRONT_GROW, dpr),
  };
}

/** The country most of the eight points around a dot fall in, or −1. */
function nearbyCountry(projection: MapProjection, x: number, y: number) {
  const votes = new Map<number, number>();
  let best = -1;
  let bestVotes = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const point = projection.invert(x + dx * DOT_PITCH * 0.35, y + dy * DOT_PITCH * 0.35);
      const country = point ? countryAt(point.lat, point.lon) : undefined;
      if (!country) continue;
      const index = countryIndex(country.code);
      const count = (votes.get(index) ?? 0) + 1;
      votes.set(index, count);
      if (count > bestVotes) {
        bestVotes = count;
        best = index;
      }
    }
  }
  return best;
}

/**
 * Builds the lattice for a canvas size and lays out the dots for the current data. The first build starts every dot
 * at nothing, so the data dithers in; later builds (resize, projection) show the targets at once.
 */
function rebuildScene(state: Engine, surface: CanvasSurface) {
  // the intro ends with the first frame the loop draws (not here: effects may run twice while developing)
  const animate = state.intro && !prefersReducedMotion();
  state.scene = layoutDots(
    buildBase(surface.width, surface.height, surface.dpr, state.projection),
    state.hasData,
    null,
  );
  state.running.clear();
  scheduleTransitions(state, !animate, true);
  state.fullPaint = true;
  state.overlayDirty = true;
  state.chip.jump = true;
}

/**
 * Places a 2×2 cluster for every small country with data and builds the dot arrays. Clusters sit at the label point,
 * or move up to two cells to avoid another cluster and the dots of other countries with data. On the same lattice
 * (`previous`) the dots keep what they show; otherwise they start at nothing.
 */
function layoutDots(base: BaseScene, hasData: Uint8Array, previous: Scene | null): Scene {
  const { columns, rows, projection } = base;
  const frame = projection.frame;
  const cells = Int32Array.from(base.cells);
  const owner: number[] = Array.from(base.owner);
  const claimed = new Uint8Array(cells.length);
  const added: { row: number; column: number; owner: number }[] = [];
  const clusterBox = new Float32Array(COUNTRIES.length * 4).fill(Number.NaN);
  const anchorX = Float32Array.from(base.labelX);
  const anchorY = Float32Array.from(base.labelY);

  for (let c = 0; c < COUNTRIES.length; c++) {
    if (!hasData[c] || base.counts[c] >= SMALL_COUNTRY || !Number.isFinite(base.labelX[c])) continue;
    const gx = (base.labelX[c] - frame.x0) / DOT_PITCH - 0.5;
    const gy = (base.labelY[c] - frame.y0) / DOT_PITCH - 0.5;
    const column0 = Math.floor(gx);
    const row0 = Math.floor(gy);
    let bestCost = Infinity;
    let bestRow = -1;
    let bestColumn = -1;
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const row = row0 + dr;
        const column = column0 + dc;
        if (row < 0 || column < 0 || row + 1 >= rows || column + 1 >= columns) continue;
        let cost = (column + 0.5 - gx) ** 2 + (row + 0.5 - gy) ** 2;
        for (let k = 0; k < 4 && cost < Infinity; k++) {
          const cell = (row + (k >> 1)) * columns + column + (k & 1);
          if (claimed[cell]) cost = Infinity;
          const dot = cells[cell];
          if (dot < 0) continue;
          const other = owner[dot];
          if (other === c) cost -= 0.5;
          else if (other >= 0) cost += hasData[other] ? 4 : 0.6;
        }
        if (cost < bestCost) {
          bestCost = cost;
          bestRow = row;
          bestColumn = column;
        }
      }
    }
    if (bestRow < 0) continue;
    for (let k = 0; k < 4; k++) {
      const row = bestRow + (k >> 1);
      const column = bestColumn + (k & 1);
      const cell = row * columns + column;
      claimed[cell] = 1;
      if (cells[cell] >= 0) owner[cells[cell]] = c;
      else added.push({ row, column, owner: c });
    }
    const x0 = frame.x0 + (bestColumn + 0.5) * DOT_PITCH;
    const y0 = frame.y0 + (bestRow + 0.5) * DOT_PITCH;
    clusterBox.set([x0, y0, x0 + DOT_PITCH, y0 + DOT_PITCH], c * 4);
    anchorX[c] = x0 + DOT_PITCH / 2;
    anchorY[c] = y0 + DOT_PITCH / 2;
  }

  const count = base.count + added.length;
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const threshold = new Float32Array(count);
  const jitter = new Float32Array(count);
  const owners = new Int16Array(count);
  const extra = new Uint8Array(count);
  x.set(base.x);
  y.set(base.y);
  jitter.set(base.jitter);
  for (let i = 0; i < base.count; i++) {
    threshold[i] = bayer4(base.row[i], base.column[i]);
    owners[i] = owner[i];
  }
  added.forEach((dot, k) => {
    const i = base.count + k;
    const cx = frame.x0 + (dot.column + 0.5) * DOT_PITCH;
    const cy = frame.y0 + (dot.row + 0.5) * DOT_PITCH;
    x[i] = Math.round((cx - base.dotSize / 2) * base.dpr) / base.dpr + base.dotSize / 2;
    y[i] = Math.round((cy - base.dotSize / 2) * base.dpr) / base.dpr + base.dotSize / 2;
    threshold[i] = bayer4(dot.row, dot.column);
    jitter[i] = hash(dot.row * 31 + dot.column * 7 + 0.5);
    owners[i] = dot.owner;
    extra[i] = 1;
    cells[dot.row * columns + dot.column] = i;
  });

  // dots per country (counting sort), then each dot's reach from its country's anchor
  const start = new Int32Array(COUNTRIES.length + 1);
  for (let i = 0; i < count; i++) if (owners[i] >= 0) start[owners[i] + 1]++;
  for (let c = 0; c < COUNTRIES.length; c++) start[c + 1] += start[c];
  const fill = start.slice(0, COUNTRIES.length);
  const order = new Int32Array(start[COUNTRIES.length]);
  for (let i = 0; i < count; i++) if (owners[i] >= 0) order[fill[owners[i]]++] = i;
  const reach = new Float32Array(count);
  for (let c = 0; c < COUNTRIES.length; c++) {
    if (start[c] === start[c + 1]) continue;
    if (!Number.isFinite(clusterBox[c * 4])) anchorOnDots(c, start, order, x, y, anchorX, anchorY);
    const ax = anchorX[c];
    const ay = anchorY[c];
    let far = 0;
    for (let k = start[c]; k < start[c + 1]; k++) far = Math.max(far, Math.hypot(x[order[k]] - ax, y[order[k]] - ay));
    for (let k = start[c]; k < start[c + 1]; k++) {
      const i = order[k];
      const n = far > 0 ? Math.hypot(x[i] - ax, y[i] - ay) / far : 0;
      reach[i] = n * 0.82 + jitter[i] * 0.18;
    }
  }

  const level = new Float32Array(count);
  const presence = new Float32Array(count);
  if (previous && previous.base === base) {
    // same lattice: every dot keeps what it shows, cluster dots are new
    level.set(previous.level.subarray(0, base.count));
    presence.set(previous.presence.subarray(0, base.count));
  }
  return {
    base,
    codesKey: codesKeyOf(hasData),
    count,
    x,
    y,
    threshold,
    owner: owners,
    added: extra,
    reach,
    level,
    levelFrom: Float32Array.from(level),
    presence,
    presenceFrom: Float32Array.from(presence),
    progress: new Float32Array(count).fill(1),
    start,
    order,
    cells,
    anchorX,
    anchorY,
    clusterBox,
  };
}

/**
 * Keeps a country's anchor on its own dots: the label point when one of its dots is near it, else the dot nearest to
 * the centre of its dots (a label point off the map, or in a gap of the lattice).
 */
function anchorOnDots(
  country: number,
  start: Int32Array,
  order: Int32Array,
  x: Float32Array,
  y: Float32Array,
  anchorX: Float32Array,
  anchorY: Float32Array,
) {
  const lx = anchorX[country];
  const ly = anchorY[country];
  let sumX = 0;
  let sumY = 0;
  let nearLabel = Infinity;
  for (let k = start[country]; k < start[country + 1]; k++) {
    const i = order[k];
    sumX += x[i];
    sumY += y[i];
    if (Number.isFinite(lx)) nearLabel = Math.min(nearLabel, Math.hypot(x[i] - lx, y[i] - ly));
  }
  if (nearLabel <= DOT_PITCH * 1.5) return;
  const n = start[country + 1] - start[country];
  const cx = sumX / n;
  const cy = sumY / n;
  let best = order[start[country]];
  let bestDistance = Infinity;
  for (let k = start[country]; k < start[country + 1]; k++) {
    const i = order[k];
    const distance = Math.hypot(x[i] - cx, y[i] - cy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  anchorX[country] = x[best];
  anchorY[country] = y[best];
}

function codesKeyOf(hasData: Uint8Array) {
  const codes: string[] = [];
  for (let c = 0; c < COUNTRIES.length; c++) if (hasData[c]) codes.push(COUNTRIES[c].code);
  return codes.sort().join(",");
}

/**
 * Starts a change for every country whose dots do not show its target yet. The largest changes start first, 25 ms
 * apart. With `immediate` (reduced motion, a resize) the dots jump to the targets. `restart` also restarts countries
 * already on their way to the same target (after a relayout reset their dots).
 */
function scheduleTransitions(state: Engine, immediate: boolean, restart = false) {
  const scene = state.scene;
  if (!scene) return;
  const changes: { country: number; size: number }[] = [];
  for (let c = 0; c < COUNTRIES.length; c++) {
    const motion = state.motion[c];
    const target = state.targets[c];
    const presence = state.hasData[c];
    let size = 0;
    for (let k = scene.start[c]; k < scene.start[c + 1]; k++) {
      const i = scene.order[k];
      size = Math.max(size, Math.abs(scene.level[i] - target), Math.abs(scene.presence[i] - presence) * 0.25);
    }
    const retarget = motion.target !== target || motion.presence !== presence;
    motion.target = target;
    motion.presence = presence;
    if (size < 1e-4) continue;
    if (!retarget && !restart && !immediate && state.running.has(c)) continue;
    changes.push({ country: c, size });
  }
  changes.sort((a, b) => b.size - a.size || state.ranks[a.country] - state.ranks[b.country]);
  changes.forEach(({ country }, rank) => {
    const motion = state.motion[country];
    for (let k = scene.start[country]; k < scene.start[country + 1]; k++) {
      const i = scene.order[k];
      scene.levelFrom[i] = immediate ? motion.target : scene.level[i];
      scene.presenceFrom[i] = immediate ? motion.presence : scene.presence[i];
      if (immediate) {
        scene.level[i] = motion.target;
        scene.presence[i] = motion.presence;
        scene.progress[i] = 1;
      } else {
        scene.progress[i] = 0;
      }
    }
    motion.position = immediate ? 1 : 0;
    motion.velocity = 0;
    motion.delay = immediate ? 0 : rank * STAGGER;
    if (immediate) state.running.delete(country);
    else state.running.add(country);
    state.dirty.add(country);
  });
}

/** Steps every running country's spring and moves its dots. Returns whether any country is still changing. */
function advanceCountries(state: Engine, scene: Scene, delta: number, reduced: boolean) {
  let busy = false;
  for (const country of state.running) {
    const motion = state.motion[country];
    if (motion.delay > 0 && !reduced) {
      motion.delay -= delta;
      busy = true;
      if (motion.delay > 0) continue;
    }
    if (reduced) {
      motion.position = 1;
      motion.velocity = 0;
    } else {
      springStep(motion, 1, delta, LEVEL_STIFFNESS, LEVEL_DAMPING);
    }
    const done = Math.abs(1 - motion.position) < 1e-3 && Math.abs(motion.velocity) < 1e-2;
    if (done) {
      motion.position = 1;
      motion.velocity = 0;
    }
    const p = motion.position;
    for (let k = scene.start[country]; k < scene.start[country + 1]; k++) {
      const i = scene.order[k];
      const q = done ? 1 : clamp((p - scene.reach[i] * SPREAD) / (1 - SPREAD), 0, 1);
      scene.progress[i] = q;
      scene.level[i] = scene.levelFrom[i] + (motion.target - scene.levelFrom[i]) * q;
      scene.presence[i] = scene.presenceFrom[i] + (motion.presence - scene.presenceFrom[i]) * q;
    }
    state.dirty.add(country);
    if (done) state.running.delete(country);
    else busy = true;
  }
  return busy;
}

function rampOf(ink: GeoInk) {
  return [ink.land, ink.accent, ink.glint];
}

/** Queues dot i: lit in the accent when its level passes its dither threshold, bright while its threshold is crossed. */
function addDot(scene: Scene, state: Engine, batch: DotBatch, i: number) {
  const country = scene.owner[i];
  const level = scene.level[i];
  const threshold = scene.threshold[i];
  const presence = country >= 0 ? scene.presence[i] : 0;
  let tone = TONE_LAND;
  let alpha = NO_DATA_ALPHA + (UNLIT_ALPHA - NO_DATA_ALPHA) * presence;
  let size = scene.base.dotSize;
  let x = scene.x[i];
  let y = scene.y[i];
  if (level > threshold) {
    tone = TONE_ACCENT;
    alpha = 0.35 + 0.55 * level;
  }
  const q = scene.progress[i];
  if (country >= 0 && q > 0 && q < 1) {
    // the front passes this dot: every dot brightens a little toward the accent ...
    const band = Math.sin(Math.PI * q) * FRONT_BAND;
    tone = tone < TONE_ACCENT ? tone + (TONE_ACCENT - tone) * band * 2 : tone + (1 - tone) * band;
    alpha += band * 0.4;
    const from = scene.levelFrom[i];
    const to = state.motion[country].target;
    if ((from - threshold) * (to - threshold) < 0) {
      // ... and a dot that switches flares in the glint around the moment it crosses its threshold
      const crossing = (threshold - from) / (to - from);
      const glow = 1 - Math.abs(q - crossing) / FRONT_WINDOW;
      if (glow > 0) {
        tone = TONE_ACCENT + (1 - TONE_ACCENT) * glow;
        alpha = Math.max(alpha, 0.55 + 0.45 * glow);
        if (glow > 0.45) {
          const front = scene.base.frontSize;
          const dpr = scene.base.dpr;
          x = snapCenter(x, front, dpr);
          y = snapCenter(y, front, dpr);
          size = front;
        }
      }
    }
  }
  if (scene.added[i]) alpha *= presence;
  batch.add(x, y, size, tone, alpha);
}

function paintAll(surface: CanvasSurface, scene: Scene, state: Engine, batch: DotBatch) {
  const { context, width, height } = surface;
  context.clearRect(0, 0, width, height);
  for (let i = 0; i < scene.count; i++) addDot(scene, state, batch, i);
  batch.flush(context);
}

/** Repaints only the countries that changed: each dot's cell is cleared and the dot drawn again. */
function paintDirty(surface: CanvasSurface, scene: Scene, state: Engine, batch: DotBatch) {
  const { context } = surface;
  const clear = DOT_PITCH - 0.4;
  for (const country of state.dirty) {
    for (let k = scene.start[country]; k < scene.start[country + 1]; k++) {
      const i = scene.order[k];
      context.clearRect(scene.x[i] - clear / 2, scene.y[i] - clear / 2, clear, clear);
      addDot(scene, state, batch, i);
    }
  }
  batch.flush(context);
}

/** Static outline path of a country: its border, or a rounded box around its cluster. Cached per scene. */
function outlineOf(state: Engine, scene: Scene, country: number) {
  const key = `${country}|${scene.base.projection.key}|${scene.codesKey}`;
  const cached = state.outlineCache.get(key);
  if (cached) return cached;
  let result: { path: Path2D; length: number };
  const box = scene.clusterBox.subarray(country * 4, country * 4 + 4);
  if (Number.isFinite(box[0])) {
    const pad = DOT_SIZE / 2 + 2;
    const width = box[2] - box[0] + pad * 2;
    const height = box[3] - box[1] + pad * 2;
    const path = new Path2D();
    path.roundRect(box[0] - pad, box[1] - pad, width, height, 3);
    result = { path, length: 2 * (width + height) };
  } else {
    const outline = countryOutline(COUNTRIES[country].code, scene.base.projection);
    result = { path: outline.path, length: outline.length };
  }
  if (state.outlineCache.size > 64) state.outlineCache.clear();
  state.outlineCache.set(key, result);
  return result;
}

/**
 * The overlay: a 0.75px accent outline for the selected and the active country, and the border light, a short bright
 * dash that runs once around the shown country. Returns whether the light is still running.
 */
function paintOverlay(
  surface: CanvasSurface,
  scene: Scene | null,
  state: Engine,
  ink: GeoInk,
  time: number,
  reduced: boolean,
) {
  const { context, width, height } = surface;
  context.clearRect(0, 0, width, height);
  if (!scene) return false;
  const light = state.light;
  let t = 1;
  if (light.start >= 0 && !reduced) {
    t = (time - light.start) / LIGHT_SECONDS;
    if (t >= 1) light.start = -1;
  } else {
    light.start = -1;
  }
  const running = light.start >= 0 && light.country >= 0;
  context.save();
  context.translate(OVERLAY_PAD, OVERLAY_PAD);
  // outlines may run past the latitude crop (Arctic islands); the glow may still spill a little over the edge
  context.beginPath();
  context.rect(-3, -3, scene.base.width + 6, scene.base.height + 6);
  context.clip();
  context.lineJoin = "round";
  context.lineCap = "round";
  const drawn = new Set<number>();
  for (const country of [state.outlines.selected, state.outlines.active]) {
    if (country < 0 || drawn.has(country)) continue;
    drawn.add(country);
    const outline = outlineOf(state, scene, country);
    const fade = running && country === light.country ? smoothstep(0, 0.6, clamp(t, 0, 1)) : 1;
    context.globalAlpha = 0.9 * fade;
    context.strokeStyle = rgba(ink.accent);
    context.lineWidth = 0.75;
    context.stroke(outline.path);
  }
  if (running) {
    const outline = outlineOf(state, scene, light.country);
    const progress = lightEase(clamp(t, 0, 1));
    const fade = smoothstep(0, 0.08, t) * (1 - smoothstep(0.82, 1, t));
    context.setLineDash([LIGHT_DASH, outline.length]);
    context.lineDashOffset = -progress * outline.length;
    context.globalAlpha = 0.3 * fade;
    context.strokeStyle = rgba(ink.accent);
    context.lineWidth = 4;
    context.stroke(outline.path);
    context.globalAlpha = fade;
    context.strokeStyle = rgba(ink.glint);
    context.lineWidth = 1.5;
    context.stroke(outline.path);
    context.setLineDash([]);
  }
  context.restore();
  context.globalAlpha = 1;
  return running;
}

/**
 * Keeps the chip next to the pointer, or next to the country's anchor, inside the map. It follows on a stiff spring.
 * Returns whether it is still moving.
 */
function moveChip(element: HTMLDivElement | null, scene: Scene | null, state: Engine, delta: number, reduced: boolean) {
  const chip = state.chip;
  if (!element || !scene || !chip.visible || chip.country < 0) return false;
  const width = scene.base.width;
  const height = scene.base.height;
  const ax = chip.atPointer ? chip.pointerX : scene.anchorX[chip.country];
  const ay = chip.atPointer ? chip.pointerY : scene.anchorY[chip.country];
  if (!Number.isFinite(ax) || !Number.isFinite(ay)) return false;
  const gap = chip.atPointer ? 14 : 8;
  let tx = ax + gap;
  let ty = ay - chip.height - gap;
  if (tx + chip.width > width - 4) tx = ax - chip.width - gap;
  if (ty < 4) ty = ay + gap + (chip.atPointer ? 6 : 0);
  tx = clamp(tx, 4, Math.max(4, width - chip.width - 4));
  ty = clamp(ty, 4, Math.max(4, height - chip.height - 4));
  if (chip.jump || reduced) {
    chip.jump = false;
    chip.x.position = tx;
    chip.y.position = ty;
    chip.x.velocity = 0;
    chip.y.velocity = 0;
  } else {
    springStep(chip.x, tx, delta, 700, 0.9);
    springStep(chip.y, ty, delta, 700, 0.9);
  }
  element.style.transform = `translate3d(${chip.x.position.toFixed(1)}px,${chip.y.position.toFixed(1)}px,0)`;
  return (
    Math.abs(chip.x.position - tx) > 0.1 ||
    Math.abs(chip.y.position - ty) > 0.1 ||
    Math.abs(chip.x.velocity) + Math.abs(chip.y.velocity) > 1
  );
}

/** The country with data under (x, y): the owner of the nearest dot, else the country whose outline holds the point. */
function hitTest(scene: Scene, hasData: Uint8Array, x: number, y: number) {
  const frame = scene.base.projection.frame;
  const { columns, rows } = scene.base;
  const column = Math.round((x - frame.x0) / DOT_PITCH - 0.5);
  const row = Math.round((y - frame.y0) / DOT_PITCH - 0.5);
  let best = -1;
  let bestDistance = (DOT_PITCH * 1.6) ** 2;
  for (let r = row - 2; r <= row + 2; r++) {
    for (let c = column - 2; c <= column + 2; c++) {
      if (r < 0 || c < 0 || r >= rows || c >= columns) continue;
      const dot = scene.cells[r * columns + c];
      if (dot < 0) continue;
      const distance = (scene.x[dot] - x) ** 2 + (scene.y[dot] - y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = dot;
      }
    }
  }
  if (best >= 0) {
    const owner = scene.owner[best];
    if (owner >= 0 && hasData[owner]) return owner;
  }
  const point = scene.base.projection.invert(x, y);
  const country = point ? countryAt(point.lat, point.lon) : undefined;
  const index = country ? countryIndex(country.code) : -1;
  return index >= 0 && hasData[index] ? index : -1;
}

/* Demo data ------------------------------------------------------------------------------------------ */

/** Invented requests per day for 41 countries, shown while `data` is not set. */
const DEMO_DATA: readonly CountryValue[] = [
  { code: "US", value: 412000 },
  { code: "IN", value: 268000 },
  { code: "DE", value: 168000 },
  { code: "GB", value: 142000 },
  { code: "BR", value: 131000 },
  { code: "JP", value: 118000 },
  { code: "FR", value: 96000 },
  { code: "CA", value: 88000 },
  { code: "KR", value: 64000 },
  { code: "AU", value: 57000 },
  { code: "NL", value: 52000 },
  { code: "ID", value: 47000 },
  { code: "MX", value: 44000 },
  { code: "ES", value: 41000 },
  { code: "IT", value: 39000 },
  { code: "CN", value: 33000 },
  { code: "PL", value: 31000 },
  { code: "SE", value: 28000 },
  { code: "TR", value: 26000 },
  { code: "VN", value: 24000 },
  { code: "PH", value: 21000 },
  { code: "NG", value: 19000 },
  { code: "ZA", value: 17000 },
  { code: "AR", value: 16000 },
  { code: "SA", value: 15000 },
  { code: "AE", value: 14000 },
  { code: "EG", value: 12000 },
  { code: "CO", value: 11000 },
  { code: "TH", value: 10500 },
  { code: "UA", value: 9800 },
  { code: "IL", value: 9400 },
  { code: "NO", value: 8700 },
  { code: "FI", value: 7600 },
  { code: "CL", value: 7100 },
  { code: "PK", value: 6800 },
  { code: "KE", value: 5200 },
  { code: "MA", value: 4300 },
  { code: "PE", value: 3900 },
  { code: "KZ", value: 3100 },
  { code: "NZ", value: 2900 },
  { code: "RU", value: 2400 },
];
