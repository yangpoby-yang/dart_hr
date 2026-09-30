import { searchCorps } from "../../../lib/dart";
import { SYNTHETIC_CORPS } from "../../../lib/synthetic";
import { errorResponse } from "../../../lib/request";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // 첫 호출 때 고유번호 ZIP을 내려받음
export async function GET(req: Request) {
  const u = new URL(req.url);
  if (u.searchParams.get("mode") !== "live") return Response.json({ corps: SYNTHETIC_CORPS });
  try { return Response.json({ corps: await searchCorps(u.searchParams.get("q") ?? "") }); }
  catch (e) { return errorResponse(e); }
}
