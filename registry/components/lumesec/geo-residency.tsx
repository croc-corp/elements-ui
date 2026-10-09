"use client";

import * as React from "react";

import { snapCenter, useCanvas, type CanvasSurface } from "@/lib/lumesec/canvas";
import { usePalette } from "@/lib/lumesec/color";
import {
  ARROW_DIRECTIONS,
  boundsOf,
  buildArcLength,
  countryBounds,
  countryOutline,
  createDotBatch,
  createProjection,
  createScreenPoint,
  fitBoundsToAspect,
  flatCurve,
  flatPaths,
  forEachDot,
  GEO_TOKENS,
  geoInk,
  isValidLatLon,
  MAP_LAT_RANGE,
  mapLattice,
  placeLabels,
  pointAtDistance,
  projectionOutlineSvgPath,
  quadArcLength,
  ringFront,
  spatialNavigate,
  toLonLat,
  traceMapLine,
  unionBounds,
  wrapLongitude,
  zoneContains,
  zoneMembership,
  type ArcLengthTable,
  type DotBatch,
  type DotLattice,
  type GeoBounds,
  type GeoInk,
  type GeoPalette,
  type LabelAnchor,
  type LabelPlacement,
  type LatLon,
  type MapProjection,
  type ZoneShape,
} from "@/lib/lumesec/geo";
import { clamp, hash, mixRgb, percent, rgba, stringHash, type RGB } from "@/lib/lumesec/math";
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

/** What a site does with the data: keeps it, works on it, or holds a copy of it. */
export type ResidencyRole = "storage" | "processing" | "backup";

/** How the map is framed: fitted around the zone, or the whole world. */
export type GeoResidencyFocus = "zone" | "world";

/** The jurisdiction data has to stay in: ISO 3166-1 alpha-2 countries, a custom polygon, or both (their union). */
export interface ResidencyZone {
  /** Name in the header, the status chip and the accessible names, for example `Germany` or `EU`. */
  readonly label: string;
  /** ISO 3166-1 alpha-2 codes, such as `["DE"]`. Codes the map does not know match nothing. */
  readonly countries?: readonly string[];
  /** A custom area as a ring of at least three points in degrees, closed or not. It may cross the antimeridian. */
  readonly polygon?: readonly LatLon[];
}

/** A place where data is stored or processed. */
export interface ResidencySite {
  /** Unique id that `ResidencyTransfer.from`, `ResidencyTransfer.to` and `value` refer to. */
  readonly id: string;
  /** Name beside the marker and in the accessible names, such as `Frankfurt` or `us-east`. */
  readonly label: string;
  /** Latitude in degrees, −90 to 90. */
  readonly lat: number;
  /** Longitude in degrees. */
  readonly lon: number;
  /** `storage` (filled square), `processing` (ring) or `backup` (outlined square). */
  readonly role: ResidencyRole;
}

/** Data moving from one site to another. */
export interface ResidencyTransfer {
  /** Unique id, handed back through `onViolation`. */
  readonly id: string;
  /** Id of the site the data leaves. */
  readonly from: string;
  /** Id of the site the data goes to. */
  readonly to: string;
  /** How much moves, 0 to 1 (default 0.5). Packets leave at 0.4 + 1.6 × volume per second. */
  readonly volume?: number;
}

/** Props of `GeoResidency`. Other `div` props, `ref` included, go to the root. */
export interface GeoResidencyProps extends Omit<React.ComponentProps<"div">, "defaultValue"> {
  /**
   * The jurisdiction: `{ label, countries?, polygon? }`. A zone with neither countries nor a polygon treats every site
   * as outside and says "No zone defined". Default: Germany while `sites` and `transfers` are both unset; with your own
   * sites or transfers and no zone, no zone is defined.
   */
  zone?: ResidencyZone;
  /**
   * The sites: `{ id, label, lat, lon, role }`. Entries with a repeated id or an invalid position are skipped. An empty
   * array shows "No sites". Without `sites` and `transfers` the component shows five demo sites.
   */
  sites?: readonly ResidencySite[];
  /**
   * The transfers between sites: `{ id, from, to, volume? }`. Transfers that name an unknown site, or the same site
   * twice, are skipped. Without `sites` and `transfers` the component shows three demo transfers.
   */
  transfers?: readonly ResidencyTransfer[];
  /** The selected site id (controlled), or null for none. Use with `onValueChange`. */
  value?: string | null;
  /** The site selected at first when uncontrolled. */
  defaultValue?: string | null;
  /** Called when a site is selected, or with null when the selection is cleared. */
  onValueChange?: (value: string | null) => void;
  /** `zone` fits the map around the zone; `world` shows the whole world. */
  focus?: GeoResidencyFocus;
  /** Called after mount with the transfers that leave the zone, and again whenever that set changes. */
  onViolation?: (transfers: readonly ResidencyTransfer[]) => void;
}

/**
 * Where data is stored and processed, measured against a jurisdiction. The zone's land dots are lit in the accent
 * colour, sites are marked by role and ringed in the warning colour when they lie outside the zone, and transfers run
 * between them as dotted lines with packets moving along them. Where a transfer crosses the zone's border a gate mark
 * sits on the line and the part outside turns into a dashed warning line; every packet that passes the gate flares the
 * land around it and carries the warning colour for the rest of its way. A new transfer grows out of its origin, and
 * when its front breaks out of the zone the border flares and sparks fly. A status chip counts the transfers that
 * leave the zone.
 *
 * @example
 * <GeoResidency
 *   zone={{ label: "Germany", countries: ["DE"] }}
 *   sites={[
 *     { id: "fra", label: "Frankfurt", lat: 50.11, lon: 8.68, role: "storage" },
 *     { id: "dub", label: "Dublin", lat: 53.35, lon: -6.26, role: "processing" },
 *   ]}
 *   transfers={[{ id: "fra-dub", from: "fra", to: "dub", volume: 0.6 }]}
 *   onViolation={(leaving) => console.log(leaving.map((transfer) => transfer.id))}
 * />
 */
