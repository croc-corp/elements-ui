"use client";

import { PxButton } from "@/components/lumesec/px-button";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const failAfter = (ms: number) => sleep(ms).then(() => Promise.reject(new Error("Demo failure")));

export default function PxButtonDemo() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-4">
      <PxButton onClick={() => sleep(1300)}>Save changes</PxButton>
      <PxButton variant="secondary" onClick={() => failAfter(1300)}>
        Sync now
      </PxButton>
    </div>
  );
}
