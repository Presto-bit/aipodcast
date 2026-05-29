"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useMemo } from "react";
import { useI18n } from "../../lib/I18nContext";
import { activeJobRecordToWorkItem } from "../../lib/activeJobWorkItem";
import type { WorkItem } from "../../lib/worksTypes";
import { isTextOnlyWorkType, shouldHideWorkFromUserGallery } from "../../lib/worksTypes";
import { isLoggedInAccountUser, useAuth } from "../../lib/auth";
import { messageSuggestsBillingTopUpOrSubscription } from "../../lib/billingShortfall";
import { classifyErrorTone, errorPageCopy } from "../../lib/errorCopy";
import { BillingShortfallLinks } from "../subscription/BillingShortfallLinks";
import EmptyState from "../ui/EmptyState";
import { SkeletonBlock, SkeletonLine } from "../ui/Skeleton";
import { useActiveJobsQuery, useInvalidateActiveJobs } from "../../lib/queries/activeJobsQuery";

const PodcastWorksGallery = dynamic(() => import("../podcast/PodcastWorksGallery"), {
  loading: () => (
    <div
      className="min-h-[120px] rounded-2xl border border-line/50 bg-fill/40"
      aria-busy
      aria-label="加载作品列表"
    />
  )
});

const ACTIVE_RETURN = "/works?tab=active";

type WorksActiveJobsPanelProps = {
  onActiveJobsChanged?: () => void;
};

export default function WorksActiveJobsPanel({ onActiveJobsChanged }: WorksActiveJobsPanelProps = {}) {
  const { t } = useI18n();
  const { ready, user } = useAuth();
  const loggedIn = isLoggedInAccountUser(user);
  const jobsQuery = useActiveJobsQuery(loggedIn && ready);
  const invalidateActiveJobs = useInvalidateActiveJobs();

  const jobs = jobsQuery.data ?? [];
  const loading = jobsQuery.isLoading;
  const err = jobsQuery.isError ? String(jobsQuery.error instanceof Error ? jobsQuery.error.message : jobsQuery.error) : "";

  const onGalleryWorkChanged = useCallback(() => {
    invalidateActiveJobs();
    onActiveJobsChanged?.();
  }, [invalidateActiveJobs, onActiveJobsChanged]);

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
      if (isTextOnlyWorkType(String(w.type || ""))) scripts.push(w);
      else media.push(w);
    }
    return { scriptWorks: scripts, mediaWorks: media };
  }, [jobs]);

  if (loading && jobs.length === 0) {
    return (
      <div className="mt-1 space-y-3" aria-busy>
        <SkeletonLine className="h-4 w-48 mx-auto" />
        <SkeletonBlock className="h-32 w-full rounded-2xl" />
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
        <div className="space-y-6">
          {mediaWorks.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-ink">播客生成中</h2>
              <PodcastWorksGallery
                variant="podcast"
                works={mediaWorks}
                loading={false}
                fetchError=""
                onWorkDeleted={onGalleryWorkChanged}
                workDetailReturnTo={ACTIVE_RETURN}
                activeQueueCardActions
              />
            </section>
          ) : null}
          {scriptWorks.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-ink">正文生成中</h2>
              <PodcastWorksGallery
                variant="notes"
                works={scriptWorks}
                loading={false}
                fetchError=""
                onWorkDeleted={onGalleryWorkChanged}
                workDetailReturnTo={ACTIVE_RETURN}
                activeQueueCardActions
              />
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