export function GeoResidency({
  zone,
  sites,
  transfers,
  value,
  defaultValue = null,
  onValueChange,
  focus = "zone",
  onViolation,
  className,
  onKeyDown,
  ...props
}: GeoResidencyProps) {
  const demo = sites === undefined && transfers === undefined;
  const zoneInput = zone ?? (demo ? DEMO_ZONE : NO_ZONE);
  const siteInput = sites ?? (demo ? DEMO_SITES : NO_SITES);
  const transferInput = transfers ?? (demo ? DEMO_TRANSFERS : NO_TRANSFERS);
  const framing: GeoResidencyFocus = focus === "world" ? "world" : "zone";

  // The model is rebuilt when the data changes, not when a parent passes equal arrays again.
  const key = modelKey(zoneInput, siteInput, transferInput, framing);
  const [cache, setCache] = React.useState(() => buildModel(zoneInput, siteInput, transferInput, framing, key));
  let model = cache;
  if (cache.key !== key) {
    model = buildModel(zoneInput, siteInput, transferInput, framing, key);
    setCache(model);
  }

  const [selection, setSelection] = useControllableState<string | null>({
    value,
    defaultValue,
    onChange: onValueChange,
  });
  const selectedIndex = selection === null ? -1 : (model.indexById.get(selection) ?? -1);
  const selectedId = selectedIndex >= 0 ? model.sites[selectedIndex].site.id : null;
  const reducedMotion = useReducedMotion();

  /** The site that holds the roving tab stop; -1 follows the selection. */
  const [focusIndex, setFocusIndex] = React.useState(-1);
  /** Width of the map box in CSS px; the server and the first client render assume the nominal width. */
  const [boxWidth, setBoxWidth] = React.useState(NOMINAL_BOX_WIDTH);
  /** Gate marks the map shows: they appear when a growing line reaches its border crossing. */
  const [gates, setGates] = React.useState<GateState>(model.gates);
  /** The status the chip shows: it changes when the map has drawn the change, so the chip follows the border flare. */
  const [chip, setChip] = React.useState<ChipState>(model.chip);

  const cardRef = React.useRef<HTMLDivElement>(null);
  const stackRef = React.useRef<HTMLDivElement>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const baseRef = React.useRef<HTMLCanvasElement>(null);
  const liveRef = React.useRef<HTMLCanvasElement>(null);
  const fxRef = React.useRef<HTMLCanvasElement>(null);
  const siteRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const symbolRefs = React.useRef<(HTMLSpanElement | null)[]>([]);
  const gateRefs = React.useRef(new Map<string, HTMLSpanElement>());
  const engineRef = useLazyRef(() => createEngine());
  const onViolationRef = React.useRef(onViolation);
  const reportedRef = React.useRef<string | null>(null);
  const warnedRef = React.useRef("");

  const registerGate = React.useCallback((gateKey: string, node: HTMLSpanElement | null) => {
    if (node) gateRefs.current.set(gateKey, node);
    else gateRefs.current.delete(gateKey);
  }, []);

  const inView = useInView(cardRef);
  const loop = useAnimationLoop(cardRef, step);
  const palette = usePalette(cardRef, GEO_TOKENS, () => {
    engineRef.current.inkStale = true;
    loop.kick();
  });
  const base = useCanvas(
    baseRef,
    () => {
      engineRef.current.baked = false;
      loop.kick();
    },
    CANVAS_OPTIONS,
  );
  const live = useCanvas(liveRef, () => loop.kick(), CANVAS_OPTIONS);
  const fx = useCanvas(
    fxRef,
    (surface) => {
      // how far the effects canvas reaches past the map: measured, since it depends on the container width
      const engine = engineRef.current;
      engine.fxX = -surface.canvas.offsetLeft;
      engine.fxY = -surface.canvas.offsetTop;
      loop.kick();
    },
    CANVAS_OPTIONS,
  );

  React.useLayoutEffect(() => {
    onViolationRef.current = onViolation;
  });

  // The loop reports back: which gate marks show, when the chip may change, and which gate a packet passed.
  React.useEffect(() => {
    engineRef.current.callbacks = {
      onGates: (next) => setGates((current) => (current.key === next.key ? current : next)),
      onSettle: (next) => setChip((current) => (current.key === next.key ? current : next)),
      pulseGate: (gateKey) => {
        const node = gateRefs.current.get(gateKey);
        if (node && typeof node.animate === "function") node.animate(GATE_PULSE, GATE_PULSE_TIMING);
      },
    };
  }, [engineRef]);

  React.useEffect(() => {
    engineRef.current.inView = inView;
    if (inView) loop.kick();
  }, [inView, engineRef, loop]);

  // A new selection pops its marker; its transfers come forward and the others dim.
  React.useEffect(() => {
    const engine = engineRef.current;
    const first = !engine.selectionReady;
    engine.selectionReady = true;
    if (!first && engine.selected === selectedId) return;
    engine.selected = selectedId;
    const symbol = selectedIndex >= 0 ? symbolRefs.current[selectedIndex] : null;
    if (!first && symbol && !prefersReducedMotion() && typeof symbol.animate === "function") {
      symbol.animate(MARKER_POP, { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
    loop.kick();
  }, [selectedId, selectedIndex, engineRef, loop]);

  // New transfers grow out of their origin and removed ones retract into it. Nobody watches a map off screen, so
  // changes there apply at once.
  React.useEffect(() => {
    const engine = engineRef.current;
    syncEngine(engine, model, !prefersReducedMotion() && engine.inView);
    loop.kick();
  }, [model, engineRef, loop]);

  // Reduced motion drops packets, flares and the twinkle; restart the loop so it redraws.
  React.useEffect(() => {
    loop.kick();
  }, [reducedMotion, loop]);

  React.useEffect(() => {
    if (reportedRef.current === model.violationKey) return;
    reportedRef.current = model.violationKey;
    onViolationRef.current?.(model.violations);
  }, [model]);

  // When the map cannot animate (hidden, not laid out yet), the chip and the gate marks still follow the data.
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      if (engineRef.current.steppedKey === model.key) return;
      setChip((current) => (current.key === model.chip.key ? current : model.chip));
      setGates((current) => (current.key === model.gates.key ? current : model.gates));
    }, SETTLE_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [model, engineRef]);

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

  // Skipped entries are named once per data set while developing.
  React.useEffect(() => {
    if (!model.skipped || warnedRef.current === model.skipped || process.env.NODE_ENV === "production") return;
    warnedRef.current = model.skipped;
    console.warn(
      `GeoResidency: skipped entries with a missing or repeated id, an invalid position or an unknown site: ${model.skipped}.`,
    );
  }, [model.skipped]);

  function step(time: number, delta: number) {
    const engine = engineRef.current;
    const current = engine.model;
    const baseSurface = base.current;
    const liveSurface = live.current;
    const fxSurface = fx.current;
    const colors = palette.current;
    if (!current || !baseSurface || !liveSurface || !fxSurface || !colors) return false;
    const reduced = prefersReducedMotion();

    if (engine.inkStale || !engine.ink) refreshInk(engine, colors);
    const layoutKey = `${baseSurface.width}x${baseSurface.height}|${current.view.key}|${current.zoneKey}`;
    if (engine.layoutKey !== layoutKey) layoutEngine(engine, current, baseSurface.width, baseSurface.height, layoutKey);
    const { lattice, projection, ink, batches } = engine;
    if (!lattice || !projection || !ink || !batches) return false;

    if (!engine.baked) {
      bakeBase(baseSurface, engine, current, lattice, projection, ink);
      engine.baked = true;
      const stack = stackRef.current;
      if (stack) stack.style.opacity = "1";
    }
    for (const path of engine.paths.values()) {
      if (!path.tables) buildPathTables(engine, path);
    }

    const moving = advancePaths(engine, delta, reduced, time);
    if (reduced) {
      engine.packets.length = 0;
      engine.flares.length = 0;
      engine.sparks.clear();
    } else {
      spawnPackets(engine, delta);
      movePackets(engine, delta, time);
    }
    drawLive(engine, liveSurface, lattice, projection, batches, time, reduced);
    const sparking = drawSparks(engine, fxSurface, delta);
    prunePaths(engine);
    report(engine, current);
    engine.steppedKey = current.key;

    // the zone's twinkle and the packets are the ambient motion; with reduced motion the loop stops once settled
    const ambient = !reduced && (engine.zoneDots.length > 0 || engine.paths.size > 0);
    return moving || ambient || sparking || engine.flares.length > 0;
  }

  function moveFocus(index: number) {
    setFocusIndex(index);
    siteRefs.current[index]?.focus();
  }

  function handleSiteClick(index: number) {
    const id = model.sites[index].site.id;
    setFocusIndex(index);
    setSelection(selection === id ? null : id);
  }

  function handleSiteKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const direction = ARROW_DIRECTIONS[event.key];
    if (!direction) return;
    event.preventDefault();
    const next = spatialNavigate(model.navigation, index, direction);
    if (next !== index) moveFocus(next);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.key !== "Escape" || selection === null) return;
    event.preventDefault();
    setSelection(null);
  }

  const placements = React.useMemo(
    () => placeSiteLabels(model, boxWidth, selectedIndex),
    [model, boxWidth, selectedIndex],
  );
  const related = relatedSites(model, selectedIndex);
  const tabStop = focusIndex >= 0 && focusIndex < model.sites.length ? focusIndex : Math.max(0, selectedIndex);
  const shownChip = reducedMotion ? model.chip : chip;
  const shownGates = reducedMotion ? model.gates.list : gates.list;

  return (
    <div
      data-slot="geo-residency"
      role="group"
      aria-label="Data residency"
      className={cn("@container grid w-full max-w-[660px] gap-3 text-foreground", className)}
      onKeyDown={handleKeyDown}
      {...props}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <ZoneSwatch />
          <span className="text-[12.5px] leading-5 text-muted-foreground">Zone</span>
          <span className="truncate text-[14px] leading-5 font-medium">{model.zoneTitle}</span>
        </div>
        <StatusChip chip={shownChip} animate={!reducedMotion} />
      </div>

      <div
        ref={cardRef}
        className="relative rounded-xl border border-border bg-card [-webkit-tap-highlight-color:transparent]"
      >
        {model.outline ? (
          <svg
            aria-hidden="true"
            viewBox={`0 0 ${NOMINAL_WIDTH} ${NOMINAL_HEIGHT}`}
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 block size-full overflow-visible"
          >
            <path
              d={model.outline}
              vectorEffect="non-scaling-stroke"
              strokeWidth={1}
              className="fill-muted/35 stroke-border"
            />
          </svg>
        ) : null}
        <div
          ref={stackRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-[11px] opacity-0 transition-opacity duration-700 ease-out motion-reduce:transition-none"
        >
          <canvas ref={baseRef} aria-hidden="true" className="absolute inset-0 block size-full" />
          <canvas ref={liveRef} aria-hidden="true" className="absolute inset-0 block size-full" />
        </div>
        <div ref={boxRef} className="relative" style={{ aspectRatio: ASPECT }}>
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            {shownGates.map((gate) => (
              <GateMark
                key={gate.key}
                gate={gate}
                dimmed={selectedId !== null && gate.from !== selectedId && gate.to !== selectedId}
                register={registerGate}
              />
            ))}
          </div>
          <div
            role="group"
            aria-label="Sites"
            className="absolute inset-0"
            onClick={(event) => {
              // a click on the empty map clears the selection, like Escape
              if (event.target === event.currentTarget && selection !== null) setSelection(null);
            }}
          >
            {model.sites.map((placed, i) => {
              const selected = i === selectedIndex;
              const dimmed = selectedIndex >= 0 && !related.has(i);
              const buttonRef = (node: HTMLButtonElement | null) => {
                siteRefs.current[i] = node;
              };
              const symbolRef = (node: HTMLSpanElement | null) => {
                symbolRefs.current[i] = node;
              };
              const common = {
                placed,
                name: siteName(placed, model.zoneName),
                selected,
                dimmed,
                tabbable: i === tabStop,
                buttonRef,
                symbolRef,
                onSelect: () => handleSiteClick(i),
                onFocus: () => setFocusIndex(i),
                onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => handleSiteKeyDown(event, i),
              };
              return placed.pin ? (
                <PinnedSite key={placed.site.id} pin={placed.pin} {...common} />
              ) : (
                <SiteMarker key={placed.site.id} placement={placements[i]} {...common} />
              );
            })}
          </div>
          {model.sites.length === 0 ? (
            <p className="absolute inset-0 m-0 grid place-items-center text-[12.5px] leading-5 text-muted-foreground">
              No sites
            </p>
          ) : null}
        </div>
        <canvas
          ref={fxRef}
          aria-hidden="true"
          className="pointer-events-none absolute -top-8 -left-4 z-[4] block h-[calc(100%+64px)] w-[calc(100%+32px)] @min-[560px]:-left-8 @min-[560px]:w-[calc(100%+64px)]"
        />
      </div>

      <Legend />

      <ul aria-label="Transfers" className="sr-only">
        {model.transfers.length === 0 ? (
          <li>No transfers</li>
        ) : (
          model.transfers.map((transfer) => <li key={transfer.key}>{transfer.description}</li>)
        )}
      </ul>
    </div>
  );
}

/* Header ------------------------------------------------------------------------------------------------ */

/** A 3 × 3 patch of accent dots: the zone's lit land, in the header. */
function ZoneSwatch() {
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true" className="size-2.5 shrink-0 text-lumesec">
      {SWATCH_DOTS.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x - 0.9} y={y - 0.9} width={1.8} height={1.8} fill="currentColor" opacity={0.75} />
      ))}
    </svg>
  );
}

const SWATCH_DOTS: readonly (readonly [number, number])[] = [1.5, 5, 8.5].flatMap((x) =>
  [1.5, 5, 8.5].map((y) => [x, y] as const),
);

/**
 * The residency status as a polite live region: success when every transfer stays in the zone, a warning with the
 * count of transfers that leave it, or "No zone defined". The count rolls in the direction it changes and the chip
 * pops when the status changes.
 */
