"use client";
import { useEffect, useRef, useState } from "react";
import type { Comparison, CompanyResult, MetricKey } from "../lib/compare";
import type { Disclosed } from "../lib/emp";

type Mode = "demo" | "live";
type Corp = { corp_code: string; corp_name: string; stock_code?: string; note?: string };
type Msg = { role: "user" | "assistant"; content: string };
type Status = { dart: boolean; openai: boolean; model: string | null };
type Brief = { briefing: string; followups: string[]; mock: boolean; context: unknown };

const ROW_CLASS_LABEL: Record<string, string> = {
  COMPANY_TOTAL: "회사 합계", COMPANY_SEX: "성별합계(남/여)", SEGMENT_TOTAL: "부문 소계", SEGMENT_SEX: "부문 상세", UNCLASSIFIED: "분류 불가",
};
const CARD_TITLE: Record<MetricKey, string> = {
  headcount: "사업연도말 직원 수",
  salaryPerHead: "기말 인원당 급여총액 · 계산값(공시 1인평균 아님)",
  revenuePerHead: "인당 매출 · 계산값",
};
const thisYear = new Date().getFullYear();
const YEARS = Array.from({ length: thisYear - 2015 }, (_, i) => thisYear - 1 - i);

async function post<T>(url: string, body: unknown, signal: AbortSignal): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `요청 실패(${r.status})`);
  return j;
}

