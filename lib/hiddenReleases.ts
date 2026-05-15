import "server-only";
import { readJsonCache, safeCacheKey, writeJsonCache } from "@/lib/dataCache";

const ENV_KEYS = ["RYCORD_HIDDEN_RELEASE_IDS", "DISCOGS_HIDDEN_RELEASE_IDS"];

type HiddenReleaseConfig =
  | Array<string | number>
  | {
      ids?: Array<string | number>;
      releaseIds?: Array<string | number>;
      hiddenReleaseIds?: Array<string | number>;
    };

export async function hiddenReleaseIds(): Promise<Set<string>> {
  const ids = new Set<string>();

  for (const key of ENV_KEYS) {
    addIds(ids, parseHiddenReleaseInput(process.env[key] ?? ""));
  }

  addIds(ids, await readHiddenReleaseFileIds());

  return ids;
}

export async function readHiddenReleaseFileIds(): Promise<string[]> {
  try {
    const config = await readJsonCache<HiddenReleaseConfig>("hidden-releases.json");
    const ids = new Set<string>();
    if (Array.isArray(config)) {
      addIds(ids, config);
    } else if (config) {
      addIds(ids, config.ids);
      addIds(ids, config.releaseIds);
      addIds(ids, config.hiddenReleaseIds);
    }
    return [...ids].sort((a, b) => Number(a) - Number(b));
  } catch (err) {
    console.warn("[rycord] ignoring invalid hidden-releases.json", err);
    return [];
  }
}

export async function writeHiddenReleaseFileIds(values: Array<string | number>): Promise<string[]> {
  const ids = new Set<string>();
  addIds(ids, values);
  const sorted = [...ids].sort((a, b) => Number(a) - Number(b));
  await writeJsonCache(sorted, "hidden-releases.json");
  return sorted;
}

export function parseHiddenReleaseInput(input: string): string[] {
  const ids = new Set<string>();
  for (const token of input.split(/[\s,]+/)) {
    const trimmed = token.trim();
    const releaseMatch = trimmed.match(/(?:^|\/)release\/(\d+)/i);
    const numericMatch = trimmed.match(/^\d+$/);
    const id = releaseMatch?.[1] ?? numericMatch?.[0];
    if (id) ids.add(safeCacheKey(id));
  }
  return [...ids];
}

export async function filterHiddenReleases<T extends { id: string | number }>(releases: T[]): Promise<T[]> {
  const hidden = await hiddenReleaseIds();
  if (hidden.size === 0) return releases;
  return releases.filter((release) => !hidden.has(String(release.id)));
}

function addIds(ids: Set<string>, values: Array<string | number> | undefined): void {
  for (const value of values ?? []) {
    const id = safeCacheKey(value);
    if (id) ids.add(id);
  }
}
