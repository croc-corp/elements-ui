"use client";

import * as React from "react";

import { GeoIp, type GeoIpHandle } from "@/components/lumesec/geo-ip";

/** Two documentation addresses (IPv4 and IPv6) and a private one, which is answered without a lookup. */
const EXAMPLES = ["203.0.113.42", "2001:db8::1", "192.168.1.20"];

export default function GeoIpDemo() {
  const lookupRef = React.useRef<GeoIpHandle>(null);
  return (
    <div className="grid w-full max-w-[380px] gap-3">
      <GeoIp ref={lookupRef} />
      <div className="flex flex-wrap items-center gap-1.5">
        {EXAMPLES.map((address) => (
          <button
            key={address}
            type="button"
            onClick={() => lookupRef.current?.lookup(address)}
            className="h-[30px] cursor-pointer rounded-lg border border-border bg-card px-[11px] font-mono text-[12px] font-medium text-foreground hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec"
          >
            {address}
          </button>
        ))}
      </div>
      <p className="m-0 text-[12px] leading-[1.45] text-muted-foreground">
        Locations are invented from a hash of the address.
      </p>
    </div>
  );
}
