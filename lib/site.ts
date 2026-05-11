// Shared site-wide SEO constants. Anything SEO-adjacent (metadata, sitemap,
// robots, manifest, OG images, JSON-LD) should pull from here so there is one
// source of truth for the canonical URL, brand copy, and theme colors.

const rawSiteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://rycord.dev";

export const SITE = {
  url: rawSiteUrl,
  name: "rycord",
  tagline: "my record collection, in 3D.",
  title: "rycord - Ryan's Record Room",
  shortTitle: "rycord",
  description:
    "My Discogs collection rendered as a cache-first 3D record room in a rainy-cafe scene: real cover art, procedural spines, a centerpiece turntable, and an addressable RGB strip controlled by an in-scene remote.",
  shortDescription:
    "My Discogs collection as a 3D record room with real cover art, a turntable, and an RGB strip remote.",
  keywords: [
    "rycord",
    "Ryan Polasky",
    "Ryan Polasky vinyl",
    "Ryan Polasky records",
    "discogs",
    "personal record collection",
    "3d record shelf",
    "record room",
    "vinyl visualization",
    "turntable visualization",
    "three.js portfolio",
    "react three fiber",
    "rainy cafe",
  ],
  locale: "en_US",
  themeColor: "#2d251c",
  backgroundColor: "#e8dfd0",
  author: {
    name: "Ryan Polasky",
    url: "https://ryanpolasky.com/",
    linkedin: "https://www.linkedin.com/in/ryan-polasky/",
    github: "https://github.com/ryanpolasky",
  },
} as const;

export function absoluteUrl(path = "/"): string {
  if (path.startsWith("http")) return path;
  return `${SITE.url}${path.startsWith("/") ? path : `/${path}`}`;
}
