"use client";

import { useState } from "react";

const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "支持哪些支付方式？",
    a: "钱包充值使用支付宝电脑网站支付：扫码付款后由支付宝异步通知入账。若已付款但余额未更新，请稍候片刻（本页会自动同步）或联系客服核对订单。"
  },
  {
    q: "体验包和余额有什么区别？",
    a: "新用户注册会获赠一次性体验包（语音分钟与文本字数）。用尽后，创作任务按公示单价从账户余额扣费；余额需自行充值。"
  },
  {
    q: "在哪里查看充值和消费记录？",
    a: "在本页「充值记录」「消费记录」表格中查看；数据以服务端记录为准。"
  },
  {
    q: "音色克隆如何计费？",
    a: "音色克隆按次从余额扣费，具体金额见充值弹窗内扣费参考；余额不足时需先充值。"
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
