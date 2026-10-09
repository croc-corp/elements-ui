"use client";

import * as React from "react";

import { fillSquare, localPoint, useCanvas, type CanvasSurface } from "@/lib/lumesec/canvas";
import { usePalette } from "@/lib/lumesec/color";
import { fuzzyMatch, FuzzyHighlight } from "@/lib/lumesec/fuzzy";
import {
  createProjection,
  DEG,
  distanceKm,
  GEO_TOKENS,
  geoInk,
  isValidLatLon,
  mapLattice,
  nearestLocation,
  projectionAspect,
  ringFront,
  wrapLongitude,
  type DotLattice,
  type GeoInk,
  type LatLon,
} from "@/lib/lumesec/geo";
import { DEMO_CITIES, formatCoordinate, formatDistance, formatLatLon, parseCoordinates } from "@/lib/lumesec/geo-data";
import { clamp, lerp, percent, rgba, smoothstep, TAU } from "@/lib/lumesec/math";
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

/** A point in degrees, `{ lat, lon }`, re-exported from the geo module. */
export type { LatLon } from "@/lib/lumesec/geo";

/** A place the search finds and the pin can snap to. */
export interface PickerPlace {
  /** Unique id. */
  readonly id: string;
  /** Name shown in the search results and under the map ('Lagos'). */
  readonly label: string;
  /** Latitude in degrees. */
  readonly lat: number;
  /** Longitude in degrees. */
  readonly lon: number;
}

/** Props of `GeoLocationPicker`; the remaining `div` props go to the root. */
export interface GeoLocationPickerProps extends Omit<React.ComponentProps<"div">, "defaultValue"> {
  /** Pin position (controlled). Use with `onValueChange`. `null` shows no pin. */
  value?: LatLon | null;
  /** Pin position when uncontrolled. A form reset restores it. */
  defaultValue?: LatLon | null;
  /** Called when the pin moves or is cleared. */
  onValueChange?: (value: LatLon | null) => void;
  /**
   * Places for the search and for snapping: `{ id, label, lat, lon }`. Without it the 60 demo cities are used. An
   * empty array leaves the search with coordinates only.
   */
  places?: readonly PickerPlace[];
  /** Snaps a pin dropped on the map to the nearest place within this many km. `false` turns snapping off. */
  snap?: number | false;
  /** Largest map zoom, from 1 to 6. */
  maxZoom?: number;
  /** Decimals of the latitude and longitude, from 0 to 6. Picked and typed values are rounded to it. */
  precision?: number;
  /** Form field name. With a name and a pin, hidden inputs submit the coordinates. */
  name?: string;
  /** Submit `name-lat` and `name-lon`, or one `name` field with 'lat,lon'. */
  submitAs?: "fields" | "pair";
  /** Blocks form submission while there is no pin. */
  required?: boolean;
  /** Dims the picker and ignores the pointer and the keyboard. */
  disabled?: boolean;
  /** Accessible name of the group. */
  label?: string;
}

/**
 * Choose a point on a dot map. Click or tap to drop the pin, search a place or paste coordinates, or type exact values
 * into the latitude and longitude fields.
 *
 * The pin falls on a bouncy spring and lands with a splash: the land dots around it are pushed outward in an uneven
 * ring, like water, brighten on the front and settle, and a small lit pool stays under the pin. The coordinates roll
 * to the new values in the direction of change. A search pick flies the map there and zooms in, so the pin can be
 * placed precisely; dragging pans the zoomed map.
 *
 * @example
 * <GeoLocationPicker name="site" snap={25} onValueChange={(point) => console.log(point)} />
 */
