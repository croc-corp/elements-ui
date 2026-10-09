"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-chips.element";
import type * as ElementModule from "@/components/lumesec/hf-chips.element";

/** The `<hf-chips>` element, with its properties and methods. */
export type HfChipsElement = ElementModule.HChips;

export interface HfChipsProps extends Omit<
  LumesecElementProps<HfChipsElement>,
  "options" | "value" | "label" | "name" | "disabled" | "onChange"
> {
  /** Comma-separated chips as `Label:count`, split at the last colon. The count is optional and shown after the label. Observed: a change rebuilds the chips and keeps the selected labels. Default: `TypeScript:128,Python:96,Rust:41,Go:37,SQL:22,Shell:18,Swift:9`. */
  options?: string;
  /** Comma-separated labels of the selected chips, matched exactly. Observed: a change updates the selection and becomes the selection a form reset restores. Reflects the current selection. Default: `TypeScript,Rust`. */
  value?: string;
  /** Heading text; also labels the chip group. Observed. Default: `Languages`. */
  label?: string;
  /** Form field name used when the element is inside a form. */
  name?: string;
  /** Presence attribute. Disables every chip and Clear; a disabled ancestor `<fieldset>` does the same. A disabled element is not submitted. Default: `false`. */
  disabled?: boolean;
  /** Fires when the user toggles a chip or presses Clear. `value` lists the selected labels in option order. */
  onChange?: (event: ElementModule.HChipsEventMap["change"]) => void;
}

/**
 * Filter chips · `<hf-chips>` · LumeSec Elements, Pixel HD.
 * Multi-select filter chips: selecting floods a chip with dots from the click point and draws a check. Submits one value per chip.
 *
 * Data: Pass your chips and counts as `options` (`Label:count`). Without it the chips show demo languages with invented counts.
 * @see https://elements.lumesec.ai/components/pixel-hd/chips
 */
export function HfChips({ options, value, label, name, disabled, onChange, ...props }: HfChipsProps) {
  return useLumesecElement(
    "hf-chips",
    props,
    { options: options, value: value, label: label, name: name, disabled: disabled },
    { change: onChange },
  );
}
