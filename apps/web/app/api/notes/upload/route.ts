/** 部分 CDN / 代理会先发 OPTIONS；显式允许 POST，避免误报 405。 */
import { NextRequest } from "next/server";
import { noteUploadOptionsResponse, postNoteUploadFromForm } from "../../../../lib/noteUploadRoute";

export async function OPTIONS() {
  return noteUploadOptionsResponse();
}

export async function POST(req: NextRequest) {
  return postNoteUploadFromForm(req);
}
