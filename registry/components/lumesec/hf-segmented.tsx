"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-segmented.element";
import type * as ElementModule from "@/components/lumesec/hf-segmented.element";

/** The `<hf-segmented>` element, with its properties and methods. */
export type HfSegmentedElement = ElementModule.HSegmented;

export interface HfSegmentedProps extends Omit<
  LumesecElementProps<HfSegmentedElement>,
  "options" | "value" | "label" | "name" | "disabled" | "onChange"
> {
  /** Comma-separated option labels; empty entries are skipped. Observed: a change rebuilds the buttons and keeps the selection when its label is still there. Default: `Chat,Code,Ultracode`. */
  options?: string;
  /** Selected option; must match a label exactly. Falls back to the first option on connect. Observed and reflected; unknown values set later are ignored. */
  value?: string;
  /** Accessible name of the radio group. Observed. Default: `Mode`. */
  label?: string;
  /** Form field name. */
  name?: string;
  /** Presence attribute. Disables the options; a disabled ancestor `<fieldset>` does the same. Default: `false`. */
  disabled?: boolean;
  /** Fires when the user selects a different option. `value` is the option label. Not fired for changes from code. */
  onChange?: (event: ElementModule.HSegmentedEventMap["change"]) => void;
}

/**
 * Segmented control · `<hf-segmented>` · LumeSec Elements, Pixel HD.
 * Segmented radio group whose selected slab stretches toward the new option on a spring. Form-associated; arrow keys move it.
 * @see https://elements.lumesec.ai/components/pixel-hd/segmented
 */
export function HfSegmented({ options, value, label, name, disabled, onChange, ...props }: HfSegmentedProps) {
  return useLumesecElement(
    "hf-segmented",
    props,
    { options: options, value: value, label: label, name: name, disabled: disabled },
    { change: onChange },
  );
}
