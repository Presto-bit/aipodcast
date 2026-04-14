import type { Lang } from "./i18nDict";

export type PageTourStep = { title: string; body: string };

/** 全局新手指引步骤（与路由无关，全站仅展示一次） */
const GLOBAL_ONBOARDING: { zh: PageTourStep[]; en: PageTourStep[] } = {
  zh: [
    {
      title: "欢迎",
      body: "这是你的语音与播客工作台。侧栏可在知识库、创作播客、作品与订阅之间切换。"
    },
    {
      title: "推荐路径",
      body: "先在知识库整理素材，再在创作页生成播客或配音；成片与队列在「我的作品」查看。"
    },
    {
      title: "套餐与用量",
      body: "部分能力随会员档位变化（如资料引用条数）。侧栏「订阅」可查看与升级。"
    }
  ],
  en: [
    {
      title: "Welcome",
      body: "This is your voice and podcast studio. Use the sidebar to switch between Notebook, Create, Works, and Plans."
    },
    {
      title: "Suggested flow",
      body: "Gather sources in Notebook, then create a podcast or TTS on the Create page; finished pieces and queues live under Works."
    },
    {
      title: "Plans",
      body: "Some limits depend on your tier (e.g. reference note count). Open Subscribe in the sidebar to view or upgrade."
    }
  ]
};

export function globalOnboardingSteps(lang: Lang): PageTourStep[] {
  return lang === "en" ? GLOBAL_ONBOARDING.en : GLOBAL_ONBOARDING.zh;
}
