import { NextRequest, NextResponse } from "next/server";
import {
  getOrCreateRequestId,
  incomingAuthHeadersFrom,
  orchestratorGetJsonPart
} from "../../../lib/bff";
import { HOME_OVERVIEW_WORKS_LIMIT } from "../../../lib/homeOverviewLimits";

/**
 * 首页工作台：单次往返并行拉取原先 4 路 BFF 同源请求的数据，减轻浏览器连接占用与中间层次数。
 */
export async function GET(req: NextRequest) {
  const auth = incomingAuthHeadersFrom(req);
  const headers = { ...auth };
  const rid = getOrCreateRequestId(req);
  const worksPath = `/api/v1/works?limit=${HOME_OVERVIEW_WORKS_LIMIT}&offset=0`;

  const [jobsLimit1, jobsActive, works, notes] = await Promise.all([
    orchestratorGetJsonPart("/api/v1/jobs?limit=1", headers, rid),
    orchestratorGetJsonPart("/api/v1/jobs?limit=80&offset=0&status=queued,running&slim=1", headers, rid),
    orchestratorGetJsonPart(worksPath, headers, rid),
    orchestratorGetJsonPart("/api/v1/notes", headers, rid)
  ]);

  return NextResponse.json({
    success: true,
    jobsLimit1,
    jobsActive,
    works,
    notes
  });
}
