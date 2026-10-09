"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-radial.element";
import type * as ElementModule from "@/components/lumesec/hf-radial.element";

/** The `<hf-radial>` element, with its properties and methods. */
export type HfRadialElement = ElementModule.HRadial;

export interface HfRadialProps extends Omit<LumesecElementProps<HfRadialElement>, "label"> {
  /** Heading text. Read once on connect. Default: `Agent hours per month`. */
  label?: string;
}

/**
 * Radial bars · `<hf-radial>` · LumeSec Elements, Pixel HD.
 * Radial bar chart of twelve months, denser toward each tip; hovering or the arrow keys roll a month's value into the centre.
 *
 * Demo data: The monthly values for 2025 and 2026 and the highlighted current month are invented; only `label` can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-hd/radial
 */
export function HfRadial({ label, ...props }: HfRadialProps) {
  return useLumesecElement("hf-radial", props, { label: label }, {});
}
