"use client";

import * as React from "react";

import { snapCenter, snapSize, useCanvas, type CanvasSurface } from "@/lib/lumesec/canvas";
import { onThemeChange, readColor, usePalette, type ColorToken, type Palette } from "@/lib/lumesec/color";
import {
  boundsContains,
  coastlinePath,
  countryBounds,
  createDotBatch,
  createProjection,
  createScreenPoint,
  DEG,
  distanceKm,
  GEO_TOKENS,
  geoInk,
  isValidLatLon,
  MAP_LAT_RANGE,
  mapLattice,
  pointInRing,
  ringFront,
  wrapLongitude,
  type DotBatch,
  type DotLattice,
  type LatLon,
} from "@/lib/lumesec/geo";
import { countryAt, countryShape } from "@/lib/lumesec/geo-countries";
import {
  formatDistance,
  formatLatLon,
  formatNumber,
  formatUtcOffset,
  formatZonedTime,
  isValidTimeZone,
  useNow,
  utcOffsetMinutes,
} from "@/lib/lumesec/geo-data";
import { clamp, easeOutCubic, hash, lerp, mixRgb, rgba, smoothstep, type RGB } from "@/lib/lumesec/math";
import { prefersReducedMotion, springStep, useAnimationLoop, useLazyRef, type Spring } from "@/lib/lumesec/motion";
import { useComposedRef } from "@/lib/lumesec/react";
import { RollText } from "@/lib/lumesec/roll-text";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** A place for the cell: its coordinates and the text the popover shows. */
export interface MiniMapLocation extends LatLon {
  /** Place name: the popover title and the start of the button's accessible name. */
  readonly label?: string;
  /** Second line under the label, such as an address, a site or an IP address. */
  readonly detail?: string;
  /** IANA time zone such as `Asia/Singapore`. When it is valid, the popover shows the local time there. */
  readonly timeZone?: string;
}

/** The reference point the popover measures the distance from. */
export type MiniMapReference = LatLon & {
  /** Name in the distance row ("From Frankfurt"). */
  readonly label?: string;
};

/** Thumbnail size: 72 × 36, 96 × 48 or 128 × 64 px. */
export type GeoMiniMapSize = "sm" | "md" | "lg";

/** Colour of the point. */
export type GeoMiniMapTone = "accent" | "info" | "success" | "warning" | "destructive";

/** Where the popover opens relative to the thumbnail. */
export type GeoMiniMapSide = "auto" | "top" | "bottom";

/** Props of GeoMiniMap. The remaining props go to the thumbnail `<button>`. */
export interface GeoMiniMapProps extends Omit<React.ComponentProps<"button">, "children"> {
  /**
   * The place to show: `{ lat, lon, label?, detail?, timeZone? }`. Without it the cell shows a demo location
   * (Singapore).
   */
  location?: MiniMapLocation;
  /** Reference point for the distance row, such as your office or the region that served the request. */
  from?: MiniMapReference;
  /** Thumbnail size: 72 × 36, 96 × 48 or 128 × 64 px. */
  size?: GeoMiniMapSize;
  /** Controlled popover state. Use with `onOpenChange`. */
  open?: boolean;
  /** Popover state when uncontrolled. */
  defaultOpen?: boolean;
  /** Called when the popover opens or closes. */
  onOpenChange?: (open: boolean) => void;
  /** Where the popover opens. `auto` prefers above and flips below when the card does not fit above. */
  side?: GeoMiniMapSide;
  /** Zoom of the popover map, 2 to 6. */
  zoom?: number;
  /** Unit of the distance row and the scale bar. */
  unit?: "km" | "mi";
  /** Colour of the point. */
  tone?: GeoMiniMapTone;
}

/**
 * A world thumbnail with one point, sized for table cells and list rows. Hover it (120 ms) or focus it and a popover
 * grows out of the point while the map inside dives toward it: finer land resolves outward from the point behind an
 * uneven front, the point lands as a marker with a ring ping, and the place name, coordinates, local time and distance
 * appear as real text. Click, Enter or Space pins the popover; Escape closes it. Every thumbnail of a size shares one
 * baked lattice, so a table full of them stays light.
 *
 * @example
 * <GeoMiniMap
 *   location={{ lat: 35.6762, lon: 139.6503, label: "Tokyo", timeZone: "Asia/Tokyo" }}
 *   from={{ lat: 50.1109, lon: 8.6821, label: "Frankfurt" }}
 * />
 */
