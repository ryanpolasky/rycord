import "server-only";
import { readJsonCache } from "@/lib/dataCache";

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
    addIds(ids, parseDelimitedIds(process.env[key]));
  }

  try {
    const config = await readJsonCache<HiddenReleaseConfig>("hidden-releases.json");
    if (Array.isArray(config)) {
      addIds(ids, config);
    } else if (config) {
      addIds(ids, config.ids);
      addIds(ids, config.releaseIds);
      addIds(ids, config.hiddenReleaseIds);
    }
  } catch (err) {
    console.warn("[rycord] ignoring invalid hidden-releases.json", err);
  }

  return ids;
}

export async function filterHiddenReleases<T extends { id: string | number }>(releases: T[]): Promise<T[]> {
  const hidden = await hiddenReleaseIds();
  if (hidden.size === 0) return releases;
  return releases.filter((release) => !hidden.has(String(release.id)));
}

function addIds(ids: Set<string>, values: Array<string | number> | undefined): void {
  for (const value of values ?? []) {
    const id = String(value).trim();
    if (id) ids.add(id);
  }
}

function parseDelimitedIds(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(/[\s,]+/).map((id) => id.trim()).filter(Boolean);
}
