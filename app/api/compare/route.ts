import { buildComparison } from "../../../lib/compare";
import { parseCondition, errorResponse } from "../../../lib/request";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // AI 응답·OpenDART 조회가 수십 초 걸릴 수 있음
export async function POST(req: Request) {
  try {
    const { mode, a, b, year } = parseCondition(await req.json());
    return Response.json(await buildComparison(mode, a, b, year));
  } catch (e) { return errorResponse(e); }
}
