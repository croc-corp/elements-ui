import { PxNav } from "@/components/lumesec/px-nav";

export default function PxNavDemo() {
  return (
    <div className="w-full max-w-[400px] rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)]">
      <PxNav
        items={[
          { href: "#home", label: "Home", icon: "home" },
          { href: "#chats", label: "Chats", icon: "chat", badge: "3" },
          { href: "#projects", label: "Projects", icon: "folder" },
          { href: "#usage", label: "Usage", icon: "chart" },
          { href: "#team", label: "Team", icon: "users" },
          { href: "#settings", label: "Settings", icon: "gear" },
        ]}
      />
    </div>
  );
}
