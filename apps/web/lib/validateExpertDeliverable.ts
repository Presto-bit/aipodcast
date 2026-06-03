import type {
  ExpertDeliverable,
  ExpertValidationResult,
  PlatformExpertId,
  XhsContent
} from "./homeComposerExpertTypes";

const EXPERT_IDS: PlatformExpertId[] = ["xhs_ops", "mp_ops", "voice_gen", "podcast_plan"];
const COVERAGE = new Set(["full", "partial", "none"]);
const OPS_TIERS = new Set(["must_do", "nice_to_have", "after_publish"]);

function isObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function nonEmptyString(v: unknown, path: string, errors: string[]): v is string {
  if (typeof v !== "string" || !v.trim()) {
    errors.push(`${path} 须为非空字符串`);
    return false;
  }
  return true;
}

function validateOpsPlaybook(ops: unknown, expertId: PlatformExpertId, errors: string[]): void {
  if (!isObject(ops)) {
    errors.push("ops 须为对象");
    return;
  }
  if (ops.expertId !== expertId) {
    errors.push("ops.expertId 须与 expertId 一致");
  }
  if (!Array.isArray(ops.steps) || ops.steps.length === 0) {
    errors.push("ops.steps 须为非空数组");
    return;
  }
  for (let i = 0; i < ops.steps.length; i++) {
    const step = ops.steps[i];
    const prefix = `ops.steps[${i}]`;
    if (!isObject(step)) {
      errors.push(`${prefix} 须为对象`);
      continue;
    }
    if (typeof step.stepNo !== "number" || step.stepNo < 1) errors.push(`${prefix}.stepNo 无效`);
    nonEmptyString(step.title, `${prefix}.title`, errors);
    nonEmptyString(step.objective, `${prefix}.objective`, errors);
    if (!Array.isArray(step.actions) || step.actions.length === 0) {
      errors.push(`${prefix}.actions 须为非空数组`);
    }
    if (!OPS_TIERS.has(String(step.tier))) errors.push(`${prefix}.tier 无效`);
    if (typeof step.defaultExpanded !== "boolean") errors.push(`${prefix}.defaultExpanded 须为 boolean`);
  }
  if (typeof ops.recapStepNo !== "number" || ops.recapStepNo < 1) {
    errors.push("ops.recapStepNo 无效");
  }
}

function validateXhsContent(content: unknown, errors: string[]): void {
  if (!isObject(content)) {
    errors.push("content 须为对象");
    return;
  }
  if (!Array.isArray(content.titles) || content.titles.length === 0) {
    errors.push("content.titles 须为非空数组");
  }
  nonEmptyString(content.body, "content.body", errors);
  if (!Array.isArray(content.hashtags)) errors.push("content.hashtags 须为数组");
  const cover = content.cover;
  if (!isObject(cover)) {
    errors.push("content.cover 须为对象");
    return;
  }
  nonEmptyString(cover.headline, "content.cover.headline", errors);
  if (!Array.isArray(cover.slides) || cover.slides.length === 0) {
    errors.push("content.cover.slides 须为非空数组");
  }
}

function validateMeta(meta: unknown, errors: string[]): void {
  if (!isObject(meta)) {
    errors.push("meta 须为对象");
    return;
  }
  if (!Array.isArray(meta.rationale) || meta.rationale.length === 0) {
    errors.push("meta.rationale 须为非空数组");
  }
  nonEmptyString(meta.expectedEffect, "meta.expectedEffect", errors);
  nonEmptyString(meta.playbookVersion, "meta.playbookVersion", errors);
  const prov = meta.provenance;
  if (!isObject(prov) || !COVERAGE.has(String(prov.corpusCoverage))) {
    errors.push("meta.provenance.corpusCoverage 无效");
  }
}

/**
 * 校验 ExpertDeliverable JSON（P0 红书路径为主；其他专家做基础字段检查）。
 */
export function validateExpertDeliverable(raw: unknown): ExpertValidationResult {
  const errors: string[] = [];
  if (!isObject(raw)) {
    return { ok: false, errors: ["根节点须为对象"] };
  }

  const expertId = raw.expertId;
  if (!EXPERT_IDS.includes(expertId as PlatformExpertId)) {
    errors.push("expertId 无效");
    return { ok: false, errors };
  }

  const id = expertId as PlatformExpertId;
  if (id === "xhs_ops") {
    validateXhsContent(raw.content, errors);
  } else if (id === "mp_ops") {
    const c = raw.content;
    if (!isObject(c)) errors.push("content 须为对象");
    else {
      nonEmptyString(c.title, "content.title", errors);
      nonEmptyString(c.summary, "content.summary", errors);
      nonEmptyString(c.bodyMarkdown, "content.bodyMarkdown", errors);
    }
  }

  validateOpsPlaybook(raw.ops, id, errors);
  validateMeta(raw.meta, errors);

  if (errors.length) return { ok: false, errors };
  return { ok: true };
}

export function parseExpertDeliverable(raw: unknown): ExpertDeliverable | null {
  const result = validateExpertDeliverable(raw);
  if (!result.ok) return null;
  return raw as ExpertDeliverable;
}

/** 单测 / 自检用样例 */
export function sampleXhsDeliverable(): ExpertDeliverable {
  const content: XhsContent = {
    titles: ["复盘 3 个坑，产品人必看"],
    body: "上线前以为功能齐就能发…",
    hashtags: ["产品复盘", "AI创作"],
    cover: {
      headline: "3 个坑",
      layout: "text_center",
      slides: [{ role: "cover", description: "大字封面" }]
    }
  };
  return {
    expertId: "xhs_ops",
    content,
    ops: {
      expertId: "xhs_ops",
      recapStepNo: 7,
      steps: [
        {
          stepNo: 1,
          title: "做图",
          objective: "准备封面",
          actions: ["打开醒图", "按 cover 规格排版"],
          tier: "must_do",
          defaultExpanded: true
        }
      ]
    },
    meta: {
      rationale: ["面向产品新人，清单体更易读"],
      expectedEffect: "提升收藏与评论",
      provenance: { corpusCoverage: "partial" },
      playbookVersion: "xhs_ops@1"
    }
  };
}

export function assertValidateExpertDeliverableSelfTest(): void {
  const sample = sampleXhsDeliverable();
  const ok = validateExpertDeliverable(sample);
  if (!ok.ok) {
    throw new Error(`sample deliverable should pass: ${ok.errors.join("; ")}`);
  }
  const bad = validateExpertDeliverable({ expertId: "xhs_ops" });
  if (bad.ok) {
    throw new Error("incomplete deliverable should fail");
  }
}