export default function Page() {
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<Mode>("demo");
  const [a, setA] = useState<Corp | null>(null);
  const [b, setB] = useState<Corp | null>(null);
  const [year, setYear] = useState(thisYear - 1);
  const [demoCorps, setDemoCorps] = useState<Corp[]>([]);

  const [cmp, setCmp] = useState<Comparison | null>(null);
  const [cmpErr, setCmpErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [briefErr, setBriefErr] = useState<string | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [followups, setFollowups] = useState<string[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatErr, setChatErr] = useState<string | null>(null);
  const [input, setInput] = useState("");

  const run = useRef(0);
  const ctrl = useRef<AbortController>(new AbortController());

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => {});
    fetch("/api/corps?mode=demo").then((r) => r.json()).then((j) => setDemoCorps(j.corps ?? []));
  }, []);

  // 조건(모드·기업·연도)이 바뀌면 결과·브리핑·대화를 모두 초기화하고 진행 중인 요청을 버린다.
  function reset() {
    run.current++;
    ctrl.current.abort();
    ctrl.current = new AbortController();
    setCmp(null); setCmpErr(null); setLoading(false);
    setBrief(null); setBriefErr(null); setBriefLoading(false);
    setMsgs([]); setFollowups([]); setChatErr(null); setChatLoading(false); setInput("");
  }
  useEffect(reset, [mode, a?.corp_code, b?.corp_code, year]);

  useEffect(() => {
    if (mode === "demo" && demoCorps.length >= 2) { setA(demoCorps[0]); setB(demoCorps[1]); }
    if (mode === "live") { setA(null); setB(null); }
  }, [mode, demoCorps]);

  const cond = () => ({ mode, a: a!.corp_code, b: b!.corp_code, year });

  async function compare() {
    if (!a || !b) return;
    reset();
    const id = run.current, signal = ctrl.current.signal, c = cond();
    setLoading(true);
    let stage: "compare" | "briefing" = "compare";
    try {
      const r = await post<Comparison>("/api/compare", c, signal);
      if (id !== run.current) return;
      setCmp(r); setLoading(false);
      stage = "briefing";
      setBriefLoading(true);
      const br = await post<Brief>("/api/briefing", c, signal);
      if (id !== run.current) return;
      setBrief(br); setFollowups(br.followups);
    } catch (e) {
      if (id !== run.current || (e as Error).name === "AbortError") return;
      (stage === "compare" ? setCmpErr : setBriefErr)((e as Error).message);
    } finally {
      if (id === run.current) { setLoading(false); setBriefLoading(false); }
    }
  }

  async function ask(text: string) {
    const q = text.trim();
    if (!q || !cmp || chatLoading) return;
    const id = run.current, signal = ctrl.current.signal;
    const next: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs(next); setInput(""); setChatLoading(true); setChatErr(null); setFollowups([]);
    try {
      const r = await post<{ answer: string; followups: string[] }>("/api/chat", { ...cond(), messages: next }, signal);
      if (id !== run.current) return;
      setMsgs([...next, { role: "assistant", content: r.answer }]);
      setFollowups(r.followups);
    } catch (e) {
      if (id !== run.current || (e as Error).name === "AbortError") return;
      setChatErr((e as Error).message);
    } finally {
      if (id === run.current) setChatLoading(false);
    }
  }

  const keys: MetricKey[] = ["headcount", "salaryPerHead", "revenuePerHead"];

  return (
    <div className="wrap">
      <h1>DART HR 비교</h1>
      <p className="sub">두 기업 · 한 사업연도의 직원 수, 기말 인원당 급여총액(계산값), 인당 매출을 비교하고 AI HR 브리핑을 받습니다.</p>

      <div className="panel">
        <div className="controls">
          <label className="f">데이터
            <span className="seg">
              <button className={mode === "demo" ? "on" : ""} onClick={() => setMode("demo")}>합성 예시</button>
              <button className={mode === "live" ? "on" : ""} disabled={!status?.dart} onClick={() => setMode("live")}
                title={status?.dart ? "" : "OPENDART_API_KEY 미설정"}>실제 DART</button>
            </span>
          </label>
          <CorpPicker label="기업 A" mode={mode} value={a} onChange={setA} demoCorps={demoCorps} />
          <CorpPicker label="기업 B (비교 기준)" mode={mode} value={b} onChange={setB} demoCorps={demoCorps} />
          <label className="f">사업연도
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <button className="primary" disabled={!a || !b || a.corp_code === b.corp_code || loading} onClick={compare}>
            {loading ? "조회 중…" : "비교하기"}
          </button>
        </div>
        <p className="note" style={{ margin: "12px 0 0" }}>
          {mode === "demo" ? "합성 예시는 실제 기업·공시가 아닙니다. 계산 규칙과 보류 처리를 검사하기 위한 고정 데이터입니다." : "OpenDART 사업보고서(11011) 기준."}
          {" "}OpenDART 키 {status?.dart ? "설정됨" : "미설정"} · OpenAI 키 {status?.openai ? "설정됨" : "미설정"} · 모델 {status?.model ?? "미설정"}
          {" "}· 조건을 바꾸면 결과와 대화가 초기화됩니다.
        </p>
        {a && b && a.corp_code === b.corp_code && <p className="err">서로 다른 두 기업을 선택하세요.</p>}
      </div>

      {cmpErr && <p className="err">{cmpErr}</p>}

      {cmp && (
        <>
          <h2>{cmp.year} 사업연도 · {cmp.companies[0].corp_name} vs {cmp.companies[1].corp_name}</h2>
          <div className="cards">
            {keys.map((k) => <MetricCard key={k} k={k} cmp={cmp} />)}
          </div>
          <p className="note">{cmp.gapDefinition}</p>

          <h2>공시 1인평균급여 <span className="badge disc">공시값</span></h2>
          <div className="grid2">
            {cmp.companies.map((c) => <DisclosedPanel key={c.label} c={c} def={cmp.disclosedDefinition} />)}
          </div>

          <h2>AI HR 브리핑</h2>
          <div className="panel">
            {briefLoading && <p className="note">서버 계산값으로 브리핑 생성 중…</p>}
            {briefErr && <p className="err">브리핑 생성 실패: {briefErr}</p>}
            {brief && <div className="brief">{brief.briefing}</div>}
            {brief && (
              <details><summary>AI에 전달한 데이터(서버 계산값·정의·출처)</summary>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{JSON.stringify(brief.context, null, 2)}</pre>
              </details>
            )}
          </div>

          {brief && (
            <>
              <h2>후속 대화</h2>
              <div className="panel">
                {msgs.map((m, i) => <div key={i} className={`msg ${m.role}`}>{m.content}</div>)}
                {chatLoading && <p className="note">답변 생성 중…</p>}
                {chatErr && <p className="err">{chatErr}</p>}
                {followups.length > 0 && (
                  <div className="chips">{followups.map((f) => <button key={f} onClick={() => ask(f)} disabled={chatLoading}>{f}</button>)}</div>
                )}
                <form className="chatbar" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
                  <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="이 비교 결과에 대해 질문하세요" maxLength={1000} />
                  <button className="primary" disabled={chatLoading || !input.trim()}>보내기</button>
                </form>
              </div>
            </>
          )}

          <h2>검증 상세</h2>
          <div className="grid2">
            {cmp.companies.map((c) => <Audit key={c.label} c={c} />)}
          </div>
        </>
      )}
    </div>
  );
}

