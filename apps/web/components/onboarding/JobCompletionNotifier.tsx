"use client";

import { useEffect, useRef } from "react";
import { isLoggedInAccountUser, useAuth, userAccountRef } from "../../lib/auth";
import { useAppNotice } from "../../lib/AppNoticeContext";
import { summarizeActiveJobPayload } from "../../lib/jobPayloadSummary";
import { useActiveJobsQuery } from "../../lib/queries/activeJobsQuery";
import type { JobRecord } from "../../lib/types";

const NOTIFIED_STORAGE_PREFIX = "fym_job_completion_notified_v1";

function readNotifiedJobIds(accountKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${NOTIFIED_STORAGE_PREFIX}:${accountKey}`);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((x) => String(x)).filter(Boolean));
  } catch {
    return new Set();
  }
}

function markJobNotified(accountKey: string, jobId: string): void {
  try {
    const next = [...readNotifiedJobIds(accountKey), jobId].slice(-120);
    localStorage.setItem(`${NOTIFIED_STORAGE_PREFIX}:${accountKey}`, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/**
 * 全站：进行中任务离开活跃列表且终态为 succeeded 时，弹出站内提示。
 */
export default function JobCompletionNotifier() {
  const { ready, user } = useAuth();
  const loggedIn = isLoggedInAccountUser(user);
  const jobsQuery = useActiveJobsQuery(loggedIn && ready);
  const { showInfo } = useAppNotice();
  const prevActiveIdsRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);

  useEffect(() => {
    if (!loggedIn || !ready) return;
    const accountKey = userAccountRef(user);
    if (!accountKey) return;

    const activeJobs = jobsQuery.data ?? [];
    const currentIds = new Set(activeJobs.map((j) => String(j.id)));

    if (!seededRef.current) {
      prevActiveIdsRef.current = currentIds;
      seededRef.current = true;
      return;
    }

    const prev = prevActiveIdsRef.current;
    const disappeared = [...prev].filter((id) => !currentIds.has(id));
    prevActiveIdsRef.current = currentIds;
    if (disappeared.length === 0) return;

    const notified = readNotifiedJobIds(accountKey);
    void (async () => {
      for (const jobId of disappeared) {
        if (notified.has(jobId)) continue;
        try {
          const resp = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" });
          if (!resp.ok) continue;
          const row = (await resp.json()) as JobRecord;
          if (String(row.status || "") !== "succeeded") continue;
          const { headline } = summarizeActiveJobPayload(row);
          markJobNotified(accountKey, jobId);
          showInfo(`「${headline}」已生成完成，可到作品页收听或下载。`);
        } catch {
          /* ignore */
        }
      }
    })();
  }, [jobsQuery.data, loggedIn, ready, showInfo, user]);

  return null;
}
