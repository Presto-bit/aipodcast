import { getBearerAuthHeadersSync } from "./authHeaders";

type UploadJson = {
  success?: boolean;
  note?: { noteId?: string };
  detail?: unknown;
  error?: string;
};

function parseError(data: UploadJson, status: number): string {
  if (typeof data.error === "string" && data.error.trim()) return data.error.trim();
  const d = (data as { detail?: unknown }).detail;
  if (typeof d === "string" && d.trim()) return d.trim();
  if (Array.isArray(d) && d[0] && typeof (d[0] as { msg?: string }).msg === "string") {
    return String((d[0] as { msg: string }).msg).trim();
  }
  return `上传失败（HTTP ${status}）`;
}

/**
 * 使用 XMLHttpRequest 以便展示浏览器 → BFF 的字节上传进度（大文件体感更明显）。
 * 服务端整包转发的耗时无法细分，进度在 100% 后仍可能短暂等待 JSON 响应。
 */
export function uploadNoteFileWithProgress(
  file: File,
  opts: {
    notebook?: string;
    title?: string;
    onProgress?: (percent0to100: number) => void;
  } = {}
): Promise<{ ok: true; data: UploadJson } | { ok: false; error: string }> {
  const nb = (opts.notebook || "").trim();
  if (!nb) {
    return Promise.resolve({ ok: false, error: "未指定笔记本" });
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
      const pct = Math.min(100, Math.max(0, Math.round((e.loaded / e.total) * 100)));
      opts.onProgress(pct);
    };

    xhr.onload = () => {
      let data: UploadJson = {};
      try {
        data = JSON.parse(xhr.responseText || "{}") as UploadJson;
      } catch {
        data = {};
      }
      const status = xhr.status;
      if (status >= 200 && status < 300 && data.success !== false) {
        resolve({ ok: true, data });
        return;
      }
      resolve({ ok: false, error: parseError(data, status) });
    };

    xhr.onerror = () => resolve({ ok: false, error: "网络异常，上传中断" });
    xhr.onabort = () => resolve({ ok: false, error: "上传已取消" });

    const form = new FormData();
    form.append("note_file", file);
    form.append("notebook", nb);
    if (opts.title?.trim()) form.append("title", opts.title.trim());
    xhr.send(form);
  });
}
