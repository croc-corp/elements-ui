"use client";

import * as React from "react";

import { clamp } from "@/lib/lumesec/math";
import { prefersReducedMotion } from "@/lib/lumesec/motion";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

export interface UiOdometerProps extends Omit<React.ComponentProps<"div">, "onChange" | "defaultValue"> {
  /** Controlled value, rounded to the nearest multiple of `step` and clamped to `min`/`max`. */
  value?: number;
  /** Initial value when uncontrolled. */
  defaultValue?: number;
  /** Lowest value. */
  min?: number;
  /** Highest value. Also sets the number of digit wheels. A `max` below `min` is treated as `min`. */
  max?: number;
  /** Increment per step, greater than 0 (anything else falls back to 1). */
  step?: number;
  /** Caption above the number and the spinbutton's accessible name. */
  label?: string;
  /** Optional monospace caption under the number. */
  unit?: string;
  /** Called on every value change from the buttons, drag, wheel or keys. */
  onValueChange?: (value: number) => void;
  /**
   * Called with each change from the buttons, wheel or keys, and once when a drag on the number ends,
   * even if the value did not change.
   */
  onValueCommit?: (value: number) => void;
}

/** Steps per key press. */
const KEY_STEPS = new Map<string, number>([
  ["ArrowUp", 1],
  ["ArrowRight", 1],
  ["ArrowDown", -1],
  ["ArrowLeft", -1],
  ["PageUp", 10],
  ["PageDown", -10],
]);

const STEP_BUTTON_CLASS =
  "grid size-[34px] cursor-pointer place-items-center rounded-[9px] border border-border bg-card p-0 font-[inherit] text-foreground outline-none select-none [transition:transform_.15s_cubic-bezier(.2,.8,.2,1),opacity_.2s] hover:bg-muted active:[transform:scale(.88)] aria-disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-lumesec";

const WIDTH_TRANSITION = "[transition:width_.35s_cubic-bezier(.2,.8,.2,1),opacity_.25s] motion-reduce:transition-none";

/**
 * Number stepper where every digit is its own rolling wheel; supports press-and-hold, sideways drag, the
 * scroll wheel and the keyboard. Built for non-negative whole numbers, grouped with commas.
 *
 * @example
 * <UiOdometer defaultValue={8192} min={1024} max={65536} step={1024} label="Max output tokens" />
 */
