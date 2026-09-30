// 사업보고서 직원현황(empSttus) 행 분류 · 단위 판정 · 인원/급여총액 교차검증.
// 원칙: 회사 합계 수준 행과 부문 상세 행을 절대 섞어 더하지 않는다. 기준끼리 충돌하면 보류한다.
import { parseNum, fmtInt, fmtWon, approxWon } from "./num";

export const EMP_FIELDS = ["fo_bbm", "sexdstn", "sm", "fyer_salary_totamt", "jan_salary_am", "stlm_dt", "rm"] as const;
export type EmpField = (typeof EMP_FIELDS)[number];
export type EmpRawRow = Record<string, unknown>;

export type Scope = "company" | "segment" | "unknown";
export type Sex = "M" | "F" | "T" | "?";
export type RowClass = "COMPANY_TOTAL" | "COMPANY_SEX" | "SEGMENT_TOTAL" | "SEGMENT_SEX" | "UNCLASSIFIED";

export const ROW_CLASS_LABEL: Record<RowClass, string> = {
  COMPANY_TOTAL: "회사 합계 (부문 합계 · 성별 합계)",
  COMPANY_SEX: "성별합계 (부문 합계 · 남/여)",
  SEGMENT_TOTAL: "부문 소계 (부문 · 성별 합계)",
  SEGMENT_SEX: "부문 상세 (부문 · 남/여)",
  UNCLASSIFIED: "분류 불가",
};

export interface ClassifiedRow {
  idx: number;
  fields: Record<EmpField, string>;
  cls: RowClass;
  scope: Scope;
  sex: Sex;
  segment: string | null;
  units: string[]; // 비고(rm)에서 읽은 금액 단위 표기
  pop: { rgllbr_co: number | null; cnttk_co: number | null }; // 모집단 확인용: 정규직·기간제 근로자 수
}

const squash = (s: unknown) => String(s ?? "").replace(/\s+/g, "");

// 회사 전체를 뜻하는 사업부문 표기. "성별합계"는 Step 0(2025 삼성전자)에서 확인한 실제 표기.
// "-"/빈값은 부문 구분이 없는 회사로 본다.
const COMPANY_LABELS = new Set(["", "-", "성별합계", "합계", "전체", "계", "총계", "총합계", "전사", "회사전체", "전사합계"]);

export function scopeOf(fo_bbm: unknown): Scope {
  const n = squash(fo_bbm);
  if (COMPANY_LABELS.has(n)) return "company";
  // 합계로 보이지만 확인되지 않은 표기(예: "부문합계", "소계")는 범위를 알 수 없으므로 분류 불가 → 상세 합 보류
  if (/합계|총계|소계|^합$/.test(n)) return "unknown";
  return "segment";
}

export function sexOf(v: unknown): Sex {
  const n = squash(v);
  if (["남", "남자", "남성"].includes(n)) return "M";
  if (["여", "여자", "여성"].includes(n)) return "F";
  if (["합계", "계", "전체", "총계"].includes(n)) return "T";
  return "?";
}

export const UNIT_FACTOR: Record<string, number> = { 원: 1, 천원: 1e3, 만원: 1e4, 백만원: 1e6, 억원: 1e8 };

// 비고에 적힌 금액 단위 표기를 읽는다. 숫자 바로 뒤의 "만원"(예: "500만원")은 금액이지 단위 표기가 아니므로 제외.
export function parseUnits(rm: unknown): string[] {
  const s = squash(rm);
  const out = new Set<string>();
  for (const m of s.matchAll(/(?<![0-9.,])(백만|천|만|억)원/g)) out.add(`${m[1]}원`);
  if (/단위[:：]?원(?![가-힣])/.test(s) || /[(（[]원[)）\]]/.test(s)) out.add("원");
  return [...out];
}

