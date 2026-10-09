"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-terminal.element";
import type * as ElementModule from "@/components/lumesec/hf-terminal.element";

/** The `<hf-terminal>` element, with its properties and methods. */
export type HfTerminalElement = ElementModule.HTerminal;

export interface HfTerminalProps extends Omit<LumesecElementProps<HfTerminalElement>, "autorun" | "onCommand"> {
  /** Command typed automatically 0.9 s after the element first connects. */
  autorun?: string;
  /** Fires when a non-empty command runs, before its output. `command` is trimmed. */
  onCommand?: (event: ElementModule.HTerminalEventMap["command"]) => void;
}

/**
 * Terminal · `<hf-terminal>` · LumeSec Elements, Pixel HD.
 * Simulated shell with phosphor-flash output, dotted progress bars and a glowing block caret; runs a set of built-in demo commands.
 *
 * Demo data: Commands and their output are built-in demo content; `print()` adds your own lines. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-hd/terminal
 */
export function HfTerminal({ autorun, onCommand, ...props }: HfTerminalProps) {
  return useLumesecElement("hf-terminal", props, { autorun: autorun }, { command: onCommand });
}
