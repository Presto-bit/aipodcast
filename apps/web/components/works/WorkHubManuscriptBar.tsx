"use client";

import { useCallback, useEffect, useState } from "react";
import { getBearerAuthHeadersSync } from "../../lib/authHeaders";
import { downloadJobManuscriptMarkdown } from "../../lib/workBundleDownload";
import SmallConfirmModal from "../ui/SmallConfirmModal";

type Props = {
  jobId: string;
  displayTitle: string;
  manuscriptBody: string;
  scriptResolvePending: boolean;
  onManuscriptSaved: (next: string) => void;
  canEditScript: boolean;
  /** 播客成片：在当前页按原 payload 仅重跑语音合成 */
  regenerateVoiceSupported: boolean;
  regenerateVoiceBusy: boolean;
  onRegenerateVoice?: () => void;
};

export function WorkHubManuscriptBar({
  jobId,
  displayTitle,
  manuscriptBody,
  scriptResolvePending,
  onManuscriptSaved,
  canEditScript,
  regenerateVoiceSupported,
  regenerateVoiceBusy,
  onRegenerateVoice
}: Props) {
  const [draft, setDraft] = useState(manuscriptBody);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  useEffect(() => {
    setDraft(manuscriptBody);
  }, [manuscriptBody]);

  const dirty = canEditScript && draft !== manuscriptBody;

  const copyAll = useCallback(async () => {
    const t = manuscriptBody.trim();
    if (!t) {
      window.alert("暂无可复制的正文。");
      return;
    }
    try {
      await navigator.clipboard.writeText(t);
    } catch {
      window.alert("复制失败，请检查浏览器权限。");
    }
  }, [manuscriptBody]);

  const saveDraft = useCallback(async () => {
    if (!canEditScript) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/result-script`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getBearerAuthHeadersSync() },
        body: JSON.stringify({ script_text: draft })
      });
      if (!res.ok) {
        const tx = await res.text().catch(() => "");
        throw new Error(tx || `HTTP ${res.status}`);
      }
      onManuscriptSaved(draft);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [canEditScript, draft, jobId, onManuscriptSaved]);

  const confirmDelete = useCallback(async () => {
    if (!canEditScript) return;
    setBusy(true);
    setDeleteErr(null);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/result-script`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getBearerAuthHeadersSync() },
        body: JSON.stringify({ script_text: "" })
      });
      if (!res.ok) {
        const tx = await res.text().catch(() => "");
        throw new Error(tx || `HTTP ${res.status}`);
      }
      onManuscriptSaved("");
      setDeleteOpen(false);
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [canEditScript, jobId, onManuscriptSaved]);

  const downloadMd = useCallback(() => {
    void downloadJobManuscriptMarkdown({ jobId, title: displayTitle || jobId });
  }, [displayTitle, jobId]);

  return (
    <>
      <div className="flex w-full min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <button
            type="button"
            disabled={scriptResolvePending}
            onClick={() => void copyAll()}
            className="rounded-lg border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink hover:bg-fill disabled:opacity-40"
          >
            复制
          </button>
          <button
            type="button"
            disabled={scriptResolvePending}
            onClick={downloadMd}
            className="rounded-lg border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink hover:bg-fill disabled:opacity-40"
          >
            下载
          </button>
          {regenerateVoiceSupported ? (
            <button
              type="button"
              disabled={
                regenerateVoiceBusy ||
                scriptResolvePending ||
                !manuscriptBody.trim() ||
                !onRegenerateVoice
              }
              onClick={() => onRegenerateVoice?.()}
              className="rounded-lg border border-brand/40 bg-brand/10 px-2 py-1 text-[11px] font-medium text-brand hover:bg-brand/15 disabled:opacity-40"
            >
              {regenerateVoiceBusy ? "合成中…" : "重新合成语音"}
            </button>
          ) : null}
          <button
            type="button"
            disabled={!canEditScript || scriptResolvePending}
            onClick={() => {
              setErr(null);
              setDeleteErr(null);
              setDeleteOpen(true);
            }}
            className="rounded-lg border border-danger/35 bg-danger-soft/40 px-2 py-1 text-[11px] font-medium text-danger-ink hover:bg-danger-soft/70 disabled:opacity-40"
          >
            删除
          </button>
        </div>

        {canEditScript ? (
          <div className="min-w-0 space-y-1.5">
            <textarea
              className="max-h-[min(55vh,28rem)] min-h-[12rem] w-full rounded-lg border border-line bg-fill/30 p-3 font-mono text-xs leading-relaxed text-ink"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy || scriptResolvePending}
              spellCheck={false}
              aria-label="口播稿正文"
            />
            <p className="text-[10px] text-muted/90">保存后写入作品结果；简介与 Shownotes 不会自动重写。</p>
            {err ? <p className="text-xs text-danger-ink">{err}</p> : null}
            <div className="flex justify-end">
              <button
                type="button"
                disabled={busy || scriptResolvePending || !dirty}
                onClick={() => void saveDraft()}
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:opacity-95 disabled:opacity-40"
              >
                {busy ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        ) : (
          <pre className="max-h-[min(40vh,18rem)] overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-fill/20 p-3 font-mono text-[11px] leading-relaxed text-ink">
            {manuscriptBody.trim() ? manuscriptBody : "（无正文）"}
          </pre>
        )}
      </div>

      <SmallConfirmModal
        open={deleteOpen}
        title="清空口播稿"
        message="确定清空正文？建议先下载备份。"
        confirmLabel="清空"
        cancelLabel="取消"
        danger
        busy={busy}
        busyLabel="处理中…"
        error={deleteErr}
        onCancel={() => {
          if (busy) return;
          setDeleteOpen(false);
          setDeleteErr(null);
        }}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