export function classifyRows(list: EmpRawRow[]): ClassifiedRow[] {
  return list.map((r, idx) => {
    const fields = Object.fromEntries(
      EMP_FIELDS.map((f) => [f, r[f] == null ? "" : String(r[f]).trim()]),
    ) as Record<EmpField, string>;
    const scope = scopeOf(fields.fo_bbm);
    const sex = sexOf(fields.sexdstn);
    let cls: RowClass = "UNCLASSIFIED";
    if (scope === "company" && (sex === "M" || sex === "F")) cls = "COMPANY_SEX";
    else if (scope === "company" && sex === "T") cls = "COMPANY_TOTAL";
    else if (scope === "segment" && (sex === "M" || sex === "F")) cls = "SEGMENT_SEX";
    else if (scope === "segment" && sex === "T") cls = "SEGMENT_TOTAL";
    return {
      idx, fields, cls, scope, sex, segment: scope === "segment" ? squash(fields.fo_bbm) : null, units: parseUnits(fields.rm),
      pop: { rgllbr_co: parseNum(r.rgllbr_co), cnttk_co: parseNum(r.cnttk_co) },
    };
  });
}

export type UnitResolution =
  | { status: "ok"; unit: string; factor: number; basis: string }
  | { status: "held"; unit: null; factor: null; reason: string };

// 비고 표기를 따른다. 표기가 섞이거나 일부 행에만 원 이외 단위가 있으면 보류. 값 크기로 단위를 추정하지 않는다.
export function resolveUnit(rows: ClassifiedRow[]): UnitResolution {
  const all = new Set(rows.flatMap((r) => r.units));
  if (all.size === 0) return { status: "ok", unit: "원", factor: 1, basis: "비고에 단위 표기 없음 → 원 단위" };
  if (all.size > 1) return { status: "held", unit: null, factor: null, reason: `비고 단위 표기 혼재(${[...all].join(", ")})` };
  const unit = [...all][0];
  const covered = rows.filter((r) => r.units.length > 0).length;
  if (unit !== "원" && covered < rows.length) {
    return {
      status: "held", unit: null, factor: null,
      reason: `비고 단위(${unit}) 표기가 ${rows.length}개 행 중 ${covered}개 행에만 있어 나머지 행의 단위를 확정할 수 없음`,
    };
  }
  return { status: "ok", unit, factor: UNIT_FACTOR[unit], basis: `비고 표기 "${unit}" 적용(${covered}/${rows.length}행)` };
}

type BasisState = "ok" | "absent" | "duplicate" | "incomplete" | "missing" | "inconsistent";
export interface BasisCheck { name: string; state: BasisState; value: number | null; note?: string }

export interface Resolution {
  status: "ok" | "held";
  value: number | null;
  basis: string | null;
  checks: BasisCheck[];
  reasons: string[];
}

const BASIS = { total: "회사 합계 행", sexSum: "성별합계 남+여", detail: "부문 상세 합" } as const;

function num(r: ClassifiedRow, field: EmpField, factor: number) {
  const n = parseNum(r.fields[field]);
  return n == null ? null : n * factor;
}

function companyTotal(rows: ClassifiedRow[], field: EmpField, f: number): BasisCheck {
  const t = rows.filter((r) => r.cls === "COMPANY_TOTAL");
  if (t.length === 0) return { name: BASIS.total, state: "absent", value: null, note: "행 없음" };
  if (t.length > 1) return { name: BASIS.total, state: "duplicate", value: null, note: `${t.length}개 행` };
  const v = num(t[0], field, f);
  return v == null ? { name: BASIS.total, state: "missing", value: null, note: "값 없음" } : { name: BASIS.total, state: "ok", value: v };
}

