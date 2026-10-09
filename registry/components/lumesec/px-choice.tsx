"use client";

import * as React from "react";

import { mixRgb } from "@/lib/lumesec/math";
import { prefersReducedMotion, springEuler, type Spring } from "@/lib/lumesec/motion";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { SMALL_CHECK } from "@/lib/lumesec/pixel-font";
import { useControllableState, useFormReset } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** One option card. */
export interface PxChoiceOption {
  /** Submitted value. Defaults to `label`. */
  value?: string;
  /** Card title. */
  label: string;
  /** Description under the title. */
  description?: string;
  /** Price line, in monospace. */
  price?: string;
}

/** Props of `PxChoice`. Other `div` props go to the root. */
export interface PxChoiceProps extends Omit<React.ComponentProps<"div">, "children" | "defaultValue" | "onChange"> {
  /** The cards, in order. */
  options: readonly PxChoiceOption[];
  /** Controlled selected value. Use with `onValueChange`. */
  value?: string;
  /** Initially selected value when uncontrolled; also restored on form reset. Defaults to the first option. */
  defaultValue?: string;
  /** Called when a different card is selected. */
  onValueChange?: (value: string) => void;
  /** Label above the cards; names the radio group. */
  label?: React.ReactNode;
  /** Form field name. */
  name?: string;
  /** Dims the group and disables the cards. */
  disabled?: boolean;
}

/** Number of pixels in the selection outline. */
const OUTLINE_PIXELS = 140;

/** Arrow keys move the selection to the next or previous card, in reading order. */
const ARROW_STEPS: Record<string, number | undefined> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

interface OutlinePixel {
  x: Spring;
  y: Spring;
  /** Time in seconds when this pixel starts flying, so the outline streams to the new card. */
  delay: number;
}

/**
 * Radio group rendered as option cards. The selection outline is made of 140 pixels that fly to the newly
 * selected card one after another, then keep circling it. Arrow keys move the selection.
 *
 * @example
 * <PxChoice
 *   name="plan"
 *   label="Plan"
 *   defaultValue="pro"
 *   options={[
 *     { value: "free", label: "Free", description: "For trying things out", price: "€0" },
 *     { value: "pro", label: "Pro", description: "For daily work", price: "€20/mo" },
 *   ]}
 * />
 */
