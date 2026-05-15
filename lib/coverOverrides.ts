import "server-only";
import { deleteCachedAssets } from "@/lib/cachedAssets";
import { readJsonCache, safeCacheKey, writeJsonCache } from "@/lib/dataCache";

export type CoverOverrideMap = Record<string, string>;

type CoverOverrideFile = CoverOverrideMap | { overrides?: CoverOverrideMap };

export async function readCoverOverrides(): Promise<CoverOverrideMap> {
  const config = await readJsonCache<CoverOverrideFile>("cover-overrides.json");
  if (!config) return {};
  const source = "overrides" in config ? config.overrides : config;
  const out: CoverOverrideMap = {};
  for (const [id, url] of Object.entries(source ?? {})) {
    const cleanId = cleanReleaseId(id);
    const cleanUrl = cleanCoverUrl(url);
    if (cleanId && cleanUrl) out[cleanId] = cleanUrl;
  }
  return out;
}

export async function coverOverrideFor(id: string | number): Promise<string | null> {
  const overrides = await readCoverOverrides();
  return overrides[cleanReleaseId(id) ?? ""] ?? null;
}

export async function setCoverOverride(id: string | number, url: string): Promise<CoverOverrideMap> {
  const cleanId = cleanReleaseId(id);
  const cleanUrl = cleanCoverUrl(url);
  if (!cleanId) throw new Error("Missing release ID");
  if (!cleanUrl) throw new Error("Cover URL must be http or https");
  const overrides = await readCoverOverrides();
  overrides[cleanId] = cleanUrl;
  await writeJsonCache(overrides, "cover-overrides.json");
  await deleteCachedAssets(cleanId);
  return overrides;
}

export async function removeCoverOverride(id: string | number): Promise<CoverOverrideMap> {
  const cleanId = cleanReleaseId(id);
  if (!cleanId) throw new Error("Missing release ID");
  const overrides = await readCoverOverrides();
  delete overrides[cleanId];
  await writeJsonCache(overrides, "cover-overrides.json");
  await deleteCachedAssets(cleanId);
  return overrides;
}

export async function applyCoverOverrides<T extends { id: string | number; coverImage: string; thumbImage?: string }>(releases: T[]): Promise<Array<T & { coverOverrideUrl?: string }>> {
  const overrides = await readCoverOverrides();
  if (Object.keys(overrides).length === 0) return releases;
  return releases.map((release) => {
    const override = overrides[cleanReleaseId(release.id) ?? ""];
    if (!override) return release;
    return {
      ...release,
      coverImage: override,
      thumbImage: override,
      coverOverrideUrl: override,
    };
  });
}

export function cleanReleaseId(value: string | number): string | null {
  const text = String(value).trim();
  const releaseMatch = text.match(/(?:^|\/)release\/(\d+)/i);
  const id = releaseMatch?.[1] ?? text.match(/^\d+$/)?.[0];
  return id ? safeCacheKey(id) : null;
}

function cleanCoverUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}
