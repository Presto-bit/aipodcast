import type { Viewport } from "next";
import "./globals.css";
import Providers from "./providers";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#14141a" }
  ]
};

export const dynamic = "force-dynamic";
/** 禁止整页长期 Full Route Cache，与 middleware / next.config headers 一起约束 CDN。 */
export const revalidate = 0;

export const metadata = {
  title: "Presto · 灵感不设限，创作即刻起",
  description: "Presto — 语音与播客创作平台"
};

const THEME_BOOT = `(function(){try{var t=localStorage.getItem('fym_theme');if(t==='dark'){document.documentElement.classList.add('dark');document.documentElement.classList.remove('light');}else{document.documentElement.classList.remove('dark');document.documentElement.classList.add('light');}}catch(e){document.documentElement.classList.remove('dark');document.documentElement.classList.add('light');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
