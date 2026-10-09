"use client";

import * as React from "react";

import { GeoCluster, type ClusterPoint } from "@/components/lumesec/geo-cluster";
import { formatLatLon } from "@/lib/lumesec/geo-data";

export default function GeoClusterDemo() {
  const [point, setPoint] = React.useState<ClusterPoint | null>(null);

  return (
    <div className="grid w-full max-w-[660px] gap-2.5">
      <GeoCluster
        onPointClick={setPoint}
        onValueChange={(id) => {
          if (id === null) setPoint(null);
        }}
      />
      <p
        className="m-0 flex min-h-[18px] items-baseline gap-2 px-1 text-[12.5px] leading-[1.4] text-muted-foreground"
        aria-live="polite"
      >
        {point ? (
          <>
            <span className="font-medium text-foreground">{point.label ?? "Selected location"}</span>
            <span className="font-mono text-[11.5px] tabular-nums">{formatLatLon(point, "decimal", 4)}</span>
          </>
        ) : (
          <span>Select a point to see its name and coordinates.</span>
        )}
      </p>
    </div>
  );
}
