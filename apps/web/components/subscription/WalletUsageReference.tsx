import type { WalletUsageReference as WalletUsageReferenceT } from "./types";

/** 与 orchestrator `VOICE_CLONE_PAYG_CENTS` 一致，仅在前端缺字段时兜底展示 */
const DEFAULT_VOICE_CLONE_PAYG_CENTS = 1290;

function fmtYuanFromCents(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`;
}

function fmtYuanTwoDecimals(yuan: number) {
  if (!Number.isFinite(yuan)) return "—";
  return `¥${yuan.toFixed(2)}`;
}

type Props = {
  refData: WalletUsageReferenceT | undefined;
};

/**
 * 充值弹窗内扣费参考（数据来自编排器 wallet_topup.usage_reference）。
 */
export function WalletUsageReference({ refData }: Props) {
  if (!refData || typeof refData !== "object") return null;

  const podcast = refData.podcast_yuan_per_minute;
  const text10k = refData.text_yuan_per_10k_chars;
  const cloneCentsRaw = refData.voice_clone_payg_cents;
  const cloneCents =
    typeof cloneCentsRaw === "number" && Number.isFinite(cloneCentsRaw)
      ? cloneCentsRaw
      : DEFAULT_VOICE_CLONE_PAYG_CENTS;

  return (
    <div className="mt-4 rounded-lg border border-line bg-canvas/40 p-4 text-sm text-ink">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">扣费参考</h3>
      <p className="mt-2 text-xs text-muted">
        按单价模式估算本次充值大致可用量，不代表下单时的最终账单。
      </p>
      <ul className="mt-3 list-none space-y-3 text-xs leading-relaxed">
        <li className="border-t border-line/70 pt-3 first:border-t-0 first:pt-0">
          <span className="font-medium text-ink">播客时长</span>
          <span className="text-muted">：</span>
          {typeof podcast === "number" && Number.isFinite(podcast) ? (
            <span className="text-ink">
              成片音频每分钟（文稿 + 合成至成片，已含进 TTS 前 AI 润色）约{" "}
              <span className="font-medium">{fmtYuanTwoDecimals(podcast)}</span> / 分钟
            </span>
          ) : (
            <span className="text-muted">—</span>
          )}
        </li>
        <li>
          <span className="font-medium text-ink">脚本文本</span>
          <span className="text-muted">：</span>
          {typeof text10k === "number" && Number.isFinite(text10k) ? (
            <span className="text-ink">
              模型成稿按字数，约 <span className="font-medium">{fmtYuanTwoDecimals(text10k)}</span> / 万字（向上取整到分）
            </span>
          ) : (
            <span className="text-muted">—</span>
          )}
        </li>
        <li>
          <span className="font-medium text-ink">音色克隆</span>
          <span className="text-muted">：</span>
          <span className="text-ink">
            按次 <span className="font-medium">{fmtYuanFromCents(cloneCents)}</span> / 次
          </span>
        </li>
      </ul>
      {refData.disclaimer_zh ? <p className="mt-3 text-[11px] leading-relaxed text-muted">{refData.disclaimer_zh}</p> : null}
    </div>
  );
}
