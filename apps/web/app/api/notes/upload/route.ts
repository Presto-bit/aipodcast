/** 部分 CDN / 代理会先发 OPTIONS；显式允许 POST，避免误报 405。 */
import { NextRequest } from "next/server";
import { noteUploadOptionsResponse, postNoteUploadFromForm } from "../../../../lib/noteUploadRoute";

/** 大文件 base64 + 编排器解析可能超过默认 Serverless 限时（如 Vercel 10s）。 */
export const maxDuration = 180;

export async function OPTIONS() {
  return noteUploadOptionsResponse();
}

export async function POST(req: NextRequest) {
  return postNoteUploadFromForm(req);
}
