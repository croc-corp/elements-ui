"use client";

import * as React from "react";

import { PxProgress } from "@/components/lumesec/px-progress";

const controlButton =
  "h-[30px] rounded-lg border border-border bg-card px-[11px] font-[inherit] text-[12.5px] font-medium text-foreground hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))]";

export default function PxProgressDemo() {
  const [upload, setUpload] = React.useState(0);
  const ticker = React.useRef(0);

  // start part-way, so the bar glides on first view
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => setUpload(38));
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(ticker.current);
    };
  }, []);

  const startUpload = () => {
    let progress = 0;
    window.clearInterval(ticker.current);
    setUpload(0);
    ticker.current = window.setInterval(() => {
      progress = Math.min(100, progress + 2 + Math.random() * 5);
      setUpload(Math.round(progress));
      if (progress >= 100) window.clearInterval(ticker.current);
    }, 120);
  };

  return (
    <div className="grid w-full max-w-[380px] gap-[14px]">
      <PxProgress value={upload} label="Uploading dataset" doneLabel="Upload complete" />
      <PxProgress label="Indexing" />
      <div className="flex flex-wrap justify-center gap-1.5">
        <button type="button" className={controlButton} onClick={startUpload}>
          Start upload
        </button>
      </div>
    </div>
  );
}
