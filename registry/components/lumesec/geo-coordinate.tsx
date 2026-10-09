"use client";

import * as React from "react";

import { snap, useCanvas, type CanvasSurface } from "@/lib/lumesec/canvas";
import { usePalette } from "@/lib/lumesec/color";
import {
  bakeLattice,
  createDotBatch,
  createProjection,
  createScreenPoint,
  GEO_TOKENS,
  geoInk,
  mapLattice,
  ringFront,
  type DotBatch,
  type DotLattice,
  type GeoInk,
  type LatLon,
  type MapProjection,
} from "@/lib/lumesec/geo";
import { detectCoordinateFormat, formatCoordinate, parseCoordinates, type Hemisphere } from "@/lib/lumesec/geo-data";
import { clamp, easeOutCubic, rgba, smoothstep } from "@/lib/lumesec/math";
import {
  prefersReducedMotion,
  shake,
  springStep,
  useAnimationLoop,
  useLazyRef,
  useReducedMotion,
  type Spring,
} from "@/lib/lumesec/motion";
import { RollText } from "@/lib/lumesec/roll-text";
import { Sparks, type SparkOptions } from "@/lib/lumesec/sparks";
import { useControllableState, useFormReset } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** A point `{ lat, lon }` in degrees, re-exported from the geo module for `value` and `onValueChange`. */
export type { LatLon } from "@/lib/lumesec/geo";

/** Coordinate notation: decimal degrees (`48.85660° N`) or degrees, minutes and seconds (`48°51′24″ N`). */
export type GeoCoordinateFormat = "decimal" | "dms";

/** Imperative actions, for example for a row of example coordinates outside the field. */
export interface GeoCoordinateHandle {
  /**
   * Puts `text` into the field as if it were typed: the map and the readout follow, and `onValueChange` fires when
   * the point the text reads changes. Ignored while the field is disabled.
   */
  setText(text: string): void;
  /** Moves focus to the field. */
  focus(): void;
}

/** Props of GeoCoordinate. Other props go to the root `div`, which carries `data-state` (`empty`, `partial`, `complete`, `invalid`). */
export interface GeoCoordinateProps extends Omit<React.ComponentProps<"div">, "defaultValue" | "children" | "ref"> {
  /** The point read from the field (controlled). Use with `onValueChange`. */
  value?: LatLon | null;
  /** Initial point when uncontrolled; shown in `format`. */
  defaultValue?: LatLon | null;
  /** Called when the text reads as a new point, or stops reading as one (with null). */
  onValueChange?: (value: LatLon | null) => void;
  /** Notation used for the initial text and when the field is rewritten on blur or by a controlled `value`. */
  format?: GeoCoordinateFormat;
  /**
   * Decimals of decimal degrees, 0 to 8. Degrees, minutes and seconds show whole seconds up to 5, and one more
   * decimal of the seconds for each step above 5.
   */
  precision?: number;
  /** Rewrites readable text in `format` when the field loses focus. The value keeps its full precision. */
  normalizeOnBlur?: boolean;
  /** Visible label of the field. */
  label?: string;
  /** Placeholder of the empty field. When it reads as a point, the map shows it as faint dotted lines. */
  placeholder?: string;
  /** Prefix of the hidden inputs `${name}-lat` and `${name}-lon`, which submit the point with a surrounding form. */
  name?: string;
  /** Requires a readable point: an empty field is marked invalid on blur and blocks form submission. */
  required?: boolean;
  /** Disables the field and the copy button. */
  disabled?: boolean;
  /** Imperative handle: `setText(text)` and `focus()`. */
  ref?: React.Ref<GeoCoordinateHandle>;
}

/**
 * A text field for coordinates that reads the usual ways of writing them: signed decimal pairs, hemisphere letters
 * before or after the numbers, degrees with minutes and seconds, and degrees with decimal minutes. A small world map
 * beside it shows what it read: the parallel and the meridian each ride their own spring, so typing the latitude moves
 * the horizontal line and the longitude moves the vertical one, and a line that moves fast leaves a short afterimage.
 * When both have settled the crossing locks: a bracket snaps in, a ring of light runs through the land dots and the
 * field's border flashes. Below the field the coordinates appear in the other notation, with digits that roll in the
 * direction of change and hemisphere letters that flip over when the sign changes.
 *
 * Half-typed text already moves the map: when only the first number is readable it counts as latitude, or as
 * longitude when it carries E or W.
 *
 * @example
 * <GeoCoordinate name="site" defaultValue={{ lat: 48.8566, lon: 2.3522 }} onValueChange={(point) => setSite(point)} />
 */
