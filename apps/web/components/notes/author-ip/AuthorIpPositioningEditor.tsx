"use client";

import { Button } from "../../ui/Button";

type Props = {
  whoAmI: string;
  audience: string;
  oneLiner: string;
  onChangeWho: (v: string) => void;
  onChangeAudience: (v: string) => void;
  onChangeOneLiner: (v: string) => void;
  busy?: boolean;
  error?: string | null;
  showLater?: boolean;
  onSubmit: () => void;
  onLater?: () => void;
  onCancel: () => void;
};

/** 定位区内联编辑，不占用全屏遮罩 */
export default function AuthorIpPositioningEditor({
  whoAmI,
  audience,
  oneLiner,
  onChangeWho,
  onChangeAudience,
  onChangeOneLiner,
  busy,
  error,
  showLater,
  onSubmit,
  onLater,
  onCancel
}: Props) {
  const doneDots = [Boolean(oneLiner.trim()), Boolean(whoAmI.trim()), Boolean(audience.trim())];

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && oneLiner.trim()) onSubmit();
      }}
    >
      <p className="text-xs text-muted">约 30 秒；一句话定位必填。</p>

      <label className="mt-2 block text-xs font-medium text-ink">
        一句话定位 <span className="text-danger-ink">*</span>
        <textarea
          className="mt-1 w-full resize-none rounded-dawn-md border border-line bg-canvas px-2.5 py-1.5 text-sm"
          rows={2}
          value={oneLiner}
          onChange={(e) => onChangeOneLiner(e.target.value)}
          placeholder="例如：帮职场人把复盘写成可发布的文章"
        />
      </label>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="block text-xs text-ink">
          我是谁（选填）
          <textarea
            className="mt-1 w-full resize-none rounded-dawn-md border border-line bg-canvas px-2.5 py-1.5 text-sm"
            rows={2}
            value={whoAmI}
            onChange={(e) => onChangeWho(e.target.value)}
          />
        </label>
        <label className="block text-xs text-ink">
          写给谁（选填）
          <textarea
            className="mt-1 w-full resize-none rounded-dawn-md border border-line bg-canvas px-2.5 py-1.5 text-sm"
            rows={2}
            value={audience}
            onChange={(e) => onChangeAudience(e.target.value)}
          />
        </label>
      </div>

      <div className="mt-2 flex gap-1" aria-hidden>
        {doneDots.map((d, i) => (
          <span key={i} className={`h-1 flex-1 rounded-full ${d ? "bg-brand" : "bg-line"}`} />
        ))}
      </div>

      {error ? <p className="mt-1.5 text-xs text-danger-ink">{error}</p> : null}

      <div className="mt-auto flex flex-wrap justify-end gap-1.5 pt-2">
        <Button type="button" variant="ghost" className="px-2.5 py-1.5 text-xs" disabled={busy} onClick={onCancel}>
          收起
        </Button>
        {showLater ? (
          <Button type="button" variant="ghost" className="px-2.5 py-1.5 text-xs" disabled={busy} onClick={onLater}>
            稍后再说
          </Button>
        ) : null}
        <Button type="submit" className="px-2.5 py-1.5 text-xs" disabled={busy || !oneLiner.trim()}>
          {busy ? "保存中…" : "完成"}
        </Button>
      </div>
    </form>
  );
}
