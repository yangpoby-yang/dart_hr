// 합성 예시 — 실제 기업·공시가 아님. 키 없이 계산 규칙과 화면 흐름을 검사하기 위한 고정 데이터.
import type { Corp } from "./dart";

type Row = [fo_bbm: string, sexdstn: string, sm: string, fyer_salary_totamt: string, jan_salary_am: string, rm?: string];

interface Fixture { corp: Corp; emp: Row[] | null; revenue: string | null; stlm?: string | null; note: string }

const F: Record<string, Fixture> = {
  S0000001: {
    corp: { corp_code: "S0000001", corp_name: "가람전자(합성)", stock_code: "" },
    note: "정상 — 회사 합계·성별합계·부문 상세가 모두 일치, 원 단위",
    revenue: "450000000000",
    emp: [
      ["합계", "남", "750", "70500000000", "95000000"],
      ["합계", "여", "250", "19000000000", "77000000"],
      ["합계", "합계", "1,000", "89500000000", "91000000"],
      ["DS부문", "남", "600", "60000000000", "100000000"],
      ["DS부문", "여", "200", "16000000000", "80000000"],
      ["DS부문", "합계", "800", "76000000000", "95000000"],
      ["가전부문", "남", "150", "10500000000", "70000000"],
      ["가전부문", "여", "50", "3000000000", "60000000"],
    ],
  },
  S0000002: {
    corp: { corp_code: "S0000002", corp_name: "나래바이오(합성)", stock_code: "" },
    note: "정상 — 회사 합계 행 없음(fo_bbm '성별합계'+부문 상세), 비고 '단위: 백만원'",
    revenue: "210000000000",
    emp: [
      ["성별합계", "남", "320", "25,400", "80", "단위: 백만원"],
      ["성별합계", "여", "280", "19,800", "71", "단위: 백만원"],
      ["연구부문", "남", "200", "17,000", "85", "단위: 백만원"],
      ["연구부문", "여", "200", "15,000", "75", "단위: 백만원"],
      ["생산부문", "남", "120", "8,400", "70", "단위: 백만원"],
      ["생산부문", "여", "80", "4,800", "60", "단위: 백만원"],
    ],
  },
  S0000003: {
    corp: { corp_code: "S0000003", corp_name: "다온물산(합성)", stock_code: "" },
    note: "보류 — 회사 합계 500명과 완전한 부문 상세 합 480명 충돌",
    revenue: "90000000000",
    emp: [
      ["합계", "남", "300", "21000000000", "70000000"],
      ["합계", "여", "200", "12000000000", "60000000"],
      ["합계", "합계", "500", "33000000000", "66000000"],
      ["유통부문", "남", "200", "14000000000", "70000000"],
      ["유통부문", "여", "100", "6000000000", "60000000"],
      ["무역부문", "남", "100", "7000000000", "70000000"],
      ["무역부문", "여", "80", "4800000000", "60000000"],
    ],
  },
  S0000004: {
    corp: { corp_code: "S0000004", corp_name: "라온식품(합성)", stock_code: "" },
    note: "보류 — 비고 단위 표기 혼재(천원/백만원) → 급여 원화값 보류, 인원은 유효",
    revenue: "120000000000",
    emp: [
      ["합계", "남", "260", "15,600", "60,000", "급여총액 단위: 백만원, 1인평균 단위: 천원"],
      ["합계", "여", "140", "7,000", "50,000", "급여총액 단위: 백만원, 1인평균 단위: 천원"],
      ["합계", "합계", "400", "22,600", "56,500", "급여총액 단위: 백만원, 1인평균 단위: 천원"],
    ],
  },
  S0000005: {
    corp: { corp_code: "S0000005", corp_name: "마루건설(합성)", stock_code: "" },
    note: "보류 — 별도(OFS) 재무제표 없음 → 인당 매출 보류(CFS로 대체하지 않음)",
    revenue: null,
    emp: [
      ["-", "남", "90", "7200000000", "80000000"],
      ["-", "여", "30", "1800000000", "60000000"],
      ["-", "합계", "120", "9000000000", "75000000"],
    ],
  },
  S0000006: {
    corp: { corp_code: "S0000006", corp_name: "바다랩(합성)", stock_code: "" },
    note: "보류 — 결산기준일(stlm_dt) 없음 → 사업연도말 인원 미검증",
    revenue: "5000000000",
    stlm: null,
    emp: [
      ["합계", "남", "12", "900000000", "75000000"],
      ["합계", "여", "8", "560000000", "70000000"],
      ["합계", "합계", "20", "1460000000", "73000000"],
    ],
  },
};

export const SYNTHETIC_CORPS: (Corp & { note: string })[] = Object.values(F).map((f) => ({ ...f.corp, note: f.note }));
export const isSynthetic = (code: string) => code in F;

export function synthEmp(code: string, year: number) {
  const f = F[code];
  if (!f?.emp) return { status: "013", list: [] as Record<string, unknown>[] };
  const stlm = f.stlm === null ? "" : f.stlm ?? `${year}-12-31`;
  return {
    status: "000",
    list: f.emp.map(([fo_bbm, sexdstn, sm, fyer_salary_totamt, jan_salary_am, rm = "-"]) => ({
      rcept_no: `${year + 1}0310000${code.slice(-3)}`, corp_code: code, corp_name: f.corp.corp_name,
      fo_bbm, sexdstn, sm, rgllbr_co: sm, cnttk_co: "0", fyer_salary_totamt, jan_salary_am, stlm_dt: stlm, rm,
    })) as Record<string, unknown>[],
  };
}

export function synthFsOFS(code: string, year: number) {
  const f = F[code];
  if (!f?.revenue) return { status: "013", list: [] as Record<string, unknown>[] };
  return {
    status: "000",
    list: [
      { rcept_no: `${year + 1}0310000${code.slice(-3)}`, bsns_year: String(year), corp_code: code, sj_div: "BS", account_id: "ifrs-full_Assets", account_nm: "자산총계", thstrm_amount: "999000000000", currency: "KRW" },
      { rcept_no: `${year + 1}0310000${code.slice(-3)}`, bsns_year: String(year), corp_code: code, sj_div: "IS", account_id: "ifrs-full_Revenue", account_nm: "매출액", thstrm_nm: `제 ${year - 1990} 기`, thstrm_amount: f.revenue, currency: "KRW" },
    ] as Record<string, unknown>[],
  };
}
