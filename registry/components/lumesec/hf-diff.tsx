"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-diff.element";
import type * as ElementModule from "@/components/lumesec/hf-diff.element";

/** The `<hf-diff>` element, with its properties and methods. */
export type HfDiffElement = ElementModule.HDiff;

export interface HfDiffProps extends Omit<LumesecElementProps<HfDiffElement>, "onResolve"> {
  /** Fires when a hunk is accepted or rejected. `hunk` is its zero-based index. Accept all fires once per open hunk. */
  onResolve?: (event: ElementModule.HDiffEventMap["resolve"]) => void;
}

/**
 * Diff review · `<hf-diff>` · LumeSec Elements, Pixel HD.
 * Unified diff reviewer with dithered add and remove tints and a minimap; accepting or rejecting a hunk dissolves the dropped lines.
 *
 * Data: Pass your unified diff as the element's text content. Without it a built-in sample diff is shown.
 * @see https://elements.lumesec.ai/components/pixel-hd/diff
 */
export function HfDiff({ onResolve, ...props }: HfDiffProps) {
  return useLumesecElement(
    "hf-diff",
    props,
    {},
    { "resolve": onResolve },
  );
}
