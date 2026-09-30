import "./globals.css";
export const metadata = { title: "DART HR 비교", description: "두 기업 · 한 연도 인사 지표 비교" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="ko"><body>{children}</body></html>);
}
