"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAppNotice } from "../../../lib/AppNoticeContext";
import { readSessionStorageScoped, writeSessionStorageScoped } from "../../../lib/userScopedStorage";

const DRAFTS_SUNSET_NOTICE_KEY = "fym_drafts_sunset_notice_v1";

/** 本地文稿已下线：重定向到作品 · 文稿 Tab。 */
export default function DraftsRedirectPage() {
  const router = useRouter();
  const { showInfo } = useAppNotice();
  const notifiedRef = useRef(false);

  useEffect(() => {
    if (!notifiedRef.current && !readSessionStorageScoped(DRAFTS_SUNSET_NOTICE_KEY)) {
      notifiedRef.current = true;
      writeSessionStorageScoped(DRAFTS_SUNSET_NOTICE_KEY, "1");
      showInfo("本地文稿已下线，请在「作品 · 文稿」或对话中继续编辑。");
    }
    router.replace("/works?tab=script");
  }, [router, showInfo]);

  return (
    <main className="mx-auto min-h-[40vh] w-full max-w-4xl px-4 py-12" aria-busy aria-live="polite">
      <p className="text-sm text-muted">正在跳转到作品…</p>
    </main>
  );
}
