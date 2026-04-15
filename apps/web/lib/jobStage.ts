import type { JobRecord } from "./types";

export type StreamPayload = {
  id?: number;
  type?: string;
  message?: string;
  payload?: Record<string, unknown>;
  created_at?: string;
  status?: string;
  job_id?: string;
};

const JOB_TYPE_LABEL: Record<string, string> = {
  script_draft: "脚本草稿",
  podcast_generate: "播客生成",
  podcast: "播客合成",
  podcast_short_video: "播客短视频",
  tts: "文本转语音",
  text_to_speech: "文本转语音",
  voice_clone: "声音复刻",
  note_import: "笔记导入",
  default: "创作任务"
};

/** 任务类型展示名（列表、摘要等复用） */
export function jobTypeLabel(jobType: string): string {
  return JOB_TYPE_LABEL[jobType] || JOB_TYPE_LABEL.default;
}

function lastMeaningfulEvent(events: StreamPayload[]): StreamPayload | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    const t = e?.type || "";
    if (t && t !== "terminal") return e;
  }
  return null;
}

export function deriveJobStage(
  job: JobRecord | null,
  events: StreamPayload[]
): { stageLabel: string; nextStep: string; detail?: string } {
  const jt = job?.job_type || "default";
  const label = jobTypeLabel(jt);
  const st = job?.status || "";

  if (st === "succeeded") {
    return {
      stageLabel: "已完成",
      nextStep: "可在本页下载或复制成品，或到「我的作品」里收听。",
      detail: label
    };
  }
  if (st === "failed" || st === "cancelled") {
    return {
      stageLabel: st === "failed" ? "已失败" : "已取消",
      nextStep: st === "failed" ? "可按提示修改内容或设置后重试，也可联系客服。" : "需要的话可以重新发起一次创作。",
      detail: label
    };
  }

  const ev = lastMeaningfulEvent(events);
  const evType = ev?.type || "";
  const evMsg = typeof ev?.message === "string" ? ev.message.trim() : "";

  if (st === "queued") {
    return {
      stageLabel: "排队中",
      nextStep: "系统正在排队处理，一般不会太久；若长时间没动，可刷新页面或稍后再看。",
      detail: label
    };
  }

  if (evType === "script_chunk") {
    return {
      stageLabel: "撰写脚本",
      nextStep: "完成后会继续生成语音或混音（视类型而定）。下方文案预览会陆续刷新。",
      detail: evMsg || label
    };
  }

  if (/tts|audio|mix|encode|render/i.test(evType) || /语音|合成|混音|编码/.test(evMsg)) {
    return {
      stageLabel: "音频处理",
      nextStep: "生成可播放文件并写入对象存储，请稍候。",
      detail: evMsg || label
    };
  }

  if (evMsg) {
    return {
      stageLabel: "处理中",
      nextStep: "下方处理记录会显示主要步骤；完成后本页会自动更新。",
      detail: evMsg
    };
  }

  return {
    stageLabel: "执行中",
    nextStep: "正在处理中。可留在本页查看进度，也可以稍后在「创作记录」里看结果。",
    detail: label
  };
}
