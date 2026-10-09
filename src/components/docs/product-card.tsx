import Link from "next/link";
import type * as React from "react";

import { ArrowRightIcon } from "@/components/icons";
import { ProductMark } from "@/components/site/product-mark";
import type { Product } from "@/config/site";
import { cn } from "@/lib/utils";

/** A quiet line drawing in the card's corner: what the product does, in shapes. */
function ProductGraphic({ id }: { id: string }) {
  const common =
    "pointer-events-none absolute top-7 right-0 h-[88px] w-[140px] [mask-image:radial-gradient(130%_120%_at_100%_0%,black_35%,transparent_75%)]";
  if (id === "securegrid") {
    // lines of a prompt where names and numbers became placeholders
    const rows = [
      [18, 26, 14],
      [30, 12, 22],
      [14, 20, 28],
      [24, 16, 18],
    ];
    return (
      <svg viewBox="0 0 150 96" className={common} aria-hidden>
        {rows.map((row, y) => {
          let x = 22;
          return row.map((w, i) => {
            const el = (
              <rect
                key={`${y}-${i}`}
                x={x}
                y={18 + y * 18}
                width={w * 1.6}
                height={7}
                rx={3.5}
                className={(y + i) % 3 === 1 ? "fill-lumesec/70" : "fill-foreground/12"}
              />
            );
            x += w * 1.6 + 6;
            return el;
          });
        })}
      </svg>
    );
  }
  // the AI Operating Platform: its eight layers, the top one lit
  return (
    <svg viewBox="0 0 150 96" className={common} aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <rect
          key={i}
          x={40 + i * 4}
          y={12 + i * 10}
          width={104 - i * 8}
          height={6}
          rx={3}
          className={i === 0 ? "fill-lumesec/75" : "fill-foreground/12"}
        />
      ))}
    </svg>
  );
}

/** The slot where documentation sites usually run ads: our own products instead. */
export function ProductCard({ product, className }: { product: Product; className?: string }) {
  const external = product.href.startsWith("http");
  const Comp: React.ElementType = external ? "a" : Link;
  return (
    <Comp
      href={product.href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={cn(
        "group/ad relative block overflow-hidden rounded-xl border border-[color-mix(in_oklab,var(--lumesec)_26%,var(--border))] bg-surface/60 p-4 transition-[border-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--lumesec)_48%,var(--border))] hover:shadow-[0_10px_40px_-15px_color-mix(in_oklab,var(--lumesec)_30%,transparent)]",
        className,
      )}
    >
      {/* Electric tint, strongest in the corner with the graphic */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 [background:linear-gradient(to_bottom_right,color-mix(in_oklab,var(--lumesec)_9%,transparent),color-mix(in_oklab,var(--lumesec)_3%,transparent)_35%,transparent_75%)]"
      />
      <ProductGraphic id={product.id} />
      <span className="relative flex items-start justify-between gap-3">
        <ProductMark id={product.id} />
        <span className="font-mono text-[10.5px] text-muted-foreground">From LumeSec</span>
      </span>
      <span className="relative mt-4 block text-[14.5px] font-medium tracking-tight">{product.name}</span>
      <span className="relative mt-0.5 block text-[13px] text-muted-foreground">{product.tagline}</span>
      <span className="relative mt-3 block text-[12.5px] leading-relaxed text-muted-foreground">
        {product.description}
      </span>
      <span className="relative mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border pt-3">
        <span className="font-mono text-[10.5px] text-muted-foreground">{product.meta}</span>
        <span className="ml-auto flex items-center gap-1 text-[12.5px] font-medium whitespace-nowrap">
          {product.cta}
          <ArrowRightIcon
            size={13}
            className="transition-transform duration-300 ease-[var(--ease-expo)] group-hover/ad:translate-x-0.5"
          />
        </span>
      </span>
    </Comp>
  );
}
