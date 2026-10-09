"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-sketch.element";
import type * as ElementModule from "@/components/lumesec/px-sketch.element";

/** The `<px-sketch>` element, with its properties and methods. */
export type PxSketchElement = ElementModule.Sketch;

export interface PxSketchProps extends Omit<LumesecElementProps<PxSketchElement>, "onChange" | "onClear"> {
  /** Fires at the end of each pointer stroke and after each cell painted or erased with Space or Enter. */
  onChange?: (event: ElementModule.SketchEventMap["change"]) => void;
  /** Fires when the pad is cleared. */
  onClear?: (event: ElementModule.SketchEventMap["clear"]) => void;
}

/**
 * Mirror sketchpad · `<px-sketch>` · LumeSec Elements, Pixel Lab.
 * 16x16 pixel drawing pad with mirror mode for symmetric strokes; cells pop as you paint and Clear drops every pixel with gravity.
 * @see https://elements.lumesec.ai/components/pixel-lab/sketch
 */
export function PxSketch({ onChange, onClear, ...props }: PxSketchProps) {
  return useLumesecElement(
    "px-sketch",
    props,
    {},
    { "change": onChange, "clear": onClear },
  );
}
