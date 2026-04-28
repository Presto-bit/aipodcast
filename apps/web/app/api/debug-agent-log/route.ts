import fs from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

/** 与 Debug mode 约定一致：仅开发写入，避免生产暴露。 */
const LOG_FILE = path.join(process.cwd(), "..", ".cursor", "debug-f9896b.log");

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "disabled" }, { status: 404 });
  }
  try {
    const raw = (await req.text()).trim();
    if (!raw) return NextResponse.json({ ok: false }, { status: 400 });
    await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
    await fs.appendFile(LOG_FILE, `${raw}\n`, "utf8");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
