import { describe, it, expect } from "vitest";
import { analyzeEmp, classifyRows, parseUnits, rowUsage } from "../lib/emp";
import { analyzeRevenue } from "../lib/revenue";
import { buildComparison, computeGap } from "../lib/compare";
import { buildAiContext, briefing } from "../lib/ai";

const Y = 2025;
// 실제 응답처럼 합계(sm) = 정규직(rgllbr_co) + 기간제(cnttk_co)를 기본으로 채운다.
const row = (fo_bbm: string, sexdstn: string, sm: string, tot = "-", avg = "-", rm = "-", stlm_dt = `${Y}-12-31`) =>
  ({ fo_bbm, sexdstn, sm, fyer_salary_totamt: tot, jan_salary_am: avg, rm, stlm_dt, rgllbr_co: sm, cnttk_co: sm === "-" ? "-" : "0" });
const emp = (...list: ReturnType<typeof row>[]) => analyzeEmp({ status: "000", list }, Y);

describe("행 분류", () => {
  it("회사 합계 / 성별합계 / 부문 소계 / 부문 상세 / 분류 불가", () => {
    const c = classifyRows([row("합계", "합계", "1"), row("합계", "남", "1"), row("DS", "합계", "1"), row("DS", "여", "1"), row("소계", "남", "1"), row("DS", "-", "1")]);
    expect(c.map((r) => r.cls)).toEqual(["COMPANY_TOTAL", "COMPANY_SEX", "SEGMENT_TOTAL", "SEGMENT_SEX", "UNCLASSIFIED", "UNCLASSIFIED"]);
  });
});

describe("직원 수 — 중복 합산 금지·충돌 보류", () => {
  it("회사 합계·성별합계·부문 상세가 일치하면 합계 행 값(중복 합산 없음)", () => {
    const a = emp(row("합계", "남", "60"), row("합계", "여", "40"), row("합계", "합계", "100"),
      row("A", "남", "40"), row("A", "여", "30"), row("A", "합계", "70"), row("B", "남", "20"), row("B", "여", "10"));
    expect(a.headcount.status).toBe("ok");
    expect(a.headcount.value).toBe(100); // 모든 행을 더하면 370이 되는 구조
  });
  it("합계 행이 없으면 성별합계 남+여, 부문 상세와 교차검증", () => {
    const a = emp(row("합계", "남", "60"), row("합계", "여", "40"), row("A", "남", "60"), row("A", "여", "40"));
    expect(a.headcount.value).toBe(100);
    expect(a.headcount.basis).toContain("부문 상세 합");
  });
  it("완전한 부문 상세 합과 충돌하면 보류", () => {
    const a = emp(row("합계", "합계", "100"), row("A", "남", "50"), row("A", "여", "45"));
    expect(a.headcount.status).toBe("held");
    expect(a.headcount.reasons.join()).toContain("충돌");
  });
  it("부문 상세가 불완전(결측)하면 교차검증에서 빠지고 보류하지 않음", () => {
    const a = emp(row("합계", "합계", "100"), row("A", "남", "50"), row("A", "여", "-"));
    expect(a.headcount.status).toBe("ok");
    expect(a.headcountRaw.checks[2].state).toBe("incomplete");
  });
  it("회사 합계 행과 성별합계 남+여가 다르면 보류", () => {
    expect(emp(row("합계", "합계", "100"), row("합계", "남", "60"), row("합계", "여", "30")).headcount.status).toBe("held");
  });
  it("회사 합계 행 중복이면 보류", () => {
    expect(emp(row("합계", "합계", "100"), row("전체", "합계", "100")).headcount.status).toBe("held");
  });
  it("부문 소계와 남+여가 다르면 보류", () => {
    expect(emp(row("합계", "합계", "100"), row("A", "남", "60"), row("A", "여", "40"), row("A", "합계", "90")).headcount.status).toBe("held");
  });
  it("결산기준일이 없거나 연도가 다르면 사업연도말 인원 미검증 → 보류", () => {
    expect(emp(row("합계", "합계", "10", "-", "-", "-", "")).headcount.status).toBe("held");
    expect(emp(row("합계", "합계", "10", "-", "-", "-", "2023-12-31")).headcount.status).toBe("held");
  });
});

