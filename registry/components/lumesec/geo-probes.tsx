"use client";

import * as React from "react";

import { fillSquare, snap, snapSize, useCanvas, type CanvasSurface } from "@/lib/lumesec/canvas";
import { usePalette } from "@/lib/lumesec/color";
import {
  createDotBatch,
  createProjection,
  createScreenPoint,
  flatPaths,
  forEachDot,
  GEO_TOKENS,
  geoInk,
  isValidLatLon,
  mapLattice,
  pointAtDistance,
  projectionAspect,
  projectionOutlineSvgPath,
  ringFront,
  wrapLongitude,
  type ArcLengthTable,
  type DotBatch,
  type DotLattice,
  type GeoInk,
  type LatLon,
  type MapProjection,
} from "@/lib/lumesec/geo";
import {
  createRandom,
  demoLatency,
  findCity,
  formatMs,
  formatNumber,
  pickWeighted,
  quantile,
} from "@/lib/lumesec/geo-data";
import { clamp, easeOutCubic, hash, mixRgb, rgba, smoothstep, type RGB } from "@/lib/lumesec/math";
import {
  prefersReducedMotion,
  settleSpring,
  shake,
  useAnimationLoop,
  useInView,
  useLazyRef,
  useReducedMotion,
  type SettleSpringOptions,
  type Spring,
} from "@/lib/lumesec/motion";
import { RollText } from "@/lib/lumesec/roll-text";
import { Sparks } from "@/lib/lumesec/sparks";
import { cn } from "@/lib/utils";

/** The place every probe checks: a label for the map and the header, and its position in degrees. */
export interface ProbeTarget {
  /** Shown beside the target on the map and in the header, such as a region (`eu-central`) or a host name. */
  readonly label: string;
  /** Latitude in degrees, −90 to 90. */
  readonly lat: number;
  /** Longitude in degrees, −180 to 180. */
  readonly lon: number;
}

/** A location that runs the check. */
export interface ProbeSite {
  /** Unique id that `ProbeResult.probe` refers to. */
  readonly id: string;
  /** Shown in the ranked list, usually the city. */
  readonly label: string;
  /** Latitude in degrees, −90 to 90. */
  readonly lat: number;
  /** Longitude in degrees, −180 to 180. */
  readonly lon: number;
}

/** One probe's result in a round. */
export interface ProbeResult {
  /** Id of the probe (`ProbeSite.id`). */
  readonly probe: string;
  /** Measured round-trip time in milliseconds, or null when the check failed (a timeout). */
  readonly ms: number | null;
}

/** Props of GeoProbes; the remaining props go to the root `div`. */
export interface GeoProbesProps extends Omit<React.ComponentProps<"div">, "results"> {
  /** The place every probe checks. Default: `eu-central` at Frankfurt's coordinates. */
  target?: ProbeTarget;
  /** The locations that run the check. Default: 12 demo probes on every continent. An empty array shows "No probes". */
  probes?: readonly ProbeSite[];
  /**
   * The results of the latest round, one per probe; `ms: null` is a failed check. A new array with different results
   * starts a round; the first array is shown at once, without a round. Without `results` the component runs demo rounds.
   */
  results?: readonly ProbeResult[];
  /** Seconds between demo rounds (at least 3), while the component is on screen. Only used without `results`. */
  interval?: number;
  /** Animation milliseconds per measured millisecond: with 6, a 150 ms result takes 0.9 s to arrive. */
  timeScale?: number;
  /** Results at or above this many milliseconds are marked slow. */
  slowMs?: number;
  /**
   * Called by the Run check button. With `results`, the button then waits for a new array; without `onRun` and with
   * `results` there is no button. Without `results` the button also runs a demo round.
   */
  onRun?: () => void;
  /** Called with the round's valid results once every result has landed, or once the round completed early. */
  onRound?: (results: readonly ProbeResult[]) => void;
}

/**
 * Uptime checks from many locations against one target. Each round every probe fires at the same moment and the
 * arcs race to the target; each arrives after its own measured time (scaled by `timeScale`), so the order they land
 * in is the latency ranking. As a result lands, the land dots around the target pulse, its row slides into place in
 * the ranked list, its block drops onto the arrival timeline and the median and 95th percentile roll. A failed check
 * breaks off halfway with red sparks, and its row drops to the bottom as a timeout.
 *
 * Without `results` the component runs seeded demo rounds while it is on screen. Pass each round's results as a new
 * `results` array, and `onRun` to start a check from the Run check button.
 *
 * @example
 * <GeoProbes target={{ label: "api.example.com", lat: 50.11, lon: 8.68 }} probes={sites} results={latest} onRun={check} />
 */
