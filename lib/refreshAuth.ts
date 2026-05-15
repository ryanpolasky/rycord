import "server-only";
import type { NextRequest } from "next/server";

export function refreshRequested(req: NextRequest): boolean {
  return req.nextUrl.searchParams.get("refresh") === "1";
}

export function refreshAuthorized(req: NextRequest): boolean {
  return adminAuthorized(req);
}

export function adminAuthorized(req: NextRequest): boolean {
  const token = (process.env.RYCORD_ADMIN_PASSWORD ?? process.env.RYCORD_REFRESH_TOKEN)?.trim();
  if (!token) return false;

  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const password = req.headers.get("x-rycord-admin-password")?.trim();
  const header = req.headers.get("x-rycord-refresh-token")?.trim();
  return bearer === token || password === token || header === token;
}