// Step 0(2025 사업보고서)에서 확인한 실제 행 구조
describe("실제 구조 — Step 0 승인 규칙 A~D", () => {
  const samsung = () => emp(
    row("DX", "남", "38,119"), row("DX", "여", "12,698"), row("DS", "남", "56,154"), row("DS", "여", "21,910"),
    row("성별합계", "남", "94,273", "15,562,454,000,000", "167,000,000"),
    row("성별합계", "여", "34,608", "4,237,308,000,000", "130,000,000"),
  );
  it("A: fo_bbm '성별합계'는 회사 전체 성별 행 — 부문 상세와 중복 합산하지 않음", () => {
    const a = samsung();
    expect(a.rows.slice(4).map((r) => r.cls)).toEqual(["COMPANY_SEX", "COMPANY_SEX"]);
    expect(a.headcount.value).toBe(128_881); // 중복 합산 시 257,762
    expect(a.headcount.basis).toContain("일치 확인: 부문 상세 합");
  });
  it("B: 급여총액 기준이 성별합계 하나뿐이면 '교차검증 불가'로 사용", () => {
    const a = samsung();
    expect(a.salaryTotal.value).toBe(19_799_762_000_000);
    expect(a.salaryTotal.basis).toContain("교차검증 불가");
    expect(a.salaryPerHead.value).toBe(153_628_246);
  });
  it("D: 남녀 공시 1인평균은 성별합계 행, 회사 합계 행 없으면 전체 평균 없음", () => {
    const a = samsung();
    expect(a.disclosed.M.value).toBe(167_000_000);
    expect(a.disclosed.F.value).toBe(130_000_000);
    expect(a.disclosed.T.status).toBe("absent");
  });
  const hynix = () => emp(
    row("반도체", "남", "23,037", "4,376,624,000,000", "198,000,000"),
    row("반도체", "여", "11,512", "1,771,407,000,000", "159,000,000"),
  );
  it("C: 단일 부문 · 성별합계 없음 → 부문 상세 합, '단일 부문, 교차검증 불가'", () => {
    const a = hynix();
    expect(a.headcount.value).toBe(34_549);
    expect(a.headcount.basis).toContain("단일 부문, 교차검증 불가");
    expect(a.salaryPerHead.value).toBe(177_951_055);
  });
  it("D: 단일 부문이면 그 부문 행 공시값을 출처와 함께, 여러 부문이면 표시 안 함", () => {
    const a = hynix();
    expect(a.disclosed.M.value).toBe(198_000_000);
    expect(a.disclosed.M.note).toContain("부문 '반도체' 행");
    const multi = emp(row("A", "남", "1", "10", "10"), row("A", "여", "1", "10", "10"), row("B", "남", "1", "10", "10"), row("B", "여", "1", "10", "10"));
    expect(multi.disclosed.M.status).toBe("absent");
  });
  it("범위: 합계(sm) ≠ 정규직+기간제이면 직원 범위 미확인 → 직원 수·계산값 보류", () => {
    const ok = emp({ ...row("성별합계", "남", "10", "1000"), rgllbr_co: "9", cnttk_co: "1" } as any, { ...row("성별합계", "여", "5", "500"), rgllbr_co: "5", cnttk_co: "0" } as any);
    expect(ok.population).toMatchObject({ status: "ok", checked: 2 });
    const bad = emp({ ...row("성별합계", "남", "10", "1000"), rgllbr_co: "8", cnttk_co: "1" } as any, row("성별합계", "여", "5", "500"));
    expect(bad.headcount.status).toBe("held");
    expect(bad.headcount.reasons[0]).toContain("직원 범위 미확인");
    expect(bad.salaryPerHead.status).toBe("held");
  });
  it("범위: 계산 기준 행에 정규직·기간제 수가 없으면 범위 미확인 → 보류(대조용 행 결측은 허용)", () => {
    const base = (sex: string, sm: string) => ({ ...row("성별합계", sex, sm, "100"), rgllbr_co: sm, cnttk_co: "0" } as any);
    expect(emp(base("남", "10"), base("여", "5"), row("A", "남", "10"), row("A", "여", "5")).headcount.status).toBe("ok");
    expect(emp(base("남", "10"), { ...row("성별합계", "여", "5", "100"), rgllbr_co: "-", cnttk_co: "-" }).headcount.status).toBe("held");
  });
  it("행별 사용·제외 이유: 성별합계는 계산 기준, 부문 상세는 대조만, 급여 결측은 제외", () => {
    const a = samsung();
    const u = rowUsage(a);
    expect(u[0]).toBe("인원: 대조만(합산 안 함) · 급여총액: 제외(값 결측)");
    expect(u[4]).toBe("인원: 계산 기준 · 급여총액: 계산 기준");
  });
  it("A: 확인되지 않은 합계 비슷한 표기('부문합계')는 분류 불가 → 상세 합 보류", () => {
    const a = emp(row("부문합계", "남", "10"), row("부문합계", "여", "5"), row("A", "남", "10"), row("A", "여", "5"));
    expect(a.rows[0].cls).toBe("UNCLASSIFIED");
    expect(a.headcount.status).toBe("held");
  });
});

