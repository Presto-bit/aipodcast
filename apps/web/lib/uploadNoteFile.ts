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

type UploadClientDiagnostic = {
  stage: "xhr_onload" | "xhr_error" | "xhr_abort";
  notebook: string;
  filename: string;
  fileType: string;
  fileSize: number;
  status?: number;
  requestId?: string;
  errorCode?: string;
  errorMessage: string;
  detailPreview?: string;
  clientRequestId?: string;
  responseRequestId?: string;
  projectName?: string;
  fileLastModified?: number;
  userAgent?: string;
  networkOnline?: boolean;
};

function clientRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `upload-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function pickUploadErrorCode(data: UploadJson, status: number): string {
  if (data.error && typeof data.error === "object" && typeof (data.error as { code?: unknown }).code === "string") {
    const code = String((data.error as { code: string }).code).trim();
    if (code) return code;
  }
  if (typeof data.error === "string" && data.error.trim()) return data.error.trim();
  if (status >= 400) return `HTTP_${status}`;
  return "UPLOAD_UNKNOWN_ERROR";
}

function previewText(raw: string, max = 500): string {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function reportUploadClientDiagnostic(payload: UploadClientDiagnostic): Promise<void> {
  try {
    const body = {
      source: "onerror",
      route: "/notes",
      release: "",
      message: payload.errorMessage,
      location: "uploadNoteFileWithProgress",
      data: {
        uploadStage: payload.stage,
        notebook: payload.notebook,
        filename: payload.filename,
        fileType: payload.fileType,
        fileSize: payload.fileSize,
        status: payload.status,
        requestId: payload.requestId || "",
        clientRequestId: payload.clientRequestId || "",
        responseRequestId: payload.responseRequestId || "",
        errorCode: payload.errorCode || "",
        detailPreview: payload.detailPreview || "",
        projectName: payload.projectName || "",
        fileLastModified: payload.fileLastModified || 0,
        userAgent: payload.userAgent || "",
        networkOnline: typeof payload.networkOnline === "boolean" ? payload.networkOnline : null
      }
    };
    await fetch("/api/frontend-global-error", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        ...(payload.requestId ? { "x-request-id": payload.requestId } : {})
      },
      body: JSON.stringify(body)
    });
  } catch {
    // ignore diagnostics failures
  }
}

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
    const rid = clientRequestId();
    xhr.open("POST", "/api/note-upload");
    xhr.withCredentials = true;
    xhr.responseType = "text";
    xhr.setRequestHeader("x-request-id", rid);
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
      const parsedError = parseError(data, status, rawText, responseRequestId);
      void reportUploadClientDiagnostic({
        stage: "xhr_onload",
        notebook: nb,
        filename: file.name || "note.txt",
        fileType: file.type || "",
        fileSize: Number(file.size || 0),
        status,
        requestId: responseRequestId || data.requestId || data.request_id || "",
        clientRequestId: rid,
        responseRequestId,
        errorCode: pickUploadErrorCode(data, status),
        errorMessage: parsedError,
        detailPreview: previewText(rawText),
        projectName: (opts.projectName || NOTES_PODCAST_PROJECT_NAME).trim() || NOTES_PODCAST_PROJECT_NAME,
        fileLastModified: Number(file.lastModified || 0),
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        networkOnline: typeof navigator !== "undefined" ? navigator.onLine : undefined
      });
      resolve({ ok: false, error: parsedError });
    };

    xhr.onerror = () => {
      const msg = "网络异常，上传中断";
      void reportUploadClientDiagnostic({
        stage: "xhr_error",
        notebook: nb,
        filename: file.name || "note.txt",
        fileType: file.type || "",
        fileSize: Number(file.size || 0),
        clientRequestId: rid,
        errorCode: "XHR_NETWORK_ERROR",
        errorMessage: msg,
        projectName: (opts.projectName || NOTES_PODCAST_PROJECT_NAME).trim() || NOTES_PODCAST_PROJECT_NAME,
        fileLastModified: Number(file.lastModified || 0),
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        networkOnline: typeof navigator !== "undefined" ? navigator.onLine : undefined
      });
      resolve({ ok: false, error: msg });
    };
    xhr.onabort = () => {
      const msg = "上传已取消";
      void reportUploadClientDiagnostic({
        stage: "xhr_abort",
        notebook: nb,
        filename: file.name || "note.txt",
        fileType: file.type || "",
        fileSize: Number(file.size || 0),
        clientRequestId: rid,
        errorCode: "XHR_ABORT",
        errorMessage: msg,
        projectName: (opts.projectName || NOTES_PODCAST_PROJECT_NAME).trim() || NOTES_PODCAST_PROJECT_NAME,
        fileLastModified: Number(file.lastModified || 0),
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        networkOnline: typeof navigator !== "undefined" ? navigator.onLine : undefined
      });
      resolve({ ok: false, error: msg });
    };

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
