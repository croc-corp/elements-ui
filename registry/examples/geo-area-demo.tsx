"use client";

import * as React from "react";

import { formatArea, GeoArea, type GeoBounds } from "@/components/lumesec/geo-area";

/** Western and central Europe. */
const EUROPE: GeoBounds = { west: -12, south: 35, east: 30, north: 60 };
/** From 140° E across the date line to 170° W: `east` past 180 continues on the other side of the map. */
const PACIFIC: GeoBounds = { west: 140, south: -20, east: 190, north: 25 };

const BUTTON =
  "h-[30px] cursor-pointer rounded-lg border border-border bg-card px-[11px] font-[inherit] text-[12.5px] font-medium text-foreground outline-none hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec";

export default function GeoAreaDemo() {
  const [area, setArea] = React.useState<GeoBounds | null>(EUROPE);

  return (
    <div className="grid w-full max-w-[660px] gap-3">
      <GeoArea value={area} onValueChange={setArea} label="Event area" />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BUTTON} onClick={() => setArea(EUROPE)}>
          Europe
        </button>
        <button type="button" className={BUTTON} onClick={() => setArea(PACIFIC)}>
          Across the date line
        </button>
        <span className="ml-auto text-[12px] text-muted-foreground">Demo data</span>
      </div>
      <p className="m-0 min-w-0 truncate text-[12.5px] leading-5 text-muted-foreground">
        Committed: <span className="font-mono text-foreground tabular-nums">{area ? formatArea(area) : "no area"}</span>
      </p>
    </div>
  );
}
