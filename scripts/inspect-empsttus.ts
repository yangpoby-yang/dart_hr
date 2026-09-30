// Step 0: 실제 empSttus 원본 행을 사람이 확인하기 위한 도구(원본 → 단위 → 분류·중복 제거 → 범위 → 산식).
// 사용: npm run step0 -- <사업연도[,사업연도…]> <회사1> <회사2>   (회사 = 고유번호 8자리 · 종목코드 6자리 · 정확한 회사명)
import fs from "node:fs";
import { fetchEmpSttus, searchCorps } from "../lib/dart";
import { analyzeEmp, rowUsage, ROW_CLASS_LABEL, type ClassifiedRow } from "../lib/emp";
import { parseNum, fmtInt, fmtWon } from "../lib/num";

try { process.loadEnvFile(".env"); } catch {}

async function resolve(q: string) {
  const hits = await searchCorps(q);
  const exact = hits.find((c) => c.corp_code === q || c.stock_code === q || c.corp_name === q);
  if (!exact) throw new Error(`"${q}"를 정확히 찾지 못함. 후보: ${hits.slice(0, 5).map((c) => `${c.corp_name}(${c.corp_code})`).join(", ") || "없음"}`);
  return exact;
}

const esc = (s: string) => (s || "").replace(/\|/g, "\\|");
const sum = (rows: ClassifiedRow[], f: "sm" | "fyer_salary_totamt") => {
  const v = rows.map((r) => parseNum(r.fields[f]));
  return v.length && v.every((x) => x != null) ? (v as number[]).reduce((a, b) => a + b, 0) : null;
};
const n = (v: number | null, unit = "") => (v == null ? "결측/없음" : `${fmtInt(v)}${unit}`);

async function main() {
  const [yearsArg, ...names] = process.argv.slice(2);
  const years = (yearsArg ?? "").split(",").map(Number).filter(Boolean);
  if (!years.length || names.length < 2) throw new Error("사용: npm run step0 -- 2024,2025 삼성전자 SK하이닉스");
  let md = `# Step 0 — empSttus 원본 행 확인 (사업보고서 11011 · ${years.join(", ")})\n\n생성: ${new Date().toISOString()}\n`;
  for (const q of names) {
    const corp = await resolve(q);
    for (const year of years) {
      const resp = await fetchEmpSttus(corp.corp_code, year);
      const a = analyzeEmp(resp, year);
      const use = rowUsage(a);
      md += `\n## ${corp.corp_name} (${corp.corp_code}) · ${year} · status ${resp.status} · ${resp.list.length}행${a.rcept_no ? ` · 접수번호 ${a.rcept_no}` : ""}\n\n`;
      md += `- 기준일(stlm_dt): ${a.stlm.status === "ok" ? a.stlm.date : `보류 — ${a.stlm.reasons.join("; ")}`}\n`;
      md += `- 모집단: 사업보고서 직원 등 현황(별도 법인) · 합계(sm) = 정규직(rgllbr_co) + 기간제(cnttk_co) → ${a.population.status === "ok" ? `일치 (${a.population.checked}행 확인)` : `보류 — ${a.population.reasons.join("; ")}`}\n`;
      const rms = [...new Set(a.rows.map((r) => r.fields.rm))];
      md += `- 비고(rm) 원문: ${rms.map((r) => `"${r}"`).join(", ")} → 단위 ${a.unit.status === "ok" ? a.unit.basis : `보류 — ${a.unit.reason}`}\n\n`;
      md += `| # | fo_bbm | sexdstn | sm | 정규직+기간제 | fyer_salary_totamt | jan_salary_am | stlm_dt | rm | 분류 | 사용·제외 |\n|---|---|---|---:|---:|---:|---:|---|---|---|---|\n`;
      for (const r of a.rows) {
        const f = r.fields, p = r.pop;
        const pop = p.rgllbr_co != null && p.cnttk_co != null ? `${fmtInt(p.rgllbr_co)}+${fmtInt(p.cnttk_co)}` : "-";
        md += `| ${r.idx + 1} | ${esc(f.fo_bbm)} | ${esc(f.sexdstn)} | ${esc(f.sm)} | ${pop} | ${esc(f.fyer_salary_totamt)} | ${esc(f.jan_salary_am)} | ${esc(f.stlm_dt)} | ${esc(f.rm)} | ${ROW_CLASS_LABEL[r.cls]} | ${use[r.idx]} |\n`;
      }
      const cs = (sex: "M" | "F") => a.rows.filter((r) => r.cls === "COMPANY_SEX" && r.sex === sex);
      const ss = (sex: "M" | "F") => a.rows.filter((r) => r.cls === "SEGMENT_SEX" && r.sex === sex);
      const segs = [...new Set(a.rows.filter((r) => r.segment).map((r) => r.fields.fo_bbm))];
      md += `\n**합계 대조 (원 환산 전 원문 기준)**\n\n| 구분 | 남 | 여 | 남+여 |\n|---|---:|---:|---:|\n`;
      for (const [label, pick] of [["성별합계 행", cs], [`부문 상세 합 (${segs.join("·") || "-"})`, ss]] as const) {
        for (const f of ["sm", "fyer_salary_totamt"] as const) {
          const m = pick("M").length ? sum(pick("M"), f) : null, w = pick("F").length ? sum(pick("F"), f) : null;
          md += `| ${label} · ${f === "sm" ? "인원" : "급여총액"} | ${n(m)} | ${n(w)} | ${m != null && w != null ? fmtInt(m + w) : "-"} |\n`;
        }
      }
      const total = a.rows.filter((r) => r.cls === "COMPANY_TOTAL");
      md += `| 회사 합계 행 | | | ${total.length ? `인원 ${n(parseNum(total[0].fields.sm))} · 급여총액 ${n(parseNum(total[0].fields.fyer_salary_totamt))}` : "행 없음"} |\n`;
      md += `\n**산식**\n\n`;
      md += `- 사업연도말 직원 수: ${a.headcount.status === "ok" ? `${a.headcount.display} — ${a.headcount.basis}` : `보류 — ${a.headcount.reasons.join("; ")}`}\n`;
      md += `- 연간급여총액(원): ${a.salaryTotal.status === "ok" ? `${fmtWon(a.salaryTotal.value!)} — ${a.salaryTotal.basis}` : `보류 — ${a.salaryTotal.reasons.join("; ")}`}\n`;
      md += `- 기말 인원당 급여총액 · 계산값(공시 1인평균 아님): ${a.salaryPerHead.status === "ok" ? `${a.salaryPerHead.display} = ${a.salaryPerHead.basis}` : `보류 — ${a.salaryPerHead.reasons.join("; ")}`}\n`;
      md += `- 공시 1인평균(공시값): 남 ${a.disclosed.M.display}${a.disclosed.M.note ? ` [${a.disclosed.M.note}]` : ""} · 여 ${a.disclosed.F.display}${a.disclosed.F.note ? ` [${a.disclosed.F.note}]` : ""} · 회사 합계 행 ${a.disclosed.T.display}\n`;
    }
  }
  fs.mkdirSync("step0", { recursive: true });
  const out = `step0/empsttus-${years.join("_")}.md`;
  fs.writeFileSync(out, md);
  console.log(md);
  console.log(`\n저장: ${out}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
