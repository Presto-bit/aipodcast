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

type Choice = { id: string; label: string };

const TOPIC_CHOICES: Choice[] = [
  { id: "knowledge", label: "知识分享 / 教程 / 方法论" },
  { id: "experience", label: "个人经历 / 复盘 / 成长故事" },
  { id: "industry", label: "行业观察 / 观点 / 评论" },
  { id: "product", label: "产品 / 工具 / 测评推荐" },
  { id: "life", label: "生活方式 / 兴趣 / 日常记录" }
];

const AUDIENCE_CHOICES: Choice[] = [
  { id: "beginner", label: "新手 / 入门学习者" },
  { id: "practitioner", label: "同行 / 从业者" },
  { id: "decision", label: "需要做决策的人（负责人、采购等）" },
  { id: "general", label: "普通读者 / 泛人群" }
];

const GOAL_CHOICES: Choice[] = [
  { id: "help", label: "帮读者解决一个具体问题" },
  { id: "inspire", label: "给读者启发或情绪共鸣" },
  { id: "persuade", label: "表达观点、影响看法" },
  { id: "record", label: "记录与沉淀自己的思考" }
];

type StyleChoice = Choice & { dimension: string };

const STYLE_CHOICES: StyleChoice[] = [
  { id: "conclusion", label: "结论前置、观点清晰", dimension: "结构" },
  { id: "list", label: "条理清楚、步骤/清单化", dimension: "结构" },
  { id: "plain", label: "语言直白、少套话", dimension: "口吻" },
  { id: "warm", label: "亲切对话感（称「你」）", dimension: "语气" },
  { id: "honest", label: "实事求是、克制夸张", dimension: "立场" },
  { id: "scene", label: "先讲场景再给细节", dimension: "修辞" }
];

const ONE_LINER_BY_TOPIC: Record<string, string[]> = {
  knowledge: ["把复杂问题讲清楚，让读者能照着做", "用结构化方法帮读者快速入门"],
  experience: ["用真实经历帮读者获得可借鉴的启发", "把复盘与成长故事写成可发布的表达"],
  industry: ["用清晰观点帮读者理解变化与趋势", "把观察写成有依据、不煽情的评论"],
  product: ["帮读者按场景选对方案、少踩坑", "用对比与体验帮读者做判断"],
  life: ["用真实感受连接读者，记录值得分享的时刻", "把兴趣与生活体验写成轻松可读的内容"]
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
          <input type="radio" name="choice" className="mt-1" checked={selected === c.id} onChange={() => onSelect(c.id)} />
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
          <input type="radio" name="choice" checked={selected === "custom"} onChange={() => onSelect("custom")} />
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
  const [topic, setTopic] = useState("");
  const [topicCustom, setTopicCustom] = useState("");
  const [audience, setAudience] = useState("");
  const [audienceCustom, setAudienceCustom] = useState("");
  const [goal, setGoal] = useState("");
  const [goalCustom, setGoalCustom] = useState("");
  const [oneLinerPick, setOneLinerPick] = useState("");
  const [oneLinerCustom, setOneLinerCustom] = useState("");
  const [styles, setStyles] = useState<Set<string>>(new Set());
  const [styleCustom, setStyleCustom] = useState("");

  const oneLinerOptions = useMemo(() => ONE_LINER_BY_TOPIC[topic] || ONE_LINER_BY_TOPIC.knowledge, [topic]);

  const whoAmI = resolveChoice(TOPIC_CHOICES, topic, topicCustom);
  const audienceText = resolveChoice(AUDIENCE_CHOICES, audience, audienceCustom);
  const goalText = resolveChoice(GOAL_CHOICES, goal, goalCustom);
  const oneLiner =
    oneLinerPick === "custom" ? oneLinerCustom.trim() : oneLinerPick;

  const canNext = () => {
    if (step === 0) return Boolean(topic && (topic !== "custom" || topicCustom.trim()));
    if (step === 1) return Boolean(audience && (audience !== "custom" || audienceCustom.trim()));
    if (step === 2) return Boolean(goal && (goal !== "custom" || goalCustom.trim()));
    if (step === 3) return Boolean(oneLinerPick && (oneLinerPick !== "custom" || oneLinerCustom.trim()));
    if (step === 4) return styles.size > 0 || styleCustom.trim();
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
          evidence: "定位向导",
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
    const liner = oneLiner.trim();
    if (!liner) return;
    const combinedWho = goalText ? `${whoAmI}（${goalText}）` : whoAmI;
    onSubmit({
      whoAmI: combinedWho.slice(0, 500),
      audience: audienceText,
      oneLiner: liner,
      traits: buildTraits()
    });
  };

  const titles = ["你主要创作哪类内容？", "主要写给谁？", "创作目标是什么？", "一句话定位", "你的写作风格"];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="text-xs text-muted">
        步骤 {step + 1}/5 · {titles[step]}
      </p>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {step === 0 ? (
          <ChoiceGroup
            choices={TOPIC_CHOICES}
            selected={topic}
            custom={topicCustom}
            onSelect={setTopic}
            onCustom={setTopicCustom}
            customPlaceholder="例如：职场沟通、育儿、投资理财"
          />
        ) : null}
        {step === 1 ? (
          <ChoiceGroup
            choices={AUDIENCE_CHOICES}
            selected={audience}
            custom={audienceCustom}
            onSelect={setAudience}
            onCustom={setAudienceCustom}
            customPlaceholder="例如：一线城市职场妈妈"
          />
        ) : null}
        {step === 2 ? (
          <ChoiceGroup
            choices={GOAL_CHOICES}
            selected={goal}
            custom={goalCustom}
            onSelect={setGoal}
            onCustom={setGoalCustom}
            customPlaceholder="例如：建立专业可信度"
          />
        ) : null}
        {step === 3 ? (
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
                  placeholder="用一句话说明你能为读者带来什么"
                />
              ) : null}
            </label>
          </div>
        ) : null}
        {step === 4 ? (
          <div className="space-y-2">
            <p className="text-xs text-muted">可多选，将写入「特色」供写作引用</p>
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
        {step < 4 ? (
          <Button type="button" className="px-2.5 py-1.5 text-xs" disabled={busy || !canNext()} onClick={() => setStep((s) => s + 1)}>
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
