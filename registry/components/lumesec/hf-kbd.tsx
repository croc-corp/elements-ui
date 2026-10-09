"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-kbd.element";
import type * as ElementModule from "@/components/lumesec/hf-kbd.element";

/** The `<hf-kbd>` element, with its properties and methods. */
export type HfKbdElement = ElementModule.HKbd;

export interface HfKbdProps extends Omit<LumesecElementProps<HfKbdElement>, "keys" | "label" | "onTrigger"> {
  /** Key combination separated by `+`. `Mod` is ⌘ on Apple platforms and Ctrl elsewhere. Named keys: `Ctrl`, `Cmd` / `Meta`, `Shift`, `Alt` / `Option`, `Enter`, `Esc` / `Escape`, `Tab`, `Space`, `Up`, `Down`, `Left`, `Right`, `Backspace`; any other name is compared with `KeyboardEvent.key`, ignoring case. Observed: a change rebuilds the keycaps. Default: `Mod+K`. */
  keys?: string;
  /** Text shown beside the keycaps. Observed. */
  label?: string;
  /** Fires when a keydown of one of the keys leaves the whole combination held. Auto-repeat keydowns do not fire it again. `keys` is the raw attribute value, or `null` when the attribute is absent. */
  onTrigger?: (event: ElementModule.HKbdEventMap["trigger"]) => void;
}

/**
 * Shortcut keys · `<hf-kbd>` · LumeSec Elements, Pixel HD.
 * Keycaps drawn in dots with their key names set in type; they press down while the real keys are held and fire `trigger` when the combination is down.
 * @see https://elements.lumesec.ai/components/pixel-hd/kbd
 */
export function HfKbd({ keys, label, onTrigger, ...props }: HfKbdProps) {
  return useLumesecElement(
    "hf-kbd",
    props,
    { "keys": keys, "label": label },
    { "trigger": onTrigger },
  );
}
