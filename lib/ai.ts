// AI HR 브리핑 · 후속 대화. AI에는 화이트리스트로 고른 서버 계산값·상태·정의·출처만 전달한다(원본 행 전체는 보내지 않음).
import type { Comparison, MetricKey } from "./compare";
import type { Disclosed } from "./emp";

export class AiError extends Error {}

export function aiStatus() {
  return { openai: Boolean(process.env.OPENAI_API_KEY?.trim()), model: process.env.OPENAI_MODEL?.trim() || null };
}

export function buildAiContext(c: Comparison) {
  const keys = Object.keys(c.definitions) as MetricKey[];
  return {
    사업연도: c.year,
    데이터: c.mode === "demo" ? "합성 예시(실제 기업 아님)" : "OpenDART 사업보고서",
    기업: c.companies.map((x) => ({ 구분: x.label, 회사명: x.corp_name })),
    격차정의: c.gapDefinition,
    지표: keys.map((k) => ({
      지표: c.definitions[k].label,
      값의성격: c.definitions[k].kind,
      정의: c.definitions[k].formula,
      A: pick(c.companies[0].metrics[k]),
      B: pick(c.companies[1].metrics[k]),
      격차: c.gaps[k].status === "ok"
        ? { 상태: "계산됨", 격차: c.gaps[k].diffDisplay, 격차율: c.gaps[k].rateDisplay }
        : { 상태: "보류", 사유: c.gaps[k].reason },
    })),
    공시_1인평균급여: {
      정의: c.disclosedDefinition,
      기업별: c.companies.map((x) => ({
        구분: x.label,
        남: disc(x.emp.disclosed.M),
        여: disc(x.emp.disclosed.F),
        회사합계행: disc(x.emp.disclosed.T),
      })),
    },
    출처: c.companies.map((x) => ({
      구분: x.label,
      직원현황: `empSttus 사업보고서(11011)${x.emp.rcept_no ? ` 접수번호 ${x.emp.rcept_no}` : ""}, 결산기준일 ${x.emp.stlm.date ?? "미확인"}`,
      직원범위: x.emp.population.status === "ok" ? `합계(sm) = 정규직+기간제 (${x.emp.population.checked}행 확인)` : "범위 미확인(보류)",
      급여단위: x.emp.unit.status === "ok" ? x.emp.unit.basis : `보류: ${x.emp.unit.reason}`,
      매출: x.revenue.source ? `별도(OFS) ${x.revenue.source.account_nm}(${x.revenue.source.account_id})` : "없음",
      주의: [...x.warnings, ...x.errors],
    })),
  };
}

// 보류 사유에 섞인 충돌 수치(예: "합계 500명 / 상세 480명")는 AI가 보류값을 인용하지 않도록 지운다. 화면에는 그대로 표시.
const stripAmounts = (s: string) => s.replace(/-?\d[\d,]*(\.\d+)?\s*(명|원)/g, "[수치 생략]");

function disc(d: Disclosed) {
  if (d.status === "ok") return `공시값 ${d.display}${d.note ? ` [출처: ${d.note}]` : ""}`;
  if (d.status === "held") return `보류: ${d.note ?? "확정 불가"}`;
  return d.note ?? d.display;
}

function pick(m: { status: string; display: string; basis: string | null; reasons: string[] }) {
  return m.status === "ok" ? { 상태: "검증됨", 값: m.display, 산출근거: m.basis } : { 상태: "보류", 사유: m.reasons.map(stripAmounts) };
}

const RULES = `당신은 기업 인사(HR) 데이터 분석가입니다. 사용자가 준 JSON(서버 계산 결과)만 근거로 한국어로 답합니다.
규칙:
1. 새 수치를 계산·추정하지 마세요. 합산, 평균, 가중평균, 역산, 단위 변환 금지. 격차와 격차율은 JSON의 '격차' 값만 인용하세요.
2. '기말 인원당 급여총액'은 연간급여총액÷사업연도말 직원 수로 앱이 계산한 값이며 공시 1인평균급여가 아닙니다. 인용할 때 항상 "계산값"이라고 밝히고, 이 값을 '평균급여', '1인평균', '공시 평균'이라고 부르지 마세요.
3. 공시 1인평균급여(남/여/회사합계행)는 공시값입니다. 남녀 값을 평균·가중해 회사 평균을 만들지 마세요. 회사합계행이 없으면 회사 전체 공시 평균은 없다고 말하세요.
4. 상태가 '보류'인 값은 수치를 말하지 말고 보류 사유와 확인 방법만 설명하세요.
5. 인과관계를 단정하지 말고 가능성으로 표현하세요. 업종·사업구조 차이 등 비교의 한계를 짚으세요.
6. 금액·인원은 JSON 문자열 표기를 그대로 쓰세요. 마크다운 기호(#, **, 표)는 쓰지 말고 "• "로 시작하는 줄과 짧은 문단만 쓰세요.
7. followups에는 이 결과의 맥락(보류 항목, 큰 격차, 공시값과 계산값 차이 등)에 맞는 구체적 후속 질문 3개를 한국어 한 문장씩 넣으세요.`;

interface Msg { role: "user" | "assistant"; content: string }

