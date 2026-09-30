// 실제 API 대조: 앱 코드(lib)를 쓰지 않고 OpenDART 원본을 직접 받아 독립 재계산한 값과
// 실행 중인 앱의 /api/compare(화면 값) · /api/briefing(AI 전달값) 결과를 비교한다.
// 사용: npx tsx scripts/verify-live.mts 2024,2025 00126380 00164779   (앱이 localhost:3000에서 실행 중이어야 함)
try { process.loadEnvFile(".env"); } catch {}
const KEY = process.env.OPENDART_API_KEY!;
const APP = process.env.APP_URL ?? "http://localhost:3000";
const [yearsArg = "2024,2025", A = "00126380", B = "00164779"] = process.argv.slice(2);
const years = yearsArg.split(",").map(Number);

const num = (v: unknown) => { const s = String(v ?? "").replace(/[,\s]/g, ""); return /^-?\d+$/.test(s) ? Number(s) : null; };
async function dart(ep: string, p: Record<string, string>) {
  const u = new URL(`https://opendart.fss.or.kr/api/${ep}`);
  u.searchParams.set("crtfc_key", KEY);
  for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v);
  return (await fetch(u)).json();
}

// 독립 재계산 — 규칙을 여기서 다시 적는다: 성별합계 행이 있으면 그것만, 없고 단일 부문이면 그 부문 행만 합산.
async function independent(corp: string, year: number) {
  const emp = await dart("empSttus.json", { corp_code: corp, bsns_year: String(year), reprt_code: "11011" });
  const rows: any[] = emp.list ?? [];
  const units = new Set(rows.map((r) => String(r.rm ?? "").trim()).filter((x) => x && x !== "-"));
  const sexTotal = rows.filter((r) => String(r.fo_bbm).trim() === "성별합계");
  const segs = new Set(rows.filter((r) => String(r.fo_bbm).trim() !== "성별합계").map((r) => String(r.fo_bbm).trim()));
  const base = sexTotal.length ? sexTotal : segs.size === 1 ? rows : null;
  const popOk = rows.every((r) => num(r.sm) === (num(r.rgllbr_co) ?? NaN) + (num(r.cnttk_co) ?? NaN));
  const dates = new Set(rows.map((r) => r.stlm_dt));
  const hc = base ? base.reduce((a, r) => a + num(r.sm)!, 0) : null;
  const sal = base ? base.reduce((a, r) => a + num(r.fyer_salary_totamt)!, 0) : null;
  const fs = await dart("fnlttSinglAcntAll.json", { corp_code: corp, bsns_year: String(year), reprt_code: "11011", fs_div: "OFS" });
  const revRows = (fs.list ?? []).filter((r: any) => r.account_id === "ifrs-full_Revenue" && ["IS", "CIS"].includes(r.sj_div));
  const revs = new Set(revRows.map((r: any) => num(r.thstrm_amount)));
  const rev = revs.size === 1 ? [...revs][0] : null;
  const m = base?.find((r) => r.sexdstn === "남"), f = base?.find((r) => r.sexdstn === "여");
  return {
    rcept: rows[0]?.rcept_no, fsRcept: revRows[0]?.rcept_no, units: [...units], popOk, dates: [...dates],
    hc, sal, salaryPerHead: hc && sal != null ? Math.round(sal / hc) : null,
    rev, revenuePerHead: hc && rev != null ? Math.round(rev / hc) : null,
    discM: num(m?.jan_salary_am), discF: num(f?.jan_salary_am), currency: revRows[0]?.currency,
  };
}

const post = async (p: string, body: object) => (await fetch(`${APP}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
let fail = 0;
const check = (label: string, a: unknown, b: unknown) => {
  const ok = a === b; if (!ok) fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}: 독립 ${a?.toLocaleString?.("ko-KR") ?? a} / 앱 ${b?.toLocaleString?.("ko-KR") ?? b}`);
};

for (const year of years) {
  const cmp = await post("/api/compare", { mode: "live", a: A, b: B, year });
  const br = await post("/api/briefing", { mode: "live", a: A, b: B, year });
  const ctx = JSON.stringify(br.context ?? {});
  for (const c of cmp.companies) {
    const ind = await independent(c.corp_code, year);
    console.log(`\n■ ${year} ${c.corp_name} — 접수번호 ${ind.rcept} · 재무 ${ind.fsRcept} · 기준일 ${ind.dates.join(",")} · 비고 단위 표기 ${ind.units.length ? ind.units.join(",") : "없음(원)"} · 범위(sm=정규직+기간제) ${ind.popOk ? "일치" : "불일치"} · 통화 ${ind.currency}`);
    check("직원 수", ind.hc, c.metrics.headcount.value);
    check("연간급여총액(원)", ind.sal, c.emp.salaryTotal.value);
    check("기말 인원당 급여총액·계산값", ind.salaryPerHead, c.metrics.salaryPerHead.value);
    check("별도(OFS) 매출(원)", ind.rev, c.revenue.value);
    check("인당 매출·계산값", ind.revenuePerHead, c.metrics.revenuePerHead.value);
    check("남 공시 1인평균", ind.discM, c.emp.disclosed.M.value);
    check("여 공시 1인평균", ind.discF, c.emp.disclosed.F.value);
    check("직원현황·재무 접수번호 동일", ind.rcept, ind.fsRcept);
    for (const k of ["headcount", "salaryPerHead", "revenuePerHead"]) {
      const d = c.metrics[k].display;
      const inCtx = ctx.includes(d);
      if (!inCtx) fail++;
      console.log(`  ${inCtx ? "✅" : "❌"} AI 전달값에 화면 값 포함(${k}): ${d}`);
    }
  }
  for (const k of ["headcount", "salaryPerHead", "revenuePerHead"]) {
    const g = cmp.gaps[k];
    const a = cmp.companies[0].metrics[k].value, b = cmp.companies[1].metrics[k].value;
    const ok = g.diff === a - b && Math.abs(g.rate - ((a - b) / b) * 100) < 1e-9 && ctx.includes(g.diffDisplay) && ctx.includes(g.rateDisplay);
    if (!ok) fail++;
    console.log(`  ${ok ? "✅" : "❌"} 격차 ${k}: ${g.diffDisplay} (${g.rateDisplay}) — 서버 산식·AI 전달값 일치`);
  }
  const txt: string = br.briefing ?? "";
  const bad = /기말 인원당 급여총액[^.\n]{0,40}(공시\s*1인\s*평균|평균급여)(이다|입니다|로 공시)/.test(txt);
  console.log(`  ${bad ? "❌" : "✅"} 브리핑이 계산값을 공시 평균이라 부르지 않음 · 후속 질문 ${br.followups?.length}개`);
  if (bad) fail++;
}
console.log(`\n결과: ${fail === 0 ? "모두 일치" : `불일치 ${fail}건`}`);
process.exit(fail ? 1 : 0);
