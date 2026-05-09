import Link from "next/link";
import { PricingHero } from "../../../components/subscription/PricingHero";

const ROWS: { type: string; price: string; features: string }[] = [
  {
    type: "文本转语音 / TTS",
    price: "0.25 元 / 分钟",
    features: "生成播客"
  },
  {
    type: "语音识别 / ASR",
    price: "约 0.082 元 / 分钟",
    features: "音频剪辑中的转写功能（按输入音频时长计，结算向上取整到分）"
  },
  {
    type: "文本模型",
    price: "输出 1 元 / 万字",
    features: "生成文章，播客文案，Shownotes 等需要文本模型输出的内容"
  },
  {
    type: "语音克隆",
    price: "12.9 元 / 个",
    features: "音色库中单次克隆价格；使用已克隆音色合成语音不另收克隆费"
  },
  {
    type: "图片模型",
    price: "0.025 元 / 张",
    features: "播客封面图等"
  }
];

export default function PricingReferencePage() {
  return (
    <main className="min-h-0 max-w-6xl">
      <nav className="mb-6 text-sm text-muted">
        <Link href="/subscription#balance-billing" className="font-medium text-brand underline underline-offset-2 hover:opacity-90">
          ← 返回余额与账单
        </Link>
      </nav>
      <PricingHero title="定价参考" subtitle="以下为面向用户的计费说明，便于估算用量；实际扣款以任务成功结算时为准。" />
      <section className="mt-8 overflow-x-auto rounded-xl border border-line bg-surface/60 shadow-sm" aria-labelledby="pricing-ref-title">
        <h2 id="pricing-ref-title" className="sr-only">
          定价参考表
        </h2>
        <table className="min-w-[640px] w-full text-left text-sm text-ink">
          <thead className="border-b border-line bg-fill/40 text-xs font-semibold uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">模型类型</th>
              <th className="px-4 py-3">定价</th>
              <th className="px-4 py-3">涉及功能</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.type} className="border-t border-line/80">
                <td className="whitespace-nowrap px-4 py-3 font-medium text-ink">{row.type}</td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-ink">{row.price}</td>
                <td className="px-4 py-3 leading-relaxed text-ink">{row.features}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="mt-4 text-xs leading-relaxed text-muted">
        体验包（新用户赠送的语音分钟与文本字数）用尽后，将按上表从账户余额扣费。充值与流水请在「余额与账单」页查看。
      </p>
    </main>
  );
}
