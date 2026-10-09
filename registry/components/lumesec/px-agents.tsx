"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-agents.element";
import type * as ElementModule from "@/components/lumesec/px-agents.element";

/** The `<px-agents>` element, with its properties and methods. */
export type PxAgentsElement = ElementModule.Agents;

export interface PxAgentsProps extends Omit<LumesecElementProps<PxAgentsElement>, "onRun" | "onDone"> {
  /** Fires when a run starts, from the button or from `run()`. */
  onRun?: (event: ElementModule.AgentsEventMap["run"]) => void;
  /** Fires when the verifier finishes. `seconds` is the elapsed run time, rounded to one decimal. */
  onDone?: (event: ElementModule.AgentsEventMap["done"]) => void;
}

/**
 * Agent workflow · `<px-agents>` · LumeSec Elements, Pixel Lab.
 * Animated multi-agent workflow on a pixel canvas: a planner fans work out to four agents and a verifier merges the results.
 *
 * Demo data: The planner, the four agents and their run times are invented; nothing can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-lab/agents
 */
export function PxAgents({ onRun, onDone, ...props }: PxAgentsProps) {
  return useLumesecElement("px-agents", props, {}, { run: onRun, done: onDone });
}
