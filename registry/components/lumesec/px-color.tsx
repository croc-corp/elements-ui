"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-color.element";
import type * as ElementModule from "@/components/lumesec/px-color.element";

/** The `<px-color>` element, with its properties and methods. */
export type PxColorElement = ElementModule.ColorPick;

export interface PxColorProps extends Omit<LumesecElementProps<PxColorElement>, "onChange"> {
  /** Fires when the selected cell or the hue changes, with the colour as lowercase `#rrggbb`. */
  onChange?: (event: ElementModule.ColorPickEventMap["change"]) => void;
}

/**
 * Pixel colour picker · `<px-color>` · LumeSec Elements, Pixel Lab.
 * Colour picker made of pixel cells with a fisheye under the pointer; a new hue ripples across the grid from where you clicked.
 * @see https://elements.lumesec.ai/components/pixel-lab/color
 */
export function PxColor({ onChange, ...props }: PxColorProps) {
  return useLumesecElement(
    "px-color",
    props,
    {},
    { "change": onChange },
  );
}