describe("급여 — 단위·계산값", () => {
  it("비고 단위 읽기(숫자 뒤 금액은 단위가 아님)", () => {
    expect(parseUnits("단위: 백만원")).toEqual(["백만원"]);
    expect(parseUnits("(단위 : 천원)")).toEqual(["천원"]);
    expect(parseUnits("성과급 500만원 포함")).toEqual([]);
    expect(parseUnits("직원 수 기준")).toEqual([]);
  });
  it("표기 없음 → 원, 계산값 = 급여총액 ÷ 기말 인원", () => {
    const a = emp(row("합계", "남", "3", "300000000", "110000000"), row("합계", "여", "1", "80000000", "82000000"));
    expect(a.salaryPerHead.value).toBe(95000000);
    expect(a.disclosed.M.value).toBe(110000000); // 공시값 그대로
    expect(a.disclosed.T.status).toBe("absent"); // 남녀로 회사 평균을 만들지 않음
  });
  it("비고 '백만원' 전 행 표기 → 원 환산", () => {
    const a = emp(row("합계", "합계", "10", "1,000", "95", "단위: 백만원"));
    expect(a.salaryTotal.value).toBe(1_000_000_000);
    expect(a.salaryPerHead.value).toBe(100_000_000);
    expect(a.disclosed.T.value).toBe(95_000_000);
  });
  it("단위 표기가 섞이면 원화 카드값 보류(인원은 유지)", () => {
    const a = emp(row("합계", "남", "5", "500", "100", "단위: 백만원"), row("합계", "여", "5", "400", "80", "단위: 천원"));
    expect(a.unit.status).toBe("held");
    expect(a.salaryPerHead.status).toBe("held");
    expect(a.disclosed.M.status).toBe("held");
    expect(a.headcount.status).toBe("ok");
  });
  it("일부 행에만 원 이외 단위 표기 → 보류", () => {
    expect(emp(row("합계", "남", "5", "500", "-", "단위: 백만원"), row("합계", "여", "5", "400")).unit.status).toBe("held");
  });
  it("0명이면 계산값 보류", () => {
    expect(emp(row("합계", "합계", "0", "0")).salaryPerHead.status).toBe("held");
  });
});

