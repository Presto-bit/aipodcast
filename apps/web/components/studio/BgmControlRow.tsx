"use client";

import type { BgmUiMode } from "../../lib/bgmUpload";

export default function BgmControlRow({
  label,
  mode,
  onModeChange,
  file,
  onFileChange,
  uploadRestoredHint = false
}: {
  label: string;
  mode: BgmUiMode;
  onModeChange: (m: BgmUiMode) => void;
  file: File | null;
  onFileChange: (f: File | null) => void;
  /** 本地上传已从预设恢复缓存，当前无 File 对象 */
  uploadRestoredHint?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-ink">{label}</span>
      <select
        className="w-full rounded-lg border border-line bg-fill p-2 text-sm"
        value={mode}
        onChange={(e) => {
          onModeChange(e.target.value as BgmUiMode);
          onFileChange(null);
        }}
      >
        <option value="none">不使用</option>
        <option value="preset_bgm01">默认预设 BGM1</option>
        <option value="preset_bgm02">默认预设 BGM2</option>
        <option value="upload">本地上传</option>
      </select>
      {mode === "upload" ? (
        <input
          type="file"
          accept="audio/*,.mp3,.wav,.m4a"
          className="block w-full text-xs text-muted file:mr-2 file:rounded file:border file:border-line file:bg-white file:px-2 file:py-1"
          onChange={(e) => onFileChange(e.target.files?.[0] || null)}
        />
      ) : null}
      {file ? <p className="text-[11px] text-muted">{file.name}</p> : null}
      {mode === "upload" && !file && uploadRestoredHint ? (
        <p className="text-[11px] text-amber-800/90">已恢复上次缓存的音频数据，可直接生成；也可重新选择文件替换。</p>
      ) : null}
    </div>
  );
}
