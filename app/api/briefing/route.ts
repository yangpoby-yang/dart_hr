import { buildComparison } from "../../../lib/compare";
import { briefing } from "../../../lib/ai";
import { parseCondition, errorResponse } from "../../../lib/request";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // AI 응답·OpenDART 조회가 수십 초 걸릴 수 있음
// 클라이언트가 보낸 수치가 아니라 조건만 받아 서버에서 다시 계산한 결과를 AI에 전달한다.
export async function POST(req: Request) {
  try {
    const { mode, a, b, year } = parseCondition(await req.json());
    return Response.json(await briefing(await buildComparison(mode, a, b, year)));
  } catch (e) { return errorResponse(e); }
}
