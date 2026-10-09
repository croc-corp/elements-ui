"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-diffusion.element";
import type * as ElementModule from "@/components/lumesec/px-diffusion.element";

/** The `<px-diffusion>` element, with its properties and methods. */
export type PxDiffusionElement = ElementModule.Diffusion;

export interface PxDiffusionProps extends Omit<LumesecElementProps<PxDiffusionElement>, "onStart" | "onDone"> {
  /** Fires when a generation starts, including the automatic first one. `prompt` is `Mountain dusk`, `Moonlit sea` or `Neon city`. */
  onStart?: (event: ElementModule.DiffusionEventMap["start"]) => void;
  /** Fires when the last denoising step completes. */
  onDone?: (event: ElementModule.DiffusionEventMap["done"]) => void;
}

/**
 * Diffusion preview · `<px-diffusion>` · LumeSec Elements, Pixel Lab.
 * Image preview that resolves the way diffusion models do: noise and large blocks sharpen over 30 steps into a scene, different each variation.
 *
 * Demo data: The prompts and images are painted procedurally and no model is involved; nothing can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-lab/diffusion
 */
export function PxDiffusion({ onStart, onDone, ...props }: PxDiffusionProps) {
  return useLumesecElement("px-diffusion", props, {}, { start: onStart, done: onDone });
}
