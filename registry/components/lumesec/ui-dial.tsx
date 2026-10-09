"use client";

import * as React from "react";

import { resolveColor } from "@/lib/lumesec/color";
import { clamp, rgba } from "@/lib/lumesec/math";
import { prefersReducedMotion, springEuler, useAnimationLoop } from "@/lib/lumesec/motion";
import { RollText } from "@/lib/lumesec/roll-text";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

export interface UiDialProps extends Omit<React.ComponentProps<"div">, "onChange" | "defaultValue"> {
  /** Controlled value, snapped to `step` and clamped to `min` and `max`. Use with `onValueChange`. */
  value?: number;
  /** Initial value when uncontrolled. */
  defaultValue?: number;
  /** Lowest value. */
  min?: number;
  /** Highest value. A `max` below `min` is treated as `min`. */
  max?: number;
  /** Detent size, greater than 0 (anything else falls back to 1). Its decimal places set the display precision. */
  step?: number;
  /** Caption under the dial and the slider's accessible name. */
  label?: string;
  /** Called on every detent change from drag, wheel or keys. */
  onValueChange?: (value: number) => void;
  /** Called with each wheel or key step, and when a drag ends, even if the value did not change. */
  onValueCommit?: (value: number) => void;
}

interface Tick {
  /** Angle from straight up, -135° to 135°. */
  degrees: number;
  major: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Detents per key press. */
const KEY_STEPS = new Map<string, number>([
  ["ArrowUp", 1],
  ["ArrowRight", 1],
  ["ArrowDown", -1],
  ["ArrowLeft", -1],
  ["PageUp", 10],
  ["PageDown", -10],
]);

/** Above this many ticks the arc gets evenly spaced ticks instead of one per detent. */
const MAX_TICKS = 91;

/**
 * Rotary dial that follows the pointer around a 270° arc, flashing a tick and rolling the value at each
 * detent, then springs onto the step.
 *
 * @example
 * <UiDial defaultValue={0.7} min={0} max={1} step={0.1} label="Temperature" />
 */
export function UiDial({
  value: valueProp,
  defaultValue = 0.7,
  min = 0,
  max: maxProp = 1,
  step: stepProp = 0.1,
  label = "Temperature",
  onValueChange,
  onValueCommit,
  className,
  ...props
}: UiDialProps) {
  // an inverted range or a step of 0 would divide by zero in the angle and snapping math
  const max = Math.max(min, maxProp);
  const step = stepProp > 0 ? stepProp : 1;
  const decimals = decimalPlaces(step);

  const [rawValue, setValue] = useControllableState({ value: valueProp, defaultValue, onChange: onValueChange });
  const value = snapToStep(rawValue, min, max, step);

  // derived state: the value rolls up when it grows, down when it shrinks
  const [shown, setShown] = React.useState({ value, direction: 1 });
  if (shown.value !== value) setShown({ value, direction: value > shown.value ? 1 : -1 });

  const [dragging, setDragging] = React.useState(false);
  const [initialAngle] = React.useState(() => angleFor(value, min, max));
  const dialRef = React.useRef<HTMLDivElement>(null);
  const knobRef = React.useRef<HTMLDivElement>(null);
  const tickRefs = React.useRef<(SVGLineElement | null)[]>([]);

  // knob physics: the angle (`position`, in degrees) springs to `target` unless a drag holds it
  const knob = React.useRef({ position: initialAngle, velocity: 0, target: initialAngle, dragging: false });
  const current = React.useRef(value);
  const latest = React.useRef({ min, max, step, onValueCommit });
  React.useEffect(() => {
    current.current = value;
    latest.current = { min, max, step, onValueCommit };
  });

  const ticks = React.useMemo(() => buildTicks(min, max, step), [min, max, step]);

  const loop = useAnimationLoop(dialRef, (_time, delta) => {
    const state = knob.current;
    const dt = Math.min(0.04, delta);
    if (!state.dragging) {
      if (prefersReducedMotion()) {
        state.position = state.target;
        state.velocity = 0;
      } else {
        for (let i = 0; i < 2; i++) springEuler(state, state.target, dt / 2, 420, 0.55);
      }
    }
    if (knobRef.current) knobRef.current.style.transform = `rotate(${state.position}deg)`;
    ticks.forEach((tick, i) => {
      const line = tickRefs.current[i];
      const lit = tick.degrees <= state.position + 0.6;
      if (line && line.hasAttribute("data-lit") !== lit) line.toggleAttribute("data-lit", lit);
    });
    return state.dragging || Math.abs(state.target - state.position) > 0.02 || Math.abs(state.velocity) > 0.05;
  });

  // every new value flashes its detent tick and nudges the knob; outside a drag the knob springs to it
  const previousValue = React.useRef(value);
  React.useEffect(() => {
    if (previousValue.current === value) return;
    previousValue.current = value;
    const angle = angleFor(value, min, max);
    if (!prefersReducedMotion()) {
      const line = tickRefs.current[nearestMajorTick(ticks, angle)];
      if (line) {
        line.animate([{ stroke: rgba(resolveColor(line, "--lumesec-glint")), strokeWidth: "4" }, { strokeWidth: "2.2" }], {
          duration: 450,
          easing: "ease-out",
        });
      }
      knobRef.current?.animate([{ scale: "0.975" }, { scale: "1" }], { duration: 160, easing: "ease-out" });
    }
    if (!knob.current.dragging) knob.current.target = angle;
    loop.kick();
  }, [value, min, max, ticks, loop]);

  // a new range re-aims the knob without the flash
  React.useEffect(() => {
    knob.current.target = angleFor(current.current, min, max);
    loop.kick();
  }, [min, max, loop]);

  /** Apply a value from user input. Drags report changes only; the commit comes when the drag ends. */
  const update = React.useCallback(
    (raw: number, fromDrag = false) => {
      const { min: low, max: high, step: size, onValueCommit: commit } = latest.current;
      const next = snapToStep(raw, low, high, size);
      if (next === current.current) return;
      current.current = next;
      setValue(next);
      if (!fromDrag) commit?.(next);
    },
    [setValue],
  );

  // the wheel must not scroll the page, which needs a non-passive listener
  React.useEffect(() => {
    const dial = dialRef.current;
    if (!dial) return;
    const onWheel = (event: WheelEvent) => {
      // a sideways scroll (deltaY 0) is not a turn and leaves the page alone
      if (event.deltaY === 0) return;
      event.preventDefault();
      update(current.current + (event.deltaY < 0 ? 1 : -1) * latest.current.step);
    };
    dial.addEventListener("wheel", onWheel, { passive: false });
    return () => dial.removeEventListener("wheel", onWheel);
  }, [update]);

  const track = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const state = knob.current;
    let angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
    // dead zone at the bottom: stick to the nearer end
    if (angle > 135 || angle < -135) angle = state.position > 0 ? 135 : -135;
    state.position = angle;
    state.velocity = 0;
    update(min + ((angle + 135) / 270) * (max - min), true);
    loop.kick();
  };

