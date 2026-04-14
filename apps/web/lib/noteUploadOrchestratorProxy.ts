import { NextRequest, NextResponse } from "next/server";
import { fetchOrchestrator, getOrCreateRequestId, incomingAuthHeadersFrom } from "./bff";
import { MAX_NOTE_UPLOAD_BYTES, validateNoteFileMeta } from "./noteUploadConstants";

export type NoteUploadJsonBody = {
  project_name?: string;
  filename?: string;
  notebook?: string;
  title?: string;
  data_base64?: string;
};

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
  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[note-upload] multipart parse error:", msg);
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
  const projectName = String(form.get("project_name") || "default-notes").trim() || "default-notes";
  const fname = (file.name || "note.txt").trim() || "note.txt";

  if (!notebook) {
    return NextResponse.json({ success: false, detail: "请指定笔记本（notebook）" }, { status: 400 });
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(await file.arrayBuffer());
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
      requestId: getOrCreateRequestId(req)
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "content-type": "application/json" }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[note-upload] multipart upstream error:", msg);
    return NextResponse.json({ success: false, detail: `笔记上传处理失败：${msg}` }, { status: 500 });
  }
}

async function handleJsonNoteUpload(req: NextRequest): Promise<Response> {
  let body: NoteUploadJsonBody;
  try {
    body = (await req.json()) as NoteUploadJsonBody;
  } catch {
    return NextResponse.json({ success: false, detail: "请求体不是合法 JSON" }, { status: 400 });
  }

  try {
    const notebook = String(body.notebook || "").trim();
    const dataBase64 = typeof body.data_base64 === "string" ? body.data_base64.trim() : "";
    const filename = String(body.filename || "note.txt").trim() || "note.txt";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const projectName = String(body.project_name || "default-notes").trim() || "default-notes";

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
      requestId: getOrCreateRequestId(req)
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "content-type": "application/json" }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[note-upload] json app route error:", msg);
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
