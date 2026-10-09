"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-number.element";
import type * as ElementModule from "@/components/lumesec/hf-number.element";

/** The `<hf-number>` element, with its properties and methods. */
export type HfNumberElement = ElementModule.HNumber;

export interface HfNumberProps extends Omit<
  LumesecElementProps<HfNumberElement>,
  "value" | "min" | "max" | "label" | "price" | "currency" | "unit" | "name" | "disabled" | "onInput" | "onChange"
> {
  /** Current value, rounded and clamped to `min`–`max`. Observed: a change rolls to the new number without firing events. Reflects the current value. Default: `5`. */
  value?: number;
  /** Lowest allowed value. Observed: a change re-clamps the value. Default: `1`. */
  min?: number;
  /** Highest allowed value. Observed: a change re-clamps the value. Default: `50`. */
  max?: number;
  /** Visible label, associated with the number field. Observed. Default: `Seats`. */
  label?: string;
  /** Unit price. When set, the line below reads `<value> × <currency><price> = <currency><total> / month`. Observed. */
  price?: number;
  /** Currency symbol used with `price`. Observed. Default: `€`. */
  currency?: string;
  /** Text shown below the stepper when `price` is not set. Observed. */
  unit?: string;
  /** Form field name used when the element is inside a form. */
  name?: string;
  /** Presence attribute. Disables the field and buttons; a disabled ancestor `<fieldset>` does the same. Default: `false`. */
  disabled?: boolean;
  /** Fires on each change from the buttons, keys or typed entry. Not fired when `value` is set from code. */
  onInput?: (event: ElementModule.HNumberEventMap["input"]) => void;
  /** Fires 300 ms after the last `input`, so holding a button produces one `change`. */
  onChange?: (event: ElementModule.HNumberEventMap["change"]) => void;
}

/**
 * Number stepper · `<hf-number>` · LumeSec Elements, Pixel HD.
 * Integer stepper whose number rolls over a dotted wash; holding a button repeats faster, and stepping past a limit shakes and flashes red.
 * @see https://elements.lumesec.ai/components/pixel-hd/number
 */
export function HfNumber({
  value,
  min,
  max,
  label,
  price,
  currency,
  unit,
  name,
  disabled,
  onInput,
  onChange,
  ...props
}: HfNumberProps) {
  return useLumesecElement(
    "hf-number",
    props,
    {
      value: value,
      min: min,
      max: max,
      label: label,
      price: price,
      currency: currency,
      unit: unit,
      name: name,
      disabled: disabled,
    },
    { input: onInput, change: onChange },
  );
}