function StatusChip({ chip, animate }: { chip: ChipState; animate: boolean }) {
  const chipRef = React.useRef<HTMLSpanElement>(null);
  const poppedKey = React.useRef(chip.key);
  const [roll, setRoll] = React.useState({ count: chip.count, direction: 1 });
  if (roll.count !== chip.count) setRoll({ count: chip.count, direction: chip.count > roll.count ? 1 : -1 });

  React.useLayoutEffect(() => {
    if (poppedKey.current === chip.key) return;
    poppedKey.current = chip.key;
    const node = chipRef.current;
    if (!node || !animate || prefersReducedMotion() || typeof node.animate !== "function") return;
    node.animate(CHIP_POP, { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" });
  }, [chip.key, animate]);

  return (
    <span
      ref={chipRef}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-tone={chip.tone}
      className={cn(
        "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] leading-none font-medium whitespace-nowrap",
        chip.tone === "ok"
          ? "border-[color-mix(in_srgb,var(--lumesec-success)_45%,var(--border))] bg-lumesec-success/8"
          : "border-[color-mix(in_srgb,var(--lumesec-warning)_50%,var(--border))] bg-lumesec-warning/10",
      )}
    >
      <ChipIcon tone={chip.tone} />
      {chip.tone === "ok" ? (
        <span className="truncate">All data stays in {chip.zoneName}</span>
      ) : chip.tone === "warn" ? (
        <span className="inline-flex min-w-0 items-center gap-[0.3em]">
          <RollText
            text={String(chip.count)}
            direction={roll.direction}
            animate={animate}
            className="font-mono tabular-nums"
          />
          <span className="truncate">
            {chip.count === 1 ? "transfer leaves" : "transfers leave"} {chip.zoneName}
          </span>
        </span>
      ) : (
        <span className="truncate">No zone defined</span>
      )}
    </span>
  );
}

function ChipIcon({ tone }: { tone: ChipTone }) {
  if (tone === "ok") {
    return (
      <svg
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="size-3 shrink-0 text-lumesec-success"
      >
        <path d="M2.5 6.25 5 8.75l4.5-5.5" />
      </svg>
    );
  }
  if (tone === "warn") {
    // a line leaving a box: data on its way out of the zone
    return (
      <svg
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="size-3 shrink-0 text-lumesec-warning"
      >
        <path d="M6.5 2H2.5v8h4M5 6h5.5M8.5 4l2 2-2 2" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeDasharray="2 2"
      aria-hidden="true"
      className="size-3 shrink-0 text-lumesec-warning"
    >
      <circle cx="6" cy="6" r="4.25" />
    </svg>
  );
}

/* Sites ------------------------------------------------------------------------------------------------- */

interface SiteButtonProps {
  placed: PlacedSite;
  /** Accessible name: label, role and whether the site is in the zone. */
  name: string;
  selected: boolean;
  /** Another site is selected and this one exchanges no data with it. */
  dimmed: boolean;
  /** Holds the roving tab stop. */
  tabbable: boolean;
  buttonRef: (node: HTMLButtonElement | null) => void;
  symbolRef: (node: HTMLSpanElement | null) => void;
  onSelect: () => void;
  onFocus: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}

/** The role's mark: storage a filled square, processing a ring, backup an outlined square. */
function RoleSymbol({ role, className }: { role: ResidencyRole; className?: string }) {
  return <span aria-hidden="true" className={cn("block shrink-0", ROLE_SYMBOLS[role], className)} />;
}

/** A site on the map: its role mark (ringed in the warning colour outside the zone) and its name beside it. */
function SiteMarker({
  placed,
  placement,
  name,
  selected,
  dimmed,
  tabbable,
  buttonRef,
  symbolRef,
  onSelect,
  onFocus,
  onKeyDown,
}: SiteButtonProps & { placement: LabelPlacement }) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-pressed={selected}
      aria-label={name}
      tabIndex={tabbable ? 0 : -1}
      data-state={selected ? "on" : "off"}
      onClick={onSelect}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      className={cn(
        "group/site absolute -mt-3 -ml-3 grid size-6 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 font-[inherit] text-foreground outline-none focus-visible:outline-2 focus-visible:outline-lumesec focus-visible:outline-solid",
        selected && "z-[2]",
      )}
      style={{ left: percent(placed.x), top: percent(placed.y) }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0.5 scale-75 rounded-full border-[1.5px] border-lumesec opacity-0 transition-[opacity,scale] duration-300 group-data-[state=on]/site:scale-100 group-data-[state=on]/site:opacity-100 motion-reduce:transition-none"
      />
      <span
        ref={symbolRef}
        aria-hidden="true"
        className={cn(
          "relative grid size-4 place-items-center rounded-full transition-opacity duration-300 motion-reduce:transition-none",
          !placed.inside && "border border-lumesec-warning bg-card",
          dimmed && "opacity-45",
        )}
      >
        <RoleSymbol role={placed.role} className={placed.inside ? "shadow-[0_0_0_2px_var(--card)]" : undefined} />
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "absolute text-[11px] leading-[14px] whitespace-nowrap transition-[opacity,color] duration-300 [text-shadow:0_0_2px_var(--card),0_0_4px_var(--card),0_0_6px_var(--card)] group-hover/site:text-foreground motion-reduce:transition-none",
          selected ? "text-foreground" : "text-muted-foreground",
          !placement.visible ? "pointer-events-none opacity-0" : dimmed && "opacity-40",
        )}
        style={LABEL_STYLES[placement.side]}
      >
        {placed.label}
      </span>
    </button>
  );
}

/** A site off the map: a chip on the nearest edge with an arrow toward the site. Its transfers run to the chip. */
function PinnedSite({
  placed,
  pin,
  name,
  selected,
  dimmed,
  tabbable,
  buttonRef,
  symbolRef,
  onSelect,
  onFocus,
  onKeyDown,
}: SiteButtonProps & { pin: SitePin }) {
  const arrow = <PinArrow angle={pin.angle} />;
  const arrowFirst = pin.side !== "right";
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-pressed={selected}
      aria-label={name}
      tabIndex={tabbable ? 0 : -1}
      data-state={selected ? "on" : "off"}
      onClick={onSelect}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      className={cn(
        "absolute z-[3] inline-flex h-[22px] max-w-[45%] cursor-pointer items-center gap-1.5 rounded-full border bg-card px-2 font-[inherit] text-[11px] leading-none whitespace-nowrap text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06)] transition-[border-color,box-shadow,opacity] duration-300 outline-none hover:border-[color-mix(in_srgb,var(--lumesec-warning)_80%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid motion-reduce:transition-none",
        selected
          ? "border-lumesec shadow-[0_0_0_1px_var(--lumesec)] hover:border-lumesec"
          : "border-[color-mix(in_srgb,var(--lumesec-warning)_55%,var(--border))]",
        dimmed && "opacity-50",
      )}
      style={pinStyle(pin)}
    >
      {arrowFirst ? arrow : null}
      <span ref={symbolRef} aria-hidden="true" className="grid size-2.5 shrink-0 place-items-center">
        <RoleSymbol role={placed.role} />
      </span>
      <span aria-hidden="true" className="truncate">
        {placed.label}
      </span>
      {arrowFirst ? null : arrow}
    </button>
  );
}

/** An arrow from the chip toward the site's real position, in the warning colour. */
function PinArrow({ angle }: { angle: number }) {
  return (
    <svg
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-2.5 shrink-0 text-lumesec-warning"
      style={{ transform: `rotate(${((angle * 180) / Math.PI).toFixed(1)}deg)` }}
    >
      <path d="M1.5 5h7M5.75 2.25 8.5 5 5.75 7.75" />
    </svg>
  );
}

/**
 * Two short ticks across a transfer where it crosses the zone's border. It pops in when a growing line reaches the
 * border, and the loop pulses it each time a packet passes.
 */
