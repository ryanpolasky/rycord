import { NextRequest, NextResponse } from "next/server";
import { adminAuthorized } from "@/lib/refreshAuth";
import { cleanReleaseId, readCoverOverrides, removeCoverOverride, setCoverOverride } from "@/lib/coverOverrides";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CoverOverrideBody = {
  releaseId?: string | number;
  id?: string | number;
  url?: string;
  remove?: boolean;
};

export async function GET(req: NextRequest) {
  if (!adminAuthorized(req)) {
    return NextResponse.json({ overrides: {}, error: "Admin password is invalid" }, { status: 401 });
  }

  return NextResponse.json({ overrides: await readCoverOverrides() });
}

export async function POST(req: NextRequest) {
  if (!adminAuthorized(req)) {
    return NextResponse.json({ overrides: {}, error: "Admin password is invalid" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({})) as CoverOverrideBody;
    const releaseId = cleanReleaseId(body.releaseId ?? body.id ?? "");
    if (!releaseId) throw new Error("Missing release ID");

    const overrides = body.remove
      ? await removeCoverOverride(releaseId)
      : await setCoverOverride(releaseId, body.url ?? "");
    return NextResponse.json({ overrides });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ overrides: {}, error: message }, { status: 400 });
  }
}
