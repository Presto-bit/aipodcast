"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import VoiceClonePanel from "../../../components/voice/VoiceClonePanel";
import MyVoicesPanel from "../../../components/voice/MyVoicesPanel";
import UserTemplatesPanel from "../../../components/voice/UserTemplatesPanel";
import { useI18n } from "../../../lib/I18nContext";
import { IconVoiceCloneTab, IconVoiceLibraryTab, IconVoicePersonaTab } from "../../../components/icons";

type VoiceTab = "my" | "clone" | "persona";

function tabFromSearch(q: string | null): VoiceTab {
  if (q === "my") return "my";
  if (q === "persona") return "persona";
  if (q === "clone") return "clone";
  return "clone";
}

export default function VoiceManagementPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const [tab, setTab] = useState<VoiceTab>("clone");

  useEffect(() => {
    setTab(tabFromSearch(searchParams?.get("tab") ?? null));
  }, [searchParams]);

  const setTabAndUrl = useCallback(
    (next: VoiceTab) => {
      setTab(next);
      const qs = next === "clone" ? "" : next === "my" ? "?tab=my" : "?tab=persona";
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
          <button type="button" className={navBtn(tab === "clone")} onClick={() => setTabAndUrl("clone")}>
            <IconVoiceCloneTab className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
            <span className="whitespace-nowrap">{t("voice.page.navClone")}</span>
          </button>
          <button type="button" className={navBtn(tab === "my")} onClick={() => setTabAndUrl("my")}>
            <IconVoiceLibraryTab className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
            <span className="whitespace-nowrap">{t("voice.page.navLibrary")}</span>
          </button>
          <button type="button" className={navBtn(tab === "persona")} onClick={() => setTabAndUrl("persona")}>
            <IconVoicePersonaTab className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
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
