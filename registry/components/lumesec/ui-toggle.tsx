"use client";

import * as React from "react";

import { prefersReducedMotion } from "@/lib/lumesec/motion";
import { BurstLayer, useBurst } from "@/lib/lumesec/sparks";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

export interface UiToggleProps extends Omit<React.ComponentProps<"div">, "onChange"> {
  /** Controlled state. Use with `onCheckedChange`. */
  checked?: boolean;
  /** Initial state when uncontrolled. */
  defaultChecked?: boolean;
  /** Called when the user toggles the switch. Changing `checked` from outside does not call it. */
  onCheckedChange?: (checked: boolean) => void;
  /** Label text. Defaults to "Extended thinking". */
  children?: React.ReactNode;
  /** Secondary text under the label, linked to the switch as its description. */
  hint?: React.ReactNode;
}

/**
 * Switch with a label and hint whose thumb stretches as it travels and pops a few pixel sparks when it
 * turns on. The whole row is clickable; the switch itself is a native button with `role="switch"`.
 *
 * @example
 * <UiToggle defaultChecked hint="Think longer before answering">
 *   Extended thinking
 * </UiToggle>
 */
export function UiToggle({
  checked: checkedProp,
  defaultChecked = false,
  onCheckedChange,
  children,
  hint,
  className,
  onClick,
  ...props
}: UiToggleProps) {
  const [checked, setChecked] = useControllableState({
    value: checkedProp,
    defaultValue: defaultChecked,
    onChange: onCheckedChange,
  });
  const thumbRef = React.useRef<HTMLSpanElement>(null);
  const { ref: sparksRef, fire: fireSparks } = useBurst();
  const sparkTimer = React.useRef(0);
  const labelId = React.useId();
  const hintId = React.useId();
  const state = checked ? "checked" : "unchecked";

  React.useEffect(() => () => window.clearTimeout(sparkTimer.current), []);

  const toggle = () => {
    const on = !checked;
    setChecked(on);
    if (prefersReducedMotion()) return;
    // the thumb stretches to 25px mid-travel, then snaps back to a circle
    thumbRef.current?.animate(
      on
        ? [
            { transform: "translateX(0)", width: "18px" },
            { transform: "translateX(2px)", width: "25px", offset: 0.45 },
            { transform: "translateX(18px)", width: "18px" },
          ]
        : [
            { transform: "translateX(18px)", width: "18px" },
            { transform: "translateX(11px)", width: "25px", offset: 0.45 },
            { transform: "translateX(0)", width: "18px" },
          ],
      { duration: 420, easing: "cubic-bezier(.3,.8,.3,1.1)" },
    );
    if (on) {
      window.clearTimeout(sparkTimer.current);
      // the burst layer extends 40px past the switch: (70, 52) is where the thumb lands
      sparkTimer.current = window.setTimeout(
        () => fireSparks({ x: 40 + 30, y: 40 + 12 }, { count: 18, speed: [50, 170], life: [0.3, 0.7] }),
        170,
      );
    }
  };

  return (
    <div
      data-slot="ui-toggle"
      data-state={state}
      className={cn("flex cursor-pointer items-center justify-between gap-[18px] select-none", className)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) toggle();
      }}
      {...props}
    >
      <span className="grid min-w-0 gap-0.5">
        <span id={labelId} className="text-[14px] leading-normal font-medium text-foreground">
          {children ?? "Extended thinking"}
        </span>
        <span id={hintId} className="text-[12.5px] leading-[1.4] text-muted-foreground">
          {hint}
        </span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={hint ? hintId : undefined}
        data-state={state}
        className="relative h-6 w-[42px] flex-none cursor-pointer rounded-xl border-0 bg-muted p-0 font-[inherit] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_9%,transparent)] outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid"
      >
        <span
          data-state={state}
          className="absolute inset-0 rounded-xl bg-lumesec transition-[clip-path] duration-450 ease-[cubic-bezier(.3,.7,.2,1)] [clip-path:circle(0px_at_12px_12px)] data-[state=checked]:[clip-path:circle(48px_at_30px_12px)]"
        />
        <span
          ref={thumbRef}
          data-state={state}
          className="absolute top-[3px] left-[3px] size-[18px] rounded-[9px] bg-white shadow-[0_1px_3px_rgba(0,0,0,.3)] data-[state=checked]:[transform:translateX(18px)]"
        />
        <BurstLayer ref={sparksRef} />
      </button>
    </div>
  );
}
