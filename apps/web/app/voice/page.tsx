"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import VoiceClonePanel from "../../components/voice/VoiceClonePanel";
import MyVoicesPanel from "../../components/voice/MyVoicesPanel";
import UserTemplatesPanel from "../../components/voice/UserTemplatesPanel";
import { useI18n } from "../../lib/I18nContext";

type VoiceTab = "my" | "clone" | "persona";

function tabFromSearch(q: string | null): VoiceTab {
  if (q === "clone") return "clone";
  if (q === "persona") return "persona";
  return "my";
}

export default function VoiceManagementPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const [tab, setTab] = useState<VoiceTab>("my");

  useEffect(() => {
    setTab(tabFromSearch(searchParams?.get("tab") ?? null));
  }, [searchParams]);

  const setTabAndUrl = useCallback(
    (next: VoiceTab) => {
      setTab(next);
      const qs =
        next === "my" ? "" : next === "clone" ? "?tab=clone" : "?tab=persona";
      router.replace(`/voice${qs}`, { scroll: false });
    },
    [router]
  );

  const navBtn = (active: boolean) =>
    [
      "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-colors",
      active ? "bg-brand text-brand-foreground shadow-soft" : "text-ink hover:bg-fill"
    ].join(" ");

  return (
    <main className="mx-auto min-h-0 w-full max-w-6xl px-3 pb-10 sm:px-4">
      <div className="flex flex-col gap-4">
        <nav
          className="flex shrink-0 flex-row gap-2 overflow-x-auto rounded-2xl border border-line bg-surface p-2 shadow-soft"
          aria-label={t("voice.page.subNavAria")}
        >
          <button type="button" className={navBtn(tab === "my")} onClick={() => setTabAndUrl("my")}>
            <span className="flex h-4 w-4 shrink-0 items-center justify-center opacity-90" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4h7v7H4V4zM13 4h7v7h-7V4zM4 13h7v7H4v-7zM13 13h7v7h-7v-7z" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="whitespace-nowrap">{t("voice.page.navLibrary")}</span>
          </button>
          <button type="button" className={navBtn(tab === "clone")} onClick={() => setTabAndUrl("clone")}>
            <span className="flex h-4 w-4 shrink-0 items-center justify-center opacity-90" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" strokeLinejoin="round" />
                <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 19v3" strokeLinecap="round" />
              </svg>
            </span>
            <span className="whitespace-nowrap">{t("voice.page.navClone")}</span>
          </button>
          <button type="button" className={navBtn(tab === "persona")} onClick={() => setTabAndUrl("persona")}>
            <span className="flex h-4 w-4 shrink-0 items-center justify-center opacity-90" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 5h16M4 12h10M4 19h14" strokeLinecap="round" />
                <path d="M18 10v4M16 12h4" strokeLinecap="round" />
              </svg>
            </span>
            <span className="whitespace-nowrap">{t("voice.page.navPersonaStyle")}</span>
          </button>
        </nav>

        <div className="min-w-0 flex-1 rounded-2xl border border-line bg-surface p-4 shadow-soft sm:p-5">
          {tab === "clone" ? (
            <VoiceClonePanel />
          ) : tab === "persona" ? (
            <UserTemplatesPanel />
          ) : (
            <MyVoicesPanel />
          )}
        </div>
      </div>
    </main>
  );
}
