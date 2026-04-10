"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import VoiceClonePanel from "../../components/voice/VoiceClonePanel";
import MyVoicesPanel from "../../components/voice/MyVoicesPanel";

export default function VoiceManagementPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"clone" | "my">("my");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search).get("tab");
    if (q === "clone") setTab("clone");
    else setTab("my");
  }, []);

  const setTabAndUrl = useCallback(
    (t: "clone" | "my") => {
      setTab(t);
      router.replace(t === "my" ? "/voice?tab=my" : "/voice?tab=clone", { scroll: false });
    },
    [router]
  );

  const navBtn = (active: boolean) =>
    [
      "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-colors",
      active
        ? "bg-brand text-brand-foreground shadow-soft"
        : "text-ink hover:bg-fill"
    ].join(" ");

  return (
    <main className="mx-auto min-h-0 w-full max-w-6xl px-3 pb-10 sm:px-4">
      <div className="flex flex-col gap-4">
        <nav
          className="flex shrink-0 flex-row gap-2 overflow-x-auto rounded-2xl border border-line bg-surface p-2 shadow-soft"
          aria-label="音色管理子导航"
        >
          <button type="button" className={navBtn(tab === "my")} onClick={() => setTabAndUrl("my")}>
            <span className="flex h-4 w-4 shrink-0 items-center justify-center opacity-90" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4h7v7H4V4zM13 4h7v7h-7V4zM4 13h7v7H4v-7zM13 13h7v7h-7v-7z" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="whitespace-nowrap">音色库</span>
          </button>
          <button type="button" className={navBtn(tab === "clone")} onClick={() => setTabAndUrl("clone")}>
            <span className="flex h-4 w-4 shrink-0 items-center justify-center opacity-90" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" strokeLinejoin="round" />
                <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 19v3" strokeLinecap="round" />
              </svg>
            </span>
            <span className="whitespace-nowrap">音色克隆</span>
          </button>
        </nav>

        <div className="min-w-0 flex-1 rounded-2xl border border-line bg-surface p-4 shadow-soft sm:p-5">
          {tab === "clone" ? <VoiceClonePanel /> : <MyVoicesPanel />}
        </div>
      </div>
    </main>
  );
}
