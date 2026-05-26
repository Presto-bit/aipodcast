"use client";

import { useMemo, useState } from "react";
import { Button } from "../../ui/Button";
import { cn } from "../../../lib/cn";
import type { AuthorIpTrait } from "../../../lib/authorIp";

type Props = {
  busy?: boolean;
  error?: string | null;
  showLater?: boolean;
  onSubmit: (payload: {
    whoAmI: string;
    audience: string;
    oneLiner: string;
    traits: AuthorIpTrait[];
  }) => void;
  onLater?: () => void;
  onCancel: () => void;
};

type Choice = { id: string; label: string; hint?: string };

const STEP1: Choice[] = [
  { id: "career", label: "职场成长 / 复盘干货" },
  { id: "tutorial", label: "教程清单 / 方法论" },
  { id: "review", label: "测评种草 / 工具解读" },
  { id: "opinion", label: "行业观察 / 观点评论" },
  { id: "story", label: "个人故事 / 经历分享" }
];

const STEP2: Choice[] = [
  { id: "junior", label: "职场新人 / 打工人" },
  { id: "founder", label: "创业者 / 小团队负责人" },
  { id: "peer", label: "同行从业者" },
  { id: "general", label: "泛兴趣读者" }
];

type StyleChoice = Choice & { dimension: string };

const STYLE_CHOICES: StyleChoice[] = [
  { id: "conclusion", label: "结论前置", dimension: "立场" },
  { id: "list", label: "清单体、少套话", dimension: "结构" },
  { id: "you", label: "称「你」、聊天感", dimension: "语气" },
  { id: "fit", label: "写清适合 / 不适合谁", dimension: "结构" },
  { id: "scene", label: "先场景后细节", dimension: "修辞" },
  { id: "honest", label: "克制夸张、实事求是", dimension: "立场" }
];

const ONE_LINER_PRESETS: Record<string, string[]> = {
  career: ["帮职场人把复盘写成可发布的文章", "帮打工人把经历沉淀为可复用的表达"],
  tutorial: ["用步骤清单帮读者快速上手一件事", "把复杂流程拆成可照做的教程"],
  review: ["帮读者按场景选对工具、少踩坑", "用测评与对比帮人选型"],
  opinion: ["用清晰观点帮读者理解行业变化", "把观察写成有态度但不煽情的评论"],
  story: ["用真实经历帮读者获得共鸣与启发", "把个人转折讲成可借鉴的故事"]
};

function ChoiceGroup({
  choices,
  selected,
  custom,
  onSelect,
  onCustom,
  customPlaceholder
}: {
  choices: Choice[];
  selected: string;
  custom: string;
  onSelect: (id: string) => void;
  onCustom: (v: string) => void;
  customPlaceholder: string;
}) {
  return (
    <div className="space-y-1.5">
      {choices.map((c) => (
        <label
          key={c.id}
          className={cn(
            "flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-sm transition",
            selected === c.id ? "border-brand/40 bg-brand/5" : "border-line hover:bg-fill/40"
          )}
        >
          <input
            type="radio"
            name="choice"
            className="mt-1"
            checked={selected === c.id}
            onChange={() => onSelect(c.id)}
          />
          <span className="text-ink">{c.label}</span>
        </label>
      ))}
      <label
        className={cn(
          "flex cursor-pointer flex-col gap-1 rounded-lg border px-2.5 py-2 text-sm",
          selected === "custom" ? "border-brand/40 bg-brand/5" : "border-line"
        )}
      >
        <span className="flex items-center gap-2">
          <input
            type="radio"
            name="choice"
            checked={selected === "custom"}
            onChange={() => onSelect("custom")}
          />
          <span className="text-ink">其他（自己填写）</span>
        </span>
        {selected === "custom" ? (
          <input
            className="w-full rounded-dawn-md border border-line bg-canvas px-2 py-1.5 text-sm"
            placeholder={customPlaceholder}
            value={custom}
            onChange={(e) => onCustom(e.target.value)}
          />
        ) : null}
      </label>
    </div>
  );
}

function resolveChoice(choices: Choice[], selected: string, custom: string): string {
  if (selected === "custom") return custom.trim();
  return choices.find((c) => c.id === selected)?.label || custom.trim();
}