  const endDrag = () => {
    const state = knob.current;
    if (!state.dragging) return;
    state.dragging = false;
    setDragging(false);
    state.target = angleFor(current.current, min, max);
    loop.kick();
    latest.current.onValueCommit?.(current.current);
  };

  const format = (v: number) => v.toFixed(decimals);

  return (
    <div data-slot="ui-dial" className={cn("inline-grid justify-items-center gap-1.5 leading-normal", className)} {...props}>
      <div
        ref={dialRef}
        role="slider"
        tabIndex={0}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-label={label}
        data-dragging={dragging ? "" : undefined}
        className="relative size-[148px] cursor-grab touch-none rounded-full outline-none select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-lumesec data-[dragging]:cursor-grabbing"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.focus({ preventScroll: true });
          knob.current.dragging = true;
          setDragging(true);
          track(event);
        }}
        onPointerMove={(event) => {
          if (knob.current.dragging) track(event);
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={(event) => {
          const next = keyTarget(event.key, current.current, min, max, step);
          if (next === null) return;
          event.preventDefault();
          update(next);
        }}
      >
        <svg viewBox="0 0 148 148" aria-hidden="true" className="absolute inset-0 size-full overflow-visible">
          {ticks.map((tick, i) => (
            <line
              key={i}
              ref={(node) => {
                tickRefs.current[i] = node;
              }}
              x1={tick.x1}
              y1={tick.y1}
              x2={tick.x2}
              y2={tick.y2}
              // the render loop owns `data-lit` after the first paint
              data-lit={tick.degrees <= initialAngle + 0.6 ? "" : undefined}
              className={cn(
                "stroke-foreground/22 [stroke-linecap:round] [stroke-width:1.5] [transition:stroke_.18s_ease] data-[lit]:stroke-lumesec",
                tick.major &&
                  "[stroke-width:2.2] data-[lit]:[filter:drop-shadow(0_0_3px_color-mix(in_srgb,var(--lumesec)_70%,transparent))]",
              )}
            />
          ))}
        </svg>
        <div
          ref={knobRef}
          className="absolute top-1/2 left-1/2 -mt-12 -ml-12 size-24 rounded-full bg-[radial-gradient(circle_at_35%_28%,color-mix(in_srgb,var(--card)_70%,#fff_30%),var(--card)_60%,var(--muted))] shadow-[0_10px_24px_-10px_rgba(0,0,0,.45),0_2px_4px_rgba(0,0,0,.15),inset_0_0_0_1px_var(--border)]"
          style={{ transform: `rotate(${initialAngle}deg)` }}
        >
          <span className="absolute top-[9px] left-1/2 -ml-0.5 h-[13px] w-1 rounded-[2px] bg-lumesec shadow-[0_0_8px_color-mix(in_srgb,var(--lumesec)_60%,transparent)]" />
        </div>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-[22px] font-semibold text-foreground tabular-nums">
          <RollText text={format(value)} direction={shown.direction} />
        </div>
      </div>
      <div aria-hidden="true" className="-mt-[18px] flex w-[120px] justify-between font-mono text-[11px] text-muted-foreground">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
    </div>
  );
}

