import { UiSegmented } from "@/components/lumesec/ui-segmented";

export default function UiSegmentedDemo() {
  return (
    <div className="grid w-full max-w-[380px] justify-items-center gap-4">
      <UiSegmented options={["Chat", "Code", "Design"]} defaultValue="Chat" label="Mode" />
      <UiSegmented options={["Day", "Week", "Month", "Year"]} defaultValue="Week" label="Range" />
    </div>
  );
}