export default function AuthorIpPositioningWizard({
  busy,
  error,
  showLater,
  onSubmit,
  onLater,
  onCancel
}: Props) {
  const [step, setStep] = useState(0);
  const [s1, setS1] = useState("");
  const [s1Custom, setS1Custom] = useState("");
  const [s2, setS2] = useState("");
  const [s2Custom, setS2Custom] = useState("");
  const [oneLinerPick, setOneLinerPick] = useState("");
  const [oneLinerCustom, setOneLinerCustom] = useState("");
  const [styles, setStyles] = useState<Set<string>>(new Set());
  const [styleCustom, setStyleCustom] = useState("");

  const oneLinerOptions = useMemo(() => {
    const base = ONE_LINER_PRESETS[s1] || ONE_LINER_PRESETS.career;
    return base;
  }, [s1]);

  const whoAmI = resolveChoice(STEP1, s1, s1Custom);
  const audience = resolveChoice(STEP2, s2, s2Custom);
  const oneLiner =
    oneLinerPick === "custom"
      ? oneLinerCustom.trim()
      : oneLinerPick === "auto" && whoAmI && audience
        ? `帮${audience.replace(/ \/ .*/, "")}，用${whoAmI.split("/")[0]?.trim() || "内容"}表达`
        : oneLinerPick;

  const canNext = () => {
    if (step === 0) return Boolean(s1 && (s1 !== "custom" || s1Custom.trim()));
    if (step === 1) return Boolean(s2 && (s2 !== "custom" || s2Custom.trim()));
    if (step === 2) return Boolean(oneLinerPick && (oneLinerPick !== "custom" || oneLinerCustom.trim()));
    if (step === 3) return styles.size > 0 || styleCustom.trim();
    return false;
  };

  const buildTraits = (): AuthorIpTrait[] => {
    const out: AuthorIpTrait[] = [];
    for (const id of styles) {
      const c = STYLE_CHOICES.find((x) => x.id === id);
      if (c) {
        out.push({
          dimension: c.dimension,
          label: c.label,
          evidence: "定位向导选择",
          defaultOn: true,
          confidence: 0.85
        });
      }
    }
    if (styleCustom.trim()) {
      out.push({
        dimension: "语气",
        label: styleCustom.trim().slice(0, 80),
        evidence: "自定义",
        defaultOn: true,
        confidence: 0.75
      });
    }
    return out;
  };

  const handleFinish = () => {
    if (!oneLiner.trim()) return;
    onSubmit({
      whoAmI,
      audience,
      oneLiner: oneLiner.trim(),
      traits: buildTraits()
    });
  };

  const titles = ["你主要写什么？", "主要写给谁？", "一句话定位", "你的写作风格"];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="text-xs text-muted">
        步骤 {step + 1}/4 · {titles[step]}
      </p>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {step === 0 ? (
          <ChoiceGroup
            choices={STEP1}
            selected={s1}
            custom={s1Custom}
            onSelect={setS1}
            onCustom={setS1Custom}
            customPlaceholder="例如：B2B 营销与品牌策略"
          />
        ) : null}
        {step === 1 ? (
          <ChoiceGroup
            choices={STEP2}
            selected={s2}
            custom={s2Custom}
            onSelect={setS2}
            onCustom={setS2Custom}
            customPlaceholder="例如：一线城市产品经理"
          />
        ) : null}
        {step === 2 ? (
          <div className="space-y-1.5">
            {oneLinerOptions.map((text) => (
              <label
                key={text}
                className={cn(
                  "flex cursor-pointer gap-2 rounded-lg border px-2.5 py-2 text-sm",
                  oneLinerPick === text ? "border-brand/40 bg-brand/5" : "border-line"
                )}
              >
                <input type="radio" checked={oneLinerPick === text} onChange={() => setOneLinerPick(text)} />
                <span>{text}</span>
              </label>
            ))}
            <label
              className={cn(
                "flex flex-col gap-1 rounded-lg border px-2.5 py-2 text-sm",
                oneLinerPick === "custom" ? "border-brand/40 bg-brand/5" : "border-line"
              )}
            >
              <span className="flex gap-2">
                <input type="radio" checked={oneLinerPick === "custom"} onChange={() => setOneLinerPick("custom")} />
                自己写一句
              </span>
              {oneLinerPick === "custom" ? (
                <textarea
                  className="w-full resize-none rounded-dawn-md border border-line bg-canvas px-2 py-1.5 text-sm"
                  rows={2}
                  value={oneLinerCustom}
                  onChange={(e) => setOneLinerCustom(e.target.value)}
                  placeholder="例如：帮创业者把洞察写成可转发的长文"
                />
              ) : null}
            </label>
          </div>
        ) : null}
        {step === 3 ? (
          <div className="space-y-2">
            <p className="text-xs text-muted">可多选 2～4 项，将写入「特色」供写作引用</p>
            {STYLE_CHOICES.map((c) => (
              <label
                key={c.id}
                className={cn(
                  "flex cursor-pointer gap-2 rounded-lg border px-2.5 py-2 text-sm",
                  styles.has(c.id) ? "border-brand/40 bg-brand/5" : "border-line"
                )}
              >
                <input
                  type="checkbox"
                  checked={styles.has(c.id)}
                  onChange={() => {
                    setStyles((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.id)) next.delete(c.id);
                      else next.add(c.id);
                      return next;
                    });
                  }}
                />
                <span>{c.label}</span>
              </label>
            ))}
            <input
              className="w-full rounded-dawn-md border border-line bg-canvas px-2 py-1.5 text-sm"
              placeholder="其他风格（选填）"
              value={styleCustom}
              onChange={(e) => setStyleCustom(e.target.value)}
            />
          </div>
        ) : null}
      </div>

      {error ? <p className="mt-2 text-xs text-danger-ink">{error}</p> : null}

      <div className="mt-auto flex flex-wrap justify-end gap-1.5 pt-3">
        <Button type="button" variant="ghost" className="px-2.5 py-1.5 text-xs" disabled={busy} onClick={onCancel}>
          收起
        </Button>
        {showLater ? (
          <Button type="button" variant="ghost" className="px-2.5 py-1.5 text-xs" disabled={busy} onClick={onLater}>
            稍后再说
          </Button>
        ) : null}
        {step > 0 ? (
          <Button
            type="button"
            variant="secondary"
            className="px-2.5 py-1.5 text-xs"
            disabled={busy}
            onClick={() => setStep((s) => s - 1)}
          >
            上一步
          </Button>
        ) : null}
        {step < 3 ? (
          <Button
            type="button"
            className="px-2.5 py-1.5 text-xs"
            disabled={busy || !canNext()}
            onClick={() => setStep((s) => s + 1)}
          >
            下一步
          </Button>
        ) : (
          <Button type="button" className="px-2.5 py-1.5 text-xs" disabled={busy || !canNext()} onClick={handleFinish}>
            {busy ? "保存中…" : "完成定位"}
          </Button>
        )}
      </div>
    </div>
  );
}
