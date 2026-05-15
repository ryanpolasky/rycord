import { NextRequest, NextResponse } from "next/server";
import { adminAuthorized } from "@/lib/refreshAuth";
import { hiddenReleaseIds, parseHiddenReleaseInput, readHiddenReleaseFileIds, writeHiddenReleaseFileIds } from "@/lib/hiddenReleases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HiddenReleaseBody = {
  input?: string;
  ids?: Array<string | number>;
  mode?: "add" | "replace";
};

export async function GET(req: NextRequest) {
  if (!adminAuthorized(req)) {
    return NextResponse.json({ ids: [], allIds: [], error: "Admin password is invalid" }, { status: 401 });
  }

  const ids = await readHiddenReleaseFileIds();
  const allIds = [...await hiddenReleaseIds()].sort((a, b) => Number(a) - Number(b));
  return NextResponse.json({ ids, allIds });
}

export async function POST(req: NextRequest) {
  if (!adminAuthorized(req)) {
    return NextResponse.json({ ids: [], allIds: [], error: "Admin password is invalid" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({})) as HiddenReleaseBody;
    const incoming = new Set<string>();
    for (const id of body.ids ?? []) incoming.add(String(id));
    for (const id of parseHiddenReleaseInput(body.input ?? "")) incoming.add(id);

    const current = body.mode === "replace" ? [] : await readHiddenReleaseFileIds();
    const ids = await writeHiddenReleaseFileIds([...current, ...incoming]);
    const allIds = [...await hiddenReleaseIds()].sort((a, b) => Number(a) - Number(b));
    return NextResponse.json({ ids, allIds });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ids: [], allIds: [], error: message }, { status: 400 });
  }
}
