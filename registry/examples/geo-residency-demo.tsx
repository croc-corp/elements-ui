"use client";

import * as React from "react";

import {
  GeoResidency,
  type ResidencySite,
  type ResidencyTransfer,
  type ResidencyZone,
} from "@/components/lumesec/geo-residency";

const ZONE: ResidencyZone = { label: "Germany", countries: ["DE"] };

/** Three sites in the zone, one in Dublin and one in a us-east region (off the map, pinned to its edge). */
const SITES: readonly ResidencySite[] = [
  { id: "fra", label: "Frankfurt", lat: 50.1109, lon: 8.6821, role: "storage" },
  { id: "ber", label: "Berlin", lat: 52.52, lon: 13.405, role: "processing" },
  { id: "ham", label: "Hamburg", lat: 53.5511, lon: 9.9937, role: "backup" },
  { id: "dub", label: "Dublin", lat: 53.3498, lon: -6.2603, role: "processing" },
  { id: "us-east", label: "us-east", lat: 39.0438, lon: -77.4874, role: "processing" },
];

const TRANSFERS: readonly ResidencyTransfer[] = [
  { id: "fra-ber", from: "fra", to: "ber", volume: 0.7 },
  { id: "fra-ham", from: "fra", to: "ham", volume: 0.35 },
  { id: "ber-dub", from: "ber", to: "dub", volume: 0.5 },
];

/** The export the switch adds: from the Frankfurt store to the us-east region. */
const WITH_ANALYTICS: readonly ResidencyTransfer[] = [...TRANSFERS, { id: "fra-analytics", from: "fra", to: "us-east", volume: 0.6 }];

export default function GeoResidencyDemo() {
  const [analytics, setAnalytics] = React.useState(false);

  return (
    <div className="grid w-full max-w-[660px] gap-3">
      <GeoResidency zone={ZONE} sites={SITES} transfers={analytics ? WITH_ANALYTICS : TRANSFERS} />
      <button
        type="button"
        role="switch"
        aria-checked={analytics}
        onClick={() => setAnalytics((on) => !on)}
        className="group inline-flex h-[30px] cursor-pointer items-center gap-2.5 justify-self-start rounded-lg border-0 bg-transparent px-0.5 font-[inherit] text-[13px] text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec"
      >
        <span
          aria-hidden="true"
          className="relative h-[18px] w-[30px] shrink-0 rounded-full border border-border bg-muted transition-colors duration-200 group-aria-checked:border-lumesec group-aria-checked:bg-lumesec motion-reduce:transition-none"
        >
          <span className="absolute top-px left-px size-3.5 rounded-full bg-card shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-[translate,background-color] duration-200 ease-[cubic-bezier(.2,.8,.2,1)] group-aria-checked:translate-x-3 group-aria-checked:bg-lumesec-foreground motion-reduce:transition-none" />
        </span>
        Send analytics to us-east
      </button>
    </div>
  );
}
