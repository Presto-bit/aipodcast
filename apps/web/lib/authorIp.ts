/** 个人特色 IP API 类型与请求（BFF `/api/author-ips`） */

export type AuthorIpMaturity = "empty" | "sketch" | "sketch_plus" | "ready" | "stale";

export type AuthorIpItem = {
  id: string;
  displayName: string;
  subtitle: string;
  avatarColor: string;
  notebookName: string;
  isDefault: boolean;
  isSystemSeed: boolean;
  isTemplate: boolean;
  isReadOnly: boolean;
  templateId: string | null;
  maturity: AuthorIpMaturity | string;
  oneLiner: string;
  profile: Record<string, unknown>;
  materialCount: number;
  traitCount: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type AuthorIpListResponse = {
  success?: boolean;
  items?: AuthorIpItem[];
};

function authHeaders(): HeadersInit {
  return { "content-type": "application/json" };
}

export type AuthorIpDomain = {
  displayName?: string;
  boundArticleTitles?: string[];
  boundExperienceTemplates?: string[];
};

export async function fetchAuthorIpItem(ipId: string): Promise<AuthorIpItem> {
  const res = await fetch(`/api/author-ips/${encodeURIComponent(ipId)}`, {
    cache: "no-store",
    credentials: "include",
    headers: authHeaders()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String((data as { detail?: string }).detail || "加载 IP 失败"));
  }
  return (data as { item: AuthorIpItem }).item;
}

export async function fetchAuthorIps(): Promise<AuthorIpItem[]> {
  const res = await fetch("/api/author-ips", { cache: "no-store", credentials: "include", headers: authHeaders() });
  const data = (await res.json().catch(() => ({}))) as AuthorIpListResponse & { detail?: string };
  if (!res.ok) {
    throw new Error(String(data.detail || "加载个人特色 IP 失败"));
  }
  return Array.isArray(data.items) ? data.items : [];
}

export async function createAuthorIp(displayName: string, setDefault = false): Promise<AuthorIpItem> {
  const res = await fetch("/api/author-ips", {
    method: "POST",
    credentials: "include",
    headers: authHeaders(),
    body: JSON.stringify({ displayName, setDefault })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String((data as { detail?: string }).detail || "创建失败"));
  }
  return (data as { item: AuthorIpItem }).item;
}

export async function duplicateAuthorIp(
  sourceId: string,
  opts?: { displayName?: string; cloneNotes?: boolean }
): Promise<AuthorIpItem> {
  const res = await fetch(`/api/author-ips/${encodeURIComponent(sourceId)}/duplicate`, {
    method: "POST",
    credentials: "include",
    headers: authHeaders(),
    body: JSON.stringify({
      displayName: opts?.displayName,
      cloneNotes: opts?.cloneNotes ?? true
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String((data as { detail?: string }).detail || "复制失败"));
  }
  return (data as { item: AuthorIpItem }).item;
}

export type AuthorIpTrashItem = AuthorIpItem & { archivedAt: string | null };

export async function fetchAuthorIpsTrash(): Promise<AuthorIpTrashItem[]> {
  const res = await fetch("/api/author-ips/trash", {
    cache: "no-store",
    credentials: "include",
    headers: authHeaders()
  });
  const data = (await res.json().catch(() => ({}))) as { items?: AuthorIpTrashItem[]; detail?: string };
  if (!res.ok) {
    throw new Error(String(data.detail || "加载 IP 回收站失败"));
  }
  return Array.isArray(data.items) ? data.items : [];
}

export async function deleteAuthorIp(ipId: string): Promise<void> {
  const res = await fetch(`/api/author-ips/${encodeURIComponent(ipId)}`, {
    method: "DELETE",
    credentials: "include",
    headers: authHeaders()
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(String((data as { detail?: string }).detail || "删除失败"));
  }
}

export async function restoreAuthorIp(ipId: string): Promise<AuthorIpItem> {
  const res = await fetch(`/api/author-ips/${encodeURIComponent(ipId)}/restore`, {
    method: "POST",
    credentials: "include",
    headers: authHeaders(),
    body: "{}"
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String((data as { detail?: string }).detail || "恢复失败"));
  }
  return (data as { item: AuthorIpItem }).item;
}

export async function purgeAuthorIp(ipId: string): Promise<void> {
  const res = await fetch(`/api/author-ips/${encodeURIComponent(ipId)}/purge`, {
    method: "POST",
    credentials: "include",
    headers: authHeaders(),
    body: "{}"
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(String((data as { detail?: string }).detail || "永久删除失败"));
  }
}

export async function patchAuthorIp(
  ipId: string,
  patch: { displayName?: string; isDefault?: boolean }
): Promise<AuthorIpItem> {
  const res = await fetch(`/api/author-ips/${encodeURIComponent(ipId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: authHeaders(),
    body: JSON.stringify(patch)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String((data as { detail?: string }).detail || "保存失败"));
  }
  return (data as { item: AuthorIpItem }).item;
}

export const AUTHOR_IP_HOVER_HINT =
  "输出你的经历和写作偏好，创建专属个人写作风格；创作时可勾选「按我的风格写作」，系统将自动匹配该 IP 的口吻与经历。";

export const AUTHOR_IP_TEMPLATE_BADGE = "示例";

export type AuthorIpMaterial = {
  noteId: string;
  title: string;
  body?: string;
  preview?: string;
  bodyLength?: number;
  materialType: string;
  experienceTemplateId?: string;
  authorIpId?: string;
};

export function needsAuthorIpColdStart(item: AuthorIpItem | null): boolean {
  if (!item || item.isTemplate) return false;
  return item.maturity === "empty";
}

export async function fetchAuthorIpMaterials(ipId: string): Promise<AuthorIpMaterial[]> {
  const res = await fetch(`/api/author-ips/${encodeURIComponent(ipId)}/materials`, {
    cache: "no-store",
    credentials: "include",
    headers: authHeaders()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String((data as { detail?: string }).detail || "加载素材失败"));
  }
  return Array.isArray((data as { items?: AuthorIpMaterial[] }).items)
    ? (data as { items: AuthorIpMaterial[] }).items
    : [];
}

export async function addAuthorIpMaterial(
  ipId: string,
  payload: { title: string; body: string; materialType?: string; experienceTemplateId?: string }
): Promise<void> {
  const res = await fetch(`/api/author-ips/${encodeURIComponent(ipId)}/materials`, {
    method: "POST",
    credentials: "include",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(String((data as { detail?: string }).detail || "添加失败"));
  }
}

export async function deleteAuthorIpMaterial(ipId: string, noteId: string): Promise<void> {
  const res = await fetch(
    `/api/author-ips/${encodeURIComponent(ipId)}/materials/${encodeURIComponent(noteId)}`,
    { method: "DELETE", credentials: "include", headers: authHeaders() }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(String((data as { detail?: string }).detail || "删除失败"));
  }
}

export async function submitAuthorIpColdStart(
  ipId: string,
  payload: { whoAmI: string; audience: string; oneLiner: string }
): Promise<AuthorIpItem> {
  const res = await fetch(`/api/author-ips/${encodeURIComponent(ipId)}/cold-start`, {
    method: "POST",
    credentials: "include",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String((data as { detail?: string }).detail || "保存失败"));
  }
  return (data as { item: AuthorIpItem }).item;
}

export async function saveAuthorIpCompose(
  ipId: string,
  payload: { draftBody: string; title?: string; topic?: string; saveAsPublished?: boolean }
): Promise<void> {
  const res = await fetch(`/api/author-ips/${encodeURIComponent(ipId)}/compose/save`, {
    method: "POST",
    credentials: "include",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(String((data as { detail?: string }).detail || "保存失败"));
  }
}

export async function fetchComposeBillingPreview(
  ipId: string,
  opts: { targetChars?: number; contentType?: string }
): Promise<{ canAfford: boolean; message?: string | null }> {
  const q = new URLSearchParams();
  if (opts.targetChars) q.set("targetChars", String(opts.targetChars));
  if (opts.contentType) q.set("contentType", opts.contentType);
  const res = await fetch(
    `/api/author-ips/${encodeURIComponent(ipId)}/compose/billing-preview?${q}`,
    { cache: "no-store", credentials: "include", headers: authHeaders() }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String((data as { detail?: string }).detail || "计费预览失败"));
  }
  return {
    canAfford: Boolean((data as { canAfford?: boolean }).canAfford),
    message: (data as { message?: string }).message
  };
}

export async function trialComposeAuthorIp(
  ipId: string,
  payload: { topic: string; contentType?: string }
): Promise<AuthorIpComposeResult> {
  const res = await fetch(`/api/author-ips/${encodeURIComponent(ipId)}/trial-compose`, {
    method: "POST",
    credentials: "include",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = String((data as { detail?: string }).detail || "");
    if (res.status === 402) {
      throw new Error(detail || "余额不足，请先充值");
    }
    throw new Error(detail || "试写失败");
  }
  return {
    body: String((data as AuthorIpComposeResult).body || ""),
    resolver: (data as { resolver: AuthorIpResolver }).resolver,
    imprint: (data as { imprint: AuthorIpImprint }).imprint
  };
}

export async function patchAuthorIpDomains(ipId: string, domains: AuthorIpDomain[]): Promise<AuthorIpItem> {
  const res = await fetch(`/api/author-ips/${encodeURIComponent(ipId)}/domains`, {
    method: "PATCH",
    credentials: "include",
    headers: authHeaders(),
    body: JSON.stringify({ domains })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String((data as { detail?: string }).detail || "保存场景失败"));
  }
  return (data as { item: AuthorIpItem }).item;
}

export async function ackAuthorIpFirstCompare(ipId: string): Promise<void> {
  await fetch(`/api/author-ips/${encodeURIComponent(ipId)}/first-compare/ack`, {
    method: "POST",
    credentials: "include",
    headers: authHeaders(),
    body: "{}"
  });
}

export function profileFirstCompareShown(item: AuthorIpItem | null): boolean {
  const flags = (item?.profile as { flags?: { firstCompareShown?: boolean } })?.flags;
  return Boolean(flags?.firstCompareShown);
}

export async function learnAuthorIp(ipId: string): Promise<AuthorIpItem> {
  const res = await fetch(`/api/author-ips/${encodeURIComponent(ipId)}/learn`, {
    method: "POST",
    credentials: "include",
    headers: authHeaders(),
    body: "{}"
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String((data as { detail?: string }).detail || "学习失败"));
  }
  return (data as { item: AuthorIpItem }).item;
}

export type AuthorIpResolver = {
  authorIpId: string;
  displayName?: string;
  sceneName: string;
  contentType: string;
  contentTypeLabel: string;
  confidence: string;
  resolverLine: string;
  traitLabels: string[];
  experienceNoteIds: string[];
  experienceTitles: string[];
  maturity?: string;
};

export type AuthorIpImprint = {
  sceneName?: string;
  contentTypeLabel?: string;
  citedExperiences?: string[];
  diffSummary?: string;
  usedAuthorStyle?: boolean;
};

export type AuthorIpComposeResult = {
  body: string;
  resolver: AuthorIpResolver;
  imprint: AuthorIpImprint;
};

export async function resolveAuthorIpStyle(
  ipId: string,
  payload: {
    topic: string;
    outline?: string;
    contentType?: string;
    experienceLevel?: string;
  }
): Promise<AuthorIpResolver> {
  const res = await fetch(`/api/author-ips/${encodeURIComponent(ipId)}/style/resolve`, {
    method: "POST",
    credentials: "include",
    headers: authHeaders(),
    body: JSON.stringify({
      topic: payload.topic,
      outline: payload.outline ?? "",
      contentType: payload.contentType ?? "article",
      experienceLevel: payload.experienceLevel ?? "default"
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String((data as { detail?: string }).detail || "风格解析失败"));
  }
  return (data as { resolver: AuthorIpResolver }).resolver;
}

export async function composeAuthorIpArticle(
  ipId: string,
  payload: {
    topic: string;
    outline?: string;
    contentType?: string;
    useAuthorStyle?: boolean;
    experienceLevel?: string;
    targetChars?: number;
  }
): Promise<AuthorIpComposeResult> {
  const res = await fetch(`/api/author-ips/${encodeURIComponent(ipId)}/compose`, {
    method: "POST",
    credentials: "include",
    headers: authHeaders(),
    body: JSON.stringify({
      topic: payload.topic,
      outline: payload.outline ?? "",
      contentType: payload.contentType ?? "article",
      useAuthorStyle: payload.useAuthorStyle ?? true,
      experienceLevel: payload.experienceLevel ?? "default",
      targetChars: payload.targetChars
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = String((data as { detail?: string }).detail || "");
    if (res.status === 402) {
      throw new Error(detail || "余额不足，请先充值");
    }
    throw new Error(detail || "生成失败");
  }
  return {
    body: String((data as AuthorIpComposeResult).body || ""),
    resolver: (data as { resolver: AuthorIpResolver }).resolver,
    imprint: (data as { imprint: AuthorIpImprint }).imprint
  };
}

/** 流式成文：onEvent 按序收到 resolver / chunk / done / error */
export async function composeAuthorIpArticleStream(
  ipId: string,
  payload: {
    topic: string;
    outline?: string;
    contentType?: string;
    useAuthorStyle?: boolean;
    experienceLevel?: string;
    targetChars?: number;
  },
  onEvent: (ev: Record<string, unknown>) => void
): Promise<AuthorIpComposeResult> {
  const res = await fetch(`/api/author-ips/${encodeURIComponent(ipId)}/compose/stream`, {
    method: "POST",
    credentials: "include",
    headers: authHeaders(),
    body: JSON.stringify({
      topic: payload.topic,
      outline: payload.outline ?? "",
      contentType: payload.contentType ?? "article",
      useAuthorStyle: payload.useAuthorStyle ?? true,
      experienceLevel: payload.experienceLevel ?? "default",
      targetChars: payload.targetChars
    })
  });
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (!res.ok || !ct.includes("text/event-stream") || !res.body) {
    const data = await res.json().catch(() => ({}));
    const detail = String((data as { detail?: string }).detail || "");
    if (res.status === 402) {
      throw new Error(detail || "余额不足，请先充值");
    }
    throw new Error(detail || "流式生成失败");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let result: AuthorIpComposeResult | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() || "";
    for (const block of parts) {
      for (const line of block.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;
        const ev = JSON.parse(raw) as Record<string, unknown>;
        onEvent(ev);
        if (ev.type === "error") {
          throw new Error(String(ev.code || "compose_stream_error"));
        }
        if (ev.type === "done") {
          result = {
            body: String(ev.body || ""),
            resolver: ev.resolver as AuthorIpResolver,
            imprint: ev.imprint as AuthorIpImprint
          };
        }
      }
    }
  }
  if (!result?.body) {
    throw new Error("compose_empty");
  }
  return result;
}

export async function submitAuthorIpStyleFeedback(
  ipId: string,
  liked: boolean,
  reason?: string
): Promise<void> {
  const res = await fetch(`/api/author-ips/${encodeURIComponent(ipId)}/style/feedback`, {
    method: "POST",
    credentials: "include",
    headers: authHeaders(),
    body: JSON.stringify({ liked, reason: reason ?? "" })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(String((data as { detail?: string }).detail || "反馈提交失败"));
  }
}
