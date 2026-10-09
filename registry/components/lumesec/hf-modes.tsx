"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-modes.element";
import type * as ElementModule from "@/components/lumesec/hf-modes.element";

/** The `<hf-modes>` element, with its properties and methods. */
export type HfModesElement = ElementModule.HModes;

export interface HfModesProps extends Omit<
  LumesecElementProps<HfModesElement>,
  "value" | "name" | "disabled" | "onChange"
> {
  /** Selected mode. Observed and reflected. An unknown value on connect selects `code`; unknown values set later are ignored. Default: `code`. */
  value?: "chat" | "code" | "ultracode";
  /** Form field name. */
  name?: string;
  /** Presence attribute. Disables the cards; a disabled ancestor `<fieldset>` does the same. Default: `false`. */
  disabled?: boolean;
  /** Fires when the user selects a different card. Not fired for programmatic changes. */
  onChange?: (event: ElementModule.HModesEventMap["change"]) => void;
}

/**
 * Mode picker · `<hf-modes>` · LumeSec Elements, Pixel HD.
 * Three mode cards (Chat, Code, Ultracode) on one canvas; the selected card gets an aurora and a comet on its border. Form-associated.
 * @see https://elements.lumesec.ai/components/pixel-hd/modes
 */
export function HfModes({ value, name, disabled, onChange, ...props }: HfModesProps) {
  return useLumesecElement("hf-modes", props, { value: value, name: name, disabled: disabled }, { change: onChange });
}
