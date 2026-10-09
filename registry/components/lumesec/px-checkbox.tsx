"use client";

import * as React from "react";

import { clamp } from "@/lib/lumesec/math";
import { prefersReducedMotion } from "@/lib/lumesec/motion";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { SMALL_CHECK } from "@/lib/lumesec/pixel-font";
import { useControllableState, useFormReset } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** Checked, unchecked, or the mixed state of a parent whose children are partly checked. */
export type PxCheckedState = boolean | "indeterminate";

/** Props of `PxCheckbox`. Other `span` props go to the root, which is the checkbox. */
export interface PxCheckboxProps extends Omit<React.ComponentProps<"span">, "defaultChecked" | "onChange"> {
  /** Controlled state. Use with `onCheckedChange`. */
  checked?: PxCheckedState;
  /** Initial state when uncontrolled; also restored on form reset. */
  defaultChecked?: PxCheckedState;
  /** Called when the user toggles the checkbox. Toggling the mixed state checks it. */
  onCheckedChange?: (checked: PxCheckedState) => void;
  /** Value submitted with the form when checked. */
  value?: string;
  /** Form field name. Nothing is submitted while unchecked. */
  name?: string;
  /** Dims the checkbox, ignores click and Space and removes it from the tab order. */
  disabled?: boolean;
}

/** The box pops when it gets checked. */
const POP: Keyframe[] = [{ transform: "scale(.82)" }, { transform: "scale(1.18)", offset: 0.5 }, { transform: "scale(1)" }];

/**
 * Checkbox whose box fills with pixels from the centre and then draws its check, with a mixed state
 * (a dash) for parent and child selections. The label is the children. Click or Space toggles it.
 *
 * @example
 * <PxCheckbox name="notify" value="email" defaultChecked>
 *   Email
 * </PxCheckbox>
 */
export function PxCheckbox({
  checked: checkedProp,
  defaultChecked = false,
  onCheckedChange,
  value = "on",
  name,
  disabled = false,
  className,
  children,
  onClick,
  onKeyDown,
  ...props
}: PxCheckboxProps) {
  const boxRef = React.useRef<HTMLSpanElement>(null);
  const [checked, setChecked] = useControllableState<PxCheckedState>({
    value: checkedProp,
    defaultValue: defaultChecked,
    onChange: onCheckedChange,
  });
  const indeterminate = checked === "indeterminate";
  const filled = checked !== false;
  const fill = React.useRef(filled ? 1 : 0);

  const { ref: canvasRef, redraw } = usePixelCanvas(({ clear, dot, palette, delta }) => {
    const target = filled ? 1 : 0;
    fill.current = prefersReducedMotion() ? target : fill.current + clamp(target - fill.current, -delta * 6, delta * 6);
    const f = fill.current;
    clear();
    // the dotted outline fades as the box fills
    for (let k = 0; k <= 6; k++) {
      const offset = k * 3;
      const alpha = 0.45 * (1 - f) + 0.05;
      dot(offset, 0, palette.foreground, alpha, 2);
      dot(offset, 18, palette.foreground, alpha, 2);
      dot(0, offset, palette.foreground, alpha, 2);
      dot(18, offset, palette.foreground, alpha, 2);
    }
    if (f > 0) {
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          if (Math.hypot(x - 2, y - 2) / 2.83 <= f * 1.15) dot(1 + x * 3.7, 1 + y * 3.7, palette.accent, 1, 3.3);
        }
      }
      if (f > 0.7) {
        const alpha = (f - 0.7) / 0.3;
        if (indeterminate) for (let x = 0; x < 4; x++) dot(5 + x * 2.6, 9, palette.card, alpha, 2.2);
        else for (const [x, y] of SMALL_CHECK) dot(3 + x * 2, 5 + y * 2, palette.card, alpha, 2);
      }
    }
    return Math.abs(f - target) > 0.001;
  });

  React.useEffect(redraw, [checked, redraw]);

  useFormReset(canvasRef, () => setChecked(defaultChecked));

  const toggle = () => {
    if (disabled) return;
    const next = checked !== true;
    setChecked(next);
    const box = boxRef.current;
    if (next && box && !prefersReducedMotion() && typeof box.animate === "function") {
      box.animate(POP, { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
  };

  return (
    <span
      data-slot="px-checkbox"
      data-state={indeterminate ? "indeterminate" : checked ? "checked" : "unchecked"}
      data-disabled={disabled ? "" : undefined}
      role="checkbox"
      tabIndex={disabled ? -1 : 0}
      aria-checked={indeterminate ? "mixed" : checked}
      aria-disabled={disabled || undefined}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) toggle();
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.key !== " " || event.defaultPrevented) return;
        event.preventDefault();
        toggle();
      }}
      className={cn(
        "inline-flex w-fit cursor-pointer items-center gap-2.5 rounded-md p-0.5 align-middle text-[14px] leading-[1.5] text-foreground select-none outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-lumesec",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
      {...props}
    >
      <span ref={boxRef} className="size-5 flex-none">
        <canvas ref={canvasRef} aria-hidden="true" className="block size-5 [image-rendering:pixelated]" />
      </span>
      <span>{children}</span>
      {name && checked === true ? <input type="hidden" name={name} value={value} disabled={disabled} /> : null}
    </span>
  );
}