export function GeoMiniMap({
  location = DEMO_LOCATION,
  from,
  size = "md",
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  side = "auto",
  zoom = 4,
  unit = "km",
  tone = "accent",
  className,
  ref,
  disabled,
  onClick,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  ...props
}: GeoMiniMapProps) {
  const id = React.useId();
  const popoverId = `${id}-popover`;
  const detailId = `${id}-detail`;
  const readoutId = `${id}-readout`;

  const [open, setOpen] = useControllableState({ value: openProp, defaultValue: defaultOpen, onChange: onOpenChange });
  const [pinned, setPinned] = React.useState(false);
  // the popover stays rendered while it shrinks back into the point
  const [shown, setShown] = React.useState(open);
  if (open && !shown) setShown(true);
  // closing, from any source, also releases the pin
  if (!open && pinned) setPinned(false);

  const point = validPoint(location);
  const pointLat = point?.lat ?? Number.NaN;
  const pointLon = point?.lon ?? Number.NaN;
  const mapZoom = Number.isFinite(zoom) ? clamp(zoom, 2, 6) : 4;
  const [thumbWidth, thumbHeight] = THUMB_SIZES[size];
  const thumbPoint = thumbnailPoint(pointLat, pointLon, thumbWidth, thumbHeight);
  const scaleBar = scaleBarFor(pointLat, mapZoom, unit);

  const title = location.label?.trim() || null;
  const detail = location.detail?.trim() || null;
  const coordinates = point ? formatLatLon(point) : "–";
  const zone = location.timeZone && isValidTimeZone(location.timeZone) ? location.timeZone : null;
  const now = useNow(60_000, open && zone !== null);
  const localTime = zone && now !== null ? formatZonedTime(zone, now) : null;
  const utcOffset = zone && now !== null ? formatUtcOffset(utcOffsetMinutes(zone, now)) : null;
  const distance =
    from && point && Number.isFinite(from.lat) && Number.isFinite(from.lon) ? distanceKm(from, point) : null;
  const fromLabel = from?.label?.trim() ? `From ${from.label.trim()}` : "Distance";

  const accessibleName = ariaLabel ?? (point ? `${title ?? "Location"}, ${coordinates}` : (title ?? "Location"));
  const describedBy =
    [ariaDescribedBy, detail ? detailId : null, zone || distance !== null ? readoutId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const pointRef = React.useRef<HTMLSpanElement>(null);
  const thumbRef = React.useRef<HTMLCanvasElement>(null);
  const popoverRef = React.useRef<HTMLSpanElement>(null);
  const mapRef = React.useRef<HTMLCanvasElement>(null);

  /** The animation state, created on first use in an effect or frame (never during render). */
  const motionRef = useLazyRef(() => createMotion());
  const pinnedRef = React.useRef(false);
  const hover = React.useRef({ trigger: false, popover: false, focused: false });
  const timers = React.useRef({ open: 0, close: 0, warm: 0 });
  const latest = React.useRef({ side, sceneKey: sceneKeyFor(pointLat, pointLon, mapZoom) });

  const loop = useAnimationLoop(popoverRef, step);
  const colors = usePalette(triggerRef, MAP_TOKENS, () => loop.kick());
  const thumbSurface = useCanvas(thumbRef, paintThumbnail, { maxDpr: 3 });
  const mapSurface = useCanvas(mapRef, () => loop.kick(), { maxDpr: 2 });

  const setTriggerRef = useComposedRef(triggerRef, ref);

  React.useLayoutEffect(() => {
    latest.current = { side, sceneKey: sceneKeyFor(pointLat, pointLon, mapZoom) };
    pinnedRef.current = pinned;
  });

  // Show the card in the top layer, place it over the point and start (or reverse) the spring.
  React.useLayoutEffect(() => {
    const popover = popoverRef.current;
    const trigger = triggerRef.current;
    if (!popover || !trigger) return;
    const state = motionRef.current;
    if (open) {
      if (!state.visible) {
        if (supportsPopover(popover) && !popover.matches(":popover-open")) popover.showPopover();
        const reduced = prefersReducedMotion();
        resetMotion(state, reduced);
        state.visible = true;
        state.diveAt = reduced ? -1 : performance.now() + DIVE_DELAY_MS;
        popover.toggleAttribute("data-ready", reduced);
        popover.style.opacity = "0";
        popover.style.transform = reduced ? "none" : `scale(${MIN_SCALE})`;
        placePopover(trigger, popover, pointRef.current, latest.current.side);
      }
      state.card.target = 1;
    } else {
      state.card.target = 0;
    }
    loop.kick();
  }, [open, loop, motionRef]);

  // While the card is out: follow the trigger on scroll and resize, and close when it scrolls out of view.
  React.useEffect(() => {
    if (!shown) return;
    const follow = () => {
      const popover = popoverRef.current;
      const trigger = triggerRef.current;
      if (!popover || !trigger || !motionRef.current.visible) return;
      const rect = trigger.getBoundingClientRect();
      const viewport = document.documentElement;
      if (rect.bottom < 0 || rect.top > viewport.clientHeight || rect.right < 0 || rect.left > viewport.clientWidth) {
        setOpen(false);
        return;
      }
      placePopover(trigger, popover, pointRef.current, latest.current.side);
    };
    window.addEventListener("scroll", follow, { capture: true, passive: true });
    window.addEventListener("resize", follow);
    return () => {
      window.removeEventListener("scroll", follow, { capture: true });
      window.removeEventListener("resize", follow);
    };
  }, [shown, setOpen, motionRef]);

  React.useLayoutEffect(() => {
    const popover = popoverRef.current;
    const trigger = triggerRef.current;
    if (popover && trigger && motionRef.current.visible) placePopover(trigger, popover, pointRef.current, side);
  }, [side, motionRef]);

  // One unpinned popover per page: opening this one closes the others. Escape closes the newest open one.
  React.useEffect(() => {
    if (!open) return;
    const entry: OpenEntry = { close: () => setOpen(false), pinned: () => pinnedRef.current };
    for (const other of [...openEntries]) if (other !== entry && !other.pinned()) other.close();
    openEntries.push(entry);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || openEntries[openEntries.length - 1] !== entry) return;
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const index = openEntries.indexOf(entry);
      if (index >= 0) openEntries.splice(index, 1);
    };
  }, [open, setOpen]);

  // A new place (or zoom) while the card is out: redraw at once and ping the new point.
  const sceneKey = sceneKeyFor(pointLat, pointLon, mapZoom);
  React.useEffect(() => {
    const state = motionRef.current;
    if (!state.visible) return;
    if (state.landed && !prefersReducedMotion()) state.ringStart = performance.now();
    loop.kick();
  }, [sceneKey, loop, motionRef]);

  // Pinning an open card pings the point once more, as a receipt.
  React.useEffect(() => {
    const state = motionRef.current;
    if (!pinned || !state.visible || !state.landed || prefersReducedMotion()) return;
    state.ringStart = performance.now();
    loop.kick();
  }, [pinned, loop, motionRef]);

  // every thumbnail repaints from the shared bake of the new theme
  React.useEffect(() => onThemeChange(() => paintThumbnail(thumbSurface.current)), [thumbSurface]);

  React.useEffect(() => {
    const pending = timers.current;
    return () => {
      window.clearTimeout(pending.open);
      window.clearTimeout(pending.close);
      window.clearTimeout(pending.warm);
    };
  }, []);

  function step(time: number, delta: number) {
    const state = motionRef.current;
    const popover = popoverRef.current;
    if (!popover || !state.visible) return false;
    const now = time * 1000;
    const reduced = prefersReducedMotion();
    const { card, dive } = state;

    if (reduced) {
      // a short fade at full size, the map already zoomed in
      const amount = delta / REDUCED_FADE_SECONDS;
      card.position =
        card.target > card.position
          ? Math.min(card.target, card.position + amount)
          : Math.max(card.target, card.position - amount);
      card.velocity = 0;
      dive.position = 1;
      dive.target = 1;
      dive.velocity = 0;
      state.diveAt = -1;
      state.landed = true;
      state.ringStart = -1;
    } else {
      springStep(card, card.target, delta, card.target > 0 ? CARD_OPEN_STIFFNESS : CARD_CLOSE_STIFFNESS, CARD_DAMPING);
      if (state.diveAt >= 0 && now >= state.diveAt) {
        dive.target = 1;
        state.diveAt = -1;
      }
      springStep(dive, dive.target, delta, DIVE_STIFFNESS, DIVE_DAMPING);
    }

    if (card.target === 0 && card.position < 0.02) {
      // fully shrunk back into the point
      state.visible = false;
      // no stale frame when the card opens again
      const surface = mapSurface.current;
      surface?.context.clearRect(0, 0, surface.width, surface.height);
      if (supportsPopover(popover) && popover.matches(":popover-open")) popover.hidePopover();
      popover.removeAttribute("data-ready");
      popover.style.transform = "";
      popover.style.opacity = "";
      resetMotion(state, reduced);
      setShown(false);
      return false;
    }

    const scale = reduced ? 1 : Math.max(MIN_SCALE, lerp(MIN_SCALE, 1, card.position));
    // keep one transform while the spring rings around 1, so the layer is not re-rastered on every crossing
    const cardSettled = Math.abs(card.position - card.target) < 0.0005 && Math.abs(card.velocity) < 0.002;
    popover.style.transform = scale === 1 || (cardSettled && card.target === 1) ? "none" : `scale(${scale.toFixed(4)})`;
    popover.style.opacity = (reduced ? clamp(card.position, 0, 1) : clamp(card.position / 0.3, 0, 1)).toFixed(3);

    if (!state.revealed && card.target === 1 && (reduced || card.position > 0.6)) {
      state.revealed = true;
      popover.setAttribute("data-ready", "");
    }
    if (!state.landed && dive.target === 1 && dive.position > 0.9) {
      state.landed = true;
      state.ringStart = now;
    }
    const ring = state.ringStart >= 0 ? (now - state.ringStart) / RING_MS : -1;
    if (ring >= 1) state.ringStart = -1;

    const surface = mapSurface.current;
    const palette = colors.current;
    if (surface && palette) {
      const key = latest.current.sceneKey;
      if (!state.scene || state.scene.key !== key) state.scene = sceneFor(pointLat, pointLon, mapZoom);
      if (state.inkPalette !== palette || state.inkTone !== tone || !state.ink) {
        state.ink = mapInk(palette, tone);
        state.inkPalette = palette;
        state.inkTone = tone;
        state.batches?.land.setRamp(state.ink.landRamp);
        state.batches?.ring.setRamp(state.ink.ringRamp);
      }
      state.batches ??= {
        land: createDotBatch(4096, state.ink.landRamp, { tones: 32, levels: 16 }),
        ring: createDotBatch(512, state.ink.ringRamp, { tones: 16, levels: 16 }),
      };
      drawScene(surface, state.scene, state.batches, state.ink, dive.position, state.landed, ring < 1 ? ring : -1);
    }

    const settled =
      Math.abs(card.position - card.target) < 0.0005 &&
      Math.abs(card.velocity) < 0.002 &&
      Math.abs(dive.position - dive.target) < 0.0005 &&
      Math.abs(dive.velocity) < 0.002 &&
      state.diveAt < 0 &&
      state.ringStart < 0;
    return !settled;
  }

  function clearTimers() {
    window.clearTimeout(timers.current.open);
    window.clearTimeout(timers.current.close);
  }

  function requestOpen(delay: number) {
    window.clearTimeout(timers.current.close);
    if (open) return;
    window.clearTimeout(timers.current.open);
    timers.current.open = window.setTimeout(() => setOpen(true), delay);
  }

  /** Builds the zoom levels (a few ms, once per place) while the hover delay runs, not in the first frame. */
  function warmScene() {
    window.clearTimeout(timers.current.warm);
    timers.current.warm = window.setTimeout(() => sceneFor(pointLat, pointLon, mapZoom), 0);
  }

  function requestClose() {
    window.clearTimeout(timers.current.open);
    window.clearTimeout(timers.current.close);
    timers.current.close = window.setTimeout(() => {
      const { trigger, popover, focused } = hover.current;
      if (pinnedRef.current || trigger || popover || focused) return;
      setOpen(false);
    }, CLOSE_DELAY_MS);
  }

  function setPin(next: boolean) {
    pinnedRef.current = next;
    setPinned(next);
  }

  return (
    <>
      <button
        type="button"
        data-slot="geo-mini-map"
        data-state={open ? "open" : "closed"}
        data-size={size}
        data-pinned={pinned ? "" : undefined}
        aria-label={accessibleName}
        aria-expanded={open}
        aria-controls={popoverId}
        aria-pressed={pinned}
        aria-describedby={describedBy}
        disabled={disabled}
        className={cn(
          "group/mini relative inline-flex shrink-0 cursor-pointer overflow-hidden rounded-md border border-border bg-card p-0 align-middle outline-none [-webkit-tap-highlight-color:transparent] [transition:border-color_.2s_ease] hover:border-[color-mix(in_srgb,var(--lumesec)_45%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:border-[color-mix(in_srgb,var(--lumesec)_60%,var(--border))]",
          TONE_CLASSES[tone],
          className,
        )}
        onPointerEnter={(event) => {
          onPointerEnter?.(event);
          // disabled buttons still receive pointer events in current browsers
          if (event.pointerType === "touch" || disabled) return;
          hover.current.trigger = true;
          warmScene();
          requestOpen(OPEN_DELAY_MS);
        }}
        onPointerLeave={(event) => {
          onPointerLeave?.(event);
          if (event.pointerType === "touch") return;
          hover.current.trigger = false;
          requestClose();
        }}
        onFocus={(event) => {
          onFocus?.(event);
          // keyboard focus opens at once; focus from a click or tap is left to the click (pin) and hover
          if (!isFocusVisible(event.currentTarget)) return;
          hover.current.focused = true;
          clearTimers();
          sceneFor(pointLat, pointLon, mapZoom);
          setOpen(true);
        }}
        onBlur={(event) => {
          onBlur?.(event);
          hover.current.focused = false;
          requestClose();
        }}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          clearTimers();
          if (pinnedRef.current) {
            setPin(false);
            setOpen(false);
          } else {
            setPin(true);
            setOpen(true);
          }
        }}
        ref={setTriggerRef}
        {...props}
      >
        <canvas
          ref={thumbRef}
          aria-hidden="true"
          className={cn(
            "block opacity-0 [transition:opacity_.3s_ease] data-[drawn]:opacity-100 motion-reduce:transition-none",
            THUMB_CLASSES[size],
          )}
        />
        {thumbPoint && (
          <span
            ref={pointRef}
            aria-hidden="true"
            className="pointer-events-none absolute size-[3px] bg-[var(--geo-mini-tone)] shadow-[0_0_0_1px_var(--card),0_0_0_2px_color-mix(in_srgb,var(--geo-mini-tone)_30%,transparent)] [transition:box-shadow_.3s_ease] group-data-[state=open]/mini:shadow-[0_0_0_1px_var(--card),0_0_0_4px_color-mix(in_srgb,var(--geo-mini-tone)_32%,transparent)]"
            style={{ left: thumbPoint.left, top: thumbPoint.top }}
          >
            <span className="absolute top-px left-px size-px bg-lumesec-glint" />
          </span>
        )}
      </button>
      <span
        ref={popoverRef}
        id={popoverId}
        popover="manual"
        hidden={!shown}
        data-slot="geo-mini-map-popover"
        data-pinned={pinned ? "" : undefined}
        className="group/popover fixed inset-auto z-50 m-0 w-[248px] cursor-default overflow-hidden rounded-xl border border-border bg-popover p-0 text-left font-sans text-[13px] leading-normal font-normal tracking-normal whitespace-normal text-popover-foreground normal-case opacity-0 shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)]"
        onPointerEnter={(event) => {
          if (event.pointerType === "touch") return;
          hover.current.popover = true;
          window.clearTimeout(timers.current.close);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "touch") return;
          hover.current.popover = false;
          requestClose();
        }}
        onPointerDown={() => {
          // pressing inside (to select the coordinates, say) keeps the card open
          if (!pinnedRef.current) setPin(true);
        }}
        // the card sits next to the button in the DOM: keep its clicks away from row handlers around it
        onClick={(event) => event.stopPropagation()}
      >
        <span className="relative block h-[120px] border-b border-border">
          <canvas ref={mapRef} aria-hidden="true" className="block h-[120px] w-[246px]" />
          {scaleBar && (
            <span
              aria-hidden="true"
              className="absolute bottom-1.5 left-1.5 flex flex-col items-start gap-[3px] rounded-[5px] bg-[color-mix(in_srgb,var(--popover)_86%,transparent)] px-1.5 pt-1 pb-1.5 opacity-0 [transition:opacity_.3s_ease_.12s] group-data-[ready]/popover:opacity-100 motion-reduce:transition-none"
            >
              <span className="font-mono text-[10px] leading-none text-muted-foreground tabular-nums">
                {scaleBar.label}
              </span>
              <span
                className="block h-[4px] border-x border-b border-[color-mix(in_srgb,var(--foreground)_45%,transparent)]"
                style={{ width: scaleBar.width }}
              />
            </span>
          )}
          <span
            aria-hidden="true"
            className="absolute top-2 right-2 flex h-5 scale-90 items-center gap-1 rounded-md border border-border bg-popover px-1.5 text-[11px] leading-none font-medium text-foreground opacity-0 [transition:opacity_.18s_ease,transform_.3s_cubic-bezier(.2,1.4,.4,1)] group-data-[pinned]/popover:scale-100 group-data-[pinned]/popover:opacity-100 motion-reduce:transition-none"
          >
            <svg
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-3 text-lumesec"
            >
              <path d="M7.6 1.6 10.4 4.4 8.6 5.2 6.8 7 7 9 3 5 5 5.2 6.8 3.4z" />
              <path d="M4.6 7.4 1.8 10.2" />
            </svg>
            Pinned
          </span>
        </span>
        <span className="block px-3 pt-2.5 pb-3">
          {title && (
            <span className={cn(ROW_CLASS, "truncate text-[13px] leading-5 font-medium text-popover-foreground")}>
              {title}
            </span>
          )}
          {detail && (
            <span
              id={detailId}
              className={cn(ROW_CLASS, "truncate text-[12px] leading-4 text-muted-foreground [transition-delay:35ms]")}
            >
              {detail}
            </span>
          )}
          <span
            className={cn(
              ROW_CLASS,
              "mt-1 font-mono text-[12px] leading-4 text-muted-foreground tabular-nums [transition-delay:70ms]",
            )}
          >
            <RollText text={coordinates} />
          </span>
          {(zone || distance !== null) && (
            <span
              id={readoutId}
              className={cn(ROW_CLASS, "mt-2.5 grid gap-1.5 border-t border-border pt-2.5 [transition-delay:105ms]")}
            >
              {zone && (
                <span className="flex items-baseline justify-between gap-3 text-[12px] leading-4">
                  <span className="text-muted-foreground">Local time</span>
                  <span className="flex items-baseline gap-1.5 font-mono tabular-nums">
                    <RollText text={localTime ?? "--:--"} className="text-popover-foreground" />
                    {utcOffset && <span className="text-muted-foreground">{utcOffset}</span>}
                  </span>
                </span>
              )}
              {distance !== null && (
                <span className="flex items-baseline justify-between gap-3 text-[12px] leading-4">
                  <span className="min-w-0 truncate text-muted-foreground">{fromLabel}</span>
                  <RollText
                    text={formatDistance(distance, unit)}
                    className="shrink-0 font-mono text-popover-foreground tabular-nums"
                  />
                </span>
              )}
            </span>
          )}
        </span>
      </span>
    </>
  );
}

