"use client";

import * as React from "react";

import { GeoVisitors, type GeoVisitorsHandle } from "@/components/lumesec/geo-visitors";
import { createRandom, findCity, scatterAround } from "@/lib/lumesec/geo-data";

/** Cities the Burst button takes turns with (demo city ids). */
const BURST_CITIES = ["gru", "nrt", "los", "syd", "bom", "mex"] as const;
const BURST_PAGES = ["/", "/pricing", "/docs/install", "/blog", "/docs", "/changelog"] as const;

export default function GeoVisitorsDemo() {
  const visitors = React.useRef<GeoVisitorsHandle>(null);
  const [turn, setTurn] = React.useState(0);
  const city = findCity(BURST_CITIES[turn % BURST_CITIES.length]);

  function burst() {
    if (!city) return;
    const time = Date.now();
    const random = createRandom(time);
    // eight visits from one city at once: they fall in turn and their rows cascade into the feed
    for (let i = 0; i < 8; i++) {
      const point = scatterAround(random, city, 70, true);
      visitors.current?.push({
        id: `burst-${time}-${i}`,
        lat: point.lat,
        lon: point.lon,
        city: city.name,
        label: BURST_PAGES[Math.floor(random() * BURST_PAGES.length)],
        time,
      });
    }
    setTurn((value) => value + 1);
  }

  return (
    <div className="grid w-full max-w-[660px] gap-3">
      <GeoVisitors ref={visitors} />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={burst}
          className="h-[30px] cursor-pointer rounded-lg border border-border bg-card px-[11px] font-[inherit] text-[12.5px] font-medium text-foreground outline-none hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec"
        >
          Burst from {city?.name}
        </button>
      </div>
    </div>
  );
}
