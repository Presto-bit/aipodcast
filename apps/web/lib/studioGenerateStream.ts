/** 将 Job 进度映射为写稿输出流文案（给用户感知「正在写什么」） */
export function phaseToGenerateStreamLine(phase: string): string {
  const p = phase.trim();
  if (!p) return "准备根据你的需求撰写笔记…";
  if (/检索|资料/.test(p)) return "检索资料，提取与产品相关的要点…";
  if (/撰写|正文|内容成品/.test(p)) return "撰写标题与正文，围绕任务中的产品卖点展开…";
  if (/优化|模板|重写/.test(p)) return "优化文稿，避免通用模板化表述…";
  if (/润色|标题|钩子|锚点/.test(p)) return "润色标题与开头钩子…";
  if (/即将|完成/.test(p)) return "整理成稿，即将完成…";
  if (/写稿|处理/.test(p)) return "正在生成小红书笔记正文…";
  return p;
}

/** Cursor 式推广 brief 澄清：结构化追问 */
export function promoBriefClarifyText(): string {
  return [
    "要写清这篇笔记，还需要补充：",
    "",
    "· **受众**：给谁看？（如职场白领、学生党）",
    "· **卖点**：产品核心卖点？（如 6 小时保温、一键开盖）",
    "· **场景**：在什么场景种草？（如办公桌、通勤路上）",
    "",
    "可直接回复一句，例如：「给上班族，主打 6 小时保温，办公室桌面场景」"
  ].join("\n");
}
