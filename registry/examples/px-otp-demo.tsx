import { PxOtp } from "@/components/lumesec/px-otp";

export default function PxOtpDemo() {
  return (
    <div className="w-full max-w-[380px]">
      <PxOtp name="code" code="424242" hint="Demo code: 424242" />
    </div>
  );
}