export function GeoCoordinate({
  value,
  defaultValue = null,
  onValueChange,
  format = "decimal",
  precision = 5,
  normalizeOnBlur = true,
  label = "Coordinates",
  placeholder = "48.8566, 2.3522",
  name,
  required = false,
  disabled = false,
  ref,
  className,
  ...props
}: GeoCoordinateProps) {
  const digits = clampPrecision(precision);
  const [point, setPoint] = useControllableState<LatLon | null>({ value, defaultValue, onChange: onValueChange });
  const [text, setText] = React.useState(() => textOf(value !== undefined ? value : defaultValue, format, digits));
  const [seenValue, setSeenValue] = React.useState(value);
  const [invalid, setInvalid] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [announcement, setAnnouncement] = React.useState("");
  const reducedMotion = useReducedMotion();
  const id = React.useId();
  const inputId = `${id}-input`;
  const readoutId = `${id}-readout`;
  const errorId = `${id}-error`;

  const reading = React.useMemo(() => readCoordinateText(text), [text]);
  const ghost = React.useMemo(() => (text.trim() ? null : parseCoordinates(placeholder)), [text, placeholder]);
  const readoutNotation = otherNotation(reading.notation);
  const hasReading = reading.lat !== null || reading.lon !== null;
  const state = invalid ? "invalid" : reading.full ? "complete" : hasReading ? "partial" : "empty";

  // A controlled value that changes from outside and differs from what the text reads rewrites the field.
  if (value !== seenValue) {
    setSeenValue(value);
    if (value !== undefined && !samePoint(value, reading.full)) setText(textOf(value, format, digits));
  }

  const inputRef = React.useRef<HTMLInputElement>(null);
  const mapRef = React.useRef<HTMLDivElement>(null);
  const baseRef = React.useRef<HTMLCanvasElement>(null);
  const overlayRef = React.useRef<HTMLCanvasElement>(null);
  const effectsRef = React.useRef<HTMLCanvasElement>(null);
  const engineRef = useLazyRef(createEngine);
  const timers = React.useRef({ copy: 0, announce: 0 });
  /** Alternates a trailing no-break space, so the same announcement twice in a row is read twice. */
  const politeRef = React.useRef(false);
  /** The latest `applyText`, for the imperative handle. */
  const applyRef = React.useRef<(next: string) => void>(() => {});

  const loop = useAnimationLoop(mapRef, step);
  const palette = usePalette(mapRef, GEO_TOKENS, syncInk);
  const base = useCanvas(baseRef, (surface) => {
    layoutMap(engineRef.current, surface.width, surface.height);
    paintBase();
    measureEffects();
    loop.kick();
  });
  const overlay = useCanvas(overlayRef, () => loop.kick());
  const effects = useCanvas(effectsRef, () => measureEffects());

  React.useEffect(() => {
    applyRef.current = applyText;
  });

  React.useImperativeHandle(
    ref,
    () => ({
      setText: (next: string) => applyRef.current(next),
      focus: () => inputRef.current?.focus(),
    }),
    [],
  );

  // The map follows what the text reads, axis by axis.
  React.useEffect(() => {
    setAxes(engineRef.current, reading.lat, reading.lon);
    loop.kick();
  }, [reading.lat, reading.lon, engineRef, loop]);

  // The placeholder's point shows as faint dotted lines while the field is empty.
  const ghostLat = ghost ? ghost.lat : null;
  const ghostLon = ghost ? ghost.lon : null;
  React.useEffect(() => {
    setGhost(engineRef.current, ghostLat, ghostLon);
    loop.kick();
  }, [ghostLat, ghostLon, engineRef, loop]);

  // Unreadable text blocks form submission like any invalid native field.
  const unreadable = text.trim() !== "" && reading.full === null;
  React.useEffect(() => {
    inputRef.current?.setCustomValidity(unreadable ? ERROR_TEXT : "");
  }, [unreadable]);

  React.useEffect(() => {
    const pending = timers.current;
    return () => {
      window.clearTimeout(pending.copy);
      window.clearTimeout(pending.announce);
    };
  }, []);

  useFormReset(inputRef, () => {
    window.clearTimeout(timers.current.announce);
    setText(textOf(defaultValue, format, digits));
    setInvalid(false);
    setCopied(false);
    setPoint(defaultValue);
  });

  /** Theme colours changed (or were read for the first time): new ramp, new land. */
  function syncInk() {
    const current = palette.current;
    if (!current) return;
    const engine = engineRef.current;
    const ink = geoInk(current);
    engine.ink = ink;
    const stops = [ink.land, ink.accent, ink.hot];
    if (engine.batch) engine.batch.setRamp(stops);
    else engine.batch = createDotBatch(512, stops);
    paintBase();
    loop.kick();
  }

  /** The static land lattice, baked once per size and theme. It fades in the first time. */
  function paintBase() {
    const surface = base.current;
    const engine = engineRef.current;
    if (!surface || !engine.lattice || !engine.ink) return;
    surface.context.clearRect(0, 0, surface.width, surface.height);
    bakeLattice(surface.context, engine.lattice, engine.ink.land, engine.dot);
    if (engine.painted) return;
    engine.painted = true;
    if (!prefersReducedMotion() && typeof surface.canvas.animate === "function") {
      surface.canvas.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360, easing: "ease-out" });
    }
  }

  /**
   * The sparks canvas reaches past the map; map coordinates shift by the difference of the two boxes, converted back
   * to CSS px when an ancestor is zoomed (client rects scale with CSS zoom, layout sizes do not).
   */
  function measureEffects() {
    const fx = effectsRef.current;
    const layer = overlayRef.current;
    if (!fx || !layer) return;
    const outer = fx.getBoundingClientRect();
    const inner = layer.getBoundingClientRect();
    const scale = outer.width ? fx.offsetWidth / outer.width : 1;
    const engine = engineRef.current;
    engine.fxX = (inner.left - outer.left) * scale;
    engine.fxY = (inner.top - outer.top) * scale;
  }

  function step(time: number, delta: number) {
    const engine = engineRef.current;
    const surface = overlay.current;
    if (!surface || !engine.projection || !engine.lattice || !engine.ink || !engine.batch) return false;
    const now = time * 1000;
    if (advance(engine, now, delta, prefersReducedMotion())) flashInput();
    drawOverlay(surface, engine, now);
    const fx = effects.current;
    const sparksLive = fx ? drawSparks(fx, engine, delta) : false;
    return sparksLive || isAnimating(engine, now);
  }

  /** The crossing locked after a change: the field's border flashes in the accent. */
  function flashInput() {
    const input = inputRef.current;
    if (input && typeof input.animate === "function") {
      input.animate(INPUT_FLASH_KEYFRAMES, { duration: 500, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
  }

  function announce(message: string) {
    politeRef.current = !politeRef.current;
    setAnnouncement(politeRef.current ? message : `${message}${NO_BREAK_SPACE}`);
  }

  /** New text, typed or set through the handle: read it, report a changed point and announce it once typing pauses. */
  function applyText(next: string) {
    if (disabled) return;
    setText(next);
    if (invalid) setInvalid(false);
    const full = parseCoordinates(next);
    if (!samePoint(full, reading.full)) setPoint(full);
    window.clearTimeout(timers.current.announce);
    if (full) {
      const spoken = formatPoint(full, otherNotation(detectCoordinateFormat(next)), digits);
      timers.current.announce = window.setTimeout(() => announce(spoken), ANNOUNCE_DELAY_MS);
    }
  }

  function handleBlur() {
    if (!text.trim()) {
      setInvalid(required);
      if (required) announce(ERROR_TEXT);
      return;
    }
    if (!reading.full) {
      window.clearTimeout(timers.current.announce);
      setInvalid(true);
      shake(inputRef.current);
      announce(ERROR_TEXT);
      return;
    }
    setInvalid(false);
    if (!normalizeOnBlur) return;
    const normalized = formatPoint(reading.full, format, digits);
    if (normalized !== text) setText(normalized);
  }

  function handleCopy() {
    const full = reading.full;
    if (!full || disabled) return;
    const clipboard: Clipboard | undefined = navigator.clipboard;
    if (!clipboard) return;
    clipboard.writeText(formatPoint(full, readoutNotation, digits)).then(
      () => {
        setCopied(true);
        announce(COPIED_TEXT);
        window.clearTimeout(timers.current.copy);
        timers.current.copy = window.setTimeout(() => setCopied(false), COPIED_MS);
      },
      () => {},
    );
  }

  return (
    <div
      data-slot="geo-coordinate"
      data-state={state}
      data-disabled={disabled ? "" : undefined}
      className={cn(
        "@container w-full max-w-[380px] text-[13px] leading-[1.4] text-foreground [-webkit-tap-highlight-color:transparent] data-[disabled]:opacity-60",
        className,
      )}
      {...props}
    >
      <div className="grid gap-x-3 gap-y-1.5 @min-[340px]:grid-cols-[minmax(0,1fr)_112px]">
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor={inputId} className="text-[12.5px] leading-[18px] font-medium">
            {label}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            value={text}
            placeholder={placeholder}
            disabled={disabled}
            required={required}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : readoutId}
            onChange={(event) => applyText(event.target.value)}
            onBlur={handleBlur}
            className="h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 font-mono text-[13px] text-foreground tabular-nums transition-[border-color,box-shadow] duration-200 outline-none placeholder:text-muted-foreground focus-visible:border-[color-mix(in_srgb,var(--lumesec)_65%,var(--border))] focus-visible:ring-[3px] focus-visible:ring-lumesec/14 disabled:cursor-not-allowed aria-invalid:border-[color-mix(in_srgb,var(--destructive)_65%,var(--border))] aria-invalid:ring-[3px] aria-invalid:ring-destructive/12 motion-reduce:transition-none"
          />
        </div>

        <div
          ref={mapRef}
          aria-hidden="true"
          className="relative order-last aspect-[2/1] w-full @min-[340px]:order-none @min-[340px]:mt-1 @min-[340px]:aspect-auto @min-[340px]:h-14 @min-[340px]:w-28"
        >
          <div className="absolute inset-0 overflow-hidden rounded-md border border-border bg-muted/40">
            <canvas ref={baseRef} className="absolute inset-0 block size-full" />
            <canvas ref={overlayRef} className="absolute inset-0 block size-full" />
          </div>
          <canvas
            ref={effectsRef}
            className="pointer-events-none absolute -top-4 -left-4 z-[1] block h-[calc(100%+32px)] w-[calc(100%+32px)]"
          />
        </div>

        <div className="col-span-full flex min-h-6 min-w-0 items-center justify-between gap-2">
          {invalid ? (
            <p id={errorId} className="m-0 text-[12px] leading-[18px] text-destructive">
              {ERROR_TEXT}
            </p>
          ) : (
            <>
              <p
                id={readoutId}
                className="m-0 min-w-0 font-mono text-[12px] leading-[18px] whitespace-nowrap text-muted-foreground tabular-nums"
              >
                {hasReading ? (
                  <>
                    <AxisReadout
                      value={reading.lat}
                      axis="lat"
                      notation={readoutNotation}
                      digits={digits}
                      reducedMotion={reducedMotion}
                    />
                    {", "}
                    <AxisReadout
                      value={reading.lon}
                      axis="lon"
                      notation={readoutNotation}
                      digits={digits}
                      reducedMotion={reducedMotion}
                    />
                  </>
                ) : (
                  <span className="font-sans">{HINT_TEXT}</span>
                )}
              </p>
              <button
                type="button"
                aria-label="Copy coordinates"
                disabled={disabled || !reading.full}
                data-copied={copied ? "" : undefined}
                onClick={handleCopy}
                className="inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-1.5 font-[inherit] text-[12px] text-muted-foreground transition-colors duration-150 outline-none hover:bg-foreground/6 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-lumesec focus-visible:outline-solid disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground data-[copied]:text-foreground motion-reduce:transition-none"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="size-3.5"
                >
                  {copied ? (
                    <path d="m3.5 8.4 3 3 6-6.8" />
                  ) : (
                    <>
                      <rect x="5.5" y="5.5" width="8" height="8" rx="1.6" />
                      <path d="M10.5 3.6v-.5a1.6 1.6 0 0 0-1.6-1.6H4.1a1.6 1.6 0 0 0-1.6 1.6v4.8a1.6 1.6 0 0 0 1.6 1.6h.5" />
                    </>
                  )}
                </svg>
                <RollText text={copied ? "Copied" : "Copy"} direction={copied ? 1 : -1} reserve={COPY_LABELS} />
              </button>
            </>
          )}
        </div>
      </div>
      <span role="status" className="sr-only">
        {announcement}
      </span>
      {name ? (
        <>
          <input type="hidden" name={`${name}-lat`} value={point ? String(point.lat) : ""} disabled={disabled} />
          <input type="hidden" name={`${name}-lon`} value={point ? String(point.lon) : ""} disabled={disabled} />
        </>
      ) : null}
    </div>
  );
}

/* Readout ------------------------------------------------------------------------------------------ */

/** One axis of the readout: its numbers roll in the direction of change and its hemisphere letter flips. */
function AxisReadout({
  value,
  axis,
  notation,
  digits,
  reducedMotion,
}: {
  value: number | null;
  axis: "lat" | "lon";
  notation: GeoCoordinateFormat;
  digits: number;
  reducedMotion: boolean;
}) {
  // 1 when the shown number grew (rolls up), -1 when it shrank; derived during render like RollText's list
  const [track, setTrack] = React.useState({ value, direction: 1 });
  if (track.value !== value) setTrack({ value, direction: rollDirection(track.value, value) });

  if (value === null) return <span>{MISSING}</span>;
  const parts = formatCoordinate(value, axis, notation, digitsFor(notation, digits));
  const roll = { direction: track.direction, animate: !reducedMotion };
  return (
    <span>
      {notation === "decimal" ? (
        <>
          <RollText text={parts.number} {...roll} />°
        </>
      ) : (
        <>
          <RollText text={parts.degrees} {...roll} />°<RollText text={parts.minutes} {...roll} />′
          <RollText text={parts.seconds} {...roll} />″
        </>
      )}{" "}
      <HemisphereLetter letter={parts.hemisphere} reducedMotion={reducedMotion} />
    </span>
  );
}

/** A hemisphere letter that flips over on its horizontal axis when it changes, swapping at the midpoint. */
function HemisphereLetter({ letter, reducedMotion }: { letter: Hemisphere; reducedMotion: boolean }) {
  const [shown, setShown] = React.useState(letter);
  const node = React.useRef<HTMLSpanElement>(null);
  /** Set when the first half of a flip ends, so the commit that swaps the letter plays the second half. */
  const landing = React.useRef(false);

  if (reducedMotion && shown !== letter) setShown(letter);

  React.useLayoutEffect(() => {
    const element = node.current;
    if (!element || typeof element.animate !== "function") {
      if (shown === letter) return;
      const frame = requestAnimationFrame(() => setShown(letter));
      return () => cancelAnimationFrame(frame);
    }
    if (shown === letter) {
      if (!landing.current) return;
      landing.current = false;
      const animation = element.animate(FLIP_IN_KEYFRAMES, { duration: FLIP_MS / 2, easing: "cubic-bezier(0,0,.2,1)" });
      return () => animation.cancel();
    }
    const animation = element.animate(FLIP_OUT_KEYFRAMES, {
      duration: FLIP_MS / 2,
      easing: "cubic-bezier(.4,0,1,1)",
      fill: "forwards",
    });
    animation.onfinish = () => {
      landing.current = true;
      setShown(letter);
    };
    return () => {
      animation.onfinish = null;
      animation.cancel();
    };
  }, [letter, shown]);

  return (
    <span ref={node} className="inline-block text-foreground [backface-visibility:hidden]">
      {shown}
    </span>
  );
}

/* Text --------------------------------------------------------------------------------------------- */

const HINT_TEXT = "Decimal or degrees, minutes, seconds";
const ERROR_TEXT = "Use latitude, longitude, for example 48.8566, 2.3522";
const COPIED_TEXT = "Coordinates copied";
const COPY_LABELS = ["Copy", "Copied"] as const;
const MISSING = "–";
/** Appended to every other announcement, so the same message twice in a row is still read. */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/** How long the copy button says "Copied". */
const COPIED_MS = 1600;
/** A read point is announced once typing pauses this long, not on every key. */
const ANNOUNCE_DELAY_MS = 700;
/** Both halves of a hemisphere flip. */
const FLIP_MS = 260;

const FLIP_OUT_KEYFRAMES: Keyframe[] = [
  { transform: "perspective(40px) rotateX(0deg)" },
  { transform: "perspective(40px) rotateX(90deg)" },
];
const FLIP_IN_KEYFRAMES: Keyframe[] = [
  { transform: "perspective(40px) rotateX(-90deg)" },
  { transform: "perspective(40px) rotateX(0deg)" },
];
/** One keyframe at offset 0: the border flashes and returns to whatever it is (focused or not). */
const INPUT_FLASH_KEYFRAMES: Keyframe[] = [
  {
    offset: 0,
    borderColor: "var(--lumesec)",
    boxShadow: "0 0 0 3px color-mix(in srgb, var(--lumesec) 22%, transparent)",
  },
];

/** What the text reads: both axes, one of them while it is half typed, or nothing. */
interface Reading {
  readonly lat: number | null;
  readonly lon: number | null;
  /** The point, when the whole text reads as one. */
  readonly full: LatLon | null;
  /** The notation the text is written in. */
  readonly notation: GeoCoordinateFormat | null;
}

const EMPTY_READING: Reading = { lat: null, lon: null, full: null, notation: null };

/** Fills the missing axis of half-typed text, so the shared parser can read the half that is there. */
const PROBE = 1;

/**
 * Reads the whole text with parseCoordinates, else the first readable part on its own: the part before a separator,
 * or the longest run of leading words. It counts as latitude unless its letter says longitude.
 */
function readCoordinateText(text: string): Reading {
  const trimmed = text.trim();
  if (!trimmed) return EMPTY_READING;
  const full = parseCoordinates(trimmed);
  if (full) return { lat: full.lat, lon: full.lon, full, notation: detectCoordinateFormat(trimmed) };
  for (const candidate of partialCandidates(trimmed)) {
    const probe = `${candidate}, ${PROBE}`;
    const read = parseCoordinates(probe);
    if (!read) continue;
    const notation = detectCoordinateFormat(probe);
    // the probe lands on the axis the text did not give
    if (read.lat === PROBE && read.lon !== PROBE) return { lat: null, lon: read.lon, full: null, notation };
    return { lat: read.lat, lon: null, full: null, notation };
  }
  return EMPTY_READING;
}

function partialCandidates(text: string): string[] {
  const separator = text.search(/[,;/]/);
  if (separator >= 0) return separator > 0 ? [text.slice(0, separator)] : [];
  // longest first, and only the first few words, so a pasted paragraph stays cheap
  const words = text.split(/\s+/).slice(0, 8);
  const candidates: string[] = [];
  for (let count = words.length; count >= 1; count--) candidates.push(words.slice(0, count).join(" "));
  return candidates;
}

/** The readout uses the other notation than the text: decimal under degrees, minutes and seconds, and the reverse. */
const otherNotation = (notation: GeoCoordinateFormat | null): GeoCoordinateFormat =>
  notation === "dms" ? "decimal" : "dms";

const clampPrecision = (precision: number) => clamp(Math.round(Number.isFinite(precision) ? precision : 5), 0, 8);

/** Decimals for a notation: `digits` for decimal degrees; whole seconds up to 5, one decimal more per step above. */
const digitsFor = (notation: GeoCoordinateFormat, digits: number) =>
  notation === "decimal" ? digits : clamp(digits - 5, 0, 3);

function formatPoint(point: LatLon, notation: GeoCoordinateFormat, digits: number) {
  const places = digitsFor(notation, digits);
  return `${formatCoordinate(point.lat, "lat", notation, places).text}, ${formatCoordinate(point.lon, "lon", notation, places).text}`;
}

const textOf = (point: LatLon | null | undefined, notation: GeoCoordinateFormat, digits: number) =>
  point ? formatPoint(point, notation, digits) : "";

function samePoint(a: LatLon | null, b: LatLon | null) {
  if (!a || !b) return a === b;
  return Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lon - b.lon) < 1e-9;
}

