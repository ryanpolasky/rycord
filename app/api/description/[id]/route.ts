// short album blurb: wikipedia, then last.fm, then openrouter, cached per release

import { NextRequest, NextResponse } from "next/server";
import { canonicalReleaseId, fetchReleaseDetails } from "@/lib/discogs";
import { readJsonCache, safeCacheKey, writeJsonCache } from "@/lib/dataCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USER_AGENT = "rycord/0.1 +https://rycord.com";
const LASTFM_BASE = "https://ws.audioscrobbler.com/2.0/";
const WIKI_REST_BASE = "https://en.wikipedia.org/api/rest_v1/page/summary";
const WIKI_API_BASE = "https://en.wikipedia.org/w/api.php";
const DEFAULT_OPENROUTER_TIMEOUT_MS = 10_000;

type Source = "lastfm" | "wikipedia" | "ai" | null;

export type DescriptionPayload = {
  text: string;
  source: Source;
  sourceUrl: string | null;
};

type DescriptionCacheFile = DescriptionPayload & {
  id: string;
  artist: string;
  title: string;
  year: string;
  genre: string;
  label: string;
  country: string;
  fetchedAt: string;
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const artist = (url.searchParams.get("artist") ?? "").trim();
  const title = (url.searchParams.get("title") ?? "").trim();
  const year = (url.searchParams.get("year") ?? "").trim();
  const genre = (url.searchParams.get("genre") ?? "").trim();
  const label = (url.searchParams.get("label") ?? "").trim();
  const country = (url.searchParams.get("country") ?? "").trim();

  const releaseId = canonicalReleaseId(id);
  const cacheKey = safeCacheKey(releaseId);
  const cached = await readJsonCache<DescriptionCacheFile>("descriptions", `${cacheKey}.json`);
  if (cached) {
    return NextResponse.json(toPayload(cached));
  }

  // lookups index the canonical title, not "(Deluxe Edition)" style variants
  const cleanTitle = sanitizeTitle(title);
  const cleanArtist = sanitizeArtist(artist);

  const where = `"${cleanArtist} - ${cleanTitle}" (id ${id})`;
  const hasNames = Boolean(cleanArtist && cleanTitle);

  if (hasNames) {
    const fromWiki = await tryWikipedia(cleanArtist, cleanTitle, year).catch((err) => {
      console.warn(`[rycord/description] wikipedia threw for ${where}:`, err);
      return null;
    });
    if (fromWiki) return NextResponse.json(await cacheDescription(cacheKey, releaseId, { artist, title, year, genre, label, country }, fromWiki));

    const fromLastfm = process.env.LASTFM_API_KEY
      ? await tryLastfm(cleanArtist, cleanTitle).catch((err) => {
          console.warn(`[rycord/description] last.fm threw for ${where}:`, err);
          return null;
        })
      : null;
    if (fromLastfm) return NextResponse.json(await cacheDescription(cacheKey, releaseId, { artist, title, year, genre, label, country }, fromLastfm));
    if (!process.env.LASTFM_API_KEY) {
      console.warn(`[rycord/description] skipping last.fm for ${where}: LASTFM_API_KEY not set`);
    }
  }

  if (hasNames && process.env.OPENROUTER_API_KEY) {
    const tracks = await fetchReleaseDetails(releaseId)
      .then((details) => details.tracks.map((track) => track.title).filter(Boolean))
      .catch(() => [] as string[]);
    const aiInput: AiInput = {
      artist: cleanArtist,
      title: cleanTitle,
      year,
      genre,
      label,
      country,
      tracks,
    };
    const fromAi = await tryOpenRouter(aiInput).catch((err) => {
      console.warn(`[rycord/description] openrouter threw for ${where}:`, err);
      return null;
    });
    if (fromAi) {
      return NextResponse.json(await cacheDescription(cacheKey, releaseId, { artist, title, year, genre, label, country }, fromAi));
    }
  } else if (!process.env.OPENROUTER_API_KEY) {
    console.warn(`[rycord/description] skipping ai fallback for ${where}: OPENROUTER_API_KEY not set`);
  }

  console.warn(`[rycord/description] no description from any source for ${where}`);
  const empty: DescriptionPayload = { text: "", source: null, sourceUrl: null };
  return NextResponse.json(await cacheDescription(cacheKey, releaseId, { artist, title, year, genre, label, country }, empty));
}

function toPayload(e: DescriptionPayload): DescriptionPayload {
  return { text: e.text, source: e.source, sourceUrl: e.sourceUrl };
}

