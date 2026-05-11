import type { MetadataRoute } from "next";
import { SITE, absoluteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Crawlers have no reason to hit the internal data endpoints; keep
        // them out of the index so API payloads never surface in search.
        disallow: ["/api/"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE.url,
  };
}