describe("매출 — OFS·결측·출처", () => {
  it("OFS 없음이면 보류(CFS로 대체하지 않음)", () => {
    const r = analyzeRevenue({ status: "013", list: [] }, Y);
    expect(r.status).toBe("held");
    expect(r.reasons[0]).toContain("CFS");
  });
  it("매출 후보 값이 여러 개면 보류, IS/CIS 같은 값은 하나로", () => {
    const base = { bsns_year: String(Y), account_id: "ifrs-full_Revenue", account_nm: "매출액", currency: "KRW" };
    expect(analyzeRevenue({ status: "000", list: [{ ...base, sj_div: "IS", thstrm_amount: "100" }, { ...base, sj_div: "CIS", thstrm_amount: "100" }] }, Y).value).toBe(100);
    expect(analyzeRevenue({ status: "000", list: [{ ...base, sj_div: "IS", thstrm_amount: "100" }, { ...base, sj_div: "CIS", thstrm_amount: "120" }] }, Y).status).toBe("held");
    expect(analyzeRevenue({ status: "000", list: [{ ...base, sj_div: "IS", thstrm_amount: "100", currency: "USD" }] }, Y).status).toBe("held");
  });
});

describe("합성 예시 비교 · AI 맥락", () => {
  it("가람전자 vs 나래바이오: 3개 카드와 서버 격차", async () => {
    const c = await buildComparison("demo", "S0000001", "S0000002", Y);
    const [A, B] = c.companies;
    expect(A.metrics.headcount.value).toBe(1000);
    expect(B.metrics.headcount.value).toBe(600);
    expect(A.metrics.salaryPerHead.value).toBe(89_500_000); // 공시 합계 행 1인평균 91,000,000과 다름
    expect(A.emp.disclosed.T.value).toBe(91_000_000);
    expect(B.metrics.salaryPerHead.value).toBe(75_333_333);
    expect(B.emp.disclosed.T.status).toBe("absent");
    expect(A.metrics.revenuePerHead.value).toBe(450_000_000);
    expect(B.metrics.revenuePerHead.value).toBe(350_000_000);
    expect(c.gaps.headcount.diff).toBe(400);
    expect(c.gaps.revenuePerHead.rate).toBeCloseTo(28.571, 2);
    expect(c.gaps.salaryPerHead.diff).toBe(14_166_667);
  });
  it("보류 기업이 끼면 격차도 보류", async () => {
    const c = await buildComparison("demo", "S0000003", "S0000004", Y);
    expect(c.companies[0].metrics.headcount.status).toBe("held");
    expect(c.companies[1].metrics.salaryPerHead.status).toBe("held");
    expect(c.companies[1].metrics.headcount.status).toBe("ok");
    expect(c.gaps.headcount.status).toBe("held");
    const m = await buildComparison("demo", "S0000005", "S0000006", Y);
    expect(m.companies[0].metrics.revenuePerHead.status).toBe("held");
    expect(m.companies[1].metrics.headcount.status).toBe("held");
  });
  it("AI 맥락에는 정의·서버 격차가 있고 원본 행·보류값 수치는 없음", async () => {
    const c = await buildComparison("demo", "S0000001", "S0000003", Y);
    const ctx = buildAiContext(c);
    const s = JSON.stringify(ctx);
    expect(s).toContain("계산값(공시 1인평균 아님)");
    expect(s).toContain(c.gapDefinition);
    expect(s).not.toContain("fyer_salary_totamt\":"); // 원본 필드 행 미포함
    const hc = ctx.지표.find((x) => x.지표 === "사업연도말 직원 수")!;
    expect(hc.B).toMatchObject({ 상태: "보류" });
    expect(hc.격차).toMatchObject({ 상태: "보류" });
    expect(s).not.toContain("500명"); // 보류된 다온물산 인원 수치 미전달
  });
  it("키 없는 합성 모드 브리핑은 합성 응답임을 명시하고 맥락형 후속 질문 3개", async () => {
    delete process.env.OPENAI_API_KEY;
    const c = await buildComparison("demo", "S0000001", "S0000003", Y);
    const b = await briefing(c);
    expect(b.mock).toBe(true);
    expect(b.briefing).toContain("실제 AI 아님");
    expect(b.followups).toHaveLength(3);
    expect(b.followups[0]).toContain("보류");
  });
  it("격차율: B가 0이면 계산 불가", () => {
    const ok = (v: number) => ({ status: "ok" as const, value: v, display: "", basis: "", reasons: [] });
    expect(computeGap(ok(5), ok(0), "명").rate).toBeNull();
  });
});
