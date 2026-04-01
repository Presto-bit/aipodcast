"use client";

import { useState } from "react";

const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "支持哪些支付方式？",
    a: "正式环境将支持支付宝、微信等常见渠道；当前内测阶段以运营配置为准。完成支付并收到回调后，套餐会自动更新。"
  },
  {
    q: "可以克隆自己的声音吗？",
    a: "可以。各档位每月包含的免费克隆次数见套餐卡片；超出部分可按次购买（以产品规则为准）。"
  },
  {
    q: "可以随时取消订阅吗？",
    a: "订阅周期内权益按规则生效；到期后未续费将回落至 Free 档位。具体退款与取消政策以支付渠道及用户协议为准。"
  },
  {
    q: "生成的音频能商用吗？",
    a: "Free 一般为非商用或受限使用；Pro / Creator（Max）含标准或增强商用授权，请以当期套餐说明及授权凭证为准。"
  },
  {
    q: "额度用完了怎么办？",
    a: "可升级更高档位，或购买按次分钟包（上线后）。创作次数与时长口径见订阅页配额说明。"
  },
  {
    q: "未用完的额度会累积到下个月吗？",
    a: "默认按月重置，不累积；按次包若有独立有效期会在购买页说明。"
  },
  {
    q: "可以开具发票吗？",
    a: "如需发票，请通过客服或企业渠道联系，提供订单信息与开票抬头。"
  }
];

export function FaqAccordion() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="mt-14 border-t border-line pt-10">
      <h2 className="text-center text-lg font-semibold text-ink">常见问题</h2>
      <ul className="mx-auto mt-6 max-w-2xl space-y-2">
        {FAQ_ITEMS.map((item, i) => {
          const isOpen = open === i;
          return (
            <li key={i} className="rounded-xl border border-line bg-surface/50">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium text-ink"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : i)}
              >
                {item.q}
                <span className="text-muted">{isOpen ? "−" : "+"}</span>
              </button>
              {isOpen ? <p className="border-t border-line/80 px-4 pb-3 pt-0 text-xs leading-relaxed text-muted">{item.a}</p> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
