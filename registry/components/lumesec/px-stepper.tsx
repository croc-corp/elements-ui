"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-stepper.element";
import type * as ElementModule from "@/components/lumesec/px-stepper.element";

/** The `<px-stepper>` element, with its properties and methods. */
export type PxStepperElement = ElementModule.Stepper;

export interface PxStepperProps extends Omit<LumesecElementProps<PxStepperElement>, "onChange" | "onComplete"> {
  /** Fires when the snake arrives at a step. `step` is 1-based. */
  onChange?: (event: ElementModule.StepperEventMap["change"]) => void;
  /** Fires when Finish is pressed on the last step. */
  onComplete?: (event: ElementModule.StepperEventMap["complete"]) => void;
}

/**
 * Snake stepper · `<px-stepper>` · LumeSec Elements, Pixel Lab.
 * Five-step onboarding progress drawn as a pixel snake that circles the current step, slithers to the next, eats it and grows.
 *
 * Demo data: The five onboarding steps and their subtitles are fixed demo content; nothing can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-lab/stepper
 */
export function PxStepper({ onChange, onComplete, ...props }: PxStepperProps) {
  return useLumesecElement(
    "px-stepper",
    props,
    {},
    { "change": onChange, "complete": onComplete },
  );
}
