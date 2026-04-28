import { NextRequest, NextResponse } from "next/server";
import { ingestLogEvent } from "../core/observability";
import { fetchOrchestrator, getOrCreateRequestId, incomingAuthHeadersFrom } from "./bff";
import { MAX_NOTE_UPLOAD_BYTES, validateNoteFileMeta } from "./noteUploadConstants";
import { NOTES_PODCAST_PROJECT_NAME } from "./notesProject";

export type NoteUploadJsonBody = {
  project_name?: string;
  filename?: string;
  notebook?: string;
  title?: string;
  data_base64?: string;
};

const MAX_UPLOAD_FILENAME_CODEPOINTS = 180;

function truncateByCodePoints(input: string, max: number): string {
  const chars = Array.from(input);
  if (chars.length <= max) return input;
  return chars.slice(0, max).join("");
}

function normalizeUploadFilename(raw: string | undefined, fallback = "note.txt"): string {
  const fb = String(fallback || "note.txt").trim() || "note.txt";
  let name = String(raw || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "-")
    .replace(/[<>:"|?*]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) return fb;
  if (name.startsWith(".")) name = `file${name}`;

  const lastDot = name.lastIndexOf(".");
  let base = lastDot > 0 ? name.slice(0, lastDot) : name;
  let ext = lastDot > 0 ? name.slice(lastDot + 1) : "";

  base = base.replace(/\.+$/g, "").trim() || "note";
  ext = ext.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if (ext.length > 12) ext = ext.slice(0, 12);

  const suffix = ext ? `.${ext}` : ".txt";
  const maxBase = Math.max(1, MAX_UPLOAD_FILENAME_CODEPOINTS - Array.from(suffix).length);
  base = truncateByCodePoints(base, maxBase);
  return `${base}${suffix}`;
}

function parseUpstreamError(text: string, status: number): { code: string; message: string } {
  const raw = String(text || "").trim();
  if (!raw) return { code: `HTTP_${status}`, message: `Upstream returned ${status} with empty body` };
  try {
    const data = JSON.parse(raw) as { error?: unknown; detail?: unknown };
    const code =
      typeof data.error === "string" && data.error.trim()
        ? data.error.trim()
        : `HTTP_${status}`;
    const message =
      typeof data.detail === "string" && data.detail.trim()
        ? data.detail.trim()
        : raw.slice(0, 600);
    return { code, message: message.slice(0, 600) };
  } catch {
    return { code: `HTTP_${status}`, message: raw.slice(0, 600) };
  }
}

async function emitUploadDiag(params: {
  requestId: string;
  route: string;
  stage: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    await ingestLogEvent({
      scope: "bff_api_error",
      requestId: params.requestId,
      level: "info",
      errorCode: "UPLOAD_DIAG",
      module: "upload_diag",
      route: params.route,
      message: `upload_diag:${params.stage}`,
      payload: { stage: params.stage, ...(params.payload || {}) },
      logger: "log"
    });
  } catch {
    // ignore diagnostic logging failures
  }
}

/**
 * multipart（推荐）→ 编排器 `upload_raw`；JSON（兼容旧客户端）→ `upload_json`。
 */
export async function handleNoteUploadPOST(req: NextRequest): Promise<Response> {
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("multipart/form-data")) {
    return handleMultipartNoteUpload(req);
  }
  return handleJsonNoteUpload(req);
}

async function handleMultipartNoteUpload(req: NextRequest): Promise<Response> {
  const requestId = getOrCreateRequestId(req);
  let form: FormData;
  try {
    form = await req.formData();
    await emitUploadDiag({
      requestId,
      route: "/api/note-upload",
      stage: "multipart_form_parsed",
      payload: { contentType: req.headers.get("content-type") || "" }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[note-upload] multipart parse error:", msg);
    await ingestLogEvent({
      scope: "bff_api_error",
      requestId,
      level: "error",
      errorCode: "BFF_MULTIPART_PARSE_ERROR",
      module: "bff",
      route: "/api/note-upload",
      message: msg.slice(0, 600),
      payload: { route: "/api/note-upload" },
      logger: "error"
    });
    return NextResponse.json(
      { success: false, detail: "无法解析上传表单，若文件较大请确认网关与 Next 的请求体上限已放宽。" },
      { status: 400 }
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, detail: "未提供文件字段 file" }, { status: 400 });
  }

  const pre = validateNoteFileMeta(file);
  if (!pre.ok) {
    return NextResponse.json({ success: false, detail: pre.error }, { status: 400 });
  }

  const notebook = String(form.get("notebook") || "").trim();
  const title = String(form.get("title") || "").trim();
  const projectName = String(form.get("project_name") || NOTES_PODCAST_PROJECT_NAME).trim() || NOTES_PODCAST_PROJECT_NAME;
  const fname = normalizeUploadFilename(file.name, "note.txt");

  if (!notebook) {
    return NextResponse.json({ success: false, detail: "请指定笔记本（notebook）" }, { status: 400 });
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(await file.arrayBuffer());
    await emitUploadDiag({
      requestId,
      route: "/api/note-upload",
      stage: "multipart_file_buffered",
      payload: { fileSize: buf.length, notebook, filename: fname, projectName }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, detail: `读取文件失败：${msg}` }, { status: 400 });
  }

  if (buf.length > MAX_NOTE_UPLOAD_BYTES) {
    return NextResponse.json({ success: false, detail: "文件过大" }, { status: 400 });
  }

  const qs = new URLSearchParams({
    notebook,
    filename: fname,
    title,
    project_name: projectName
  });

  try {
    const upstream = await fetchOrchestrator(`/api/v1/notes/upload_raw?${qs.toString()}`, {
      method: "POST",
      body: buf,
      headers: { "content-type": "application/octet-stream", ...incomingAuthHeadersFrom(req) },
      timeoutMs: 120_000,
      requestId
    });
    const text = await upstream.text();
    await emitUploadDiag({
      requestId,
      route: "/api/v1/notes/upload_raw",
      stage: "multipart_upstream_returned",
      payload: { status: upstream.status, ok: upstream.ok, notebook, filename: fname }
    });
    if (!upstream.ok) {
      const parsedErr = parseUpstreamError(text, upstream.status);
      await ingestLogEvent({
        scope: "orchestrator_api_error",
        requestId,
        level: "error",
        errorCode: parsedErr.code,
        module: "orchestrator",
        route: "/api/v1/notes/upload_raw",
        message: parsedErr.message,
        payload: { status: upstream.status, notebook, filename: fname },
        logger: "error"
      });
    }
    return new Response(text, {
      status: upstream.status,
      headers: { "content-type": "application/json" }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[note-upload] multipart upstream error:", msg);
    await ingestLogEvent({
      scope: "bff_api_error",
      requestId,
      level: "error",
      errorCode: "BFF_NOTE_UPLOAD_PROXY_ERROR",
      module: "bff",
      route: "/api/note-upload",
      message: msg.slice(0, 600),
      payload: { target: "/api/v1/notes/upload_raw" },
      logger: "error"
    });
    return NextResponse.json({ success: false, detail: `笔记上传处理失败：${msg}` }, { status: 500 });
  }
}

async function handleJsonNoteUpload(req: NextRequest): Promise<Response> {
  const requestId = getOrCreateRequestId(req);
  let body: NoteUploadJsonBody;
  try {
    body = (await req.json()) as NoteUploadJsonBody;
    await emitUploadDiag({
      requestId,
      route: "/api/note-upload",
      stage: "json_body_parsed",
      payload: { contentType: req.headers.get("content-type") || "" }
    });
  } catch {
    return NextResponse.json({ success: false, detail: "请求体不是合法 JSON" }, { status: 400 });
  }

  try {
    const notebook = String(body.notebook || "").trim();
    const dataBase64 = typeof body.data_base64 === "string" ? body.data_base64.trim() : "";
    const filename = normalizeUploadFilename(body.filename, "note.txt");
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const projectName = String(body.project_name || NOTES_PODCAST_PROJECT_NAME).trim() || NOTES_PODCAST_PROJECT_NAME;

    if (!notebook) {
      return NextResponse.json({ success: false, detail: "请指定笔记本（notebook）" }, { status: 400 });
    }
    if (!dataBase64) {
      return NextResponse.json({ success: false, detail: "未提供文件内容（data_base64）" }, { status: 400 });
    }

    const payloadObj: NoteUploadJsonBody = {
      project_name: projectName,
      filename,
      notebook,
      title,
      data_base64: dataBase64
    };
    const raw = JSON.stringify(payloadObj);

    const upstream = await fetchOrchestrator("/api/v1/notes/upload_json", {
      method: "POST",
      payload: raw,
      body: raw,
      headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) },
      timeoutMs: 120_000,
      requestId
    });
    const text = await upstream.text();
    await emitUploadDiag({
      requestId,
      route: "/api/v1/notes/upload_json",
      stage: "json_upstream_returned",
      payload: { status: upstream.status, ok: upstream.ok, notebook, filename }
    });
    if (!upstream.ok) {
      const parsedErr = parseUpstreamError(text, upstream.status);
      await ingestLogEvent({
        scope: "orchestrator_api_error",
        requestId,
        level: "error",
        errorCode: parsedErr.code,
        module: "orchestrator",
        route: "/api/v1/notes/upload_json",
        message: parsedErr.message,
        payload: { status: upstream.status, notebook, filename },
        logger: "error"
      });
    }
    return new Response(text, {
      status: upstream.status,
      headers: { "content-type": "application/json" }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[note-upload] json app route error:", msg);
    await ingestLogEvent({
      scope: "bff_api_error",
      requestId,
      level: "error",
      errorCode: "BFF_NOTE_UPLOAD_JSON_PROXY_ERROR",
      module: "bff",
      route: "/api/notes/upload",
      message: msg.slice(0, 600),
      payload: { target: "/api/v1/notes/upload_json" },
      logger: "error"
    });
    return NextResponse.json({ success: false, detail: `笔记上传处理失败：${msg}` }, { status: 500 });
  }
}

export function handleNoteUploadOPTIONS(): Response {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: "POST, OPTIONS",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Cookie, X-Request-ID"
    }
  });
}
