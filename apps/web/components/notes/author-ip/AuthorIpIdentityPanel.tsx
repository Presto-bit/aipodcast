"use client";

import { IconUser } from "../../icons";
import type { AuthorIpItem } from "../../../lib/authorIp";
import IdentityRing from "./IdentityRing";
import { positioningProgress } from "./utils";

type Props = {
  item: AuthorIpItem;
  onEdit: () => void;
};

export default function AuthorIpIdentityPanel({ item, onEdit }: Props) {
  const prof = item.profile as { coldStart?: { whoAmI?: string; audience?: string } };
  const progress = positioningProgress(item);
  const who = (prof.coldStart?.whoAmI || "").trim();
  const aud = (prof.coldStart?.audience || "").trim();
  const needsSetup = item.maturity === "empty" || !progress.oneLinerDone;
  const readOnly = item.isReadOnly;

  return (
    <section className="flex min-h-[160px] shrink-0 flex-col border-b border-line bg-surface">
      <div className="flex items-center gap-2 border-l-4 border-brand px-3 py-2">
        <h2 className="text-sm font-semibold text-ink">定位</h2>
        {!readOnly ? (
          <button type="button" className="ml-auto text-xs text-brand hover:underline" onClick={onEdit}>
            {needsSetup ? "完善定位" : "编辑"}
          </button>
        ) : null}
      </div>
      {needsSetup && !readOnly ? (
        <p className="mx-3 mb-2 rounded-lg bg-amber-500/10 px-2 py-1 text-xs text-amber-900 dark:text-amber-200">
          待完善定位
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 items-center gap-4 px-4 pb-3">
        <IdentityRing
          percent={progress.percent}
          whoDone={progress.whoDone}
          audienceDone={progress.audienceDone}
          oneLinerDone={progress.oneLinerDone}
        />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-semibold text-ink">
            {item.oneLiner || "尚未填写一句话定位"}
          </p>
          <div className="mt-2 space-y-1 text-xs text-muted">
            <p className="flex items-center gap-1.5 truncate" title={who}>
              <IconUser width={14} height={14} className="shrink-0 opacity-70" aria-hidden />
              <span className="truncate">{who || "—"}</span>
            </p>
            <p className="flex items-center gap-1.5 truncate" title={aud}>
              <IconUser width={14} height={14} className="shrink-0 opacity-50" aria-hidden />
              <span className="truncate">{aud || "—"}</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