/* Constants ------------------------------------------------------------------------------------------- */

const DEMO_LOCATION: MiniMapLocation = {
  lat: 1.3521,
  lon: 103.8198,
  label: "Singapore",
  detail: "Sign-in from 203.0.113.24",
  timeZone: "Asia/Singapore",
};

const THUMB_SIZES: Record<GeoMiniMapSize, readonly [width: number, height: number]> = {
  sm: [72, 36],
  md: [96, 48],
  lg: [128, 64],
};

const THUMB_CLASSES: Record<GeoMiniMapSize, string> = {
  sm: "h-[36px] w-[72px]",
  md: "h-[48px] w-[96px]",
  lg: "h-[64px] w-[128px]",
};

/** The point's colour as a custom property, so the dot and its glow share it. */
const TONE_CLASSES: Record<GeoMiniMapTone, string> = {
  accent: "[--geo-mini-tone:var(--lumesec)]",
  info: "[--geo-mini-tone:var(--lumesec-info)]",
  success: "[--geo-mini-tone:var(--lumesec-success)]",
  warning: "[--geo-mini-tone:var(--lumesec-warning)]",
  destructive: "[--geo-mini-tone:var(--destructive)]",
};

/** Text rows fade in and rise 4 px once the card has mostly grown; each row adds its own delay. */
const ROW_CLASS =
  "block translate-y-1 opacity-0 [transition:opacity_.22s_ease,transform_.36s_cubic-bezier(.2,.8,.2,1)] group-data-[ready]/popover:translate-y-0 group-data-[ready]/popover:opacity-100 motion-reduce:translate-y-0 motion-reduce:transition-none";