export function PxChoice({
  options,
  value: valueProp,
  defaultValue,
  onValueChange,
  label,
  name,
  disabled = false,
  className,
  ...props
}: PxChoiceProps) {
  const labelId = React.useId();
  const values = options.map((option) => option.value ?? option.label);
  const initialValue = defaultValue ?? values[0] ?? "";
  const [value, setValue] = useControllableState({ value: valueProp, defaultValue: initialValue, onChange: onValueChange });
  const selectedIndex = Math.max(0, values.indexOf(value));

  const cardRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const outline = React.useRef<OutlinePixel[]>([]);
  const laidOut = React.useRef({ width: 0, height: 0 });
  const shownIndex = React.useRef(selectedIndex);

  /** A point at `u` (0 to 1, wrapping) along the outline of card `index`, 1px outside its border. */
  const perimeter = React.useCallback((index: number) => {
    const card = cardRefs.current[index];
    if (!card) return null;
    // the canvas extends 4px past the cards on every side
    const x = card.offsetLeft + 4 - 1;
    const y = card.offsetTop + 4 - 1;
    const width = card.offsetWidth + 2;
    const height = card.offsetHeight + 2;
    const length = 2 * (width + height);
    return (u: number): [number, number] => {
      let d = (((u % 1) + 1) % 1) * length;
      if (d < width) return [x + d, y];
      d -= width;
      if (d < height) return [x + width, y + d];
      d -= height;
      if (d < width) return [x + width - d, y + height];
      d -= width;
      return [x, y + height - d];
    };
  }, []);

  const { ref: canvasRef, redraw } = usePixelCanvas(({ clear, dot, palette, time, delta, width, height }) => {
    const pointAt = perimeter(selectedIndex);
    clear();
    // no cards (yet): nothing to outline
    if (!pointAt) return false;
    if (width !== laidOut.current.width || height !== laidOut.current.height || outline.current.length === 0) {
      // a new size places the outline on the selected card at once
      laidOut.current = { width, height };
      outline.current = Array.from({ length: OUTLINE_PIXELS }, (_, k) => {
        const [x, y] = pointAt(k / OUTLINE_PIXELS);
        return { x: { position: x, velocity: 0 }, y: { position: y, velocity: 0 }, delay: 0 };
      });
    }
    const reduced = prefersReducedMotion();
    let moving = false;
    outline.current.forEach((pixel, k) => {
      const [targetX, targetY] = pointAt(k / OUTLINE_PIXELS + (reduced ? 0 : time * 0.02));
      if (reduced) {
        pixel.x.position = targetX;
        pixel.y.position = targetY;
      } else if (time >= pixel.delay) {
        springEuler(pixel.x, targetX, delta, 160, 0.75);
        springEuler(pixel.y, targetY, delta, 160, 0.75);
      }
      const speed = Math.min(1, Math.hypot(pixel.x.velocity, pixel.y.velocity) / 400);
      if (speed > 0.02) moving = true;
      dot(pixel.x.position - 1.1, pixel.y.position - 1.1, mixRgb(palette.accent, palette.shine, speed), 0.95, 2.2);
    });
    const card = cardRefs.current[selectedIndex];
    if (card && !moving) {
      for (const [x, y] of SMALL_CHECK) {
        dot(card.offsetLeft + 4 + card.offsetWidth - 24 + x * 2, card.offsetTop + 4 + 12 + y * 2, palette.accent, 1, 2);
      }
    }
    // the outline keeps circling unless motion is reduced
    return !reduced;
  });

  // a new selection sends the pixels off one after another
  React.useEffect(() => {
    if (shownIndex.current === selectedIndex) return;
    shownIndex.current = selectedIndex;
    const now = performance.now() / 1000;
    outline.current.forEach((pixel, k) => {
      pixel.delay = now + (k / OUTLINE_PIXELS) * 0.12;
    });
    redraw();
  }, [selectedIndex, redraw]);

  // new or changed cards move the outline (with reduced motion the loop is idle until asked)
  React.useEffect(redraw, [options, redraw]);

  useFormReset(canvasRef, () => setValue(initialValue));

  const select = (index: number) => setValue(values[index]);

  return (
    <div
      data-slot="px-choice"
      data-disabled={disabled ? "" : undefined}
      className={cn("block leading-[1.5] text-foreground", disabled && "pointer-events-none opacity-55", className)}
      {...props}
    >
      <span id={labelId} className="mb-2 block text-[12.5px] font-medium">
        {label}
      </span>
      <div className="relative">
        <div role="radiogroup" aria-labelledby={labelId} className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2.5">
          {options.map((option, index) => {
            const checked = index === selectedIndex;
            return (
              <button
                key={values[index]}
                ref={(node) => {
                  cardRefs.current[index] = node;
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                disabled={disabled}
                onClick={() => select(index)}
                onKeyDown={(event) => {
                  const step = ARROW_STEPS[event.key];
                  if (step === undefined) return;
                  event.preventDefault();
                  const next = (selectedIndex + step + options.length) % options.length;
                  select(next);
                  cardRefs.current[next]?.focus();
                }}
                className={cn(
                  "relative grid cursor-pointer select-none gap-[3px] rounded-[12px] border px-3.5 pt-3.5 pb-3 text-left font-[inherit] text-inherit outline-none transition-[border-color,background-color] duration-200 ease-[ease] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-3 focus-visible:outline-lumesec",
                  checked
                    ? "border-transparent bg-[color-mix(in_srgb,var(--lumesec)_6%,var(--card))]"
                    : "border-border bg-card hover:border-[color-mix(in_srgb,var(--foreground)_25%,var(--border))]",
                )}
              >
                <span className="text-[14px] font-semibold">{option.label}</span>
                {option.description ? <span className="text-[12px] leading-[1.4] text-muted-foreground">{option.description}</span> : null}
                {option.price ? <span className="mt-1.5 font-mono text-[12.5px]">{option.price}</span> : null}
              </button>
            );
          })}
        </div>
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="pointer-events-none absolute -top-1 -left-1 block h-[calc(100%+8px)] w-[calc(100%+8px)] [image-rendering:pixelated]"
        />
      </div>
      {name ? <input type="hidden" name={name} value={values[selectedIndex] ?? ""} disabled={disabled} /> : null}
    </div>
  );
}
