"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-status.element";
import type * as ElementModule from "@/components/lumesec/hf-status.element";

/** The `<hf-status>` element, with its properties and methods. */
export type HfStatusElement = ElementModule.HStatus;

export interface HfStatusProps extends Omit<LumesecElementProps<HfStatusElement>, "name" | "incidents" | "state"> {
  /** Service name in the header. Also seeds the generated history. Default: `API`. */
  name?: string;
  /** Comma-separated `daysAgo:kind` entries that force a day's status. `kind` is `down` for a partial outage; any other value means degraded. `0` is today. */
  incidents?: string;
  /** Overrides the status pill. Defaults to today's status. */
  state?: "operational" | "degraded" | "outage";
}

/**
 * Uptime · `<hf-status>` · LumeSec Elements, Pixel HD.
 * Uptime chart of daily bars coloured by incidents, with today pulsing; hover or use the arrow keys to read a day's figures.
 *
 * Demo data: Daily status and uptime are generated from a hash of `name`; only `incidents` and `state` override them. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-hd/status
 */
export function HfStatus({ name, incidents, state, ...props }: HfStatusProps) {
  return useLumesecElement("hf-status", props, { name: name, incidents: incidents, state: state }, {});
}
