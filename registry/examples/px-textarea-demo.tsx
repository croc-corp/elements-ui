import { PxTextarea } from "@/components/lumesec/px-textarea";

export default function PxTextareaDemo() {
  return (
    <div className="w-full rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)]">
      <PxTextarea name="bio" label="Short bio" limit={120} placeholder="A sentence or two about you" />
    </div>
  );
}
