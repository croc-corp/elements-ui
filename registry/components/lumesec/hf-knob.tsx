"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-knob.element";
import type * as ElementModule from "@/components/lumesec/hf-knob.element";

/** The `<hf-knob>` element, with its properties and methods. */
export type HfKnobElement = ElementModule.HKnob;

export interface HfKnobProps extends Omit<LumesecElementProps<HfKnobElement>, "value" | "min" | "max" | "step" | "unit" | "label" | "name" | "disabled" | "onInput" | "onChange"> {
  /** Value, clamped to `min`–`max` and snapped to `step`. Observed: a change moves the knob without events. Also the value a form reset restores. Default: `50`. */
  value?: number;
  /** Lower bound. Observed. Default: `0`. */
  min?: number;
  /** Upper bound. Observed. Default: `100`. */
  max?: number;
  /** Step size for drag, wheel and keys; a zero or negative step counts as 1. Its decimal places also set the displayed precision. Observed. Default: `1`. */
  step?: number;
  /** Text after the displayed value, for example ` dB`. Observed. */
  unit?: string;
  /** Text under the value; also the slider `aria-label`. Observed. Default: `Gain`. */
  label?: string;
  /** Form field name. */
  name?: string;
  /** Presence attribute. The knob ignores pointer, wheel and keys and leaves the tab order; a disabled ancestor `<fieldset>` does the same. A disabled knob is not submitted. Default: `false`. */
  disabled?: boolean;
  /** Fires on every value change from drag, wheel or keys. */
  onInput?: (event: ElementModule.HKnobEventMap["input"]) => void;
  /** Fires on pointer release and on each wheel step or key press. */
  onChange?: (event: ElementModule.HKnobEventMap["change"]) => void;
}

/**
 * Knob · `<hf-knob>` · LumeSec Elements, Pixel HD.
 * Form-associated rotary knob drawn as a dithered sphere with an arc of lit cells; set it by drag, scroll wheel or arrow keys.
 * @see https://elements.lumesec.ai/components/pixel-hd/knob
 */
export function HfKnob({ value, min, max, step, unit, label, name, disabled, onInput, onChange, ...props }: HfKnobProps) {
  return useLumesecElement(
    "hf-knob",
    props,
    { "value": value, "min": min, "max": max, "step": step, "unit": unit, "label": label, "name": name, "disabled": disabled },
    { "input": onInput, "change": onChange },
  );
}
