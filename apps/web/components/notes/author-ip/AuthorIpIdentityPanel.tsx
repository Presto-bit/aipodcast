"use client";

import { IconUser } from "../../icons";
import type { AuthorIpItem } from "../../../lib/authorIp";
import AuthorIpPositioningEditor from "./AuthorIpPositioningEditor";
import IdentityRing from "./IdentityRing";
import { positioningProgress } from "./utils";

type Props = {
  item: AuthorIpItem;
  editing: boolean;
  whoAmI: string;
  audience: string;
  oneLiner: string;
  onChangeWho: (v: string) => void;
  onChangeAudience: (v: string) => void;
  onChangeOneLiner: (v: string) => void;
  busy?: boolean;
  positioningError?: string | null;
  onSubmitPositioning: () => void;
  onLaterPositioning?: () => void;
  onCancelPositioning: () => void;
  onEdit: () => void;
};

export default function AuthorIpIdentityPanel({
  item,
  editing,
  whoAmI,
  audience,
  oneLiner,
  onChangeWho,
  onChangeAudience,
  onChangeOneLiner,
  busy,
  positioningError,
  onSubmitPositioning,
  onLaterPositioning,
  onCancelPositioning,
  onEdit
}: Props) {
  const prof = item.profile as { coldStart?: { whoAmI?: string; audience?: string } };
  const progress = positioningProgress(item);
  const who = (prof.coldStart?.whoAmI || "").trim();
  const aud = (prof.coldStart?.audience || "").trim();
  const needsSetup = item.maturity === "empty" || !progress.oneLinerDone;
  const readOnly = item.isReadOnly;

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-surface">
      <div className="flex shrink-0 items-center gap-2 border-b border-line border-l-4 border-l-brand px-3 py-2">
        <h2 className="text-sm font-semibold text-ink">定位</h2>
        {!readOnly && !editing ? (
          <button type="button" className="ml-auto text-xs text-brand hover:underline" onClick={onEdit}>
            {needsSetup ? "完善定位" : "编辑"}
          </button>
        ) : null}
        {!readOnly && editing ? (
          <span className="ml-auto text-xs text-muted">编辑中</span>
        ) : null}
      </div>

      {needsSetup && !readOnly && !editing ? (
        <p className="mx-3 mt-2 shrink-0 rounded-lg bg-amber-500/10 px-2 py-1 text-xs text-amber-900 dark:text-amber-200">
          待完善定位
        </p>
      ) : null}

      {editing && !readOnly ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2">
          <AuthorIpPositioningEditor
            whoAmI={whoAmI}
            audience={audience}
            oneLiner={oneLiner}
            onChangeWho={onChangeWho}
            onChangeAudience={onChangeAudience}
            onChangeOneLiner={onChangeOneLiner}
            busy={busy}
            error={positioningError}
            showLater={needsSetup}
            onSubmit={onSubmitPositioning}
            onLater={onLaterPositioning}
            onCancel={onCancelPositioning}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center gap-4 overflow-hidden px-4 py-3">
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
      )}
    </section>
  );
}
