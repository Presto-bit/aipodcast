/**
 * 与 /api/notes/upload 等价：部分部署里「notes/upload」路径被代理成静态资源导致 POST → 405，
 * 提供短路径别名绕开。
 */
import { NextRequest } from "next/server";
import { noteUploadOptionsResponse, postNoteUploadFromForm } from "../../../lib/noteUploadRoute";

/** 大文件 base64 + 编排器解析可能超过默认 Serverless 限时（如 Vercel 10s）。 */
export const maxDuration = 180;

export async function OPTIONS() {
  return noteUploadOptionsResponse();
}

export async function POST(req: NextRequest) {
  return postNoteUploadFromForm(req);
}