export function GeoLocationPicker({
  value,
  defaultValue = null,
  onValueChange,
  places,
  snap = false,
  maxZoom = 4,
  precision = 4,
  name,
  submitAs = "fields",
  required = false,
  disabled = false,
  label = "Location",
  ref,
  className,
  ...props
}: GeoLocationPickerProps) {
  const list = places ?? DEMO_PLACES;
  const digits = clamp(Math.round(Number.isFinite(precision) ? precision : 4), 0, 6);
  const zoomLimit = clamp(Number.isFinite(maxZoom) ? maxZoom : 4, 1, 6);
  const snapKm = typeof snap === "number" && snap > 0 ? snap : 0;
  const flyZoom = Math.min(FLY_ZOOM, zoomLimit);

  const [rawValue, setValue] = useControllableState<LatLon | null>({ value, defaultValue, onChange: onValueChange });
  const pin = validPoint(rawValue);
  const pinLat = pin ? pin.lat : null;
  const pinLon = pin ? pin.lon : null;

  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const [zoomLevel, setZoomLevel] = React.useState(1);
  const [dragging, setDragging] = React.useState(false);
  /** The last snapped drop: which place it snapped to and how far from it the press was. */
  const [snapped, setSnapped] = React.useState<{ id: string; km: number } | null>(null);
  /** Text being typed into one of the coordinate fields, while it has focus. */
  const [draft, setDraft] = React.useState<{ axis: Axis; text: string } | null>(null);
  const [invalid, setInvalid] = React.useState(false);
  // The server markup places the pin with `left` and `top` at zoom 1; the frame loop moves it from there.
  const [pinOrigin] = React.useState(() => originOf(pin));

  const baseId = React.useId();
  const listId = `${baseId}-list`;
  const statusId = `${baseId}-status`;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  const options = React.useMemo(() => searchOptions(query, list, digits), [query, list, digits]);
  const activeIndex = clamp(active, 0, Math.max(0, options.length - 1));
  const popupShown = open && query.trim() !== "";
  const listShown = popupShown && options.length > 0;
  const shownZoom = Math.min(zoomLevel, zoomLimit);
  const zoomed = shownZoom > 1;
  const showInvalid = invalid && !pin;

  const placeAtPin = React.useMemo(
    () => (pinLat === null || pinLon === null ? null : (list.find((place) => place.lat === pinLat && place.lon === pinLon) ?? null)),
    [list, pinLat, pinLon],
  );
  const awayKm = placeAtPin && snapped && snapped.id === placeAtPin.id ? snapped.km : 0;
  const status = !pin
    ? "Click or tap the map to drop a pin"
    : placeAtPin
      ? awayKm >= 0.05
        ? `${placeAtPin.label}, ${formatDistance(awayKm)} away`
        : placeAtPin.label
      : formatLatLon(pin, "dms");

  const rootRef = React.useRef<HTMLDivElement>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const baseRef = React.useRef<HTMLCanvasElement>(null);
  const overlayRef = React.useRef<HTMLCanvasElement>(null);
  const pinRef = React.useRef<HTMLDivElement>(null);
  const liftRef = React.useRef<HTMLDivElement>(null);
  const markerRef = React.useRef<SVGSVGElement>(null);
  const shadowRef = React.useRef<HTMLSpanElement>(null);
  const validityRef = React.useRef<HTMLInputElement>(null);
  const latFieldRef = React.useRef<HTMLDivElement>(null);
  const lonFieldRef = React.useRef<HTMLDivElement>(null);
  /** The map engine, created on first use in an effect, handler or frame (never during render). */
  const engineRef = useLazyRef(() => new PickerMap());
  const pressRef = React.useRef<Press | null>(null);
  /** Drop height for the next value change made here; external changes drop from the full height. */
  const pendingDrop = React.useRef<number | null>(null);
  /** The first value is placed without a drop. */
  const placedRef = React.useRef(false);

  React.useImperativeHandle(ref, () => rootRef.current!, []);

  const loop = useAnimationLoop(rootRef, step);
  const palette = usePalette(rootRef, GEO_TOKENS, applyTheme);
  const base = useCanvas(
    baseRef,
    (surface) => {
      engineRef.current.layout(surface.width, surface.height);
      loop.kick();
    },
    MAP_CANVAS,
  );
  const overlay = useCanvas(
    overlayRef,
    () => {
      engineRef.current.invalidateOverlay();
      loop.kick();
    },
    MAP_CANVAS,
  );

  function step(_time: number, delta: number) {
    const engine = engineRef.current;
    const moving = engine.step(base.current, overlay.current, delta, clockNow(), prefersReducedMotion());
    placePin(engine);
    return moving;
  }

  /** Moves the DOM pin to the engine's point, relative to where the server markup put it. */
  function placePin(engine: PickerMap) {
    const node = pinRef.current;
    const lift = liftRef.current;
    const shadow = shadowRef.current;
    const box = engine.size;
    const view = engine.pinView;
    if (!node || !lift || !shadow || !box || !view.ready) return;
    const dx = view.x - pinOrigin.x * box.width;
    const dy = view.y - pinOrigin.y * box.height;
    node.style.transform = `translate3d(${dx.toFixed(2)}px,${dy.toFixed(2)}px,0)`;
    lift.style.transform = `translate3d(0,${(-view.lift).toFixed(2)}px,0)`;
    lift.style.opacity = view.held ? "0" : "";
    shadow.style.transform = `scale(${view.shadow.toFixed(3)})`;
    shadow.style.opacity = view.held ? "0" : "";
  }

  function applyTheme() {
    const colors = palette.current;
    if (!colors) return;
    engineRef.current.setInk(geoInk(colors));
    loop.kick();
  }

  useFormReset(rootRef, () => {
    pendingDrop.current = DROP_HEIGHT;
    setValue(validPoint(defaultValue));
    setQuery("");
    setOpen(false);
    setSnapped(null);
    setDraft(null);
    setInvalid(false);
    engineRef.current.resetView(prefersReducedMotion());
    setZoomLevel(1);
    loop.kick();
  });

  // The engine reports the first contact of a drop from the frame loop: the pin squashes as it lands.
  React.useEffect(() => {
    engineRef.current.onLand = () => {
      const marker = markerRef.current;
      if (!marker || typeof marker.animate !== "function" || prefersReducedMotion()) return;
      marker.animate(SQUASH_KEYFRAMES, SQUASH_TIMING);
    };
  });

  React.useEffect(() => {
    engineRef.current.setMaxZoom(zoomLimit);
    loop.kick();
  }, [zoomLimit, engineRef, loop]);

  // Every new value drops the pin: from the full height, or from a small one for keyboard steps.
  React.useEffect(() => {
    const height = pendingDrop.current ?? (placedRef.current ? DROP_HEIGHT : 0);
    pendingDrop.current = null;
    placedRef.current = true;
    const point = pinLat === null || pinLon === null ? null : { lat: pinLat, lon: pinLon };
    engineRef.current.setPin(point, prefersReducedMotion() ? 0 : height);
    loop.kick();
  }, [pinLat, pinLon, engineRef, loop]);

  // `required` blocks submission through a hidden input that is invalid while there is no pin.
  const hasPin = pin !== null;
  React.useEffect(() => {
    validityRef.current?.setCustomValidity(required && !hasPin ? REQUIRED_MESSAGE : "");
  }, [required, hasPin]);

  /** Sets a new value (or replays the drop when it is the same point). */
  function commit(next: LatLon | null, height: number, snapInfo: { id: string; km: number } | null = null) {
    if (disabled) return;
    setSnapped(snapInfo);
    if (next && pin && next.lat === pin.lat && next.lon === pin.lon) {
      if (height > 0 && !prefersReducedMotion()) {
        engineRef.current.replayDrop(height);
        loop.kick();
      }
      return;
    }
    if (!next && !pin) return;
    pendingDrop.current = height;
    setValue(next);
  }

  /** A drop on the map: rounded to `precision`, or snapped to the nearest place within `snap` km. */
  function dropAt(point: LatLon) {
    if (snapKm > 0) {
      const near = nearestLocation(list, point, snapKm);
      if (near) {
        const place = list[near.index];
        commit({ lat: place.lat, lon: place.lon }, DROP_HEIGHT, { id: place.id, km: near.km });
        return;
      }
    }
    commit(roundPoint(point, digits), DROP_HEIGHT);
  }

  /** The view centre, rounded: where keyboard input starts when there is no pin yet. */
  function centerPoint() {
    return roundPoint(engineRef.current.center, digits);
  }

  /* Map: pointer and keyboard */

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0) return;
    const point = localPoint(event.currentTarget, event.clientX, event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);
    pressRef.current = { id: event.pointerId, x: point.x, y: point.y, moved: false, panning: false };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const press = pressRef.current;
    if (!press || press.id !== event.pointerId) return;
    const point = localPoint(event.currentTarget, event.clientX, event.clientY);
    const dx = point.x - press.x;
    const dy = point.y - press.y;
    if (!press.moved && Math.hypot(dx, dy) >= TAP_SLOP) {
      press.moved = true;
      if (engineRef.current.zoomTarget > 1) {
        press.panning = true;
        engineRef.current.beginDrag();
        setDragging(true);
      }
    }
    if (press.panning) {
      engineRef.current.dragBy(dx, dy);
      loop.kick();
    }
  }

  function endPress(event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const press = pressRef.current;
    if (!press || press.id !== event.pointerId) return;
    pressRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (press.panning) {
      engineRef.current.endDrag();
      setDragging(false);
      loop.kick();
      return;
    }
    if (cancelled || press.moved) return;
    const point = engineRef.current.invert(press.x, press.y);
    if (point) dropAt(point);
  }

  function zoomBy(direction: 1 | -1) {
    const engine = engineRef.current;
    engine.zoomStep(direction, prefersReducedMotion());
    setZoomLevel(engine.zoomTarget);
    loop.kick();
  }

  function resetView() {
    engineRef.current.resetView(prefersReducedMotion());
    setZoomLevel(1);
    loop.kick();
  }

  /** Moves the pin by whole degrees from the keyboard, with the small drop, and keeps it in view. */
  function movePin(deltaLat: number, deltaLon: number) {
    if (!pin) return;
    const next = roundPoint({ lat: clamp(pin.lat + deltaLat, LAT_RANGE[0], LAT_RANGE[1]), lon: pin.lon + deltaLon }, digits);
    commit(next, KEY_DROP);
    engineRef.current.reveal(next, prefersReducedMotion());
    loop.kick();
  }

  function clearPin() {
    commit(null, 0);
    stageRef.current?.focus({ preventScroll: true });
  }

  function handleMapKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled || event.altKey || event.ctrlKey || event.metaKey) return;
    const stepDeg = event.shiftKey ? 5 : 1;
    const arrows: Record<string, [number, number]> = {
      ArrowUp: [1, 0],
      ArrowDown: [-1, 0],
      ArrowRight: [0, 1],
      ArrowLeft: [0, -1],
    };
    const arrow = arrows[event.key];
    if (arrow) {
      if (pin) movePin(arrow[0] * stepDeg, arrow[1] * stepDeg);
      else if (engineRef.current.zoomTarget > 1) {
        engineRef.current.panBy(arrow[1] * PAN_SHARE, arrow[0] * PAN_SHARE, prefersReducedMotion());
        loop.kick();
      } else return;
      event.preventDefault();
      return;
    }
    switch (event.key) {
      case "+":
      case "=":
        zoomBy(1);
        break;
      case "-":
      case "_":
        zoomBy(-1);
        break;
      case "Enter":
      case " ":
        if (pin) return;
        dropAt(centerPoint());
        break;
      case "Delete":
      case "Backspace":
        if (!pin) return;
        commit(null, 0);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  /* Search */

  function pick(option: SearchOption) {
    const point = option.kind === "place" ? { lat: option.place.lat, lon: option.place.lon } : roundPoint(option.point, digits);
    setQuery(option.kind === "place" ? option.place.label : formatLatLon(point, "signed", digits));
    setOpen(false);
    const engine = engineRef.current;
    engine.flyTo(point, flyZoom, prefersReducedMotion());
    setZoomLevel(engine.zoomTarget);
    commit(point, DROP_HEIGHT);
    loop.kick();
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        if (!popupShown) {
          if (query.trim()) setOpen(true);
          return;
        }
        const count = options.length;
        if (count) setActive((activeIndex + (event.key === "ArrowDown" ? 1 : -1) + count) % count);
        return;
      }
      case "Enter":
        if (!popupShown) return;
        // an open list takes Enter, so it never submits the form by accident
        event.preventDefault();
        if (options[activeIndex]) pick(options[activeIndex]);
        return;
      case "Escape":
        if (popupShown) {
          event.preventDefault();
          setOpen(false);
        } else if (query) {
          event.preventDefault();
          setQuery("");
        }
        return;
      default:
        return;
    }
  }

  /* Coordinate fields */

  function fieldRef(axis: Axis) {
    return axis === "lat" ? latFieldRef : lonFieldRef;
  }

  /** Sets one coordinate; the other comes from the pin, or from the view centre when there is no pin. */
  function setAxis(axis: Axis, next: number, height: number) {
    const value = roundTo(clamp(next, AXIS_RANGE[axis][0], AXIS_RANGE[axis][1]), digits);
    const other = pin ?? centerPoint();
    const point = axis === "lat" ? { lat: value, lon: other.lon } : { lat: other.lat, lon: value };
    commit(point, height);
    engineRef.current.reveal(point, prefersReducedMotion());
    loop.kick();
    return value;
  }

  /** Commits the typed text of a field. Invalid text shakes the field and reverts. Returns whether the text had changed. */
  function commitDraft(axis: Axis) {
    if (!draft || draft.axis !== axis) return false;
    const current = pin ? editText(pin[axis], digits) : "";
    const text = draft.text.trim();
    if (text === current) return false;
    const parsed = parseAxis(text, axis);
    if (parsed === null) {
      shake(fieldRef(axis).current);
      setDraft({ axis, text: current });
      return true;
    }
    const value = setAxis(axis, parsed, DROP_HEIGHT);
    setDraft({ axis, text: editText(value, digits) });
    return true;
  }

  function handleFieldKeyDown(axis: Axis, event: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    const [min, max] = AXIS_RANGE[axis];
    const current = pin ? pin[axis] : centerPoint()[axis];
    const fine = event.shiftKey ? 1 : 0.1;
    let next: number;
    switch (event.key) {
      case "ArrowUp":
        next = current + fine;
        break;
      case "ArrowDown":
        next = current - fine;
        break;
      case "PageUp":
        next = current + 10;
        break;
      case "PageDown":
        next = current - 10;
        break;
      case "Home":
        next = min;
        break;
      case "End":
        next = max;
        break;
      case "Enter":
        // Enter on unchanged text submits the form, like a native field
        if (commitDraft(axis)) event.preventDefault();
        return;
      case "Escape": {
        const text = pin ? editText(pin[axis], digits) : "";
        if (draft && draft.axis === axis && draft.text !== text) {
          event.preventDefault();
          setDraft({ axis, text });
        }
        return;
      }
      default:
        return;
    }
    event.preventDefault();
    const value = setAxis(axis, next, KEY_DROP);
    setDraft({ axis, text: editText(value, digits) });
  }

  function renderField(axis: Axis) {
    const inputId = `${baseId}-${axis}`;
    const [min, max] = AXIS_RANGE[axis];
    const text = draft !== null && draft.axis === axis ? draft.text : pin ? editText(pin[axis], digits) : "";
    return (
      <div className="flex items-center gap-1.5">
        <label htmlFor={inputId} className="text-[12px] leading-4 text-muted-foreground">
          {axis === "lat" ? "Lat" : "Lon"}
        </label>
        <div ref={fieldRef(axis)} className="relative h-8 w-[104px]">
          <input
            id={inputId}
            type="text"
            role="spinbutton"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            aria-label={axis === "lat" ? "Latitude" : "Longitude"}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={pin ? pin[axis] : undefined}
            aria-valuetext={pin ? formatCoordinate(pin[axis], axis, "decimal", digits).text : "Not set"}
            disabled={disabled}
            value={text}
            onFocus={(event) => {
              setDraft({ axis, text: pin ? editText(pin[axis], digits) : "" });
              event.currentTarget.select();
            }}
            onChange={(event) => setDraft({ axis, text: event.target.value })}
            onBlur={() => {
              commitDraft(axis);
              setDraft(null);
            }}
            onKeyDown={(event) => handleFieldKeyDown(axis, event)}
            className="peer block size-full rounded-md border border-border bg-card px-2 text-right font-mono text-[12.5px] text-transparent tabular-nums caret-foreground outline-none transition-[border-color,box-shadow] duration-150 focus:border-[color-mix(in_srgb,var(--lumesec)_65%,var(--border))] focus:text-foreground focus:ring-[3px] focus:ring-lumesec/14 disabled:cursor-not-allowed motion-reduce:transition-none"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-2 flex items-center font-mono text-[12.5px] leading-4 text-foreground tabular-nums peer-focus:invisible"
          >
            {pin ? (
              <RollingNumber value={pin[axis]} text={displayText(pin[axis], digits)} />
            ) : (
              <span className="text-muted-foreground">–</span>
            )}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={label}
      data-slot="geo-location-picker"
      data-disabled={disabled ? "" : undefined}
      className={cn(
        "grid w-full max-w-[400px] gap-2.5 text-foreground [-webkit-tap-highlight-color:transparent] data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <div className="relative">
        <div className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-2.5 transition-[border-color,box-shadow] duration-150 focus-within:border-[color-mix(in_srgb,var(--lumesec)_65%,var(--border))] focus-within:ring-[3px] focus-within:ring-lumesec/14 motion-reduce:transition-none">
          <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="size-4 flex-none text-muted-foreground">
            <circle cx="7" cy="7" r="4.6" />
            <path d="M10.5 10.5l3.5 3.5" />
          </svg>
          <input
            type="text"
            role="combobox"
            aria-label="Search a place or coordinates"
            aria-expanded={listShown}
            aria-controls={listShown ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={listShown ? optionId(activeIndex) : undefined}
            placeholder="Search a place or paste coordinates"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
              setActive(0);
            }}
            onBlur={() => setOpen(false)}
            onKeyDown={handleSearchKeyDown}
            className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 font-[inherit] text-[13.5px] text-inherit outline-none placeholder:text-muted-foreground"
          />
        </div>
        {popupShown ? (
          <div className="absolute inset-x-0 top-full z-20 mt-1 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-[0_14px_34px_-16px_rgb(0_0_0/0.45)]">
            {options.length ? (
              <div id={listId} role="listbox" aria-label="Places">
                {options.map((option, i) => (
                  <div
                    key={option.key}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === activeIndex}
                    onMouseDown={(event) => event.preventDefault()}
                    onPointerMove={() => {
                      if (i !== activeIndex) setActive(i);
                    }}
                    onClick={() => pick(option)}
                    className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] leading-4 aria-selected:bg-muted"
                  >
                    {option.kind === "coords" ? (
                      <>
                        <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" className="size-3.5 flex-none text-muted-foreground">
                          <circle cx="8" cy="8" r="4.5" />
                          <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" />
                        </svg>
                        <span className="min-w-0 truncate">
                          Go to <span className="font-mono text-[12.5px] tabular-nums">{option.text}</span>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 truncate">
                          <FuzzyHighlight text={option.place.label} indices={option.indices} markClassName="bg-transparent font-semibold text-lumesec" />
                        </span>
                        <span className="ml-auto flex-none pl-2 font-mono text-[11.5px] text-muted-foreground tabular-nums">
                          {formatLatLon(option.place, "decimal", 2)}
                        </span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="m-0 px-2 py-1.5 text-[12.5px] leading-5 text-muted-foreground">No places match. Coordinates work too: 6.52, 3.38.</p>
            )}
          </div>
        ) : null}
      </div>

      <div
        ref={cardRef}
        data-invalid={showInvalid ? "" : undefined}
        className="rounded-xl border border-border bg-card p-1.5 shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)] transition-colors duration-150 data-[invalid]:border-destructive motion-reduce:transition-none"
      >
        <div className="relative">
          <div
            ref={stageRef}
            role="application"
            aria-roledescription="map"
            aria-label="Map: arrow keys move the pin, plus and minus zoom"
            aria-describedby={statusId}
            aria-invalid={showInvalid || undefined}
            aria-disabled={disabled || undefined}
            tabIndex={disabled ? -1 : 0}
            data-dragging={dragging ? "" : undefined}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={(event) => endPress(event, false)}
            onPointerCancel={(event) => endPress(event, true)}
            onKeyDown={handleMapKeyDown}
            className={cn(
              "relative w-full overflow-hidden rounded-lg outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec",
              zoomed ? "cursor-grab touch-none data-[dragging]:cursor-grabbing" : "cursor-crosshair touch-pan-y",
            )}
            style={{ aspectRatio: MAP_ASPECT }}
          >
            <canvas ref={baseRef} aria-hidden="true" className="pointer-events-none absolute inset-0 block size-full" />
            <canvas ref={overlayRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-[1] block size-full" />
            <div
              ref={pinRef}
              aria-hidden="true"
              data-hidden={pin ? undefined : ""}
              className="pointer-events-none absolute z-[2] size-0 transition-opacity duration-150 will-change-transform data-[hidden]:opacity-0 motion-reduce:transition-none"
              style={{ left: percent(pinOrigin.x), top: percent(pinOrigin.y) }}
            >
              <span ref={shadowRef} className="absolute -top-0.5 -left-0.5 block size-1 rounded-full bg-foreground/25" />
              <div ref={liftRef} className="absolute -top-6 -left-[9px] h-6 w-[18px] will-change-transform">
                <svg ref={markerRef} viewBox="0 0 18 24" className="block size-full origin-bottom overflow-visible drop-shadow-[0_1px_1px_rgb(0_0_0/0.22)]">
                  <path d={PIN_PATH} fill="var(--lumesec)" stroke="var(--card)" strokeWidth={1} />
                  <circle cx="9" cy="8.75" r="2.6" fill="var(--card)" />
                </svg>
              </div>
            </div>
          </div>

          <div className="absolute top-1.5 right-1.5 z-[3] flex divide-x divide-border overflow-hidden rounded-md border border-border bg-card/90 shadow-[0_4px_12px_-8px_rgb(0_0_0/0.5)]">
            <MapButton label="Zoom out" disabled={disabled || shownZoom <= 1} onClick={() => zoomBy(-1)}>
              <path d="M4 8h8" />
            </MapButton>
            <MapButton label="Zoom in" disabled={disabled || shownZoom >= zoomLimit} onClick={() => zoomBy(1)}>
              <path d="M4 8h8M8 4v8" />
            </MapButton>
            <MapButton label="Reset view" disabled={disabled || !zoomed} onClick={resetView}>
              <path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3" />
            </MapButton>
          </div>

          <input
            ref={validityRef}
            tabIndex={-1}
            aria-hidden="true"
            required={required}
            disabled={disabled}
            value={pin ? "set" : ""}
            onChange={() => undefined}
            onInvalid={() => {
              setInvalid(true);
              shake(cardRef.current);
            }}
            className="pointer-events-none absolute bottom-0 left-1/2 size-px border-0 p-0 opacity-0"
          />
        </div>

        <div className="flex h-7 items-end gap-3 px-1 pb-0.5 text-[12px] leading-4">
          <span id={statusId} className={cn("min-w-0 truncate", pin ? "text-foreground" : "text-muted-foreground", showInvalid && "text-destructive")}>
            {showInvalid ? REQUIRED_MESSAGE : status}
          </span>
          <span aria-hidden="true" className="ml-auto shrink-0 font-mono text-[11.5px] text-muted-foreground tabular-nums">
            <RollingNumber value={shownZoom} text={zoomText(shownZoom)} />
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {renderField("lat")}
        {renderField("lon")}
        <button
          type="button"
          disabled={disabled || !pin}
          onClick={clearPin}
          className="ml-auto h-8 cursor-pointer rounded-md border-0 bg-transparent px-2.5 font-[inherit] text-[12.5px] font-medium text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-solid focus-visible:outline-lumesec disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground motion-reduce:transition-none"
        >
          Clear
        </button>
      </div>

      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {pin ? `Pin at ${formatLatLon(pin, "decimal", 2)}` : "No pin"}
      </span>

      {name && pin ? (
        submitAs === "pair" ? (
          <input type="hidden" name={name} value={`${editText(pin.lat, digits)},${editText(pin.lon, digits)}`} disabled={disabled} />
        ) : (
          <>
            <input type="hidden" name={`${name}-lat`} value={editText(pin.lat, digits)} disabled={disabled} />
            <input type="hidden" name={`${name}-lon`} value={editText(pin.lon, digits)} disabled={disabled} />
          </>
        )
      ) : null}
    </div>
  );
}

/* Parts ----------------------------------------------------------------------------------------------- */

/** A 24 px icon button of the zoom group over the map. */
function MapButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-6 cursor-pointer place-items-center border-0 bg-transparent p-0 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
        {children}
      </svg>
    </button>
  );
}

/** Mechanical figures: they roll up when the value grows and down when it shrinks. */
function RollingNumber({ value, text }: { value: number; text: string }) {
  const [shown, setShown] = React.useState({ text, value, direction: 1 });
  if (shown.text !== text) setShown({ text, value, direction: value < shown.value ? -1 : 1 });
  return <RollText text={text} direction={shown.direction} className="justify-items-end" />;
}

/* Helpers --------------------------------------------------------------------------------------------- */

type Axis = "lat" | "lon";

/** A press on the map: a tap drops the pin, a drag of the zoomed map pans it. */
interface Press {
  readonly id: number;
  /** Press point in map px. */
  readonly x: number;
  readonly y: number;
  moved: boolean;
  panning: boolean;
}

type SearchOption =
  | { readonly kind: "coords"; readonly key: string; readonly point: LatLon; readonly text: string }
  | { readonly kind: "place"; readonly key: string; readonly place: PickerPlace; readonly indices: readonly number[] };

/** 'Go to …' first when the text reads as coordinates, then up to six places ranked by fuzzy match. */
function searchOptions(query: string, places: readonly PickerPlace[], digits: number): SearchOption[] {
  const text = query.trim();
  if (!text) return [];
  const options: SearchOption[] = [];
  const point = parseCoordinates(text);
  if (point) options.push({ kind: "coords", key: "coords", point, text: formatLatLon(point, "signed", digits) });
  const ranked = places
    .flatMap((place) => {
      const match = fuzzyMatch(text, place.label);
      return match ? [{ place, score: match.score, indices: match.indices }] : [];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS);
  ranked.forEach(({ place, indices }, i) => options.push({ kind: "place", key: `place:${i}:${place.id}`, place, indices }));
  return options;
}

/**
 * The value when it is a real position (finite, latitude within ±90°), else null. A longitude beyond ±180° is wrapped,
 * so the pin, the fields and the form agree; ±180 itself is kept, so End in the field stays on the east edge.
 */
function validPoint(point: LatLon | null | undefined): LatLon | null {
  if (!point || !isValidLatLon(point)) return null;
  return Math.abs(point.lon) <= 180 ? point : { lat: point.lat, lon: wrapLongitude(point.lon) };
}

function roundTo(value: number, digits: number) {
  return Number(value.toFixed(digits)) || 0;
}

/** A point rounded to `digits`, with the longitude wrapped into [−180, 180). */
function roundPoint(point: LatLon, digits: number): LatLon {
  return { lat: roundTo(clamp(point.lat, -90, 90), digits), lon: roundTo(wrapLongitude(point.lon), digits) };
}

/** Field and form text: fixed decimals, an ASCII minus, never '-0'. */
function editText(value: number, digits: number) {
  const text = value.toFixed(digits);
  return Number(text) === 0 ? (0).toFixed(digits) : text;
}

/** Display text: as editText, with the true minus sign. */
const displayText = (value: number, digits: number) => editText(value, digits).replace("-", "−");

const zoomText = (zoom: number) => `${Number(zoom.toFixed(1))}×`;

/**
 * Reads typed degrees: a signed decimal ('-33.87', '−33,87'), optionally with a degree sign and a hemisphere letter
 * before or after it ('33.87 S'). A letter cannot be combined with a sign. Null when invalid or out of range.
 */
function parseAxis(text: string, axis: Axis): number | null {
  const cleaned = text.replace(/−/g, "-").replace(/[°\s]/g, "").replace(",", ".").toUpperCase();
  const match = /^([NSEW])?([+-]?(?:\d+(?:\.\d*)?|\.\d+))([NSEW])?$/.exec(cleaned);
  if (!match) return null;
  if (match[1] && match[3]) return null;
  const letter = match[1] ?? match[3];
  let value = Number(match[2]);
  if (letter) {
    if (!(axis === "lat" ? "NS" : "EW").includes(letter) || /^[+-]/.test(match[2])) return null;
    if (letter === "S" || letter === "W") value = -value;
  }
  const [min, max] = AXIS_RANGE[axis];
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}

/** Where a point sits on the map at zoom 1, as shares of the width and height (the map's centre without a point). */
function originOf(point: LatLon | null) {
  if (!point) return { x: 0.5, y: 0.5 };
  const lat = clamp(point.lat, LAT_RANGE[0], LAT_RANGE[1]);
  return { x: clamp((wrapLongitude(point.lon) + 180) / 360, 0, 1), y: (LAT_RANGE[1] - lat) / (LAT_RANGE[1] - LAT_RANGE[0]) };
}

/* Constants ------------------------------------------------------------------------------------------- */

/** The 60 demo cities as places. */
const DEMO_PLACES: readonly PickerPlace[] = DEMO_CITIES.map((city) => ({ id: city.id, label: city.name, lat: city.lat, lon: city.lon }));

/** Equirectangular strip from 60° S to 78° N; the view centre at zoom 1 is its middle. */
const LAT_RANGE: readonly [number, number] = [-60, 78];
const LAT_SPAN = LAT_RANGE[1] - LAT_RANGE[0];
const HOME: LatLon = { lat: (LAT_RANGE[0] + LAT_RANGE[1]) / 2, lon: 0 };
const MAP_ASPECT = projectionAspect("equirectangular", LAT_RANGE);
const MAP_CANVAS = { maxDpr: 2 } as const;

const AXIS_RANGE: Record<Axis, readonly [number, number]> = { lat: [-90, 90], lon: [-180, 180] };
const MAX_RESULTS = 6;
const REQUIRED_MESSAGE = "Drop a pin on the map.";

/** A press that moves less than this (px) is a tap. */
const TAP_SLOP = 4;
/** Keyboard pan of the zoomed map without a pin: this share of the view per arrow press. */
const PAN_SHARE = 0.2;

/** Lattice pitch and dot size in CSS px. */
const PITCH = 4;
const DOT = 1.5;
/** Zoomed bakes reach half a view past each edge, so short pans need no new bake. */
const BAKE_MARGIN = 0.5;
/** Seconds for a new bake to fade in over the old one. */
const FADE_SECONDS = 0.16;

/** The view: zoom and centre are springs; a search pick flies to at least this zoom. */
const VIEW_STIFFNESS = 200;
const VIEW_DAMPING = 0.9;
const FLY_ZOOM = 3;
/** Long flights dip out by up to this much zoom halfway, so the jump reads as travel. */
const FLY_DIP = 0.6;
const FLY_DIP_KM = 8000;
/** A pin set during a flight waits until the flight is this far along, then drops. */
const HOLD_UNTIL = 0.8;

/** The drop: an under-damped spring whose overshoot is drawn as one rebound off the ground. */
const DROP_HEIGHT = 28;
const KEY_DROP = 10;
const DROP_STIFFNESS = 520;
const DROP_DAMPING = 0.55;

/** The splash: dots within 40 px ride a ring that leaves at 160 px/s, in a 48 px disc redrawn for 0.6 s. */
const SPLASH_RADIUS = 40;
const SPLASH_PUSH = 4;
const SPLASH_SPEED = 160;
const SPLASH_SECONDS = 0.6;
/** A weaker second ring follows and pulls inward, like the trough behind a wave. */
const ECHO_DELAY = 0.14;
const ECHO_PULL = 0.45;
const DISC_RADIUS = 48;
/** The lit pool under a resting pin: dots within 12 px, tinted toward the accent by up to 0.55. */
const HALO_RADIUS = 12;
const HALO_TINT = 0.55;
/** Seconds for the pool to fill after the pin lands. */
const WET_SECONDS = 0.3;

/** 18 × 24 teardrop with its tip at (9, 23.5). */
const PIN_PATH = "M9 23.5C9 23.5 1.5 15.2 1.5 8.75a7.5 7.5 0 0 1 15 0C16.5 15.2 9 23.5 9 23.5Z";
const SQUASH_KEYFRAMES: Keyframe[] = [
  { transform: "scale(1.14, .8)" },
  { transform: "scale(.95, 1.06)", offset: 0.45 },
  { transform: "scale(1)" },
];
const SQUASH_TIMING: KeyframeAnimationOptions = { duration: 280, easing: "cubic-bezier(.2,.8,.2,1)" };

/* Map engine ------------------------------------------------------------------------------------------ */

/** A land lattice baked for one view, and the box it covers in that view's px. */
interface Bake {
  readonly lattice: DotLattice;
  readonly world: boolean;
  readonly zoom: number;
  readonly lat: number;
  readonly lon: number;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

interface Layer {
  readonly bake: Bake;
  alpha: number;
  target: number;
}

/** A search flight: one spring u from 0 to 1 drives the zoom and the centre. */
interface Flight {
  readonly progress: Spring;
  readonly fromZoom: number;
  readonly toZoom: number;
  readonly fromLat: number;
  readonly fromLon: number;
  readonly toLat: number;
  readonly toLon: number;
  readonly dip: number;
}

/** Maps a bake's px to the current view's px: x' = s·x + ox. */
interface Transform {
  s: number;
  ox: number;
  oy: number;
}

/**
 * Everything the map draws, outside React. The view (zoom and centre) moves on springs; the land is a dot lattice
 * baked for the settled view and drawn through a scale and offset while the view moves, so dots keep their size and
 * spread apart on the way in. A new bake fades in over 160 ms once the view rests; when a zoomed bake no longer covers
 * the view, the whole-world bake stands in. A second canvas redraws only the 48 px disc around the pin for the splash
 * and the lit pool. The pin itself is DOM; the component moves it to `pinView`.
 */
class PickerMap {
  /** Called on the frame a dropping pin first touches the ground. */
  onLand: () => void = () => undefined;

  private ink: GeoInk | null = null;
  private landStyle = "";
  private cardStyle = "";
  private box: { width: number; height: number } | null = null;
  /** px per degree at zoom 1. */
  private fit = 0;
  private maxZoom = 4;
  private readonly zoom: Spring = { position: 1, velocity: 0 };
  private readonly lat: Spring = { position: HOME.lat, velocity: 0 };
  private readonly lon: Spring = { position: HOME.lon, velocity: 0 };
  private readonly target = { zoom: 1, lat: HOME.lat, lon: HOME.lon };
  private flight: Flight | null = null;
  private dragging = false;
  private readonly dragStart = { lat: 0, lon: 0 };
  /** The view drawn this frame, clamped to the map. */
  private readonly view = { zoom: 1, lat: HOME.lat, lon: HOME.lon };
  private readonly drawn = { zoom: Number.NaN, lat: Number.NaN, lon: Number.NaN };
  private layers: Layer[] = [];
  private current: Layer | null = null;
  private worldBake: Bake | null = null;
  private readonly transform: Transform = { s: 1, ox: 0, oy: 0 };

  private point: LatLon | null = null;
  /** Height above the ground in px: negative while falling, past 0 on the rebound. */
  private readonly drop: Spring = { position: 0, velocity: 0 };
  private dropping = false;
  private dropStrength = 1;
  /** The height of a drop waiting for the flight, or 0. */
  private held = 0;
  private contactPending = false;
  private splash: { start: number; strength: number } | null = null;
  /** The lit pool under the pin, 0 to 1. */
  private wet = 1;
  private readonly pinOut = { x: 0, y: 0, lift: 0, shadow: 1, held: false, ready: false };
  private overlayRect: { x: number; y: number; size: number } | null = null;
  private baseDirty = true;
  private overlayDirty = true;
  private overlayClearAll = true;

  /** The map's size in CSS px, once laid out. */
  get size(): { readonly width: number; readonly height: number } | null {
    return this.box;
  }

  /** The zoom the view is heading to. */
  get zoomTarget() {
    return this.target.zoom;
  }

  /** The centre of the view drawn now. */
  get center(): LatLon {
    return { lat: this.view.lat, lon: this.view.lon };
  }

  /**
   * The pin's ground point in map px, its height above it, the shadow scale, whether it waits for a flight, and whether
   * it has been placed in a laid-out view yet.
   */
  get pinView(): {
    readonly x: number;
    readonly y: number;
    readonly lift: number;
    readonly shadow: number;
    readonly held: boolean;
    readonly ready: boolean;
  } {
    return this.pinOut;
  }

  setInk(ink: GeoInk) {
    this.ink = ink;
    this.landStyle = rgba(ink.land);
    this.cardStyle = rgba(ink.card);
    this.baseDirty = true;
    this.overlayDirty = true;
    this.overlayClearAll = true;
  }

  /** New map size: every bake is dropped and rebuilt for the current view. */
  layout(width: number, height: number) {
    this.box = { width, height };
    this.fit = createProjection("equirectangular", { width, height, latRange: LAT_RANGE }).scale * DEG;
    this.layers = [];
    this.current = null;
    this.worldBake = null;
    this.setTarget(this.target.zoom, this.target.lat, this.target.lon);
    this.baseDirty = true;
    this.overlayDirty = true;
    this.overlayClearAll = true;
  }

  /** The overlay canvas was resized (and cleared). */
  invalidateOverlay() {
    this.overlayDirty = true;
    this.overlayClearAll = true;
  }

  setMaxZoom(zoom: number) {
    this.maxZoom = zoom;
    if (this.flight && this.flight.toZoom > zoom) this.stopFlight();
    if (this.target.zoom > zoom) this.setTarget(zoom, this.target.lat, this.target.lon);
  }

  /** One zoom step in or out about the view centre. */
  zoomStep(direction: number, reduced: boolean) {
    this.stopFlight();
    const zoom = this.target.zoom;
    const next = direction > 0 ? Math.floor(zoom + 1e-6) + 1 : Math.ceil(zoom - 1e-6) - 1;
    this.setTarget(next, this.target.lat, this.target.lon);
    if (reduced) this.jump();
  }

  resetView(reduced: boolean) {
    this.stopFlight();
    this.dragging = false;
    this.setTarget(1, HOME.lat, HOME.lon);
    if (reduced) this.jump();
  }

  /** Flies to a point and zooms in to at least `zoom`, dipping out halfway on long trips. */
  flyTo(point: LatLon, zoom: number, reduced: boolean) {
    this.stopFlight();
    this.dragging = false;
    this.setTarget(Math.max(zoom, this.target.zoom), point.lat, point.lon);
    if (reduced || !this.box) {
      this.jump();
      return;
    }
    const km = distanceKm({ lat: this.view.lat, lon: this.view.lon }, { lat: this.target.lat, lon: this.target.lon });
    this.flight = {
      progress: { position: 0, velocity: 0 },
      fromZoom: this.view.zoom,
      toZoom: this.target.zoom,
      fromLat: this.view.lat,
      fromLon: this.view.lon,
      toLat: this.target.lat,
      toLon: this.target.lon,
      dip: FLY_DIP * Math.min(1, km / FLY_DIP_KM),
    };
  }

  /** Pans the view by shares of its width and height (keyboard, zoomed map without a pin). */
  panBy(shareX: number, shareY: number, reduced: boolean) {
    const box = this.box;
    if (!box || !this.fit) return;
    this.stopFlight();
    const scale = this.fit * this.target.zoom;
    this.setTarget(this.target.zoom, this.target.lat + (shareY * box.height) / scale, this.target.lon + (shareX * box.width) / scale);
    if (reduced) this.jump();
  }

  /** Re-centres the zoomed view on a point that is outside the middle 80% of where the view is heading. */
  reveal(point: LatLon, reduced: boolean) {
    const box = this.box;
    if (!box || !this.fit || this.flight || this.target.zoom <= 1) return;
    const scale = this.fit * this.target.zoom;
    const halfLon = (box.width / 2 / scale) * 0.8;
    const halfLat = (box.height / 2 / scale) * 0.8;
    const lat = clamp(point.lat, LAT_RANGE[0], LAT_RANGE[1]);
    if (Math.abs(point.lon - this.target.lon) <= halfLon && Math.abs(lat - this.target.lat) <= halfLat) return;
    this.setTarget(this.target.zoom, lat, point.lon);
    if (reduced) this.jump();
  }

  beginDrag() {
    this.stopFlight();
    this.dragging = true;
    this.dragStart.lat = this.view.lat;
    this.dragStart.lon = this.view.lon;
  }

  /** The pointer moved (dx, dy) px since the drag began: the map follows it. */
  dragBy(dx: number, dy: number) {
    if (!this.dragging || !this.fit) return;
    const scale = this.fit * Math.max(1, this.view.zoom);
    this.setTarget(this.target.zoom, this.dragStart.lat + dy / scale, this.dragStart.lon - dx / scale);
    this.lat.position = this.target.lat;
    this.lat.velocity = 0;
    this.lon.position = this.target.lon;
    this.lon.velocity = 0;
  }

  endDrag() {
    this.dragging = false;
  }

  /** The point under map px (x, y) in the view drawn now, or null outside the map. */
  invert(x: number, y: number): LatLon | null {
    const box = this.box;
    if (!box || !this.fit) return null;
    const scale = this.fit * this.view.zoom;
    const lat = this.view.lat - (y - box.height / 2) / scale;
    const lon = this.view.lon + (x - box.width / 2) / scale;
    if (lat < LAT_RANGE[0] || lat > LAT_RANGE[1] || lon < -180 || lon > 180) return null;
    return { lat, lon: wrapLongitude(lon) };
  }

  /** A new pin position. `height` > 0 drops it from that many px above; null removes it. */
  setPin(point: LatLon | null, height: number) {
    this.overlayDirty = true;
    if (!point) {
      this.point = null;
      this.dropping = false;
      this.held = 0;
      this.splash = null;
      return;
    }
    if (this.point && this.point.lat === point.lat && this.point.lon === point.lon) return;
    this.point = { lat: point.lat, lon: point.lon };
    this.startDrop(height);
  }

  /** Drops the pin again where it is (a pick of the same point). */
  replayDrop(height: number) {
    if (this.point) this.startDrop(height);
  }

  /** One frame. Returns whether to keep going. */
  step(base: CanvasSurface | null, overlay: CanvasSurface | null, delta: number, now: number, reduced: boolean) {
    const box = this.box;
    if (!box || !this.ink || !base || !overlay || !this.fit) return false;
    let moving = this.stepView(delta, reduced);

    // the view drawn this frame, clamped to the map
    const zoom = Math.max(1, this.zoom.position);
    this.view.zoom = zoom;
    this.view.lat = this.clampLat(this.lat.position, zoom);
    this.view.lon = this.clampLon(this.lon.position, zoom);
    if (this.view.zoom !== this.drawn.zoom || this.view.lat !== this.drawn.lat || this.view.lon !== this.drawn.lon) {
      this.drawn.zoom = this.view.zoom;
      this.drawn.lat = this.view.lat;
      this.drawn.lon = this.view.lon;
      this.baseDirty = true;
      this.overlayDirty = true;
    }

    if (this.stepLayers(!moving && !this.dragging, delta, reduced)) moving = true;
    if (this.stepPin(delta, now, reduced)) moving = true;

    if (this.baseDirty) {
      this.drawBase(base);
      this.baseDirty = false;
    }
    if (this.overlayDirty) {
      this.drawOverlay(overlay, now);
      this.overlayDirty = false;
    }
    return moving;
  }

  /* internals */

  private setTarget(zoom: number, lat: number, lon: number) {
    const z = clamp(zoom, 1, this.maxZoom);
    this.target.zoom = z;
    this.target.lat = this.clampLat(lat, z);
    this.target.lon = this.clampLon(lon, z);
  }

  /** A centre latitude that keeps the view inside the map at zoom `z`. */
  private clampLat(lat: number, z: number) {
    const half = this.box && this.fit ? this.box.height / 2 / (this.fit * z) : LAT_SPAN / 2 / z;
    if (half * 2 >= LAT_SPAN) return HOME.lat;
    return clamp(lat, LAT_RANGE[0] + half, LAT_RANGE[1] - half);
  }

  private clampLon(lon: number, z: number) {
    const half = this.box && this.fit ? this.box.width / 2 / (this.fit * z) : 180 / z;
    if (half >= 180) return HOME.lon;
    return clamp(lon, -180 + half, 180 - half);
  }

  /** Puts the springs on their targets. */
  private jump() {
    this.flight = null;
    this.zoom.position = this.target.zoom;
    this.lat.position = this.target.lat;
    this.lon.position = this.target.lon;
    this.zoom.velocity = 0;
    this.lat.velocity = 0;
    this.lon.velocity = 0;
  }

  /** Ends a flight where it is on screen; the springs carry on from there. */
  private stopFlight() {
    if (!this.flight) return;
    this.flight = null;
    this.zoom.position = this.view.zoom;
    this.lat.position = this.view.lat;
    this.lon.position = this.view.lon;
    this.zoom.velocity = 0;
    this.lat.velocity = 0;
    this.lon.velocity = 0;
  }

  /** Advances the flight or the view springs. Returns whether the view moves. */
  private stepView(delta: number, reduced: boolean) {
    const flight = this.flight;
    if (flight) {
      if (reduced) {
        flight.progress.position = 1;
        flight.progress.velocity = 0;
      } else {
        springStep(flight.progress, 1, delta, VIEW_STIFFNESS, VIEW_DAMPING);
      }
      const u = flight.progress.position;
      if (Math.abs(1 - u) < 1e-4 && Math.abs(flight.progress.velocity) < 1e-3) {
        this.jump();
        return false;
      }
      this.zoom.position = lerp(flight.fromZoom, flight.toZoom, u) - flight.dip * Math.sin(Math.PI * clamp(u, 0, 1));
      this.lat.position = lerp(flight.fromLat, flight.toLat, u);
      this.lon.position = lerp(flight.fromLon, flight.toLon, u);
      return true;
    }
    if (this.dragging) return false;
    if (reduced) {
      this.jump();
      return false;
    }
    springStep(this.zoom, this.target.zoom, delta, VIEW_STIFFNESS, VIEW_DAMPING);
    springStep(this.lat, this.target.lat, delta, VIEW_STIFFNESS, VIEW_DAMPING);
    springStep(this.lon, this.target.lon, delta, VIEW_STIFFNESS, VIEW_DAMPING);
    const resting =
      Math.abs(this.zoom.position - this.target.zoom) < 1e-4 &&
      Math.abs(this.zoom.velocity) < 1e-3 &&
      Math.abs(this.lat.position - this.target.lat) < 1e-4 &&
      Math.abs(this.lat.velocity) < 1e-3 &&
      Math.abs(this.lon.position - this.target.lon) < 1e-4 &&
      Math.abs(this.lon.velocity) < 1e-3;
    if (resting) {
      this.jump();
      return false;
    }
    return true;
  }

  /** Bakes the resting view, picks the layer that covers the view and fades the layers. Returns whether any fades. */
  private stepLayers(settled: boolean, delta: number, reduced: boolean) {
    if (settled && !this.bakeMatches(this.current ? this.current.bake : null)) {
      this.current = this.layerFor(this.bakeForView());
    }
    const active = this.current && this.covers(this.current.bake) ? this.current : this.layerFor(this.world());
    let fading = false;
    for (const layer of this.layers) {
      layer.target = layer === active ? 1 : 0;
      if (layer.alpha === layer.target) continue;
      const change = reduced ? 1 : delta / FADE_SECONDS;
      layer.alpha = layer.target > layer.alpha ? Math.min(1, layer.alpha + change) : Math.max(0, layer.alpha - change);
      this.baseDirty = true;
      if (layer.alpha !== layer.target) fading = true;
    }
    this.layers = this.layers.filter((layer) => layer.alpha > 0 || layer.target > 0);
    if (this.current && !this.layers.includes(this.current)) this.current = null;
    return fading;
  }

  /** The layer of a bake, added (faded out, or shown at once when nothing is on screen) if it is new. */
  private layerFor(bake: Bake): Layer {
    const existing = this.layers.find((layer) => layer.bake === bake);
    if (existing) return existing;
    const layer: Layer = { bake, alpha: this.layers.some((other) => other.alpha > 0) ? 0 : 1, target: 1 };
    this.layers.push(layer);
    this.baseDirty = true;
    return layer;
  }

  private bakeMatches(bake: Bake | null) {
    if (!bake) return false;
    if (this.view.zoom <= 1 + 1e-3) return bake.world;
    return (
      !bake.world &&
      Math.abs(bake.zoom - this.view.zoom) < 1e-3 &&
      Math.abs(bake.lat - this.view.lat) < 1e-4 &&
      Math.abs(bake.lon - this.view.lon) < 1e-4
    );
  }

  /** The whole map at zoom 1; it covers every view, so it stands in while a zoomed bake does not. */
  private world(): Bake {
    if (this.worldBake) return this.worldBake;
    const box = this.box ?? { width: 1, height: 1 };
    const projection = createProjection("equirectangular", { width: box.width, height: box.height, latRange: LAT_RANGE });
    const lattice = mapLattice(projection, { pitch: PITCH });
    const frame = projection.frame;
    this.worldBake = { lattice, world: true, zoom: 1, lat: HOME.lat, lon: HOME.lon, x0: frame.x0, y0: frame.y0, x1: frame.x1, y1: frame.y1 };
    return this.worldBake;
  }

  /** A lattice for the resting view at pitch 4, reaching half a view past each edge. */
  private bakeForView(): Bake {
    const { zoom, lat, lon } = this.view;
    if (zoom <= 1 + 1e-3) return this.world();
    const box = this.box ?? { width: 1, height: 1 };
    const projection = createProjection("equirectangular", {
      width: box.width,
      height: box.height,
      latRange: LAT_RANGE,
      zoom,
      focus: { lat, lon },
    });
    const viewport = {
      x0: -box.width * BAKE_MARGIN,
      y0: -box.height * BAKE_MARGIN,
      x1: box.width * (1 + BAKE_MARGIN),
      y1: box.height * (1 + BAKE_MARGIN),
    };
    const lattice = mapLattice(projection, { pitch: PITCH, viewport });
    const frame = projection.frame;
    return {
      lattice,
      world: false,
      zoom,
      lat,
      lon,
      x0: Math.max(viewport.x0, frame.x0),
      y0: Math.max(viewport.y0, frame.y0),
      x1: Math.min(viewport.x1, frame.x1),
      y1: Math.min(viewport.y1, frame.y1),
    };
  }

  /** The scale and offset that draw a bake's dots into the current view. */
  private transformFor(bake: Bake, out: Transform) {
    const box = this.box ?? { width: 0, height: 0 };
    const k = this.view.zoom / bake.zoom;
    const scale = this.fit * this.view.zoom;
    out.s = k;
    out.ox = (box.width / 2) * (1 - k) + scale * (bake.lon - this.view.lon);
    out.oy = (box.height / 2) * (1 - k) - scale * (bake.lat - this.view.lat);
    return out;
  }

  /** Whether a bake has dots for the whole view drawn now. */
  private covers(bake: Bake) {
    const box = this.box;
    if (bake.world || !box) return true;
    const { s, ox, oy } = this.transformFor(bake, this.transform);
    const tolerance = 1;
    return (
      (0 - ox) / s >= bake.x0 - tolerance &&
      (box.width - ox) / s <= bake.x1 + tolerance &&
      (0 - oy) / s >= bake.y0 - tolerance &&
      (box.height - oy) / s <= bake.y1 + tolerance
    );
  }

  private startDrop(height: number) {
    this.overlayDirty = true;
    this.splash = null;
    if (height <= 0) {
      this.drop.position = 0;
      this.drop.velocity = 0;
      this.dropping = false;
      this.held = 0;
      this.contactPending = false;
      this.wet = 1;
      return;
    }
    this.wet = 0;
    this.dropStrength = clamp(height / DROP_HEIGHT, 0.45, 1);
    if (this.flight) {
      this.held = height;
      this.dropping = false;
      this.contactPending = false;
      return;
    }
    this.beginDrop(height);
  }

  private beginDrop(height: number) {
    this.held = 0;
    this.drop.position = -height;
    this.drop.velocity = 0;
    this.dropping = true;
    this.contactPending = true;
    this.overlayDirty = true;
  }

  /** The drop, the splash and the pool. Returns whether the pin is still animating. */
  private stepPin(delta: number, now: number, reduced: boolean) {
    const point = this.point;
    if (!point) return false;
    let moving = false;
    if (this.held > 0) {
      if (!this.flight || this.flight.progress.position >= HOLD_UNTIL) this.beginDrop(this.held);
      else moving = true;
    }
    if (this.dropping) {
      const before = this.drop.position;
      if (reduced) {
        this.drop.position = 0;
        this.drop.velocity = 0;
      } else {
        springStep(this.drop, 0, delta, DROP_STIFFNESS, DROP_DAMPING);
      }
      if (this.contactPending && before < 0 && this.drop.position >= 0) {
        // first contact: the pin squashes and the splash starts
        this.contactPending = false;
        this.onLand();
        if (!reduced) this.splash = { start: now, strength: this.dropStrength };
        else this.wet = 1;
      }
      if (Math.abs(this.drop.position) < 0.05 && Math.abs(this.drop.velocity) < 0.5) {
        this.drop.position = 0;
        this.drop.velocity = 0;
        this.dropping = false;
        if (this.contactPending) {
          this.contactPending = false;
          this.wet = 1;
        }
      } else {
        moving = true;
      }
    }
    if (this.splash) {
      this.overlayDirty = true;
      if ((now - this.splash.start) / 1000 >= SPLASH_SECONDS) this.splash = null;
      else moving = true;
    }
    if (this.wet < 1 && this.held === 0 && !this.contactPending) {
      this.wet = reduced ? 1 : Math.min(1, this.wet + delta / WET_SECONDS);
      this.overlayDirty = true;
      moving = true;
    }

    const out = this.pinOut;
    this.project(point, out);
    out.lift = this.held > 0 ? this.held : Math.abs(this.drop.position);
    out.shadow = 0.4 + 0.6 * (1 - clamp(out.lift / DROP_HEIGHT, 0, 1));
    out.held = this.held > 0;
    out.ready = true;
    return moving;
  }

  /** A point's position in the view drawn now; latitudes outside the map sit on its edge. */
  private project(point: LatLon, out: { x: number; y: number }) {
    const box = this.box ?? { width: 0, height: 0 };
    const scale = this.fit * this.view.zoom;
    out.x = box.width / 2 + scale * (point.lon - this.view.lon);
    out.y = box.height / 2 - scale * (clamp(point.lat, LAT_RANGE[0], LAT_RANGE[1]) - this.view.lat);
  }

  private drawBase(surface: CanvasSurface) {
    const { context, width, height, dpr } = surface;
    context.clearRect(0, 0, width, height);
    context.fillStyle = this.landStyle;
    for (const layer of this.layers) {
      if (layer.alpha <= 0.004) continue;
      const { s, ox, oy } = this.transformFor(layer.bake, this.transform);
      const { x, y, count } = layer.bake.lattice;
      context.globalAlpha = layer.alpha;
      for (let i = 0; i < count; i++) {
        const px = s * x[i] + ox;
        const py = s * y[i] + oy;
        if (px < -DOT || px > width + DOT || py < -DOT || py > height + DOT) continue;
        fillSquare(context, px, py, DOT, dpr);
      }
    }
    context.globalAlpha = 1;
  }

  /**
   * The disc around the pin. At rest only the pool's dots are redrawn, tinted, over the base. During the splash a
   * card-coloured disc covers the base dots and every dot within 48 px is redrawn: pushed outward on the ring front,
   * pulled back by the echo, and brightened toward the glint where the front passes.
   */
  private drawOverlay(surface: CanvasSurface, now: number) {
    const { context, width, height, dpr } = surface;
    if (this.overlayClearAll) {
      context.clearRect(0, 0, width, height);
      this.overlayClearAll = false;
    } else if (this.overlayRect) {
      const rect = this.overlayRect;
      context.clearRect(rect.x, rect.y, rect.size, rect.size);
    }
    this.overlayRect = null;

    const point = this.point;
    const ink = this.ink;
    const layer = this.layers.reduce<Layer | null>((best, item) => (!best || item.alpha > best.alpha ? item : best), null);
    if (!point || !ink || !layer || this.held > 0) return;
    const splash = this.splash;
    const t = splash ? (now - splash.start) / 1000 : 0;
    const amplitude = splash ? splash.strength * (1 - smoothstep(SPLASH_SECONDS * 0.5, SPLASH_SECONDS, t)) : 0;
    const wet = this.wet;
    if (amplitude <= 0 && wet <= 0) return;

    const center = { x: 0, y: 0 };
    this.project(point, center);
    const cx = center.x;
    const cy = center.y;
    const reach = amplitude > 0 ? DISC_RADIUS : HALO_RADIUS + 1;
    const pad = reach + 4;
    this.overlayRect = { x: Math.floor(cx - pad), y: Math.floor(cy - pad), size: Math.ceil(pad * 2) + 2 };

    if (amplitude > 0) {
      context.beginPath();
      context.arc(cx, cy, DISC_RADIUS, 0, TAU);
      context.fillStyle = this.cardStyle;
      context.fill();
    }

    const { land, accent, glint } = ink;
    const { s, ox, oy } = this.transformFor(layer.bake, this.transform);
    const lattice = layer.bake.lattice;
    const front = SPLASH_SPEED * t + 4;
    const echoFront = SPLASH_SPEED * (t - ECHO_DELAY) + 4;
    lattice.grid.query((cx - ox) / s, (cy - oy) / s, (reach + DOT) / s, (i) => {
      const x = s * lattice.x[i] + ox;
      const y = s * lattice.y[i] + oy;
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d > reach + DOT) return;
      let tint = d < HALO_RADIUS ? HALO_TINT * wet * (1 - d / HALO_RADIUS) : 0;
      let shine = 0;
      let size = DOT;
      let px = x;
      let py = y;
      if (amplitude > 0 && d < SPLASH_RADIUS) {
        const falloff = 1 - smoothstep(SPLASH_RADIUS * 0.7, SPLASH_RADIUS, d);
        const jitter = lattice.jitter[i];
        const lead = ringFront(d, front, 6, jitter, 3);
        const echo = t > ECHO_DELAY ? ringFront(d, echoFront, 5, jitter, 3) : 0;
        const push = SPLASH_PUSH * (lead - ECHO_PULL * echo) * falloff * amplitude;
        if (d > 0.01) {
          px += (dx / d) * push;
          py += (dy / d) * push;
        }
        const lit = lead * falloff * amplitude;
        tint += (1 - tint) * 0.6 * lit;
        shine = 0.5 * lit;
        size += 0.6 * lit;
      }
      if (amplitude <= 0 && tint <= 0.002) return;
      // land toward the accent, then toward the glint on the front (inlined: hot loop)
      const red = (land[0] + (accent[0] - land[0]) * tint) * (1 - shine) + glint[0] * shine;
      const green = (land[1] + (accent[1] - land[1]) * tint) * (1 - shine) + glint[1] * shine;
      const blue = (land[2] + (accent[2] - land[2]) * tint) * (1 - shine) + glint[2] * shine;
      context.fillStyle = `rgb(${red | 0},${green | 0},${blue | 0})`;
      fillSquare(context, px, py, size, dpr);
    });
  }
}

/** The current time in ms, for the animation loop and event handlers (never read during render). */
function clockNow() {
  return performance.now();
}
