import Link from "next/link";

import { ArrowUpRightIcon } from "@/components/icons";
import { LumeSecMark } from "@/components/site/logo";
import { LumeSecLockup } from "@/components/site/lumesec-logo";
import { ThemeSegmented } from "@/components/site/theme";
import { footerLinks, site } from "@/config/site";

const external = (href: string) => /^(https?:|mailto:)/.test(href);

/** The site footer: the LumeSec lockup, link columns, the theme switch and the outlined wordmark. */
export function Footer() {
  return (
    <footer className="px-2">
      <div className="mx-auto max-w-[calc(var(--container)-16px)] in-data-[layout=full]:max-w-none">
        <div className="sl-stripe" aria-hidden />
        <div className="sl-panel grid md:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div className="border-line px-4 py-10 sm:px-8 md:border-r">
            <a
              href={site.company.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${site.company.name}, lumesec.ai`}
              className="inline-block rounded-sm"
            >
              <LumeSecLockup className="w-[150px]" />
            </a>
            <p className="mt-5 max-w-sm text-[14px] leading-6 text-muted-foreground">
              Interactive components from the LumeSec design lab, published as a shadcn registry. Free to use in your
              projects. A product of {site.company.name}.
            </p>
            <a
              href={site.company.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group mt-6 inline-flex items-center gap-1 font-mono text-[12px] text-muted-foreground transition-colors hover:text-foreground"
            >
              lumesec.ai
              <ArrowUpRightIcon
                size={12}
                className="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </a>
          </div>
          {footerLinks.map((col, i) => (
            <div
              key={col.title}
              className={`border-t border-line px-4 py-10 sm:px-8 md:border-t-0 ${i < footerLinks.length - 1 ? "md:border-r" : ""}`}
            >
              <p className="font-mono text-[12px] text-muted-foreground">{col.title}</p>
              <ul className="mt-4 space-y-2.5 text-[14px]">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {external(l.href) ? (
                      <a
                        href={l.href}
                        target={l.href.startsWith("mailto:") ? undefined : "_blank"}
                        rel="noopener noreferrer"
                        className="group inline-flex items-center gap-1 text-foreground/80 transition-colors hover:text-foreground"
                      >
                        {l.label}
                        <ArrowUpRightIcon
                          size={12}
                          className="opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-60"
                        />
                      </a>
                    ) : (
                      <Link href={l.href} className="text-foreground/80 transition-colors hover:text-foreground">
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="sl-panel px-4 py-5 sm:px-8">
          <p className="max-w-3xl text-[13px] leading-5 text-muted-foreground">
            Components are provided as source under the MIT license. Demo data in previews is fictional. Statistics on
            this site are counted without cookies and without personal data.
          </p>
        </div>
        <div className="sl-panel flex flex-col gap-5 px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-4">
            <LumeSecMark className="h-[16px] w-auto text-muted-foreground" />
            <span className="font-mono text-[12px] text-muted-foreground">
              © {new Date().getFullYear()} {site.company.name}
            </span>
          </div>
          <ThemeSegmented />
        </div>
        {/* The outlined wordmark. Drawn as SVG text with the stroke painted under an opaque fill, so the
            overlapping contours of the variable font (the crossbar of the t) never show as inner lines. */}
        <div className="relative overflow-hidden border-x border-border" aria-hidden>
          <svg viewBox="0 0 1200 230" className="block w-full select-none" preserveAspectRatio="xMidYMax meet">
            <text
              x="600"
              y="292"
              textAnchor="middle"
              textLength="1170"
              lengthAdjust="spacing"
              className="fill-background stroke-border font-sans [paint-order:stroke_fill]"
              style={{
                fontSize: 336,
                fontWeight: 500,
                strokeWidth: 3,
                strokeLinejoin: "round",
                letterSpacing: "-0.06em",
              }}
            >
              Elements
            </text>
          </svg>
          <span className="sl-dot-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_top,black,transparent_70%)] opacity-60" />
        </div>
      </div>
    </footer>
  );
}