async function cacheDescription(
  cacheKey: string,
  releaseId: string,
  meta: Pick<DescriptionCacheFile, "artist" | "title" | "year" | "genre" | "label" | "country">,
  payload: DescriptionPayload,
): Promise<DescriptionPayload> {
  const file: DescriptionCacheFile = {
    id: releaseId,
    ...meta,
    ...payload,
    fetchedAt: new Date().toISOString(),
  };
  await writeJsonCache(file, "descriptions", `${cacheKey}.json`);
  return payload;
}

type LastfmAlbumInfo = {
  album?: {
    name?: string;
    url?: string;
    wiki?: {
      content?: string;
      summary?: string;
    };
  };
  error?: number;
};

async function tryLastfm(artist: string, album: string): Promise<DescriptionPayload | null> {
  const u = new URL(LASTFM_BASE);
  u.searchParams.set("method", "album.getinfo");
  u.searchParams.set("api_key", process.env.LASTFM_API_KEY ?? "");
  u.searchParams.set("artist", artist);
  u.searchParams.set("album", album);
  u.searchParams.set("autocorrect", "1");
  u.searchParams.set("format", "json");

  const r = await fetch(u.toString(), {
    headers: { "User-Agent": USER_AGENT },
    cache: "no-store",
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    console.warn(`[rycord/description] last.fm ${r.status} for "${artist} - ${album}": ${body.slice(0, 200)}`);
    return null;
  }
  const data: LastfmAlbumInfo = await r.json();
  if (data.error) {
    console.warn(`[rycord/description] last.fm error=${data.error} for "${artist} - ${album}"`);
    return null;
  }

  // content is often the whole wikipedia article, summary is a sentence or two
  const raw = data.album?.wiki?.summary ?? data.album?.wiki?.content ?? "";
  const text = cleanLastfmText(raw);
  if (text.length < 40) {
    console.warn(`[rycord/description] last.fm wiki empty/short for "${artist} - ${album}" (${text.length} chars)`);
    return null; // skip tiny/empty entries
  }

  return {
    text,
    source: "lastfm",
    sourceUrl: data.album?.url ?? null,
  };
}

function cleanLastfmText(raw: string): string {
  // 1. Strip the "Read more on Last.fm" anchor + everything after it.
  let s = raw.replace(/<a\s+href="https:\/\/www\.last\.fm[^>]*>.*?<\/a>\s*\.?/gis, "");
  // 2. Strip the User-contributed CC-BY-SA suffix that Last.fm tacks on.
  s = s.replace(/User-contributed text is available under[\s\S]*$/i, "");
  // 3. drop any leftover html tags
  s = s.replace(/<[^>]+>/g, "");
  // 4. Decode the most common HTML entities by hand (no DOMParser server-side).
  s = s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  // 5. Trim trailing whitespace/punctuation noise.
  return s.trim().replace(/\s+$/g, "").replace(/\s{2,}/g, " ");
}

type WikiSummary = {
  type?: string; // "standard" for a real page, "disambiguation" for a hub
  title?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
};

type WikiOpenSearch = [string, string[], string[], string[]];

async function tryWikipedia(artist: string, album: string, year: string): Promise<DescriptionPayload | null> {
  const selfTitled = album.toLowerCase() === artist.toLowerCase();
  const candidates = [
    `${album} (${artist} album)`,
    year ? `${album} (${year} album)` : null,
    selfTitled ? null : `${album} (album)`,
    selfTitled ? null : album,
  ].filter((c): c is string => Boolean(c));

  for (const cand of candidates) {
    const hit = await fetchWikiSummary(cand);
    if (!isUsableAlbumPage(hit, artist, album)) continue;
    return {
      text: (hit.extract ?? "").trim(),
      source: "wikipedia",
      sourceUrl: hit.content_urls?.desktop?.page ?? null,
    };
  }

  const search = `${artist} ${album} album`;
  const os = await fetchOpenSearch(search);
  if (!os || os.length === 0) {
    console.warn(`[rycord/description] wikipedia: opensearch returned 0 hits for "${search}"`);
    return null;
  }
  for (const title of os.slice(0, 5)) {
    const hit = await fetchWikiSummary(title);
    if (!isUsableAlbumPage(hit, artist, album)) continue;
    return {
      text: (hit.extract ?? "").trim(),
      source: "wikipedia",
      sourceUrl: hit.content_urls?.desktop?.page ?? null,
    };
  }
  console.warn(
    `[rycord/description] wikipedia: ${candidates.length} candidates + ${Math.min(5, os.length)}/${os.length} opensearch hits all rejected for "${artist} - ${album}". opensearch sample: [${os.slice(0, 5).join(", ")}]`,
  );
  return null;
}

function isUsableAlbumPage(hit: WikiSummary | null, artist: string, album: string): hit is WikiSummary {
  if (!hit) return false;
  if (hit.type === "disambiguation") return false;
  const extract = (hit.extract ?? "").trim();
  if (extract.length < 60) return false;
  const firstSentence = extract.split(/(?<=[.!?])\s+/, 1)[0]?.toLowerCase() ?? "";
  if (!/\balbum\b/.test(firstSentence)) return false;
  // Sanity-check that the artist name appears somewhere.
  const blob = `${hit.title ?? ""} ${extract}`.toLowerCase();
  const firstArtistWord = artist.toLowerCase().split(/\s+/)[0] ?? "";
  if (firstArtistWord.length >= 3 && !blob.includes(firstArtistWord)) return false;
  // Sanity-check the album name appears too (cheap guard against wrong matches).
  const firstAlbumWord = album.toLowerCase().split(/\s+/)[0] ?? "";
  if (firstAlbumWord.length >= 3 && !blob.includes(firstAlbumWord)) return false;
  return true;
}

async function fetchWikiSummary(title: string): Promise<WikiSummary | null> {
  const r = await fetch(`${WIKI_REST_BASE}/${encodeURIComponent(title)}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    cache: "no-store",
  });
  if (!r.ok) return null;
  return (await r.json()) as WikiSummary;
}

async function fetchOpenSearch(query: string): Promise<string[] | null> {
  const u = new URL(WIKI_API_BASE);
  u.searchParams.set("action", "opensearch");
  u.searchParams.set("search", query);
  u.searchParams.set("limit", "8");
  u.searchParams.set("namespace", "0");
  u.searchParams.set("format", "json");
  const r = await fetch(u.toString(), {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    cache: "no-store",
  });
  if (!r.ok) return null;
  const data = (await r.json()) as WikiOpenSearch;
  // shape: [query, [titles], [descs], [urls]]
  return Array.isArray(data) && Array.isArray(data[1]) ? data[1] : null;
}

type OpenRouterChoice = { message?: { content?: string } };
type OpenRouterErrorMeta = { raw?: string; provider_name?: string; is_byok?: boolean };
type OpenRouterError = { message?: string; code?: number; metadata?: OpenRouterErrorMeta };
type OpenRouterResponse = { choices?: OpenRouterChoice[]; error?: OpenRouterError };

type AiInput = {
  artist: string;
  title: string;
  year: string;
  genre: string;
  label: string;
  country: string;
  tracks: string[];
};

type ChatMessage = { role: "system" | "user"; content: string };

const DEFAULT_MODEL_CHAIN = [
  "openai/gpt-oss-120b:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemma-4-31b-it:free",
  "z-ai/glm-4.5-air:free",
];

// models that recently failed get skipped until their cooldown expires
const MODEL_COOLDOWN_MS = 90_000;
const modelCooldown = new Map<string, number>();
let lastSuccessfulModel: string | null = null;

function isOnCooldown(model: string): boolean {
  const until = modelCooldown.get(model);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    modelCooldown.delete(model);
    return false;
  }
  return true;
}

function markCooldown(model: string): void {
  modelCooldown.set(model, Date.now() + MODEL_COOLDOWN_MS);
}

function noteSuccess(model: string): void {
  lastSuccessfulModel = model;
  modelCooldown.delete(model);
}

function resolveModelChain(): string[] {
  const raw = (process.env.OPENROUTER_MODEL ?? "").trim();
  const base = raw
    ? raw.split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_MODEL_CHAIN;
  if (base.length === 0) return DEFAULT_MODEL_CHAIN;

  // Promote the most-recently-successful model to the head of the chain.
  let ordered = base;
  if (lastSuccessfulModel && base.includes(lastSuccessfulModel)) {
    ordered = [lastSuccessfulModel, ...base.filter((m) => m !== lastSuccessfulModel)];
  }

  const fresh = ordered.filter((m) => !isOnCooldown(m));
  return fresh.length > 0 ? fresh : ordered;
}

function buildAiMessages(input: AiInput): ChatMessage[] {
  const meta = [
    input.year && `released ${input.year}`,
    input.label && `on ${input.label}`,
    input.country && `(${input.country})`,
    input.genre && `genre: ${input.genre}`,
  ]
    .filter(Boolean)
    .join(" · ");

  // box sets would bloat the prompt
  const trackBlock = input.tracks.slice(0, 24)
    .map((t, i) => `${i + 1}. ${t}`)
    .join("\n");

  const system =
    `You write short, factual album blurbs for a record-collection app. ` +
    `3-4 sentences. No flowery language, no hype, no marketing language. ` +
    `Cover: who the artist is, when/where the album sits in their work, what it sounds like, ` +
    `and a single sentence of context (what it's known for or how it was received). ` +
    `If you genuinely don't recognize the album, lean on the metadata/tracklist provided and keep it brief - ` +
    `it's better to say less truthfully than to invent specifics. ` +
    `Never fabricate critic quotes, chart positions, or guest features. ` +
    `Do NOT start with "This album..." - start with the artist or the album name. ` +
    `Plain prose only, no markdown, no bullet points, no headers.`;

  const userMsg = [
    `Album: ${input.title}`,
    `Artist: ${input.artist}`,
    meta && `Metadata: ${meta}`,
    trackBlock && `Tracklist (first ${Math.min(24, input.tracks.length)} tracks):\n${trackBlock}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    { role: "system", content: system },
    { role: "user", content: userMsg },
  ];
}

async function tryOpenRouter(input: AiInput): Promise<DescriptionPayload | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const messages = buildAiMessages(input);

  const models = resolveModelChain();
  const where = `"${input.artist} - ${input.title}"`;

  for (const model of models) {
    const result = await callOpenRouterOnce({ apiKey, model, messages, where });
    if (result) return result;
    // failure already logged inside callOpenRouterOnce; advance to next model
  }

  console.warn(
    `[rycord/description] openrouter: all ${models.length} models in chain failed for ${where} - chain: [${models.join(", ")}]`,
  );
  return null;
}

async function callOpenRouterOnce(opts: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  where: string;
}): Promise<DescriptionPayload | null> {
  const { apiKey, model, messages, where } = opts;

  const timeoutMs = envMs("OPENROUTER_TIMEOUT_MS", DEFAULT_OPENROUTER_TIMEOUT_MS);
  let r: Response;
  try {
    // OpenRouter is OpenAI-API-compatible at this endpoint.
    r = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // optional, but openrouter gives free-tier apps more headroom with them
        "HTTP-Referer": "https://rycord.com",
        "X-Title": "rycord",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 320,
        temperature: 0.4,
      }),
      cache: "no-store",
    }, timeoutMs);
  } catch (err: unknown) {
    console.warn(`[rycord/description] openrouter unavailable/timeout (${model}, ${timeoutMs}ms) for ${where}: ${errorMessage(err)}`);
    markCooldown(model);
    return null;
  }

  if (!r.ok) {
    const body = await r.text().catch(() => "");
    // metadata.raw holds the readable provider message when present
    let detail = body.slice(0, 300);
    try {
      const j = JSON.parse(body) as { error?: OpenRouterError };
      detail = j.error?.metadata?.raw ?? j.error?.message ?? detail;
    } catch {
      /* body wasn't JSON; use raw text */
    }
    console.warn(`[rycord/description] openrouter ${r.status} (${model}) for ${where}: ${detail}`);
    markCooldown(model);
    return null;
  }

  const data: OpenRouterResponse = await r.json();
  if (data.error) {
    const detail = data.error.metadata?.raw ?? data.error.message ?? JSON.stringify(data.error);
    console.warn(`[rycord/description] openrouter error (${model}) for ${where}: ${detail}`);
    markCooldown(model);
    return null;
  }

  const text = (data.choices?.[0]?.message?.content ?? "").trim();
  if (text.length < 60) {
    // a short answer isn't the model failing, so no cooldown
    console.warn(
      `[rycord/description] openrouter short text (${model}, ${text.length} chars) for ${where}: ${JSON.stringify(text).slice(0, 200)}`,
    );
    return null;
  }

  console.log(`[rycord/description] openrouter ✓ (${model}) for ${where}`);
  noteSuccess(model);
  return {
    text: cleanModelOutput(text),
    source: "ai",
    sourceUrl: null,
  };
}

function cleanModelOutput(s: string): string {
  // free models love markdown, "Sure, here is..." prefaces, and signing their work
  return s
    .replace(/^\s*(sure,?\s+here(?:'s| is)[^\n]*\n+)/i, "")
    .replace(/^\s*(here(?:'s| is) (?:a )?(?:short )?(?:blurb|paragraph|description)[^\n]*\n+)/i, "")
    .replace(/^\s*\*+\s*/, "")
    .replace(/\s+$/g, "")
    .trim();
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sanitizeTitle(t: string): string {
  if (!t) return "";
  return t
    .replace(/\s*[(\[][^)\]]*(deluxe|remaster\w*|anniversary|edition|expanded|reissue|bonus|special|version|mono|stereo|live|explicit|clean|hd|original|definitive|director'?s?\s+cut)[^)\]]*[)\]]/gi, "")
    .replace(/\s+-\s+(deluxe|remaster\w*|anniversary edition).*$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeArtist(a: string): string {
  if (!a) return "";
  // discogs appends "(2)" to disambiguate same-name artists
  return a
    .replace(/\s+\(\d+\)$/g, "")
    .replace(/,\s*(the|a|an)$/i, "")
    .trim();
}
