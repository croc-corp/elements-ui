"use client";

import * as React from "react";

import { clamp, mixRgb } from "@/lib/lumesec/math";
import { prefersReducedMotion, springEuler } from "@/lib/lumesec/motion";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { RollText } from "@/lib/lumesec/roll-text";
import { useControllableState, useFormReset } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** Props of `PxSlider`. Other `div` props go to the root. */
export interface PxSliderProps extends Omit<React.ComponentProps<"div">, "children" | "defaultValue" | "onChange" | "prefix"> {
  /** Controlled value. Use with `onValueChange`. Snapped to `step` and clamped to `min`..`max`. */
  value?: number;
  /** Initial value when uncontrolled; also restored on form reset. Defaults to `min`. */
  defaultValue?: number;
  /** Called on every value change from dragging or keys. */
  onValueChange?: (value: number) => void;
  /** Called after each handled key press and when a drag ends, even if the value did not change. */
  onValueCommit?: (value: number) => void;
  /** Lowest value. */
  min?: number;
  /** Highest value. */
  max?: number;
  /** Increment, greater than 0 (other values fall back to 1). Its decimal places set the display precision. */
  step?: number;
  /** Draws a tick per step when there are 24 steps or fewer. */
  ticks?: boolean;
  /** Text before the formatted value, for example `€`. */
  prefix?: string;
  /** Text after the formatted value, for example `%`. */
  unit?: string;
  /** Label above the track; also labels the thumb. */
  label?: React.ReactNode;
  /** Accessible name of the thumb when there is no visible `label`. */
  "aria-label"?: string;
  /** Form field name. */
  name?: string;
  /** Dims the slider and ignores pointer and keyboard input. */
  disabled?: boolean;
}

/** Shadow of the light thumb: a soft drop shadow and a 2px accent ring. */
const THUMB_SHADOW = "shadow-[0_1px_4px_rgb(0_0_0/0.35),0_0_0_2px_var(--lumesec)]";

/**
 * Slider with a pixel track, a springy thumb, optional tick marks and a rolling value label with a prefix
 * or unit. Pressing the track moves focus to the thumb; arrow keys, Page Up/Down, Home and End adjust it.
 *
 * @example
 * <PxSlider name="budget" label="Monthly budget" min={0} max={500} step={10} defaultValue={120} prefix="€" />
 */