const MAP_TOKENS = { ...GEO_TOKENS, popover: ["--popover", "#ffffff"] } as const satisfies Record<string, ColorToken>;
type MapPalette = Palette<keyof typeof MAP_TOKENS>;

const TONE_TOKENS: Record<GeoMiniMapTone, keyof typeof MAP_TOKENS> = {
  accent: "accent",
  info: "info",
  success: "success",
  warning: "warning",
  destructive: "destructive",
};

/** The popover map inside the card's 1 px border. */
const MAP_WIDTH = 246;
const MAP_HEIGHT = 120;
const MAP_PITCH = 4;
const MAP_COVERAGE = 0.3;
const THUMB_PITCH = 3;
const THUMB_COVERAGE = 0.3;
/** Consecutive zoom levels differ by at most this factor, so dots never get much denser or sparser than 2:1. */
const LEVEL_RATIO = 2.5;

const OPEN_DELAY_MS = 120;
const CLOSE_DELAY_MS = 150;
const GAP = 8;
const EDGE = 8;
const MIN_SCALE = 0.04;
const CARD_OPEN_STIFFNESS = 380;
const CARD_CLOSE_STIFFNESS = 520;
const CARD_DAMPING = 0.78;
/** The dive starts a beat after the card, so the world view is seen before the camera moves. */
const DIVE_DELAY_MS = 70;
const DIVE_STIFFNESS = 85;
const DIVE_DAMPING = 0.84;
const REDUCED_FADE_SECONDS = 0.12;
const RING_MS = 600;
const RING_RADIUS = 46;
const RING_WIDTH = 5;
const HALO_RADIUS = 12;
const COAST_WIDTH = 0.75;
/** The resolution front: reach a little past the far corner, soften each dot over 7 %, light a band 3.5 % wide. */
const FRONT_OVERSHOOT = 1.12;
const FRONT_SOFTNESS = 0.07;
const FRONT_BAND = 0.035;

