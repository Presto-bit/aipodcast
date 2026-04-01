/**
 * 与 /api/notes/upload 等价：部分部署里「notes/upload」路径被代理成静态资源导致 POST → 405，
 * 提供短路径别名绕开。
 */
import { NextRequest } from "next/server";
import { noteUploadOptionsResponse, postNoteUploadFromForm } from "../../../lib/noteUploadRoute";

export async function OPTIONS() {
  return noteUploadOptionsResponse();
}

export async function POST(req: NextRequest) {
  return postNoteUploadFromForm(req);
}