function companySexSum(rows: ClassifiedRow[], field: EmpField, f: number): BasisCheck {
  const m = rows.filter((r) => r.cls === "COMPANY_SEX" && r.sex === "M");
  const w = rows.filter((r) => r.cls === "COMPANY_SEX" && r.sex === "F");
  if (m.length + w.length === 0) return { name: BASIS.sexSum, state: "absent", value: null, note: "행 없음" };
  if (m.length > 1 || w.length > 1) return { name: BASIS.sexSum, state: "duplicate", value: null, note: "같은 성별 행 중복" };
  if (m.length !== 1 || w.length !== 1) return { name: BASIS.sexSum, state: "incomplete", value: null, note: "한쪽 성별 행 없음" };
  const a = num(m[0], field, f), b = num(w[0], field, f);
  if (a == null || b == null) return { name: BASIS.sexSum, state: "missing", value: null, note: "남/여 중 값 없음" };
  return { name: BASIS.sexSum, state: "ok", value: a + b };
}

function segmentDetail(rows: ClassifiedRow[], field: EmpField, f: number): BasisCheck {
  const seg = rows.filter((r) => r.cls === "SEGMENT_SEX" || r.cls === "SEGMENT_TOTAL");
  if (seg.length === 0) return { name: BASIS.detail, state: "absent", value: null, note: "부문 상세 행 없음" };
  if (rows.some((r) => r.cls === "UNCLASSIFIED")) {
    return { name: BASIS.detail, state: "incomplete", value: null, note: "분류 불가 행이 있어 상세가 완전한지 알 수 없음" };
  }
  const groups = new Map<string, ClassifiedRow[]>();
  for (const r of seg) groups.set(r.segment!, [...(groups.get(r.segment!) ?? []), r]);
  let sum = 0;
  for (const [name, g] of groups) {
    const m = g.filter((r) => r.sex === "M"), w = g.filter((r) => r.sex === "F"), t = g.filter((r) => r.sex === "T");
    if (m.length > 1 || w.length > 1 || t.length > 1) {
      return { name: BASIS.detail, state: "incomplete", value: null, note: `부문 "${name}" 행 중복` };
    }
    const mv = m[0] ? num(m[0], field, f) : null, wv = w[0] ? num(w[0], field, f) : null;
    const tv = t[0] ? num(t[0], field, f) : null;
    if (mv != null && wv != null) {
      if (tv != null && tv !== mv + wv) {
        return { name: BASIS.detail, state: "inconsistent", value: null, note: `부문 "${name}" 소계 ${fmtInt(tv)} ≠ 남+여 ${fmtInt(mv + wv)}` };
      }
      sum += mv + wv; // 부문 소계와 남/여가 모두 있으면 남/여만 더한다(중복 합산 방지)
    } else if (tv != null && m.length + w.length === 0) {
      sum += tv;
    } else {
      return { name: BASIS.detail, state: "incomplete", value: null, note: `부문 "${name}" 값 결측 또는 성별 행 누락` };
    }
  }
  return { name: BASIS.detail, state: "ok", value: sum, note: `${groups.size}개 부문` };
}

// 기준 우선순위: 회사 합계 행 → 성별합계 남+여 → 완전한 부문 상세 합. 사용 가능한 기준은 모두 일치해야 한다.
export function resolveAdditive(rows: ClassifiedRow[], field: "sm" | "fyer_salary_totamt", factor: number, fmt: (n: number) => string): Resolution {
  const checks = [companyTotal(rows, field, factor), companySexSum(rows, field, factor), segmentDetail(rows, field, factor)];
  const reasons: string[] = [];
  for (const c of checks.slice(0, 2)) {
    if (c.state === "duplicate") reasons.push(`${c.name}이(가) 중복되어 기준 행을 확정할 수 없음`);
  }
  if (checks[2].state === "inconsistent") reasons.push(`부문 상세 내부 충돌: ${checks[2].note}`);
  const ok = checks.filter((c) => c.state === "ok");
  if (ok.length === 0 && reasons.length === 0) reasons.push("완전한 기준(회사 합계·성별합계·부문 상세)이 없음");
  const distinct = new Set(ok.map((c) => c.value));
  if (distinct.size > 1) reasons.push(`기준 간 충돌: ${ok.map((c) => `${c.name} ${fmt(c.value!)}`).join(" / ")}`);
  if (reasons.length) return { status: "held", value: null, basis: null, checks, reasons };
  const primary = ok[0];
  const cross = ok.slice(1).map((c) => c.name);
  const single = primary.name === BASIS.detail && primary.note === "1개 부문" ? "단일 부문, " : "";
  return {
    status: "ok", value: primary.value, checks, reasons: [],
    basis: cross.length ? `${primary.name} (일치 확인: ${cross.join(", ")})` : `${primary.name} (${single}교차검증 불가)`,
  };
}

