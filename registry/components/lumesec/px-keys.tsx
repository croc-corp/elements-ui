"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-keys.element";
import type * as ElementModule from "@/components/lumesec/px-keys.element";

/** The `<px-keys>` element, with its properties and methods. */
export type PxKeysElement = ElementModule.Keys;

export interface PxKeysProps extends Omit<LumesecElementProps<PxKeysElement>, "onDone"> {
  /** Fires when the typed text matches the target line. `accuracy` is a whole percentage. */
  onDone?: (event: ElementModule.KeysEventMap["done"]) => void;
}

/**
 * Typing heatmap · `<px-keys>` · LumeSec Elements, Pixel Lab.
 * Typing test over a pixel keyboard where each key flashes, ripples to its neighbours, builds heat with use and turns red on a miss.
 * @see https://elements.lumesec.ai/components/pixel-lab/keys
 */
export function PxKeys({ onDone, ...props }: PxKeysProps) {
  return useLumesecElement("px-keys", props, {}, { done: onDone });
}