/* Motion state ------------------------------------------------------------------------------------------ */

interface TargetSpring extends Spring {
  /** Where the spring settles. */
  target: number;
}

interface MapBatches {
  land: DotBatch;
  ring: DotBatch;
}

/** Everything the animation loop mutates. Lives in a ref, never in React state. */
interface PopoverMotion {
  /** The card's growth: scale 0.04 → 1 and the opening fade. */
  card: TargetSpring;
  /** The dive: 0 is the world view, 1 the full zoom (logarithmic). */
  dive: TargetSpring;
  /** When the dive starts (ms), or -1. */
  diveAt: number;
  /** The point has landed: 4 px marker and halo. */
  landed: boolean;
  /** Start of the ring ping (ms), or -1. */
  ringStart: number;
  /** The text rows are showing. */
  revealed: boolean;
  /** The card is in the top layer (from the first open frame until it has shrunk away). */
  visible: boolean;
  scene: MapScene | null;
  ink: MapInk | null;
  inkPalette: MapPalette | null;
  inkTone: GeoMiniMapTone | null;
  batches: MapBatches | null;
}

function createMotion(): PopoverMotion {
  return {
    card: { position: 0, velocity: 0, target: 0 },
    dive: { position: 0, velocity: 0, target: 0 },
    diveAt: -1,
    landed: false,
    ringStart: -1,
    revealed: false,
    visible: false,
    scene: null,
    ink: null,
    inkPalette: null,
    inkTone: null,
    batches: null,
  };
}

/** Back to the closed state; with reduced motion the next opening starts zoomed in. */
function resetMotion(state: PopoverMotion, reduced: boolean) {
  state.card.position = 0;
  state.card.velocity = 0;
  state.dive.position = reduced ? 1 : 0;
  state.dive.velocity = 0;
  state.dive.target = reduced ? 1 : 0;
  state.diveAt = -1;
  state.landed = reduced;
  state.ringStart = -1;
  state.revealed = reduced;
}

/* Open popovers -------------------------------------------------------------------------------------------- */

interface OpenEntry {
  close: () => void;
  pinned: () => boolean;
}

/** Every open card on the page, oldest first. */
const openEntries: OpenEntry[] = [];

function supportsPopover(element: HTMLElement) {
  return typeof element.showPopover === "function";
}

/** Whether focus came from the keyboard; browsers without `:focus-visible` count every focus. */
function isFocusVisible(element: Element) {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
}

/**
 * Places the card with fixed coordinates: centred over the point, above it unless it does not fit there (`auto`), and
 * 8 px inside the viewport. The transform origin is the point, so the card grows out of it.
 */
function placePopover(trigger: HTMLElement, popover: HTMLElement, anchor: HTMLElement | null, side: GeoMiniMapSide) {
  const triggerRect = trigger.getBoundingClientRect();
  const anchorRect = (anchor ?? trigger).getBoundingClientRect();
  const anchorX = anchorRect.left + anchorRect.width / 2;
  const anchorY = anchorRect.top + anchorRect.height / 2;
  // measure at full size, whatever the running animation has scaled it to
  const transform = popover.style.transform;
  popover.style.transform = "none";
  const box = popover.getBoundingClientRect();
  popover.style.transform = transform;
  // CSS zoom on an ancestor scales the card; its own lengths are in unzoomed pixels
  const zoom = popover.offsetWidth > 0 && box.width > 0 ? box.width / popover.offsetWidth : 1;
  const viewport = document.documentElement;
  const spaceAbove = triggerRect.top - GAP - EDGE;
  const spaceBelow = viewport.clientHeight - triggerRect.bottom - GAP - EDGE;
  const above = side === "top" || (side === "auto" && (spaceAbove >= box.height || spaceAbove >= spaceBelow));
  const left = clamp(anchorX - box.width / 2, EDGE, Math.max(EDGE, viewport.clientWidth - EDGE - box.width));
  const top = clamp(
    above ? triggerRect.top - GAP - box.height : triggerRect.bottom + GAP,
    EDGE,
    Math.max(EDGE, viewport.clientHeight - EDGE - box.height),
  );
  popover.style.left = `${(left / zoom).toFixed(2)}px`;
  popover.style.top = `${(top / zoom).toFixed(2)}px`;
  popover.style.transformOrigin = `${((anchorX - left) / zoom).toFixed(2)}px ${((anchorY - top) / zoom).toFixed(2)}px`;
  popover.setAttribute("data-side", above ? "top" : "bottom");
}

/* Geometry and text ------------------------------------------------------------------------------------- */

/** The location as a point (longitude wrapped), or null when it is not a real position. */
function validPoint(location: MiniMapLocation): LatLon | null {
  if (!isValidLatLon(location)) return null;
  return { lat: location.lat, lon: wrapLongitude(location.lon) };
}

/** The thumbnail's world, inset 2 px so no dot touches the border. */
function thumbnailProjection(width: number, height: number) {
  return createProjection("equirectangular", { width, height, latRange: MAP_LAT_RANGE, padding: 2 });
}

