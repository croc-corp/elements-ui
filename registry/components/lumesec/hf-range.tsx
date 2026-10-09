"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-range.element";
import type * as ElementModule from "@/components/lumesec/hf-range.element";

/** The `<hf-range>` element, with its properties and methods. */
export type HfRangeElement = ElementModule.HRange;

export interface HfRangeProps extends Omit<LumesecElementProps<HfRangeElement>, "min" | "max" | "step" | "low" | "high" | "prefix" | "data" | "scale" | "label" | "unitLabel" | "name" | "disabled" | "onInput" | "onChange"> {
  /** Lower bound of the scale. Observed. Default: `0`. */
  min?: number;
  /** Upper bound of the scale. Observed. Default: `500`. */
  max?: number;
  /** Snap increment, counted from `min`. Also the arrow-key step and the minimum gap between the two thumbs. Values at or below 0 fall back to 5. Observed. Default: `5`. */
  step?: number;
  /** Lower value. Defaults to `min` plus 20% of the range, snapped to `step`. Observed: a change moves the thumb without firing events. */
  low?: number;
  /** Upper value. Defaults to `min` plus 70% of the range, snapped to `step`. Observed: a change moves the thumb without firing events. */
  high?: number;
  /** Text before values in the Min and Max fields and in `aria-valuetext`. An empty attribute removes it. Observed. Default: `€`. */
  prefix?: string;
  /** Comma-separated bar heights for the histogram, spread evenly from `min` to `max`. Needs at least four numbers; otherwise a built-in demo distribution of 44 bars is used. Observed. */
  data?: string;
  /** Multiplier from the summed heights of the bars in range to the result count in the header. Observed. Default: `3`. */
  scale?: number;
  /** Heading text. Observed. Default: `Price`. */
  label?: string;
  /** Word after the result count. Observed. Default: `results`. */
  unitLabel?: string;
  /** Form field name. With a name, the form receives `<name>-min` and `<name>-max`. */
  name?: string;
  /** Presence attribute. Disables both thumbs and fields; a disabled ancestor `<fieldset>` does the same. Default: `false`. */
  disabled?: boolean;
  /** Fires on every value change by the user: while dragging, on key presses and when a Min or Max field is committed. Not fired for attribute changes. */
  onInput?: (event: ElementModule.HRangeEventMap["input"]) => void;
  /** Fires when a drag ends, after an arrow, Page, Home or End key press that moved a thumb, and when a Min or Max field is committed with a new value. */
  onChange?: (event: ElementModule.HRangeEventMap["change"]) => void;
}

/**
 * Range filter · `<hf-range>` · LumeSec Elements, Pixel HD.
 * Dual-thumb range filter over a dithered histogram; bars inside the range light up and a result count follows as you drag or type.
 *
 * Data: Pass your histogram as `data` and the count factor as `scale`. Without `data` the histogram is a generated demo distribution.
 * @see https://elements.lumesec.ai/components/pixel-hd/range
 */
export function HfRange({ min, max, step, low, high, prefix, data, scale, label, unitLabel, name, disabled, onInput, onChange, ...props }: HfRangeProps) {
  return useLumesecElement(
    "hf-range",
    props,
    { "min": min, "max": max, "step": step, "low": low, "high": high, "prefix": prefix, "data": data, "scale": scale, "label": label, "unit-label": unitLabel, "name": name, "disabled": disabled },
    { "input": onInput, "change": onChange },
  );
}
