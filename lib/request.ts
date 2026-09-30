import type { Mode } from "./compare";
import { isSynthetic } from "./synthetic";
import { hasDartKey } from "./dart";

export class BadRequest extends Error {}

export function parseCondition(body: any): { mode: Mode; a: string; b: string; year: number } {
  const mode: Mode = body?.mode === "live" ? "live" : "demo";
  const a = String(body?.a ?? ""), b = String(body?.b ?? "");
  const year = Number(body?.year);
  const thisYear = new Date().getFullYear();
  if (!Number.isInteger(year) || year < 2015 || year >= thisYear) throw new BadRequest(`사업연도는 2015~${thisYear - 1} 사이여야 합니다.`);
  if (a === b) throw new BadRequest("서로 다른 두 기업을 선택하세요.");
  if (mode === "demo" && (!isSynthetic(a) || !isSynthetic(b))) throw new BadRequest("합성 모드에서는 합성 기업만 선택할 수 있습니다.");
  if (mode === "live") {
    if (!/^\d{8}$/.test(a) || !/^\d{8}$/.test(b)) throw new BadRequest("OpenDART 고유번호(8자리)가 필요합니다.");
    if (!hasDartKey()) throw new BadRequest("OPENDART_API_KEY가 .env에 없어 실제 조회를 할 수 없습니다.");
  }
  return { mode, a, b, year };
}

export function parseMessages(v: any) {
  if (!Array.isArray(v) || v.length === 0 || v.length > 30) throw new BadRequest("대화 형식이 올바르지 않습니다.");
  return v.map((m) => {
    if ((m?.role !== "user" && m?.role !== "assistant") || typeof m?.content !== "string" || m.content.length > 4000) {
      throw new BadRequest("대화 형식이 올바르지 않습니다.");
    }
    return { role: m.role as "user" | "assistant", content: m.content };
  });
}

export function errorResponse(e: unknown) {
  const status = e instanceof BadRequest ? 400 : 502;
  return Response.json({ error: (e as Error).message }, { status });
}