function CorpPicker({ label, mode, value, onChange, demoCorps }: {
  label: string; mode: Mode; value: Corp | null; onChange: (c: Corp | null) => void; demoCorps: Corp[];
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Corp[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== "live" || q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/corps?mode=live&q=${encodeURIComponent(q)}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setHits(j.corps); setErr(null);
      } catch (e) { setErr((e as Error).message); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, mode]);

  if (mode === "demo") {
    return (
      <label className="f">{label}
        <select value={value?.corp_code ?? ""} onChange={(e) => onChange(demoCorps.find((c) => c.corp_code === e.target.value) ?? null)}>
          {demoCorps.map((c) => <option key={c.corp_code} value={c.corp_code}>{c.corp_name}</option>)}
        </select>
        {value?.note && <span className="note">{value.note}</span>}
      </label>
    );
  }
  return (
    <label className="f">{label}
      <input value={q} onChange={(e) => { setQ(e.target.value); if (value) onChange(null); }} placeholder="회사명·종목코드·고유번호" />
      {value && <span className="chosen">선택: {value.corp_name} ({value.corp_code}{value.stock_code ? ` · ${value.stock_code}` : ""})</span>}
      {err && <span className="err">{err}</span>}
      {!value && hits.length > 0 && (
        <div className="suggest">
          {hits.map((c) => (
            <div key={c.corp_code} onClick={() => { onChange(c); setQ(c.corp_name); setHits([]); }}>
              {c.corp_name} <span className="note">{c.stock_code || "비상장"} · {c.corp_code}</span>
            </div>
          ))}
        </div>
      )}
    </label>
  );
}

