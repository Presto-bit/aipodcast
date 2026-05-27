/** 笔记本写作风格 → 播客「人设风格」用户模板（learn 后同步） */
import type { AuthorIpItem } from "./authorIp";
import {
  DEFAULT_CREATIVE_SCRIPT_STYLE,
  DEFAULT_CREATIVE_SPEAKER1,
  DEFAULT_CREATIVE_SPEAKER2,
  USER_PERSONA_STYLE_CATEGORY
} from "./creativeTemplates";
import { DEFAULT_SCRIPT_CONSTRAINTS } from "./podcastStudioCommon";
import { buildNotebookStylePromptBlock } from "./notebookStyle";
import { addUserTemplate, listUserTemplates, updateUserTemplate } from "./userTemplates";
import { readLocalStorageScoped, writeLocalStorageScoped } from "./userScopedStorage";

const NOTEBOOK_CREATIVE_VALUE_PREFIX = "presto_nb_creative_tpl:";

/** 与 IP 绑定的稳定用户模板 id（usr: 前缀在 value 中拼接） */
export function notebookCreativeTemplateId(authorIpId: string): string {
  return `nb_style_${String(authorIpId || "").replace(/-/g, "")}`;
}

function storageKeyForNotebook(notebookName: string): string {
  return `${NOTEBOOK_CREATIVE_VALUE_PREFIX}${notebookName.trim()}`;
}

export function readNotebookCreativeTemplateValue(notebookName: string): string | null {
  const raw = readLocalStorageScoped(storageKeyForNotebook(notebookName));
  const v = (raw || "").trim();
  return v.startsWith("usr:") ? v : null;
}

function writeNotebookCreativeTemplateValue(notebookName: string, templateValue: string): void {
  writeLocalStorageScoped(storageKeyForNotebook(notebookName), templateValue);
}

/**
 * learn 成功后 upsert 用户人设模板，并记录本笔记本默认选中项。
 * @returns `usr:<templateId>` 供 CreativeTemplatePicker 使用
 */
export function syncPodcastCreativeFromAuthorIp(
  notebookName: string,
  item: AuthorIpItem
): string | null {
  const nb = notebookName.trim();
  const ipId = String(item.id || "").trim();
  if (!nb || !ipId) return null;

  const id = notebookCreativeTemplateId(ipId);
  const one = (item.oneLiner || "").trim();
  const prompt = buildNotebookStylePromptBlock(item);
  const name = (item.displayName || nb).trim().slice(0, 28);
  const label = name.startsWith("本笔记本风格") ? name : `本笔记本风格 · ${name}`;

  const row = {
    id,
    label,
    category: USER_PERSONA_STYLE_CATEGORY,
    description: one || "从当前笔记本资料提炼的写作风格",
    textPrefix: prompt.slice(0, 600),
    scriptStyle: prompt.split("\n")[0]?.slice(0, 240) || DEFAULT_CREATIVE_SCRIPT_STYLE,
    speaker1Persona: one ? `主持人 · ${one.slice(0, 120)}` : DEFAULT_CREATIVE_SPEAKER1,
    speaker2Persona: one ? "评论员 · 本笔记本风格" : DEFAULT_CREATIVE_SPEAKER2,
    scriptConstraints: DEFAULT_SCRIPT_CONSTRAINTS
  };

  const exists = listUserTemplates().some((t) => t.id === id);
  if (exists) updateUserTemplate(id, row);
  else addUserTemplate(row);

  const value = `usr:${id}`;
  writeNotebookCreativeTemplateValue(nb, value);
  return value;
}

export function resolveNotebookCreativeTemplateValue(
  notebookName: string,
  item: AuthorIpItem | null
): string | null {
  const stored = readNotebookCreativeTemplateValue(notebookName);
  if (stored) return stored;
  if (item?.id) {
    const id = notebookCreativeTemplateId(item.id);
    if (listUserTemplates().some((t) => t.id === id)) return `usr:${id}`;
  }
  return null;
}