export function GeoProbes({
  target: targetProp,
  probes: probesProp,
  results,
  interval = 10,
  timeScale: timeScaleProp = 6,
  slowMs: slowMsProp = 300,
  onRun,
  onRound,
  className,
  ...props
}: GeoProbesProps) {
  const mode: BoardMode = results === undefined ? "demo" : "data";
  const intervalMs = Number.isFinite(interval) ? Math.max(3, interval) * 1000 : 10_000;
  const timeScale = Number.isFinite(timeScaleProp) && timeScaleProp > 0 ? timeScaleProp : 6;
  const slowMs = Number.isFinite(slowMsProp) ? Math.max(0, slowMsProp) : 300;
  const reducedMotion = useReducedMotion();

  const cardRef = React.useRef<HTMLDivElement>(null);
  const inView = useInView(cardRef);
  /** Rounds that start (or are playing) while nobody can watch them complete at once. */
  const instant = reducedMotion || !inView;

  // Probes and target by content, so inline arrays and objects do not rebuild the map on every render.
  const probeSource = probesProp ?? DEMO_PROBES;
  const probesKey = probeListKey(probeSource);
  const [probeState, setProbeState] = React.useState(() => ({ key: probesKey, list: validProbes(probeSource) }));
  const probes = probeState.key === probesKey ? probeState.list : validProbes(probeSource);
  if (probeState.key !== probesKey) setProbeState({ key: probesKey, list: probes });

  const targetSource = targetProp ?? DEMO_TARGET;
  const targetKey = `${targetSource.label}|${targetSource.lat}|${targetSource.lon}`;
  const [targetState, setTargetState] = React.useState(() => ({ key: targetKey, target: validTarget(targetSource) }));
  const target = targetState.key === targetKey ? targetState.target : validTarget(targetSource);
  if (targetState.key !== targetKey) setTargetState({ key: targetKey, target });

  const [board, setBoard] = React.useState<Board>(() => initialBoard(mode, probes, probesKey, target, results));
  const [seenResults, setSeenResults] = React.useState(results);
  const [waiting, setWaiting] = React.useState(false);
  const [pointed, setPointed] = React.useState<string | null>(null);

  // Adjust the board while rendering: new probes, a switch between demo and data, a new results array, and a round
  // that nobody can watch (off screen, reduced motion) completing at once.
  let next = board;
  if (next.key !== probesKey) next = syncProbes(next, probes, probesKey);
  if (next.mode !== mode) next = switchMode(next, mode, probes, target, results, instant);
  else if (mode === "data" && results !== seenResults && !sameResults(results, seenResults)) {
    next = startRound(next, planFromResults(results ?? [], next.round + 1, probes), instant);
  }
  if (next.playing && instant) next = finishRound(next);
  if (next !== board) setBoard(next);
  if (results !== seenResults) {
    setSeenResults(results);
    if (waiting) setWaiting(false);
  }

  const view = React.useMemo(() => boardView(board, probes), [board, probes]);
  const busy = board.playing || waiting;

  const loop = useAnimationLoop(cardRef, step);
  /** The map engine, created on first use in an effect, handler or frame (never during render). */
  const engineRef = useLazyRef(() => new ProbesEngine());
  const palette = usePalette(cardRef, GEO_TOKENS, applyTheme);

  const baseRef = React.useRef<HTMLCanvasElement>(null);
  const arcsRef = React.useRef<HTMLCanvasElement>(null);
  const effectsRef = React.useRef<HTMLCanvasElement>(null);
  const stripRef = React.useRef<HTMLCanvasElement>(null);
  const listRef = React.useRef<HTMLOListElement>(null);
  const targetMarkerRef = React.useRef<HTMLSpanElement>(null);
  const progressRef = React.useRef<HTMLSpanElement>(null);
  const siteRefs = React.useRef(new Map<string, HTMLSpanElement>());
  const rowMotion = React.useRef(new Map<string, RowMotion>());
  const listMotion = React.useRef<TargetSpring>({ position: board.order.length, velocity: 0, target: board.order.length });
  const markerMotion = React.useRef<Record<Percentile, MarkerMotion>>({
    p50: { position: 0, velocity: 0, target: 0, origin: 0, shown: false, element: null },
    p95: { position: 0, velocity: 0, target: 0, origin: 0, shown: false, element: null },
  });
  const lastStart = React.useRef(-Infinity);
  const waitTimer = React.useRef(0);
  const onRoundRef = React.useRef(onRound);
  React.useEffect(() => {
    onRoundRef.current = onRound;
  });

  const base = useCanvas(
    baseRef,
    (surface) => {
      engineRef.current.layout(surface.width, surface.height, surface.dpr);
      loop.kick();
    },
    MAP_CANVAS,
  );
  const arcs = useCanvas(arcsRef, () => loop.kick(), MAP_CANVAS);
  const effects = useCanvas(
    effectsRef,
    (surface) => {
      // the map's top-left corner on the effects layer (offsets ignore the gallery's scale transform)
      engineRef.current.setEffectsOffset(-surface.canvas.offsetLeft, -surface.canvas.offsetTop);
      loop.kick();
    },
    MAP_CANVAS,
  );
  const strip = useCanvas(
    stripRef,
    (surface) => {
      engineRef.current.layoutStrip(surface.width, surface.height);
      loop.kick();
    },
    MAP_CANVAS,
  );

  function applyTheme() {
    if (palette.current) engineRef.current.setInk(geoInk(palette.current));
    loop.kick();
  }

  function step(_time: number, delta: number) {
    const reduced = prefersReducedMotion();
    let moving = engineRef.current.step(base.current, arcs.current, effects.current, strip.current, delta, reduced);
    if (stepRows(rowMotion.current, listMotion.current, listRef.current, delta, reduced)) moving = true;
    if (stepMarkers(markerMotion.current, strip.current?.width ?? 0, delta, reduced)) moving = true;
    return moving;
  }

  // The engine reports arrivals, cracks and the end of a round; the board follows.
  React.useEffect(() => {
    const engine = engineRef.current;
    // rounds are matched by their plan, so a late callback of an earlier round (or of the demo) never lands in a new one
    engine.onLand = (plan, id) => {
      setBoard((previous) => (previous.plan === plan ? landResult(previous, id, true) : previous));
      const marker = targetMarkerRef.current;
      if (marker && typeof marker.animate === "function" && !prefersReducedMotion()) {
        marker.animate(TARGET_PULSE_KEYFRAMES, { duration: 460, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
    };
    engine.onFail = (plan, id) => {
      setBoard((previous) => (previous.plan === plan ? failResult(previous, id, true) : previous));
    };
    engine.onFinish = (plan) => {
      setBoard((previous) => (previous.playing && previous.plan === plan ? finishRound(previous) : previous));
    };
  }, [engineRef]);

  React.useEffect(() => {
    engineRef.current.configure(probes, target);
    loop.kick();
  }, [probes, target, engineRef, loop]);

  // A new round: the volley starts and every probe that reports flashes. A round that ended early lets its trails go.
  React.useEffect(() => {
    const engine = engineRef.current;
    if (board.playing && board.plan) {
      if (engine.play(board.plan, timeScale, board.scale) && !prefersReducedMotion()) {
        for (const id of board.plan.ms.keys()) {
          const site = siteRefs.current.get(id);
          if (site && typeof site.animate === "function") site.animate(LAUNCH_KEYFRAMES, { duration: 700, easing: "cubic-bezier(.2,.8,.2,1)" });
        }
      }
    } else {
      engine.settle();
    }
    loop.kick();
  }, [board.playing, board.plan, board.scale, timeScale, engineRef, loop]);

  // The Run check button fills along the bottom while the round plays.
  React.useEffect(() => {
    const bar = progressRef.current;
    if (!board.playing || !board.plan || !bar || typeof bar.animate !== "function" || prefersReducedMotion()) return;
    const animation = bar.animate(PROGRESS_KEYFRAMES, { duration: Math.max(200, roundDuration(board.plan, timeScale)), easing: "linear", fill: "forwards" });
    return () => animation.cancel();
  }, [board.playing, board.plan, timeScale]);

  // Rows, bars and the list height spring toward the board; blocks on the timeline follow the landed results.
  React.useEffect(() => {
    const reduced = prefersReducedMotion();
    board.order.forEach((id, index) => {
      const row = rowMotion.current.get(id);
      if (!row) return;
      row.target = index;
      row.bar.target = barFraction(board.entries.get(id), board.scale);
      if (reduced) snapRow(row);
    });
    listMotion.current.target = board.order.length;
    engineRef.current.setStrip(landedResults(board), board.scale, slowMs);
    loop.kick();
  }, [board, slowMs, engineRef, loop]);

  React.useEffect(() => {
    const markers = markerMotion.current;
    aimMarker(markers.p50, view.p50 === null ? null : view.p50 / board.scale, prefersReducedMotion());
    aimMarker(markers.p95, view.p95 === null ? null : view.p95 / board.scale, prefersReducedMotion());
    loop.kick();
  }, [view.p50, view.p95, board.scale, loop]);

  React.useEffect(() => {
    engineRef.current.setHighlight(pointed);
    loop.kick();
  }, [pointed, engineRef, loop]);

  React.useEffect(() => {
    if (board.completed) onRoundRef.current?.(board.completed.results);
  }, [board.completed]);

  const startDemoRound = React.useCallback(() => {
    lastStart.current = performance.now();
    const reduced = prefersReducedMotion();
    setBoard((previous) =>
      previous.playing || previous.mode !== "demo" ? previous : startRound(previous, demoPlan(previous.round + 1, probes, target), reduced),
    );
  }, [probes, target]);

  // Demo rounds: the first when the map comes into view, then every `interval` seconds while it stays in view.
  const demo = mode === "demo";
  React.useEffect(() => {
    if (!demo || !inView || board.playing || probes.length === 0) return;
    const delay = board.round === 0 ? FIRST_ROUND_DELAY : Math.max(MIN_ROUND_GAP, intervalMs - (performance.now() - lastStart.current));
    const timer = window.setTimeout(startDemoRound, delay);
    return () => window.clearTimeout(timer);
  }, [demo, inView, board.playing, board.round, intervalMs, probes.length, startDemoRound]);

  React.useEffect(() => () => window.clearTimeout(waitTimer.current), []);

  function handleRun() {
    if (busy || probes.length === 0) return;
    if (demo) startDemoRound();
    onRun?.();
    if (!demo && onRun) {
      setWaiting(true);
      window.clearTimeout(waitTimer.current);
      waitTimer.current = window.setTimeout(() => setWaiting(false), WAIT_LIMIT_MS);
    }
  }

  const registerRow = React.useCallback<RegisterRow>((id, parts, origin, bar) => {
    const rows = rowMotion.current;
    if (!parts) {
      rows.delete(id);
      return;
    }
    const row = rows.get(id);
    if (row) {
      row.parts = parts;
      row.origin = origin;
      row.written = Number.NaN;
      return;
    }
    rows.set(id, {
      position: origin,
      velocity: 0,
      target: origin,
      origin,
      parts,
      written: Number.NaN,
      bar: { position: bar, velocity: 0, target: bar },
      barWritten: Number.NaN,
    });
  }, []);

  const registerMarker = React.useCallback((which: Percentile, element: HTMLSpanElement | null, origin: number) => {
    const marker = markerMotion.current[which];
    marker.element = element;
    marker.origin = origin;
  }, []);

  const registerSite = React.useCallback((id: string, element: HTMLSpanElement | null) => {
    if (element) siteRefs.current.set(id, element);
    else siteRefs.current.delete(id);
  }, []);

  const aspect = MAP_ASPECT;
  const layout = React.useMemo(() => mapLayout(probes, target), [probes, target]);
  const pointedSite = pointed ? layout.sites.find((site) => site.id === pointed) : undefined;
  const pointedProbe = pointed ? probes.find((probe) => probe.id === pointed) : undefined;
  const [listOrigin] = React.useState(board.order.length);
  const showButton = demo || Boolean(onRun);
  const ticks = scaleTicks(board.scale);

  return (
    <div data-slot="geo-probes" className={cn("@container grid w-full max-w-[660px] gap-2 text-foreground", className)} {...props}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[2px] bg-lumesec shadow-[0_0_0_2px_var(--background),0_0_0_3px_color-mix(in_srgb,var(--lumesec)_45%,transparent)]" />
          <span className="min-w-0 truncate text-[13.5px] leading-5 font-medium tracking-[-0.005em]">{target.label}</span>
          <span className="flex shrink-0 items-center gap-1 text-[12.5px] leading-5 text-muted-foreground">
            <span aria-hidden="true">Round</span>
            <span aria-hidden="true" className="font-mono text-[12.5px] text-foreground tabular-nums">
              <RollingValue text={board.round > 0 ? String(board.round) : "–"} value={board.round} animate={!reducedMotion} />
            </span>
            <span className="sr-only">{board.round > 0 ? `Round ${board.round}` : "No round yet"}</span>
          </span>
        </div>
        <div className="flex items-center gap-2 @max-[459px]:w-full">
          <StatChip label="p50" value={view.p50} animate={!reducedMotion} />
          <StatChip label="p95" value={view.p95} animate={!reducedMotion} />
          {showButton ? (
            <button
              type="button"
              aria-disabled={busy || probes.length === 0 || undefined}
              onClick={handleRun}
              className="relative inline-flex h-[30px] shrink-0 cursor-pointer items-center gap-1.5 overflow-hidden rounded-lg border border-border bg-card px-[11px] font-[inherit] text-[12.5px] leading-none font-medium text-foreground outline-none transition-[border-color,color] duration-150 hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec aria-disabled:cursor-default aria-disabled:text-muted-foreground aria-disabled:hover:border-border motion-reduce:transition-none @max-[459px]:ml-auto"
            >
              <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3 shrink-0 fill-current">
                <path d="M3.5 2.2v7.6a.5.5 0 0 0 .76.43l6.2-3.8a.5.5 0 0 0 0-.86l-6.2-3.8a.5.5 0 0 0-.76.43Z" />
              </svg>
              <RollText text={busy ? "Checking" : "Run check"} reserve={RUN_LABELS} animate={!reducedMotion} />
              <span ref={progressRef} aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] origin-left scale-x-0 bg-lumesec" />
            </button>
          ) : null}
        </div>
      </div>

      <div
        ref={cardRef}
        className="grid rounded-[14px] border border-border bg-card text-card-foreground shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)] [-webkit-tap-highlight-color:transparent] @min-[560px]:grid-cols-[minmax(0,1fr)_210px]"
      >
        <div className="flex min-w-0 flex-col gap-2 p-3">
          <div
            role="img"
            aria-label={`Map of ${probes.length} ${probes.length === 1 ? "probe" : "probes"} checking ${target.label}`}
            className="relative w-full select-none"
            style={{ aspectRatio: aspect }}
          >
            <svg
              aria-hidden="true"
              viewBox={`0 0 ${NOMINAL_WIDTH} ${round2(NOMINAL_WIDTH / aspect)}`}
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 block size-full overflow-visible"
            >
              <path d={layout.outline} vectorEffect="non-scaling-stroke" strokeWidth={1} className="fill-muted/35 stroke-border" />
            </svg>
            <canvas ref={baseRef} aria-hidden="true" className="absolute inset-0 block size-full" />
            <canvas ref={arcsRef} aria-hidden="true" className="absolute inset-0 block size-full" />
            {layout.sites.map((site) => (
              <SiteMarker
                key={site.id}
                id={site.id}
                x={site.x}
                y={site.y}
                failed={board.entries.get(site.id)?.status === "failed"}
                pointed={site.id === pointed}
                register={registerSite}
              />
            ))}
            <span
              ref={targetMarkerRef}
              aria-hidden="true"
              className="absolute z-[2] -mt-[5px] -ml-[5px] size-2.5 rounded-[2px] bg-lumesec shadow-[0_0_0_2px_var(--card),0_0_0_3px_color-mix(in_srgb,var(--lumesec)_45%,transparent)]"
              style={{ left: percent(layout.target.x), top: percent(layout.target.y) }}
            />
            {target.label ? (
              <MapChip x={layout.target.x} y={layout.target.y} side={layout.labelSide} gap={10} strong>
                {target.label}
              </MapChip>
            ) : null}
            {pointedSite && pointedProbe ? (
              <MapChip x={pointedSite.x} y={pointedSite.y} side={pointedSite.x > 0.72 ? "left" : "right"} gap={8}>
                {pointedProbe.label}
              </MapChip>
            ) : null}
            <canvas
              ref={effectsRef}
              aria-hidden="true"
              className="pointer-events-none absolute -top-10 -left-4 z-[3] block h-[calc(100%+80px)] w-[calc(100%+32px)] @min-[560px]:-left-10 @min-[560px]:w-[calc(100%+80px)]"
            />
          </div>

          <div aria-hidden="true" className="flex min-h-[86px] flex-1 flex-col">
            <div className="flex h-4 items-center justify-between text-[11px] leading-4 text-muted-foreground">
              <span>Arrival time</span>
              {view.failed > 0 ? (
                <span className="font-mono text-[10.5px] text-destructive tabular-nums">
                  {view.failed} {view.failed === 1 ? "timeout" : "timeouts"}
                </span>
              ) : null}
            </div>
            <div className="relative mt-1.5 min-h-[44px] flex-1">
              <canvas ref={stripRef} aria-hidden="true" className="absolute inset-0 block size-full" />
              <PercentileMarker which="p50" fraction={view.p50 === null ? null : view.p50 / board.scale} register={registerMarker} />
              <PercentileMarker which="p95" fraction={view.p95 === null ? null : view.p95 / board.scale} register={registerMarker} />
            </div>
            <div className="relative mt-1 h-3.5 font-mono text-[10px] leading-[14px] text-muted-foreground tabular-nums">
              {ticks.map((tick, i) => (
                <span key={tick} className="absolute top-0 whitespace-nowrap" style={tickStyle(i, ticks.length, tick / board.scale)}>
                  {i === ticks.length - 1 ? `${formatNumber(tick)} ms` : formatNumber(tick)}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="min-w-0 border-t border-border px-1.5 py-2 @min-[560px]:border-t-0 @min-[560px]:border-l">
          {probes.length === 0 ? (
            <p className="m-0 grid min-h-[78px] place-items-center text-[12.5px] leading-5 text-muted-foreground">No probes</p>
          ) : null}
          <ol
            ref={listRef}
            aria-label="Results, fastest first"
            className="relative m-0 list-none p-0"
            style={{ height: listOrigin * ROW_HEIGHT }}
          >
            {board.order.map((id, index) => {
              const probe = view.probes.get(id);
              const entry = board.entries.get(id);
              if (!probe || !entry) return null;
              return (
                <ProbeRow
                  key={id}
                  probe={probe}
                  rank={index}
                  entry={entry}
                  place={entry.status === "ok" ? index + 1 : null}
                  fraction={barFraction(entry, board.scale)}
                  slow={entry.status === "ok" && entry.ms !== null && entry.ms >= slowMs}
                  animate={!reducedMotion}
                  pointed={id === pointed}
                  register={registerRow}
                  onPoint={setPointed}
                />
              );
            })}
          </ol>
        </div>
      </div>
      <div aria-live="polite" className="sr-only">
        {board.completed?.summary ?? ""}
      </div>
    </div>
  );
}

/* Header ---------------------------------------------------------------------------------------------- */

/** A percentile chip: label, rolling figures and the unit. Reads as plain text to assistive technology. */
function StatChip({ label, value, animate }: { label: string; value: number | null; animate: boolean }) {
  const text = value === null ? "–" : formatMs(value);
  const { figures, unit } = splitUnit(text);
  return (
    <span className="inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 leading-none">
      <span aria-hidden="true" className="font-mono text-[10.5px] text-muted-foreground">
        {label}
      </span>
      <span aria-hidden="true" className="inline-flex min-w-[3.6ch] justify-end font-mono text-[12.5px] font-medium text-foreground tabular-nums">
        <RollingValue text={figures} value={value ?? 0} animate={animate} />
      </span>
      <span aria-hidden="true" className="min-w-[1.4em] text-[11.5px] text-muted-foreground">
        {unit}
      </span>
      <span className="sr-only">{`${label} ${value === null ? "none yet" : text}`}</span>
    </span>
  );
}

/**
 * Mechanical figures: each character rolls on its own wheel, in the direction of the change, so 94 → 101 turns the
 * wheels that change and adds the new one. Hidden from assistive technology; callers add the plain text.
 */
function RollingValue({ text, value, animate }: { text: string; value: number; animate: boolean }) {
  const [shown, setShown] = React.useState({ value, direction: 1 });
  if (shown.value !== value) setShown({ value, direction: value >= shown.value ? 1 : -1 });
  const characters = Array.from(text);
  return (
    <span aria-hidden="true" className="inline-flex">
      {characters.map((character, i) => (
        // keyed from the right, so the ones digit keeps its wheel when the number grows a digit
        <RollText key={characters.length - i} text={character} direction={shown.direction} animate={animate} />
      ))}
    </span>
  );
}

/* Map overlays ---------------------------------------------------------------------------------------- */

/** A probe's place on the map: a small square that flashes at launch and turns red when its check failed. */
function SiteMarker({
  id,
  x,
  y,
  failed,
  pointed,
  register,
}: {
  id: string;
  x: number;
  y: number;
  failed: boolean;
  pointed: boolean;
  register: (id: string, element: HTMLSpanElement | null) => void;
}) {
  return (
    <span
      ref={(node) => register(id, node)}
      aria-hidden="true"
      data-failed={failed ? "" : undefined}
      data-pointed={pointed ? "" : undefined}
      className="absolute z-[1] -mt-[2px] -ml-[2px] size-1 rounded-[1px] bg-[color-mix(in_srgb,var(--foreground)_50%,var(--card))] shadow-[0_0_0_1.5px_var(--card)] transition-[background-color,scale] duration-200 data-[failed]:bg-destructive data-[pointed]:scale-150 data-[pointed]:bg-lumesec motion-reduce:transition-none"
      style={{ left: percent(x), top: percent(y) }}
    />
  );
}

/** A label chip beside a point on the map, on the given side. */
function MapChip({
  x,
  y,
  side,
  gap,
  strong = false,
  children,
}: {
  x: number;
  y: number;
  side: LabelSide;
  gap: number;
  strong?: boolean;
  children: React.ReactNode;
}) {
  const style: React.CSSProperties =
    side === "top"
      ? { left: percent(x), bottom: `calc(${percent(1 - y)} + ${gap}px)`, transform: "translateX(-50%)" }
      : side === "bottom"
        ? { left: percent(x), top: `calc(${percent(y)} + ${gap}px)`, transform: "translateX(-50%)" }
        : side === "right"
          ? { left: `calc(${percent(x)} + ${gap}px)`, top: percent(y), transform: "translateY(-50%)" }
          : { right: `calc(${percent(1 - x)} + ${gap}px)`, top: percent(y), transform: "translateY(-50%)" };
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute z-[2] rounded-[5px] border bg-card px-1.5 font-mono text-[10.5px] leading-4 whitespace-nowrap shadow-[0_2px_8px_-4px_rgb(0_0_0/0.3)]",
        strong ? "border-[color-mix(in_srgb,var(--lumesec)_35%,var(--border))] text-foreground" : "border-border text-muted-foreground",
      )}
      style={style}
    >
      {children}
    </span>
  );
}

/** A percentile's hairline on the arrival timeline; the loop slides it on a spring. */
function PercentileMarker({
  which,
  fraction,
  register,
}: {
  which: Percentile;
  fraction: number | null;
  register: (which: Percentile, element: HTMLSpanElement | null, origin: number) => void;
}) {
  const [origin] = React.useState(fraction ?? 0);
  return (
    <span
      ref={(node) => register(which, node, origin)}
      data-hidden={fraction === null ? "" : undefined}
      className="pointer-events-none absolute inset-y-0 w-px bg-[color-mix(in_srgb,var(--foreground)_32%,transparent)] transition-opacity duration-300 will-change-transform data-[hidden]:opacity-0 motion-reduce:transition-none"
      style={{ left: percent(origin) }}
    >
      <span
        className={cn(
          "absolute -top-px font-mono text-[10px] leading-3 whitespace-nowrap text-muted-foreground [text-shadow:0_0_3px_var(--card),0_0_3px_var(--card)]",
          which === "p50" ? "right-1" : "left-1",
        )}
      >
        {which}
      </span>
    </span>
  );
}

/* Ranked list ----------------------------------------------------------------------------------------- */

interface ProbeRowProps {
  probe: ProbeSite;
  /** Position in the list, 0 at the top. */
  rank: number;
  entry: RowEntry;
  /** 1-based place among the results that landed, or null. */
  place: number | null;
  /** Bar length on the shared scale, 0 to 1. */
  fraction: number;
  slow: boolean;
  animate: boolean;
  pointed: boolean;
  register: RegisterRow;
  onPoint: (id: string | null) => void;
}

/**
 * One probe in the ranked list: place, city, the measured time (or pending, or a timeout chip) and a dotted bar on
 * the shared scale under it. The row sits at its rank on a spring; the loop moves it.
 */
function ProbeRow({ probe, rank, entry, place, fraction, slow, animate, pointed, register, onPoint }: ProbeRowProps) {
  const itemRef = React.useRef<HTMLLIElement>(null);
  const fillRef = React.useRef<HTMLSpanElement>(null);
  const washRef = React.useRef<HTMLSpanElement>(null);
  const chipRef = React.useRef<HTMLSpanElement>(null);
  // the server markup places the row with `top`; the loop moves it from there with a transform
  const [origin] = React.useState(rank);
  const [barOrigin] = React.useState(fraction);
  const { id } = probe;
  const { status, live } = entry;

  React.useLayoutEffect(() => {
    register(id, { item: itemRef.current!, fill: fillRef.current! }, origin, barOrigin);
    return () => register(id, null, 0, 0);
  }, [id, origin, barOrigin, register]);

  // A result that just landed washes its row in the accent and lights its bar; a timeout washes it red and shakes.
  React.useLayoutEffect(() => {
    if (!live || !animate || (status !== "ok" && status !== "failed")) return;
    const played: Animation[] = [];
    const wash = washRef.current;
    if (wash && typeof wash.animate === "function") played.push(wash.animate(WASH_KEYFRAMES, { duration: 1200, easing: "cubic-bezier(.2,.8,.2,1)" }));
    const fill = fillRef.current;
    if (status === "ok" && fill && typeof fill.animate === "function") played.push(fill.animate(BAR_FLASH_KEYFRAMES, { duration: 1500, easing: "ease-out" }));
    if (status === "failed") shake(chipRef.current);
    return () => played.forEach((animation) => animation.cancel());
  }, [status, live, animate]);

  const value = status === "ok" && entry.ms !== null ? splitUnit(formatMs(entry.ms)) : { figures: status === "pending" ? "pending" : "–", unit: "" };
  return (
    <li
      ref={itemRef}
      data-status={status}
      data-pointed={pointed ? "" : undefined}
      onPointerEnter={() => onPoint(id)}
      onPointerLeave={() => onPoint(null)}
      className="group/row absolute inset-x-0 h-[26px] will-change-transform"
      style={{ top: origin * ROW_HEIGHT }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 inset-y-px rounded-md bg-muted/0 transition-colors duration-150 group-data-[pointed]/row:bg-muted motion-reduce:transition-none"
      />
      <span
        ref={washRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 inset-y-px rounded-md bg-lumesec/10 opacity-0 group-data-[status=failed]/row:bg-destructive/10"
      />
      <span className="relative grid h-[21px] grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-x-1.5 px-1.5">
        <span className="text-right font-mono text-[10.5px] leading-4 text-muted-foreground tabular-nums">
          {place === null ? (
            <span aria-hidden="true">{status === "pending" ? "" : "–"}</span>
          ) : (
            <RollText text={String(place)} animate={animate} className="justify-items-end" />
          )}
        </span>
        <span
          className={cn(
            "truncate text-[12.5px] leading-4 transition-colors duration-200 motion-reduce:transition-none",
            status === "pending" || status === "idle" || status === "missing" ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {probe.label}
        </span>
        <span className="flex min-w-[46px] items-baseline justify-end gap-[3px]">
          {status === "failed" ? (
            <span
              ref={chipRef}
              className="inline-flex h-4 items-center self-center rounded-[4px] border border-destructive/35 bg-destructive/10 px-1 font-mono text-[10px] leading-none text-destructive"
            >
              timeout
            </span>
          ) : (
            <>
              <RollText
                text={value.figures}
                animate={animate}
                className={cn(
                  "justify-items-end leading-4",
                  status === "ok" ? "font-mono text-[12px] tabular-nums" : "text-[11.5px] text-muted-foreground",
                  slow ? "text-lumesec-warning" : status === "ok" && "text-foreground",
                )}
              />
              {value.unit ? <span className="text-[11px] leading-4 text-muted-foreground">{value.unit}</span> : null}
            </>
          )}
        </span>
      </span>
      <span aria-hidden="true" className="pointer-events-none absolute right-1.5 bottom-[2px] left-[26px] h-[2px]">
        <span className="absolute inset-0 bg-[linear-gradient(90deg,currentColor_2px,transparent_2px)] bg-[length:4px_2px] text-[color-mix(in_srgb,var(--foreground)_9%,transparent)]" />
        <span
          ref={fillRef}
          className={cn(
            "relative block h-full max-w-full bg-[linear-gradient(90deg,currentColor_2px,transparent_2px)] bg-[length:4px_2px]",
            slow ? "text-[color-mix(in_srgb,var(--lumesec-warning)_75%,transparent)]" : "text-[color-mix(in_srgb,var(--foreground)_34%,transparent)]",
          )}
          style={{ width: percent(barOrigin) }}
        />
      </span>
    </li>
  );
}

/* Constants ------------------------------------------------------------------------------------------- */

/** The demo target: eu-central at Frankfurt's coordinates. */
const DEMO_TARGET: ProbeTarget = { label: "eu-central", lat: 50.1109, lon: 8.6821 };

/** Twelve demo probes on every continent (demo city ids). */
const DEMO_PROBE_CITIES = ["lhr", "arn", "jfk", "sfo", "gru", "los", "jnb", "dxb", "bom", "sin", "nrt", "syd"] as const;

const DEMO_PROBES: readonly ProbeSite[] = DEMO_PROBE_CITIES.flatMap((id) => {
  const city = findCity(id);
  return city ? [{ id, label: city.name, lat: city.lat, lon: city.lon }] : [];
});

const MAP_CANVAS = { maxDpr: 2 } as const;
const LAT_RANGE: readonly [number, number] = [-56, 76];
const MAP_ASPECT = projectionAspect("equalEarth", LAT_RANGE);
/** Width of the SSR projection and the SVG outline's coordinate space. */
const NOMINAL_WIDTH = 1000;

/** Base lattice: 4 px pitch, 1.5 px dots at 60 %. */
const PITCH = 4;
const DOT_SIZE = 1.5;
const BASE_ALPHA = 0.6;
/** Arcs: a dotted trail every 3.5 px in the accent at 50 %, a brighter comet tail over the last 30 px. */
const TRAIL_SPACING = 3.5;
const TRAIL_ALPHA = 0.5;
const TAIL_PX = 30;
const BEND = 0.15;
/** A failed check runs to 50 % of a 1.4 s path, then cracks; its drawn part fades over 1.2 s. */
const FAIL_PATH_MS = 1400;
const FAIL_AT = 0.5;
const CRACK_FADE_MS = 1200;
const CRACK_SPARKS = 16;
/** No arc takes longer than 12 s, whatever the result and the time scale. */
const MAX_ARC_MS = 12_000;
/** The arrival ring at the target spreads 26 px in 0.6 s; the launch ring at a probe 9 px in 0.45 s. */
const RING_MS = 600;
const RING_REACH = 26;
const LAUNCH_MS = 450;
/** Trails stay 2 s after the last arrival, then fade in 0.7 s. */
const TRAIL_HOLD_MS = 2000;
const TRAIL_FADE_MS = 700;
/** Arrival timeline: 4 px lattice, each result a block 2 dots wide and 4 to 8 high, stacked where they collide. */
const STRIP_PITCH = 4;
const BLOCK_ROWS = 4;
const BLOCK_ROW_MS = 45;
/** List rows and their springs. */
const ROW_HEIGHT = 26;
const ROW_STIFFNESS = 360;
const ROW_DAMPING = 0.8;
/** Demo rounds: the first 0.4 s after the map comes into view, then at least 1.5 s apart. */
const FIRST_ROUND_DELAY = 400;
const MIN_ROUND_GAP = 1500;
/** With `results` and `onRun`, the button waits at most 15 s for the new array. */
const WAIT_LIMIT_MS = 15_000;

const RUN_LABELS = ["Run check", "Checking"] as const;

const LAUNCH_KEYFRAMES: Keyframe[] = [
  {
    offset: 0,
    scale: "2.2",
    backgroundColor: "var(--lumesec)",
    boxShadow: "0 0 0 1.5px var(--card), 0 0 0 5px color-mix(in srgb, var(--lumesec) 28%, transparent)",
  },
];
const TARGET_PULSE_KEYFRAMES: Keyframe[] = [
  {
    offset: 0,
    scale: "1.4",
    boxShadow:
      "0 0 0 2px var(--card), 0 0 0 5px color-mix(in srgb, var(--lumesec) 60%, transparent), 0 0 16px 3px color-mix(in srgb, var(--lumesec) 45%, transparent)",
  },
];
const WASH_KEYFRAMES: Keyframe[] = [{ opacity: 1 }, { opacity: 0 }];
const BAR_FLASH_KEYFRAMES: Keyframe[] = [
  { color: "var(--lumesec)", offset: 0 },
  { color: "var(--lumesec)", offset: 0.4 },
];
/** Animates the `scale` property itself: Tailwind's `scale-x-0` sets it, and a transform would multiply with it. */
const PROGRESS_KEYFRAMES: Keyframe[] = [{ scale: "0 1" }, { scale: "1 1" }];

/* Board: the rounds and the ranked list, as pure state ----------------------------------------------------- */

type BoardMode = "demo" | "data";

/** idle: no round yet. pending: waiting for its result. missing: the round ended without a result for it. */
type RowStatus = "idle" | "pending" | "ok" | "failed" | "missing";

interface RowEntry {
  readonly status: RowStatus;
  readonly ms: number | null;
  /** Whether the status came from an arrival or a crack someone watched, so the row flashes. */
  readonly live: boolean;
}

interface RoundPlan {
  readonly round: number;
  /** The valid results, one per known probe, for `onRound`. */
  readonly results: readonly ProbeResult[];
  readonly ms: ReadonlyMap<string, number | null>;
}

interface CompletedRound {
  readonly round: number;
  readonly results: readonly ProbeResult[];
  /** "Round 4: 11 of 12 passed, median 94 ms", for the live region. */
  readonly summary: string;
}

interface Board {
  readonly mode: BoardMode;
  /** The probe list the board was built for. */
  readonly key: string;
  readonly round: number;
  readonly playing: boolean;
  /** Probe ids top to bottom: landed results by time, then the rest in their previous order, then timeouts. */
  readonly order: readonly string[];
  readonly entries: ReadonlyMap<string, RowEntry>;
  readonly plan: RoundPlan | null;
  /** The shared ms scale of the bars and the timeline. */
  readonly scale: number;
  readonly completed: CompletedRound | null;
}

const IDLE: RowEntry = { status: "idle", ms: null, live: false };
const PENDING: RowEntry = { status: "pending", ms: null, live: false };

function emptyBoard(mode: BoardMode, probes: readonly ProbeSite[], key: string, scale: number): Board {
  return {
    mode,
    key,
    round: 0,
    playing: false,
    order: probes.map((probe) => probe.id),
    entries: new Map(probes.map((probe) => [probe.id, IDLE])),
    plan: null,
    scale,
    completed: null,
  };
}

/** Demo: idle rows on the scale the first demo round will use. Data: the first results, shown at once and not announced. */
function initialBoard(
  mode: BoardMode,
  probes: readonly ProbeSite[],
  key: string,
  target: ProbeTarget,
  results: readonly ProbeResult[] | undefined,
): Board {
  if (mode === "demo") return emptyBoard(mode, probes, key, scaleFor(demoPlan(1, probes, target), 300));
  const plan = planFromResults(results ?? [], 1, probes);
  return { ...startRound(emptyBoard(mode, probes, key, scaleFor(plan, 300)), plan, true), completed: null };
}

/** Demo and your data are separate timelines: switching starts the list over (and plays your first results). */
function switchMode(
  board: Board,
  mode: BoardMode,
  probes: readonly ProbeSite[],
  target: ProbeTarget,
  results: readonly ProbeResult[] | undefined,
  instant: boolean,
): Board {
  if (mode === "demo") return emptyBoard(mode, probes, board.key, scaleFor(demoPlan(1, probes, target), 300));
  const plan = planFromResults(results ?? [], 1, probes);
  return startRound(emptyBoard(mode, probes, board.key, board.scale), plan, instant);
}

/** New probes: a playing round completes, removed probes leave, new ones join at the bottom. */
function syncProbes(board: Board, probes: readonly ProbeSite[], key: string): Board {
  const settled = board.playing ? finishRound(board) : board;
  const ids = new Set(probes.map((probe) => probe.id));
  const order = settled.order.filter((id) => ids.has(id));
  for (const probe of probes) if (!settled.entries.has(probe.id)) order.push(probe.id);
  const entries = new Map<string, RowEntry>();
  for (const id of order) entries.set(id, settled.entries.get(id) ?? IDLE);
  return { ...settled, key, order, entries };
}

/** A new round: a playing one completes first, every row goes to pending, and the scale fits the new results. */
function startRound(board: Board, plan: RoundPlan, instant: boolean): Board {
  const settled = board.playing ? finishRound(board) : board;
  const entries = new Map<string, RowEntry>();
  for (const id of settled.order) entries.set(id, PENDING);
  const started: Board = { ...settled, round: plan.round, playing: true, entries, plan, scale: scaleFor(plan, settled.scale) };
  return instant ? finishRound(started) : started;
}

/** A result landed: its row moves up to its place among the landed results. */
function landResult(board: Board, id: string, live: boolean): Board {
  const ms = board.plan?.ms.get(id);
  const entry = board.entries.get(id);
  if (typeof ms !== "number" || !entry || entry.status !== "pending") return board;
  const entries = new Map(board.entries);
  entries.set(id, { status: "ok", ms, live });
  const order = board.order.filter((other) => other !== id);
  let index = 0;
  while (index < order.length) {
    const other = entries.get(order[index]);
    if (!other || other.status !== "ok" || other.ms === null || other.ms > ms) break;
    index++;
  }
  order.splice(index, 0, id);
  return { ...board, order, entries };
}

/** A check failed: its row drops to the bottom as a timeout. */
function failResult(board: Board, id: string, live: boolean): Board {
  const entry = board.entries.get(id);
  if (!board.plan?.ms.has(id) || board.plan.ms.get(id) !== null || !entry || entry.status !== "pending") return board;
  const entries = new Map(board.entries);
  entries.set(id, { status: "failed", ms: null, live });
  return { ...board, order: [...board.order.filter((other) => other !== id), id], entries };
}

/** Lands every result that has not landed yet (in time order), marks probes without one, and closes the round. */
function finishRound(board: Board): Board {
  const plan = board.plan;
  if (!board.playing || !plan) return board;
  let next = board;
  const remaining = [...plan.ms].filter(([id]) => next.entries.get(id)?.status === "pending");
  remaining.sort((a, b) => (a[1] ?? Infinity) - (b[1] ?? Infinity));
  for (const [id, ms] of remaining) next = ms === null ? failResult(next, id, false) : landResult(next, id, false);
  const entries = new Map(next.entries);
  for (const [id, entry] of entries) if (entry.status === "pending") entries.set(id, { status: "missing", ms: null, live: false });
  const passed: number[] = [];
  for (const entry of entries.values()) if (entry.status === "ok" && entry.ms !== null) passed.push(entry.ms);
  const median = passed.length ? `, median ${formatMs(quantile(passed, 0.5))}` : "";
  const summary = `Round ${plan.round}: ${passed.length} of ${next.order.length} passed${median}.`;
  return { ...next, entries, playing: false, completed: { round: plan.round, results: plan.results, summary } };
}

/** Valid results for known probes (the last one per probe wins), as a plan. */
function planFromResults(results: readonly ProbeResult[], round: number, probes: readonly ProbeSite[]): RoundPlan {
  const known = new Set(probes.map((probe) => probe.id));
  const ms = new Map<string, number | null>();
  for (const result of results) {
    if (!result || typeof result.probe !== "string" || !known.has(result.probe)) continue;
    if (result.ms === null) ms.set(result.probe, null);
    else if (typeof result.ms === "number" && Number.isFinite(result.ms) && result.ms >= 0) ms.set(result.probe, result.ms);
  }
  return { round, results: [...ms].map(([probe, value]) => ({ probe, ms: value })), ms };
}

/**
 * A seeded demo round: each probe's plausible latency to the target with ±12 % jitter. Every third round (2, 5, 8,
 * ...) one probe fails, more likely a distant one, so its arc is long enough to break visibly.
 */
function demoPlan(round: number, probes: readonly ProbeSite[], target: ProbeTarget): RoundPlan {
  const random = createRandom(round * 7919 + 101);
  const latencies = probes.map((probe) => demoLatency(probe, target));
  const failing = round % 3 === 2 && probes.length > 1 ? pickWeighted(random, probes, (probe) => demoLatency(probe, target)).id : null;
  const results = probes.map((probe, i) => ({
    probe: probe.id,
    ms: probe.id === failing ? null : Math.max(1, Math.round(latencies[i] * (1 + (random() * 2 - 1) * 0.12))),
  }));
  return planFromResults(results, round, probes);
}

/** Whether two results arrays hold the same results, so a re-created array with equal content does not replay. */
function sameResults(a: readonly ProbeResult[] | undefined, b: readonly ProbeResult[] | undefined) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i]?.probe !== b[i]?.probe || a[i]?.ms !== b[i]?.ms) return false;
  return true;
}

/** A round scale with whole steps: about 8 % headroom over the slowest result, at most 4 ticks apart. */
function scaleFor(plan: RoundPlan, fallback: number) {
  let max = 0;
  for (const ms of plan.ms.values()) if (ms !== null) max = Math.max(max, ms);
  if (max <= 0) return fallback;
  const raw = Math.max(20, max * 1.08);
  const step = niceStep(raw / 4);
  return Math.ceil(raw / step) * step;
}

/** The nice step at or above `value`: 1, 2, 2.5 or 5 times a power of ten. */
function niceStep(value: number) {
  const power = Math.pow(10, Math.floor(Math.log10(Math.max(value, 1e-6))));
  for (const factor of [1, 2, 2.5, 5, 10]) if (factor * power >= value - 1e-9) return factor * power;
  return 10 * power;
}

function scaleTicks(scale: number) {
  const step = niceStep(scale / 4);
  const ticks: number[] = [];
  for (let value = 0; value <= scale + 1e-9; value += step) ticks.push(Math.round(value * 100) / 100);
  if (ticks[ticks.length - 1] < scale - 1e-9) ticks.push(scale);
  return ticks;
}

/** Animation ms from the launch to the last arrival or crack. */
function roundDuration(plan: RoundPlan, timeScale: number) {
  let end = 0;
  for (const ms of plan.ms.values()) end = Math.max(end, ms === null ? FAIL_PATH_MS * FAIL_AT : Math.min(MAX_ARC_MS, ms * timeScale));
  return end;
}

const barFraction = (entry: RowEntry | undefined, scale: number) =>
  entry && entry.status === "ok" && entry.ms !== null ? clamp(entry.ms / scale, 0, 1) : 0;

/** Probes by id, the percentiles of the landed results and the number of timeouts. */
function boardView(board: Board, probes: readonly ProbeSite[]) {
  const values: number[] = [];
  let failed = 0;
  for (const entry of board.entries.values()) {
    if (entry.status === "ok" && entry.ms !== null) values.push(entry.ms);
    else if (entry.status === "failed") failed++;
  }
  return {
    probes: new Map(probes.map((probe) => [probe.id, probe])),
    p50: values.length ? quantile(values, 0.5) : null,
    p95: values.length ? quantile(values, 0.95) : null,
    failed,
  };
}

/** The landed results, fastest first, for the timeline blocks. */
function landedResults(board: Board): StripResult[] {
  const list: StripResult[] = [];
  for (const id of board.order) {
    const entry = board.entries.get(id);
    if (entry && entry.status === "ok" && entry.ms !== null) list.push({ id, ms: entry.ms });
  }
  return list;
}

/* Data helpers ---------------------------------------------------------------------------------------- */

function probeListKey(probes: readonly ProbeSite[]) {
  return probes.map((probe) => `${probe?.id}\u0001${probe?.label}\u0001${probe?.lat}\u0001${probe?.lon}`).join("\u0002");
}

/** Probes with an id and a valid position, first of each id. */
function validProbes(probes: readonly ProbeSite[]): ProbeSite[] {
  const seen = new Set<string>();
  const list: ProbeSite[] = [];
  for (const probe of probes) {
    if (!probe || typeof probe.id !== "string" || probe.id === "" || seen.has(probe.id)) continue;
    if (!isValidLatLon(probe)) continue;
    seen.add(probe.id);
    list.push({ id: probe.id, label: typeof probe.label === "string" && probe.label ? probe.label : probe.id, lat: probe.lat, lon: probe.lon });
  }
  return list;
}

/** The target, or the demo target when its position is not valid. */
function validTarget(target: ProbeTarget): ProbeTarget {
  if (!isValidLatLon(target)) return DEMO_TARGET;
  return { label: typeof target.label === "string" ? target.label : "", lat: target.lat, lon: target.lon };
}

/** A point on the map in degrees, its latitude kept inside the map's crop. */
const onMap = (point: LatLon): LatLon => ({ lat: clamp(point.lat, LAT_RANGE[0], LAT_RANGE[1]), lon: wrapLongitude(point.lon) });

type LabelSide = "top" | "right" | "bottom" | "left";

/** Server-safe placement of the outline, the target and the probes, as fractions of the map box. */
function mapLayout(probes: readonly ProbeSite[], target: ProbeTarget) {
  const height = NOMINAL_WIDTH / MAP_ASPECT;
  const projection = createProjection("equalEarth", { width: NOMINAL_WIDTH, height, latRange: LAT_RANGE });
  const point = createScreenPoint();
  const place = (location: LatLon) => {
    const { lat, lon } = onMap(location);
    projection.project(lat, lon, point);
    return { x: point.x / NOMINAL_WIDTH, y: point.y / height };
  };
  const targetPoint = place(target);
  const sites = probes.map((probe) => ({ id: probe.id, ...place(probe) }));
  return {
    outline: projectionOutlineSvgPath(projection),
    target: targetPoint,
    sites,
    labelSide: labelSide(targetPoint, sites, height / NOMINAL_WIDTH),
  };
}

/**
 * The side of the target for its label: the one the fewest arcs come in from, and that fits inside the map. Ties go
 * to top, right, left, bottom.
 */
function labelSide(target: { x: number; y: number }, sites: readonly { x: number; y: number }[], ratio: number): LabelSide {
  const counts: Record<LabelSide, number> = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const site of sites) {
    const dx = site.x - target.x;
    const dy = (site.y - target.y) * ratio;
    if (dx === 0 && dy === 0) continue;
    if (Math.abs(dx) > Math.abs(dy)) counts[dx > 0 ? "right" : "left"]++;
    else counts[dy > 0 ? "bottom" : "top"]++;
  }
  const fits: Record<LabelSide, boolean> = {
    // the chip may reach into the card's padding above the map
    top: target.y > 0.11,
    bottom: target.y < 0.84,
    right: target.x < 0.8,
    left: target.x > 0.2,
  };
  let best: LabelSide = "top";
  let fewest = Infinity;
  for (const side of ["top", "right", "left", "bottom"] as const) {
    if (fits[side] && counts[side] < fewest) {
      best = side;
      fewest = counts[side];
    }
  }
  return best;
}

/** "94 ms" → { figures: "94", unit: "ms" }, so the figures roll in mono and the unit stays quiet. */
function splitUnit(text: string) {
  const split = text.lastIndexOf(" ");
  return split > 0 ? { figures: text.slice(0, split), unit: text.slice(split + 1) } : { figures: text, unit: "" };
}

const percent = (fraction: number) => `${round2(fraction * 100)}%`;
const round2 = (value: number) => Math.round(value * 100) / 100;

function tickStyle(index: number, count: number, fraction: number): React.CSSProperties {
  if (index === 0) return { left: 0 };
  if (index === count - 1 && fraction >= 0.999) return { right: 0 };
  return { left: percent(fraction), transform: "translateX(-50%)" };
}

/* Springs for the DOM --------------------------------------------------------------------------------- */

interface TargetSpring extends Spring {
  /** Where the spring settles. */
  target: number;
}

interface RowParts {
  item: HTMLLIElement;
  fill: HTMLSpanElement;
}

interface RowMotion extends TargetSpring {
  /** The rank the row was rendered at; the transform is relative to it. */
  origin: number;
  parts: RowParts;
  /** Last written offset and bar width, to skip unchanged style writes. */
  written: number;
  bar: TargetSpring;
  barWritten: number;
}

type RegisterRow = (id: string, parts: RowParts | null, origin: number, bar: number) => void;

type Percentile = "p50" | "p95";

interface MarkerMotion extends TargetSpring {
  /** The fraction the marker was rendered at. */
  origin: number;
  /** Whether it had a value: one that appears jumps to its place instead of sliding in from the last one. */
  shown: boolean;
  element: HTMLSpanElement | null;
}

/**
 * The DOM springs settle exactly (so the loop can stop) once they are within `epsilon` of their target and slower than
 * ten times that.
 */
const ROW_SPRING: SettleSpringOptions = { stiffness: ROW_STIFFNESS, damping: ROW_DAMPING, epsilon: 0.002, velocityEpsilon: 0.02 };
const BAR_SPRING: SettleSpringOptions = { stiffness: 300, damping: 0.78, epsilon: 0.001, velocityEpsilon: 0.01 };
const LIST_SPRING: SettleSpringOptions = { stiffness: ROW_STIFFNESS, damping: 1, epsilon: 0.002, velocityEpsilon: 0.02 };
const MARKER_SPRING: SettleSpringOptions = { stiffness: ROW_STIFFNESS, damping: ROW_DAMPING, epsilon: 0.0005, velocityEpsilon: 0.005 };

function snapRow(row: RowMotion) {
  row.position = row.target;
  row.velocity = 0;
  row.bar.position = row.bar.target;
  row.bar.velocity = 0;
}

/** Rows slide to their ranks (a later, faster result pushes slower rows down), bars grow, the list follows its rows. */
function stepRows(rows: Map<string, RowMotion>, list: TargetSpring, element: HTMLOListElement | null, delta: number, reduced: boolean) {
  let moving = false;
  for (const row of rows.values()) {
    if (reduced) snapRow(row);
    if (settleSpring(row, row.target, delta, false, ROW_SPRING)) moving = true;
    if (settleSpring(row.bar, row.bar.target, delta, false, BAR_SPRING)) moving = true;
    const offset = Math.round((row.position - row.origin) * ROW_HEIGHT * 100) / 100;
    if (offset !== row.written) {
      row.written = offset;
      row.parts.item.style.transform = `translate3d(0,${offset}px,0)`;
    }
    // a row on its way up passes over the ones it overtakes
    row.parts.item.style.zIndex = row.velocity < -0.4 ? "2" : "";
    const width = Math.round(clamp(row.bar.position, 0, 1.04) * 10000) / 100;
    if (width !== row.barWritten) {
      row.barWritten = width;
      row.parts.fill.style.width = `${width}%`;
    }
  }
  if (reduced) {
    list.position = list.target;
    list.velocity = 0;
  }
  if (settleSpring(list, list.target, delta, false, LIST_SPRING)) moving = true;
  if (element) element.style.height = `${Math.max(0, list.position * ROW_HEIGHT).toFixed(1)}px`;
  return moving;
}

function aimMarker(marker: MarkerMotion, fraction: number | null, reduced: boolean) {
  if (fraction === null) {
    marker.shown = false;
    return;
  }
  marker.target = clamp(fraction, 0, 1);
  if (!marker.shown || reduced) {
    marker.position = marker.target;
    marker.velocity = 0;
  }
  marker.shown = true;
}

/** p50 and p95 slide along the timeline on springs as each result lands. */
function stepMarkers(markers: Record<Percentile, MarkerMotion>, width: number, delta: number, reduced: boolean) {
  let moving = false;
  for (const marker of [markers.p50, markers.p95]) {
    if (reduced) {
      marker.position = marker.target;
      marker.velocity = 0;
    }
    if (settleSpring(marker, marker.target, delta, false, MARKER_SPRING)) moving = true;
    if (marker.element && width > 0) {
      marker.element.style.transform = `translate3d(${((marker.position - marker.origin) * width).toFixed(2)}px,0,0)`;
    }
  }
  return moving;
}

/* Map engine ------------------------------------------------------------------------------------------ */

interface Box {
  width: number;
  height: number;
  dpr: number;
}

interface Site {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** The arc from the probe to the target: the main table first, then seam copies. */
  readonly tables: ArcLengthTable[];
}

interface RoundArc {
  readonly id: string;
  readonly failed: boolean;
  /** Animation ms from the launch to the arrival, or to the crack. */
  readonly at: number;
  /** Animation ms to draw the whole path: the arrival time, or the 1.4 s a failed check would have taken. */
  readonly duration: number;
  done: boolean;
  /** performance.now() of the arrival or the crack. */
  doneAt: number;
}

interface PlayingRound {
  /** The board's plan for this round; the callbacks hand it back so the board can tell rounds apart. */
  readonly plan: RoundPlan;
  readonly start: number;
  readonly timeScale: number;
  /** The ms scale of the timeline. */
  readonly scale: number;
  /** Sorted by `at`. */
  readonly arcs: RoundArc[];
  finished: boolean;
  finishedAt: number;
  /** Ended early (a new round, scrolled away): the trails fade at once. */
  cut: boolean;
}

interface StripResult {
  readonly id: string;
  readonly ms: number;
}

interface Level {
  position: number;
  velocity: number;
  target: number;
}

const noop = () => undefined;
const BLACK: RGB = [0, 0, 0];

/**
 * Everything the map and the timeline draw, outside React: the base lattice (baked, redrawn on resize and theme
 * change), the arcs, rings and heads (redrawn while a round plays or fades), a larger effects layer for the crack
 * sparks, and the arrival timeline. It also keeps the round's clock and reports arrivals, cracks and the end.
 */
class ProbesEngine {
  onLand: (plan: RoundPlan, id: string) => void = noop;
  onFail: (plan: RoundPlan, id: string) => void = noop;
  onFinish: (plan: RoundPlan) => void = noop;

  private ink: GeoInk | null = null;
  private batch: DotBatch | null = null;
  private colors = { land: "", accent: "", glint: "", hot: "", destructive: "" };
  /** Timeline colours: resting, slow and freshly landed blocks, the lattice and its baseline. */
  private stripInk = { rest: BLACK, slow: BLACK, flash: BLACK, baseline: "" };
  private box: Box | null = null;
  private projection: MapProjection | null = null;
  private lattice: DotLattice | null = null;
  private probes: readonly ProbeSite[] = [];
  private target: ProbeTarget = DEMO_TARGET;
  private sites = new Map<string, Site>();
  private targetX = 0;
  private targetY = 0;
  private round: PlayingRound | null = null;
  /** Arrival times at the target (performance.now), for the rings. */
  private rings: number[] = [];
  /** When each result of the current round landed, for the timeline blocks. */
  private landedAt = new Map<string, number>();
  private readonly sparks = new Sparks();
  private effectsX = 0;
  private effectsY = 0;
  private baseDirty = true;
  private arcsDirty = true;
  private effectsDirty = false;
  private highlightId: string | null = null;
  private highlightShown: string | null = null;
  private readonly highlight: Level = { position: 0, velocity: 0, target: 0 };
  private stripBox: { width: number; height: number } | null = null;
  private stripResults: readonly StripResult[] = [];
  private stripScale = 300;
  private slowMs = 300;
  private stripDirty = true;
  private stripHeights = new Int16Array(0);
  private readonly cursor = { x: 0, y: 0, angle: 0 };

  /** Probes and target; their points and arcs follow. */
  configure(probes: readonly ProbeSite[], target: ProbeTarget) {
    this.probes = probes;
    this.target = target;
    this.placeSites();
    this.arcsDirty = true;
  }

  /** New theme colours: the ramp, the baked land and the timeline follow. */
  setInk(ink: GeoInk) {
    this.ink = ink;
    this.colors = { land: rgba(ink.land), accent: rgba(ink.accent), glint: rgba(ink.glint), hot: rgba(ink.hot), destructive: rgba(ink.destructive) };
    this.stripInk = {
      rest: mixRgb(ink.foreground, ink.card, 0.42),
      slow: ink.warning,
      flash: ink.hot,
      baseline: rgba(mixRgb(ink.muted, ink.card, 0.15)),
    };
    const ramp = [ink.land, ink.accent, ink.hot];
    if (this.batch) this.batch.setRamp(ramp);
    else this.batch = createDotBatch(2048, ramp, { tones: 24, levels: 16 });
    this.baseDirty = true;
    this.arcsDirty = true;
    this.stripDirty = true;
  }

  /** New map size: projection, lattice, points and arcs follow. */
  layout(width: number, height: number, dpr: number) {
    this.box = { width, height, dpr };
    this.projection = createProjection("equalEarth", { width, height, latRange: LAT_RANGE });
    this.lattice = mapLattice(this.projection, { pitch: PITCH });
    this.placeSites();
    this.baseDirty = true;
    this.arcsDirty = true;
  }

  layoutStrip(width: number, height: number) {
    this.stripBox = { width, height };
    this.stripDirty = true;
  }

  /** The map's top-left corner on the effects layer. */
  setEffectsOffset(x: number, y: number) {
    this.effectsX = x;
    this.effectsY = y;
  }

  /** The probe whose path to show (a pointed row), or null. */
  setHighlight(id: string | null) {
    this.highlightId = id;
    this.highlight.target = id ? 1 : 0;
    if (id) this.highlightShown = id;
  }

  /** The landed results for the timeline blocks, the shared scale and the slow threshold. */
  setStrip(results: readonly StripResult[], scale: number, slowMs: number) {
    this.stripResults = results;
    this.stripScale = scale;
    this.slowMs = slowMs;
    this.stripDirty = true;
  }

  /** Starts the volley of a round. Returns false when that round is already playing. */
  play(plan: RoundPlan, timeScale: number, scale: number) {
    if (this.round && this.round.plan === plan) return false;
    const arcs: RoundArc[] = [];
    for (const [id, ms] of plan.ms) {
      const failed = ms === null;
      const at = failed ? FAIL_PATH_MS * FAIL_AT : Math.min(MAX_ARC_MS, ms * timeScale);
      arcs.push({ id, failed, at, duration: failed ? FAIL_PATH_MS : at, done: false, doneAt: 0 });
    }
    arcs.sort((a, b) => a.at - b.at || Number(a.failed) - Number(b.failed));
    const now = performance.now();
    this.round = { plan, start: now, timeScale, scale, arcs, finished: false, finishedAt: now, cut: false };
    this.rings = [];
    this.landedAt.clear();
    this.arcsDirty = true;
    this.stripDirty = true;
    return true;
  }

  /** The board closed the round early (or it already ended): stop the clock and let the trails fade at once. */
  settle() {
    const round = this.round;
    if (!round || round.finished) return;
    const now = performance.now();
    for (const arc of round.arcs) {
      if (arc.done) continue;
      arc.done = true;
      arc.doneAt = now - CRACK_FADE_MS;
    }
    round.finished = true;
    round.cut = true;
    round.finishedAt = now;
  }

  /** One frame. Returns whether anything still moves. */
  step(
    base: CanvasSurface | null,
    arcs: CanvasSurface | null,
    effects: CanvasSurface | null,
    strip: CanvasSurface | null,
    delta: number,
    reduced: boolean,
  ) {
    const now = performance.now();
    let moving = false;
    if (base && this.baseDirty && this.ink && this.lattice) {
      this.bake(base);
      this.baseDirty = false;
    }
    if (this.advance(now)) moving = true;
    if (stepLevel(this.highlight, delta, reduced)) moving = true;
    if (this.highlight.position === 0 && !this.highlightId) this.highlightShown = null;

    const arcsMoving = this.arcsActive(now) || moving;
    if (arcs && (arcsMoving || this.arcsDirty)) {
      if (this.drawArcs(arcs, now)) moving = true;
      this.arcsDirty = false;
    }
    if (arcsMoving) moving = true;
    if (effects && this.drawEffects(effects, delta)) moving = true;
    if (strip && this.stripBox) {
      const stripMoving = this.stripActive(now, reduced);
      if (stripMoving || this.stripDirty) {
        this.drawStrip(strip, now, reduced);
        this.stripDirty = false;
      }
      if (stripMoving) moving = true;
    }
    if (this.round && this.round.finished && this.trailLevel(this.round, now) <= 0 && now - this.round.finishedAt > CRACK_FADE_MS) {
      this.round = null;
      this.arcsDirty = true;
      this.stripDirty = true;
      // one more frame clears the last faint trail dots
      moving = true;
    }
    return moving;
  }

  /* internals */

  private placeSites() {
    const projection = this.projection;
    const box = this.box;
    this.sites.clear();
    if (!projection || !box) return;
    const point = createScreenPoint();
    const to = onMap(this.target);
    projection.project(to.lat, to.lon, point);
    this.targetX = point.x;
    this.targetY = point.y;
    for (const probe of this.probes) {
      const from = onMap(probe);
      projection.project(from.lat, from.lon, point);
      const x = point.x;
      const y = point.y;
      if (Math.hypot(x - this.targetX, y - this.targetY) < 1) {
        this.sites.set(probe.id, { id: probe.id, x, y, tables: [] });
        continue;
      }
      // bow away from the side of the chord that faces the map's centre, so the fan of arcs stays open
      let tables = flatPaths(projection, from, to, { bend: BEND, segments: 48 });
      const main = tables[0];
      const last = main.count - 1;
      const dx = main.xs[last] - main.xs[0];
      const dy = main.ys[last] - main.ys[0];
      const side = (box.width / 2 - main.xs[0]) * dy - (box.height / 2 - main.ys[0]) * dx;
      if (side > 0) tables = flatPaths(projection, from, to, { bend: -BEND, segments: 48 });
      this.sites.set(probe.id, { id: probe.id, x, y, tables });
    }
  }

  /** The round's clock: fires arrivals and cracks whose time has come, then the end. */
  private advance(now: number) {
    const round = this.round;
    if (!round || round.finished) return false;
    const elapsed = now - round.start;
    for (const arc of round.arcs) {
      if (arc.at > elapsed) break;
      if (arc.done) continue;
      arc.done = true;
      arc.doneAt = round.start + arc.at;
      if (arc.failed) {
        this.crack(arc.id);
        this.onFail(round.plan, arc.id);
      } else {
        this.rings.push(arc.doneAt);
        this.landedAt.set(arc.id, arc.doneAt);
        this.onLand(round.plan, arc.id);
      }
    }
    if (round.arcs.every((arc) => arc.done)) {
      round.finished = true;
      round.finishedAt = now;
      this.onFinish(round.plan);
    }
    return true;
  }

  /** A failed check breaks: its head bursts into red sparks on the layer that reaches past the map. */
  private crack(id: string) {
    const site = this.sites.get(id);
    const ink = this.ink;
    if (!site || !ink || site.tables.length === 0) return;
    for (const table of site.tables) {
      pointAtDistance(table, table.length * FAIL_AT, this.cursor);
      if (!this.inside(this.cursor.x, this.cursor.y)) continue;
      this.sparks.add(this.cursor.x + this.effectsX, this.cursor.y + this.effectsY, CRACK_SPARKS, [ink.destructive, mixRgb(ink.destructive, ink.card, 0.35)], {
        speed: [60, 200],
        gravity: 180,
        life: [0.45, 0.95],
        size: [1.5, 2.5],
        drag: 2.6,
        jitter: 1.5,
      });
    }
  }

  private inside(x: number, y: number) {
    const box = this.box;
    return Boolean(box) && x >= -2 && y >= -2 && x <= (box?.width ?? 0) + 2 && y <= (box?.height ?? 0) + 2;
  }

  /** Trail opacity: full while the round plays, held 2 s after the last arrival, then fading. */
  private trailLevel(round: PlayingRound, now: number) {
    if (!round.finished) return 1;
    const hold = round.cut ? 0 : TRAIL_HOLD_MS;
    const fade = round.cut ? 300 : TRAIL_FADE_MS;
    return 1 - smoothstep(0, 1, (now - round.finishedAt - hold) / fade);
  }

  private arcsActive(now: number) {
    const round = this.round;
    if (this.rings.length > 0) return true;
    if (!round) return false;
    return !round.finished || this.trailLevel(round, now) > 0 || now - round.finishedAt < CRACK_FADE_MS;
  }

  private stripActive(now: number, reduced: boolean) {
    const round = this.round;
    if (round && (!round.finished || this.trailLevel(round, now) > 0)) return true;
    if (reduced) return false;
    for (const time of this.landedAt.values()) if (now - time < 8 * BLOCK_ROW_MS + 900) return true;
    return false;
  }

  private bake(surface: CanvasSurface) {
    const { context, width, height, dpr } = surface;
    const lattice = this.lattice;
    context.clearRect(0, 0, width, height);
    if (!lattice) return;
    const size = snapSize(DOT_SIZE, dpr);
    context.fillStyle = this.colors.land;
    context.globalAlpha = BASE_ALPHA;
    for (let i = 0; i < lattice.count; i++) {
      context.fillRect(snap(lattice.x[i] - size / 2, dpr), snap(lattice.y[i] - size / 2, dpr), size, size);
    }
    context.globalAlpha = 1;
  }

  /** A dot on the batch, snapped to device pixels so small squares stay crisp. */
  private addDot(x: number, y: number, size: number, tone: number, alpha: number) {
    const dpr = this.box?.dpr ?? 1;
    const s = snapSize(size, dpr);
    this.batch?.add(snap(x - s / 2, dpr) + s / 2, snap(y - s / 2, dpr) + s / 2, s, tone, alpha);
  }

  /** Lattice dots on an uneven ring around a point, `strength` 0..1, from the accent toward the hottest tone. */
  private ring(x: number, y: number, radius: number, width: number, strength: number) {
    const lattice = this.lattice;
    if (!lattice || strength <= 0) return;
    lattice.grid.query(x, y, radius + width * 2.5 + 4, (i, distanceSquared) => {
      const b = ringFront(Math.sqrt(distanceSquared), radius, width, lattice.jitter[i], 4) * strength;
      if (b > 0.05) this.addDot(lattice.x[i], lattice.y[i], DOT_SIZE + 0.6 * b, 0.5 + 0.5 * b, Math.min(1, b));
    });
  }

  /** A trail from the probe to `progress` of the path, with a brighter comet tail when the head is still moving. */
  private trail(site: Site, progress: number, alpha: number, head: boolean, settle: number) {
    for (const table of site.tables) {
      const s = table.length * progress;
      forEachDot(table, TRAIL_SPACING, 0, s, (x, y, d) => {
        const near = head ? clamp(1 - (s - d) / TAIL_PX, 0, 1) : 0;
        const glow = near * near;
        const a = (TRAIL_ALPHA + 0.5 * glow + 0.45 * settle) * alpha;
        this.addDot(x, y, DOT_SIZE + 0.5 * glow, 0.5 + 0.5 * Math.max(glow, settle * 0.7), Math.min(1, a));
      });
    }
  }

  private drawArcs(surface: CanvasSurface, now: number) {
    const { context, width, height, dpr } = surface;
    context.clearRect(0, 0, width, height);
    const batch = this.batch;
    const lattice = this.lattice;
    const ink = this.ink;
    if (!batch || !lattice || !ink) return false;
    let animating = false;
    const round = this.round;
    const level = clamp(this.highlight.position, 0, 1);
    const shown = this.highlightShown;
    const others = 1 - 0.65 * level;

    if (round) {
      const elapsed = now - round.start;
      const fade = this.trailLevel(round, now);
      if (elapsed < LAUNCH_MS) {
        // every probe that reports flashes a small ring of lit land at launch
        const t = elapsed / LAUNCH_MS;
        for (const arc of round.arcs) {
          const site = this.sites.get(arc.id);
          if (site) this.ring(site.x, site.y, 1 + 9 * easeOutCubic(t), 2.2, 0.85 * (1 - t));
        }
        animating = true;
      }
      if (fade > 0) {
        for (const arc of round.arcs) {
          const site = this.sites.get(arc.id);
          if (!site || (arc.failed && arc.done)) continue;
          const alpha = fade * (arc.id === shown ? 1 : others);
          if (arc.failed) {
            this.trail(site, Math.min(FAIL_AT, elapsed / arc.duration), alpha, true, 0);
          } else {
            const progress = arc.done ? 1 : clamp(elapsed / arc.duration, 0, 1);
            const settle = arc.done && !round.cut ? Math.exp(-(now - arc.doneAt) / 280) : 0;
            this.trail(site, progress, alpha, !arc.done, settle);
          }
        }
        animating = true;
      }
    }

    // the arrival rings at the target: overlapping arrivals add up, capped at 1
    this.rings = this.rings.filter((start) => now - start < RING_MS);
    if (this.rings.length > 0) {
      const rings = this.rings;
      lattice.grid.query(this.targetX, this.targetY, RING_REACH + 14, (i, distanceSquared) => {
        const distance = Math.sqrt(distanceSquared);
        let b = 0;
        for (const start of rings) {
          const t = (now - start) / RING_MS;
          if (t < 0 || t >= 1) continue;
          b += ringFront(distance, 2 + RING_REACH * easeOutCubic(t), 3.5, lattice.jitter[i], 4) * Math.pow(1 - t, 1.2);
        }
        b = Math.min(1, b);
        if (b > 0.05) this.addDot(lattice.x[i], lattice.y[i], DOT_SIZE + 0.6 * b, 0.5 + 0.5 * b, b);
      });
      animating = true;
    }

    // a pointed row shows its probe's whole path
    const pointedSite = shown ? this.sites.get(shown) : undefined;
    if (pointedSite && level > 0.01) {
      for (const table of pointedSite.tables) {
        forEachDot(table, TRAIL_SPACING, 0, table.length, (x, y) => this.addDot(x, y, DOT_SIZE, 0.55, 0.85 * level));
      }
    }
    batch.flush(context);

    if (round) {
      const elapsed = now - round.start;
      const fade = this.trailLevel(round, now);
      for (const arc of round.arcs) {
        const site = this.sites.get(arc.id);
        if (!site) continue;
        if (!arc.done && fade > 0) {
          const progress = arc.failed ? Math.min(FAIL_AT, elapsed / arc.duration) : clamp(elapsed / arc.duration, 0, 1);
          this.heads(context, site, progress, dpr, arc.id === shown ? 1 : others, ink.accent);
        } else if (arc.failed && arc.done) {
          const t = (now - arc.doneAt) / CRACK_FADE_MS;
          if (t < 1) {
            this.cracked(context, site, t, now - arc.doneAt, dpr);
            animating = true;
          }
        }
      }
    }
    context.globalAlpha = 1;
    return animating;
  }

  /** The comet head: a soft accent glow, an accent square and a glint core. */
  private heads(context: CanvasRenderingContext2D, site: Site, progress: number, dpr: number, alpha: number, accent: RGB) {
    for (const table of site.tables) {
      pointAtDistance(table, table.length * progress, this.cursor);
      const { x, y } = this.cursor;
      if (!this.inside(x, y)) continue;
      const glow = context.createRadialGradient(x, y, 0, x, y, 8);
      glow.addColorStop(0, rgba(accent, 0.42 * alpha));
      glow.addColorStop(1, rgba(accent, 0));
      context.globalAlpha = 1;
      context.fillStyle = glow;
      context.fillRect(x - 8, y - 8, 16, 16);
      context.globalAlpha = alpha;
      context.fillStyle = this.colors.accent;
      fillSquare(context, x, y, 3.5, dpr);
      context.fillStyle = this.colors.glint;
      fillSquare(context, x, y, 1.5, dpr);
    }
    context.globalAlpha = 1;
  }

  /** A broken arc: its drawn half turns dashed red and fades, with a short red flash where it broke. */
  private cracked(context: CanvasRenderingContext2D, site: Site, t: number, since: number, dpr: number) {
    const ink = this.ink;
    if (!ink) return;
    context.fillStyle = this.colors.destructive;
    context.globalAlpha = 0.6 * (1 - t);
    for (const table of site.tables) {
      forEachDot(table, TRAIL_SPACING, 0, table.length * FAIL_AT, (x, y, s) => {
        if (Math.round(s / TRAIL_SPACING) % 4 >= 2) return;
        fillSquare(context, x, y, DOT_SIZE, dpr);
      });
    }
    if (since < 320) {
      const k = since / 320;
      for (const table of site.tables) {
        pointAtDistance(table, table.length * FAIL_AT, this.cursor);
        const { x, y } = this.cursor;
        const radius = 4 + 10 * easeOutCubic(k);
        const flash = context.createRadialGradient(x, y, 0, x, y, radius);
        flash.addColorStop(0, rgba(ink.destructive, 0.5 * (1 - k)));
        flash.addColorStop(1, rgba(ink.destructive, 0));
        context.globalAlpha = 1;
        context.fillStyle = flash;
        context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
    }
    context.globalAlpha = 1;
  }

  private drawEffects(surface: CanvasSurface, delta: number) {
    const { context, width, height } = surface;
    if (!this.sparks.active) {
      if (this.effectsDirty) {
        context.clearRect(0, 0, width, height);
        this.effectsDirty = false;
      }
      return false;
    }
    this.effectsDirty = true;
    context.clearRect(0, 0, width, height);
    return this.sparks.step(context, delta);
  }

  /**
   * The arrival timeline: a quiet dot lattice with a baseline; while a round plays, the elapsed time sweeps it from
   * the left with an uneven bright front, and each result drops a block of dots at its time as it lands.
   */
  private drawStrip(surface: CanvasSurface, now: number, reduced: boolean) {
    const { context, width, height, dpr } = surface;
    context.clearRect(0, 0, width, height);
    const ink = this.ink;
    if (!ink || width < 8 || height < 8) return;
    const columns = Math.max(2, Math.floor((width - 2) / STRIP_PITCH) + 1);
    const rows = Math.max(2, Math.floor((height - 2) / STRIP_PITCH) + 1);
    const left = (width - (columns - 1) * STRIP_PITCH) / 2;
    const bottom = height - (height - (rows - 1) * STRIP_PITCH) / 2;
    const scale = this.stripScale;
    const round = this.round;
    const level = round ? this.trailLevel(round, now) : 0;
    let sweep = -1;
    if (round && level > 0) {
      const end = round.finished ? round.finishedAt : now;
      sweep = clamp((end - round.start) / round.timeScale / round.scale, 0, 1) * (width - 2 * left) + left;
    }
    const live = round !== null && !round.finished;

    // at rest only the baseline, with a raised dot at each tick
    const size = snapSize(DOT_SIZE, dpr);
    const baseY = snap(bottom - size / 2, dpr);
    context.fillStyle = this.stripInk.baseline;
    for (let c = 0; c < columns; c++) context.fillRect(snap(left + c * STRIP_PITCH - size / 2, dpr), baseY, size, size);
    for (const tick of scaleTicks(scale)) {
      const c = Math.round((tick / scale) * (columns - 1));
      for (let r = 1; r <= 2; r++) {
        context.globalAlpha = r === 1 ? 1 : 0.45;
        context.fillRect(snap(left + c * STRIP_PITCH - size / 2, dpr), snap(bottom - r * STRIP_PITCH - size / 2, dpr), size, size);
      }
    }
    context.globalAlpha = 1;

    // while a round plays, its elapsed time fills the lattice in from the left behind an uneven, bright front
    if (sweep >= 0) {
      for (let r = 0; r < rows; r++) {
        const y = snap(bottom - r * STRIP_PITCH - size / 2, dpr);
        const fall = 1 - (r / rows) * 0.45;
        for (let c = 0; c < columns; c++) {
          const x = left + c * STRIP_PITCH;
          const behind = sweep - x - hash(c * 31 + r * 7 + 1) * 8;
          if (behind <= 0) continue;
          const front = live ? Math.exp(-(behind / 7) * (behind / 7)) : 0;
          context.fillStyle = front > 0.45 ? this.colors.hot : this.colors.accent;
          context.globalAlpha = (0.16 * fall + 0.8 * front) * level;
          context.fillRect(snap(x - size / 2, dpr), y, size, size);
        }
      }
      context.globalAlpha = 1;
    }

    // result blocks, two columns wide, stacked where they collide
    if (this.stripHeights.length < columns) this.stripHeights = new Int16Array(columns);
    const heights = this.stripHeights;
    heights.fill(0, 0, columns);
    // blocks grow with the timeline's height, so a tall timeline reads as a histogram rather than a few specks
    const blockRows = clamp(Math.round(rows * 0.22), BLOCK_ROWS, 8);
    for (const result of this.stripResults) {
      const fraction = clamp(result.ms / scale, 0, 1);
      const column = clamp(Math.round(fraction * (columns - 1) - 0.5), 0, columns - 2);
      const base = Math.max(heights[column], heights[column + 1]);
      heights[column] = base + blockRows;
      heights[column + 1] = base + blockRows;
      const landed = this.landedAt.get(result.id);
      const age = landed === undefined || reduced ? Infinity : now - landed;
      const grown = Number.isFinite(age) ? clamp(Math.floor(age / BLOCK_ROW_MS) + 1, 0, blockRows) : blockRows;
      const flash = Number.isFinite(age) ? Math.exp(-age / 420) : 0;
      const rest = result.ms >= this.slowMs ? this.stripInk.slow : this.stripInk.rest;
      const color = rgba(mixRgb(rest, this.stripInk.flash, flash));
      context.fillStyle = color;
      for (let k = 0; k < grown; k++) {
        const r = base + k;
        if (r >= rows) break;
        const y = bottom - r * STRIP_PITCH;
        context.globalAlpha = k === grown - 1 ? 1 : 0.85;
        for (let c = column; c <= column + 1; c++) {
          const x = left + c * STRIP_PITCH;
          fillSquare(context, x, y, DOT_SIZE + 0.5 + 0.6 * flash, dpr);
        }
      }
    }
    context.globalAlpha = 1;
  }
}

const LEVEL_SPRING: SettleSpringOptions = { stiffness: 260, damping: 1, epsilon: 0.002, velocityEpsilon: 0.02 };

/** One step of a critically damped 0..1 level. Returns whether it still moves. */
function stepLevel(level: Level, delta: number, reduced: boolean) {
  return settleSpring(level, level.target, delta, reduced, LEVEL_SPRING);
}