function rollDirection(previous: number | null, next: number | null) {
  if (previous === null || next === null) return 1;
  return Math.abs(next) >= Math.abs(previous) ? 1 : -1;
}

/* Map engine --------------------------------------------------------------------------------------- */

// Geometry in CSS pixels
/** Half the side of the 9 px lock bracket. */
const BRACKET_HALF = 4.5;
/** The bracket snaps in from this scale. */
const BRACKET_FROM = 1.6;
/** Space between the bracket and the lines that pass it. */
const LINE_GAP = 1.5;
const POINT = 2;
const PING_RADIUS = 10;
const PING_WIDTH = 2.5;
/** A locked target that moves less than this (one more decimal typed) keeps the lock without another ping. */
const RELOCK_PX = 0.75;
const LOCK_DISTANCE = 0.35;
const GHOST_STEP = 3;

// Motion
const LINE_STIFFNESS = 300;
const LINE_DAMPING = 0.75;
/** Below this speed in px/s a settled line may lock. */
const LOCK_SPEED = 4;
/** Above this speed in px/s a line leaves an afterimage. */
const AFTERIMAGE_SPEED = 120;
const AFTERIMAGE_LAG_MS = 22;
const AFTERIMAGE_ALPHAS: readonly number[] = [0.25, 0.12, 0.06];
const LINE_FADE_S = 0.12;
const GHOST_FADE_S = 0.15;
const BRACKET_FADE_S = 0.1;
const PING_MS = 500;
const POP_MS = 420;

