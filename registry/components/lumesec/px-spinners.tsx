"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-spinners.element";
import type * as ElementModule from "@/components/lumesec/px-spinners.element";

/** The `<px-spinners>` element, with its properties and methods. */
export type PxSpinnersElement = ElementModule.Spinners;

export interface PxSpinnersProps extends Omit<LumesecElementProps<PxSpinnersElement>, "onFinish"> {
  /** Fires when a loader is finished, by click, Finish all or `finish()`. `loader` is `Orbit`, `Snake`, `Helix`, `Scan`, `Rain` or `Pulse`. */
  onFinish?: (event: ElementModule.SpinnersEventMap["finish"]) => void;
}

/**
 * Pixel loaders · `<px-spinners>` · LumeSec Elements, Pixel Lab.
 * Six pixel loading indicators (orbit, snake, helix, scan, rain, pulse); clicking one finishes it with a check before it restarts.
 * @see https://elements.lumesec.ai/components/pixel-lab/spinners
 */
export function PxSpinners({ onFinish, ...props }: PxSpinnersProps) {
  return useLumesecElement(
    "px-spinners",
    props,
    {},
    { "finish": onFinish },
  );
}
