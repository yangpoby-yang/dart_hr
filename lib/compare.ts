// 두 기업 · 한 연도 비교. 격차·격차율은 여기(서버)에서만 계산한다.
import { analyzeEmp, rowUsage, type EmpAnalysis, type MetricValue } from "./emp";
import { analyzeRevenue, revenuePerHead, type RevenueResult } from "./revenue";
import { fetchEmpSttus, fetchFsAllOFS, corpName } from "./dart";
import { synthEmp, synthFsOFS, SYNTHETIC_CORPS } from "./synthetic";
import { fmtSigned, fmtPct } from "./num";

export type Mode = "demo" | "live";
export type MetricKey = "headcount" | "salaryPerHead" | "revenuePerHead";

export const DEFINITIONS: Record<MetricKey, { label: string; kind: string; unit: "명" | "원"; formula: string }> = {
  headcount: {
    label: "사업연도말 직원 수",
    kind: "공시값(sm) · 기준 검증",
    unit: "명",
    formula:
      "사업보고서 직원현황(empSttus)의 합계(sm). 회사 합계 행 → 성별합계 남+여 → 완전한 부문 상세 합 순서로 기준을 정하고, 사용 가능한 다른 기준과 모두 일치하며 결산기준일(stlm_dt)이 해당 사업연도일 때만 사용. 성별합계 행과 부문 상세 행은 섞어 더하지 않음.",
  },
  salaryPerHead: {
    label: "기말 인원당 급여총액",
    kind: "계산값(공시 1인평균 아님)",
    unit: "원",
    formula:
      "완전한 연간급여총액(fyer_salary_totamt, 비고 단위를 원으로 환산) ÷ 검증된 사업연도말 직원 수. 회사가 공시하는 1인평균급여액(jan_salary_am)은 회사 자체 기준(예: 평균 인원)으로 산정되어 이 값과 다를 수 있으므로 서로 대체하지 않음.",
  },
  revenuePerHead: {
    label: "인당 매출",
    kind: "계산값",
    unit: "원",
    formula:
      "같은 사업연도 사업보고서의 별도(OFS) 손익계산서 매출액 ÷ 검증된 사업연도말 직원 수. 직원현황이 별도 법인 기준이므로 연결(CFS) 매출은 사용하지 않음.",
  },
};

export const GAP_DEFINITION = "격차 = A − B, 격차율 = (A − B) ÷ B × 100. A = 첫 번째 기업, B = 두 번째(비교 기준) 기업. 두 값이 모두 검증된 경우에만 서버에서 계산.";
export const DISCLOSED_DEFINITION =
  "공시 1인평균급여액(jan_salary_am) 원문 값. 남녀 값의 단순평균·인원(sm) 가중평균·총액÷인원 역산값은 회사 공식 평균으로 쓰지 않음. 회사 합계 행이 있을 때만 공시 전체 평균을 표시.";

export interface CompanyResult {
  label: "A" | "B";
  corp_code: string;
  corp_name: string;
  emp: EmpAnalysis;
  rowUsage: string[];
  revenue: RevenueResult;
  metrics: Record<MetricKey, MetricValue>;
  warnings: string[];
  errors: string[];
}

export interface Gap { status: "ok" | "held"; diff: number | null; rate: number | null; diffDisplay: string; rateDisplay: string; reason?: string }

export interface Comparison {
  mode: Mode;
  year: number;
  companies: [CompanyResult, CompanyResult];
  gaps: Record<MetricKey, Gap>;
  definitions: typeof DEFINITIONS;
  gapDefinition: string;
  disclosedDefinition: string;
}

async function analyzeCompany(mode: Mode, code: string, year: number, label: "A" | "B"): Promise<CompanyResult> {
  const errors: string[] = [];
  const safe = async <T>(fn: () => Promise<T> | T, fallback: T, what: string) => {
    try { return await fn(); } catch (e) { errors.push(`${what}: ${(e as Error).message}`); return fallback; }
  };
  const empty = { status: "error", list: [] as Record<string, unknown>[] };
  const name = mode === "demo"
    ? SYNTHETIC_CORPS.find((c) => c.corp_code === code)?.corp_name ?? code
    : await safe(() => corpName(code), code, "회사명 조회");
  const [empResp, fsResp] = await Promise.all([
    safe(() => (mode === "demo" ? synthEmp(code, year) : fetchEmpSttus(code, year)), empty, "직원현황(empSttus)"),
    safe(() => (mode === "demo" ? synthFsOFS(code, year) : fetchFsAllOFS(code, year)), empty, "별도 재무제표(OFS)"),
  ]);
  const emp = analyzeEmp(empResp, year);
  const revenue = analyzeRevenue(fsResp, year);
  if (fsResp.status === "error") revenue.reasons = ["별도 재무제표 조회 실패", ...revenue.reasons.slice(1)];
  const warnings = [...emp.warnings];
  if (emp.rcept_no && revenue.source?.rcept_no && emp.rcept_no !== revenue.source.rcept_no) {
    warnings.push(`직원현황 접수번호(${emp.rcept_no})와 재무제표 접수번호(${revenue.source.rcept_no})가 다름 — 정정보고서 여부 확인 필요`);
  }
  return {
    label, corp_code: code, corp_name: name, emp, rowUsage: rowUsage(emp), revenue, warnings, errors,
    metrics: { headcount: emp.headcount, salaryPerHead: emp.salaryPerHead, revenuePerHead: revenuePerHead(revenue, emp.headcount) },
  };
}

export function computeGap(a: MetricValue, b: MetricValue, unit: "명" | "원"): Gap {
  if (a.status !== "ok" || b.status !== "ok" || a.value == null || b.value == null) {
    const side = [a.status !== "ok" && "A", b.status !== "ok" && "B"].filter(Boolean).join("·");
    return { status: "held", diff: null, rate: null, diffDisplay: "보류", rateDisplay: "보류", reason: `${side} 값 보류로 격차를 계산하지 않음` };
  }
  const diff = a.value - b.value;
  const rate = b.value === 0 ? null : (diff / b.value) * 100;
  return {
    status: "ok", diff, rate, diffDisplay: fmtSigned(diff, unit),
    rateDisplay: rate == null ? "계산 불가" : fmtPct(rate), reason: rate == null ? "B 값이 0이라 격차율 계산 불가" : undefined,
  };
}

export async function buildComparison(mode: Mode, a: string, b: string, year: number): Promise<Comparison> {
  const [A, B] = await Promise.all([analyzeCompany(mode, a, year, "A"), analyzeCompany(mode, b, year, "B")]);
  const keys = Object.keys(DEFINITIONS) as MetricKey[];
  const gaps = Object.fromEntries(keys.map((k) => [k, computeGap(A.metrics[k], B.metrics[k], DEFINITIONS[k].unit)])) as Record<MetricKey, Gap>;
  return { mode, year, companies: [A, B], gaps, definitions: DEFINITIONS, gapDefinition: GAP_DEFINITION, disclosedDefinition: DISCLOSED_DEFINITION };
}