// Strength
const LINE_ALPHA = 0.7;
const LIT_ALPHA = 0.55;
const GHOST_ALPHA = 0.5;

const SPARK_COUNT = 10;
const SPARK_OPTIONS: SparkOptions = { speed: [50, 150], life: [0.25, 0.6], size: [1, 1.5], drag: 4.5, jitter: 1.5 };

/** Recent positions of a line, newest at `head`, for the afterimage. */
interface Trail {
  times: Float64Array;
  positions: Float32Array;
  head: number;
  count: number;
}

const TRAIL_SIZE = 16;

/** The parallel (a y position) or the meridian (an x position). */
interface AxisLine {
  /** Whether the text gives this axis. */
  known: boolean;
  /** The axis in degrees; kept while the line fades out. */
  degrees: number;
  /** Where the spring pulls the line, in map pixels. */
  target: number;
  spring: Spring;
  alpha: number;
  /** The line was hidden: on the next frame it starts from the map centre. */
  enter: boolean;
  trail: Trail;
}

/** Everything the animation loop mutates. Lives in a ref, never in React state. */
interface Engine {
  width: number;
  height: number;
  pitch: number;
  dot: number;
  projection: MapProjection | null;
  lattice: DotLattice | null;
  ink: GeoInk | null;
  batch: DotBatch | null;
  /** Whether the land has been painted once. */
  painted: boolean;
  parallel: AxisLine;
  meridian: AxisLine;
  ghostOn: boolean;
  ghostLat: number;
  ghostLon: number;
  ghostAlpha: number;
  locked: boolean;
  lockX: number;
  lockY: number;
  /** When the last lock pinged, or -Infinity. */
  lockAt: number;
  /** Scale of the bracket, sprung toward 1. */
  bracket: Spring;
  bracketAlpha: number;
  /** Whether the first reading has arrived; changes after it arm the loud lock (border flash and sparks). */
  synced: boolean;
  armed: boolean;
  sparks: Sparks;
  /** Offset from map coordinates to the sparks canvas. */
  fxX: number;
  fxY: number;
  /** Whether the sparks canvas has something on it that needs clearing. */
  fxDirty: boolean;
}