export interface StlmCheck { status: "ok" | "held"; date: string | null; reasons: string[] }

export function checkStlm(rows: ClassifiedRow[], year: number): StlmCheck {
  const dates = [...new Set(rows.map((r) => r.fields.stlm_dt).filter((d) => d && d !== "-"))];
  if (dates.length === 0) return { status: "held", date: null, reasons: ["결산기준일(stlm_dt)이 없어 사업연도말 인원인지 확인 불가"] };
  if (dates.length > 1) return { status: "held", date: null, reasons: [`행마다 결산기준일이 다름(${dates.join(", ")})`] };
  if (!dates[0].startsWith(String(year))) {
    return { status: "held", date: dates[0], reasons: [`결산기준일 ${dates[0]}이(가) ${year} 사업연도와 맞지 않음`] };
  }
  return { status: "ok", date: dates[0], reasons: [] };
}

// 모집단(범위) 확인: 합계(sm) = 정규직(rgllbr_co) + 기간제(cnttk_co)여야 같은 직원 범위로 본다. 어긋나면 범위 미확인 → 보류.
export interface PopulationCheck { status: "ok" | "held"; checked: number; reasons: string[] }

// basisClasses: 직원 수 계산 기준이 된 행 분류. 이 행들은 정규직·기간제 수가 있어야 범위를 확인한 것으로 본다.
export function checkPopulation(rows: ClassifiedRow[], basisClasses: RowClass[] = []): PopulationCheck {
  const bad: string[] = [];
  const unknown = rows.filter((r) => basisClasses.includes(r.cls) && (r.pop.rgllbr_co == null || r.pop.cnttk_co == null));
  if (unknown.length) bad.push(`계산 기준 ${unknown.map((r) => `${r.idx + 1}행`).join("·")}의 정규직·기간제 수 결측`);
  let checked = 0;
  for (const r of rows) {
    const sm = parseNum(r.fields.sm), { rgllbr_co: rg, cnttk_co: ct } = r.pop;
    if (sm == null || rg == null || ct == null) continue;
    checked++;
    if (sm !== rg + ct) bad.push(`${r.idx + 1}행 합계 ${fmtInt(sm)} ≠ 정규직 ${fmtInt(rg)} + 기간제 ${fmtInt(ct)}`);
  }
  return bad.length ? { status: "held", checked, reasons: [`직원 범위 미확인: ${bad.join("; ")}`] } : { status: "ok", checked, reasons: [] };
}

export interface Disclosed {
  status: "ok" | "absent" | "missing" | "held";
  raw: string | null;
  value: number | null; // 원
  display: string;
  note?: string;
}

function fromRow(r: ClassifiedRow, unit: UnitResolution, source: string): Disclosed {
  const raw = r.fields.jan_salary_am;
  const n = parseNum(raw);
  if (n == null) return { status: "missing", raw, value: null, display: "공시값 없음", note: source };
  if (unit.status !== "ok") return { status: "held", raw, value: null, display: `원문 ${raw} (단위 미확정)`, note: `${source} · ${unit.reason}` };
  const won = n * unit.factor;
  return { status: "ok", raw, value: won, display: `${fmtWon(won)} (${approxWon(won)})`, note: unit.unit !== "원" ? `${source} · 원문 ${raw}${unit.unit}` : source };
}

