import { NextRequest, NextResponse } from "next/server";
import {
  getOrCreateRequestId,
  incomingAuthHeadersFrom,
  orchestratorGetJsonPart
} from "../../../lib/bff";

/**
 * 播客工作室挂载时：合并原先 4 次同源 GET，逻辑与分别请求编排器一致。
 */
export async function GET(req: NextRequest) {
  const auth = incomingAuthHeadersFrom(req);
  const headers = { ...auth };
  const rid = getOrCreateRequestId(req);

  const [defaultVoices, savedVoices, notes, notebooks] = await Promise.all([
    orchestratorGetJsonPart("/api/v1/default-voices", headers, rid),
    orchestratorGetJsonPart("/api/v1/saved_voices", headers, rid),
    orchestratorGetJsonPart("/api/v1/notes", headers, rid),
    orchestratorGetJsonPart("/api/v1/notebooks", headers, rid)
  ]);

  return NextResponse.json({
    success: true,
    defaultVoices,
    savedVoices,
    notes,
    notebooks
  });
}
