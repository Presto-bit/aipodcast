"use client";

import { chipClass } from "./chipStyles";

/** 与嵌入 PodcastStudio 首行 chip + 生成按钮布局一致，仅占位、无交互逻辑 */
export function CreatePodcastStudioIdleShell() {
  return (
    <div className="relative pt-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap gap-2">
            <span className="pointer-events-none inline-block align-top opacity-80">
              <span className={chipClass(false)}>单人</span>
            </span>
            <span className="pointer-events-none inline-block align-top opacity-80">
              <span className={chipClass(false)}>语言 · 中文</span>
            </span>
            <span className="pointer-events-none inline-block align-top opacity-80">
              <span className={chipClass(false)}>人设风格 · 闲聊</span>
            </span>
            <span className="pointer-events-none inline-block align-top opacity-80">
              <span className={chipClass(false)}>上传文件</span>
            </span>
            <span className="pointer-events-none inline-block align-top opacity-80">
              <span className={chipClass(false)}>展开高级设置</span>
            </span>
          </div>
          <p className="text-[11px] leading-snug text-muted">正在加载完整工作台（轻量预览，不阻塞进页）…</p>
        </div>
        <button
          type="button"
          disabled
          className="inline-flex min-w-[6.25rem] shrink-0 cursor-wait items-center justify-center gap-2 self-end rounded-full border border-line bg-fill px-3 py-2 text-xs font-medium text-muted opacity-70 sm:ml-1 sm:self-start"
          aria-disabled
        >
          请稍候…
        </button>
      </div>
    </div>
  );
}

/** 与嵌入 TtsStudio 首行 chip 布局一致 */
export function CreateTtsStudioIdleShell() {
  return (
    <div className="relative pt-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap gap-2">
            <span className="pointer-events-none inline-block align-top opacity-80">
              <span className={chipClass(false)}>单人</span>
            </span>
            <span className="pointer-events-none inline-block align-top opacity-80">
              <span className={chipClass(false)}>音色 · 默认</span>
            </span>
            <span className="pointer-events-none inline-block align-top opacity-80">
              <span className={chipClass(false)}>开场/结尾 · 默认</span>
            </span>
          </div>
          <p className="text-[11px] leading-snug text-muted">正在加载完整工作台…</p>
        </div>
        <button
          type="button"
          disabled
          className="inline-flex min-w-[6.25rem] shrink-0 cursor-wait items-center justify-center gap-2 self-end rounded-full border border-line bg-fill px-3 py-2 text-xs font-medium text-muted opacity-70 sm:ml-1 sm:self-start"
          aria-disabled
        >
          请稍候…
        </button>
      </div>
    </div>
  );
}
