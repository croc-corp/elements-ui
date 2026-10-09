import { LumeSecMark } from "@/components/site/logo";
import type { ProductId } from "@/config/site";
import { cn } from "@/lib/utils";

/** Small square glyph for a LumeSec product: the mark for the platform, simple drawn glyphs for the rest. */
export function ProductMark({ id, className }: { id: ProductId; className?: string }) {
  const box = "size-9 shrink-0 rounded-[10px] border border-border bg-background";
  const frame = cn("flex items-center justify-center", box, className);
  if (id === "securegrid") {
    return (
      <span className={cn(frame, "font-mono text-[13px] font-semibold")} aria-hidden>
        <span className="text-muted-foreground">[</span>
        <span className="mx-[2px] inline-block size-[7px] bg-foreground" />
        <span className="text-muted-foreground">]</span>
      </span>
    );
  }
  if (id === "aiop") {
    return (
      <span className={frame} aria-hidden>
        <LumeSecMark className="h-[16px] w-auto" />
      </span>
    );
  }
  if (id === "learn") {
    return (
      <span className={frame} aria-hidden>
        <svg
          viewBox="0 0 16 16"
          className="size-[15px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 3.5h4.5A1.5 1.5 0 0 1 8 5v8a1.5 1.5 0 0 0-1.5-1.5H2zM14 3.5H9.5A1.5 1.5 0 0 0 8 5v8a1.5 1.5 0 0 1 1.5-1.5H14z" />
        </svg>
      </span>
    );
  }
  // Elements: a 3x3 component grid
  return (
    <span className={cn("grid grid-cols-3 grid-rows-3 gap-[3px] p-[9px]", box, className)} aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={cn("rounded-[1px] bg-foreground", i % 4 === 0 ? "opacity-100" : "opacity-30")} />
      ))}
    </span>
  );
}
