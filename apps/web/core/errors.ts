import { NextResponse } from "next/server";

/**
 * Core/Errors: 统一错误码定义与 JSON 输出格式。
 */
export const AppErrorCodes = {
  Unauthorized: "UNAUTHORIZED",
  ForbiddenAdminOnly: "FORBIDDEN_ADMIN_ONLY",
  InvalidJson: "INVALID_JSON",
  EmptyPayload: "EMPTY_PAYLOAD",
  PayloadTooLarge: "PAYLOAD_TOO_LARGE",
  Disabled: "FEATURE_DISABLED",
  BadRequest: "BAD_REQUEST"
} as const;

export type AppErrorCode = (typeof AppErrorCodes)[keyof typeof AppErrorCodes];

export function errorJson(
  status: number,
  code: AppErrorCode,
  message?: string,
  details?: Record<string, unknown>
): Response {
  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message: message || code,
        ...(details || {})
      }
    },
    { status }
  );
}
