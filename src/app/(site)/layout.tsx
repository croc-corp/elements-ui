import { Footer } from "@/components/site/footer";
import { Banner, Header } from "@/components/site/header";
import { collections, totalComponents } from "@/lib/catalog";

/** Banner, header and footer around every page except the bare preview view. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  const nav = collections.map((c) => ({ slug: c.slug, title: c.title, count: c.count }));
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:rounded-md focus:bg-foreground focus:px-3 focus:py-2 focus:text-background">
        Skip to content
      </a>
      <Banner />
      <Header total={totalComponents} collections={nav} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer />
    </>
  );
}
