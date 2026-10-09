"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-xypad.element";
import type * as ElementModule from "@/components/lumesec/px-xypad.element";

/** The `<px-xypad>` element, with its properties and methods. */
export type PxXypadElement = ElementModule.XYPad;

export interface PxXypadProps extends Omit<LumesecElementProps<PxXypadElement>, "onInput" | "onChange"> {
  /** Fires continuously while dragging. Values are 0 to 1, rounded to two decimals; `x` is temperature, `y` is top-p. */
  onInput?: (event: ElementModule.XYPadEventMap["input"]) => void;
  /** Fires when the puck settles: on pointer release (snapped to 0.05), on arrow keys and on double-click reset. */
  onChange?: (event: ElementModule.XYPadEventMap["change"]) => void;
}

/**
 * Sampling pad · `<px-xypad>` · LumeSec Elements, Pixel Lab.
 * Two-axis pad for temperature and top-p on a glowing pixel field; on release the puck springs onto the nearest 0.05 step.
 * @see https://elements.lumesec.ai/components/pixel-lab/xypad
 */
export function PxXypad({ onInput, onChange, ...props }: PxXypadProps) {
  return useLumesecElement("px-xypad", props, {}, { input: onInput, change: onChange });
}
