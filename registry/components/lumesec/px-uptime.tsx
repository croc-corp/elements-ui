"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-uptime.element";
import type * as ElementModule from "@/components/lumesec/px-uptime.element";

/** The `<px-uptime>` element, with its properties and methods. */
export type PxUptimeElement = ElementModule.Uptime;

export interface PxUptimeProps extends Omit<LumesecElementProps<PxUptimeElement>, "data"> {
  /** Daily uptime records, oldest first: percentages or `{ service, date, uptime, status, note }` records (`date` as an ISO string or epoch ms, `uptime` in percent, `status` one of `ok`, `degraded`, `down`). Records with the same `service` form one row; without `service` they share a row named `Uptime`. Observed: changing it redraws. Without it the element shows demo data. */
  data?: readonly ElementModule.PxUptimeDatum[];
}

/**
 * Uptime history · `<px-uptime>` · LumeSec Elements, Pixel Lab.
 * Ninety days of uptime per service as pixel columns swept in on load; hovering a day lifts that column across all services.
 *
 * Data: Pass your daily uptime records per service as `data`. Without it the element shows demo services and statuses.
 * @see https://elements.lumesec.ai/components/pixel-lab/uptime
 */
export function PxUptime({ data, ...props }: PxUptimeProps) {
  return useLumesecElement(
    "px-uptime",
    props,
    { "data": data },
    {},
  );
}
