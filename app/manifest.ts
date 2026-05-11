import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.title,
    short_name: SITE.shortTitle,
    description: SITE.shortDescription,
    lang: "en",
    dir: "ltr",
    categories: ["music", "entertainment", "lifestyle"],
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    theme_color: SITE.themeColor,
    background_color: SITE.backgroundColor,
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
