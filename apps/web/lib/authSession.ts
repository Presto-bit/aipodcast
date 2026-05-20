/** 服务端 / 客户端共用的首屏会话注入类型（勿在此文件 import auth.tsx） */

export type InitialAuthUser = {
  user_id?: string;
  phone?: string;
  email?: string;
  username?: string;
  email_verified?: boolean;
  display_name?: string;
  [k: string]: unknown;
};

export type InitialAuthSession = {
  authRequired: boolean;
  user: InitialAuthUser | null;
  sessionResolved: boolean;
  /** 为 true 时 AuthProvider 已具备首屏态，不阻塞 ready */
  hydrateFromServer: boolean;
  /** 静态壳：挂载后静默刷新会话（营销/登录页 CTA，不挡首屏） */
  revalidateInBackground?: boolean;
};

/** 营销 / 公开文档页：不读 Cookie，首屏即 ready；可选后台 session */
export const STATIC_SHELL_SESSION: InitialAuthSession = {
  authRequired: true,
  user: null,
  sessionResolved: true,
  hydrateFromServer: true,
  revalidateInBackground: true
};
