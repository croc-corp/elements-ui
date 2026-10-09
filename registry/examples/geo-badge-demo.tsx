"use client";

import * as React from "react";

import { GeoBadge, type GeoBadgeStatus } from "@/components/lumesec/geo-badge";

/** The first badge (a button) cycles through these regions with demo round trips. */
const STOPS = [
  { region: "eu-central", latency: 18 },
  { region: "us-east", latency: 92 },
  { region: "ap-south", latency: 128 },
  { region: "ap-northeast", latency: 236 },
  { region: "sa-east", latency: 194 },
] as const;

const STATUSES: readonly GeoBadgeStatus[] = ["degraded", "outage", "operational"];

const BUTTON_CLASS =
  "h-[30px] cursor-pointer rounded-lg border border-border bg-card px-[11px] font-[inherit] text-[12.5px] font-medium text-foreground outline-none hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec";

export default function GeoBadgeDemo() {
  const [stop, setStop] = React.useState(0);
  const [status, setStatus] = React.useState(0);
  const current = STOPS[stop];
  const switchRegion = () => setStop((index) => (index + 1) % STOPS.length);

  return (
    <div className="grid w-full max-w-[380px] justify-items-center gap-6">
      <div className="grid justify-items-start gap-3">
        <GeoBadge region={current.region} latency={current.latency} status="operational" onClick={switchRegion} />
        <GeoBadge region="us-west" latency={141} status={STATUSES[status]} />
        <GeoBadge region="au-east" size="sm" />
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" className={BUTTON_CLASS} onClick={switchRegion}>
          Switch region
        </button>
        <button
          type="button"
          className={BUTTON_CLASS}
          onClick={() => setStatus((index) => (index + 1) % STATUSES.length)}
        >
          Change status
        </button>
      </div>
    </div>
  );
}
