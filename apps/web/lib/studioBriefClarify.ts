/** Cursor 式 brief 澄清：温和文案 + 可点选补全 chips */

import { isInsufficientBrief } from "./studioOrchestrator";

export type StudioBriefClarifyTurn = {
  content: string;
  suggestedReplies: string[];
};

export const STUDIO_COMPOSE_RETRY_CHIP = "再试一次";

type BriefGap = "topic" | "audience" | "sellPoint" | "scene";

function isPromoBrief(text: string): boolean {
  return (
    /推广|种草|带货/.test(text) ||
    (/水杯|杯子|保温杯|产品|新品/.test(text) && /小红书|笔记|写篇|写一篇|推广/.test(text))
  );
}

function detectBriefGaps(text: string): Set<BriefGap> {
  const gaps = new Set<BriefGap>();
  if (!text.trim()) {
    gaps.add("topic");
    gaps.add("audience");
    return gaps;
  }
  const promo = isPromoBrief(text);
  if (!promo && !/清单|教程|测评|故事|攻略|笔记|周报|总结|体|文章|内容/.test(text)) {
    gaps.add("topic");
  }
  if (!/受众|人群|读者|新人|白领|职场|女性|男性|学生|同行|买家|用户/.test(text)) {
    gaps.add("audience");
  }
  if (promo && !/卖点|功能|材质|主打|差异化|保温|提醒|一键|便携/.test(text)) {
    gaps.add("sellPoint");
  }
  if (promo && !/场景|办公室|通勤|桌面|工位|使用|开会|久坐/.test(text)) {
    gaps.add("scene");
  }
  return gaps;
}

function chipExamples(gaps: Set<BriefGap>, userMessage: string): string[] {
  const chips: string[] = [];
  const promo = isPromoBrief(userMessage);
  const isListicle = /清单|list|几条|避坑/.test(userMessage);

  if (promo) {
    if (gaps.has("audience")) {
      chips.push("受众：职场白领");
      chips.push("受众：通勤上班族");
    }
    if (gaps.has("sellPoint")) {
      chips.push("卖点：6 小时保温，一键开盖");
      chips.push("卖点：定时提醒喝水");
    }
    if (gaps.has("scene")) {
      chips.push("场景：办公室桌面提醒喝水");
      chips.push("场景：工位久坐忘喝水");
    }
    if (gaps.has("topic") && !gaps.has("sellPoint")) {
      chips.push("主题：职场补水好物");
    }
    return [...new Set(chips)].slice(0, 4);
  }

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

  if (isListicle) {
    chips.push("给产品新人，清单体讲 3 个 onboarding 避坑");
  }
  return [...new Set(chips)].slice(0, 5);
}

function withRetryChip(
  suggestedReplies: string[],
  context: string,
  opts?: { alwaysRetry?: boolean }
): string[] {
  const out = [...suggestedReplies];
  const shouldOfferRetry =
    opts?.alwaysRetry ||
    (context.trim().length >= 8 && !isInsufficientBrief(context)) ||
    context.trim().length >= 8;
  if (shouldOfferRetry && !out.includes(STUDIO_COMPOSE_RETRY_CHIP)) {
    out.unshift(STUDIO_COMPOSE_RETRY_CHIP);
  }
  return out.slice(0, 6);
}

/** 模板/空稿失败且 brief 仍不足 → 追问 + chips */
export function buildStudioBriefClarifyTurn(
  reason: "template" | "empty" = "template",
  userMessage = "",
  taskSentence = ""
): StudioBriefClarifyTurn {
  const context = [userMessage, taskSentence].filter(Boolean).join("\n");
  const gaps = detectBriefGaps(context);
  const suggestedReplies = withRetryChip(chipExamples(gaps, context), context);

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
        "也可点「再试一次」，我先按现有内容试写。"
      ]
        .filter(Boolean)
        .join("\n"),
      suggestedReplies
    };
  }

  return {
    content: [
      "还缺一点具体信息才能写稳。补 **1～2 项** 即可：",
      "",
      gaps.has("audience") ? "· **受众**（如职场女性、产品新人）" : "",
      gaps.has("sellPoint") ? "· **卖点**（如定时提醒、保温时长）" : "",
      gaps.has("scene") ? "· **场景**（如办公室桌面、通勤）" : "",
      gaps.has("topic") ? "· **主题**（这篇核心讲什么）" : "",
      "",
      "点下方快捷补全；信息已够也可直接点「再试一次」。"
    ]
      .filter(Boolean)
      .join("\n"),
    suggestedReplies
  };
}

/** 初稿已落画布但偏模板 → 非 blocking 提示 + 改版/重写 chips */
export function buildStudioRewriteClarifyTurn(
  userMessage = "",
  taskSentence = ""
): StudioBriefClarifyTurn {
  const context = [taskSentence, userMessage].filter(Boolean).join("\n");
  const gaps = detectBriefGaps(context);
  const optional = chipExamples(gaps, context).slice(0, 2);
  const reviseChips = ["改开头更痛点", "再优化一版"];
  const suggestedReplies = withRetryChip(
    [...reviseChips, ...optional],
    context,
    { alwaysRetry: true }
  );

  return {
    content: [
      "初稿已在上方稿件区，可直接改。若觉得略偏模板，可以：",
      "",
      "· 在下方说 **改开头更痛点** / **再优化一版**",
      optional.length ? optional.map((c) => `· 或补 ${c}`).join("\n") : "",
      "",
      "也可点 **再试一次** 整稿重写。"
    ]
      .filter(Boolean)
      .join("\n"),
    suggestedReplies
  };
}
