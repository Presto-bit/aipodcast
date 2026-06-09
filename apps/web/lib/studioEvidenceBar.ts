/** Studio V2 — 标准化依据条 */

import { studioDomainLabel, studioFormatLabel, type StudioDomain, type StudioFormat } from "./studioDomainProfile";
import type { StudioWork } from "./studioWorkTypes";

export type StudioEvidenceBarInput = {
  domain?: StudioDomain;
  format?: StudioFormat;
  corpusCount?: number;
  taskSummary?: string;
  plannerReason?: string;
};

export type StudioEvidenceParts = {
  domainFormat: string;
  corpusLabel: string;
  corpusCount: number;
  taskSummary: string;
  plannerReason?: string;
};

export function parseEvidenceParts(input: StudioEvidenceBarInput): StudioEvidenceParts {
  const domain = input.domain ?? "general";
  const format = input.format ?? "general";
  const domainFormat =
    domain !== "general" || format !== "general"
      ? `${studioDomainLabel(domain)} · ${studioFormatLabel(format)}`
      : "通用 · 文稿";
  const n = input.corpusCount ?? 0;
  return {
    domainFormat,
    corpusLabel: n > 0 ? `资料 ${n}` : "资料 0",
    corpusCount: n,
    taskSummary: (input.taskSummary || "").trim(),
    plannerReason: input.plannerReason?.trim()
  };
}

export function evidencePartsFromWork(work: StudioWork, taskSummary?: string): StudioEvidenceParts {
  return parseEvidenceParts({
    domain: work.domain,
    format: work.format,
    corpusCount: work.binding?.noteIds?.length ?? 0,
    taskSummary: taskSummary ?? work.brief,
    plannerReason: work.lastPlannerReason
  });
}

export function buildStudioEvidenceBar(input: StudioEvidenceBarInput): string {
  const p = parseEvidenceParts(input);
  const parts = [p.domainFormat, p.corpusLabel];
  if (p.taskSummary) {
    parts.push(p.taskSummary.length > 48 ? `${p.taskSummary.slice(0, 48)}…` : p.taskSummary);
  }
  return parts.join(" · ");
}

export function evidenceBarFromWork(work: StudioWork, taskSummary?: string): string {
  return buildStudioEvidenceBar({
    domain: work.domain,
    format: work.format,
    corpusCount: work.binding?.noteIds?.length ?? 0,
    taskSummary: taskSummary ?? work.brief,
    plannerReason: work.lastPlannerReason
  });
}
