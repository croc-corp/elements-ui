"use client";

import * as React from "react";

import { snap, useCanvas, type CanvasSurface } from "@/lib/lumesec/canvas";
import { usePalette } from "@/lib/lumesec/color";
import {
  bakeLattice,
  createDotBatch,
  createProjection,
  createScreenPoint,
  DEG,
  destinationPoint,
  GEO_TOKENS,
  geoInk,
  MAP_LAT_RANGE,
  mapLattice,
  projectionAspect,
  ringFront,
  wrapLongitude,
  type DotBatch,
  type DotLattice,
  type GeoInk,
  type MapProjection,
} from "@/lib/lumesec/geo";
import { getCountry } from "@/lib/lumesec/geo-countries";
import {
  createRandom,
  DEMO_CITIES,
  formatCoordinate,
  formatDistance,
  ipScope,
  parseIpAddress,
  type IpAddress,
  type IpScope,
} from "@/lib/lumesec/geo-data";
import { clamp, easeOutCubic, hash, lerp, rgba, smoothstep, TAU } from "@/lib/lumesec/math";
import {
  prefersReducedMotion,
  shake,
  springStep,
  useAnimationLoop,
  useLazyRef,
  type Spring,
} from "@/lib/lumesec/motion";
import { RollText } from "@/lib/lumesec/roll-text";
import { Sparks, type SparkOptions } from "@/lib/lumesec/sparks";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** Where an address is, as your lookup service reports it. Only `lat` and `lon` are required. */
export interface GeoIpResult {
  /** Latitude in degrees, north positive. */
  readonly lat: number;
  /** Longitude in degrees, east positive. */
  readonly lon: number;
  /** City name, shown first in the place line. */
  readonly city?: string;
  /** Region or state, shown after the city. */
  readonly region?: string;
  /** Country name (or code), shown last. */
  readonly country?: string;
  /** The network the address belongs to, for example `AS64500 Example Transit`. */
  readonly network?: string;
  /** How far off the location may be, in km. Drawn as a dotted ring around the point, with a radius of at least 4 px. */
  readonly accuracyKm?: number;
}

/** Imperative actions, for example for a row of example addresses or a "Look up my address" button outside the field. */
export interface GeoIpHandle {
  /**
   * Runs a lookup, exactly like pressing Enter in the field. With `address`, the field first changes to it (and
   * `onValueChange` fires); without it, the address in the field is looked up.
   */
  lookup(address?: string): void;
  /** Moves focus to the field. */
  focus(): void;
}

/** Props of GeoIp. The remaining props go to the root `<div>`. */
export interface GeoIpProps extends Omit<React.ComponentProps<"div">, "defaultValue" | "children" | "ref"> {
  /** Address in the field (controlled). Use with `onValueChange`. */
  value?: string;
  /** Initial address when uncontrolled. */
  defaultValue?: string;
  /** Called as the field changes, and when `lookup(address)` puts a new address into it. */
  onValueChange?: (value: string) => void;
  /**
   * Looks up a normalised address (`2001:db8::1`, `203.0.113.42`) and resolves with its location, or null when it is
   * unknown. A rejected promise counts as unknown. Without it the component invents a location from a hash of the
   * address, for demos only.
   */
  resolve?: (address: string) => Promise<GeoIpResult | null>;
  /**
   * Called once per lookup with the normalised address and the answer: the location, or null for an unknown,
   * private or reserved address. Answers to a lookup that a newer one replaced are dropped.
   */
  onResult?: (address: string, result: GeoIpResult | null) => void;
  /** Looks up the initial address the first time the map scrolls into view. */
  autoResolve?: boolean;
  /** Coordinate notation of the result: decimal degrees (`50.11° N`) or degrees, minutes and seconds (`50°06′40″ N`). */
  format?: "decimal" | "dms";
  /** Visible label of the field. */
  label?: string;
  /** Name of the input, so the typed address submits with a surrounding form. */
  name?: string;
  /** Placeholder of the empty field. */
  placeholder?: string;
  /** Disables the field and the button; lookups through the handle are ignored too. */
  disabled?: boolean;
  /** Imperative handle: `lookup(address?)` and `focus()`. */
  ref?: React.Ref<GeoIpHandle>;
}

/**
 * An IP address field that shows where the address is on a small world map. While the lookup runs, a crosshair hops
 * from land dot to land dot, quick at first and slower with every hop, like a slot machine reel. When the answer
 * arrives, the next hops close in on it, the last one springs onto the exact point, the corner bracket snaps shut and
 * a ring of light runs through the lattice. Then the place, coordinates, network and accuracy roll into the panel
 * below. Private and reserved addresses are answered at once without a lookup.
 *
 * Pass your own lookup as `resolve`; the built-in one invents locations and is only for demos.
 *
 * @example
 * <GeoIp
 *   defaultValue="203.0.113.42"
 *   resolve={async (address) => {
 *     const response = await fetch(`/api/ip/${encodeURIComponent(address)}`);
 *     return response.ok ? response.json() : null;
 *   }}
 * />
 */