function GateMark({
  gate,
  dimmed,
  register,
}: {
  gate: GateView;
  dimmed: boolean;
  register: (key: string, node: HTMLSpanElement | null) => void;
}) {
  const pulseRef = React.useRef<HTMLSpanElement>(null);
  const { key, fresh } = gate;

  React.useLayoutEffect(() => {
    register(key, pulseRef.current);
    return () => register(key, null);
  }, [key, register]);

  React.useLayoutEffect(() => {
    const node = pulseRef.current;
    if (!fresh || !node || prefersReducedMotion() || typeof node.animate !== "function") return;
    const animation = node.animate(GATE_ENTER, { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" });
    return () => animation.cancel();
  }, [fresh]);

  return (
    <span
      className={cn(
        "absolute size-0 transition-opacity duration-300 motion-reduce:transition-none",
        dimmed && "opacity-30",
      )}
      style={{ left: percent(gate.x), top: percent(gate.y) }}
    >
      <span
        className="absolute -top-1.5 -left-1.5 block size-3"
        style={{ transform: `rotate(${gate.angle.toFixed(3)}rad)` }}
      >
        <span ref={pulseRef} className="absolute inset-0 block">
          <span className="absolute top-0.5 left-[3px] h-2 w-[1.5px] rounded-[1px] bg-lumesec-warning shadow-[0_0_0_1px_var(--card)]" />
          <span className="absolute top-0.5 left-[7.5px] h-2 w-[1.5px] rounded-[1px] bg-lumesec-warning shadow-[0_0_0_1px_var(--card)]" />
        </span>
      </span>
    </span>
  );
}

/* Legend ------------------------------------------------------------------------------------------------ */

/** The three role marks, and the two line styles: dotted inside the zone, dashed outside it. */
function Legend() {
  return (
    <div
      aria-hidden="true"
      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-0.5 text-[12px] leading-4 text-muted-foreground"
    >
      {ROLE_ORDER.map((role) => (
        <span key={role} className="inline-flex items-center gap-1.5">
          <span className="grid size-3 place-items-center text-foreground">
            <RoleSymbol role={role} />
          </span>
          {ROLE_TITLES[role]}
        </span>
      ))}
      <span className="inline-flex items-center gap-x-4 gap-y-1.5 @min-[520px]:ml-auto">
        <span className="inline-flex items-center gap-1.5">
          <LineSample dashed={false} />
          In zone
        </span>
        <span className="inline-flex items-center gap-1.5">
          <LineSample dashed />
          Outside zone
        </span>
      </span>
    </div>
  );
}

function LineSample({ dashed }: { dashed: boolean }) {
  return (
    <svg
      viewBox="0 0 19 4"
      aria-hidden="true"
      className={cn("h-1 w-[19px] shrink-0", dashed ? "text-lumesec-warning" : "text-foreground/45")}
    >
      {LINE_SAMPLE_DOTS.map((x, i) =>
        dashed && i % 4 >= 2 ? null : <rect key={x} x={x} y={1.25} width={1.5} height={1.5} fill="currentColor" />,
      )}
    </svg>
  );
}

const LINE_SAMPLE_DOTS = [0, 3.5, 7, 10.5, 14, 17.5];

/* Constants ------------------------------------------------------------------------------------------------ */

/** Width / height of the map box, in both framings. */
const ASPECT = 2;
/** The space the model is computed in: markers, gates and lines scale from it to the real box. */
const NOMINAL_WIDTH = 1000;
const NOMINAL_HEIGHT = NOMINAL_WIDTH / ASPECT;
/** The map box width the server markup and label placement assume before the first measurement. */
const NOMINAL_BOX_WIDTH = 658;
/** Below this map width the lattice gets finer. */
const NARROW_WIDTH = 480;
const CANVAS_OPTIONS = { maxDpr: 2 };

/** Zone framing: margin around the zone as a share of its span, and the narrowest view in degrees of longitude. */
const FRAME_MARGIN = 0.18;
const MIN_SPAN = 40;
/** Pinned sites: how far their lines end from the edge (nominal px), and the chips' distance from it (CSS px). */
const EDGE_INSET = 12;
const PIN_INSET = 8;
/** Smallest distance between chips on the same edge, as a share of that edge. */
const PIN_GAP_SIDE = 0.08;
const PIN_GAP_TOP = 0.16;

/** Transfer geometry: bend of the curves, samples tested against the zone, and bisection steps per crossing. */
const BEND = 0.14;
const SEGMENTS = 64;
const BISECTIONS = 8;

/** Drawing in CSS px. */
const DOT_SPACING = 3.5;
const LINE_DOT = 1.5;
const INSIDE_ALPHA = 0.6;
const OUTSIDE_ALPHA = 0.9;
const DIMMED = 0.3;
const LAND_ALPHA = 0.6;
const ZONE_ALPHA = 0.32;
const OUTLINE_WIDTH = 0.5;
const OUTLINE_ALPHA = 0.35;
/** The zone framing crops the land at the card's edge; the lattice fades out over this many px. */
const EDGE_FADE = 20;

/** Packets: speed in px/s, head and tail squares, the most in flight, and the alpha of packets that stayed inside. */
const PACKET_SPEED = 70;
const HEAD_SIZE = 2;
const TAIL_SIZE = 1.5;
const TAIL_GAP = 2.4;
const TAIL_ALPHA = [1, 0.55, 0.3, 0.13];
const MAX_PACKETS = 160;
const QUIET_PACKET_ALPHA = 0.55;

/** A packet passing a crossing lights the lattice in an uneven ring; one flare per crossing per cooldown. */
const FLARE_SECONDS = 0.6;
const FLARE_RADIUS = 18;
const FLARE_WIDTH = 4;
const FLARE_COOLDOWN = 1.2;
/** A growing line breaking out of the zone: a wider ring and a spray of sparks. */
const BREACH_SECONDS = 0.9;
const BREACH_RADIUS = 30;
const BREACH_WIDTH = 6;
const BREACH_SPARKS = 18;

/** Springs: lines grow critically damped so the front slows into the far site; emphasis snaps with a little overshoot. */
const GROW_SPRING = { stiffness: 42, damping: 1 };
const EMPHASIS_SPRING = { stiffness: 260, damping: 0.8 };
/** When the loop has not caught up with new data after this long, the chip and gates follow the data directly. */
const SETTLE_FALLBACK_MS = 2400;

const ROLE_ORDER: readonly ResidencyRole[] = ["storage", "processing", "backup"];
const ROLE_TITLES: Record<ResidencyRole, string> = { storage: "Storage", processing: "Processing", backup: "Backup" };
const ROLE_SYMBOLS: Record<ResidencyRole, string> = {
  storage: "size-[7px] rounded-[1.5px] bg-current",
  processing: "size-2 rounded-full border-[1.5px] border-current bg-card",
  backup: "size-2 rounded-[1px] border-[1.5px] border-current bg-card",
};

/** Label boxes sit beside the marker centre, on the side placeLabels chose. */
const LABEL_GAP = 12;
const LABEL_HEIGHT = 14;
/** Geist at 11 px advances about 6.2 px per character. */
const LABEL_CHAR_WIDTH = 6.2;
const LABEL_STYLES: Record<LabelPlacement["side"], React.CSSProperties> = {
  right: { left: `calc(50% + ${LABEL_GAP}px)`, top: "50%", transform: "translateY(-50%)" },
  left: { right: `calc(50% + ${LABEL_GAP}px)`, top: "50%", transform: "translateY(-50%)" },
  top: { bottom: `calc(50% + ${LABEL_GAP}px)`, left: "50%", transform: "translateX(-50%)" },
  bottom: { top: `calc(50% + ${LABEL_GAP}px)`, left: "50%", transform: "translateX(-50%)" },
};
const HIDDEN_LABEL: LabelPlacement = { visible: false, x: 0, y: 0, side: "right" };

const MARKER_POP: Keyframe[] = [
  { transform: "scale(.55)" },
  { transform: "scale(1.45)", offset: 0.38 },
  { transform: "scale(1)" },
];
const CHIP_POP: Keyframe[] = [
  { transform: "scale(.8)" },
  { transform: "scale(1.08)", offset: 0.55 },
  { transform: "scale(1)" },
];
const GATE_ENTER: Keyframe[] = [
  { transform: "scale(.3)", opacity: 0 },
  { transform: "scale(1.6)", opacity: 1, offset: 0.4 },
  { transform: "scale(1)", opacity: 1 },
];
const GATE_PULSE: Keyframe[] = [
  { transform: "scale(1)" },
  { transform: "scale(1.6)", offset: 0.35 },
  { transform: "scale(1)" },
];
const GATE_PULSE_TIMING = { duration: 600, easing: "cubic-bezier(.2,.8,.2,1)" };

/** Demo data: the zone Germany, three sites inside it, one in Dublin and one in a us-east region. */
const DEMO_ZONE: ResidencyZone = { label: "Germany", countries: ["DE"] };
const DEMO_SITES: readonly ResidencySite[] = [
  { id: "fra", label: "Frankfurt", lat: 50.1109, lon: 8.6821, role: "storage" },
  { id: "ber", label: "Berlin", lat: 52.52, lon: 13.405, role: "processing" },
  { id: "ham", label: "Hamburg", lat: 53.5511, lon: 9.9937, role: "backup" },
  { id: "dub", label: "Dublin", lat: 53.3498, lon: -6.2603, role: "processing" },
  { id: "us-east", label: "us-east", lat: 39.0438, lon: -77.4874, role: "processing" },
];
const DEMO_TRANSFERS: readonly ResidencyTransfer[] = [
  { id: "fra-ber", from: "fra", to: "ber", volume: 0.7 },
  { id: "fra-ham", from: "fra", to: "ham", volume: 0.35 },
  { id: "ber-dub", from: "ber", to: "dub", volume: 0.5 },
];
const NO_ZONE: ResidencyZone = { label: "" };
const NO_SITES: readonly ResidencySite[] = [];
const NO_TRANSFERS: readonly ResidencyTransfer[] = [];

/* Model ------------------------------------------------------------------------------------------------- */

type PinSide = "left" | "right" | "top" | "bottom";

/** Where a site off the map is pinned. */
interface SitePin {
  side: PinSide;
  /** Position along that edge, 0 to 1 (top to bottom, or left to right). */
  along: number;
  /** Screen direction from the edge toward the site, in radians. */
  angle: number;
}

/** A valid site, placed on the nominal map. */
interface PlacedSite {
  readonly site: ResidencySite;
  /** The site's position with its longitude wrapped to [-180, 180). */
  readonly point: LatLon;
  readonly role: ResidencyRole;
  readonly label: string;
  /** Whether the site lies in the zone (always false without a zone). */
  readonly inside: boolean;
  /** Marker centre as fractions of the map box; for a pinned site, where its lines end. */
  readonly x: number;
  readonly y: number;
  /** Set when the site is off the map. */
  readonly pin: SitePin | null;
}

/** `returns`: both ends are in the zone but the line leaves it on the way. */
type TransferStatus = "stays" | "leaves" | "returns" | "enters" | "outside";

/** Where a transfer crosses the zone's border, in nominal px. */
interface CrossingGeometry {
  readonly key: string;
  /** Position along the line, 0 at the sending site and 1 at the receiving one. */
  readonly u: number;
  readonly x: number;
  readonly y: number;
  /** Direction of travel at the crossing, in radians. */
  readonly angle: number;
  /** `out` where the data leaves the zone, `in` where it enters or comes back. */
  readonly direction: "out" | "in";
}

/** A valid transfer with its line, its parts outside the zone and its border crossings. */
interface TransferGeometry {
  readonly key: string;
  readonly transfer: ResidencyTransfer;
  readonly fromId: string;
  readonly toId: string;
  readonly status: TransferStatus;
  /** Whether any part of the line lies outside the zone. */
  readonly violates: boolean;
  /** "Berlin to Dublin: leaves Germany", for the visually hidden list. */
  readonly description: string;
  /** Packets per second. */
  readonly rate: number;
  /** The line in nominal px (the main curve, then its seam copies), or null when both sites are off the map. */
  readonly tables: readonly ArcLengthTable[] | null;
  /** Ranges along the line (0 to 1) that lie outside the zone. */
  readonly outside: readonly (readonly [number, number])[];
  readonly crossings: readonly CrossingGeometry[];
  /** Whether the data starts outside the zone, so its packets carry the warning colour from the start. */
  readonly startsOutside: boolean;
  /** Changes whenever the drawn line or its crossings change. */
  readonly signature: string;
}

/** The map framing: a projection kind and crop, and a key for caches. */
interface MapView {
  readonly kind: "equirectangular" | "equalEarth";
  readonly latRange: readonly [number, number];
  readonly lonRange: readonly [number, number] | null;
  readonly center: LatLon | null;
  readonly key: string;
}

type ChipTone = "ok" | "warn" | "none";

/** What the status chip says. `key` changes with the text. */
interface ChipState {
  readonly key: string;
  readonly tone: ChipTone;
  /** Transfers that leave the zone. */
  readonly count: number;
  readonly zoneName: string;
}

/** A gate mark: where it sits (fractions of the box), the line's direction, its transfer's sites, and whether to pop. */
interface GateView {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly from: string;
  readonly to: string;
  readonly fresh: boolean;
}

interface GateState {
  readonly key: string;
  readonly list: readonly GateView[];
}

interface ResidencyModel {
  readonly key: string;
  /** Header text: the zone's label, or a placeholder. */
  readonly zoneTitle: string;
  /** The zone in sentences: its label, or "the zone". */
  readonly zoneName: string;
  readonly defined: boolean;
  readonly shape: ZoneShape;
  readonly countries: readonly string[];
  readonly polygon: readonly LatLon[];
  /** Changes with the zone's shape. */
  readonly zoneKey: string;
  readonly view: MapView;
  /** SVG outline of the world framing in nominal px; null for the zone framing, which fills the box. */
  readonly outline: string | null;
  readonly sites: readonly PlacedSite[];
  readonly indexById: ReadonlyMap<string, number>;
  /** Site positions in nominal px for arrow-key navigation (chips where they are pinned). */
  readonly navigation: readonly { x: number; y: number }[];
  readonly transfers: readonly TransferGeometry[];
  readonly violations: readonly ResidencyTransfer[];
  readonly violationKey: string;
  readonly chip: ChipState;
  readonly gates: GateState;
  /** Ids of skipped entries, for the development warning. */
  readonly skipped: string;
}

/** A string that changes exactly when the rendered result can change. */
function modelKey(
  zone: ResidencyZone,
  sites: readonly ResidencySite[],
  transfers: readonly ResidencyTransfer[],
  focus: GeoResidencyFocus,
) {
  const zonePart = [
    zone.label,
    (zone.countries ?? []).join(","),
    (zone.polygon ?? []).map((point) => `${point.lat},${point.lon}`).join(";"),
  ].join("|");
  const sitePart = sites.map((site) => `${site.id}:${site.label}:${site.lat}:${site.lon}:${site.role}`).join("|");
  const transferPart = transfers
    .map((transfer) => `${transfer.id}:${transfer.from}:${transfer.to}:${transfer.volume ?? ""}`)
    .join("|");
  return `${focus}#${zonePart}#${sitePart}#${transferPart}`;
}

/**
 * Validates the data, frames the map, places the sites (pinning those off the map to its edge), and traces every
 * transfer against the zone: 65 samples along the line, each crossing refined by bisection. Pure, so the server
 * renders markers and gates where the client draws the map.
 */
function buildModel(
  zone: ResidencyZone,
  siteList: readonly ResidencySite[],
  transferList: readonly ResidencyTransfer[],
  focus: GeoResidencyFocus,
  key: string,
): ResidencyModel {
  const countries = (zone.countries ?? []).filter((code) => typeof code === "string" && code.length > 0);
  const polygon = (zone.polygon ?? []).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));
  const shape: ZoneShape = { countries, polygon };
  const defined = countries.length > 0 || polygon.length >= 3;
  const zoneLabel = typeof zone.label === "string" ? zone.label.trim() : "";
  const zoneName = zoneLabel || "the zone";
  const zoneKey = `${countries.join(",")}|${polygon.map((point) => `${point.lat},${point.lon}`).join(";")}`;
  const skipped: string[] = [];

  const entries: { site: ResidencySite; point: LatLon }[] = [];
  const indexById = new Map<string, number>();
  for (const site of siteList) {
    const valid = typeof site.id === "string" && !indexById.has(site.id) && isValidLatLon(site);
    if (!valid) {
      skipped.push(`site ${String(site.id)}`);
      continue;
    }
    indexById.set(site.id, entries.length);
    entries.push({ site, point: { lat: site.lat, lon: wrapLongitude(site.lon) } });
  }

  const view = frameView(
    focus,
    defined ? zoneBounds(countries, polygon) : null,
    entries.map((entry) => entry.point),
  );
  const projection = createProjection(view.kind, {
    width: NOMINAL_WIDTH,
    height: NOMINAL_HEIGHT,
    latRange: view.latRange,
    lonRange: view.lonRange ?? undefined,
    center: view.center ?? undefined,
  });
  const sites = placeSites(projection, entries, shape, defined);

  const geometryKey = `${view.key}|${zoneKey}`;
  const transfers: TransferGeometry[] = [];
  const repeats = new Map<string, number>();
  for (const transfer of transferList) {
    const from = indexById.get(transfer.from);
    const to = indexById.get(transfer.to);
    if (typeof transfer.id !== "string" || from === undefined || to === undefined || from === to) {
      skipped.push(`transfer ${String(transfer.id)}`);
      continue;
    }
    const repeat = repeats.get(transfer.id) ?? 0;
    repeats.set(transfer.id, repeat + 1);
    const transferKey = repeat > 0 ? `${transfer.id}#${repeat}` : transfer.id;
    transfers.push(
      traceTransfer(projection, shape, sites[from], sites[to], transfer, transferKey, zoneName, geometryKey),
    );
  }

  const violating = transfers.filter((transfer) => transfer.violates);
  const violationKey = violating
    .map((transfer) => transfer.key)
    .sort()
    .join("\n");
  const count = violating.length;
  const chip: ChipState = !defined
    ? { key: `none|${zoneName}`, tone: "none", count, zoneName }
    : count === 0
      ? { key: `ok|${zoneName}`, tone: "ok", count, zoneName }
      : { key: `warn|${count}|${zoneName}`, tone: "warn", count, zoneName };

  const gateList: GateView[] = [];
  for (const transfer of transfers) {
    for (const crossing of transfer.crossings) gateList.push(gateView(crossing, transfer, false));
  }

  return {
    key,
    zoneTitle: zoneLabel || (defined ? "Unnamed" : "None"),
    zoneName,
    defined,
    shape,
    countries,
    polygon,
    zoneKey,
    view,
    outline: view.kind === "equalEarth" ? projectionOutlineSvgPath(projection) : null,
    sites,
    indexById,
    navigation: sites.map(navigationPoint),
    transfers,
    violations: violating.map((transfer) => transfer.transfer),
    violationKey,
    chip,
    gates: { key: gateStateKey(gateList), list: gateList },
    skipped: skipped.join(", "),
  };
}

