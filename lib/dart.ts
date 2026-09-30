// OpenDART 호출. 키는 서버 환경변수에서만 읽는다.
import { unzipSync, strFromU8 } from "fflate";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = "https://opendart.fss.or.kr/api";
const TTL = 6 * 3600 * 1000;

export class DartError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export function hasDartKey() { return Boolean(process.env.OPENDART_API_KEY?.trim()); }

function key() {
  const k = process.env.OPENDART_API_KEY?.trim();
  if (!k) throw new DartError("NOKEY", "OPENDART_API_KEY가 .env에 설정되지 않았습니다.");
  return k;
}

const cache = new Map<string, { t: number; v: any }>();

async function getJson(endpoint: string, params: Record<string, string>) {
  const ck = endpoint + JSON.stringify(params);
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  const url = new URL(`${BASE}/${endpoint}`);
  url.searchParams.set("crtfc_key", key());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new DartError("HTTP", `OpenDART HTTP ${res.status}`);
  const j = await res.json();
  if (j.status !== "000" && j.status !== "013") throw new DartError(j.status, `OpenDART ${j.status}: ${j.message}`);
  cache.set(ck, { t: Date.now(), v: j });
  return j;
}

export async function fetchEmpSttus(corp_code: string, year: number) {
  const j = await getJson("empSttus.json", { corp_code, bsns_year: String(year), reprt_code: "11011" });
  return { status: String(j.status), list: (j.list ?? []) as Record<string, unknown>[] };
}

export async function fetchFsAllOFS(corp_code: string, year: number) {
  const j = await getJson("fnlttSinglAcntAll.json", { corp_code, bsns_year: String(year), reprt_code: "11011", fs_div: "OFS" });
  return { status: String(j.status), list: (j.list ?? []) as Record<string, unknown>[] };
}

export interface Corp { corp_code: string; corp_name: string; stock_code: string }

let corpList: Corp[] | null = null;
const CORP_FILE = path.join(os.tmpdir(), "opendart-corpcode.json");

export async function loadCorpList(): Promise<Corp[]> {
  if (corpList) return corpList;
  try {
    const st = fs.statSync(CORP_FILE);
    if (Date.now() - st.mtimeMs < 24 * 3600 * 1000) return (corpList = JSON.parse(fs.readFileSync(CORP_FILE, "utf8")));
  } catch {}
  const res = await fetch(`${BASE}/corpCode.xml?crtfc_key=${encodeURIComponent(key())}`, { cache: "no-store" });
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new DartError("CORPCODE", `고유번호 파일을 받지 못했습니다: ${strFromU8(buf.slice(0, 300))}`);
  }
  const xml = strFromU8(Object.values(unzipSync(buf))[0]);
  const tag = (s: string, t: string) => (s.match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1] ?? "").trim();
  corpList = [...xml.matchAll(/<list>([\s\S]*?)<\/list>/g)].map((m) => ({
    corp_code: tag(m[1], "corp_code"), corp_name: tag(m[1], "corp_name"), stock_code: tag(m[1], "stock_code"),
  }));
  try { fs.writeFileSync(CORP_FILE, JSON.stringify(corpList)); } catch {}
  return corpList;
}

export async function searchCorps(q: string): Promise<Corp[]> {
  const list = await loadCorpList();
  const s = q.trim();
  if (!s) return [];
  if (/^\d{8}$/.test(s)) return list.filter((c) => c.corp_code === s);
  if (/^\d{6}$/.test(s)) return list.filter((c) => c.stock_code === s);
  const hits = list.filter((c) => c.corp_name.includes(s));
  const rank = (c: Corp) => (c.corp_name === s ? 0 : 2) + (c.stock_code ? 0 : 1);
  return hits.sort((a, b) => rank(a) - rank(b) || a.corp_name.length - b.corp_name.length).slice(0, 20);
}

export async function corpName(corp_code: string) {
  const list = await loadCorpList();
  return list.find((c) => c.corp_code === corp_code)?.corp_name ?? corp_code;
}
