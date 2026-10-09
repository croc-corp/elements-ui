import { PxAvatar } from "@/components/lumesec/px-avatar";

export default function PxAvatarDemo() {
  return (
    <div className="flex w-full max-w-[380px] flex-wrap items-center justify-center gap-2.5">
      <div className="flex">
        <PxAvatar name="Ada Lovelace" status="online" size={44} />
        <PxAvatar name="Grace Hopper" status="busy" size={44} className="-ml-[10px]" />
        <PxAvatar name="Alan Turing" status="away" size={44} className="-ml-[10px]" />
        <PxAvatar name="Katherine Johnson" status="offline" size={44} className="-ml-[10px]" />
      </div>
      <PxAvatar name="Margaret Hamilton" shape="square" size={56} />
    </div>
  );
}
