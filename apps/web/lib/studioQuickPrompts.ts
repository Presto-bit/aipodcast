import type { StudioDomain } from "./studioDomainProfile";

const BY_DOMAIN: Record<StudioDomain, string[]> = {
  article: [
    "写一篇科普短文，受众是产品经理",
    "帮我搭一个教程大纲，主题是数据库索引",
    "把下面要点扩写成 800 字专栏"
  ],
  business: [
    "写一封正式的延期说明邮件给客户",
    "帮我写一份项目复盘，侧重风险与改进",
    "润色这段对外提案，语气更专业"
  ],
  script: [
    "写一段 3 分钟播客口播，主题是 AI 工具",
    "帮我把提纲改成视频分镜脚本",
    "口播语气更口语、节奏更快"
  ],
  narrative: [
    "写一个职场小故事，有转折",
    "随笔风格，写一次失败经历带来的收获",
    "第一人称，语气真诚克制"
  ],
  academic: [
    "写一段文献综述摘要，300 字",
    "帮我把研究结论改写成通俗版",
    "列出三个核心论点并展开"
  ],
  social: [
    "写一条清单体帖子，给产品新人",
    "种草文案，突出一个差异化卖点",
    "标题更抓人，正文别改"
  ],
  general: [
    "描述想写什么，我会先出一版再迭代",
    "帮我理清结构：开头、主体、结尾",
    "选中段落后说怎么改更简洁"
  ]
};

export function studioQuickPrompts(domain: StudioDomain | undefined): string[] {
  return BY_DOMAIN[domain ?? "general"] ?? BY_DOMAIN.general;
}
