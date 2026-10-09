"use client";

import * as React from "react";

import { GeoGlobe, type GeoGlobeHandle, type GlobeConnection } from "@/components/lumesec/geo-globe";
import { DEMO_REGIONS } from "@/lib/lumesec/geo-data";

const BUTTON =
  "h-[30px] cursor-pointer rounded-lg border border-border bg-card px-[11px] text-[12.5px] font-medium text-foreground hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec";

/** The 12 regions the globe shows by default. */
const REGIONS = DEMO_REGIONS.slice(0, 12);

export default function GeoGlobeDemo() {
  const globe = React.useRef<GeoGlobeHandle>(null);
  const burstCount = React.useRef(0);
  const [selected, setSelected] = React.useState<string | null>(null);
  const target = selected ?? "eu-central";

  function sendBurst() {
    const sources = REGIONS.filter((region) => region.id !== target);
    const round = burstCount.current++;
    // six different sources, rotating through the list so every burst looks different
    for (let i = 0; i < 6; i++) {
      const from = sources[(round * 5 + i * 2) % sources.length];
      const connection: GlobeConnection = { id: `burst-${round}-${i}`, from: from.id, to: target };
      globe.current?.push(connection);
    }
  }

  return (
    <div className="w-full">
      <div className="mx-auto grid w-full max-w-[660px] gap-3">
        <GeoGlobe ref={globe} value={selected} onValueChange={setSelected} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BUTTON} onClick={sendBurst}>
            Send burst to {target}
          </button>
          <button type="button" className={BUTTON} onClick={() => globe.current?.flyTo("ap-southeast")}>
            Fly to Singapore
          </button>
          <span className="ml-auto text-[12px] text-muted-foreground">Demo data</span>
        </div>
      </div>
    </div>
  );
}
