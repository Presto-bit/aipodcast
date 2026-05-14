"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { useAuth, isLoggedInAccountUser } from "../../lib/auth";
import { encodeClipFilenameForHttpHeader } from "../../lib/clipFilenameHeader";
import ShownotesMakeClient from "./ShownotesMakeClient";

export default function ShownotesLandingClient() {
  const { ready, user, getAuthHeaders } = useAuth();
  const isLoggedIn = isLoggedInAccountUser(user);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [err, setErr] = useState("");
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  const resetSession = useCallback(() => {
    setActiveProjectId(null);
    setErr("");
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  async function createProjectAndStage(file: File) {
    setUploadBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/clip/projects", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ title: "Shownotes" })
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; project?: { id?: string }; detail?: string };
      if (!res.ok || data.success === false || !data.project?.id) {
        throw new Error(data.detail || `创建任务失败 ${res.status}`);
      }
      const projectId = String(data.project.id);
      const stage = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/audio/stage`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": file.type || "application/octet-stream",
          "x-clip-filename": encodeClipFilenameForHttpHeader(file.name || "audio.mp3", "segment.mp3"),
          ...getAuthHeaders()
        },
        body: file
      });
      const stData = (await stage.json().catch(() => ({}))) as { success?: boolean; detail?: string };
      if (!stage.ok || stData.success === false) {
        throw new Error(stData.detail || `上传失败 ${stage.status}`);
      }
      setActiveProjectId(projectId);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setUploadBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  if (!ready) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-muted">加载中…</p>
      </main>
    );
  }

  if (!isLoggedIn) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-ink">Shownotes</h1>
        <p className="mt-3 text-sm text-muted">请先登录工作台后再使用 Shownotes。</p>
        <Link href="/home" className="mt-6 inline-flex rounded-lg bg-cta px-4 py-2.5 text-sm font-medium text-cta-foreground shadow-soft">
          前往登录
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Shownotes</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
        上传播客或口播音频，系统将自动完成语音转写（ASR）；转写完成后，在同一页展示可编辑的 Shownotes（版式与作品详情页一致）。
      </p>
      {err ? (
        <p className="mt-4 rounded-lg border border-danger/30 bg-danger-soft/40 px-3 py-2 text-sm text-danger-ink" role="alert">
          {err}
        </p>
      ) : null}

      <div className="mt-8 max-w-xl rounded-2xl border border-line/80 bg-fill/30 p-5 shadow-sm">
        <h2 className="text-base font-semibold text-ink">上传音频</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          支持常见音频格式。上传后自动开始转写，无需离开本页。
        </p>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg,.aac,.webm"
          disabled={uploadBusy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void createProjectAndStage(f);
          }}
        />
        <button
          type="button"
          disabled={uploadBusy}
          onClick={() => inputRef.current?.click()}
          className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-brand-foreground shadow-soft transition hover:opacity-95 disabled:opacity-50"
        >
          {uploadBusy ? "上传中…" : "选择音频文件"}
        </button>
        {activeProjectId ? (
          <button
            type="button"
            onClick={() => resetSession()}
            className="mt-3 w-full text-center text-xs font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            上传新音频（将结束当前任务展示）
          </button>
        ) : null}
      </div>

      {activeProjectId ? (
        <section className="mt-10 border-t border-line pt-10" aria-label="Shownotes 工作区">
          <h2 className="text-base font-semibold text-ink">Shownotes</h2>
          <p className="mt-1 text-sm text-muted">转写完成后显示编辑区；生成过程请勿关闭页面。</p>
          <div className="mt-6">
            <ShownotesMakeClient
              key={activeProjectId}
              projectId={activeProjectId}
              embedOnLanding
              deferNotesUiUntilTranscribeOk
            />
          </div>
        </section>
      ) : null}
    </main>
  );
}
