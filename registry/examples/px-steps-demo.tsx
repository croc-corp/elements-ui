import { PxSteps } from "@/components/lumesec/px-steps";

export default function PxStepsDemo() {
  return (
    <div className="w-full max-w-[400px] rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)]">
      <PxSteps steps={["Details", "Billing", "Review", "Done"]} defaultStep={2} controls />
    </div>
  );
}