function createTrail(): Trail {
  return { times: new Float64Array(TRAIL_SIZE), positions: new Float32Array(TRAIL_SIZE), head: 0, count: 0 };
}

function createLine(): AxisLine {
  return {
    known: false,
    degrees: 0,
    target: 0,
    spring: { position: 0, velocity: 0 },
    alpha: 0,
    enter: false,
    trail: createTrail(),
  };
}

function createEngine(): Engine {
  return {
    width: 0,
    height: 0,
    pitch: 2.5,
    dot: 1.2,
    projection: null,
    lattice: null,
    ink: null,
    batch: null,
    painted: false,
    parallel: createLine(),
    meridian: createLine(),
    ghostOn: false,
    ghostLat: 0,
    ghostLon: 0,
    ghostAlpha: 0,
    locked: false,
    lockX: 0,
    lockY: 0,
    lockAt: -Infinity,
    bracket: { position: 1, velocity: 0 },
    bracketAlpha: 0,
    synced: false,
    armed: false,
    sparks: new Sparks(),
    fxX: 0,
    fxY: 0,
    fxDirty: false,
  };
}

const scratch = createScreenPoint();

/** The map pixel of an axis: y of a latitude for the parallel, x of a longitude for the meridian. */
function targetOf(engine: Engine, degrees: number, vertical: boolean) {
  const projection = engine.projection;
  if (!projection) return 0;
  if (vertical) {
    projection.project(0, degrees, scratch);
    return clamp(scratch.x, 0.5, engine.width - 0.5);
  }
  projection.project(degrees, 0, scratch);
  return clamp(scratch.y, 0.5, engine.height - 0.5);
}

