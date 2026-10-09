"use client";

import * as React from "react";

import { GeoCoordinate, type GeoCoordinateHandle } from "@/components/lumesec/geo-coordinate";

/** Three notations: a signed decimal pair, degrees and minutes with letters, and a pair separated by a space. */
const EXAMPLES = ["48.8566, 2.3522", "33°52′S 151°12′E", "-22.9068 -43.1729"];

export default function GeoCoordinateDemo() {
  const fieldRef = React.useRef<GeoCoordinateHandle>(null);
  return (
    <div className="grid w-full max-w-[380px] gap-3">
      <GeoCoordinate ref={fieldRef} defaultValue={{ lat: 40.7128, lon: -74.006 }} />
      <div className="flex flex-wrap items-center gap-1.5">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => fieldRef.current?.setText(example)}
            className="h-[30px] cursor-pointer rounded-lg border border-border bg-card px-[11px] font-mono text-[12px] font-medium text-foreground outline-none hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec"
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}
