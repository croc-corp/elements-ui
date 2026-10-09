"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-charge.element";
import type * as ElementModule from "@/components/lumesec/px-charge.element";

/** The `<px-charge>` element, with its properties and methods. */
export type PxChargeElement = ElementModule.Charge;

export interface PxChargeProps extends Omit<LumesecElementProps<PxChargeElement>, "onGenerate"> {
  /** Fires on release after a long enough hold. `count` is 1 to 4 variations; `charge` is the fill level from 0 to 1, rounded to two decimals. */
  onGenerate?: (event: ElementModule.ChargeEventMap["generate"]) => void;
}

/**
 * Charge to generate · `<px-charge>` · LumeSec Elements, Pixel Lab.
 * Press-and-hold generate button: pixels spiral in as a ring fills, and release fires a shockwave sized to the charge, one to four variations.
 * @see https://elements.lumesec.ai/components/pixel-lab/charge
 */
export function PxCharge({ onGenerate, ...props }: PxChargeProps) {
  return useLumesecElement(
    "px-charge",
    props,
    {},
    { "generate": onGenerate },
  );
}
