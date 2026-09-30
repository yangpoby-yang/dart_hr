// OpenDART 숫자 문자열("1,234", "-", "") → number | null. 숫자가 아니면 null(결측).
export function parseNum(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).replace(/[,\s]/g, "");
  if (s === "" || s === "-" || s === "—") return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

export const fmtInt = (n: number) => Math.round(n).toLocaleString("ko-KR");

export function fmtWon(n: number) {
  return `${fmtInt(n)}원`;
}

export function approxWon(n: number) {
  const a = Math.abs(n);
  if (a >= 1e12) return `약 ${(n / 1e12).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}조원`;
  if (a >= 1e8) return `약 ${(n / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}억원`;
  if (a >= 1e4) return `약 ${fmtInt(n / 1e4)}만원`;
  return fmtWon(n);
}

export function fmtByUnit(n: number, unit: "원" | "명") {
  return unit === "명" ? `${fmtInt(n)}명` : fmtWon(n);
}

export function fmtSigned(n: number, unit: "원" | "명") {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "±";
  return `${sign}${fmtByUnit(Math.abs(n), unit)}`;
}

export function fmtPct(r: number) {
  const sign = r > 0 ? "+" : r < 0 ? "−" : "±";
  return `${sign}${Math.abs(r).toFixed(1)}%`;
}
