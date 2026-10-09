import Link from "next/link";

import { ArrowRightIcon } from "@/components/icons";

/** The 404 page inside the site frame. */
export default function NotFound() {
  return (
    <div className="sl-page">
      <section className="sl-panel sl-open-top">
        <div className="sl-dot-grid grid min-h-[60vh] place-items-center px-4 py-24 text-center">
          <div>
            <p className="font-mono text-[12px] text-muted-foreground">404 · not in the registry</p>
            <h1 className="mt-5 text-[clamp(40px,7vw,88px)] leading-[0.95] font-medium tracking-[-0.05em]">
              Nothing here.
              <br />
              <span className="text-muted-foreground">Yet.</span>
            </h1>
            <div className="mt-10 flex items-center justify-center gap-3">
              <Link href="/components" className="group/b inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-[14px] font-medium text-primary-foreground hover:opacity-90">
                Browse components
                <ArrowRightIcon size={14} className="transition-transform group-hover/b:translate-x-0.5" />
              </Link>
              <Link href="/docs" className="inline-flex h-10 items-center rounded-lg px-4 text-[14px] font-medium text-muted-foreground hover:text-foreground">
                Read the docs
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
