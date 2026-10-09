"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-battery.element";
import type * as ElementModule from "@/components/lumesec/px-battery.element";

/** The `<px-battery>` element, with its properties and methods. */
export type PxBatteryElement = ElementModule.Battery;

export interface PxBatteryProps extends Omit<LumesecElementProps<PxBatteryElement>, "onUse" | "onFull"> {
  /** Fires after usage is spent. `left` is the remaining fraction from 0 to 1. */
  onUse?: (event: ElementModule.BatteryEventMap["use"]) => void;
  /** Fires when a reset finishes and the battery is full. */
  onFull?: (event: ElementModule.BatteryEventMap["full"]) => void;
}

/**
 * Usage battery · `<px-battery>` · LumeSec Elements, Pixel Lab.
 * Weekly usage shown as a pixel battery; spending knocks cells loose and resetting runs current along the cable until it is full.
 *
 * Demo data: The usage level starting at 64% and the Monday 09:00 reset time are invented; nothing can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-lab/battery
 */
export function PxBattery({ onUse, onFull, ...props }: PxBatteryProps) {
  return useLumesecElement("px-battery", props, {}, { use: onUse, full: onFull });
}
