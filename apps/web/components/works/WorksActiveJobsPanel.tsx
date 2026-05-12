"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../lib/I18nContext";
import { listJobs } from "../../lib/api";
import { activeJobRecordToWorkItem } from "../../lib/activeJobWorkItem";
import type { JobRecord } from "../../lib/types";
import type { WorkItem } from "../../lib/worksTypes";
import { shouldHideWorkFromUserGallery } from "../../lib/worksTypes";
import { isLoggedInAccountUser, useAuth } from "../../lib/auth";
import { messageSuggestsBillingTopUpOrSubscription } from "../../lib/billingShortfall";
import { classifyErrorTone, errorPageCopy } from "../../lib/errorCopy";
import { BillingShortfallLinks } from "../subscription/BillingShortfallLinks";
import EmptyState from "../ui/EmptyState";
import { SkeletonBlock, SkeletonLine } from "../ui/Skeleton";

const PodcastWorksGallery = dynamic(() => import("../podcast/PodcastWorksGallery"), {
  loading: () => (
    <div
      className="min-h-[120px] rounded-2xl border border-line/50 bg-fill/40"
      aria-busy
      aria-label="加载作品列表"
    />
  )
});

/** 与作品详情轮询接近，便于合并 server progress 与列表展示一致 */
const POLL_MS = 3000;
const LIST_LIMIT = 40;
const ACTIVE_RETURN = "/works?tab=active";

type WorksActiveJobsPanelProps = {
  /** 删除或停止成功后可更新父级「进行中」数量等 */
  onActiveJobsChanged?: () => void;
};

export default function WorksActiveJobsPanel({ onActiveJobsChanged }: WorksActiveJobsPanelProps = {}) {
  const { t } = useI18n();
  const { phone, ready, user } = useAuth();
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const visibleRef = useRef(true);

  const load = useCallback(async () => {
    setErr("");
    if (!isLoggedInAccountUser(user)) {
      setJobs([]);
      setLoading(false);
      return;
    }
    try {
      const { jobs: list } = await listJobs({
        limit: LIST_LIMIT,
        offset: 0,
        status: "queued,running",
        slim: true
      });
      setJobs(list);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!ready) return;
    void load();
  }, [load, ready, phone, user]);

  useEffect(() => {
    function onVis() {
      visibleRef.current = document.visibilityState === "visible";
    }
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => {
      if (visibleRef.current) void load();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [load, ready]);

  const errCopy = useMemo(
    () => (err ? errorPageCopy(classifyErrorTone(err), t) : null),
    [err, t]
  );

  const { scriptWorks, mediaWorks } = useMemo(() => {
    const scripts: WorkItem[] = [];
    const media: WorkItem[] = [];
    for (const j of jobs) {
      const w = activeJobRecordToWorkItem(j);
      if (shouldHideWorkFromUserGallery(w)) continue;
      if (String(w.type || "") === "script_draft") scripts.push(w);
      else media.push(w);
    }
    return { scriptWorks: scripts, mediaWorks: media };
  }, [jobs]);

  const onGalleryWorkChanged = useCallback(() => {
    onActiveJobsChanged?.();
    void load();
  }, [load, onActiveJobsChanged]);

  if (loading) {
    return (
      <div className="mt-4 space-y-3">
        <SkeletonLine className="h-10 w-full" />
        <SkeletonBlock className="h-36 w-full" />
        <SkeletonBlock className="h-36 w-full" />
      </div>
    );
  }

  return (
    <div className="mt-1">
      <p className="mb-3 text-center text-xs leading-snug text-muted">{t("empty.activeJobs.banner")}</p>

      {errCopy ? (
        <div className="mb-4 rounded-dawn-lg border border-danger/35 bg-danger-soft px-3 py-3 text-sm" role="alert">
          <p className="font-medium text-danger">{errCopy.headline}</p>
          <p className="mt-1 text-xs text-muted">{errCopy.sub}</p>
          <p className="mt-2 break-words font-mono text-xs text-ink">{err}</p>
          {messageSuggestsBillingTopUpOrSubscription(err) ? <BillingShortfallLinks className="mt-3" /> : null}
        </div>
      ) : null}

      {scriptWorks.length === 0 && mediaWorks.length === 0 ? (
        <EmptyState
          title={t("empty.activeJobs.title")}
          description={t("empty.activeJobs.desc")}
          action={
            <div className="flex flex-wrap justify-center gap-4">
              <Link href="/create" className="text-sm font-medium text-brand underline underline-offset-2 hover:opacity-90">
                {t("empty.jobsList.cta")}
              </Link>
              <Link href="/notes" className="text-sm font-medium text-brand underline underline-offset-2 hover:opacity-90">
                {t("nav.notes")}
              </Link>
            </div>
          }
        />
      ) : (
        <div className="space-y-5">
          {mediaWorks.length > 0 ? (
            <PodcastWorksGallery
              variant="all"
              works={mediaWorks}
              loading={false}
              fetchError=""
              onWorkDeleted={onGalleryWorkChanged}
              workDetailReturnTo={ACTIVE_RETURN}
              activeQueueCardActions
            />
          ) : null}
          {scriptWorks.length > 0 ? (
            <PodcastWorksGallery
              variant="notes"
              works={scriptWorks}
              loading={false}
              fetchError=""
              onWorkDeleted={onGalleryWorkChanged}
              workDetailReturnTo={ACTIVE_RETURN}
              activeQueueCardActions
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
