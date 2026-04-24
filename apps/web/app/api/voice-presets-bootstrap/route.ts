import { NextRequest, NextResponse } from "next/server";
import {
  getOrCreateRequestId,
  incomingAuthHeadersFrom,
  orchestratorGetJsonPart
} from "../../../lib/bff";

/** TTS / 播客间等：默认音色 + 已存克隆音色，单次往返。 */
export async function GET(req: NextRequest) {
  const auth = incomingAuthHeadersFrom(req);
  const headers = { ...auth };
  const rid = getOrCreateRequestId(req);

  const [defaultVoices, savedVoices] = await Promise.all([
    orchestratorGetJsonPart("/api/v1/default-voices", headers, rid),
    orchestratorGetJsonPart("/api/v1/saved_voices", headers, rid)
  ]);

  return NextResponse.json({
    success: true,
    defaultVoices,
    savedVoices
  });
}
