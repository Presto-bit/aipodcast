import type { FeatureCore } from "./homeComposerExpertTypes";
import type { HomeComposerPersonalProfile } from "./homeComposerTypes";

export type PersonalFieldDef = {
  label: string;
  placeholder: string;
  rows: number;
};

export type FeatureCoreFieldDef = PersonalFieldDef & {
  key: keyof FeatureCore;
};

export type PersonalSupplementFieldDef = PersonalFieldDef & {
  key: keyof HomeComposerPersonalProfile;
};

/** 「我的特色」核心三问（必填） */
export const FEATURE_CORE_FIELDS: FeatureCoreFieldDef[] = [
  {
    key: "who",
    label: "1. 用一句话说：你是谁，以及你常写（或想写）给谁看？",
    placeholder:
      "比如：前大厂产品经理，写给准备转行的小白；独立摄影师，写给想学构图的普通人；两个孩子的妈妈，写给同样焦虑的家长等",
    rows: 3
  },
  {
    key: "remember",
    label: "2. 你希望读者读完之后，对你留下什么印象或记住什么？",
    placeholder:
      "比如：务实不灌鸡汤、敢把踩坑讲透、说话犀利但有温度、专业靠谱但不端架子、总能给可执行的下一步等",
    rows: 3
  },
  {
    key: "avoid",
    label: "3. 写东西时，有哪些「绝对不要」的底线或雷区？",
    placeholder:
      "比如：不编造数据和案例、不做「一定赚」「速成」式承诺、不用 AI 腔和空洞套话、不硬蹭热点转折等",
    rows: 3
  }
];

/** 「我的特色」补充问项 — 折叠区展示，填了会更像本人 */
export const PERSONAL_SUPPLEMENT_FIELDS: PersonalSupplementFieldDef[] = [
  {
    key: "atypicalExperience",
    label: "4. 你的「反常态」经历是什么？",
    placeholder:
      "做过最酷、最离谱，或者绝大多数人没体验过的事。比如：曾骑行去西藏、参加过专业脱口秀演出、在国外当过志愿者等",
    rows: 3
  },
  {
    key: "lifeTurningPoint",
    label: "5. 哪一个决定或事件，彻底改变了你的人生轨迹？",
    placeholder:
      "比如从稳定体制内裸辞、经历过一次重大创业失败、搬到一个陌生的城市等，当时你的心情如何？",
    rows: 3
  },
  {
    key: "obsessivePassion",
    label: "6. 有没有哪件事，是你可以不计回报、废寝忘食去做的？",
    placeholder: "你的终极热爱或执念，比如收集黑胶唱片、钻研某种小众手艺、研究历史冷知识等",
    rows: 3
  },
  {
    key: "dailyRitual",
    label: "7. 你在日常生活中，有什么雷打不动的专属习惯吗？",
    placeholder: "比如每天清晨5点必须喝一杯冰美式、思考问题时喜欢转笔、写作时必须听特定的白噪音等",
    rows: 3
  },
  {
    key: "catchphrase",
    label: "8. 你平时最常说的口头禅或高频词是什么？",
    placeholder: "或者朋友们经常怎么形容你说话的风格？比如：犀利直白、温和治愈、喜欢用逻辑词等",
    rows: 3
  },
  {
    key: "sensoryMemory",
    label: "9. 有没有哪种味道、声音或画面，能瞬间勾起你的特定回忆？",
    placeholder: "比如一闻到下雨后的泥土味就会想起外婆家；一听到某首老歌就会想起高三的夏天",
    rows: 3
  },
  {
    key: "nonConsensusView",
    label: "10. 在你的行业或生活中，有什么观点是「大家都赞同，但你却坚决反对」的？",
    placeholder: "即你的「非共识」观点，这是拉开平庸文章差距的核心",
    rows: 3
  },
  {
    key: "impressionVsReality",
    label: "11. 别人对你的第一印象通常是什么？而真实的你又是怎样的？",
    placeholder: "用于打破偏见，制造人设的「反差萌」或深度。比如：外表看起来很冷酷，其实是个猫奴",
    rows: 3
  },
  {
    key: "professionalMindset",
    label: "12. 你的专业背景或长期爱好的领域，带给你什么独特的思维方式？",
    placeholder: "比如程序员看世界自带代码逻辑，学医的人看生活习惯更注重底层机理等",
    rows: 3
  },
  {
    key: "acceptedImperfection",
    label: "13. 有没有哪种不完美或软肋，是你已经坦然接受并和解的？",
    placeholder:
      "完美的人设往往无聊，敢于暴露脆弱才能打动人。比如：承认自己是个社交恐惧症、承认自己数学极差等",
    rows: 3
  },
  {
    key: "lowPointRecovery",
    label: "14. 当你陷入极度焦虑、低谷或迷茫时，你通常用什么方式让自己走出来？",
    placeholder: "你的自救指南。比如：独自去大吃一顿、疯狂跑步、躲在房间里睡一天等",
    rows: 3
  }
];

function promptLabel(label: string): string {
  return label.replace(/^\d+\.\s*/, "");
}

export function fieldPromptLabel(label: string): string {
  return promptLabel(label);
}

export function featureCorePromptLabel(key: keyof FeatureCore): string {
  const def = FEATURE_CORE_FIELDS.find((f) => f.key === key);
  return def ? promptLabel(def.label) : key;
}

export function personalSupplementPromptLabel(key: keyof HomeComposerPersonalProfile): string {
  const def = PERSONAL_SUPPLEMENT_FIELDS.find((f) => f.key === key);
  return def ? promptLabel(def.label) : key;
}

/** 老版 9 字段 → 新版 11 问项（localStorage / Author IP） */
export function normalizePersonalProfile(raw: unknown): HomeComposerPersonalProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const read = (key: string) => String(r[key] ?? "").trim();

  const profile: HomeComposerPersonalProfile = {
    atypicalExperience: read("atypicalExperience") || read("pastExperience"),
    lifeTurningPoint: read("lifeTurningPoint") || [read("choices"), read("results")].filter(Boolean).join("；"),
    obsessivePassion: read("obsessivePassion"),
    dailyRitual: read("dailyRitual"),
    catchphrase: read("catchphrase"),
    sensoryMemory: read("sensoryMemory"),
    nonConsensusView: read("nonConsensusView") || read("values"),
    impressionVsReality: read("impressionVsReality"),
    professionalMindset:
      read("professionalMindset") || [read("identity"), read("currentDoing")].filter(Boolean).join(" · "),
    acceptedImperfection: read("acceptedImperfection") || read("other"),
    lowPointRecovery: read("lowPointRecovery") || read("difficulties")
  };

  const hasAny = Object.values(profile).some(Boolean);
  return hasAny ? profile : null;
}

export const EMPTY_HOME_COMPOSER_PERSONAL: HomeComposerPersonalProfile = {
  atypicalExperience: "",
  lifeTurningPoint: "",
  obsessivePassion: "",
  dailyRitual: "",
  catchphrase: "",
  sensoryMemory: "",
  nonConsensusView: "",
  impressionVsReality: "",
  professionalMindset: "",
  acceptedImperfection: "",
  lowPointRecovery: ""
};
