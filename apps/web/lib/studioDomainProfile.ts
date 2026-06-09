/** Studio V2 — 多领域写作 Profile（零配置推断 + 可 mid-run 纠正） */

export type StudioDomain =
  | "social"
  | "article"
  | "business"
  | "narrative"
  | "script"
  | "academic"
  | "general";

export type StudioFormat =
  | "short_post"
  | "long_form"
  | "listicle"
  | "email"
  | "tutorial"
  | "script_beats"
  | "summary"
  | "general";

export type StudioDomainProfile = {
  domain: StudioDomain;
  format: StudioFormat;
  label: string;
  formatLabel: string;
  /** 该 domain 可能出现的 meta 块 kind */
  metaKinds: Array<"hashtags" | "interaction" | "coverBrief">;
};

const PROFILES: Record<StudioDomain, Omit<StudioDomainProfile, "domain" | "format">> = {
  social: {
    label: "社交",
    formatLabel: "短文",
    metaKinds: ["hashtags", "coverBrief", "interaction"]
  },
  article: {
    label: "文章",
    formatLabel: "长文",
    metaKinds: ["interaction"]
  },
  business: {
    label: "商业",
    formatLabel: "邮件/提案",
    metaKinds: ["interaction"]
  },
  narrative: {
    label: "叙事",
    formatLabel: "故事",
    metaKinds: []
  },
  script: {
    label: "脚本",
    formatLabel: "口播/播客",
    metaKinds: ["interaction"]
  },
  academic: {
    label: "学术",
    formatLabel: "摘要",
    metaKinds: []
  },
  general: {
    label: "通用",
    formatLabel: "文稿",
    metaKinds: []
  }
};

export function studioDomainLabel(domain: StudioDomain): string {
  return PROFILES[domain]?.label ?? "通用";
}

export function studioFormatLabel(format: StudioFormat): string {
  const map: Record<StudioFormat, string> = {
    short_post: "短文",
    long_form: "长文",
    listicle: "清单",
    email: "邮件",
    tutorial: "教程",
    script_beats: "脚本",
    summary: "摘要",
    general: "文稿"
  };
  return map[format] ?? "文稿";
}

export function buildDomainProfile(
  domain: StudioDomain = "general",
  format: StudioFormat = "general"
): StudioDomainProfile {
  const base = PROFILES[domain] ?? PROFILES.general;
  return {
    domain,
    format,
    label: base.label,
    formatLabel: studioFormatLabel(format),
    metaKinds: base.metaKinds
  };
}

const DOMAIN_SIGNALS: Array<{ domain: StudioDomain; format?: StudioFormat; re: RegExp }> = [
  { domain: "social", format: "short_post", re: /小红书|种草|笔记|话题|hashtag|清单体|社交|帖子|thread/i },
  { domain: "article", format: "long_form", re: /科普|专栏|长文|教程|深度|1500|2000字/i },
  { domain: "business", format: "email", re: /邮件|客户|提案|复盘|商务|正式|对外/i },
  { domain: "narrative", format: "general", re: /故事|随笔|叙事|小说|经历/i },
  { domain: "script", format: "script_beats", re: /播客|口播|脚本|视频稿|分镜|beats/i },
  { domain: "academic", format: "summary", re: /摘要|文献|综述|论文|学术/i }
];

/** general · 文稿 视为「未选定」，不参与锁定 */
export function isUnsetDomain(domain?: StudioDomain, format?: StudioFormat): boolean {
  return (domain ?? "general") === "general" && (format ?? "general") === "general";
}

/** 从用户句推断 domain/format（零配置） */
export function inferDomainFromText(text: string): Pick<StudioDomainProfile, "domain" | "format"> {
  const q = text.trim();
  for (const sig of DOMAIN_SIGNALS) {
    if (sig.re.test(q)) {
      return { domain: sig.domain, format: sig.format ?? "general" };
    }
  }
  if (/清单|列表|几条/.test(q)) return { domain: "article", format: "listicle" };
  if (/写篇|写一篇|成稿|创作/.test(q)) return { domain: "general", format: "general" };
  return { domain: "general", format: "general" };
}

/** 用户纠偏 domain（显式或自然说法） */
export function parseDomainCorrection(text: string): Pick<StudioDomainProfile, "domain" | "format"> | null {
  const q = text.trim();
  if (/改成.*邮件|邮件语气|商务邮件|对客户|正式对外/.test(q)) {
    return { domain: "business", format: "email" };
  }
  if (/改成.*科普|科普长文|科普一点|教程体|按教程/.test(q)) {
    return { domain: "article", format: "tutorial" };
  }
  if (/改成.*小红书|社交|种草|小红书体|种草笔记|带话题/.test(q)) {
    return { domain: "social", format: "short_post" };
  }
  if (/改成.*播客|口播|脚本|视频稿/.test(q)) {
    return { domain: "script", format: "script_beats" };
  }
  if (/不要.*话题|不要.*hashtag|去掉标签/.test(q)) {
    return { domain: "article", format: "long_form" };
  }
  if (/不是小红书|非小红书/.test(q)) return { domain: "article", format: "long_form" };
  return null;
}

export type ResolveStudioDomainInput = {
  /** work 上存的上一轮 hint，非锁定值 */
  hint?: { domain?: StudioDomain; format?: StudioFormat };
  userMessage: string;
  /** 累积任务句（优先于单句推断） */
  taskText?: string;
  /** 有成稿且在改版：保持 hint，避免改篇幅时误切 domain */
  hasManuscript?: boolean;
};

/**
 * 每轮请求内解析 domain/format；不在 work 上早锁。
 * 顺序：纠偏句 →（有稿）hint → 从 task/消息推断 → hint 兜底。
 */
export function resolveStudioDomainContext(
  params: ResolveStudioDomainInput
): { domain: StudioDomain; format: StudioFormat } {
  const correction = parseDomainCorrection(params.userMessage);
  if (correction) return correction;

  if (params.hasManuscript) {
    return {
      domain: params.hint?.domain ?? "general",
      format: params.hint?.format ?? "general"
    };
  }

  for (const text of [params.taskText, params.userMessage].filter(Boolean) as string[]) {
    const inferred = inferDomainFromText(text);
    if (!isUnsetDomain(inferred.domain, inferred.format)) {
      return inferred;
    }
  }

  return {
    domain: params.hint?.domain ?? "general",
    format: params.hint?.format ?? "general"
  };
}

/** 成稿/改版成功后写回 hint（供 revise 兜底与卡片展示） */
export function applyDomainHint(
  work: { domain?: StudioDomain; format?: StudioFormat },
  ctx: { domain: StudioDomain; format: StudioFormat }
): { domain: StudioDomain; format: StudioFormat } {
  if (isUnsetDomain(ctx.domain, ctx.format)) return work as { domain: StudioDomain; format: StudioFormat };
  return { domain: ctx.domain, format: ctx.format };
}

/** @deprecated 使用 resolveStudioDomainContext */
export function mergeDomainContext(
  current: { domain?: StudioDomain; format?: StudioFormat },
  userMessage: string
): { domain: StudioDomain; format: StudioFormat } {
  return resolveStudioDomainContext({ hint: current, userMessage });
}
