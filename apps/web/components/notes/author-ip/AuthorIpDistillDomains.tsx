"use client";

import type { AuthorIpDomain } from "../../../lib/authorIp";

type Props = {
  domains: AuthorIpDomain[];
};

export default function AuthorIpDistillDomains({ domains }: Props) {
  if (domains.length === 0) {
    return (
      <p className="px-2 text-xs text-muted">深度学习后将归纳写作场景（如测评种草、教程清单）。</p>
    );
  }

  return (
    <div className="space-y-2 px-2">
      <p className="text-xs font-medium text-muted">写作场景</p>
      <ul className="space-y-2">
        {domains.map((d, i) => {
          const name = (d.displayName || `场景 ${i + 1}`).trim();
          const arts = d.boundArticleTitles ?? [];
          const exps = d.boundExperienceTemplates ?? [];
          return (
            <li key={`${name}-${i}`} className="rounded-lg border border-line/60 bg-surface/80 px-2.5 py-2">
              <p className="text-sm font-medium text-ink">{name}</p>
              {arts.length > 0 ? (
                <p className="mt-1 text-[10px] text-muted line-clamp-2" title={arts.join("、")}>
                  绑定成稿：{arts.slice(0, 2).join("、")}
                  {arts.length > 2 ? ` 等 ${arts.length} 篇` : ""}
                </p>
              ) : null}
              {exps.length > 0 ? (
                <p className="mt-0.5 text-[10px] text-muted">绑定经历：{exps.join("、")}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
