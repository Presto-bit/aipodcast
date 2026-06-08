const OPS_SIGNAL =
  /运营|策略|涨粉|流量|算法|投放|转化|变现|引流|起号|养号|爆款|冷启动|人设|排期|首评|互动|矩阵|对标|复盘|小眼睛|收藏率|什么时候发|怎么推|推广方案|发布计划/;

export function isOpsStrategyQuestion(message: string): boolean {
  return OPS_SIGNAL.test(message.trim());
}

/** 无稿件时运营问句的 Cursor 式直答（带假设，不要求「画布稿件」） */
export function opsStrategyFallbackReply(message: string, taskSentence = ""): string {
  const task = taskSentence.trim();
  const isListicle = /清单|避坑|list/.test(`${message} ${task}`);
  const audience = /产品新人|新人/.test(`${message} ${task}`)
    ? "产品新人"
    : /职场|白领|打工人/.test(`${message} ${task}`)
      ? "职场读者"
      : "泛职场读者";

  const topicHint = task.slice(0, 40) || (isListicle ? "清单体干货" : "笔记主题");

  return [
    `假设：小红书笔记、面向**${audience}**、偏${isListicle ? "清单/干货" : "种草/干货"}体（不对可纠正）。`,
    "",
    "**发布时间**",
    "· 工作日晚 **20:00–22:00** 或午休 **12:00** 前后（刷手机高峰）",
    "· 首发后 **30 分钟内** 留 1 条首评，带一个具体问题引导评论",
    "",
    "**怎么推**",
    `· 话题：#${audience.replace(/读者|用户/, "")} #职场成长 + 1 个垂直词（与「${topicHint}」相关）`,
    "· 冷启动：发完 2h 内回复前 5 条评论；次日可发「续集/补充一条」做连载",
    isListicle
      ? "· 清单体优先用数字标题（如「3 个避坑」），首图大字突出数字"
      : "· 首图/标题决定点击：人群+痛点+结果，避免空泛词",
    "",
    "若要更贴你的稿：在下方补充成稿需求（主题+受众），我可以同步写稿并排期。"
  ].join("\n");
}
