/**
 * 将编排器 SSE / 任务事件中的进度原文转为面向用户的简短表述。
 * 未命中映射时原样返回（适用于校验提示、余额类错误等客户端文案）。
 */
export function presentJobProgressMessageForUser(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return s;

  const exact: Record<string, string> = {
    "媒体任务启动": "任务进行中",
    "任务开始执行": "任务进行中",
    "正在汇总参考材料（多 URL / 笔记 / 附加文本）": "正在整理参考资料",
    "正在汇总参考材料（检索与加载可能较慢）…": "正在整理参考资料",
    "正在调用模型生成脚本": "正在撰写脚本",
    "正在调用模型生成脚本（长稿可能较久）…": "正在撰写脚本",
    "正在生成播客脚本": "正在撰写脚本",
    "正在生成播客脚本（长稿可能较久）…": "正在撰写脚本",
    "脚本生成中…": "正在撰写脚本",
    "脚本已生成并上传对象存储": "脚本已完成",
    "脚本已生成，正在上传并准备语音合成…": "正在准备语音合成",
    "正在调用语音合成（开场 / 对白 / 结尾）…": "正在合成语音",
    "正在合成播客音频": "正在合成语音",
    "正在调用模型进行语音合成": "正在合成语音",
    "正在上传音频并克隆音色": "正在处理声音复刻",
    "双人分段较多，已自动切换快速合成模式": "正在以更快的方式合成语音",
    "播客生成完成": "生成完成",
    "任务完成": "生成完成",
    "语音合成完成": "生成完成",
    "笔记索引完成": "处理完成",
    "正在为笔记建立向量索引与摘要": "正在处理笔记内容"
  };
  const mapped = exact[s];
  if (mapped) return mapped;

  if (/^双人对话合成 \d+\/\d+$/.test(s)) return "正在合成语音";
  if (/^分段合成完成（\d+ 段）$/.test(s)) return "正在合成语音";
  if (/说话人[12]\s*·/.test(s)) return "正在合成语音";

  return s;
}

/** 任务详情「处理记录」中事件类型的简短中文标签 */
export function presentJobEventTypeForUser(eventType: string | undefined): string {
  const t = String(eventType || "").trim().toLowerCase();
  if (t === "progress") return "进度";
  if (t === "complete") return "完成";
  if (t === "error") return "错误";
  if (t === "script_chunk") return "撰写";
  if (t === "terminal") return "结束";
  if (t === "log") return "记录";
  return t || "事件";
}

/**
 * 是否应在用户可见的「处理记录」时间线中隐藏该事件（内部排障、元数据等）。
 */
export function shouldHideJobEventFromUserTimeline(eventType: string | undefined): boolean {
  const t = String(eventType || "").trim().toLowerCase();
  return t === "log" || t === "terminal";
}

export type JobTimelineEvent = {
  type?: string;
  message?: string;
  id?: number;
};

/**
 * 过滤内部事件，并将连续相同（类型 + 用户可见文案）的条目合并为一行，避免 script_chunk 等刷屏。
 */
export function visibleJobEventsForUserTimeline(events: JobTimelineEvent[]): JobTimelineEvent[] {
  const filtered = events.filter((e) => !shouldHideJobEventFromUserTimeline(e.type));
  const out: JobTimelineEvent[] = [];
  for (const ev of filtered) {
    const uMsg = presentJobProgressMessageForUser(String(ev.message || "").trim());
    const prev = out[out.length - 1];
    if (prev) {
      const prevMsg = presentJobProgressMessageForUser(String(prev.message || "").trim());
      if (String(prev.type || "") === String(ev.type || "") && prevMsg === uMsg) continue;
    }
    out.push(ev);
  }
  return out;
}
