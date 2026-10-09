import { PxTags } from "@/components/lumesec/px-tags";

export default function PxTagsDemo() {
  return (
    <div className="w-full max-w-[400px] rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)]">
      <PxTags
        name="topics"
        label="Topics"
        defaultValue={["design", "pixels"]}
        suggestions={["motion", "accessibility", "forms"]}
        max={6}
      />
    </div>
  );
}
