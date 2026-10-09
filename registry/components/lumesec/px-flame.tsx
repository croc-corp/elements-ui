"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-flame.element";
import type * as ElementModule from "@/components/lumesec/px-flame.element";

/** The `<px-flame>` element, with its properties and methods. */
export type PxFlameElement = ElementModule.Flame;

export interface PxFlameProps extends Omit<LumesecElementProps<PxFlameElement>, "value" | "onChange"> {
  /** Temperature from 0 to 2; values outside are limited to that range. Changing it moves the slider without firing `change`. Default: `0.9`. */
  value?: number;
  /** Fires when a drag ends and on each handled key press, with the temperature in steps of 0.1. */
  onChange?: (event: ElementModule.FlameEventMap["change"]) => void;
}

/**
 * Temperature fire · `<px-flame>` · LumeSec Elements, Pixel Lab.
 * Temperature slider drawn as a pixel fire simulation: low values leave embers, high values burn tall and Wild throws sparks.
 * @see https://elements.lumesec.ai/components/pixel-lab/flame
 */
export function PxFlame({ value, onChange, ...props }: PxFlameProps) {
  return useLumesecElement(
    "px-flame",
    props,
    { "value": value },
    { "change": onChange },
  );
}
