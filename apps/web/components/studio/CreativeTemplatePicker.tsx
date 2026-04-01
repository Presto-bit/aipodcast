"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { mergeCreativeTemplateSelectOptions } from "../../lib/creativeTemplates";

type CreativeTemplatePickerProps = {
  /** `sys:<id>` / `usr:<id>`，与 mergeCreativeTemplateSelectOptions 一致 */
  value: string;
  onChange: (templateValue: string) => void;
  /** 模板管理页链接 */
  manageHref?: string;
};

export default function CreativeTemplatePicker({
  value,
  onChange,
  manageHref = "/notes/templates"
}: CreativeTemplatePickerProps) {
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    const onFocus = () => setEpoch((n) => n + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const templateSelectGroups = useMemo(() => {
    void epoch;
    const merged = mergeCreativeTemplateSelectOptions();
    const byGroup = new Map<string, typeof merged>();
    for (const o of merged) {
      const g = o.group;
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(o);
    }
    return Array.from(byGroup.entries());
  }, [epoch]);

  return (
    <div className="mb-3 rounded-lg border border-line bg-fill/70 p-2.5">
      <p className="mb-1.5 text-xs font-medium text-ink">加入创意</p>
      <p className="mb-2 text-[11px] leading-snug text-muted">
        从默认或自定义方案中选择一套脚本风格与人设。需在
        <Link href={manageHref} className="text-brand underline hover:text-brand/80">
          加入创意管理
        </Link>
        保存自定义方案。
      </p>
      <select
        className="w-full rounded-lg border border-line bg-surface px-2 py-2 text-xs text-ink"
        aria-label="选择加入创意方案"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {templateSelectGroups.map(([group, items]) => (
          <optgroup key={group} label={group}>
            {items.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
