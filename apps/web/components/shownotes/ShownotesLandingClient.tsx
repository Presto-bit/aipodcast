"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import { useAuth, isLoggedInAccountUser } from "../../lib/auth";
import { encodeClipFilenameForHttpHeader } from "../../lib/clipFilenameHeader";
import { SHOWNOTES_ONLY_CLIP_PROJECT_TITLE } from "../../lib/shownotesClipProject";
import { ShownotesBrandHeading } from "./ShownotesBrandHeading";
import ShownotesStudio from "./ShownotesStudio";

export default function ShownotesLandingClient() {
  const { ready, user, getAuthHeaders } = useAuth();
  const isLoggedIn = isLoggedInAccountUser(user);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [err, setErr] = useState("");
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [uploadedFileLabel, setUploadedFileLabel] = useState("");

  async function createProjectAndStage(file: File) {
    setErr("");
    setUploadedFileLabel(file.name || "audio");
    setUploadBusy(true);
    try {
      const res = await fetch("/api/clip/projects", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ title: SHOWNOTES_ONLY_CLIP_PROJECT_TITLE })
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; project?: { id?: string }; detail?: string };
      if (!res.ok || data.success === false || !data.project?.id) {
        throw new Error(data.detail || `创建任务失败 ${res.status}`);
      }
      const projectId = String(data.project.id);
      setActiveProjectId(projectId);

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
    } catch (e) {
      setUploadedFileLabel("");
      setActiveProjectId(null);
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setUploadBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  if (!ready) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10">
        <p className="text-sm text-muted">加载中…</p>
      </main>
    );
  }

  if (!isLoggedIn) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10">
        <ShownotesBrandHeading />
        <p className="mt-3 text-sm text-muted">请先登录工作台后再使用。</p>
        <Link href="/home" className="mt-6 inline-flex rounded-lg bg-cta px-4 py-2.5 text-sm font-medium text-cta-foreground shadow-soft">
          前往登录
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <ShownotesBrandHeading />

      {err ? <p className="mt-4 text-sm text-danger-ink" role="alert">{err}</p> : null}

      {!activeProjectId ? (
        <div className="mt-8 max-w-xl">
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
            className="flex w-full flex-col items-center gap-3 py-10 transition hover:opacity-90 disabled:opacity-50"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-fill/60 text-brand">
              <Plus className="h-7 w-7" strokeWidth={2} aria-hidden />
            </span>
            <span className="text-sm font-medium text-ink">{uploadBusy ? "创建任务并上传中…" : "点击上传音频"}</span>
          </button>
          <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted">
            <li>支持 MP3、WAV、M4A 等常见格式；创建任务后会尽快进入工作台，大文件上传可能仍持续数秒。</li>
            <li>请点击「开始生成」发起转写；转写与模型调用需保持页面打开。</li>
          </ul>
        </div>
      ) : null}

      {activeProjectId ? (
        <section className="mt-8" aria-label="Shownotes 工作区">
          <h2 className="sr-only">Shownotes 工作区</h2>
          <ShownotesStudio
            key={activeProjectId}
            projectId={activeProjectId}
            embedOnLanding
            fileLabel={uploadedFileLabel}
            onReplaceProject={(id, label) => {
              setActiveProjectId(id);
              setUploadedFileLabel(label);
            }}
          />
        </section>
      ) : null}
    </main>
  );
}
