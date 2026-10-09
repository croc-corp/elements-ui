import { LumeSecWordmark } from "@/components/site/lumesec-logo";
import { cn } from "@/lib/utils";

/** The LumeSec shield-and-bars mark. Never redrawn; this is the asset path data. */
export function LumeSecMark({ className, title = "LumeSec" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 83 85" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} role="img" aria-label={title}>
      <title>{title}</title>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M0.408654 80.4891C-0.15613 80.8684 -0.159018 81.4974 0.547756 81.747C0.737537 81.8141 0.935505 81.8735 1.14097 81.9249C9.19351 83.9384 39.8218 89.683 58.4486 77.1724L80.6146 62.2848C82.4633 61.0432 82.8394 59.1274 81.5322 57.6112L65.218 38.6897C64.742 38.1376 63.6118 38.0393 62.9386 38.4914L56.8676 42.5689C56.4094 42.8767 56.3126 43.3506 56.6308 43.7286L68.3009 57.5916C68.93 58.3468 68.6523 59.3452 67.7392 59.9585L50.2487 71.7058C44.0562 75.865 35.6422 77.2031 26.6312 76.9928C20.3151 76.8453 13.8243 76.3456 9.70017 75.494C8.97887 75.345 8.10795 75.3179 7.57458 75.6761L0.408654 80.4891Z"
        fill="currentColor"
      />
      <path d="M19.3029 31.634C19.8689 31.2566 20.3278 31.5022 20.3278 32.1825L20.3278 65.1939C20.3278 65.8743 19.8689 66.7317 19.3029 67.1091L10.2659 73.1338C9.6998 73.5112 9.2409 73.2656 9.2409 72.5852L9.2409 39.5738C9.2409 38.8935 9.6998 38.036 10.2659 37.6586L19.3029 31.634Z" fill="currentColor" />
      <path d="M36.5492 0.177086C37.1153 -0.200303 37.5742 0.0452932 37.5742 0.725641V53.6964C37.5742 54.3768 37.1153 55.2343 36.5492 55.6117L27.5123 61.6362C26.9463 62.0136 26.4874 61.768 26.4874 61.0876L26.4874 8.11684C26.4874 7.43649 26.9463 6.57902 27.5124 6.20163L36.5492 0.177086Z" fill="currentColor" />
      <path d="M53.7955 3.18262C54.3616 2.80523 54.8205 3.05082 54.8205 3.73117V42.1989C54.8205 42.8792 54.3616 43.7367 53.7955 44.1141L44.7585 50.1387C44.1925 50.5161 43.7336 50.2705 43.7336 49.5901V11.1224C43.7336 10.4421 44.1925 9.58463 44.7585 9.20724L53.7955 3.18262Z" fill="currentColor" />
    </svg>
  );
}

/** Site lockup: the LumeSec mark and wordmark, with the product name set beneath the wordmark. */
export function ElementsLogo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LumeSecMark className="h-[24px] w-auto shrink-0" />
      <span className={cn("flex-col items-start", compact ? "hidden" : "flex")}>
        <LumeSecWordmark className="w-[86px]" />
        <span className="mt-[5px] text-[12px] leading-none font-medium tracking-[0.01em] text-muted-foreground">Elements</span>
      </span>
    </span>
  );
}
