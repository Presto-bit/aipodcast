import "server-only";

import crypto from "crypto";
import { cookies } from "next/headers";
import { authHeadersFromCookieStore } from "./authSession.server";
import { orchestratorGetJsonPart, ORCHESTRATOR_TIMEOUT_HOME_OVERVIEW_PART_MS } from "./bff";
import { parseHomeOverviewPack } from "./homeOverviewPackParse";
import { HOME_OVERVIEW_WORKS_LIMIT } from "./homeOverviewLimits";
import type { HomeOverviewPayload } from "./queries/homeOverviewQueries";
import type { NotebooksHubPayload } from "./queries/notebooksQueries";
import type { WorksApiPayload } from "./queries/worksQueries";

const WORKS_SERVER_TIMEOUT_MS = 35_000;

export async function getServerWorkbenchAuthHeaders(): Promise<Record<string, string>> {
  return authHeadersFromCookieStore(await cookies());
}

export async function fetchWorksPageServer(
  headers: Record<string, string>,
  limit = 60,
  offset = 0
): Promise<WorksApiPayload | null> {
  if (!headers.authorization) return null;
  const rid = crypto.randomUUID();
  const part = await orchestratorGetJsonPart(
    `/api/v1/works?limit=${limit}&offset=${offset}`,
    headers,
    rid,
    { timeoutMs: WORKS_SERVER_TIMEOUT_MS, retryGetOnce: false }
  );
  if (!part.ok) return null;
  const data = (part.data ?? {}) as {
    success?: boolean;
    ai?: WorksApiPayload["ai"];
    tts?: WorksApiPayload["tts"];
    notes?: WorksApiPayload["notes"];
    total?: number;
    has_more?: boolean;
  };
  if (data.success === false) return null;
  return {
    ai: Array.isArray(data.ai) ? data.ai : [],
    tts: Array.isArray(data.tts) ? data.tts : [],
    notes: Array.isArray(data.notes) ? data.notes : [],
    total: typeof data.total === "number" ? data.total : undefined,
    hasMore: Boolean(data.has_more)
  };
}

export async function fetchNotebooksHubServer(headers: Record<string, string>): Promise<NotebooksHubPayload | null> {
  if (!headers.authorization) return null;
  const rid = crypto.randomUUID();
  const part = await orchestratorGetJsonPart("/api/v1/notebooks", headers, rid, {
    timeoutMs: WORKS_SERVER_TIMEOUT_MS,
    retryGetOnce: false
  });
  if (!part.ok) return null;
  const data = (part.data ?? {}) as {
    success?: boolean;
    notebooks?: string[];
    notebookSharing?: NotebooksHubPayload["notebookSharing"];
    notebookCovers?: NotebooksHubPayload["notebookCovers"];
  };
  if (data.success === false) return null;
  return {
    notebooks: Array.isArray(data.notebooks) ? data.notebooks : [],
    notebookSharing: data.notebookSharing && typeof data.notebookSharing === "object" ? data.notebookSharing : {},
    notebookCovers: data.notebookCovers && typeof data.notebookCovers === "object" ? data.notebookCovers : {}
  };
}

export async function fetchHomeOverviewServer(headers: Record<string, string>): Promise<HomeOverviewPayload | null> {
  if (!headers.authorization) return null;
  const rid = crypto.randomUUID();
  const partOpts = { timeoutMs: ORCHESTRATOR_TIMEOUT_HOME_OVERVIEW_PART_MS, retryGetOnce: false };
  const worksPath = `/api/v1/works?limit=${HOME_OVERVIEW_WORKS_LIMIT}&offset=0`;
  const [jobsLimit1, jobsActive, works, worksMetrics, notesMetrics] = await Promise.all([
    orchestratorGetJsonPart("/api/v1/jobs?limit=1", headers, rid, partOpts),
    orchestratorGetJsonPart("/api/v1/jobs?limit=80&offset=0&status=queued,running&slim=1", headers, rid, partOpts),
    orchestratorGetJsonPart(worksPath, headers, rid, partOpts),
    orchestratorGetJsonPart("/api/v1/works/metrics", headers, rid, partOpts),
    orchestratorGetJsonPart("/api/v1/notes/metrics", headers, rid, partOpts)
  ]);
  if (!works.ok && !jobsLimit1.ok) return null;
  return parseHomeOverviewPack(
    {
      jobsLimit1,
      jobsActive,
      works,
      worksMetrics,
      notesMetrics
    },
    works.status
  );
}
