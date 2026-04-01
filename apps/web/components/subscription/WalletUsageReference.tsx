import type { WalletUsageReference as WalletUsageReferenceT } from "./types";

/** 与 orchestrator `VOICE_CLONE_PAYG_CENTS` 一致，仅在前端缺字段时兜底展示 */
const DEFAULT_VOICE_CLONE_PAYG_CENTS = 1900;

function fmtYuanFromCents(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`;
}

function fmtYuanAmount(yuan: number) {
  return `¥${yuan.toFixed(2)}`;
}

function fmtYuanRange(low: number, high: number) {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return "—";
  if (Math.abs(low - high) < 0.005) return fmtYuanAmount(low);
  const a = Math.min(low, high);
  const b = Math.max(low, high);
  return `${fmtYuanAmount(a)}～${fmtYuanAmount(b)}`;
}

/** 纯文字参考价（分厘级），与编排器 text_generation_only 三位小数对齐 */
function fmtYuanRangeThreeDecimals(low: number, high: number) {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return "—";
  const f = (n: number) => `¥${n.toFixed(3)}`;
  if (Math.abs(low - high) < 0.0005) return f(low);
  const a = Math.min(low, high);
  const b = Math.max(low, high);
  return `${f(a)}～${f(b)}`;
}

type Props = {
  refData: WalletUsageReferenceT | undefined;
};

/**
 * 订阅/收银页：钱包充值区旁的扣费参考（数据来自 orchestrator plans.wallet_topup.usage_reference）。
 */
export function WalletUsageReference({ refData }: Props) {
  if (!refData || typeof refData !== "object") return null;

  const audio = refData.audio_yuan_per_minute_range;
  const textRange = refData.text_generation_only?.thousand_output_chars_yuan_range;
  const cloneCentsRaw = refData.voice_clone_payg_cents;
  const cloneCents =
    typeof cloneCentsRaw === "number" && Number.isFinite(cloneCentsRaw)
      ? cloneCentsRaw
      : DEFAULT_VOICE_CLONE_PAYG_CENTS;

  const hasTextRef =
    textRange && Number.isFinite(textRange.low) && Number.isFinite(textRange.high);

  return (
    <div className="mt-4 rounded-lg border border-line bg-canvas/40 p-4 text-sm text-ink">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">扣费参考</h3>
      <p className="mt-2 text-xs text-muted">
        以下三项便于估算本次充值大约能用多久；与价目及模型价表同源，不代表下单时的最终账单。
      </p>
      <ul className="mt-3 list-none space-y-3 text-xs leading-relaxed">
        <li className="border-t border-line/70 pt-3 first:border-t-0 first:pt-0">
          <span className="font-medium text-ink">播客时长（参考）</span>
          <span className="text-muted">：</span>
          {audio && Number.isFinite(audio.low) && Number.isFinite(audio.high) ? (
            <span className="text-ink">
              指从素材到 AI 文稿与语音合成直至成片的<span className="font-medium">全流程</span>，按{" "}
              <span className="font-medium">成片音频时长</span> 计；<span className="text-muted">不含音色克隆。</span>
              约 {fmtYuanRange(audio.low, audio.high)} / 分钟
            </span>
          ) : (
            <span className="text-muted">—</span>
          )}
        </li>
        <li>
          <span className="font-medium text-ink">文章字数（参考）</span>
          <span className="text-muted">：</span>
          {hasTextRef && textRange ? (
            <span className="text-ink">
              仅 <span className="font-medium">纯文字 / AI 文稿生成</span> 环节，<span className="text-muted">不含语音合成与成片。</span>
              约 {fmtYuanRangeThreeDecimals(textRange.low, textRange.high)} / 千字（按生成稿约 1000 字计；素材越长，同千字输出的参考成本通常越高）
            </span>
          ) : (
            <span className="text-muted">—</span>
          )}
        </li>
        <li>
          <span className="font-medium text-ink">音色克隆（超出套餐后按次）</span>
          <span className="text-muted">：</span>
          <span className="text-ink">{fmtYuanFromCents(cloneCents)} / 次</span>
        </li>
      </ul>
      {refData.disclaimer_zh ? <p className="mt-3 text-[11px] leading-relaxed text-muted">{refData.disclaimer_zh}</p> : null}
    </div>
  );
}
