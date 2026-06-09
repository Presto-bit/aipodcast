/** 剪辑导出 MP3：同源 fetch + blob 触发浏览器下载，避免 window.open 跳转。 */

function sanitizeExportFilename(title: string): string {
  const cleaned = String(title || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return cleaned || "export";
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

export async function downloadClipExportMp3(opts: {
  projectId: string;
  title?: string;
  headers?: Record<string, string>;
}): Promise<void> {
  const { projectId, title, headers = {} } = opts;
  const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/export/file`, {
    method: "GET",
    credentials: "same-origin",
    headers
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { detail?: string; error?: string };
    throw new Error(data.detail || data.error || `下载失败 ${res.status}`);
  }
  const blob = await res.blob();
  if (!blob.size) throw new Error("导出文件为空");
  triggerBlobDownload(blob, `${sanitizeExportFilename(title || "export")}.mp3`);
}