// 남녀 공시 1인평균: 성별합계 행 → (성별합계 행이 없고 부문이 하나뿐이면) 그 부문 행. 부문이 여럿이면 표시하지 않는다.
function disclosedSex(rows: ClassifiedRow[], sex: "M" | "F", unit: UnitResolution): Disclosed {
  const c = rows.filter((r) => r.cls === "COMPANY_SEX" && r.sex === sex);
  if (c.length > 1) return { status: "held", raw: null, value: null, display: "보류", note: "성별합계 행이 중복됨" };
  if (c.length === 1) return fromRow(c[0], unit, "성별합계 행");
  if (rows.some((r) => r.scope === "company")) return { status: "absent", raw: null, value: null, display: "공시 행 없음" };
  const segs = [...new Set(rows.filter((r) => r.cls === "SEGMENT_SEX" || r.cls === "SEGMENT_TOTAL").map((r) => r.segment))];
  if (segs.length !== 1 || rows.some((r) => r.cls === "UNCLASSIFIED")) {
    return { status: "absent", raw: null, value: null, display: "공시 행 없음", note: segs.length > 1 ? "성별합계 행 없음 — 부문이 여러 개라 표시하지 않음" : undefined };
  }
  const s = rows.filter((r) => r.cls === "SEGMENT_SEX" && r.sex === sex);
  if (s.length !== 1) return { status: s.length ? "held" : "absent", raw: null, value: null, display: s.length ? "보류" : "공시 행 없음" };
  return fromRow(s[0], unit, `부문 '${s[0].fields.fo_bbm}' 행 공시값(단일 부문)`);
}

function disclosedTotal(rows: ClassifiedRow[], unit: UnitResolution): Disclosed {
  const c = rows.filter((r) => r.cls === "COMPANY_TOTAL");
  if (c.length === 0) return { status: "absent", raw: null, value: null, display: "공시 행 없음", note: "회사 합계 행이 없어 공시 전체 평균 없음 — 앱이 계산하지 않음" };
  if (c.length > 1) return { status: "held", raw: null, value: null, display: "보류", note: "회사 합계 행이 중복됨" };
  return fromRow(c[0], unit, "회사 합계 행");
}

export interface MetricValue {
  status: "ok" | "held";
  value: number | null;
  display: string;
  basis: string | null;
  reasons: string[];
}

export interface EmpAnalysis {
  reportStatus: string;
  rcept_no: string | null;
  rows: ClassifiedRow[];
  unit: UnitResolution;
  stlm: StlmCheck;
  population: PopulationCheck;
  headcountRaw: Resolution;
  salaryTotal: Resolution;
  headcount: MetricValue; // 검증된 사업연도말 직원 수
  salaryPerHead: MetricValue; // 기말 인원당 급여총액(계산값)
  disclosed: { M: Disclosed; F: Disclosed; T: Disclosed };
  warnings: string[];
}

const held = (reasons: string[]): MetricValue => ({ status: "held", value: null, display: "보류", basis: null, reasons });