export function GeoIp({
  value,
  defaultValue = "203.0.113.42",
  onValueChange,
  resolve = demoResolve,
  onResult,
  autoResolve = true,
  format = "decimal",
  label = "IP address",
  name,
  placeholder = "Enter an IP address",
  disabled = false,
  ref,
  className,
  ...props
}: GeoIpProps) {
  const [address, setAddress] = useControllableState<string>({ value, defaultValue, onChange: onValueChange });
  const [invalid, setInvalid] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [dimmed, setDimmed] = React.useState(false);
  const [display, setDisplay] = React.useState<Display>(IDLE);
  const [announcement, setAnnouncement] = React.useState("");
  const id = React.useId();
  const inputId = `${id}-input`;
  const hintId = `${id}-hint`;

  const inputRef = React.useRef<HTMLInputElement>(null);
  const mapRef = React.useRef<HTMLDivElement>(null);
  const baseRef = React.useRef<HTMLCanvasElement>(null);
  const overlayRef = React.useRef<HTMLCanvasElement>(null);
  const effectsRef = React.useRef<HTMLCanvasElement>(null);
  /** Everything the loop mutates, created on first use (never during render). */
  const engineRef = useLazyRef(createEngine);
  /** Id of the latest lookup; answers to older ones are ignored. */
  const requestRef = React.useRef(0);
  /** The answer waiting for the crosshair to lock. */
  const pendingRef = React.useRef<PendingAnswer | null>(null);
  /** Whether the map is on screen: answers that arrive while it is not lock at once. */
  const visibleRef = React.useRef(false);
  /** Whether the first-view lookup has been decided. */
  const autoRef = React.useRef(false);
  /** Alternates a trailing no-break space, so the same announcement twice in a row is read twice. */
  const politeRef = React.useRef(false);
  const latest = React.useRef<LatestProps>({ autoResolve, address, onResult, lookup: () => {} });

  const loop = useAnimationLoop(mapRef, step);
  const palette = usePalette(mapRef, GEO_TOKENS, syncInk);
  const base = useCanvas(
    baseRef,
    (surface) => {
      const engine = engineRef.current;
      layoutMap(engine, surface.width, surface.height);
      paintBase(surface, engine);
      loop.kick();
    },
    MAP_CANVAS,
  );
  const overlay = useCanvas(overlayRef, () => loop.kick(), MAP_CANVAS);
  const effects = useCanvas(
    effectsRef,
    (surface) => {
      // the sparks canvas reaches past the map; map coordinates shift by its offset
      const engine = engineRef.current;
      engine.fxX = -surface.canvas.offsetLeft;
      engine.fxY = -surface.canvas.offsetTop;
    },
    MAP_CANVAS,
  );

  // Visibility, and the first-view lookup once at least a third of the map is on screen.
  React.useEffect(() => {
    const element = mapRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        visibleRef.current = entry.isIntersecting;
        if (autoRef.current || entry.intersectionRatio < 0.34) return;
        autoRef.current = true;
        const current = latest.current;
        if (current.autoResolve && current.address.trim()) current.lookup();
      },
      { threshold: [0, 0.35] },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  React.useImperativeHandle(
    ref,
    () => ({
      lookup: (next?: string) => latest.current.lookup(next),
      focus: () => inputRef.current?.focus(),
    }),
    [],
  );

  /** Theme colours changed (or were read for the first time): new ramp, new land. */
  function syncInk() {
    const current = palette.current;
    if (!current) return;
    const engine = engineRef.current;
    const ink = geoInk(current);
    engine.ink = ink;
    const stops = [ink.land, ink.accent, ink.hot];
    if (engine.batch) engine.batch.setRamp(stops);
    else engine.batch = createDotBatch(1024, stops);
    paintBase(base.current, engine);
    loop.kick();
  }

  function step(time: number, delta: number) {
    const engine = engineRef.current;
    const surface = overlay.current;
    if (!surface || !engine.lattice || !engine.ink || !engine.batch) return false;
    const now = time * 1000;
    if (advance(engine, now, delta, prefersReducedMotion())) completeLock(engine.requestId);
    drawOverlay(surface, engine, now);
    const fx = effects.current;
    const sparksLive = fx ? drawSparks(fx, engine, delta) : false;
    return sparksLive || isAnimating(engine, now);
  }

  function announce(text: string) {
    politeRef.current = !politeRef.current;
    setAnnouncement(politeRef.current ? text : `${text}\u00a0`);
  }

  function show(next: Outcome) {
    setDisplay((previous) => ({ ...next, direction: directionOf(previous.result, next.result) }));
    announce(announcementOf(next));
  }

  /** Runs a lookup of `next`, or of the address in the field. */
  function lookup(next?: string) {
    if (disabled) return;
    const text = next ?? address;
    if (next !== undefined) setAddress(next);
    const ip = parseIpAddress(text);
    if (!ip) {
      setInvalid(true);
      shake(inputRef.current);
      announce(INVALID_TEXT);
      return;
    }
    setInvalid(false);
    requestRef.current += 1;
    const request = requestRef.current;
    pendingRef.current = null;
    const engine = engineRef.current;
    const now = clockNow();
    const reduced = prefersReducedMotion();
    const scope = ipScope(ip);

    // private and reserved ranges have no place on the map: answer at once, without asking `resolve`
    if (scope !== "public" && scope !== "documentation") {
      cancelHunt(engine, reduced);
      setBusy(false);
      setDimmed(true);
      show({ kind: "private", version: ip.version, scope, result: null });
      onResult?.(ip.text, null);
      loop.kick();
      return;
    }

    setDimmed(false);
    setBusy(true);
    startHunt(engine, request, ip.text, now, reduced);
    loop.kick();
    let answer: Promise<GeoIpResult | null>;
    try {
      answer = Promise.resolve(resolve(ip.text));
    } catch (error) {
      answer = Promise.reject(error);
    }
    answer.then(
      (result) => settle(request, ip, readResult(result)),
      () => settle(request, ip, null),
    );
  }

  /** The answer to lookup `request` arrived: steer the hunt onto it, or let the crosshair shake off. */
  function settle(request: number, ip: IpAddress, result: GeoIpResult | null) {
    if (request !== requestRef.current) return;
    latest.current.onResult?.(ip.text, result);
    const engine = engineRef.current;
    const now = clockNow();
    const reduced = prefersReducedMotion();
    if (!result) {
      failHunt(engine, now, reduced);
      setBusy(false);
      show({ kind: "empty", version: ip.version, scope: null, result: null });
      loop.kick();
      return;
    }
    pendingRef.current = { request, version: ip.version, result };
    // nothing to watch (reduced motion, map off screen or not laid out): lock without the hunt
    const instant = reduced || !visibleRef.current || !engine.lattice || engine.mode !== "hunting";
    arrive(engine, result, now, instant);
    if (instant) completeLock(request);
    loop.kick();
  }

  /** The crosshair locked: the result rolls into the panel and is announced. */
  function completeLock(request: number) {
    const pending = pendingRef.current;
    if (!pending || pending.request !== request || request !== requestRef.current) return;
    pendingRef.current = null;
    setBusy(false);
    show({ kind: "result", version: pending.version, scope: null, result: pending.result });
  }

  // The observer, the handle and late answers read the latest props and `lookup` from here.
  React.useEffect(() => {
    latest.current = { autoResolve, address, onResult, lookup };
  });

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    // a lookup, not a form submission
    event.preventDefault();
    lookup();
  }

  const result = display.result;
  const digits = format === "dms" ? 0 : 2;
  const placeText = busy ? LOCATING_TEXT : placeTextOf(display);
  const latText = result ? formatCoordinate(result.lat, "lat", format, digits).text : MISSING;
  const lonText = result ? formatCoordinate(result.lon, "lon", format, digits).text : MISSING;
  const networkText = result
    ? result.network?.trim() || MISSING
    : display.kind === "private" && display.scope
      ? SCOPE_LABELS[display.scope]
      : MISSING;
  const accuracyText = result ? accuracyTextOf(result.accuracyKm) : MISSING;
  const versionText = display.version === 6 ? "IPv6" : "IPv4";
  const state = busy ? "pending" : display.kind;

  return (
    <div
      data-slot="geo-ip"
      data-state={state}
      data-disabled={disabled ? "" : undefined}
      className={cn(
        "grid w-full max-w-[380px] gap-3 text-[13px] leading-[1.4] text-foreground [-webkit-tap-highlight-color:transparent] data-[disabled]:opacity-60",
        className,
      )}
      {...props}
    >
      <div className="grid gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={inputId} className="text-[12.5px] font-medium">
            {label}
          </label>
          <span id={hintId} className={cn("text-[12px] text-muted-foreground", invalid && "text-destructive")}>
            <RollText text={invalid ? INVALID_TEXT : HINT_TEXT} direction={invalid ? 1 : -1} />
          </span>
        </div>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            id={inputId}
            name={name}
            type="text"
            value={address}
            placeholder={placeholder}
            disabled={disabled}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            aria-invalid={invalid || undefined}
            aria-describedby={hintId}
            onChange={(event) => {
              setAddress(event.target.value);
              if (invalid) setInvalid(false);
            }}
            onKeyDown={handleKeyDown}
            className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 font-mono text-[13px] text-foreground tabular-nums transition-[border-color,box-shadow] duration-200 outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:border-[color-mix(in_srgb,var(--lumesec)_65%,var(--border))] focus-visible:ring-[3px] focus-visible:ring-lumesec/14 disabled:cursor-not-allowed aria-invalid:border-[color-mix(in_srgb,var(--destructive)_65%,var(--border))] aria-invalid:ring-[3px] aria-invalid:ring-destructive/12 motion-reduce:transition-none"
          />
          <button
            type="button"
            disabled={disabled}
            aria-busy={busy || undefined}
            onClick={() => lookup()}
            className="group/button inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card px-3 font-[inherit] text-[13px] font-medium text-foreground transition-[border-color] duration-200 outline-none hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid disabled:cursor-not-allowed aria-busy:cursor-progress aria-busy:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))]"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.3}
              strokeLinecap="round"
              aria-hidden="true"
              className="size-3.5 text-muted-foreground transition-colors duration-200 group-aria-busy/button:text-lumesec"
            >
              <circle cx="8" cy="8" r="4.3" />
              <path d="M8 1.6v2.3M8 12.1v2.3M1.6 8h2.3M12.1 8h2.3" />
              <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
            </svg>
            Look up
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div ref={mapRef} aria-hidden="true" className="relative" style={{ aspectRatio: ASPECT }}>
          <div
            data-dimmed={dimmed ? "" : undefined}
            className="absolute inset-0 overflow-hidden rounded-t-[11px] bg-muted/45 transition-opacity duration-300 data-[dimmed]:opacity-50 motion-reduce:transition-none"
          >
            <canvas ref={baseRef} className="absolute inset-0 block size-full" />
          </div>
          <canvas ref={overlayRef} className="absolute inset-0 block size-full rounded-t-[11px]" />
          <canvas
            ref={effectsRef}
            className="pointer-events-none absolute -top-10 -left-4 z-[3] block h-[calc(100%+80px)] w-[calc(100%+32px)] sm:-left-10 sm:w-[calc(100%+80px)]"
          />
        </div>
        <div className="grid gap-2 border-t border-border px-3.5 pt-2.5 pb-3">
          <div className="flex items-center justify-between gap-3">
            <span
              className={cn(
                "min-w-0 flex-1 text-[14px] leading-5",
                state === "result"
                  ? "font-medium text-foreground"
                  : state === "empty"
                    ? "text-destructive"
                    : "text-muted-foreground",
              )}
            >
              <RollText text={placeText} className={TRUNCATE} />
            </span>
            <span
              aria-hidden={display.version === null || undefined}
              className={cn(
                "shrink-0 rounded-[5px] border border-border px-1.5 font-mono text-[10.5px] leading-4 text-muted-foreground transition-opacity duration-200",
                display.version === null && "opacity-0",
                busy && display.version !== null && "opacity-45",
              )}
            >
              <RollText text={versionText} />
            </span>
          </div>
          <dl
            data-busy={busy ? "" : undefined}
            className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[12px] leading-[18px] [&_dd]:transition-opacity [&_dd]:duration-200 data-[busy]:[&_dd]:opacity-45"
          >
            <dt className="text-muted-foreground">Coordinates</dt>
            <dd className="m-0 flex min-w-0 gap-3 font-mono tabular-nums">
              <RollText text={latText} reserve={RESERVE[format].lat} direction={display.direction.lat} />
              <RollText text={lonText} reserve={RESERVE[format].lon} direction={display.direction.lon} />
            </dd>
            <dt className="text-muted-foreground">Network</dt>
            <dd className="m-0 min-w-0">
              <RollText text={networkText} className={TRUNCATE} />
            </dd>
            <dt className="text-muted-foreground">Accuracy</dt>
            <dd className="m-0 min-w-0">
              <RollText text={accuracyText} className={TRUNCATE} />
            </dd>
          </dl>
        </div>
      </div>
      <span role="status" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}

