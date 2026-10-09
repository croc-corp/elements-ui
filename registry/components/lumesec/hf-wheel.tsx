"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-wheel.element";
import type * as ElementModule from "@/components/lumesec/hf-wheel.element";

/** The `<hf-wheel>` element, with its properties and methods. */
export type HfWheelElement = ElementModule.HWheel;

export interface HfWheelProps extends Omit<
  LumesecElementProps<HfWheelElement>,
  "value" | "step" | "label" | "name" | "disabled" | "onChange"
> {
  /** Selected time as `HH:MM` (24-hour). Hours clamp to 0–23 and minutes round to the nearest `step`. Observed: a change animates both columns to the new time without firing `change`. Reflects the current selection. Default: `09:30`. */
  value?: string;
  /** Minute increment, rounded and clamped to 1–30. The minute column shows multiples of `step` below 60. Observed: the minute column is rebuilt and the time rounded to the new step. Default: `5`. */
  step?: number;
  /** Text above the wheel; it also names the group of both columns. Observed. Default: `Remind me at`. */
  label?: string;
  /** Form field name used when the element is inside a form. */
  name?: string;
  /** Presence attribute. Disables both columns; a disabled ancestor `<fieldset>` does the same. Default: `false`. */
  disabled?: boolean;
  /** Fires once, after both columns have stopped, when the wheel settles on a new value after a drag, fling, wheel scroll or key press. `value` is `HH:MM`. Not fired when `value` is set from code. */
  onChange?: (event: ElementModule.HWheelEventMap["change"]) => void;
}

/**
 * Time picker wheel · `<hf-wheel>` · LumeSec Elements, Pixel HD.
 * Two-column time picker wheel: rows curve on a cylinder, flings carry inertia and snap to a value that submits as HH:MM.
 * @see https://elements.lumesec.ai/components/pixel-hd/wheel
 */
export function HfWheel({ value, step, label, name, disabled, onChange, ...props }: HfWheelProps) {
  return useLumesecElement(
    "hf-wheel",
    props,
    { value: value, step: step, label: label, name: name, disabled: disabled },
    { change: onChange },
  );
}