export function analyzeEmp(resp: { status: string; list: EmpRawRow[] }, year: number): EmpAnalysis {
  const rows = classifyRows(resp.list ?? []);
  const unit = resolveUnit(rows);
  const stlm = checkStlm(rows, year);
  const headcountRaw = resolveAdditive(rows, "sm", 1, (n) => `${fmtInt(n)}명`);
  const basisClasses: RowClass[] = headcountRaw.basis?.startsWith(BASIS.total) ? ["COMPANY_TOTAL"]
    : headcountRaw.basis?.startsWith(BASIS.sexSum) ? ["COMPANY_SEX"]
    : headcountRaw.basis?.startsWith(BASIS.detail) ? ["SEGMENT_SEX", "SEGMENT_TOTAL"] : [];
  const population = checkPopulation(rows, basisClasses);
  const salaryTotal = unit.status === "ok"
    ? resolveAdditive(rows, "fyer_salary_totamt", unit.factor, fmtWon)
    : { status: "held" as const, value: null, basis: null, checks: [], reasons: [`급여 단위 확정 불가: ${unit.reason}`] };
  const warnings: string[] = [];
  const unclassified = rows.filter((r) => r.cls === "UNCLASSIFIED").length;
  if (unclassified) warnings.push(`분류 불가 행 ${unclassified}개 — 계산에 쓰지 않음`);

  const noData = rows.length === 0 ? ["사업보고서 직원현황(empSttus) 데이터 없음"] : [];
  let headcount: MetricValue;
  if (noData.length) headcount = held(noData);
  else if (headcountRaw.status !== "ok") headcount = held(headcountRaw.reasons);
  else if (stlm.status !== "ok") headcount = held(stlm.reasons);
  else if (population.status !== "ok") headcount = held(population.reasons);
  else headcount = { status: "ok", value: headcountRaw.value, display: `${fmtInt(headcountRaw.value!)}명`, basis: `${headcountRaw.basis} · 결산기준일 ${stlm.date}`, reasons: [] };

  let salaryPerHead: MetricValue;
  if (headcount.status !== "ok") salaryPerHead = held(["검증된 사업연도말 직원 수 없음", ...headcount.reasons]);
  else if (headcount.value === 0) salaryPerHead = held(["직원 수 0명 — 나눌 수 없음"]);
  else if (salaryTotal.status !== "ok") salaryPerHead = held(salaryTotal.reasons);
  else {
    const v = Math.round(salaryTotal.value! / headcount.value!);
    salaryPerHead = {
      status: "ok", value: v, display: fmtWon(v), reasons: [],
      basis: `연간급여총액 ${fmtWon(salaryTotal.value!)} [${salaryTotal.basis}] ÷ ${headcount.display}`,
    };
  }

  const rcept = (resp.list ?? []).map((r) => r.rcept_no).find(Boolean);
  return {
    reportStatus: resp.status, rcept_no: rcept ? String(rcept) : null, rows, unit, stlm, population, headcountRaw, salaryTotal,
    headcount, salaryPerHead, warnings,
    disclosed: {
      M: disclosedSex(rows, "M", unit),
      F: disclosedSex(rows, "F", unit),
      T: disclosedTotal(rows, unit),
    },
  };
}

const CLS_BASIS: Record<RowClass, string | null> = {
  COMPANY_TOTAL: BASIS.total, COMPANY_SEX: BASIS.sexSum, SEGMENT_SEX: BASIS.detail, SEGMENT_TOTAL: BASIS.detail, UNCLASSIFIED: null,
};

// 행마다 인원·급여총액 계산에 쓰였는지, 대조만 했는지, 제외됐는지와 그 이유.
export function rowUsage(a: EmpAnalysis): string[] {
  const role = (res: Resolution, b: string, what: string, rowVal: string) => {
    if (parseNum(rowVal) == null) return `${what}: 제외(값 결측)`;
    if (res.status !== "ok") return `${what}: 보류(${res.reasons[0] ?? "기준 없음"})`;
    const check = res.checks.find((c) => c.name === b);
    if (res.basis?.startsWith(b)) return `${what}: 계산 기준`;
    if (check?.state === "ok") return `${what}: 대조만(합산 안 함)`;
    return `${what}: 제외(${b} ${check?.state ?? "없음"}${check?.note ? ` — ${check.note}` : ""})`;
  };
  return a.rows.map((r) => {
    const b = CLS_BASIS[r.cls];
    if (!b) return "제외 — 분류 불가(범위 미확인)";
    const seg = r.cls === "SEGMENT_TOTAL" && a.rows.some((x) => x.segment === r.segment && x.cls === "SEGMENT_SEX")
      ? " · 부문 소계는 남/여와 대조만" : "";
    return `${role(a.headcountRaw, b, "인원", r.fields.sm)} · ${role(a.salaryTotal, b, "급여총액", r.fields.fyer_salary_totamt)}${seg}`;
  });
}