/** Top-left of the 3 px point on the thumbnail, in whole pixels so it stays crisp; kept inside the box. */
function thumbnailPoint(lat: number, lon: number, width: number, height: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const projection = thumbnailProjection(width, height);
  const out = createScreenPoint();
  projection.project(lat, lon, out);
  return {
    left: Math.round(clamp(out.x, 2, width - 2) - 1.5),
    top: Math.round(clamp(out.y, 2, height - 2) - 1.5),
  };
}

/** A 1-2-5 scale bar for the zoomed map at the point's latitude, at most 64 px long. */
function scaleBarFor(lat: number, zoom: number, unit: "km" | "mi") {
  if (!Number.isFinite(lat)) return null;
  const projection = createProjection("equirectangular", {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    latRange: MAP_LAT_RANGE,
    zoom,
  });
  const kmPerDegree = 111.195 * Math.cos(clamp(lat, -80, 80) * DEG);
  const pxPerKm = (projection.scale * DEG) / kmPerDegree;
  const pxPerUnit = unit === "mi" ? pxPerKm * 1.609344 : pxPerKm;
  const most = 64 / pxPerUnit;
  const base = 10 ** Math.floor(Math.log10(most));
  const length = [5, 2, 1].map((m) => m * base).find((value) => value <= most) ?? base;
  return { width: Math.round(length * pxPerUnit), label: `${formatNumber(length)} ${unit}` };
}

/* Thumbnail bake ------------------------------------------------------------------------------------------ */

/** Baked thumbnails shared by every instance, keyed by size, pixel ratio and land colour. */
const thumbnailBakes = new Map<string, HTMLCanvasElement>();

/** Paints a thumbnail canvas from the shared bake of its size, pixel ratio and theme. */
function paintThumbnail(surface: CanvasSurface | null) {
  if (!surface) return;
  const { canvas, context, dpr } = surface;
  // the thumbnail's land is a touch stronger than the map lattice, since its dots are fewer and smaller
  const color = mixRgb(
    readColor(canvas, "--muted-foreground", "#71717b"),
    readColor(canvas, "--card", "#ffffff"),
    0.22,
  );
  const bake = thumbnailBake(surface.width, surface.height, dpr, color);
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (bake) context.drawImage(bake, 0, 0);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  canvas.setAttribute("data-drawn", "");
}

function thumbnailBake(width: number, height: number, dpr: number, color: RGB) {
  const key = `${width}x${height}@${dpr}|${rgba(color)}`;
  const cached = thumbnailBakes.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const context = canvas.getContext("2d");
  if (!context) return null;
  const lattice = mapLattice(thumbnailProjection(width, height), {
    pitch: THUMB_PITCH,
    minCoverage: THUMB_COVERAGE,
    // staggered rows keep the continents' outlines at 30 columns
    layout: "honeycomb",
  });
  // squares on whole device pixels, so a 96 px map of 1.5 px dots stays sharp at any ratio
  const size = Math.max(1, Math.round(1.5 * dpr));
  context.fillStyle = rgba(color);
  for (let i = 0; i < lattice.count; i++) {
    context.fillRect(Math.round(lattice.x[i] * dpr - size / 2), Math.round(lattice.y[i] * dpr - size / 2), size, size);
  }
  if (thumbnailBakes.size >= 12) thumbnailBakes.clear();
  thumbnailBakes.set(key, canvas);
  return canvas;
}

/* Popover map scene ------------------------------------------------------------------------------------- */

/** One zoom level of the popover map: a land lattice built at its own zoom, drawn scaled to the current one. */
interface SceneLevel {
  readonly zoom: number;
  readonly lattice: DotLattice;
  /** Where the location sits in the lattice's own coordinates. */
  readonly anchorX: number;
  readonly anchorY: number;
  /** 1 for dots inside the location's country (final level only). */
  readonly strong: Uint8Array | null;
}

/** Grid positions around the point at the final zoom, land or not, for the ring ping and the halo. */
interface RingGrid {
  readonly count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly jitter: Float32Array;
}

interface MapScene {
  readonly key: string;
  /** The final zoom (1 when there is no point). */
  readonly zoom: number;
  /** The location on the world view (zoom 1). */
  readonly worldX: number;
  readonly worldY: number;
  readonly levels: readonly SceneLevel[];
  readonly grid: RingGrid;
  readonly hasPoint: boolean;
  /** Coastlines in the final level's coordinates, and the box of its latitude crop to clip them to. */
  readonly coast: Path2D;
  readonly frame: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
}

const EMPTY_GRID: RingGrid = { count: 0, x: new Float32Array(0), y: new Float32Array(0), jitter: new Float32Array(0) };

const scenes = new Map<string, MapScene>();

function sceneKeyFor(lat: number, lon: number, zoom: number) {
  return Number.isFinite(lat) && Number.isFinite(lon) ? `${lat.toFixed(4)},${lon.toFixed(4)}|${zoom}` : `none|${zoom}`;
}

/** The scene of a location, built on first use (a few ms) and cached for the page. */
function sceneFor(lat: number, lon: number, zoom: number): MapScene {
  const key = sceneKeyFor(lat, lon, zoom);
  const cached = scenes.get(key);
  if (cached) return cached;
  const scene = buildScene(key, Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null, zoom);
  if (scenes.size >= 32) scenes.delete(scenes.keys().next().value ?? "");
  scenes.set(key, scene);
  return scene;
}

/**
 * The levels of the dive: the world at zoom 1, then lattices focused on the point at zooms spaced by at most 2.5×
 * (1, 2, 4 for zoom 4). Each focused level covers what the canvas shows of it while it is on screen, so the front
 * never reveals an empty patch.
 */