/* Text --------------------------------------------------------------------------------------------- */

const HINT_TEXT = "IPv4 or IPv6";
const INVALID_TEXT = "Not a valid IP address";
const LOCATING_TEXT = "Locating…";
const IDLE_TEXT = "No address looked up yet";
const EMPTY_TEXT = "No location found for this address";
const PRIVATE_TEXT = "Private or reserved address, no location";
const MISSING = "–";

/** What the Network row says for an address that has no location. */
const SCOPE_LABELS: Record<IpScope, string> = {
  public: "Public",
  documentation: "Documentation range",
  private: "Private network",
  shared: "Shared address space",
  loopback: "Loopback",
  "link-local": "Link-local",
  multicast: "Multicast",
  unspecified: "Unspecified address",
  reserved: "Reserved range",
};

/** Widest text each coordinate can show, so the readout never changes width. */
const RESERVE = {
  decimal: { lat: ["00.00° N"], lon: ["000.00° W"] },
  dms: { lat: ["00°00′00″ N"], lon: ["000°00′00″ W"] },
} as const;

/** Lets a RollText line shrink and end in an ellipsis. */
const TRUNCATE = "w-full max-w-full grid-cols-[minmax(0,1fr)] [&>span]:max-w-full [&>span]:truncate";

type DisplayKind = "idle" | "result" | "empty" | "private";

