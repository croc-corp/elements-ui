import { PxChoice } from "@/components/lumesec/px-choice";

export default function PxChoiceDemo() {
  return (
    <div className="w-full max-w-[380px]">
      <PxChoice
        name="plan"
        label="Plan"
        defaultValue="pro"
        options={[
          { value: "free", label: "Free", description: "For trying things out", price: "€0" },
          { value: "pro", label: "Pro", description: "For daily work", price: "€20/mo" },
          { value: "team", label: "Team", description: "Shared projects", price: "€30/user" },
        ]}
      />
    </div>
  );
}