/** Lon/lat box of the zone: the union of its countries' boxes and its polygon's; null when it has neither. */
function zoneBounds(countries: readonly string[], polygon: readonly LatLon[]): GeoBounds | null {
  const boxes: GeoBounds[] = [];
  for (const code of countries) {
    const box = countryBounds(code);
    if (box) boxes.push(box);
  }
  if (polygon.length >= 3) boxes.push(boundsOf(polygon, 0, 0));
  return boxes.length > 0 ? unionBounds(boxes) : null;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * The zone framing: an equirectangular crop around the zone (or the sites, without a zone) with an 18 % margin, at
 * least 40° of longitude across, widened to the box's aspect. The world framing: Equal Earth centred on the zone.
 */
function frameView(focus: GeoResidencyFocus, zoneBox: GeoBounds | null, points: readonly LatLon[]): MapView {
  const box = zoneBox ?? (points.length > 0 ? boundsOf(points, 0, 0) : null);
  if (focus === "world" || !box) {
    const centerLon = box ? Math.round(wrapLongitude((box.west + box.east) / 2) * 100) / 100 : 0;
    return {
      kind: "equalEarth",
      latRange: MAP_LAT_RANGE,
      lonRange: null,
      center: { lat: 0, lon: centerLon },
      key: `world|${centerLon}`,
    };
  }
  let west = box.west;
  let east = box.east >= west ? box.east : box.east + 360;
  const lonPad = (east - west) * FRAME_MARGIN;
  const latPad = (box.north - box.south) * FRAME_MARGIN;
  west -= lonPad;
  east += lonPad;
  const south = Math.max(-89, box.south - latPad);
  const north = Math.min(89, box.north + latPad);
  if (east - west < MIN_SPAN) {
    const middle = (west + east) / 2;
    west = middle - MIN_SPAN / 2;
    east = middle + MIN_SPAN / 2;
  }
  if (east - west >= 360) {
    west = -180;
    east = 180;
  }
  const fitted = fitBoundsToAspect({ west, south, east, north }, ASPECT, "equirectangular");
  const latRange: readonly [number, number] = [fitted.south, fitted.north];
  const lonRange: readonly [number, number] = [fitted.west, fitted.east];
  return {
    kind: "equirectangular",
    latRange,
    lonRange,
    center: null,
    key: `zone|${[...latRange, ...lonRange].map(round3).join(",")}`,
  };
}

/** Projects the sites; those off the map are pinned to the edge the ray from the map's centre leaves through. */
function placeSites(
  projection: MapProjection,
  entries: readonly { site: ResidencySite; point: LatLon }[],
  shape: ZoneShape,
  defined: boolean,
): PlacedSite[] {
  const screen = createScreenPoint();
  const drafts = entries.map(({ site, point }) => {
    const onMap = projection.project(point.lat, point.lon, screen);
    const x = screen.x;
    const y = screen.y;
    const inFrame = onMap && x >= -0.5 && x <= NOMINAL_WIDTH + 0.5 && y >= -0.5 && y <= NOMINAL_HEIGHT + 0.5;
    return {
      site,
      point,
      role: ROLE_ORDER.includes(site.role) ? site.role : ("storage" as const),
      label: typeof site.label === "string" && site.label.trim() ? site.label.trim() : site.id,
      inside: defined && zoneContains(shape, point.lat, point.lon),
      x: clamp(x / NOMINAL_WIDTH, 0, 1),
      y: clamp(y / NOMINAL_HEIGHT, 0, 1),
      pin: inFrame ? null : pinToEdge(x, y),
    };
  });
  spreadPins(drafts.flatMap((draft) => (draft.pin ? [draft.pin] : [])));
  return drafts.map((draft) => {
    if (!draft.pin) return draft;
    const anchor = pinAnchor(draft.pin);
    return { ...draft, x: anchor.x / NOMINAL_WIDTH, y: anchor.y / NOMINAL_HEIGHT };
  });
}

/** The edge a site off the map is pinned to: where the ray from the map's centre toward it leaves the map. */
function pinToEdge(x: number, y: number): SitePin {
  const cx = NOMINAL_WIDTH / 2;
  const cy = NOMINAL_HEIGHT / 2;
  let dx = x - cx;
  let dy = y - cy;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
    dx = 0;
    dy = 1;
  }
  const tx = dx > 0 ? (NOMINAL_WIDTH - EDGE_INSET - cx) / dx : dx < 0 ? (EDGE_INSET - cx) / dx : Infinity;
  const ty = dy > 0 ? (NOMINAL_HEIGHT - EDGE_INSET - cy) / dy : dy < 0 ? (EDGE_INSET - cy) / dy : Infinity;
  const angle = Math.atan2(dy, dx);
  if (tx <= ty) return { side: dx > 0 ? "right" : "left", along: clamp((cy + dy * tx) / NOMINAL_HEIGHT, 0, 1), angle };
  return { side: dy > 0 ? "bottom" : "top", along: clamp((cx + dx * ty) / NOMINAL_WIDTH, 0, 1), angle };
}

/** Pushes chips on the same edge apart so they never overlap. */
function spreadPins(pins: SitePin[]) {
  for (const side of ["left", "right", "top", "bottom"] as const) {
    const group = pins.filter((pin) => pin.side === side).sort((a, b) => a.along - b.along);
    if (group.length < 2) continue;
    const gap = side === "left" || side === "right" ? PIN_GAP_SIDE : PIN_GAP_TOP;
    for (let i = 1; i < group.length; i++) group[i].along = Math.max(group[i].along, group[i - 1].along + gap);
    group[group.length - 1].along = Math.min(group[group.length - 1].along, 1);
    for (let i = group.length - 2; i >= 0; i--)
      group[i].along = Math.max(0, Math.min(group[i].along, group[i + 1].along - gap));
  }
}

/** Where a pinned site's lines end, in nominal px: on its edge, just inside the map, under the chip. */
function pinAnchor(pin: SitePin) {
  if (pin.side === "left") return { x: EDGE_INSET, y: pin.along * NOMINAL_HEIGHT };
  if (pin.side === "right") return { x: NOMINAL_WIDTH - EDGE_INSET, y: pin.along * NOMINAL_HEIGHT };
  if (pin.side === "top") return { x: pin.along * NOMINAL_WIDTH, y: EDGE_INSET };
  return { x: pin.along * NOMINAL_WIDTH, y: NOMINAL_HEIGHT - EDGE_INSET };
}

/** A site's position for arrow keys, in nominal px: chips count where they sit, a little inside their edge. */
function navigationPoint(placed: PlacedSite) {
  const pin = placed.pin;
  if (!pin) return { x: placed.x * NOMINAL_WIDTH, y: placed.y * NOMINAL_HEIGHT };
  if (pin.side === "left") return { x: 50, y: pin.along * NOMINAL_HEIGHT };
  if (pin.side === "right") return { x: NOMINAL_WIDTH - 50, y: pin.along * NOMINAL_HEIGHT };
  if (pin.side === "top") return { x: pin.along * NOMINAL_WIDTH, y: 25 };
  return { x: pin.along * NOMINAL_WIDTH, y: NOMINAL_HEIGHT - 25 };
}

/** Whether the zone contains the point under a nominal screen position; off the projected map counts as outside. */
function insideAt(projection: MapProjection, shape: ZoneShape, x: number, y: number) {
  const point = projection.invert(x, y);
  return point ? zoneContains(shape, point.lat, point.lon) : false;
}

/**
 * Draws a transfer's line and traces it against the zone. The line runs between the two markers (or to a pinned
 * chip); both ends take their site's membership, the samples between are tested on the map, and every change between
 * two samples is bisected to the crossing. A line between two sites outside the zone is outside as a whole.
 */