/** The answer the panel shows. */
interface Outcome {
  kind: DisplayKind;
  version: 4 | 6 | null;
  scope: IpScope | null;
  result: GeoIpResult | null;
}

interface Display extends Outcome {
  /** Roll direction of each coordinate: 1 when it grew (rolls up), -1 when it shrank. */
  direction: { lat: number; lon: number };
}

const IDLE: Display = { kind: "idle", version: null, scope: null, result: null, direction: { lat: 1, lon: 1 } };

interface PendingAnswer {
  request: number;
  version: 4 | 6;
  result: GeoIpResult;
}

interface LatestProps {
  autoResolve: boolean;
  address: string;
  onResult: GeoIpProps["onResult"];
  lookup: (next?: string) => void;
}

function placeTextOf(display: Display) {
  if (display.kind === "result" && display.result) return placeOf(display.result) || "Approximate location";
  if (display.kind === "empty") return EMPTY_TEXT;
  if (display.kind === "private") return PRIVATE_TEXT;
  return IDLE_TEXT;
}

/** City, region and country, without repeats ("Singapore, Singapore" reads as "Singapore"). */
function placeOf(result: GeoIpResult) {
  const parts: string[] = [];
  for (const part of [result.city, result.region, result.country]) {
    const text = typeof part === "string" ? part.trim() : "";
    if (text && !parts.some((seen) => seen.toLowerCase() === text.toLowerCase())) parts.push(text);
  }
  return parts.join(", ");
}

function accuracyTextOf(km: number | undefined) {
  return km !== undefined && km > 0 ? `Approximate, within ${formatDistance(km)}` : "Approximate";
}

function announcementOf(outcome: Outcome) {
  if (outcome.kind === "empty") return EMPTY_TEXT;
  if (outcome.kind === "private") return PRIVATE_TEXT;
  const result = outcome.result;
  if (!result) return "";
  const coordinates = `${formatCoordinate(result.lat, "lat", "decimal", 2).text}, ${formatCoordinate(result.lon, "lon", "decimal", 2).text}`;
  const place = placeOf(result);
  return place ? `Approximately ${place}, ${coordinates}` : `Approximately ${coordinates}`;
}

function directionOf(previous: GeoIpResult | null, next: GeoIpResult | null) {
  if (!previous || !next) return { lat: 1, lon: 1 };
  const lonDelta = wrapLongitude(next.lon - previous.lon);
  return { lat: next.lat >= previous.lat ? 1 : -1, lon: lonDelta >= 0 ? 1 : -1 };
}

/**
 * A usable answer from `resolve`, or null. Answers often come straight from a JSON response, so every field is checked:
 * finite coordinates (latitude clamped, longitude wrapped), text fields only when they are strings, a positive accuracy.
 */