// gpt-6-sol 확인(2026-09-30): chat.completions · json_schema(strict) 지원, temperature는 기본값(1)만, max_tokens 대신 max_completion_tokens.
const schema = (name: string, field: "briefing" | "answer") => ({
  type: "json_schema",
  json_schema: {
    name, strict: true,
    schema: {
      type: "object", additionalProperties: false, required: [field, "followups"],
      properties: { [field]: { type: "string" }, followups: { type: "array", items: { type: "string" } } },
    },
  },
});

async function callOpenAI(messages: { role: string; content: string }[], responseFormat: object) {
  const key = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim();
  if (!key) throw new AiError("OPENAI_API_KEY가 .env에 설정되지 않았습니다.");
  if (!model) throw new AiError("OPENAI_MODEL이 .env에 설정되지 않았습니다.");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, response_format: responseFormat }),
  });
  if (!res.ok) throw new AiError(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const content = j.choices?.[0]?.message?.content;
  try { return JSON.parse(content); } catch { throw new AiError("AI 응답을 JSON으로 해석하지 못했습니다."); }
}

const cleanFollowups = (f: unknown) =>
  Array.isArray(f) ? f.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 3) : [];

export async function briefing(c: Comparison) {
  const ctx = buildAiContext(c);
  if (useMock(c)) return { ...mockBriefing(c), mock: true, context: ctx };
  const out = await callOpenAI([
    { role: "system", content: RULES },
    { role: "user", content: `다음 비교 결과로 HR 브리핑을 작성하세요. 구성: 한 줄 요약, 핵심 카드 3개(직원 수·기말 인원당 급여총액·인당 매출) 해석, 공시 1인평균(남/여) 관찰, 보류·주의 사항, HR 시사점. followups는 정확히 3개.\n\n${JSON.stringify(ctx)}` },
  ], schema("hr_briefing", "briefing"));
  if (typeof out.briefing !== "string") throw new AiError("AI 응답에 briefing이 없습니다.");
  return { briefing: out.briefing, followups: cleanFollowups(out.followups), mock: false, context: ctx };
}

export async function chat(c: Comparison, history: Msg[]) {
  if (useMock(c)) return { ...mockChat(c, history), mock: true };
  const ctx = buildAiContext(c);
  const out = await callOpenAI([
    { role: "system", content: `${RULES}\nanswer에 답변, followups에 후속 질문 정확히 3개.` },
    { role: "system", content: `비교 결과 JSON: ${JSON.stringify(ctx)}` },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ], schema("hr_chat", "answer"));
  if (typeof out.answer !== "string") throw new AiError("AI 응답에 answer가 없습니다.");
  return { answer: out.answer, followups: cleanFollowups(out.followups), mock: false };
}

// 합성 모드에서 OpenAI 키가 없을 때만 쓰는 고정 응답(화면 흐름 검사용). 실제 AI가 아님을 명시한다.
const useMock = (c: Comparison) => c.mode === "demo" && !aiStatus().openai;
const MOCK_TAG = "[합성 응답 — 실제 AI 아님 · OPENAI_API_KEY 미설정]";

function contextualFollowups(c: Comparison) {
  const [A, B] = c.companies;
  const qs: string[] = [];
  for (const k of (Object.keys(c.gaps) as MetricKey[]).filter((k) => c.gaps[k].status === "held")) {
    qs.push(`${c.definitions[k].label}이(가) 왜 보류됐고, 무엇을 확인하면 풀 수 있나요?`);
  }
  if (c.gaps.salaryPerHead.status === "ok") qs.push(`${A.corp_name}의 기말 인원당 급여총액(계산값)과 공시 1인평균급여가 다른 이유는 무엇일 수 있나요?`);
  if (c.gaps.revenuePerHead.status === "ok") qs.push(`인당 매출 격차 ${c.gaps.revenuePerHead.rateDisplay}를 해석할 때 주의할 업종·사업구조 차이는 무엇인가요?`);
  qs.push(`${B.corp_name}와 비교해 남녀 공시 1인평균급여 차이는 어떻게 읽어야 하나요?`);
  return qs.slice(0, 3);
}

function mockBriefing(c: Comparison) {
  const [A, B] = c.companies;
  const lines = (Object.keys(c.definitions) as MetricKey[]).map((k) => {
    const d = c.definitions[k], g = c.gaps[k];
    const a = A.metrics[k], b = B.metrics[k];
    return g.status === "ok"
      ? `• ${d.label}(${d.kind}): ${A.corp_name} ${a.display}, ${B.corp_name} ${b.display} → 격차 ${g.diffDisplay} (${g.rateDisplay})`
      : `• ${d.label}(${d.kind}): 보류 — ${[...a.reasons, ...b.reasons][0] ?? g.reason}`;
  });
  return {
    briefing: [MOCK_TAG, `${c.year} 사업연도 ${A.corp_name}(A) vs ${B.corp_name}(B) 비교입니다.`, ...lines,
      `• 공시 1인평균급여(공시값): 남녀 값은 따로 보며, 앱은 이를 평균해 회사 평균을 만들지 않습니다.`].join("\n"),
    followups: contextualFollowups(c),
  };
}

function mockChat(c: Comparison, history: Msg[]) {
  const q = history.filter((m) => m.role === "user").at(-1)?.content ?? "";
  return { answer: `${MOCK_TAG}\n질문 "${q.slice(0, 80)}"을(를) 받았습니다. 실제 답변은 OPENAI_API_KEY·OPENAI_MODEL 설정 후 생성됩니다.`, followups: contextualFollowups(c) };
}
