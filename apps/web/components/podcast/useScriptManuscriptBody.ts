"use client";

import { useEffect, useState } from "react";
import { resolveJobManuscriptText, SCRIPT_TEXT_LIKELY_FULL_MIN_LEN } from "../../lib/jobScriptText";
import { cleanScriptPreviewText } from "../../lib/scriptCardPreview";
import type { WorkItem } from "../../lib/worksTypes";
import { useAuth } from "../../lib/auth";

type WorkHint = Pick<WorkItem, "scriptText" | "scriptCharCount" | "status" | "type">;

function previewLikelyFull(work: WorkHint): boolean {
  const text = cleanScriptPreviewText(String(work.scriptText || ""));
  if (!text) return false;
  const declared =
    typeof work.scriptCharCount === "number" && Number.isFinite(work.scriptCharCount) && work.scriptCharCount > 0
      ? Math.round(work.scriptCharCount)
      : null;
  if (declared != null && text.length >= declared) return true;
  return text.length >= SCRIPT_TEXT_LIKELY_FULL_MIN_LEN;
}

/**
 * Quick Read：先用列表 preview 渲染，必要时拉取全文。
 */
export function useScriptManuscriptBody(
  jobId: string,
  work: WorkHint | null,
  open: boolean
): { body: string; loadingFull: boolean; error: string | null } {
  const { getAuthHeaders } = useAuth();
  const [body, setBody] = useState("");
  const [loadingFull, setLoadingFull] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !jobId || !work) {
      setBody("");
      setLoadingFull(false);
      setError(null);
      return;
    }

    const preview = cleanScriptPreviewText(String(work.scriptText || ""));
    setError(null);

    if (previewLikelyFull(work)) {
      setBody(preview);
      setLoadingFull(false);
      return;
    }

    setBody(preview);
    setLoadingFull(true);

    let canceled = false;
    const authHeaders = getAuthHeaders();
    void (async () => {
      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { ...authHeaders }
        });
        const row = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          throw new Error(typeof row.detail === "string" ? row.detail : `HTTP ${res.status}`);
        }
        const succeeded = String(row.status || work.status || "").trim() === "succeeded";
        const full = (
          await resolveJobManuscriptText(jobId, row, authHeaders, {
            succeeded
          })
        ).trim();
        if (canceled) return;
        setBody(full || preview);
      } catch (e) {
        if (canceled) return;
        setError(e instanceof Error ? e.message : String(e));
        if (!preview) setBody("");
      } finally {
        if (!canceled) setLoadingFull(false);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [open, jobId, work, getAuthHeaders]);

  return { body, loadingFull, error };
}