function traceTransfer(
  projection: MapProjection,
  shape: ZoneShape,
  from: PlacedSite,
  to: PlacedSite,
  transfer: ResidencyTransfer,
  key: string,
  zoneName: string,
  geometryKey: string,
): TransferGeometry {
  const fromInside = from.inside;
  const toInside = to.inside;
  let tables: ArcLengthTable[] | null = null;
  if (!from.pin && !to.pin) {
    tables = flatPaths(projection, from.point, to.point, { bend: BEND, segments: SEGMENTS });
  } else if (!(from.pin && to.pin)) {
    const curve = flatCurve(
      from.x * NOMINAL_WIDTH,
      from.y * NOMINAL_HEIGHT,
      to.x * NOMINAL_WIDTH,
      to.y * NOMINAL_HEIGHT,
      BEND,
    );
    tables = [quadArcLength(curve, SEGMENTS)];
  }

  const outside: (readonly [number, number])[] = [];
  const crossings: CrossingGeometry[] = [];
  if (!fromInside && !toInside) {
    outside.push([0, 1]);
  } else if (tables) {
    const main = tables[0];
    const count = main.count;
    const samples = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      if (i === 0) samples[i] = fromInside ? 1 : 0;
      else if (i === count - 1) samples[i] = toInside ? 1 : 0;
      else samples[i] = sampleInside(projection, shape, tables, i) ? 1 : 0;
    }
    let start: number | null = fromInside ? null : 0;
    for (let i = 0; i + 1 < count; i++) {
      if (samples[i] === samples[i + 1]) continue;
      const crossing = bisectCrossing(projection, shape, main, i, samples[i] === 1, `${key}:${crossings.length}`);
      crossings.push(crossing);
      if (crossing.direction === "out") start = crossing.u;
      else {
        outside.push([start ?? 0, crossing.u]);
        start = null;
      }
    }
    if (start !== null) outside.push([start, 1]);
  } else if (!(fromInside && toInside)) {
    outside.push([0, 1]);
  }

  const violates = outside.length > 0;
  const status: TransferStatus = fromInside
    ? toInside
      ? violates
        ? "returns"
        : "stays"
      : "leaves"
    : toInside
      ? "enters"
      : "outside";
  const volume = Number.isFinite(transfer.volume) ? clamp(transfer.volume ?? 0.5, 0, 1) : 0.5;
  const ends = [from, to].map((site) => `${site.x.toFixed(5)},${site.y.toFixed(5)}`).join(">");
  return {
    key,
    transfer,
    fromId: from.site.id,
    toId: to.site.id,
    status,
    violates,
    description: `${from.label} to ${to.label}: ${statusText(status, zoneName)}`,
    rate: 0.4 + 1.6 * volume,
    tables,
    outside,
    crossings,
    startsOutside: !fromInside,
    signature: `${geometryKey}|${ends}|${fromInside ? 1 : 0}${toInside ? 1 : 0}`,
  };
}

/** Whether a line sample lies in the zone; past the seam the main curve leaves the map, so its copies are asked. */
function sampleInside(projection: MapProjection, shape: ZoneShape, tables: readonly ArcLengthTable[], index: number) {
  for (const table of tables) {
    if (index >= table.count) continue;
    const point = projection.invert(table.xs[index], table.ys[index]);
    if (point) return zoneContains(shape, point.lat, point.lon);
  }
  return false;
}

/** Bisects the segment between samples `index` and `index + 1` to where it crosses the zone's border. */
function bisectCrossing(
  projection: MapProjection,
  shape: ZoneShape,
  table: ArcLengthTable,
  index: number,
  startInside: boolean,
  key: string,
): CrossingGeometry {
  const x0 = table.xs[index];
  const y0 = table.ys[index];
  const x1 = table.xs[index + 1];
  const y1 = table.ys[index + 1];
  let low = 0;
  let high = 1;
  for (let k = 0; k < BISECTIONS; k++) {
    const middle = (low + high) / 2;
    if (insideAt(projection, shape, x0 + (x1 - x0) * middle, y0 + (y1 - y0) * middle) === startInside) low = middle;
    else high = middle;
  }
  const f = (low + high) / 2;
  const distance = table.distances[index] + (table.distances[index + 1] - table.distances[index]) * f;
  return {
    key,
    u: table.length > 0 ? distance / table.length : 0,
    x: x0 + (x1 - x0) * f,
    y: y0 + (y1 - y0) * f,
    angle: Math.atan2(y1 - y0, x1 - x0),
    direction: startInside ? "out" : "in",
  };
}

function statusText(status: TransferStatus, zoneName: string) {
  switch (status) {
    case "stays":
      return `stays in ${zoneName}`;
    case "leaves":
      return `leaves ${zoneName}`;
    case "returns":
      return `leaves ${zoneName} on the way`;
    case "enters":
      return `enters ${zoneName}`;
    default:
      return `outside ${zoneName}`;
  }
}

function siteName(placed: PlacedSite, zoneName: string) {
  const where = placed.inside ? `in ${zoneName}` : `outside ${zoneName}`;
  return `${placed.label}, ${placed.role}, ${where}${placed.pin ? ", off the map" : ""}`;
}

function gateView(crossing: CrossingGeometry, transfer: TransferGeometry, fresh: boolean): GateView {
  return {
    key: crossing.key,
    x: crossing.x / NOMINAL_WIDTH,
    y: crossing.y / NOMINAL_HEIGHT,
    angle: crossing.angle,
    from: transfer.fromId,
    to: transfer.toId,
    fresh,
  };
}

const gateStateKey = (list: readonly GateView[]) =>
  list.map((gate) => `${gate.key}@${gate.x.toFixed(4)},${gate.y.toFixed(4)}`).join("|");

/** The selected site and every site it exchanges data with. */
function relatedSites(model: ResidencyModel, selectedIndex: number) {
  const related = new Set<number>();
  if (selectedIndex < 0) return related;
  const id = model.sites[selectedIndex].site.id;
  related.add(selectedIndex);
  for (const transfer of model.transfers) {
    if (transfer.fromId === id) related.add(model.indexById.get(transfer.toId) ?? -1);
    if (transfer.toId === id) related.add(model.indexById.get(transfer.fromId) ?? -1);
  }
  return related;
}

/** Keeps a pinned chip inside the box: it slides along its edge in proportion, so its ends never leave the map. */
function pinStyle(pin: SitePin): React.CSSProperties {
  const offset = `calc(${PIN_INSET}px + (100% - ${PIN_INSET * 2}px) * ${pin.along.toFixed(4)})`;
  const shift = `${(-pin.along * 100).toFixed(2)}%`;
  if (pin.side === "left") return { left: PIN_INSET, top: offset, transform: `translateY(${shift})` };
  if (pin.side === "right") return { right: PIN_INSET, top: offset, transform: `translateY(${shift})` };
  if (pin.side === "top") return { top: PIN_INSET, left: offset, transform: `translateX(${shift})` };
  return { bottom: PIN_INSET, left: offset, transform: `translateX(${shift})` };
}

/**
 * Which site names show, and on which side: the selected site first, then the sites in the zone, then the rest.
 * Gate marks are obstacles, so a name never covers a border crossing.
 */
function placeSiteLabels(model: ResidencyModel, boxWidth: number, selectedIndex: number): LabelPlacement[] {
  const width = boxWidth;
  const height = boxWidth / ASPECT;
  const anchors: LabelAnchor[] = model.sites.map((placed, i) =>
    placed.pin
      ? { x: -1000, y: -1000, width: 0.01, height: 0.01, priority: -1 }
      : {
          x: placed.x * width,
          y: placed.y * height,
          width: placed.label.length * LABEL_CHAR_WIDTH + 2,
          height: LABEL_HEIGHT,
          priority: i === selectedIndex ? Number.MAX_SAFE_INTEGER : placed.inside ? 2 : 1,
          gap: LABEL_GAP,
        },
  );
  for (const gate of model.gates.list) {
    anchors.push({ x: gate.x * width, y: gate.y * height, width: 0.01, height: 0.01, priority: -2 });
  }
  const placements = placeLabels(anchors, width, height);
  return model.sites.map((site, i) => {
    if (site.pin) return HIDDEN_LABEL;
    const placement = placements[i];
    // the selected name always shows, on the right when nothing fits
    if (i === selectedIndex && !placement.visible) return { ...placement, visible: true, side: "right" as const };
    return placement;
  });
}

/* Engine ------------------------------------------------------------------------------------------------ */

/** A border crossing on the live map. */
interface LiveCrossing {
  readonly geometry: CrossingGeometry;
  /** Distance along the main line in px, and the position in px. */
  s: number;
  x: number;
  y: number;
  /** Whether the line has grown past it (its gate mark shows). */
  shown: boolean;
  /** Shown by a growing line, so the gate mark pops in. */
  fresh: boolean;
  /** Time of its last flare in seconds. */
  lastFlare: number;
}

/** One transfer on the live map, with everything the loop animates. */
interface LivePath {
  readonly key: string;
  geometry: TransferGeometry;
  /** The line scaled to the canvas: the main curve, then its seam copies. Null until laid out. */
  tables: ArcLengthTable[] | null;
  /** Length of the main curve in px. */
  length: number;
  crossings: LiveCrossing[];
  /** Grows the line out of its origin and retracts it into it. */
  presence: Spring;
  /** 1, or 0.3 while another site's transfers are selected. */
  emphasis: Spring;
  removed: boolean;
  dead: boolean;
  /** Whether packets were scattered along it; lines that grow in fill with packets as they arrive. */
  prespawned: boolean;
  /** Poisson spawning: accumulated rate · dt against an exponential draw. */
  accumulator: number;
  nextSpawn: number;
  seed: number;
}

interface Packet {
  path: LivePath;
  /** Distance along the main line in px. */
  s: number;
  /** Whether it has been outside the zone: it then carries the warning colour for the rest of its way. */
  tainted: boolean;
}

interface Flare {
  x: number;
  y: number;
  start: number;
  path: LivePath;
  /** The one-off flare when a growing line breaks out of the zone. */
  breach: boolean;
}

interface Batches {
  /** Lattice dots: the zone's accent toward the warning colour of a flare. */
  lattice: DotBatch;
  /** Line dots: quiet ink inside the zone, warning outside. */
  line: DotBatch;
  /** Packets: the text colour, warning once tainted. */
  packet: DotBatch;
}

interface EngineCallbacks {
  onGates(state: GateState): void;
  onSettle(chip: ChipState): void;
  pulseGate(key: string): void;
}

/** Everything the animation loop owns. Lives in a ref, never in React state. */
interface ResidencyEngine {
  model: ResidencyModel | null;
  paths: Map<string, LivePath>;
  packets: Packet[];
  flares: Flare[];
  sparks: Sparks;
  selected: string | null;
  selectionReady: boolean;
  inView: boolean;
  callbacks: EngineCallbacks | null;
  layoutKey: string;
  projection: MapProjection | null;
  lattice: DotLattice | null;
  /** 1 per lattice dot in the zone, or null without a zone. */
  inZone: Uint8Array | null;
  /** Indices of the lattice dots in the zone, which twinkle. */
  zoneDots: Uint32Array;
  /** Nominal px to canvas px. */
  scaleX: number;
  scaleY: number;
  ink: GeoInk | null;
  batches: Batches | null;
  sparkColors: RGB[];
  inkStale: boolean;
  baked: boolean;
  gatesStale: boolean;
  /** The gate list and chip last handed to React. */
  gateKey: string;
  settledKey: string;
  /** The model key of the last frame, so the fallback timer knows the loop has caught up. */
  steppedKey: string;
  /**
   * Where the map's top-left corner sits on the effects canvas, in CSS px. The canvas reaches 32 px past the card above
   * and below, and to the sides from 560 px of width (16 px below that, so a phone page does not scroll sideways).
   */
  fxX: number;
  fxY: number;
  fxDirty: boolean;
}

function createEngine(): ResidencyEngine {
  return {
    model: null,
    paths: new Map(),
    packets: [],
    flares: [],
    sparks: new Sparks(),
    selected: null,
    selectionReady: false,
    inView: false,
    callbacks: null,
    layoutKey: "",
    projection: null,
    lattice: null,
    inZone: null,
    zoneDots: new Uint32Array(0),
    scaleX: 1,
    scaleY: 1,
    ink: null,
    batches: null,
    sparkColors: [],
    inkStale: true,
    baked: false,
    gatesStale: true,
    gateKey: "",
    settledKey: "",
    steppedKey: "",
    fxX: 0,
    fxY: 0,
    fxDirty: false,
  };
}