function readResult(value: unknown): GeoIpResult | null {
  if (!isObject(value)) return null;
  const lat = toNumber(value.lat);
  const lon = toNumber(value.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const km = toNumber(value.accuracyKm);
  return {
    lat: clamp(lat, -90, 90),
    lon: wrapLongitude(lon),
    city: optionalText(value.city),
    region: optionalText(value.region),
    country: optionalText(value.country),
    network: optionalText(value.network),
    accuracyKm: Number.isFinite(km) && km > 0 ? km : undefined,
  };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** A number, or a numeric string such as `"50.11"`; NaN for anything else. */
const toNumber = (value: unknown) =>
  typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;

const optionalText = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);

/* Demo resolver ------------------------------------------------------------------------------------ */

const DEMO_NETWORKS = [
  "Example Transit",
  "Example Hosting",
  "Example Broadband",
  "Example Mobile",
  "Example Fibre",
  "Example Cloud",
];

/**
 * Invents a location for demos: a hash of the address picks a demo city, the point lands 5 to 40 km from it, the
 * accuracy is 20 to 80 km and the network uses a documentation AS number (64496 to 64511). Answers after 0.7 to 1.4 s.
 */
function demoResolve(address: string): Promise<GeoIpResult> {
  const random = createRandom(`geo-ip:${address}`);
  const city = DEMO_CITIES[Math.floor(random() * DEMO_CITIES.length)];
  const point = destinationPoint(city, random() * 360, 5 + random() * 35);
  const accuracyKm = 20 + Math.round(random() * 12) * 5;
  const network = `AS${64496 + Math.floor(random() * 16)} ${DEMO_NETWORKS[Math.floor(random() * DEMO_NETWORKS.length)]}`;
  const delay = 700 + random() * 700;
  const result: GeoIpResult = {
    lat: Math.round(point.lat * 1e4) / 1e4,
    lon: Math.round(point.lon * 1e4) / 1e4,
    city: city.name,
    country: countryName(city.country),
    network,
    accuracyKm,
  };
  return new Promise((done) => {
    window.setTimeout(() => done(result), delay);
  });
}

/** English country name for an ISO code; geo-countries has no outline (and no entry) for a few city states. */
function countryName(code: string) {
  const country = getCountry(code);
  if (country) return country.name;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/* Hunt engine -------------------------------------------------------------------------------------- */

const LAT_RANGE = MAP_LAT_RANGE;
const ASPECT = projectionAspect("equirectangular", LAT_RANGE);
const MAP_CANVAS = { maxDpr: 2 } as const;

// Geometry in CSS pixels
const PITCH = 3.5;
const DOT = 1.5;
/** A dot the crosshair lands on flashes at this size. */
const LIT_DOT = 2.4;
/** Half the side of the corner bracket: while hunting and once locked, wide open while homing, and on release. */
const BRACKET = 9;
const BRACKET_OPEN = 18;
const BRACKET_RELEASE = 13;
/** Space between the bracket and the crosshair lines. */
const LINE_GAP = 3;
/** The accuracy ring never shrinks below this radius, so a precise answer still shows a ring. */
const RING_MIN_PX = 4;
const RING_SPACING = 2.6;
const RING_DOT = 1.2;
const PING_RADIUS = 56;
const PING_WIDTH = 5;
const SHAKE_PX = 4;
/** A hop lands at least this share of the map width away, so hops read as hops. */
const MIN_HOP_SHARE = 0.16;
const LOCK_DISTANCE = 1;
const KM_PER_DEGREE = 111.195;

// Timing in ms
/** Hop n waits min(HOP_MAX_MS, HOP_FIRST_MS · HOP_GROWTH^n): quick at first, then slower, like a reel. */
const HOP_FIRST_MS = 40;
const HOP_GROWTH = 1.22;
const HOP_MAX_MS = 260;
/** Steered hops start no earlier than this, so a quick answer still shows the close-in (at least 0.6 s in all). */
const STEER_AFTER_MS = 300;
/** The waits after each steered hop: the reel keeps slowing as it closes in. */
const STEER_MS = [110, 140, 170, 200, 230];
/** A new lookup releases a locked crosshair (bracket opens a little) before the first hop. */
const RELEASE_MS = 90;
const TRAIL_MS = 180;
const GHOST_MS = 160;
const PING_MS = 700;
const RING_REVEAL_MS = 450;
const RING_FADE_MS = 220;
const FAIL_MS = 520;
const SHAKE_MS = 420;
const SHAKE_HZ = 11;
/** After the lock, the lines and the lit box settle to their quieter resting strength. */
const REST_DELAY_MS = 350;
const REST_MS = 700;
const LOCK_SETTLE_MS = 1300;
const ALPHA_SECONDS = 0.07;

// Strength
const LINE_ALPHA = 0.35;
const LINE_REST = 0.22;
const GHOST_ALPHA = 0.55;

const SPARK_COUNT = 14;
const SPARK_OPTIONS: SparkOptions = { speed: [60, 190], life: [0.3, 0.7], size: [1.5, 2], drag: 4.5, jitter: 2 };

/**
 * hidden: nothing drawn. waiting: a lookup runs with reduced motion (no hunt). hunting: random hops, then steered
 * ones. homing: the last hop springs onto the exact point. locked: resting on the result. failing: shaking off.
 */
type HuntMode = "hidden" | "waiting" | "hunting" | "homing" | "locked" | "failing";

/** The answer's point, in degrees and in map pixels. */
interface Target {
  lat: number;
  lon: number;
  x: number;
  y: number;
  km: number;
}

interface Hop {
  x: number;
  y: number;
  /** The lattice dot it landed on, or -1 for a point over water. */
  index: number;
  time: number;
}

interface Ghost {
  x: number;
  y: number;
  time: number;
}

interface AccuracyRing {
  lat: number;
  lon: number;
  km: number;
  shownAt: number;
  /** When it started fading out, or -1. */
  hiddenAt: number;
}

/** Everything the animation loop mutates. Lives in a ref, never in React state. */
interface Engine {
  width: number;
  height: number;
  projection: MapProjection | null;
  lattice: DotLattice | null;
  ink: GeoInk | null;
  batch: DotBatch | null;
  /** Offset from map coordinates to the sparks canvas. */
  fxX: number;
  fxY: number;
  /** Whether the land has been painted once. */
  painted: boolean;
  mode: HuntMode;
  requestId: number;
  /** Seeded per address, so the same address always hunts the same way. */
  random: () => number;
  /** Where the crosshair is in degrees: the source of truth across resizes. */
  lat: number;
  lon: number;
  x: Spring;
  y: Spring;
  alpha: number;
  bracket: Spring;
  bracketTarget: number;
  huntStart: number;
  hopIndex: number;
  nextHopAt: number;
  steerLeft: number;
  steerIndex: number;
  target: Target | null;
  hops: Hop[];
  ghosts: Ghost[];
  lockAt: number;
  pingAt: number;
  failAt: number;
  ring: AccuracyRing | null;
  sparks: Sparks;
  /** Whether the sparks canvas has something on it that needs clearing. */
  fxDirty: boolean;
}

function createEngine(): Engine {
  return {
    width: 0,
    height: 0,
    projection: null,
    lattice: null,
    ink: null,
    batch: null,
    fxX: 0,
    fxY: 0,
    painted: false,
    mode: "hidden",
    requestId: 0,
    random: createRandom(1),
    lat: 0,
    lon: 0,
    x: { position: 0, velocity: 0 },
    y: { position: 0, velocity: 0 },
    alpha: 0,
    bracket: { position: BRACKET, velocity: 0 },
    bracketTarget: BRACKET,
    huntStart: 0,
    hopIndex: 0,
    nextHopAt: 0,
    steerLeft: 0,
    steerIndex: 0,
    target: null,
    hops: [],
    ghosts: [],
    lockAt: -Infinity,
    pingAt: -Infinity,
    failAt: -Infinity,
    ring: null,
    sparks: new Sparks(),
    fxDirty: false,
  };
}

const scratch = createScreenPoint();

/** Projects a point into `scratch`, kept inside the map (latitudes beyond the crop sit on its edge). */
function place(engine: Engine, lat: number, lon: number) {
  const projection = engine.projection;
  if (!projection) {
    scratch.x = 0;
    scratch.y = 0;
    return;
  }
  projection.project(clamp(lat, LAT_RANGE[0], LAT_RANGE[1]), lon, scratch);
  scratch.x = clamp(scratch.x, 0, engine.width);
  scratch.y = clamp(scratch.y, 0, engine.height);
}

/** A new size: new projection and lattice, and the crosshair and target re-placed from their coordinates. */
function layoutMap(engine: Engine, width: number, height: number) {
  const projection = createProjection("equirectangular", { width, height, latRange: LAT_RANGE });
  const lattice = mapLattice(projection, { pitch: PITCH });
  if (lattice !== engine.lattice) {
    engine.hops.length = 0;
    engine.ghosts.length = 0;
  }
  engine.projection = projection;
  engine.lattice = lattice;
  engine.width = width;
  engine.height = height;
  if (engine.target) {
    place(engine, engine.target.lat, engine.target.lon);
    engine.target.x = scratch.x;
    engine.target.y = scratch.y;
  }
  place(engine, engine.lat, engine.lon);
  engine.x = { position: scratch.x, velocity: 0 };
  engine.y = { position: scratch.y, velocity: 0 };
}

function startHunt(engine: Engine, request: number, seed: string, now: number, reduced: boolean) {
  const shown =
    engine.alpha > 0.5 && (engine.mode === "locked" || engine.mode === "hunting" || engine.mode === "homing");
  engine.requestId = request;
  engine.random = createRandom(seed);
  engine.target = null;
  engine.steerLeft = 0;
  engine.steerIndex = 0;
  engine.hopIndex = 0;
  engine.huntStart = now;
  engine.pingAt = -Infinity;
  engine.failAt = -Infinity;
  if (engine.ring && engine.ring.hiddenAt < 0) engine.ring.hiddenAt = reduced ? now - RING_FADE_MS : now;
  if (reduced) {
    engine.mode = "waiting";
    engine.alpha = 0;
    return;
  }
  engine.mode = "hunting";
  engine.nextHopAt = now + (shown ? RELEASE_MS : 0);
  engine.bracketTarget = shown ? BRACKET_RELEASE : BRACKET;
}

function arrive(engine: Engine, result: GeoIpResult, now: number, instant: boolean) {
  place(engine, result.lat, result.lon);
  engine.target = { lat: result.lat, lon: result.lon, x: scratch.x, y: scratch.y, km: result.accuracyKm ?? 0 };
  engine.steerLeft = 3 + Math.floor(engine.random() * 3);
  engine.steerIndex = 0;
  if (instant) lock(engine, now, false);
}

/** A private or reserved address: the crosshair and the ring fade away. */
function cancelHunt(engine: Engine, reduced: boolean) {
  const now = clockNow();
  engine.mode = "hidden";
  engine.target = null;
  if (engine.ring && engine.ring.hiddenAt < 0) engine.ring.hiddenAt = reduced ? now - RING_FADE_MS : now;
  if (reduced) engine.alpha = 0;
}

/** No location: the crosshair shakes and fades where it is. */
function failHunt(engine: Engine, now: number, reduced: boolean) {
  engine.target = null;
  if (reduced || engine.alpha < 0.05 || engine.mode === "waiting") {
    engine.mode = "hidden";
    engine.alpha = 0;
    return;
  }
  engine.mode = "failing";
  engine.failAt = now;
}

function lock(engine: Engine, now: number, animate: boolean) {
  const target = engine.target;
  if (!target) return;
  engine.mode = "locked";
  engine.lat = target.lat;
  engine.lon = target.lon;
  engine.bracketTarget = BRACKET;
  engine.ring = { lat: target.lat, lon: target.lon, km: target.km, shownAt: animate ? now : -Infinity, hiddenAt: -1 };
  if (!animate) {
    engine.lockAt = -Infinity;
    engine.pingAt = -Infinity;
    engine.x = { position: target.x, velocity: 0 };
    engine.y = { position: target.y, velocity: 0 };
    engine.bracket = { position: BRACKET, velocity: 0 };
    engine.alpha = 1;
    return;
  }
  engine.lockAt = now;
  engine.pingAt = now;
  const ink = engine.ink;
  if (ink)
    engine.sparks.add(
      target.x + engine.fxX,
      target.y + engine.fxY,
      SPARK_COUNT,
      [ink.accent, ink.hot, ink.soft],
      SPARK_OPTIONS,
    );
}

function hopTo(engine: Engine, x: number, y: number, index: number, now: number) {
  if (engine.alpha > 0.05) engine.ghosts.push({ x: engine.x.position, y: engine.y.position, time: now });
  engine.x = { position: x, velocity: 0 };
  engine.y = { position: y, velocity: 0 };
  const lattice = engine.lattice;
  if (lattice && index >= 0) {
    engine.lat = lattice.lat[index];
    engine.lon = lattice.lon[index];
  } else {
    const point = engine.projection?.invert(x, y);
    if (point) {
      engine.lat = point.lat;
      engine.lon = point.lon;
    }
  }
  engine.hops.push({ x, y, index, time: now });
  engine.bracketTarget = BRACKET;
}

/** A hop to a random land dot, far enough from the last one to read as a hop. */
function randomHop(engine: Engine, now: number) {
  const lattice = engine.lattice;
  if (!lattice || lattice.count === 0) return;
  const minimum = engine.width * MIN_HOP_SHARE;
  let index = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    index = Math.floor(engine.random() * lattice.count);
    if (Math.hypot(lattice.x[index] - engine.x.position, lattice.y[index] - engine.y.position) >= minimum) break;
  }
  hopTo(engine, lattice.x[index], lattice.y[index], index, now);
}

/** A hop to a land dot within half the remaining distance to the answer (over open water, to a point). */
function steerHop(engine: Engine, target: Target, distance: number, now: number) {
  engine.steerLeft -= 1;
  const lattice = engine.lattice;
  const reach = distance * 0.5;
  const nearest = distance * 0.22;
  const candidates: number[] = [];
  if (lattice) {
    lattice.grid.query(target.x, target.y, reach, (index, distanceSquared) => {
      if (distanceSquared >= nearest * nearest) candidates.push(index);
    });
    if (candidates.length === 0) lattice.grid.query(target.x, target.y, reach, (index) => candidates.push(index));
  }
  if (lattice && candidates.length > 0) {
    const index = candidates[Math.floor(engine.random() * candidates.length)];
    hopTo(engine, lattice.x[index], lattice.y[index], index, now);
    return;
  }
  const angle = Math.atan2(engine.y.position - target.y, engine.x.position - target.x) + (engine.random() - 0.5) * 1.4;
  const x = clamp(target.x + Math.cos(angle) * distance * 0.4, 1, engine.width - 1);
  const y = clamp(target.y + Math.sin(angle) * distance * 0.4, 1, engine.height - 1);
  hopTo(engine, x, y, -1, now);
}

function prune(list: { time: number }[], now: number, ms: number) {
  while (list.length > 0 && now - list[0].time > ms) list.shift();
}

/** Advances the hunt by one frame. Returns true when the crosshair locked in this frame. */
function advance(engine: Engine, now: number, delta: number, reduced: boolean) {
  prune(engine.hops, now, TRAIL_MS);
  prune(engine.ghosts, now, GHOST_MS);
  if (engine.ring && engine.ring.hiddenAt >= 0 && now - engine.ring.hiddenAt > RING_FADE_MS) engine.ring = null;
  if (engine.mode === "failing" && now - engine.failAt > FAIL_MS) {
    engine.mode = "hidden";
    engine.alpha = 0;
  }

  if (engine.mode === "hunting" && now >= engine.nextHopAt) {
    const target = engine.target;
    if (target && now - engine.huntStart >= STEER_AFTER_MS) {
      const distance = Math.hypot(target.x - engine.x.position, target.y - engine.y.position);
      if (engine.steerLeft > 0 && distance > PITCH * 2.5) {
        steerHop(engine, target, distance, now);
        engine.nextHopAt = now + STEER_MS[Math.min(engine.steerIndex, STEER_MS.length - 1)];
        engine.steerIndex += 1;
      } else {
        // the last hop: spring onto the exact point with the bracket wide open
        engine.mode = "homing";
        engine.bracketTarget = BRACKET_OPEN;
      }
    } else {
      randomHop(engine, now);
      // a long pause (off screen) does not queue up hops
      engine.nextHopAt = now + Math.min(HOP_MAX_MS, HOP_FIRST_MS * HOP_GROWTH ** engine.hopIndex);
      engine.hopIndex += 1;
    }
  }

  let locked = false;
  const target = engine.target;
  if (target && (engine.mode === "homing" || engine.mode === "locked")) {
    if (reduced) {
      engine.x = { position: target.x, velocity: 0 };
      engine.y = { position: target.y, velocity: 0 };
    } else {
      springStep(engine.x, target.x, delta);
      springStep(engine.y, target.y, delta);
    }
    if (
      engine.mode === "homing" &&
      Math.hypot(engine.x.position - target.x, engine.y.position - target.y) < LOCK_DISTANCE
    ) {
      lock(engine, now, !reduced);
      locked = true;
    }
  }

  if (reduced) engine.bracket = { position: engine.bracketTarget, velocity: 0 };
  else springStep(engine.bracket, engine.bracketTarget, delta);

  if (engine.mode !== "failing") {
    const goal = engine.mode === "hunting" || engine.mode === "homing" || engine.mode === "locked" ? 1 : 0;
    engine.alpha = reduced ? goal : engine.alpha + (goal - engine.alpha) * (1 - Math.exp(-delta / ALPHA_SECONDS));
    if (Math.abs(goal - engine.alpha) < 0.003) engine.alpha = goal;
  }
  return locked;
}

const settled = (spring: Spring, target: number) =>
  Math.abs(spring.position - target) < 0.01 && Math.abs(spring.velocity) < 0.05;

function isAnimating(engine: Engine, now: number) {
  if (engine.mode === "hunting" || engine.mode === "homing" || engine.mode === "failing") return true;
  const goal = engine.mode === "locked" ? 1 : 0;
  if (engine.alpha !== goal) return true;
  if (!settled(engine.bracket, engine.bracketTarget)) return true;
  const target = engine.target;
  if (engine.mode === "locked" && target && (!settled(engine.x, target.x) || !settled(engine.y, target.y))) return true;
  if (now - engine.lockAt < LOCK_SETTLE_MS) return true;
  if (engine.hops.length > 0 || engine.ghosts.length > 0) return true;
  return engine.ring !== null && engine.ring.hiddenAt >= 0;
}

/* Drawing ------------------------------------------------------------------------------------------ */

/** A horizontal 1 px line on the device pixel grid. */
function hairlineH(context: CanvasRenderingContext2D, x0: number, x1: number, y: number, dpr: number) {
  if (x1 <= x0) return;
  const thickness = Math.max(1, Math.round(dpr));
  context.fillRect(x0, Math.round(y * dpr - thickness / 2) / dpr, x1 - x0, thickness / dpr);
}

/** A vertical 1 px line on the device pixel grid. */
function hairlineV(context: CanvasRenderingContext2D, x: number, y0: number, y1: number, dpr: number) {
  if (y1 <= y0) return;
  const thickness = Math.max(1, Math.round(dpr));
  context.fillRect(Math.round(x * dpr - thickness / 2) / dpr, y0, thickness / dpr, y1 - y0);
}

/** Four corner brackets around (x, y), `size` px from the centre to each side. */
function drawBracket(context: CanvasRenderingContext2D, x: number, y: number, size: number, dpr: number) {
  const thickness = Math.max(1, Math.round(1.5 * dpr)) / dpr;
  const arm = snap(clamp(size * 0.42, 3, 7), dpr);
  const left = snap(x - size, dpr);
  const right = snap(x + size, dpr);
  const top = snap(y - size, dpr);
  const bottom = snap(y + size, dpr);
  context.fillRect(left, top, arm, thickness);
  context.fillRect(left, top, thickness, arm);
  context.fillRect(right - arm, top, arm, thickness);
  context.fillRect(right - thickness, top, thickness, arm);
  context.fillRect(left, bottom - thickness, arm, thickness);
  context.fillRect(left, bottom - arm, thickness, arm);
  context.fillRect(right - arm, bottom - thickness, arm, thickness);
  context.fillRect(right - thickness, bottom - arm, thickness, arm);
}

/** The dotted accuracy ring: true km on the map, at least RING_MIN_PX, drawn clockwise from the top as it appears. */
function drawAccuracyRing(context: CanvasRenderingContext2D, engine: Engine, ink: GeoInk, now: number) {
  const ring = engine.ring;
  const projection = engine.projection;
  if (!ring || !projection) return;
  const fade = ring.hiddenAt < 0 ? 1 : 1 - clamp((now - ring.hiddenAt) / RING_FADE_MS, 0, 1);
  if (fade <= 0) return;
  const progress = ring.shownAt === -Infinity ? 2 : ((now - ring.shownAt) / RING_REVEAL_MS) * 1.15;
  place(engine, ring.lat, ring.lon);
  const cx = scratch.x;
  const cy = scratch.y;
  // equirectangular: degrees of latitude are square, degrees of longitude shrink with cos(lat)
  const pxPerDegree = projection.scale * DEG;
  const radiusY = Math.max(RING_MIN_PX, (ring.km / KM_PER_DEGREE) * pxPerDegree);
  const radiusX = Math.max(
    RING_MIN_PX,
    ((ring.km / KM_PER_DEGREE) * pxPerDegree) / Math.max(0.2, Math.cos(ring.lat * DEG)),
  );
  const count = clamp(Math.round((TAU * (radiusX + radiusY)) / 2 / RING_SPACING), 10, 180);
  context.fillStyle = rgba(ink.accent);
  for (let k = 0; k < count; k++) {
    const share = k / count;
    const threshold = share * 0.82 + hash(k * 31 + 7) * 0.18;
    const appear = clamp((progress - threshold) / 0.12, 0, 1);
    const alpha = appear * fade * 0.9;
    if (alpha < 0.02) continue;
    const angle = share * TAU;
    context.globalAlpha = alpha;
    context.fillRect(
      cx + Math.sin(angle) * radiusX - RING_DOT / 2,
      cy - Math.cos(angle) * radiusY - RING_DOT / 2,
      RING_DOT,
      RING_DOT,
    );
  }
  context.globalAlpha = 1;
}

/** The crosshair, its trail and the lattice it lights, on the overlay canvas. */
function drawOverlay(surface: CanvasSurface, engine: Engine, now: number) {
  const { context, width, height, dpr } = surface;
  context.clearRect(0, 0, width, height);
  const { lattice, ink, batch } = engine;
  if (!lattice || !ink || !batch) return;

  const failing = engine.mode === "failing";
  const failAge = now - engine.failAt;
  const alpha = failing ? engine.alpha * (1 - smoothstep(100, FAIL_MS, failAge)) : engine.alpha;
  const offset = failing
    ? SHAKE_PX * Math.sin((failAge / 1000) * TAU * SHAKE_HZ) * (1 - smoothstep(0, SHAKE_MS, failAge))
    : 0;
  const cx = engine.x.position + offset;
  const cy = engine.y.position;
  const size = Math.max(2, engine.bracket.position);
  // once locked, the lines and the lit box settle to a quieter strength
  const rest = engine.mode === "locked" ? smoothstep(REST_DELAY_MS, REST_DELAY_MS + REST_MS, now - engine.lockAt) : 0;

  // the lock ping: an uneven ring of light through the land dots
  const pingAge = now - engine.pingAt;
  const target = engine.target;
  if (target && pingAge >= 0 && pingAge < PING_MS) {
    const t = pingAge / PING_MS;
    const radius = easeOutCubic(t) * PING_RADIUS;
    const strength = 1 - smoothstep(0.35, 1, t);
    lattice.grid.query(target.x, target.y, radius + PING_WIDTH * 2 + 6, (i, distanceSquared) => {
      const b = ringFront(Math.sqrt(distanceSquared), radius, PING_WIDTH, lattice.jitter[i]) * strength;
      if (b > 0.04) batch.add(lattice.x[i], lattice.y[i], DOT + 1.1 * b, 0.5 + 0.5 * b, Math.min(1, b * 1.5));
    });
  }

  // the crosshair reads the lattice: the dots in its box and along its lines light up
  if (alpha > 0.01) {
    const reach = PITCH * 0.6;
    const boxAlpha = alpha * lerp(0.85, 0.45, rest);
    const lineAlpha = alpha * lerp(0.5, 0.25, rest);
    for (let i = 0; i < lattice.count; i++) {
      const dx = Math.abs(lattice.x[i] - cx);
      const dy = Math.abs(lattice.y[i] - cy);
      if (dx <= size && dy <= size) {
        batch.add(lattice.x[i], lattice.y[i], DOT + 0.3, 0.6, boxAlpha);
        continue;
      }
      const t = Math.max(1 - dy / reach, 1 - dx / reach);
      if (t > 0) batch.add(lattice.x[i], lattice.y[i], DOT, 0.5, t * lineAlpha);
    }
  }

  // each hop flashes the dot it landed on and, more faintly, its neighbours
  for (const hop of engine.hops) {
    if (hop.index < 0) continue;
    const age = (now - hop.time) / TRAIL_MS;
    if (age < 0 || age >= 1) continue;
    const fade = 1 - age;
    batch.add(hop.x, hop.y, lerp(LIT_DOT, DOT, age), 1 - 0.5 * age, fade);
    lattice.grid.query(hop.x, hop.y, PITCH * 1.5, (i, distanceSquared) => {
      if (i === hop.index) return;
      const near = 1 - Math.sqrt(distanceSquared) / (PITCH * 1.5);
      batch.add(lattice.x[i], lattice.y[i], DOT + 0.4 * near, 0.55, 0.7 * near * fade);
    });
  }
  batch.flush(context);

  context.fillStyle = rgba(ink.accent);
  for (const ghost of engine.ghosts) {
    const fade = 1 - (now - ghost.time) / GHOST_MS;
    if (fade <= 0) continue;
    context.globalAlpha = LINE_ALPHA * GHOST_ALPHA * fade * engine.alpha;
    hairlineH(context, 0, width, ghost.y, dpr);
    hairlineV(context, ghost.x, 0, height, dpr);
  }
  if (alpha > 0.01) {
    const gap = size + LINE_GAP;
    context.globalAlpha = lerp(LINE_ALPHA, LINE_REST, rest) * alpha;
    hairlineH(context, 0, cx - gap, cy, dpr);
    hairlineH(context, cx + gap, width, cy, dpr);
    hairlineV(context, cx, 0, cy - gap, dpr);
    hairlineV(context, cx, cy + gap, height, dpr);
  }
  context.globalAlpha = 1;

  drawAccuracyRing(context, engine, ink, now);

  if (alpha > 0.01) {
    context.fillStyle = rgba(ink.accent);
    context.globalAlpha = alpha;
    drawBracket(context, cx, cy, size, dpr);
  }
  if (engine.mode === "locked") {
    // the point itself pops when the bracket locks, then rests as a small square
    const pop = 2.2 * Math.exp(-Math.max(0, now - engine.lockAt) / 110);
    const dot = 3 + pop;
    const x = snap(cx, dpr);
    const y = snap(cy, dpr);
    context.globalAlpha = 1;
    context.fillStyle = rgba(ink.accent);
    context.fillRect(x - dot / 2, y - dot / 2, dot, dot);
    context.fillStyle = rgba(ink.hot);
    context.fillRect(x - 0.5, y - 0.5, 1, 1);
  }
  context.globalAlpha = 1;
}

/** The static land lattice, baked once per size and theme. It fades in the first time. */
function paintBase(surface: CanvasSurface | null, engine: Engine) {
  if (!surface || !engine.lattice || !engine.ink) return;
  surface.context.clearRect(0, 0, surface.width, surface.height);
  bakeLattice(surface.context, engine.lattice, engine.ink.land, DOT);
  if (engine.painted) return;
  engine.painted = true;
  if (!prefersReducedMotion() && typeof surface.canvas.animate === "function") {
    surface.canvas.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360, easing: "ease-out" });
  }
}

/** Lock sparks on the canvas that reaches past the map. Returns whether any are still alive. */
function drawSparks(surface: CanvasSurface, engine: Engine, delta: number) {
  if (!engine.sparks.active && !engine.fxDirty) return false;
  surface.context.clearRect(0, 0, surface.width, surface.height);
  const live = engine.sparks.step(surface.context, delta);
  engine.fxDirty = live;
  return live;
}

/** The current time in ms, for the animation loop and event handlers (never read during render). */
function clockNow() {
  return performance.now();
}
