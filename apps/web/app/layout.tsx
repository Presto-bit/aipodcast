import "./globals.css";
import Providers from "./providers";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Presto · 灵感不设限，创作即刻起",
  description: "Presto — 灵感不设限，创作即刻起。语音与播客创作工作台"
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
