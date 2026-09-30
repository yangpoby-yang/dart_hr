// 인당 매출용 연간 매출. 직원현황은 별도 법인 기준이므로 별도(OFS) 재무제표만 쓰고 연결(CFS)로 대체하지 않는다.
import { parseNum, fmtWon, approxWon } from "./num";
import type { MetricValue } from "./emp";

export interface FsRow { [k: string]: unknown }

const REVENUE_IDS = ["ifrs-full_Revenue", "ifrs_Revenue"];
const REVENUE_NAMES = ["매출액", "수익(매출액)", "매출", "영업수익", "매출액(영업수익)", "영업수익(매출액)"];
const squash = (s: unknown) => String(s ?? "").replace(/\s+/g, "");

export interface RevenueSource {
  fs_div: "OFS";
  rcept_no: string | null;
  sj_div: string;
  account_id: string;
  account_nm: string;
  thstrm_nm: string;
  currency: string;
}

export interface RevenueResult {
  status: "ok" | "held";
  value: number | null;
  display: string;
  reasons: string[];
  source: RevenueSource | null;
}

const held = (reasons: string[]): RevenueResult => ({ status: "held", value: null, display: "보류", reasons, source: null });

export function analyzeRevenue(resp: { status: string; list: FsRow[] }, year: number): RevenueResult {
  const list = resp.list ?? [];
  if (resp.status === "013" || list.length === 0) {
    return held(["별도(OFS) 재무제표 없음 — 연결(CFS) 매출은 직원 수(별도 법인)와 범위가 달라 대체하지 않음"]);
  }
  const isRows = list.filter((r) => ["IS", "CIS"].includes(String(r.sj_div)));
  const byId = isRows.filter((r) => REVENUE_IDS.includes(String(r.account_id)));
  const cand = byId.length ? byId : isRows.filter((r) => REVENUE_NAMES.includes(squash(r.account_nm)));
  if (cand.length === 0) return held(["손익계산서에서 매출 계정(ifrs-full_Revenue / 매출액·영업수익)을 찾지 못함"]);

  const wrongYear = cand.find((r) => r.bsns_year && String(r.bsns_year) !== String(year));
  if (wrongYear) return held([`매출 행의 사업연도(${wrongYear.bsns_year})가 선택 연도 ${year}와 다름`]);
  const cur = [...new Set(cand.map((r) => String(r.currency ?? "KRW") || "KRW"))];
  if (cur.length !== 1 || cur[0] !== "KRW") return held([`통화가 KRW가 아님(${cur.join(", ")})`]);

  const values = [...new Set(cand.map((r) => parseNum(r.thstrm_amount)).filter((v): v is number => v != null))];
  if (values.length === 0) return held(["매출 금액(thstrm_amount) 결측"]);
  if (values.length > 1) return held([`매출 후보 계정 값이 여러 개(${values.map(fmtWon).join(" / ")})라 확정 불가`]);

  const r = cand.find((x) => parseNum(x.thstrm_amount) === values[0])!;
  return {
    status: "ok", value: values[0], display: `${fmtWon(values[0])} (${approxWon(values[0])})`, reasons: [],
    source: {
      fs_div: "OFS", rcept_no: r.rcept_no ? String(r.rcept_no) : null, sj_div: String(r.sj_div),
      account_id: String(r.account_id ?? ""), account_nm: String(r.account_nm ?? ""),
      thstrm_nm: String(r.thstrm_nm ?? ""), currency: cur[0],
    },
  };
}

export function revenuePerHead(rev: RevenueResult, headcount: MetricValue): MetricValue {
  if (headcount.status !== "ok") return { status: "held", value: null, display: "보류", basis: null, reasons: ["검증된 사업연도말 직원 수 없음", ...headcount.reasons] };
  if (headcount.value === 0) return { status: "held", value: null, display: "보류", basis: null, reasons: ["직원 수 0명 — 나눌 수 없음"] };
  if (rev.status !== "ok") return { status: "held", value: null, display: "보류", basis: null, reasons: rev.reasons };
  const v = Math.round(rev.value! / headcount.value!);
  return {
    status: "ok", value: v, display: fmtWon(v), reasons: [],
    basis: `별도(OFS) ${rev.source!.account_nm} ${fmtWon(rev.value!)} ÷ ${headcount.display}`,
  };
}