const spring = (position: number): Spring => ({ position, velocity: 0 });

/** An exponential draw with mean 1: the gap to the next arrival of a Poisson process, in units of rate · time. */
const exponential = () => -Math.log(1 - Math.random());

const emphasisFor = (geometry: TransferGeometry, selected: string | null) =>
  selected === null || geometry.fromId === selected || geometry.toId === selected ? 1 : DIMMED;

/** The growth a line needs before a crossing at `u` counts as reached: the front's average there. */
const revealThreshold = (u: number) => Math.min(0.995, u * 0.82 + 0.09);

const liveCrossing = (geometry: CrossingGeometry, shown: boolean): LiveCrossing => ({
  geometry,
  s: 0,
  x: 0,
  y: 0,
  shown,
  fresh: false,
  lastFlare: -Infinity,
});

function createPath(geometry: TransferGeometry, presence: number, emphasis: number): LivePath {
  return {
    key: geometry.key,
    geometry,
    tables: null,
    length: 0,
    crossings: geometry.crossings.map((crossing) => liveCrossing(crossing, presence >= 1)),
    presence: spring(presence),
    emphasis: spring(emphasis),
    removed: false,
    dead: false,
    prespawned: presence < 1,
    accumulator: 0,
    nextSpawn: exponential(),
    seed: (stringHash(geometry.key) % 9973) + 0.5,
  };
}

/**
 * Brings the live paths in line with the model. The first sync shows everything at once; later ones grow new lines
 * and retract removed ones when `animate`, else they apply at once. A new framing or zone relays the map out.
 */
function syncEngine(engine: ResidencyEngine, model: ResidencyModel, animate: boolean) {
  const previous = engine.model;
  const initial = previous === null;
  engine.model = model;
  if (initial) {
    engine.gateKey = model.gates.key;
    engine.settledKey = model.chip.key;
  }
  if (!previous || previous.view.key !== model.view.key || previous.zoneKey !== model.zoneKey) engine.layoutKey = "";
  const grow = animate && !initial;
  const keep = new Set<string>();
  for (const geometry of model.transfers) {
    if (!geometry.tables) continue;
    keep.add(geometry.key);
    const existing = engine.paths.get(geometry.key);
    if (existing && !existing.dead) {
      existing.removed = false;
      if (existing.geometry.signature !== geometry.signature) {
        existing.tables = null;
        existing.crossings = geometry.crossings.map((crossing) => liveCrossing(crossing, true));
        existing.prespawned = false;
        engine.packets = engine.packets.filter((packet) => packet.path !== existing);
      }
      existing.geometry = geometry;
      if (!grow) existing.presence = spring(1);
      continue;
    }
    engine.paths.set(geometry.key, createPath(geometry, grow ? 0 : 1, emphasisFor(geometry, engine.selected)));
  }
  for (const path of engine.paths.values()) {
    if (keep.has(path.key)) continue;
    path.removed = true;
    if (!grow) path.presence = spring(0);
  }
  engine.gatesStale = true;
}

/** New ink after a theme change: ramps for the batches, spark colours and a rebake of the static layer. */
function refreshInk(engine: ResidencyEngine, palette: GeoPalette) {
  const ink = geoInk(palette);
  const latticeStops = [ink.accent, ink.warning];
  const lineStops = [ink.landStrong, ink.warning];
  const packetStops = [ink.foreground, ink.warning];
  if (engine.batches) {
    engine.batches.lattice.setRamp(latticeStops);
    engine.batches.line.setRamp(lineStops);
    engine.batches.packet.setRamp(packetStops);
  } else {
    engine.batches = {
      lattice: createDotBatch(2048, latticeStops, { tones: 8, levels: 64 }),
      line: createDotBatch(2048, lineStops, { tones: 2, levels: 32 }),
      packet: createDotBatch(512, packetStops, { tones: 2, levels: 32 }),
    };
  }
  engine.sparkColors = [ink.warning, mixRgb(ink.warning, ink.foreground, 0.3)];
  engine.ink = ink;
  engine.inkStale = false;
  engine.baked = false;
}

/** A new canvas size, framing or zone: a projection at the real size, its lattice and the zone's dots. */
function layoutEngine(engine: ResidencyEngine, model: ResidencyModel, width: number, height: number, key: string) {
  const view = model.view;
  const projection = createProjection(view.kind, {
    width,
    height,
    latRange: view.latRange,
    lonRange: view.lonRange ?? undefined,
    center: view.center ?? undefined,
  });
  const lattice = mapLattice(projection, { pitch: width < NARROW_WIDTH ? 3 : 4 });
  const inZone = model.defined ? zoneMembership(lattice, model.shape) : null;
  let count = 0;
  if (inZone) for (let i = 0; i < inZone.length; i++) count += inZone[i];
  const zoneDots = new Uint32Array(count);
  if (inZone) {
    let k = 0;
    for (let i = 0; i < inZone.length; i++) if (inZone[i] === 1) zoneDots[k++] = i;
  }
  engine.projection = projection;
  engine.lattice = lattice;
  engine.inZone = inZone;
  engine.zoneDots = zoneDots;
  // the model's nominal box has the same aspect, so the map scales uniformly from it
  engine.scaleX = width / NOMINAL_WIDTH;
  engine.scaleY = height / NOMINAL_HEIGHT;
  engine.layoutKey = key;
  engine.baked = false;
  engine.flares.length = 0;
  for (const path of engine.paths.values()) path.tables = null;
}

const latticeDotSize = (lattice: DotLattice) => (lattice.pitch >= 4 ? 1.6 : 1.3);

/**
 * The static layer: land outside the zone in the quiet land ink, the zone's outline as a 0.5 px accent hairline, and
 * a fade where the zone framing cuts the land at the card's edge. The zone's own dots twinkle on the live layer.
 */
function bakeBase(
  surface: CanvasSurface,
  engine: ResidencyEngine,
  model: ResidencyModel,
  lattice: DotLattice,
  projection: MapProjection,
  ink: GeoInk,
) {
  const { context, width, height } = surface;
  context.clearRect(0, 0, width, height);
  const size = latticeDotSize(lattice);
  const half = size / 2;
  const inZone = engine.inZone;
  context.globalAlpha = LAND_ALPHA;
  context.fillStyle = rgba(ink.land);
  for (let i = 0; i < lattice.count; i++) {
    if (inZone && inZone[i] === 1) continue;
    context.fillRect(lattice.x[i] - half, lattice.y[i] - half, size, size);
  }
  context.globalAlpha = 1;
  if (model.defined) {
    context.lineWidth = OUTLINE_WIDTH;
    context.lineJoin = "round";
    context.strokeStyle = rgba(ink.accent, OUTLINE_ALPHA);
    for (const code of model.countries) context.stroke(countryOutline(code, projection).path);
    if (model.polygon.length >= 3) {
      const outline = new Path2D();
      traceMapLine(outline, projection, toLonLat(model.polygon), true);
      context.stroke(outline);
    }
  }
  if (model.view.kind === "equirectangular") fadeEdges(context, width, height);
}

/** Erases the layer toward each edge of the box, so the cropped land fades out instead of ending at the border. */
function fadeEdges(context: CanvasRenderingContext2D, width: number, height: number) {
  context.save();
  context.globalCompositeOperation = "destination-out";
  const erase = (x0: number, y0: number, x1: number, y1: number) => {
    const gradient = context.createLinearGradient(x0, y0, x1, y1);
    gradient.addColorStop(0, "rgba(0,0,0,1)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = gradient;
    context.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) || width, Math.abs(y1 - y0) || height);
  };
  erase(0, 0, EDGE_FADE, 0);
  erase(width, 0, width - EDGE_FADE, 0);
  erase(0, 0, 0, EDGE_FADE);
  erase(0, height, 0, height - EDGE_FADE);
  context.restore();
}

function scaleTable(table: ArcLengthTable, scaleX: number, scaleY: number) {
  const xs = new Float32Array(table.count);
  const ys = new Float32Array(table.count);
  for (let i = 0; i < table.count; i++) {
    xs[i] = table.xs[i] * scaleX;
    ys[i] = table.ys[i] * scaleY;
  }
  return buildArcLength(xs, ys, table.count);
}

/** Scales a path's line and crossings to the canvas; packets keep their share of the way. */
function buildPathTables(engine: ResidencyEngine, path: LivePath) {
  const tables = path.geometry.tables;
  if (!tables) return;
  const previousLength = path.length;
  path.tables = tables.map((table) => scaleTable(table, engine.scaleX, engine.scaleY));
  path.length = path.tables[0]?.length ?? 0;
  for (const crossing of path.crossings) {
    crossing.s = crossing.geometry.u * path.length;
    crossing.x = crossing.geometry.x * engine.scaleX;
    crossing.y = crossing.geometry.y * engine.scaleY;
  }
  if (previousLength > 0 && path.length > 0) {
    const ratio = path.length / previousLength;
    for (const packet of engine.packets) if (packet.path === path) packet.s *= ratio;
  }
}

/**
 * Steps every spring. A crossing the growing front reaches shows its gate mark; a crossing where data leaves the zone
 * breaks out with a wide flare and sparks. Returns whether anything moved.
 */
function advancePaths(engine: ResidencyEngine, delta: number, reduced: boolean, time: number) {
  let moving = false;
  for (const path of engine.paths.values()) {
    moving =
      settleSpring(path.emphasis, emphasisFor(path.geometry, engine.selected), delta, reduced, EMPHASIS_SPRING) ||
      moving;
    moving = settleSpring(path.presence, path.removed ? 0 : 1, delta, reduced, GROW_SPRING) || moving;
    const presence = clamp(path.presence.position, 0, 1);
    for (const crossing of path.crossings) {
      const shown = presence >= revealThreshold(crossing.geometry.u);
      if (shown === crossing.shown) continue;
      crossing.shown = shown;
      crossing.fresh = shown && !reduced;
      engine.gatesStale = true;
      if (shown && !reduced && path.tables && crossing.geometry.direction === "out")
        breach(engine, path, crossing, time);
    }
  }
  return moving;
}

/** The moment a growing line breaks out of the zone: a wide flare on the lattice and sparks along the line. */
function breach(engine: ResidencyEngine, path: LivePath, crossing: LiveCrossing, time: number) {
  crossing.lastFlare = time;
  engine.flares.push({ x: crossing.x, y: crossing.y, start: time, path, breach: true });
  engine.sparks.add(crossing.x + engine.fxX, crossing.y + engine.fxY, BREACH_SPARKS, engine.sparkColors, {
    angle: crossing.geometry.angle,
    spread: 2.6,
    speed: [50, 210],
    life: [0.35, 0.85],
    size: [1.5, 2.5],
    drag: 3.2,
    jitter: 1.5,
  });
}

