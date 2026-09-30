import { buildComparison } from "../../../lib/compare";
import { parseCondition, errorResponse } from "../../../lib/request";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    const { mode, a, b, year } = parseCondition(await req.json());
    return Response.json(await buildComparison(mode, a, b, year));
  } catch (e) { return errorResponse(e); }
}