export function PxSlider({
  value: valueProp,
  defaultValue,
  onValueChange,
  onValueCommit,
  min = 0,
  max = 100,
  step: stepProp = 1,
  ticks = false,
  prefix = "",
  unit = "",
  label,
  "aria-label": ariaLabel,
  name,
  disabled = false,
  className,
  ...props
}: PxSliderProps) {
  const labelId = React.useId();
  const trackRef = React.useRef<HTMLDivElement>(null);
  const thumbRef = React.useRef<HTMLSpanElement>(null);

  // the step must be positive: zero or NaN turns every value into NaN, a negative step reverses the keys
  const step = stepProp > 0 ? stepProp : 1;
  const normalize = (raw: number) => +clamp(Math.round((raw - min) / step) * step + min, min, max).toFixed(6);
  const fractionOf = (value: number) => (value - min) / (max - min || 1);
  const decimals = String(step).includes(".") ? String(step).split(".")[1].length : 0;
  const format = (value: number) =>
    `${prefix}${value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${unit}`;

  const resetValue = normalize(defaultValue ?? min);
  const [rawValue, setValue] = useControllableState({ value: valueProp, defaultValue: resetValue, onChange: onValueChange });
  const value = normalize(rawValue);
  const fraction = fractionOf(value);

  // the value label rolls up for larger values and down for smaller ones
  const [roll, setRoll] = React.useState({ value, direction: 1 });
  if (roll.value !== value) setRoll({ value, direction: value >= roll.value ? 1 : -1 });

  const [dragging, setDragging] = React.useState(false);
  // the server and the first paint place the thumb with CSS; the canvas loop takes over after mount
  const [initialFraction] = React.useState(fraction);
  const thumb = React.useRef({ position: fraction, velocity: 0 });
  const dragRef = React.useRef(false);
  const valueRef = React.useRef(value);
  const onCommitRef = React.useRef(onValueCommit);
  React.useEffect(() => {
    valueRef.current = value;
    onCommitRef.current = onValueCommit;
  });

  const { ref: canvasRef, redraw } = usePixelCanvas(({ clear, dot, palette, delta, width, height }) => {
    if (!dragRef.current) {
      if (prefersReducedMotion()) thumb.current.position = fraction;
      else springEuler(thumb.current, fraction, delta, 300, 0.7);
    }
    const x0 = 9;
    const span = width - 18;
    const thumbX = x0 + thumb.current.position * span;
    if (thumbRef.current) thumbRef.current.style.left = `${thumbX}px`;
    clear();
    const centerY = height / 2;
    for (let x = x0; x <= x0 + span; x += 4) {
      const on = x <= thumbX;
      const near = on && thumbX - x < 14;
      for (const dy of [-3, 1]) {
        dot(x - 1.2, centerY + dy - 1.2, on ? mixRgb(palette.accent, palette.shine, near ? 0.5 : 0) : palette.foreground, on ? 0.95 : 0.14, 2.4);
      }
    }
    if (ticks) {
      const count = Math.round((max - min) / step);
      if (count > 0 && count <= 24) {
        for (let k = 0; k <= count; k++) {
          const x = x0 + (span * k) / count;
          dot(x - 1, centerY + 8, palette.foreground, x <= thumbX ? 0.55 : 0.25, 2);
        }
      }
    }
    return dragRef.current || Math.abs(fraction - thumb.current.position) > 0.0005 || Math.abs(thumb.current.velocity) > 0.001;
  });

  React.useEffect(redraw, [fraction, ticks, redraw]);

  useFormReset(trackRef, () => setValue(resetValue));

  /** Snap, clamp and store a value. Returns the stored value. */
  const update = (raw: number) => {
    const next = normalize(raw);
    valueRef.current = next;
    setValue(next);
    redraw();
    return next;
  };

  const valueAtPointer = (event: React.PointerEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return min + clamp((event.clientX - rect.left - 9) / (rect.width - 18), 0, 1) * (max - min);
  };

  const endDrag = () => {
    if (!dragRef.current) return;
    dragRef.current = false;
    setDragging(false);
    onCommitRef.current?.(valueRef.current);
    redraw();
  };

  return (
    <div
      data-slot="px-slider"
      data-disabled={disabled ? "" : undefined}
      className={cn("block leading-[1.5] text-foreground", disabled && "pointer-events-none opacity-55", className)}
      {...props}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2.5">
        <span id={labelId} className="text-[12.5px] font-medium">
          {label}
        </span>
        <span className="text-[14px] font-semibold tabular-nums">
          <RollText text={format(value)} direction={roll.direction} className="justify-items-end" />
        </span>
      </div>
      <div
        ref={trackRef}
        data-dragging={dragging ? "" : undefined}
        className="relative h-6 cursor-pointer touch-none"
        onPointerDown={(event) => {
          if (event.button !== 0 || disabled) return;
          // keep focus on the thumb: the default mousedown action would move it to the page
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = true;
          setDragging(true);
          thumbRef.current?.focus({ preventScroll: true });
          update(valueAtPointer(event));
        }}
        onPointerMove={(event) => {
          if (!dragRef.current) return;
          // while dragging the thumb follows the pointer exactly
          const next = update(valueAtPointer(event));
          thumb.current.position = fractionOf(next);
          thumb.current.velocity = 0;
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 block size-full [image-rendering:pixelated]" />
        <span
          ref={thumbRef}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-labelledby={label ? labelId : undefined}
          aria-label={label ? undefined : ariaLabel}
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuetext={format(value)}
          aria-disabled={disabled || undefined}
          style={{ left: `calc(9px + (100% - 18px) * ${initialFraction})` }}
          onKeyDown={(event) => {
            if (disabled) return;
            // a page is a tenth of the range, but never less than one step (snapping would undo it)
            const page = Math.max(step, (max - min) / 10);
            const change = keyChange(event.key, step, page);
            let next: number;
            if (change !== null) next = update(valueRef.current + change);
            else if (event.key === "Home" || event.key === "End") next = update(event.key === "Home" ? min : max);
            else return;
            event.preventDefault();
            onCommitRef.current?.(next);
          }}
          className={cn(
            "absolute top-[3px] -ml-[9px] size-[18px] rounded-full bg-lumesec-foreground outline-none transition-[box-shadow] duration-200 ease-[ease]",
            dragging
              ? "shadow-[0_1px_4px_rgb(0_0_0/0.35),0_0_0_2px_var(--lumesec),0_0_0_7px_color-mix(in_srgb,var(--lumesec)_22%,transparent)]"
              : [
                  THUMB_SHADOW,
                  "focus-visible:shadow-[0_1px_4px_rgb(0_0_0/0.35),0_0_0_2px_var(--lumesec),0_0_0_6px_color-mix(in_srgb,var(--lumesec)_30%,transparent)]",
                ],
          )}
        />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[11px] text-muted-foreground">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
      {name ? <input type="hidden" name={name} value={String(value)} disabled={disabled} /> : null}
    </div>
  );
}

/** Value change for a key: a step for the arrow keys, a page for Page Up/Down. */
function keyChange(key: string, step: number, page: number) {
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return step;
    case "ArrowLeft":
    case "ArrowDown":
      return -step;
    case "PageUp":
      return page;
    case "PageDown":
      return -page;
    default:
      return null;
  }
}
