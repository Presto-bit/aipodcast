import type { NextRequest } from "next/server";
import { handleNoteUploadOPTIONS, handleNoteUploadPOST } from "../../../lib/noteUploadOrchestratorProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function OPTIONS() {
  return handleNoteUploadOPTIONS();
}

export async function POST(req: NextRequest) {
  return handleNoteUploadPOST(req);
}