/** A new size: new projection and lattice; visible lines jump to their new places. */
function layoutMap(engine: Engine, width: number, height: number) {
  const projection = createProjection("equirectangular", { width, height });
  const small = width <= 160;
  engine.pitch = small ? 2.5 : 3.5;
  engine.dot = small ? 1.2 : 1.5;
  engine.projection = projection;
  engine.lattice = mapLattice(projection, { pitch: engine.pitch });
  engine.width = width;
  engine.height = height;
  placeLine(engine, engine.parallel, false);
  placeLine(engine, engine.meridian, true);
  if (engine.locked) {
    engine.lockX = engine.meridian.target;
    engine.lockY = engine.parallel.target;
  }
}

function placeLine(engine: Engine, line: AxisLine, vertical: boolean) {
  line.target = targetOf(engine, line.degrees, vertical);
  line.trail.count = 0;
  if (!line.enter) line.spring = { position: line.target, velocity: 0 };
}

/** Returns whether the line changed. A line that was hidden slides in from the map centre. */
function setAxis(line: AxisLine, degrees: number | null) {
  if (degrees === null) {
    const changed = line.known;
    line.known = false;
    return changed;
  }
  if (line.known && line.degrees === degrees) return false;
  if (!line.known && line.alpha < 0.02) line.enter = true;
  line.known = true;
  line.degrees = degrees;
  return true;
}

function setAxes(engine: Engine, lat: number | null, lon: number | null) {
  const latChanged = setAxis(engine.parallel, lat);
  const lonChanged = setAxis(engine.meridian, lon);
  if ((latChanged || lonChanged) && engine.synced) engine.armed = true;
  engine.synced = true;
}

function setGhost(engine: Engine, lat: number | null, lon: number | null) {
  engine.ghostOn = lat !== null && lon !== null;
  if (lat !== null && lon !== null) {
    engine.ghostLat = lat;
    engine.ghostLon = lon;
  }
}

/** Moves `value` toward `goal` by at most `step`, landing on it exactly. */
function approach(value: number, goal: number, step: number) {
  return value < goal ? Math.min(goal, value + step) : Math.max(goal, value - step);
}

function record(trail: Trail, time: number, position: number) {
  trail.head = (trail.head + 1) % TRAIL_SIZE;
  trail.times[trail.head] = time;
  trail.positions[trail.head] = position;
  trail.count = Math.min(TRAIL_SIZE, trail.count + 1);
}

/** Where the line was at `time` (the newest sample not after it), or NaN when the trail is too short. */
function positionAt(trail: Trail, time: number) {
  for (let k = 0; k < trail.count; k++) {
    const index = (trail.head - k + TRAIL_SIZE) % TRAIL_SIZE;
    if (trail.times[index] <= time) return trail.positions[index];
  }
  return Number.NaN;
}

function advanceLine(engine: Engine, line: AxisLine, vertical: boolean, now: number, delta: number, reduced: boolean) {
  if (line.known) line.target = targetOf(engine, line.degrees, vertical);
  if (line.enter) {
    line.enter = false;
    line.spring = { position: reduced ? line.target : vertical ? engine.width / 2 : engine.height / 2, velocity: 0 };
    line.trail.count = 0;
  }
  if (reduced) {
    line.spring.position = line.target;
    line.spring.velocity = 0;
    line.alpha = line.known ? 1 : 0;
  } else {
    springStep(line.spring, line.target, delta, LINE_STIFFNESS, LINE_DAMPING);
    line.alpha = approach(line.alpha, line.known ? 1 : 0, delta / LINE_FADE_S);
  }
  record(line.trail, now, line.spring.position);
}