function buildScene(key: string, point: LatLon | null, zoom: number): MapScene {
  const width = MAP_WIDTH;
  const height = MAP_HEIGHT;
  const world = createProjection("equirectangular", { width, height, latRange: MAP_LAT_RANGE });
  const worldLattice = mapLattice(world, { pitch: MAP_PITCH, minCoverage: MAP_COVERAGE });
  if (!point) {
    return {
      key,
      zoom: 1,
      worldX: width / 2,
      worldY: height / 2,
      levels: [{ zoom: 1, lattice: worldLattice, anchorX: width / 2, anchorY: height / 2, strong: null }],
      grid: EMPTY_GRID,
      hasPoint: false,
      coast: coastlinePath(world),
      frame: world.frame,
    };
  }
  const at = createScreenPoint();
  world.project(point.lat, point.lon, at);
  const worldX = at.x;
  const worldY = at.y;
  const steps = Math.max(1, Math.ceil(Math.log(zoom) / Math.log(LEVEL_RATIO)));
  const zooms = Array.from({ length: steps + 1 }, (_, k) => zoom ** (k / steps));
  const levels: SceneLevel[] = [{ zoom: 1, lattice: worldLattice, anchorX: worldX, anchorY: worldY, strong: null }];
  const country = countryAt(point.lat, point.lon);
  let finalProjection = world;
  for (let k = 1; k <= steps; k++) {
    const projection = createProjection("equirectangular", {
      width,
      height,
      latRange: MAP_LAT_RANGE,
      zoom: zooms[k],
      focus: point,
    });
    const lattice = mapLattice(projection, {
      pitch: MAP_PITCH,
      minCoverage: MAP_COVERAGE,
      viewport: levelViewport(zooms, k, zoom, worldX, worldY),
    });
    const last = k === steps;
    const strong = last && country ? countryDots(lattice, country.code) : null;
    levels.push({ zoom: zooms[k], lattice, anchorX: width / 2, anchorY: height / 2, strong });
    if (last) finalProjection = projection;
  }
  return {
    key,
    zoom,
    worldX,
    worldY,
    levels,
    grid: ringGrid(finalProjection),
    hasPoint: true,
    coast: coastlinePath(finalProjection),
    frame: finalProjection.frame,
  };
}

/** 1 for each lattice dot inside one country (outer rings minus holes), with a bounding-box test first. */
function countryDots(lattice: DotLattice, code: string): Uint8Array {
  const inside = new Uint8Array(lattice.count);
  const box = countryBounds(code);
  const polygons = countryShape(code);
  if (!box) return inside;
  for (let i = 0; i < lattice.count; i++) {
    const lat = lattice.lat[i];
    const lon = lattice.lon[i];
    if (!boundsContains(box, lat, lon)) continue;
    for (const polygon of polygons) {
      if (!pointInRing(lat, lon, polygon[0]) || polygon.slice(1).some((hole) => pointInRing(lat, lon, hole))) continue;
      inside[i] = 1;
      break;
    }
  }
  return inside;
}

/**
 * The box of level k's own coordinates that the canvas shows while the level is drawn: from the previous level's zoom
 * (fading in) to the next one's (fading out), with the camera path of drawScene. Sampled, plus a margin.
 */
function levelViewport(zooms: readonly number[], k: number, zoom: number, worldX: number, worldY: number) {
  const from = zooms[k - 1];
  const to = k < zooms.length - 1 ? zooms[k + 1] : zoom * 1.1;
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (let i = 0; i <= 16; i++) {
    const z = from * (to / from) ** (i / 16);
    const t = (z - 1) / (zoom - 1);
    const cameraX = lerp(worldX, MAP_WIDTH / 2, t);
    const cameraY = lerp(worldY, MAP_HEIGHT / 2, t);
    const factor = zooms[k] / z;
    box.x0 = Math.min(box.x0, MAP_WIDTH / 2 - cameraX * factor);
    box.x1 = Math.max(box.x1, MAP_WIDTH / 2 + (MAP_WIDTH - cameraX) * factor);
    box.y0 = Math.min(box.y0, MAP_HEIGHT / 2 - cameraY * factor);
    box.y1 = Math.max(box.y1, MAP_HEIGHT / 2 + (MAP_HEIGHT - cameraY) * factor);
  }
  const margin = MAP_PITCH * 2;
  return { x0: box.x0 - margin, y0: box.y0 - margin, x1: box.x1 + margin, y1: box.y1 + margin };
}

/** The final lattice's grid positions (land or water) within reach of the ring, with a stable jitter each. */
function ringGrid(projection: ReturnType<typeof createProjection>): RingGrid {
  const { frame } = projection;
  const cx = MAP_WIDTH / 2;
  const cy = MAP_HEIGHT / 2;
  const reach = RING_RADIUS + RING_WIDTH * 3;
  const firstColumn = Math.floor((cx - reach - frame.x0) / MAP_PITCH - 0.5);
  const lastColumn = Math.ceil((cx + reach - frame.x0) / MAP_PITCH - 0.5);
  const firstRow = Math.floor((cy - reach - frame.y0) / MAP_PITCH - 0.5);
  const lastRow = Math.ceil((cy + reach - frame.y0) / MAP_PITCH - 0.5);
  const xs: number[] = [];
  const ys: number[] = [];
  const jitters: number[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    for (let column = firstColumn; column <= lastColumn; column++) {
      const x = frame.x0 + (column + 0.5) * MAP_PITCH;
      const y = frame.y0 + (row + 0.5) * MAP_PITCH;
      if (Math.hypot(x - cx, y - cy) > reach) continue;
      xs.push(x);
      ys.push(y);
      jitters.push(hash(column * 31 + row * 7 + 3));
    }
  }
  return { count: xs.length, x: Float32Array.from(xs), y: Float32Array.from(ys), jitter: Float32Array.from(jitters) };
}

/** Drawing colours of the popover map. */
interface MapInk {
  /** strong land (the location's country), land, accent, glint: tones 0, 1/3, 2/3 and 1. */
  landRamp: RGB[];
  /** The point's tone toward the glint, for the ring crest. */
  ringRamp: RGB[];
  tone: RGB;
  glint: RGB;
  surface: RGB;
  /** Hairline coastline: the foreground at low alpha. */
  coast: string;
}

function mapInk(palette: MapPalette, tone: GeoMiniMapTone): MapInk {
  const ink = geoInk(palette);
  const strong = mixRgb(ink.land, ink.landStrong, 0.8);
  const toneColor = palette[TONE_TOKENS[tone]];
  return {
    landRamp: [strong, ink.land, ink.accent, ink.glint],
    ringRamp: [toneColor, ink.glint],
    tone: toneColor,
    glint: ink.glint,
    surface: palette.popover,
    coast: rgba(palette.foreground, palette.dark ? 0.26 : 0.22),
  };
}

/**
 * One frame of the popover map. The camera zooms (logarithmically in `dive`) about the fixed point that carries the
 * location from its world position to the centre. Each level is drawn scaled from its own zoom: while the camera
 * passes from one level to the next, the finer dots appear outward from the point behind an uneven front (fresh dots
 * flash through the accent) and the coarser ones give way behind it. Then the ring ping, the halo and the marker.
 */
