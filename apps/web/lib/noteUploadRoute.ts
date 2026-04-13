import { NextRequest, NextResponse } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "./bff";

/** OPTIONS：与主路径一致，避免 CDN/代理误判 405。 */
export function noteUploadOptionsResponse(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: "POST, OPTIONS",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}

/** POST：表单上传 → 编排器 upload_json。 */
export async function postNoteUploadFromForm(req: NextRequest): Promise<Response> {
  const form = await req.formData();
  const file = form.get("note_file");
  const notebook = String(form.get("notebook") || "").trim();
  const title = String(form.get("title") || "").trim();
  if (!notebook) {
    return NextResponse.json({ success: false, error: "请指定笔记本（notebook）" }, { status: 400 });
  }
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ success: false, error: "未提供笔记文件" }, { status: 400 });
  }
  const fname = (file as File).name || "note.txt";
  const buf = Buffer.from(await file.arrayBuffer());
  const bodyObj = {
    project_name: "default-notes",
    filename: fname,
    notebook,
    title,
    data_base64: buf.toString("base64")
  };
  const raw = JSON.stringify(bodyObj);
  return proxyJsonFromOrchestrator("/api/v1/notes/upload_json", {
    method: "POST",
    payload: raw,
    body: raw,
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) },
    timeoutMs: 120_000
  });
}
