import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveAuthSessionServer } from "../../../../lib/authSession.server";

/**
 * 客户端刷新会话；首屏工作台由 RSC layout 注入，不经此路由。
 */
export async function GET(_req: NextRequest) {
  const session = await resolveAuthSessionServer(await cookies());
  if (!session.authRequired) {
    return NextResponse.json({
      success: true,
      auth_required: false,
      user: session.user
    });
  }
  if (session.user) {
    return NextResponse.json({
      success: true,
      auth_required: true,
      user: session.user
    });
  }
  return NextResponse.json({ success: false, auth_required: true, user: null }, { status: 401 });
}