function drawScene(
  surface: CanvasSurface,
  scene: MapScene,
  batches: MapBatches,
  ink: MapInk,
  dive: number,
  landed: boolean,
  ring: number,
) {
  const { context, dpr } = surface;
  const width = MAP_WIDTH;
  const height = MAP_HEIGHT;
  context.clearRect(0, 0, surface.width, surface.height);
  context.save();
  if (surface.width !== width || surface.height !== height)
    context.scale(surface.width / width, surface.height / height);

  const z = scene.zoom > 1 ? scene.zoom ** clamp(dive, 0, 1.15) : 1;
  const t = scene.zoom > 1 ? (z - 1) / (scene.zoom - 1) : 0;
  const cameraX = lerp(scene.worldX, width / 2, t);
  const cameraY = lerp(scene.worldY, height / 2, t);
  const reach = Math.max(
    Math.hypot(cameraX, cameraY),
    Math.hypot(width - cameraX, cameraY),
    Math.hypot(cameraX, height - cameraY),
    Math.hypot(width - cameraX, height - cameraY),
  );
  const logZ = Math.log(z);
  const { levels } = scene;
  const last = levels.length - 1;

  for (let k = 0; k <= last; k++) {
    const level = levels[k];
    const previous = k > 0 ? levels[k - 1].zoom : 0;
    const next = k < last ? levels[k + 1].zoom : Infinity;
    if (z <= previous || z >= next) continue;
    const fadeIn =
      k > 0 && z < level.zoom ? (logZ - Math.log(previous)) / (Math.log(level.zoom) - Math.log(previous)) : -1;
    const fadeOut =
      k < last && z > level.zoom ? (logZ - Math.log(level.zoom)) / (Math.log(next) - Math.log(level.zoom)) : -1;
    const factor = z / level.zoom;
    const size = snapSize(clamp(level.lattice.pitch * factor * 0.5, 1, 2), dpr);
    // one bright sweep: only the final level lights up as it resolves
    const sweep = k === last && fadeIn >= 0;
    const { lattice } = level;
    for (let i = 0; i < lattice.count; i++) {
      const x = cameraX + (lattice.x[i] - level.anchorX) * factor;
      if (x < -2 || x > width + 2) continue;
      const y = cameraY + (lattice.y[i] - level.anchorY) * factor;
      if (y < -2 || y > height + 2) continue;
      let alpha = 1;
      let flash = 0;
      if (fadeIn >= 0 || fadeOut >= 0) {
        // procedural reveal: near dots first, with jitter so the front is uneven
        const n = Math.hypot(x - cameraX, y - cameraY) / reach;
        const threshold = n * 0.82 + lattice.jitter[i] * 0.18;
        const front = fadeIn >= 0 ? fadeIn * FRONT_OVERSHOOT - threshold : threshold - fadeOut * FRONT_OVERSHOOT;
        if (front <= 0) continue;
        alpha = Math.min(1, front / FRONT_SOFTNESS);
        if (sweep) {
          // a thin band around the even front; the jittered reveal breaks it up
          const band = (fadeIn * FRONT_OVERSHOOT - n * 0.82 - 0.09) / FRONT_BAND;
          flash = Math.exp(-band * band);
        }
      }
      const base = level.strong && level.strong[i] ? 0 : 1 / 3;
      // tone 2/3 is the accent: the sweep never goes past it
      batches.land.add(snapCenter(x, size, dpr), snapCenter(y, size, dpr), size, base + (2 / 3 - base) * flash, alpha);
    }
  }
  batches.land.flush(context);

  // the coastline comes in with the final level, so the shape of a coast or an island reads at full zoom
  const final = levels[last];
  const previousZoom = last > 0 ? levels[last - 1].zoom : 1;
  const resolved =
    last === 0 || z >= final.zoom
      ? 1
      : clamp((logZ - Math.log(previousZoom)) / (Math.log(final.zoom) - Math.log(previousZoom)), 0, 1);
  const coastAlpha = smoothstep(0.35, 1, resolved);
  if (coastAlpha > 0.01) {
    const factor = z / final.zoom;
    context.save();
    context.translate(cameraX, cameraY);
    context.scale(factor, factor);
    context.translate(-final.anchorX, -final.anchorY);
    const { frame } = scene;
    context.beginPath();
    context.rect(frame.x0, frame.y0, frame.x1 - frame.x0, frame.y1 - frame.y0);
    context.clip();
    context.globalAlpha = coastAlpha;
    context.strokeStyle = ink.coast;
    context.lineWidth = COAST_WIDTH / factor;
    context.lineJoin = "round";
    context.stroke(scene.coast);
    context.restore();
  }

  if (scene.hasPoint) {
    const factor = z / final.zoom;
    const { grid } = scene;
    const ringRadius = easeOutCubic(Math.max(0, ring)) * RING_RADIUS;
    const ringFade = ring >= 0 ? (1 - ring) ** 1.2 : 0;
    const size = snapSize(2, dpr);
    if (ringFade > 0 || landed) {
      for (let i = 0; i < grid.count; i++) {
        const x = cameraX + (grid.x[i] - final.anchorX) * factor;
        const y = cameraY + (grid.y[i] - final.anchorY) * factor;
        const distance = Math.hypot(x - cameraX, y - cameraY);
        const wave = ringFade > 0 ? ringFront(distance, ringRadius, RING_WIDTH, grid.jitter[i], 6) * ringFade : 0;
        const halo = landed ? clamp(1 - distance / HALO_RADIUS, 0, 1) ** 0.8 * 0.85 : 0;
        const value = Math.max(wave, halo);
        if (value < 0.06) continue;
        // the crest starts at the glint and cools to the tone as the ring spreads
        batches.ring.add(
          snapCenter(x, size, dpr),
          snapCenter(y, size, dpr),
          size,
          wave * (1 - Math.max(0, ring)) ** 1.5,
          value,
        );
      }
      batches.ring.flush(context);
    }

    // the marker: a knockout in the card colour, the tone square and its glint centre
    const marker = snapSize(landed ? 4 : 3, dpr);
    const left = Math.round((cameraX - marker / 2) * dpr) / dpr;
    const top = Math.round((cameraY - marker / 2) * dpr) / dpr;
    const outline = 1;
    context.fillStyle = rgba(ink.surface);
    context.fillRect(left - outline, top - outline, marker + outline * 2, marker + outline * 2);
    context.fillStyle = rgba(ink.tone);
    context.fillRect(left, top, marker, marker);
    const centre = snapSize(1, dpr);
    const inset = Math.round(((marker - centre) / 2) * dpr) / dpr;
    context.fillStyle = rgba(ink.glint);
    context.fillRect(left + inset, top + inset, centre, centre);
  }
  context.restore();
}
