"use client";

import * as React from "react";

import { PxEmpty, type PxEmptyKind } from "@/components/lumesec/px-empty";

const controlButton =
  "h-[30px] rounded-lg border border-border bg-card px-[11px] font-[inherit] text-[12.5px] font-medium text-foreground hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))]";

const KINDS: Array<{ kind: PxEmptyKind; label: string }> = [
  { kind: "inbox", label: "Inbox" },
  { kind: "search", label: "Search" },
  { kind: "error", label: "Error" },
  { kind: "done", label: "Done" },
];

export default function PxEmptyDemo() {
  const [kind, setKind] = React.useState<PxEmptyKind>("search");

  return (
    <div className="grid w-full max-w-[380px] gap-[14px]">
      <PxEmpty kind={kind}>
        <button type="button" className={controlButton}>
          Clear search
        </button>
      </PxEmpty>
      <div className="flex flex-wrap justify-center gap-1.5">
        {KINDS.map((item) => (
          <button
            key={item.kind}
            type="button"
            aria-pressed={kind === item.kind}
            className={controlButton}
            onClick={() => setKind(item.kind)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