export function UiOdometer({
  value: valueProp,
  defaultValue = 8192,
  min = 1024,
  max: maxProp = 65536,
  step: stepProp = 1024,
  label = "Max output tokens",
  unit,
  onValueChange,
  onValueCommit,
  className,
  ...props
}: UiOdometerProps) {
  // an inverted range or a step of 0 would break the rounding below
  const max = Math.max(min, maxProp);
  const step = stepProp > 0 ? stepProp : 1;
  const [rawValue, setValue] = useControllableState({ value: valueProp, defaultValue, onChange: onValueChange });
  const value = normalize(rawValue, min, max, step);

  const numberRef = React.useRef<HTMLDivElement>(null);
  const current = React.useRef(value);
  const drag = React.useRef<{ x: number; value: number } | null>(null);
  const repeatTimer = React.useRef(0);
  const latest = React.useRef({ min, max, step, onValueCommit });
  React.useEffect(() => {
    current.current = value;
    latest.current = { min, max, step, onValueCommit };
  });

  /** Apply a new value from user input. */
  const update = React.useCallback(
    (raw: number) => {
      const { min: low, max: high, step: size, onValueCommit: commit } = latest.current;
      const next = normalize(raw, low, high, size);
      const changed = next !== current.current;
      current.current = next;
      setValue(next);
      if (changed && !drag.current) commit?.(next);
    },
    [setValue],
  );

  /** Move by `steps`; pushing past a limit nudges the number and lands on the limit. */
  const bump = React.useCallback(
    (steps: number) => {
      const { min: low, max: high, step: size } = latest.current;
      const next = current.current + steps * size;
      if (next > high + 1e-9 || next < low - 1e-9) {
        if (!prefersReducedMotion()) {
          const sign = steps > 0 ? 1 : -1;
          numberRef.current?.animate(
            [
              { transform: "translateX(0)" },
              { transform: `translateX(${sign * 6}px)` },
              { transform: `translateX(${-sign * 2}px)` },
              { transform: "translateX(0)" },
            ],
            { duration: 300, easing: "ease-out" },
          );
        }
        update(steps > 0 ? high : low);
        return;
      }
      update(next);
    },
    [update],
  );

  // the wheel must not scroll the page, which needs a non-passive listener
  React.useEffect(() => {
    const element = numberRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      // a sideways scroll (deltaY 0) is not a step and leaves the page alone
      if (event.deltaY === 0) return;
      event.preventDefault();
      bump(event.deltaY < 0 ? 1 : -1);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [bump]);

  React.useEffect(() => () => window.clearTimeout(repeatTimer.current), []);

  const stopRepeat = () => window.clearTimeout(repeatTimer.current);

  /** Press and hold: one step now, repeats after 380 ms, speeding up; after 14 repeats, four steps at a time. */
  const startRepeat = (event: React.PointerEvent<HTMLButtonElement>, direction: 1 | -1) => {
    if (event.button !== 0) return;
    event.preventDefault();
    bump(direction);
    let repeats = 0;
    const repeat = () => {
      repeats++;
      bump(direction * (repeats > 14 ? 4 : 1));
      repeatTimer.current = window.setTimeout(repeat, Math.max(45, 110 - repeats * 6));
    };
    stopRepeat();
    repeatTimer.current = window.setTimeout(repeat, 380);
  };

  // keyboard activation (Enter / Space) arrives as a click with no pointer
  const stepByKey = (event: React.MouseEvent<HTMLButtonElement>, direction: 1 | -1) => {
    if (event.detail === 0) bump(direction);
  };

  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    latest.current.onValueCommit?.(current.current);
  };

  const text = String(Math.round(value));
  const columns = String(Math.round(max)).length;
  const wheels: React.ReactNode[] = [];
  for (let place = columns - 1; place >= 0; place--) {
    const on = place < text.length;
    const digit = on ? Number(text[text.length - 1 - place]) : 0;
    wheels.push(
      <span key={`digit-${place}`} aria-hidden="true" className={cn("h-[1.3em] w-[.62em] overflow-hidden", WIDTH_TRANSITION, !on && "w-0 opacity-0")}>
        <span
          className="flex flex-col [transition:transform_.6s_cubic-bezier(.3,1.25,.45,1)] motion-reduce:transition-none"
          // higher places start a little later, so a carry ripples leftward
          style={{ transform: `translateY(${-digit * 1.3}em)`, transitionDelay: `${place * 35}ms` }}
        >
          {DIGITS.map((d) => (
            <span key={d} className="h-[1.3em] text-center leading-[1.3em]">
              {d}
            </span>
          ))}
        </span>
      </span>,
    );
    if (place > 0 && place % 3 === 0) {
      wheels.push(
        <span key={`sep-${place}`} aria-hidden="true" className={cn("w-[.3em] overflow-hidden text-center", WIDTH_TRANSITION, !on && "w-0 opacity-0")}>
          ,
        </span>,
      );
    }
  }

  return (
    <div
      data-slot="ui-odometer"
      className={cn("inline-grid justify-items-center gap-2.5 leading-normal", className)}
      {...props}
    >
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Decrease"
          aria-disabled={value <= min}
          className={STEP_BUTTON_CLASS}
          onPointerDown={(event) => startRepeat(event, -1)}
          onPointerUp={stopRepeat}
          onPointerLeave={stopRepeat}
          onPointerCancel={stopRepeat}
          onClick={(event) => stepByKey(event, -1)}
        >
          <svg viewBox="0 0 14 14" aria-hidden="true" className="size-3.5 fill-none stroke-current [stroke-linecap:round] [stroke-width:2]">
            <path d="M3 7h8" />
          </svg>
        </button>
        <div
          ref={numberRef}
          role="spinbutton"
          tabIndex={0}
          aria-valuenow={value}
          // the wheels are drawn digit strips, hidden from assistive technology; this is the number they show
          aria-valuetext={Math.round(value).toLocaleString("en-US")}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-label={label}
          className="flex h-[1.3em] cursor-ew-resize touch-none items-center rounded-lg px-1.5 text-[32px] font-semibold tracking-[-.01em] text-foreground tabular-nums outline-none select-none [mask-image:linear-gradient(transparent,#000_14%,#000_86%,transparent)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-lumesec"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { x: event.clientX, value: current.current };
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (!start) return;
            // one step per 12 px sideways
            const steps = Math.round((event.clientX - start.x) / 12);
            update(start.value + steps * latest.current.step);
          }}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={(event) => {
            const steps = KEY_STEPS.get(event.key);
            if (steps !== undefined) {
              event.preventDefault();
              bump(steps);
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              update(event.key === "Home" ? min : max);
            }
          }}
        >
          {wheels}
        </div>
        <button
          type="button"
          aria-label="Increase"
          aria-disabled={value >= max}
          className={STEP_BUTTON_CLASS}
          onPointerDown={(event) => startRepeat(event, 1)}
          onPointerUp={stopRepeat}
          onPointerLeave={stopRepeat}
          onPointerCancel={stopRepeat}
          onClick={(event) => stepByKey(event, 1)}
        >
          <svg viewBox="0 0 14 14" aria-hidden="true" className="size-3.5 fill-none stroke-current [stroke-linecap:round] [stroke-width:2]">
            <path d="M3 7h8M7 3v8" />
          </svg>
        </button>
      </div>
      <span hidden={!unit} className="font-mono text-[12px] text-muted-foreground">
        {unit}
      </span>
    </div>
  );
}

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** Round `raw` to the nearest multiple of `step` and clamp it to the range. */
function normalize(raw: number, min: number, max: number, step: number) {
  return clamp(Math.round(raw / step) * step, min, max);
}
