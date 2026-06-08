/** Cursor 式 brief 澄清：温和文案 + 可点选补全 chips */

export type StudioBriefClarifyTurn = {
  content: string;
  suggestedReplies: string[];
};

type BriefGap = "topic" | "audience" | "sellPoint" | "scene";

function detectBriefGaps(text: string): Set<BriefGap> {
  const gaps = new Set<BriefGap>();
  if (!text.trim()) {
    gaps.add("topic");
    gaps.add("audience");
    return gaps;
  }
  if (!/清单|教程|测评|故事|攻略|笔记|周报|总结|推广|种草|体|文章|内容/.test(text)) {
    gaps.add("topic");
  }
  if (!/受众|人群|读者|新人|白领|职场|学生|同行|买家|用户/.test(text)) {
    gaps.add("audience");
  }
  if (/推广|种草|带货|水杯|杯子|产品|新品|卖点/.test(text) && !/卖点|功能|材质|主打|差异化|保温|提醒/.test(text)) {
    gaps.add("sellPoint");
  }
  if (/推广|种草|带货/.test(text) && !/场景|办公室|通勤|桌面|使用/.test(text)) {
    gaps.add("scene");
  }
  return gaps;
}

function chipExamples(gaps: Set<BriefGap>, userMessage: string): string[] {
  const chips: string[] = [];
  const isListicle = /清单|list|几条|避坑/.test(userMessage);

  if (gaps.has("audience")) {
    chips.push("受众：产品新人");
    chips.push("受众：职场白领");
  }
  if (gaps.has("sellPoint")) {
    chips.push("卖点：6 小时保温，一键开盖");
  }
  if (gaps.has("scene")) {
    chips.push("场景：办公室桌面提醒喝水");
  }
  if (gaps.has("topic")) {
    chips.push(isListicle ? "主题：onboarding 避坑清单" : "主题：产品新人成长干货");
  }

  chips.push(
    isListicle
      ? "给产品新人，清单体讲 3 个 onboarding 避坑"
      : "给产品新人，清单体讲 3 个避坑，主题是 xxx"
  );
  return [...new Set(chips)].slice(0, 5);
}

/** 模板/空稿失败 → 助手追问 + chips（不设 work.error） */
export function buildStudioBriefClarifyTurn(
  reason: "template" | "empty" = "template",
  userMessage = "",
  taskSentence = ""
): StudioBriefClarifyTurn {
  const context = [userMessage, taskSentence].filter(Boolean).join("\n");
  const gaps = detectBriefGaps(context);
  const suggestedReplies = chipExamples(gaps, context);

  if (reason === "empty") {
    return {
      content: [
        "还缺一点具体信息才能写稳。补下面 **1～2 项** 即可（点选或自己输入）：",
        "",
        gaps.has("topic") ? "· **主题**：这篇讲什么？" : "",
        gaps.has("audience") ? "· **受众**：给谁看？" : "",
        gaps.has("sellPoint") ? "· **卖点**：核心卖点是什么？" : "",
        gaps.has("scene") ? "· **场景**：在什么场景种草？" : "",
        "",
        "也可直接一句说完，例如：「给产品新人，清单体讲 3 个 onboarding 避坑」"
      ]
        .filter(Boolean)
        .join("\n"),
      suggestedReplies
    };
  }

  return {
    content: [
      "这版还偏泛，我需要更具体的 brief 才能写好。补 **1～2 项** 就行：",
      "",
      gaps.has("audience") ? "· **受众**（如产品新人、职场白领）" : "",
      gaps.has("sellPoint") ? "· **卖点**（如功能、差异化）" : "",
      gaps.has("scene") ? "· **场景**（如 onboarding、办公室）" : "",
      gaps.has("topic") ? "· **主题**（这篇核心讲什么）" : "",
      "",
      "点下方快捷补全，或直接回复一句完整 brief。"
    ]
      .filter(Boolean)
      .join("\n"),
    suggestedReplies
  };
}
