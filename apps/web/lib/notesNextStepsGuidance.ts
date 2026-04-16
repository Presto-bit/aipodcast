import { readLocalStorageScoped, writeLocalStorageScoped } from "./userScopedStorage";

const STORAGE_KEY = "notes:next-steps:v1";

type NotebookGuidancePersist = {
  /** 再次进入笔记本时顶部提示「可以试试」 */
  returnBar?: boolean;
};

type GuidanceRoot = {
  v: 1;
  byNotebook: Record<string, NotebookGuidancePersist>;
};

function parseRoot(): GuidanceRoot {
  try {
    const raw = readLocalStorageScoped(STORAGE_KEY);
    if (!raw) return { v: 1, byNotebook: {} };
    const o = JSON.parse(raw) as Partial<GuidanceRoot>;
    if (o?.v !== 1 || typeof o.byNotebook !== "object" || o.byNotebook === null) {
      return { v: 1, byNotebook: {} };
    }
    return { v: 1, byNotebook: o.byNotebook as Record<string, NotebookGuidancePersist> };
  } catch {
    return { v: 1, byNotebook: {} };
  }
}

function writeRoot(root: GuidanceRoot) {
  writeLocalStorageScoped(STORAGE_KEY, JSON.stringify(root));
}

export function readNotesReturnBarActive(notebook: string): boolean {
  const nb = notebook.trim();
  if (!nb) return false;
  return Boolean(parseRoot().byNotebook[nb]?.returnBar);
}

export function setNotesReturnBarActive(notebook: string, active: boolean) {
  const nb = notebook.trim();
  if (!nb) return;
  const root = parseRoot();
  const prev = root.byNotebook[nb] || {};
  root.byNotebook[nb] = { ...prev, returnBar: active };
  writeRoot(root);
}

export function clearNotesReturnBar(notebook: string) {
  setNotesReturnBarActive(notebook, false);
}

export type NotesGuidanceKind = "fragments" | "single" | "webheavy" | "default";

export function inferNotesGuidanceKind(
  meta: { noteCount: number; sourceCount: number } | null | undefined
): NotesGuidanceKind {
  const n = Math.max(0, Math.floor(meta?.noteCount ?? 0));
  const s = Math.max(0, Math.floor(meta?.sourceCount ?? 0));
  if (n >= 8) return "fragments";
  if (n <= 2) return "single";
  if (n >= 3 && s / Math.max(n, 1) >= 0.45) return "webheavy";
  return "default";
}

export function guidanceTipForKind(kind: NotesGuidanceKind): string {
  switch (kind) {
    case "fragments":
      return "资料条数较多：建议先「问资料」合并主线，再生成播客或长文，避免内容散。";
    case "single":
      return "当前笔记本里篇数不多：适合单篇深挖，或直接生成一集口播大纲。";
    case "webheavy":
      return "链接剪藏较多：建议先让 AI 做要点摘要，再选体裁生成播客。";
    default:
      return "资料已就绪：下面选一种最省事的下一步即可。";
  }
}

export const NOTES_GUIDANCE_DEFAULT_OUTLINE_PROMPT =
  "请根据已选资料输出一集可直接口播的结构化大纲：开场钩子、3–5 个要点、小结与行动建议。语气口语化，适合双人播客录制。";

export const NOTES_GUIDANCE_ASK_DIGEST =
  "这些资料主要在讲什么？请用 5 条要点概括，并指出最适合做成播客口播的一个切入角度（一句话）。";

export const NOTES_GUIDANCE_ASK_STRUCTURE =
  "把资料整理成「开场约 30 秒 + 3 个板块 + 结尾行动召唤」的口播结构，只输出各级标题与每段一句话提示即可。";

/** 「类似资料常做」模板：读书笔记向 */
export const NOTES_GUIDANCE_TEMPLATE_READING =
  "把资料当成一本书：请写「约 3 分钟讲书口播」结构（开场引子 + 三个核心观点 + 一句推荐语），只列各级标题与每段一句提示。";

/** 「类似资料常做」模板：访谈提纲 */
export const NOTES_GUIDANCE_TEMPLATE_INTERVIEW =
  "把资料改写成一次访谈的问题清单：5 个暖场问 + 8 个深度追问 + 2 个收束总结问。只输出问题本身。";

/** 「类似资料常做」模板：争议梳理 */
export const NOTES_GUIDANCE_TEMPLATE_DEBATE =
  "请从资料中提炼一个可讨论议题：列出正反双方各三条论据，再给一段中立小结（各不超过两句话）。";
