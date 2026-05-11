import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_DATA_DIR = path.join(process.cwd(), "data");

export function dataRoot(): string {
  return process.env.RYCORD_DATA_DIR?.trim() || DEFAULT_DATA_DIR;
}

export function safeCacheKey(input: string | number): string {
  const safe = String(input)
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160);
  return safe || "empty";
}

export function cachePath(...segments: Array<string | number>): string {
  return path.join(dataRoot(), ...segments.map(safeCacheKey));
}

export async function readJsonCache<T>(...segments: Array<string | number>): Promise<T | null> {
  try {
    const raw = await fs.readFile(cachePath(...segments), "utf8");
    return JSON.parse(raw) as T;
  } catch (err: unknown) {
    if (isMissingFile(err)) return null;
    throw err;
  }
}

export async function writeJsonCache<T>(value: T, ...segments: Array<string | number>): Promise<void> {
  const file = cachePath(...segments);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmp, file);
}

export async function readBinaryCache(...segments: Array<string | number>): Promise<Buffer | null> {
  try {
    return await fs.readFile(cachePath(...segments));
  } catch (err: unknown) {
    if (isMissingFile(err)) return null;
    throw err;
  }
}

export async function writeBinaryCache(value: Buffer, ...segments: Array<string | number>): Promise<void> {
  const file = cachePath(...segments);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, value);
  await fs.rename(tmp, file);
}

export async function deleteCache(...segments: Array<string | number>): Promise<boolean> {
  try {
    await fs.unlink(cachePath(...segments));
    return true;
  } catch (err: unknown) {
    if (isMissingFile(err)) return false;
    throw err;
  }
}

function isMissingFile(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}
