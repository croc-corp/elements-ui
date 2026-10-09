"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-orb.element";
import type * as ElementModule from "@/components/lumesec/px-orb.element";

/** The `<px-orb>` element, with its properties and methods. */
export type PxOrbElement = ElementModule.Orb;

export interface PxOrbProps extends Omit<LumesecElementProps<PxOrbElement>, "state" | "onChange"> {
  /** Agent state; an unknown value shows `thinking`. Changing it dissolves to the new state without firing `change`. Default: `thinking`. */
  state?: "idle" | "listening" | "thinking" | "working" | "error" | "done";
  /** Fires when the state changes through a click, a key or `set()`; not for the initial state or a change of the `state` attribute. */
  onChange?: (event: ElementModule.OrbEventMap["change"]) => void;
}

/**
 * Status orb · `<px-orb>` · LumeSec Elements, Pixel Lab.
 * Pixel disc showing an agent's state (idle, listening, thinking, working, error, done), dissolving cell by cell between states.
 *
 * Data: Set the agent's state with `state`. Without it the orb starts at `thinking`.
 * @see https://elements.lumesec.ai/components/pixel-lab/orb
 */
export function PxOrb({ state, onChange, ...props }: PxOrbProps) {
  return useLumesecElement(
    "px-orb",
    props,
    { "state": state },
    { "change": onChange },
  );
}
