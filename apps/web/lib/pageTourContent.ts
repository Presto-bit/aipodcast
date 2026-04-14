import type { Lang } from "./i18nDict";

export type PageTourStep = { title: string; body: string };

/** 每页独立 tourId，与 localStorage 完成标记对应；默认每 tour 只展示一次 */
export const PAGE_TOURS: Record<string, { zh: PageTourStep[]; en: PageTourStep[] }> = {
  home: {
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
  },
  notes: {
    zh: [
      {
        title: "知识库工作台",
        body: "先选择或新建笔记本，再添加笔记、网页或文件。勾选左侧笔记作为生成播客/长文时的资料来源。"
      },
      {
        title: "对话与索引",
        body: "右侧可与已选资料对话；新上传的笔记会建立向量索引，失败时卡片会提示，可稍后重试。"
      }
    ],
    en: [
      {
        title: "Notebook",
        body: "Pick or create a notebook, then add notes, URLs, or files. Tick notes on the left to use them as references."
      },
      {
        title: "Chat & index",
        body: "Ask questions on the right against selected notes. New notes get indexed; errors show on the card."
      }
    ]
  },
  create: {
    zh: [
      {
        title: "创作页",
        body: "在上方输入主题或正文，再在底栏选择「播客」或「文字转语音」展开参数与生成。"
      },
      {
        title: "资料库",
        body: "展开「资料库」可填网页链接、上传文件或从笔记单选一条作为引用；摘要会显示在正文框角标。"
      }
    ],
    en: [
      {
        title: "Create",
        body: "Enter your topic or script, then choose Podcast or TTS in the bar to open options and generate."
      },
      {
        title: "Library",
        body: "Open Library for URLs, file upload, or pick one note; a short summary appears near the draft box."
      }
    ]
  },
  works: {
    zh: [
      {
        title: "我的作品",
        body: "这里汇集播客、语音与笔记本相关成片。可试听、下载或跳转详情。"
      },
      {
        title: "进行中",
        body: "长任务无需停留在同一页；在「进行中」或任务详情查看排队与进度。"
      }
    ],
    en: [
      {
        title: "My works",
        body: "Podcast, TTS, and notebook outputs are listed here. Preview, download, or open details."
      },
      {
        title: "In progress",
        body: "Long jobs run in the background; check In progress or the job page for queue and status."
      }
    ]
  },
  subscription: {
    zh: [
      {
        title: "会员与套餐",
        body: "在此查看各档位权益与价格；升级后资料引用上限、时长等会按档位生效。"
      },
      {
        title: "订单与余额",
        body: "支付与钱包相关入口也在此页或「我的 → 订阅」；遇到问题可先看帮助页说明。"
      }
    ],
    en: [
      {
        title: "Plans",
        body: "Compare tiers and benefits; limits such as reference notes apply after you upgrade."
      },
      {
        title: "Orders",
        body: "Payments and wallet actions are here or under Me → Subscription."
      }
    ]
  },
  voice: {
    zh: [
      {
        title: "音色管理",
        body: "浏览预设音色、试听，或使用克隆生成专属音色（视套餐与后台开关而定）。"
      },
      {
        title: "与创作联动",
        body: "播客与配音页中的主音色、Speaker 选择与这里的能力一致。"
      }
    ],
    en: [
      {
        title: "Voices",
        body: "Browse presets, preview, or clone a voice depending on your plan and feature flags."
      },
      {
        title: "Used in create",
        body: "Podcast and TTS pick voices from the same voice library."
      }
    ]
  },
  podcast: {
    zh: [
      {
        title: "播客工作台",
        body: "填写主题或素材，配置双人/单人、时长与音色后提交；任务在后台排队执行。"
      },
      {
        title: "资料与成片",
        body: "可在资料库勾选笔记或链接；生成完成后在「我的作品」收听与分享。"
      }
    ],
    en: [
      {
        title: "Podcast studio",
        body: "Enter your topic, set mode, length, and voices, then submit; jobs run in the queue."
      },
      {
        title: "Sources & output",
        body: "Attach notes or URLs from Library; open My works when the episode is ready."
      }
    ]
  },
  tts: {
    zh: [
      {
        title: "文字转语音",
        body: "粘贴或输入正文，选择音色与可选开头结尾后生成音频。"
      },
      {
        title: "润色与套餐",
        body: "部分档位才支持完整链路 AI 润色；详见角标提示或订阅页说明。"
      }
    ],
    en: [
      {
        title: "Text to speech",
        body: "Paste your script, pick a voice and optional intro/outro, then synthesize."
      },
      {
        title: "Polish & plans",
        body: "Full AI polish may be limited by tier; see hints on the page or Plans."
      }
    ]
  },
  drafts: {
    zh: [
      {
        title: "草稿箱",
        body: "未完成或暂存的文稿可在此继续编辑后再提交生成。"
      }
    ],
    en: [
      {
        title: "Drafts",
        body: "Continue editing drafts here before sending them to generation."
      }
    ]
  },
  jobs: {
    zh: [
      {
        title: "创作记录",
        body: "查看历史任务状态、错误信息与结果链接；适合排查单次生成问题。"
      }
    ],
    en: [
      {
        title: "Job history",
        body: "Inspect past runs, errors, and links to outputs for troubleshooting."
      }
    ]
  },
  help: {
    zh: [
      {
        title: "帮助与支持",
        body: "快速上手、服务状态与条款摘要；复杂问题请附页面路径与操作步骤联系支持。"
      }
    ],
    en: [
      {
        title: "Help",
        body: "Getting started, status, and legal summaries; include the page path when contacting support."
      }
    ]
  },
  me: {
    zh: [
      {
        title: "我的",
        body: "个人资料、订阅与订单、通用设置等入口均在此分组。"
      },
      {
        title: "账号安全",
        body: "修改密码、邮箱等与账号相关的操作请在对应子页完成。"
      }
    ],
    en: [
      {
        title: "Me",
        body: "Profile, subscription, orders, and general settings are grouped here."
      },
      {
        title: "Security",
        body: "Change password or email on the relevant subpages."
      }
    ]
  }
};

export function stepsForTour(tourId: string, lang: Lang): PageTourStep[] {
  const pack = PAGE_TOURS[tourId];
  if (!pack) return [];
  return lang === "en" ? pack.en : pack.zh;
}
