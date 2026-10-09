import "./globals.css";

import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";

import { PageViews } from "@/components/site/page-views";
import { SearchProvider } from "@/components/site/search-context";
import { ThemeProvider, themeScript } from "@/components/site/theme";
import { site } from "@/config/site";
import { JsonLd, ogImage, organizationJsonLd, websiteJsonLd } from "@/lib/seo";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: site.title, template: `%s · ${site.name}` },
  description: site.description,
  applicationName: site.name,
  keywords: [...site.keywords],
  authors: [{ name: site.company.name, url: site.company.url }],
  creator: site.company.name,
  publisher: site.company.name,
  category: "technology",
  alternates: { canonical: "/", types: { "text/plain": "/llms.txt" } },
  openGraph: {
    type: "website",
    siteName: site.name,
    title: site.title,
    description: site.description,
    url: site.url,
    locale: "en_US",
    images: ogImage("/", site.title),
  },
  twitter: {
    card: "summary_large_image",
    title: site.title,
    description: site.description,
    images: ogImage("/", site.title),
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <JsonLd data={[organizationJsonLd(), websiteJsonLd()]} />
      </head>
      <body className="flex min-h-dvh flex-col">
        <ThemeProvider>
          <SearchProvider>{children}</SearchProvider>
        </ThemeProvider>
        <PageViews />
      </body>
    </html>
  );
}
