import type { Metadata, Viewport } from "next";
import { SITE, absoluteUrl } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: SITE.title,
    template: `%s | ${SITE.name}`,
  },
  description: SITE.description,
  keywords: [...SITE.keywords],
  applicationName: SITE.name,
  authors: [{ name: SITE.author.name, url: SITE.author.url }],
  creator: SITE.author.name,
  publisher: SITE.author.name,
  generator: "Next.js",
  referrer: "strict-origin-when-cross-origin",
  formatDetection: { telephone: false, email: false, address: false },
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      noimageindex: false,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    locale: SITE.locale,
    url: absoluteUrl("/"),
    title: SITE.title,
    description: SITE.shortDescription,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE.title,
    description: SITE.shortDescription,
    creator: "@ryanpolasky",
  },
  category: "music",
  appleWebApp: {
    capable: true,
    title: SITE.shortTitle,
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: SITE.backgroundColor },
    { media: "(prefers-color-scheme: dark)", color: SITE.themeColor },
  ],
  colorScheme: "light dark",
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Person",
      "@id": `${SITE.author.url}#person`,
      name: SITE.author.name,
      url: SITE.author.url,
      sameAs: [SITE.author.linkedin, SITE.author.github],
    },
    {
      "@type": "WebSite",
      "@id": `${SITE.url}/#website`,
      url: `${SITE.url}/`,
      name: SITE.name,
      description: SITE.shortDescription,
      inLanguage: "en",
      creator: { "@id": `${SITE.author.url}#person` },
      author: { "@id": `${SITE.author.url}#person` },
      publisher: { "@id": `${SITE.author.url}#person` },
    },
    {
      "@type": "WebApplication",
      "@id": `${SITE.url}/#app`,
      name: SITE.name,
      alternateName: SITE.title,
      url: `${SITE.url}/`,
      description: SITE.description,
      image: absoluteUrl("/opengraph-image"),
      applicationCategory: "MultimediaApplication",
      applicationSubCategory: "Music Collection Visualization",
      operatingSystem: "Any",
      browserRequirements:
        "Requires JavaScript and a WebGL2-capable modern web browser.",
      inLanguage: "en",
      isPartOf: { "@id": `${SITE.url}/#website` },
      creator: { "@id": `${SITE.author.url}#person` },
      author: { "@id": `${SITE.author.url}#person` },
      publisher: { "@id": `${SITE.author.url}#person` },
      featureList: [
        "3D record shelf rendered with react-three-fiber",
        "Cache-first Discogs collection ingestion",
        "Real album cover art with procedurally generated spines",
        "Centerpiece turntable interaction",
        "In-scene remote controlling an addressable RGB LED strip",
        "Rainy-cafe ambient lighting and wood-grain room",
        "Wikipedia, Last.fm, and OpenRouter-backed album descriptions",
      ],
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
      },
    },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" dir="ltr">
      <head>
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="bg-bg text-ink antialiased">
        {children}
        <noscript>
          <div style={{ padding: "2rem", maxWidth: "42rem", margin: "0 auto" }}>
            <h1>{SITE.title}</h1>
            <p>{SITE.description}</p>
            <p>
              rycord is a WebGL-powered 3D record room. Please enable JavaScript
              in your browser to explore the shelf, pull out records, and use
              the turntable and LED remote.
            </p>
          </div>
        </noscript>
      </body>
    </html>
  );
}
