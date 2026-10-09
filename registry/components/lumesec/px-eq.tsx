"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-eq.element";
import type * as ElementModule from "@/components/lumesec/px-eq.element";

/** The `<px-eq>` element, with its properties and methods. */
export type PxEqElement = ElementModule.EQ;

export interface PxEqProps extends Omit<LumesecElementProps<PxEqElement>, "onChange"> {
  /** Fires when a drag ends, on each ArrowUp or ArrowDown press, on a double-click reset and when a preset is chosen. `gains` holds seven target values in dB; `preset` is present only for presets. */
  onChange?: (event: ElementModule.EQEventMap["change"]) => void;
}

/**
 * Equalizer · `<px-eq>` · LumeSec Elements, Pixel Lab.
 * Seven-band pixel equalizer with spring-loaded bands, a smooth curve and a live spectrum behind; presets cascade band by band.
 *
 * Demo data: The spectrum behind the bands is simulated; only the bands are a real control. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-lab/eq
 */
export function PxEq({ onChange, ...props }: PxEqProps) {
  return useLumesecElement(
    "px-eq",
    props,
    {},
    { "change": onChange },
  );
}