const readyToLock = (line: AxisLine) =>
  line.alpha >= 0.99 &&
  Math.abs(line.spring.velocity) < LOCK_SPEED &&
  Math.abs(line.spring.position - line.target) < LOCK_DISTANCE;

/** Advances the lines, the ghost and the lock by one frame. Returns true when the crossing locked loudly this frame. */
function advance(engine: Engine, now: number, delta: number, reduced: boolean) {
  const { parallel, meridian } = engine;
  advanceLine(engine, parallel, false, now, delta, reduced);
  advanceLine(engine, meridian, true, now, delta, reduced);
  const ghostGoal = engine.ghostOn ? 1 : 0;
  engine.ghostAlpha = reduced ? ghostGoal : approach(engine.ghostAlpha, ghostGoal, delta / GHOST_FADE_S);

  const both = parallel.known && meridian.known;
  if (
    engine.locked &&
    (!both ||
      Math.abs(parallel.target - engine.lockY) > RELOCK_PX ||
      Math.abs(meridian.target - engine.lockX) > RELOCK_PX)
  ) {
    engine.locked = false;
  }
  // a change that kept the lock (one more decimal) must not make a later lock loud
  if (engine.locked) engine.armed = false;

  let loud = false;
  if (!engine.locked && both && readyToLock(parallel) && readyToLock(meridian)) loud = lock(engine, now, reduced);

  if (engine.locked) {
    engine.bracketAlpha = 1;
    if (reduced) engine.bracket = { position: 1, velocity: 0 };
    else springStep(engine.bracket, 1, delta);
  } else {
    engine.bracketAlpha = reduced ? 0 : approach(engine.bracketAlpha, 0, delta / BRACKET_FADE_S);
  }
  return loud;
}

/** Both lines settled: the bracket snaps in and the land pings. After a change, sparks fly and the field flashes. */
function lock(engine: Engine, now: number, reduced: boolean) {
  engine.locked = true;
  engine.lockX = engine.meridian.target;
  engine.lockY = engine.parallel.target;
  engine.bracketAlpha = 1;
  const loud = engine.armed && !reduced;
  engine.armed = false;
  if (reduced) {
    engine.bracket = { position: 1, velocity: 0 };
    engine.lockAt = -Infinity;
    return false;
  }
  engine.bracket = { position: BRACKET_FROM, velocity: 0 };
  engine.lockAt = now;
  const ink = engine.ink;
  if (loud && ink) {
    engine.sparks.add(
      engine.lockX + engine.fxX,
      engine.lockY + engine.fxY,
      SPARK_COUNT,
      [ink.accent, ink.hot, ink.soft],
      SPARK_OPTIONS,
    );
  }
  return loud;
}

function lineBusy(line: AxisLine) {
  if (line.enter || line.alpha !== (line.known ? 1 : 0)) return true;
  if (!line.known) return false;
  return Math.abs(line.spring.position - line.target) > 0.02 || Math.abs(line.spring.velocity) > 0.2;
}

