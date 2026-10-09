"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-model.element";
import type * as ElementModule from "@/components/lumesec/px-model.element";

/** The `<px-model>` element, with its properties and methods. */
export type PxModelElement = ElementModule.ModelMorph;

export interface PxModelProps extends Omit<LumesecElementProps<PxModelElement>, "onChange"> {
  /** Fires when the user picks a model. `model` is `Swift`, `Balanced` or `Deep`. Not fired for the initial selection. */
  onChange?: (event: ElementModule.ModelMorphEventMap["change"]) => void;
}

/**
 * Model morph · `<px-model>` · LumeSec Elements, Pixel Lab.
 * Model picker where one pixel swarm morphs between a diamond, a ring and a rotating star, with speed, depth and cost bars.
 *
 * Demo data: The three models and their speed, depth and cost scores are invented; nothing can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-lab/model
 */
export function PxModel({ onChange, ...props }: PxModelProps) {
  return useLumesecElement(
    "px-model",
    props,
    {},
    { "change": onChange },
  );
}
