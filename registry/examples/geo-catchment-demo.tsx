"use client";

import * as React from "react";

import { CATCHMENT_DEMO_SITES, GeoCatchment } from "@/components/lumesec/geo-catchment";

const ALL_SITES = CATCHMENT_DEMO_SITES.map((site) => site.id);

export default function GeoCatchmentDemo() {
  const [active, setActive] = React.useState<readonly string[]>(ALL_SITES);
  // the site the last outage took down; the next outage brings it back
  const [down, setDown] = React.useState<string | null>(null);

  function randomOutage() {
    const candidates = active.filter((id) => id !== down);
    if (candidates.length === 0) return;
    const victim = candidates[Math.floor(Math.random() * candidates.length)];
    const next = new Set(active);
    next.delete(victim);
    if (down) next.add(down);
    setActive(ALL_SITES.filter((id) => next.has(id)));
    setDown(victim);
  }

  return (
    <div className="w-full">
      <div className="mx-auto grid w-full max-w-[660px] gap-3">
        <GeoCatchment active={active} onActiveChange={setActive} defaultValue="fra" />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={randomOutage}
            className="h-[30px] cursor-pointer rounded-lg border border-border bg-card px-[11px] font-[inherit] text-[12.5px] font-medium text-foreground transition-colors outline-none hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid"
          >
            Random outage
          </button>
        </div>
      </div>
    </div>
  );
}
