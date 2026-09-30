import { buildComparison } from "../../../lib/compare";
import { chat } from "../../../lib/ai";
import { parseCondition, parseMessages, errorResponse } from "../../../lib/request";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { mode, a, b, year } = parseCondition(body);
    const messages = parseMessages(body.messages);
    return Response.json(await chat(await buildComparison(mode, a, b, year), messages));
  } catch (e) { return errorResponse(e); }
}
