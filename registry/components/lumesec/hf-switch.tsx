"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-switch.element";
import type * as ElementModule from "@/components/lumesec/hf-switch.element";

/** The `<hf-switch>` element, with its properties and methods. */
export type HfSwitchElement = ElementModule.HSwitch;

export interface HfSwitchProps extends Omit<LumesecElementProps<HfSwitchElement>, "checked" | "value" | "name" | "disabled" | "onChange"> {
  /** Presence attribute. Observed: adding or removing it updates the switch, `aria-checked` and the form value. Default: `false`. */
  checked?: boolean;
  /** Value submitted with the form while checked. Observed. Default: `on`. */
  value?: string;
  /** Form field name. */
  name?: string;
  /** Presence attribute. Disables the switch; a disabled ancestor `<fieldset>` does the same. Default: `false`. */
  disabled?: boolean;
  /** Fires when the user toggles the switch. Not fired when `checked` is set from code. */
  onChange?: (event: ElementModule.HSwitchEventMap["change"]) => void;
}

/**
 * Switch · `<hf-switch>` · LumeSec Elements, Pixel HD.
 * Form-associated switch whose track fills with a dithered energy field when on; the thumb springs across with a few sparks.
 * @see https://elements.lumesec.ai/components/pixel-hd/switch
 */
export function HfSwitch({ checked, value, name, disabled, onChange, ...props }: HfSwitchProps) {
  return useLumesecElement(
    "hf-switch",
    props,
    { "checked": checked, "value": value, "name": name, "disabled": disabled },
    { "change": onChange },
  );
}
