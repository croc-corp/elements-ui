import { PxSelect } from "@/components/lumesec/px-select";

export default function PxSelectDemo() {
  return (
    <div className="w-full max-w-[400px] rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)]">
      <PxSelect
        name="model"
        label="Model"
        hint="You can change this per chat"
        defaultValue="medium"
        options={[
          { value: "large", label: "Large", description: "Most capable" },
          { value: "medium", label: "Medium", description: "Balanced" },
          { value: "small", label: "Small", description: "Fastest" },
        ]}
      />
    </div>
  );
}