/** A packet passed a crossing: flare the lattice there and pulse its gate mark, at most once per cooldown. */
function flareAt(engine: ResidencyEngine, path: LivePath, crossing: LiveCrossing, time: number) {
  if (time - crossing.lastFlare < FLARE_COOLDOWN) return;
  crossing.lastFlare = time;
  engine.flares.push({ x: crossing.x, y: crossing.y, start: time, path, breach: false });
  engine.callbacks?.pulseGate(crossing.geometry.key);
}

/** Whether a packet at `s` has already been outside the zone. */
const taintedAt = (path: LivePath, s: number) =>
  path.geometry.startsOutside || path.crossings.some((crossing) => crossing.s <= s);

function spawnPackets(engine: ResidencyEngine, delta: number) {
  for (const path of engine.paths.values()) {
    if (path.removed || !path.tables || path.length <= 0 || path.presence.position < 0.999) continue;
    const rate = path.geometry.rate;
    if (!path.prespawned) {
      // the map never starts empty: scatter as many packets as the line holds on average
      const count = Math.floor((rate * path.length) / PACKET_SPEED + Math.random());
      for (let i = 0; i < count; i++) {
        const s = Math.random() * path.length;
        engine.packets.push({ path, s, tainted: taintedAt(path, s) });
      }
      path.prespawned = true;
    }
    path.accumulator += rate * delta;
    while (path.accumulator >= path.nextSpawn) {
      path.accumulator -= path.nextSpawn;
      path.nextSpawn = exponential();
      // start a little along the line, by how long ago within this frame the arrival fell
      const s = Math.min(path.length, (path.accumulator / rate) * PACKET_SPEED);
      engine.packets.push({ path, s, tainted: taintedAt(path, s) });
    }
  }
  if (engine.packets.length > MAX_PACKETS) engine.packets.splice(0, engine.packets.length - MAX_PACKETS);
}

/** Moves packets at a constant speed. Passing a crossing taints a packet for the rest of its way and flares there. */
function movePackets(engine: ResidencyEngine, delta: number, time: number) {
  const packets = engine.packets;
  let alive = 0;
  for (let i = 0; i < packets.length; i++) {
    const packet = packets[i];
    const path = packet.path;
    if (path.dead || path.removed) continue;
    const previous = packet.s;
    packet.s += PACKET_SPEED * delta;
    for (const crossing of path.crossings) {
      if (previous < crossing.s && packet.s >= crossing.s) {
        packet.tainted = true;
        flareAt(engine, path, crossing, time);
      }
    }
    if (packet.s >= path.length) continue;
    packets[alive++] = packet;
  }
  packets.length = alive;
}

function isOutside(ranges: readonly (readonly [number, number])[], u: number) {
  for (const range of ranges) if (u >= range[0] && u <= range[1]) return true;
  return false;
}

/** The live layer: the zone's twinkling dots and the flares, then the lines, then the packets. */
function drawLive(
  engine: ResidencyEngine,
  surface: CanvasSurface,
  lattice: DotLattice,
  projection: MapProjection,
  batches: Batches,
  time: number,
  reduced: boolean,
) {
  const { context, width, height, dpr } = surface;
  context.clearRect(0, 0, width, height);
  const size = latticeDotSize(lattice);
  const zoneDots = engine.zoneDots;
  for (let k = 0; k < zoneDots.length; k++) {
    const i = zoneDots[k];
    // a slow twinkle at 0.6 to 1.4 rad/s, from the lattice's seeded speed and phase
    const twinkle = reduced ? 1 : 0.8 + 0.2 * Math.sin(time * (0.6 + (lattice.speed[i] - 2) * 0.16) + lattice.phase[i]);
    batches.lattice.add(lattice.x[i], lattice.y[i], size, 0, ZONE_ALPHA * twinkle);
  }
  drawFlares(engine, batches.lattice, lattice, projection, size, time);
  batches.lattice.flush(context);

  for (const path of engine.paths.values()) drawPath(path, batches.line, dpr);
  batches.line.flush(context);

  drawPackets(engine, batches.packet, width, height, dpr);
  batches.packet.flush(context);
}

/**
 * Flares light the lattice's grid around a crossing in an uneven ring that spreads and fades, on land and water
 * alike, so a crossing on the coast flares too.
 */
function drawFlares(
  engine: ResidencyEngine,
  batch: DotBatch,
  lattice: DotLattice,
  projection: MapProjection,
  size: number,
  time: number,
) {
  const pitch = lattice.pitch;
  const { x0, y0 } = projection.frame;
  let alive = 0;
  for (const flare of engine.flares) {
    const duration = flare.breach ? BREACH_SECONDS : FLARE_SECONDS;
    const t = (time - flare.start) / duration;
    if (t >= 1 || flare.path.dead) continue;
    engine.flares[alive++] = flare;
    const progress = clamp(t, 0, 1);
    const radius = (flare.breach ? BREACH_RADIUS : FLARE_RADIUS) * progress;
    const ring = flare.breach ? BREACH_WIDTH : FLARE_WIDTH;
    const reach = radius + ring * 2 + 3;
    const strength = (1 - progress) * (1 - progress) * clamp(flare.path.emphasis.position, 0, 1);
    const firstColumn = Math.floor((flare.x - reach - x0) / pitch);
    const lastColumn = Math.ceil((flare.x + reach - x0) / pitch);
    const firstRow = Math.floor((flare.y - reach - y0) / pitch);
    const lastRow = Math.ceil((flare.y + reach - y0) / pitch);
    for (let row = firstRow; row <= lastRow; row++) {
      const y = y0 + (row + 0.5) * pitch;
      for (let column = firstColumn; column <= lastColumn; column++) {
        const x = x0 + (column + 0.5) * pitch;
        const distance = Math.hypot(x - flare.x, y - flare.y);
        if (distance > reach) continue;
        const front = ringFront(distance, radius, ring, hash(column * 31 + row * 7 + 0.5), 3);
        const alpha = front * strength;
        if (alpha >= 0.03) batch.add(x, y, size, 1, alpha);
      }
    }
  }
  engine.flares.length = alive;
}

/**
 * A transfer as a row of dots every 3.5 px: quiet ink inside the zone, a dashed warning line (two dots on, two off)
 * outside it. A growing line reveals from its origin behind an uneven front.
 */
function drawPath(path: LivePath, batch: DotBatch, dpr: number) {
  const tables = path.tables;
  const presence = clamp(path.presence.position, 0, 1);
  if (!tables || presence <= 0.002) return;
  const emphasis = clamp(path.emphasis.position, 0, 1);
  const outside = path.geometry.outside;
  const growing = presence < 0.999;
  const seed = path.seed;
  for (const table of tables) {
    const length = table.length;
    if (length <= 0) continue;
    forEachDot(table, DOT_SPACING, 0, length, (x, y, s) => {
      const u = s / length;
      const index = Math.round(s / DOT_SPACING);
      let appear = 1;
      if (growing) {
        appear = clamp((presence - (u * 0.82 + hash(seed + index * 7.31) * 0.18)) / 0.06, 0, 1);
        if (appear <= 0) return;
      }
      const away = isOutside(outside, u);
      if (away && index % 4 >= 2) return;
      const alpha = (away ? OUTSIDE_ALPHA : INSIDE_ALPHA) * emphasis * appear;
      // squares start on the device pixel grid: lines read as crisp pixel rows, like the lattice, not a smear
      batch.add(snapCenter(x, LINE_DOT, dpr), snapCenter(y, LINE_DOT, dpr), LINE_DOT, away ? 1 : 0, alpha);
    });
  }
}

const packetPoint = { x: 0, y: 0, angle: 0 };

/** Packets: a 2 px head with a fading tail, in the text colour, or the warning colour once they have been outside. */
function drawPackets(engine: ResidencyEngine, batch: DotBatch, width: number, height: number, dpr: number) {
  for (const packet of engine.packets) {
    const path = packet.path;
    const tables = path.tables;
    if (!tables || path.length <= 0) continue;
    const emphasis = clamp(path.emphasis.position, 0, 1);
    const tone = packet.tainted ? 1 : 0;
    const alpha = (packet.tainted ? 1 : QUIET_PACKET_ALPHA) * emphasis;
    const progress = packet.s / path.length;
    for (const table of tables) {
      const s = progress * table.length;
      for (let k = 0; k < TAIL_ALPHA.length; k++) {
        const along = s - k * TAIL_GAP;
        if (along < 0) break;
        pointAtDistance(table, along, packetPoint);
        if (packetPoint.x < -4 || packetPoint.y < -4 || packetPoint.x > width + 4 || packetPoint.y > height + 4)
          continue;
        const dot = k === 0 ? HEAD_SIZE : TAIL_SIZE;
        batch.add(
          snapCenter(packetPoint.x, dot, dpr),
          snapCenter(packetPoint.y, dot, dpr),
          dot,
          tone,
          alpha * TAIL_ALPHA[k],
        );
      }
    }
  }
}

/** Breach sparks, on the canvas that reaches past the card. Returns whether any are alive. */
function drawSparks(engine: ResidencyEngine, surface: CanvasSurface, delta: number) {
  const { context, width, height } = surface;
  if (!engine.sparks.active) {
    if (engine.fxDirty) {
      context.clearRect(0, 0, width, height);
      engine.fxDirty = false;
    }
    return false;
  }
  engine.fxDirty = true;
  context.clearRect(0, 0, width, height);
  return engine.sparks.step(context, delta);
}

/** Forgets removed paths once they have retracted, with their packets and flares. */
function prunePaths(engine: ResidencyEngine) {
  let pruned = false;
  for (const path of engine.paths.values()) {
    if (!path.removed || path.presence.position > 0.002) continue;
    path.dead = true;
    engine.paths.delete(path.key);
    pruned = true;
  }
  if (!pruned) return;
  engine.packets = engine.packets.filter((packet) => !packet.path.dead);
  engine.flares = engine.flares.filter((flare) => !flare.path.dead);
  engine.gatesStale = true;
}

/**
 * Hands React the gate marks that show, and lets the chip change once the map shows the change: every transfer that
 * leaves the zone has grown past its first part outside, and every removed one has retracted from it.
 */
function report(engine: ResidencyEngine, model: ResidencyModel) {
  const callbacks = engine.callbacks;
  if (!callbacks) return;
  if (engine.gatesStale) {
    engine.gatesStale = false;
    const list: GateView[] = [];
    for (const path of engine.paths.values()) {
      for (const crossing of path.crossings) {
        if (crossing.shown) list.push(gateView(crossing.geometry, path.geometry, crossing.fresh));
      }
    }
    const key = gateStateKey(list);
    if (key !== engine.gateKey) {
      engine.gateKey = key;
      callbacks.onGates({ key, list });
    }
  }
  if (engine.settledKey !== model.chip.key && pathsSettled(engine)) {
    engine.settledKey = model.chip.key;
    callbacks.onSettle(model.chip);
  }
}

function pathsSettled(engine: ResidencyEngine) {
  for (const path of engine.paths.values()) {
    const geometry = path.geometry;
    if (!geometry.violates) continue;
    const firstOutside = geometry.outside[0]?.[0] ?? 0;
    const shown = clamp(path.presence.position, 0, 1) >= revealThreshold(firstOutside);
    if (shown === path.removed) return false;
  }
  return true;
}