function isAnimating(engine: Engine, now: number) {
  if (lineBusy(engine.parallel) || lineBusy(engine.meridian)) return true;
  if (engine.ghostAlpha !== (engine.ghostOn ? 1 : 0)) return true;
  if (!engine.locked) return engine.bracketAlpha > 0;
  const bracket = engine.bracket;
  if (Math.abs(bracket.position - 1) > 0.002 || Math.abs(bracket.velocity) > 0.02) return true;
  return now - engine.lockAt < Math.max(PING_MS, POP_MS);
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

/** Four corner brackets around (x, y), `half` px from the centre to each side. */
function drawBracket(context: CanvasRenderingContext2D, x: number, y: number, half: number, dpr: number) {
  const thickness = Math.max(1, Math.round(dpr)) / dpr;
  const arm = snap(clamp(half * 0.5, 2, 4), dpr);
  const left = snap(x - half, dpr);
  const right = snap(x + half, dpr);
  const top = snap(y - half, dpr);
  const bottom = snap(y + half, dpr);
  context.fillRect(left, top, arm, thickness);
  context.fillRect(left, top, thickness, arm);
  context.fillRect(right - arm, top, arm, thickness);
  context.fillRect(right - thickness, top, thickness, arm);
  context.fillRect(left, bottom - thickness, arm, thickness);
  context.fillRect(left, bottom - arm, thickness, arm);
  context.fillRect(right - arm, bottom - thickness, arm, thickness);
  context.fillRect(right - thickness, bottom - arm, thickness, arm);
}

/** The placeholder's parallel and meridian, as dotted lines in the muted ink. */
function drawGhost(context: CanvasRenderingContext2D, engine: Engine, ink: GeoInk, dpr: number) {
  if (engine.ghostAlpha <= 0) return;
  const y = snap(targetOf(engine, engine.ghostLat, false) - 0.5, dpr);
  const x = snap(targetOf(engine, engine.ghostLon, true) - 0.5, dpr);
  context.fillStyle = rgba(ink.muted);
  context.globalAlpha = GHOST_ALPHA * engine.ghostAlpha;
  for (let along = 1; along < engine.width; along += GHOST_STEP) context.fillRect(snap(along, dpr), y, 1, 1);
  for (let along = 1; along < engine.height; along += GHOST_STEP) context.fillRect(x, snap(along, dpr), 1, 1);
  context.globalAlpha = 1;
}

/** The positions a fast line held a moment ago, fainter with age. */
function drawAfterimages(
  context: CanvasRenderingContext2D,
  engine: Engine,
  line: AxisLine,
  vertical: boolean,
  now: number,
  dpr: number,
) {
  const strength = smoothstep(AFTERIMAGE_SPEED, AFTERIMAGE_SPEED * 1.8, Math.abs(line.spring.velocity)) * line.alpha;
  if (strength <= 0) return;
  for (let k = 0; k < AFTERIMAGE_ALPHAS.length; k++) {
    const position = positionAt(line.trail, now - (k + 1) * AFTERIMAGE_LAG_MS);
    if (Number.isNaN(position) || Math.abs(position - line.spring.position) < 0.75) continue;
    context.globalAlpha = AFTERIMAGE_ALPHAS[k] * strength;
    if (vertical) hairlineV(context, position, 0, engine.height, dpr);
    else hairlineH(context, 0, engine.width, position, dpr);
  }
}

/** The lines, the lattice they read, the lock ping, the bracket and the point, on the overlay canvas. */
function drawOverlay(surface: CanvasSurface, engine: Engine, now: number) {
  const { context, width, height, dpr } = surface;
  context.clearRect(0, 0, width, height);
  const { lattice, ink, batch, parallel, meridian } = engine;
  if (!lattice || !ink || !batch) return;

  drawGhost(context, engine, ink, dpr);

  const py = parallel.spring.position;
  const mx = meridian.spring.position;
  const pa = parallel.alpha;
  const ma = meridian.alpha;
  const crossing = pa > 0 && ma > 0;
  const bracketAlpha = crossing ? engine.bracketAlpha : 0;
  const half = BRACKET_HALF * engine.bracket.position;

  // the lines read the lattice: dots they pass light up, and the dots inside the bracket more
  if (pa > 0 || ma > 0) {
    const reach = engine.pitch * 0.62;
    for (let i = 0; i < lattice.count; i++) {
      const x = lattice.x[i];
      const y = lattice.y[i];
      const dx = Math.abs(x - mx);
      const dy = Math.abs(y - py);
      if (bracketAlpha > 0 && dx <= half && dy <= half) {
        batch.add(x, y, engine.dot + 0.3, 0.72, 0.85 * bracketAlpha);
        continue;
      }
      const near = Math.max(pa > 0 ? (1 - dy / reach) * pa : 0, ma > 0 ? (1 - dx / reach) * ma : 0);
      if (near > 0) batch.add(x, y, engine.dot, 0.5, near * LIT_ALPHA);
    }
  }

  // the lock ping: an uneven ring of light through the land dots around the crossing
  const pingAge = now - engine.lockAt;
  if (crossing && engine.locked && pingAge >= 0 && pingAge < PING_MS) {
    const t = pingAge / PING_MS;
    const radius = easeOutCubic(t) * PING_RADIUS;
    const strength = 1 - smoothstep(0.45, 1, t);
    lattice.grid.query(mx, py, PING_RADIUS + PING_WIDTH * 2 + 3, (i, distanceSquared) => {
      const b = ringFront(Math.sqrt(distanceSquared), radius, PING_WIDTH, lattice.jitter[i], 3) * strength;
      if (b > 0.04) batch.add(lattice.x[i], lattice.y[i], engine.dot + 0.9 * b, 0.6 + 0.4 * b, Math.min(1, b * 1.5));
    });
  }
  batch.flush(context);

  context.fillStyle = rgba(ink.accent);
  drawAfterimages(context, engine, parallel, false, now, dpr);
  drawAfterimages(context, engine, meridian, true, now, dpr);

  // the lines leave a gap around the bracket; it closes as the bracket fades
  const gap = bracketAlpha > 0 ? half + LINE_GAP : 0;
  if (pa > 0) {
    context.globalAlpha = LINE_ALPHA * pa;
    if (gap > 0) {
      hairlineH(context, 0, mx - gap, py, dpr);
      hairlineH(context, mx + gap, width, py, dpr);
      context.globalAlpha = LINE_ALPHA * pa * (1 - bracketAlpha);
      hairlineH(context, mx - gap, mx + gap, py, dpr);
    } else {
      hairlineH(context, 0, width, py, dpr);
    }
  }
  if (ma > 0) {
    context.globalAlpha = LINE_ALPHA * ma;
    if (gap > 0) {
      hairlineV(context, mx, 0, py - gap, dpr);
      hairlineV(context, mx, py + gap, height, dpr);
      context.globalAlpha = LINE_ALPHA * ma * (1 - bracketAlpha);
      hairlineV(context, mx, py - gap, py + gap, dpr);
    } else {
      hairlineV(context, mx, 0, height, dpr);
    }
  }

  if (crossing) {
    const alpha = Math.min(pa, ma);
    if (bracketAlpha > 0) {
      context.globalAlpha = bracketAlpha * alpha;
      drawBracket(context, mx, py, half, dpr);
    }
    // the point pops when the crossing locks, then rests as a small square with a hot centre
    const pop = engine.locked ? 1.6 * Math.exp(-Math.max(0, now - engine.lockAt) / 110) : 0;
    const size = POINT + pop;
    const x = snap(mx, dpr);
    const y = snap(py, dpr);
    context.globalAlpha = alpha;
    context.fillRect(x - size / 2, y - size / 2, size, size);
    if (engine.locked) {
      context.fillStyle = rgba(ink.hot);
      context.fillRect(x - 0.5, y - 0.5, 1, 1);
    }
  }
  context.globalAlpha = 1;
}

/** Lock sparks on the canvas that reaches past the map. Returns whether any are still alive. */
function drawSparks(surface: CanvasSurface, engine: Engine, delta: number) {
  if (!engine.sparks.active && !engine.fxDirty) return false;
  surface.context.clearRect(0, 0, surface.width, surface.height);
  const live = engine.sparks.step(surface.context, delta);
  engine.fxDirty = live;
  return live;
}