function MetricCard({ k, cmp }: { k: MetricKey; cmp: Comparison }) {
  const def = cmp.definitions[k], gap = cmp.gaps[k];
  return (
    <div className="card">
      <div>
        <h3>{CARD_TITLE[k]}</h3>
        <span className={`badge ${k === "headcount" ? "disc" : "calc"}`}>{def.kind}</span>
      </div>
      <div className="pair">
        {cmp.companies.map((c) => {
          const m = c.metrics[k];
          return (
            <div className="co" key={c.label}>
              <div className="n">{c.label} · {c.corp_name}</div>
              <div className={`big ${m.status === "held" ? "held" : ""}`}>{m.display}</div>
              {m.status === "ok" && def.unit === "원" && m.value != null && <div className="approx">{approx(m.value)}</div>}
              {m.status === "ok" && m.basis && (
                <div className={m.basis.includes("교차검증 불가") ? "warn" : "chosen"}>
                  {m.basis.includes("교차검증 불가") ? "⚠ 교차검증 불가 — 단일 기준" : "✓ 기준 간 일치 확인"}
                </div>
              )}
              {m.status === "held" && <ul className="reasons">{m.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
            </div>
          );
        })}
      </div>
      <div className="gap">
        <span>격차 A−B <b>{gap.diffDisplay}</b></span>
        <span>격차율 <b>{gap.rateDisplay}</b></span>
      </div>
      {gap.reason && <div className="warn">{gap.reason}</div>}
      <details><summary>정의·산출 근거</summary>
        <p className="basis">{def.formula}</p>
        {cmp.companies.map((c) => c.metrics[k].basis && <p className="basis" key={c.label}>{c.label}: {c.metrics[k].basis}</p>)}
      </details>
    </div>
  );
}

function approx(n: number) {
  const a = Math.abs(n);
  if (a >= 1e12) return `약 ${(n / 1e12).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}조원`;
  if (a >= 1e8) return `약 ${(n / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}억원`;
  return `약 ${Math.round(n / 1e4).toLocaleString("ko-KR")}만원`;
}

function DisclosedPanel({ c, def }: { c: CompanyResult; def: string }) {
  const row = (label: string, d: Disclosed) => (
    <tr><td>{label}</td><td className="num">{d.display}</td><td className="note">{d.note ?? ""}</td></tr>
  );
  return (
    <div className="panel">
      <b>{c.label} · {c.corp_name}</b>
      <div className="tbl"><table style={{ minWidth: 0 }}>
        <tbody>
          {row("남 · 공시 1인평균", c.emp.disclosed.M)}
          {row("여 · 공시 1인평균", c.emp.disclosed.F)}
          {row("회사 합계 행 · 공시 1인평균", c.emp.disclosed.T)}
        </tbody>
      </table></div>
      <p className="note">{def}</p>
    </div>
  );
}

function Audit({ c }: { c: CompanyResult }) {
  const e = c.emp;
  return (
    <div className="panel">
      <b>{c.label} · {c.corp_name}</b>
      <p className="note">
        직원현황 status {e.reportStatus}{e.rcept_no ? ` · 접수번호 ${e.rcept_no}` : ""} · 결산기준일 {e.stlm.date ?? "없음"} ·
        급여 단위 {e.unit.status === "ok" ? e.unit.basis : `보류(${e.unit.reason})`} ·
        직원 범위 {e.population.status === "ok" ? `합계 = 정규직+기간제 (${e.population.checked}행 확인)` : `보류(${e.population.reasons.join("; ")})`}
      </p>
      {[...c.errors, ...c.warnings].map((w) => <p key={w} className="warn">⚠ {w}</p>)}
      <p className="note">인원 기준 검사: {e.headcountRaw.checks.map((x) => `${x.name} ${x.state}${x.value != null ? `(${x.value.toLocaleString("ko-KR")})` : ""}`).join(" · ")}</p>
      {e.salaryTotal.checks.length > 0 && (
        <p className="note">급여총액 기준 검사: {e.salaryTotal.checks.map((x) => `${x.name} ${x.state}${x.value != null ? `(${x.value.toLocaleString("ko-KR")}원)` : ""}`).join(" · ")}</p>
      )}
      <p className="note">
        매출: {c.revenue.status === "ok" && c.revenue.source
          ? `별도(OFS) ${c.revenue.source.sj_div} ${c.revenue.source.account_nm} [${c.revenue.source.account_id}] ${c.revenue.display} · ${c.revenue.source.currency}${c.revenue.source.rcept_no ? ` · 접수번호 ${c.revenue.source.rcept_no}` : ""}`
          : `보류 — ${c.revenue.reasons.join(" / ")}`}
      </p>
      <details open={false}><summary>empSttus 원본 행 ({e.rows.length}행)</summary>
        <div className="tbl"><table>
          <thead><tr><th>#</th><th>fo_bbm</th><th>sexdstn</th><th>sm</th><th>fyer_salary_totamt</th><th>jan_salary_am</th><th>stlm_dt</th><th>rm</th><th>정규직+기간제</th><th>분류</th><th>사용·제외</th></tr></thead>
          <tbody>{e.rows.map((r) => (
            <tr key={r.idx}>
              <td>{r.idx + 1}</td><td>{r.fields.fo_bbm}</td><td>{r.fields.sexdstn}</td>
              <td className="num">{r.fields.sm}</td><td className="num">{r.fields.fyer_salary_totamt}</td><td className="num">{r.fields.jan_salary_am}</td>
              <td>{r.fields.stlm_dt}</td><td>{r.fields.rm}</td>
              <td className="num">{r.pop.rgllbr_co != null && r.pop.cnttk_co != null ? `${r.pop.rgllbr_co.toLocaleString("ko-KR")}+${r.pop.cnttk_co.toLocaleString("ko-KR")}` : "-"}</td>
              <td>{ROW_CLASS_LABEL[r.cls]}</td><td className="note">{c.rowUsage[r.idx]}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </details>
    </div>
  );
}
