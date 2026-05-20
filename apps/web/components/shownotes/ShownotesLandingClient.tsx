"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import { useAuth, isLoggedInAccountUser } from "../../lib/auth";
import { encodeClipFilenameForHttpHeader } from "../../lib/clipFilenameHeader";
import { formatOrchestratorErrorText } from "../../lib/api";
import {
  CLIP_PROJECT_KIND_SHOWNOTES,
  titleFromUploadedAudioFile
} from "../../lib/shownotesClipProject";
import { ShownotesBrandHeading } from "./ShownotesBrandHeading";
import ShownotesMyProjectsList from "./ShownotesMyProjectsList";
import ShownotesStudio from "./ShownotesStudio";

export default function ShownotesLandingClient() {
  const { ready, user, getAuthHeaders } = useAuth();
  const isLoggedIn = isLoggedInAccountUser(user);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [err, setErr] = useState("");
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [uploadedFileLabel, setUploadedFileLabel] = useState("");
  const [listRefreshKey, setListRefreshKey] = useState(0);

  function openProject(projectId: string, fileLabel: string) {
    setErr("");
    setActiveProjectId(projectId);
    setUploadedFileLabel(fileLabel);
  }

  async function createProjectAndStage(file: File) {
    setErr("");
    const label = titleFromUploadedAudioFile(file);
    setUploadedFileLabel(label);
    setUploadBusy(true);
    try {
      const res = await fetch("/api/clip/projects", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ title: label, project_kind: CLIP_PROJECT_KIND_SHOWNOTES })
      });
      const createText = await res.text();
      let createData: { success?: boolean; project?: { id?: string }; detail?: string } = {};
      try {
        if (createText.trim().startsWith("{")) createData = JSON.parse(createText) as typeof createData;
      } catch {
        /* 非 JSON（如网关 HTML） */
      }
      if (!res.ok || createData.success === false || !createData.project?.id) {
        const detail =
          typeof createData.detail === "string" && createData.detail.trim()
            ? createData.detail.trim()
            : formatOrchestratorErrorText(createText);
        throw new Error(detail || `创建任务失败 ${res.status}`);
      }
      const projectId = String(createData.project.id);
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
      const stageText = await stage.text();
      let stData: { success?: boolean; detail?: string } = {};
      try {
        if (stageText.trim().startsWith("{")) stData = JSON.parse(stageText) as typeof stData;
      } catch {
        /* 非 JSON */
      }
      if (!stage.ok || stData.success === false) {
        const detail =
          typeof stData.detail === "string" && stData.detail.trim()
            ? stData.detail.trim()
            : formatOrchestratorErrorText(stageText);
        throw new Error(detail || `上传失败 ${stage.status}`);
      }
      setListRefreshKey((k) => k + 1);
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
        <div className="mt-8 w-full max-w-3xl">
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
            <span className="text-sm font-medium text-ink">{uploadBusy ? "创建工程并上传中…" : "点击上传音频"}</span>
          </button>
          <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted">
            <li>支持 MP3、WAV、M4A 等常见格式；上传后将自动保存为 Shownotes 工程。</li>
            <li>请点击「开始生成」发起转写；转写与模型调用需保持页面打开。</li>
          </ul>
          <ShownotesMyProjectsList
            refreshKey={listRefreshKey}
            onOpenProject={(id, label) => openProject(id, label)}
          />
        </div>
      ) : null}

      {activeProjectId ? (
        <section className="mt-8" aria-label="Shownotes 工作区">
          <div className="mb-4">
            <button
              type="button"
              className="text-sm font-medium text-brand hover:underline"
              onClick={() => {
                setActiveProjectId(null);
                setUploadedFileLabel("");
                setListRefreshKey((k) => k + 1);
              }}
            >
              返回上传与工程列表
            </button>
          </div>
          <h2 className="sr-only">Shownotes 工作区</h2>
          <ShownotesStudio
            key={activeProjectId}
            projectId={activeProjectId}
            embedOnLanding
            fileLabel={uploadedFileLabel}
            onReplaceProject={(id, label) => {
              setActiveProjectId(id);
              setUploadedFileLabel(label);
              setListRefreshKey((k) => k + 1);
            }}
          />
        </section>
      ) : null}
    </main>
  );
}
