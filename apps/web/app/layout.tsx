import type { Viewport } from "next";
import "./globals.css";
import ShellProviders from "./ShellProviders";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#14141a" }
  ]
};

export const metadata = {
  title: "Presto · 灵感不设限，创作即刻起",
  description: "Presto — 语音与播客创作平台"
};

const THEME_BOOT = `(function(){try{var t=localStorage.getItem('fym_theme');if(t==='dark'){document.documentElement.classList.add('dark');document.documentElement.classList.remove('light');}else{document.documentElement.classList.remove('dark');document.documentElement.classList.add('light');}}catch(e){document.documentElement.classList.remove('dark');document.documentElement.classList.add('light');}})();`;

/** 全站唯一 Providers 壳：避免 (public)/(workbench) 切换时 AuthProvider 重挂载导致登录↔资料页循环跳转 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <ShellProviders variant="static">{children}</ShellProviders>
      </body>
    </html>
  );
}
