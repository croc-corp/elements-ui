"use client";

import * as React from "react";

import { PxAvatar } from "@/components/lumesec/px-avatar";
import { PxSkeleton } from "@/components/lumesec/px-skeleton";

const controlButton =
  "h-[30px] rounded-lg border border-border bg-card px-[11px] font-[inherit] text-[12.5px] font-medium text-foreground hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))]";

export default function PxSkeletonDemo() {
  const [loading, setLoading] = React.useState(true);
  const timer = React.useRef(0);

  React.useEffect(() => {
    timer.current = window.setTimeout(() => setLoading(false), 1400);
    return () => window.clearTimeout(timer.current);
  }, []);

  const reload = () => {
    setLoading(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setLoading(false), 1600);
  };

  return (
    <div className="w-full max-w-[400px] rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)]">
      <div className="grid gap-[14px]">
        <PxSkeleton loading={loading} avatar lines={3}>
          <div className="flex items-start gap-4">
            <PxAvatar name="Ada Lovelace" status="online" />
            <div>
              <b>Ada Lovelace</b>
              <div className="mt-1 text-[13px] text-muted-foreground">
                Shared “Notes on the Analytical Engine” in Research. 3 comments, 12 reactions.
              </div>
            </div>
          </div>
        </PxSkeleton>
        <div className="flex flex-wrap justify-center gap-1.5">
          <button type="button" className={controlButton} onClick={reload}>
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