/** Number of decimal places in a step such as 0.1, 0.05 or 1e-7. */
function decimalPlaces(step: number) {
  const [mantissa, exponent = "0"] = String(step).split("e");
  const fractionDigits = mantissa.split(".")[1]?.length ?? 0;
  return clamp(fractionDigits - Number(exponent), 0, 20);
}

/**
 * Round an SVG coordinate to 3 decimals. Server and browser trig can differ in the last digits, and the
 * ticks render on the server, so unrounded values would not hydrate.
 */
const coord = (value: number) => Math.round(value * 1000) / 1000;

/** Knob angle for a value: -135° at `min` to 135° at `max`. */
function angleFor(value: number, min: number, max: number) {
  return max > min ? -135 + (270 * (value - min)) / (max - min) : -135;
}

/** The value a key moves to from `value` (snapped later), or null for keys the dial ignores. */
function keyTarget(key: string, value: number, min: number, max: number, step: number) {
  if (key === "Home") return min;
  if (key === "End") return max;
  const detents = KEY_STEPS.get(key);
  return detents === undefined ? null : value + detents * step;
}

/** Snap `raw` to the nearest detent, counted from `min`, and clamp it to the range. */
function snapToStep(raw: number, min: number, max: number, step: number) {
  const snapped = Math.round((raw - min) / step) * step + min;
  // toFixed drops float noise such as 0.30000000000000004
  return +clamp(snapped, min, max).toFixed(decimalPlaces(step));
}

/**
 * Tick geometry: with 16 or fewer detents each step gets a major tick plus two minor ones; with more, one tick
 * per detent, capped at `MAX_TICKS` evenly spaced ticks for very fine steps.
 */
function buildTicks(min: number, max: number, step: number): Tick[] {
  const detents = Math.round((max - min) / step) + 1;
  const perDetent = detents > 16 ? 1 : 3;
  const count = Math.min(MAX_TICKS, (detents - 1) * perDetent + 1);
  return Array.from({ length: count }, (_, j) => {
    const degrees = count > 1 ? -135 + (270 * j) / (count - 1) : -135;
    const radians = (degrees * Math.PI) / 180;
    const major = j % perDetent === 0;
    const outer = 72;
    const inner = major ? 62 : 66;
    return {
      degrees,
      major,
      x1: coord(74 + Math.sin(radians) * outer),
      y1: coord(74 - Math.cos(radians) * outer),
      x2: coord(74 + Math.sin(radians) * inner),
      y2: coord(74 - Math.cos(radians) * inner),
    };
  });
}

/** Index of the major tick closest to `degrees`: the detent tick that flashes. */
function nearestMajorTick(ticks: readonly Tick[], degrees: number) {
  let nearest = -1;
  ticks.forEach((tick, i) => {
    if (tick.major && (nearest < 0 || Math.abs(tick.degrees - degrees) < Math.abs(ticks[nearest].degrees - degrees))) nearest = i;
  });
  return nearest;
}
