"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-slider.element";
import type * as ElementModule from "@/components/lumesec/hf-slider.element";

/** The `<hf-slider>` element, with its properties and methods. */
export type HfSliderElement = ElementModule.HSlider;

export interface HfSliderProps extends Omit<LumesecElementProps<HfSliderElement>, "value" | "min" | "max" | "step" | "prefix" | "unit" | "label" | "name" | "disabled" | "onInput" | "onChange"> {
  /** Current value, clamped to `min`–`max` and snapped to `step`. Defaults to `min`. Observed and reflected back with the snapped value; changes from code fire no events. */
  value?: number;
  /** Lower bound. Observed. Default: `0`. */
  min?: number;
  /** Upper bound. Observed. Default: `100`. */
  max?: number;
  /** Step size. Its decimal places also set the displayed precision. Values at or below 0 fall back to 1. Observed. Default: `1`. */
  step?: number;
  /** Text before the displayed value, for example `$`. Observed. */
  prefix?: string;
  /** Text after the displayed value, for example ` ms`. Observed. */
  unit?: string;
  /** Visible label; also names the slider through `aria-labelledby`. Observed. */
  label?: string;
  /** Form field name. */
  name?: string;
  /** Presence attribute. Disables the slider; a disabled ancestor `<fieldset>` does the same. Default: `false`. */
  disabled?: boolean;
  /** Fires on every value change from a drag or key press. Not fired when `value` is set from code. */
  onInput?: (event: ElementModule.HSliderEventMap["input"]) => void;
  /** Fires on pointer release and after each key press that changed the value. */
  onChange?: (event: ElementModule.HSliderEventMap["change"]) => void;
}

/**
 * Slider · `<hf-slider>` · LumeSec Elements, Pixel HD.
 * Form-associated range slider with a dithered fill and a lens for a thumb that magnifies the dots beneath it.
 * @see https://elements.lumesec.ai/components/pixel-hd/slider
 */
export function HfSlider({ value, min, max, step, prefix, unit, label, name, disabled, onInput, onChange, ...props }: HfSliderProps) {
  return useLumesecElement(
    "hf-slider",
    props,
    { "value": value, "min": min, "max": max, "step": step, "prefix": prefix, "unit": unit, "label": label, "name": name, "disabled": disabled },
    { "input": onInput, "change": onChange },
  );
}
