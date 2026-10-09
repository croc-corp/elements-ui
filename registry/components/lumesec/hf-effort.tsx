"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-effort.element";
import type * as ElementModule from "@/components/lumesec/hf-effort.element";

/** The `<hf-effort>` element, with its properties and methods. */
export type HfEffortElement = ElementModule.HEffort;

export interface HfEffortProps extends Omit<
  LumesecElementProps<HfEffortElement>,
  "value" | "recommended" | "name" | "disabled" | "onInput" | "onChange" | "onUltracode"
> {
  /** Selected level. Observed and reflected; a value set by markup or code is also the level a form reset restores. An unknown value on connect selects `ultracode`; unknown values set later are ignored. Default: `ultracode`. */
  value?: "low" | "medium" | "high" | "xhigh" | "max" | "ultracode";
  /** Level marked `Recommended` under the track. Any other value hides the marker. Observed. Default: `medium`. */
  recommended?: "low" | "medium" | "high" | "xhigh" | "max" | "ultracode";
  /** Form field name. */
  name?: string;
  /** Presence attribute. The slider ignores pointer and keys and leaves the tab order; a disabled ancestor `<fieldset>` does the same. A disabled slider is not submitted. Default: `false`. */
  disabled?: boolean;
  /** Fires each time the level changes during a drag or key press. `label` is the display name. */
  onInput?: (event: ElementModule.HEffortEventMap["input"]) => void;
  /** Fires when a level is committed on pointer release or key press, if it differs from the last committed level. */
  onChange?: (event: ElementModule.HEffortEventMap["change"]) => void;
  /** Fires when the thumb settles on Ultracode after arriving from another level, including programmatic changes. */
  onUltracode?: (event: ElementModule.HEffortEventMap["ultracode"]) => void;
}

/**
 * Effort slider · `<hf-effort>` · LumeSec Elements, Pixel HD.
 * Six-level effort slider; reaching Ultracode bursts and grows a trail of light behind the thumb. Form-associated.
 * @see https://elements.lumesec.ai/components/pixel-hd/effort
 */
export function HfEffort({
  value,
  recommended,
  name,
  disabled,
  onInput,
  onChange,
  onUltracode,
  ...props
}: HfEffortProps) {
  return useLumesecElement(
    "hf-effort",
    props,
    { value: value, recommended: recommended, name: name, disabled: disabled },
    { input: onInput, change: onChange, ultracode: onUltracode },
  );
}
