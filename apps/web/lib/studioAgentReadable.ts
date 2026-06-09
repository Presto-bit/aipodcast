import type { StudioAgentStep } from "./studioAgentSteps";

const STEP_LABELS: Record<string, string> = {
  understand: "理解你的需求",
  read_manuscript: "阅读当前成稿",
  route: "决定下一步",
  compose_stream: "撰写成稿",
  plan_0: "分析指令",
  plan_1: "确认动作",
  plan_2: "再次确认"
};

/** Agent 步骤 → 用户可读文案 */
export function humanizeAgentStepLabel(step: StudioAgentStep): string {
  const mapped = STEP_LABELS[step.id];
  if (mapped) return mapped;
  if (step.id.startsWith("plan_")) return "分析指令";
  const label = step.label.trim();
  if (/流式写稿|撰写/.test(label)) return "撰写成稿";
  if (/流式改版|改版/.test(label)) return "按你的意见修改";
  if (/理解/.test(label)) return "理解你的需求";
  if (/读取|稿件/.test(label)) return "阅读当前成稿";
  if (/reply|问答/.test(label)) return "准备回复";
  if (/compose/.test(label)) return "开始写稿";
  if (/revise/.test(label)) return "开始改版";
  return label || "处理中";
}

/** SSE phase / runPhase → 用户可读进度 */
export function humanizeComposePhase(phase: string): string {
  const p = phase.trim();
  if (!p) return "准备写稿…";
  if (/检索|资料|准备创作/.test(p)) return "正在阅读资料与任务要点…";
  if (/撰写|标题与正文|完整成稿|写稿|生成内容|模型撰写|首个预览/.test(p)) {
    return "正在撰写成稿…";
  }
  if (/优化|模板|重写/.test(p)) return "正在优化表述，避免空泛模板…";
  if (/润色|钩子|锚点|备选/.test(p)) return "正在润色标题与开头…";
  if (/输出|流式|block/.test(p)) return "正在输出成稿…";
  if (/就绪|完成|100|整理/.test(p)) return "即将完成…";
  if (/改版/.test(p)) return "正在按你的意见修改…";
  if (/开始写稿/.test(p)) return "开始写稿…";
  return p;
}
