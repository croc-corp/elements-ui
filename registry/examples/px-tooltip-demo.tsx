import { PxTooltip } from "@/components/lumesec/px-tooltip";

const iconButton = "grid size-9 place-items-center rounded-[9px] border border-border bg-card p-0 text-foreground";
const iconSvg = "size-4 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6]";

export default function PxTooltipDemo() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2.5">
      <PxTooltip content="Copy link">
        <button type="button" className={iconButton} aria-label="Copy link">
          <svg viewBox="0 0 16 16" aria-hidden="true" className={iconSvg}>
            <path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1" />
          </svg>
        </button>
      </PxTooltip>
      <PxTooltip content="Share">
        <button type="button" className={iconButton} aria-label="Share">
          <svg viewBox="0 0 16 16" aria-hidden="true" className={iconSvg}>
            <path d="M8 2.5v7M5 5.5l3-3 3 3M3.5 9v3.5h9V9" />
          </svg>
        </button>
      </PxTooltip>
      <PxTooltip content="Delete" placement="bottom">
        <button type="button" className={iconButton} aria-label="Delete">
          <svg viewBox="0 0 16 16" aria-hidden="true" className={iconSvg}>
            <path d="M2.5 4h11M6 4V2.6h4V4M3.8 4l.7 9.2c.1.8.7 1.3 1.5 1.3h4c.8 0 1.4-.5 1.5-1.3L12.2 4" />
          </svg>
        </button>
      </PxTooltip>
    </div>
  );
}
