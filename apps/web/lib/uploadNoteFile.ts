import { getBearerAuthHeadersSync } from "./authHeaders";
import { NOTES_PODCAST_PROJECT_NAME } from "./notesProject";
import { validateNoteFileMeta } from "./noteUploadConstants";

type UploadJson = {
  success?: boolean;
  note?: { noteId?: string };
  parseEmpty?: boolean;
  /** 服务端正文解析结果（上传成功但可能解析为空） */
  parse?: {
    status?: string;
    engine?: string;
    detail?: string;
    encoding?: string;
  };
  detail?: unknown;
  error?: unknown;
  requestId?: string;
  request_id?: string;
};

function parseError(data: UploadJson, status: number, rawText: string, responseRequestId?: string): string {
  const requestId = (responseRequestId || data.requestId || data.request_id || "").trim();
  const detail = (data as { detail?: unknown }).detail;
  const detailText =
    typeof detail === "string" && detail.trim()
      ? detail.trim()
      : Array.isArray(detail) && detail[0] && typeof (detail[0] as { msg?: string }).msg === "string"
        ? String((detail[0] as { msg: string }).msg).trim()
        : "";
  const errorText =
    typeof data.error === "string" && data.error.trim()
      ? data.error.trim()
      : data.error && typeof data.error === "object" && typeof (data.error as { message?: unknown }).message === "string"
        ? String((data.error as { message: string }).message).trim()
        : "";
  const errorCode =
    data.error && typeof data.error === "object" && typeof (data.error as { code?: unknown }).code === "string"
      ? String((data.error as { code: string }).code).trim()
      : typeof data.error === "string"
        ? data.error.trim()
        : "";
  const genericInternal =
    errorCode === "internal_server_error" ||
    errorText === "internal_server_error" ||
    detailText === "internal_server_error";

  if (errorCode) {
    const err = errorCode;
    if (err === "upstream_unreachable" || err === "orchestrator request failed") {
      return "无法连接编排器或请求中断。请确认 orchestrator 已启动，且 Next 的 ORCHESTRATOR_URL 指向可访问地址（本机开发多为 http://127.0.0.1:8008；Docker 内多为 http://orchestrator:8008）。";
    }
    if (err === "internal_server_error" && detailText && detailText !== "internal_server_error") {
      return `服务内部错误：${detailText}`;
    }
  }
  if (status === 413) {
    return "请求体积超过服务端限制，请改用较小文件（≤15MB）或压缩后再传。";
  }
  if (status === 401) {
    return "未登录或会话已失效，请重新登录后再上传。";
  }
  const lower = rawText.slice(0, 500).toLowerCase();
  if (status >= 400 && (lower.includes("body exceeded") || lower.includes("body size"))) {
    return "请求体积超过 Next 或反代单次限制。请调大 body 上限（建议 ≥25MB）或改用较小文件。";
  }
  if (detailText && detailText !== "internal_server_error") return detailText;
  if (genericInternal) {
    const ridLine = requestId ? `（请求ID：${requestId}）` : "";
    return `上传失败：服务内部异常，可能由存储服务、数据库或解析服务暂时不可用导致，请稍后重试${ridLine}。`;
  }
  if (errorText) {
    if (errorText === "internal_server_error") {
      const ridLine = requestId ? `（请求ID：${requestId}）` : "";
      return `上传失败：服务内部异常，请稍后重试${ridLine}。`;
    }
    return errorText;
  }
  if (rawText.trim() && !rawText.trim().startsWith("{")) {
    return `上传失败（HTTP ${status}）。若持续出现，请查看 Next 终端或反代错误日志（响应非 JSON，多为 BFF/运行时异常）。`;
  }
  return `上传失败（HTTP ${status}）`;
}

/**
 * multipart → `/api/note-upload`，避免整文件 base64；XHR 仍可展示上传字节进度。
 * 进度：0–99 为浏览器→Next；100 表示 Next 已收齐，编排器仍在解析/落库（与页面「处理中」文案一致）。
 */
export function uploadNoteFileWithProgress(
  file: File,
  opts: {
    notebook?: string;
    title?: string;
    projectName?: string;
    onProgress?: (percent0to100: number) => void;
  } = {}
): Promise<{ ok: true; data: UploadJson } | { ok: false; error: string }> {
  const nb = (opts.notebook || "").trim();
  if (!nb) {
    return Promise.resolve({ ok: false, error: "未指定笔记本" });
  }

  const pre = validateNoteFileMeta(file);
  if (!pre.ok) {
    return Promise.resolve({ ok: false, error: pre.error });
  }

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/note-upload");
    xhr.withCredentials = true;
    xhr.responseType = "text";
    const authHdr = getBearerAuthHeadersSync();
    for (const [k, v] of Object.entries(authHdr)) {
      xhr.setRequestHeader(k, v);
    }

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable || !opts.onProgress) return;
      const pct = Math.min(99, Math.max(0, Math.round((e.loaded / e.total) * 100)));
      opts.onProgress(pct);
    };

    xhr.upload.onload = () => {
      opts.onProgress?.(100);
    };

    xhr.onload = () => {
      const rawText = xhr.responseText || "";
      let data: UploadJson = {};
      try {
        data = JSON.parse(rawText || "{}") as UploadJson;
      } catch {
        data = {};
      }
      const status = xhr.status;
      const responseRequestId = (xhr.getResponseHeader("x-request-id") || "").trim();
      if (status >= 200 && status < 300 && data.success !== false) {
        resolve({ ok: true, data });
        return;
      }
      resolve({ ok: false, error: parseError(data, status, rawText, responseRequestId) });
    };

    xhr.onerror = () => resolve({ ok: false, error: "网络异常，上传中断" });
    xhr.onabort = () => resolve({ ok: false, error: "上传已取消" });

    const form = new FormData();
    form.append("file", file, file.name || "note.txt");
    form.append("notebook", nb);
    form.append("title", (opts.title || "").trim());
    form.append(
      "project_name",
      (opts.projectName || NOTES_PODCAST_PROJECT_NAME).trim() || NOTES_PODCAST_PROJECT_NAME
    );
    xhr.send(form);
  });
}
