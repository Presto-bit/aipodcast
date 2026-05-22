/**
 * 知识库对话 L2 会话态：本地规则滚动更新（无 UI、无额外请求）。
 */

import type {
  NotesAskMemoryTurn,
  NotesAskSessionState,
  NotesAskSessionThread
} from "./notesAskMemoryTypes";
import { EMPTY_NOTES_ASK_SESSION_STATE } from "./notesAskMemoryTypes";

const FOLLOW_UP_RE =
  /(?:继续|接着|上文|上述|前面|刚才|刚刚|再[详细讲讲说说介绍概括总结]|[还有]什么补充|进一步|展开说说|详细一点|多说一点)/i;

function extractTldr(content: string): string {
  const t = content.trim();
  if (!t) return "";
  const bold = t.match(/\*\*([^*]{4,120})\*\*/);
  if (bold?.[1]) return bold[1].trim();
  const line = t.split(/\n+/).find((l) => l.trim().length >= 8);
  return (line || t).replace(/^#+\s*/, "").trim().slice(0, 160);
}

function topicFromQuestion(q: string): string {
  const t = q.trim().replace(/[？?！!。．]+$/g, "").slice(0, 120);
  return t.length >= 4 ? t : "";
}

function newThreadId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `t-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `t-${Date.now().toString(36)}`;
}

function shouldParkTopic(prevTopic: string, nextQuestion: string): boolean {
  if (!prevTopic || FOLLOW_UP_RE.test(nextQuestion)) return false;
  const prev = prevTopic.slice(0, 24).toLowerCase();
  const q = nextQuestion.slice(0, 48).toLowerCase();
  if (q.includes(prev) || prev.includes(q.slice(0, 12))) return false;
  const prevTokens = prev.match(/[\u4e00-\u9fff]{2,}/g) || [];
  if (prevTokens.length < 2) return false;
  const overlap = prevTokens.filter((tok) => q.includes(tok)).length;
  return overlap < Math.max(1, Math.ceil(prevTokens.length * 0.35));
}

export function bumpNotesAskSourcesRevision(state: NotesAskSessionState | null): NotesAskSessionState {
  const base = state ?? EMPTY_NOTES_ASK_SESSION_STATE();
  return { ...base, sourcesRevision: (base.sourcesRevision ?? 0) + 1 };
}

/** 完成一轮问答后更新会话态（异步调用即可） */
export function updateNotesAskSessionState(
  prev: NotesAskSessionState | null,
  turns: NotesAskMemoryTurn[],
  latestUserQuestion: string,
  latestAssistantAnswer: string
): NotesAskSessionState {
  const base = prev ?? EMPTY_NOTES_ASK_SESSION_STATE();
  const q = latestUserQuestion.trim();
  const a = latestAssistantAnswer.trim();
  const tldr = extractTldr(a);
  const turnCursor = base.turnCursor + 1;

  let topic = base.topic;
  let threads = [...base.threads];
  const nextTopic = topicFromQuestion(q);

  const activeThread = (about: string): NotesAskSessionThread => ({
    id: newThreadId(),
    about,
    status: "active"
  });

  if (shouldParkTopic(topic, q) && topic) {
    threads = threads.map((th) =>
      th.status === "active" && th.about === topic ? { ...th, status: "parked" as const } : th
    );
    topic = nextTopic || topic;
    if (nextTopic) {
      threads = [activeThread(nextTopic), ...threads].slice(0, 8);
    }
  } else if (!topic && nextTopic) {
    topic = nextTopic;
    threads = [activeThread(nextTopic), ...threads].slice(0, 8);
  } else if (nextTopic && nextTopic !== topic && !FOLLOW_UP_RE.test(q)) {
    const active = threads.find((th) => th.status === "active");
    if (!active || active.about !== nextTopic) {
      topic = nextTopic;
      threads = [activeThread(nextTopic), ...threads].slice(0, 8);
    }
  }

  const facts = [...base.facts];
  if (tldr && !facts.includes(tldr)) {
    facts.unshift(tldr);
  }
  const trimmedFacts = facts.slice(0, 12);

  return {
    ...base,
    v: 1,
    topic: topic || nextTopic || base.topic,
    threads,
    facts: trimmedFacts,
    prefs: base.prefs,
    turnCursor
  };
}

/** 为 assistant 消息分配 threadId（与当前 active thread 对齐） */
export function activeThreadIdForSession(state: NotesAskSessionState | null): string | undefined {
  const active = state?.threads?.find((t) => t.status === "active");
  return active?.id;
}
