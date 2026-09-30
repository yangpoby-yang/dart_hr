import { hasDartKey } from "../../../lib/dart";
import { aiStatus } from "../../../lib/ai";
export const dynamic = "force-dynamic";
export function GET() {
  const ai = aiStatus();
  return Response.json({ dart: hasDartKey(), openai: ai.openai, model: ai.model });
}
