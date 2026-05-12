import { softenBareErrorLineForUi } from "./apiError";

export type UserFacingErrorParts = {
  /** 面向用户的主说明（短、可操作） */
  headline: string;
  /** 原始长文或运维向说明，置于可折叠区域；与 headline 相同时为 null */
  technical: string | null;
  /** 从文案中提取的请求编号，便于复制给客服 */
  requestId?: string;
};

/** 明显偏部署/网关排障的长文案特征（命中则 headline 收敛为短句） */
const OPS_ORIENTED =
  /ORCHESTRATOR_URL|docker compose|proxy_read_timeout|proxy_send_timeout|proxy_buffering|\bNginx\b|Tengine|阿里云 CDN|SLB|全站加速|ECS 上|location \^~|\/api\/notes\/ask|DEPLOYMENT\.md|deploy\/nginx|compose 网络/i;

const LOOKS_LIKE_HTML_ERROR = /<!doctype\s+html|<html[\s>]/i;

function extractRequestId(s: string): string | undefined {
  const m =
    s.match(/请求\s*ID[（(][^)）]*[)）][:：]?\s*([^\s\n]+)/i) ||
    s.match(/请求\s*编号[:：]\s*([^\s\n]+)/i) ||
    s.match(/(?:requestId|request_id)[:：]\s*([^\s\n]+)/i);
  const id = m?.[1]?.trim();
  return id || undefined;
}

/**
 * 将任意错误串拆成「短 headline + 可选 technical」，避免把运维说明、整页 HTML 说明直接糊在用户眼前。
 */
export function toUserFacingError(raw: string): UserFacingErrorParts {
  const full = softenBareErrorLineForUi(String(raw || "").trim());
  if (!full) {
    return { headline: "操作未完成，请稍后重试。", technical: null };
  }

  const requestId = extractRequestId(full);

  if (LOOKS_LIKE_HTML_ERROR.test(full)) {
    return {
      headline: "服务端返回了网页错误页而非接口数据，请稍后重试或联系支持。",
      technical: full.length > 800 ? `${full.slice(0, 800)}…` : full,
      requestId
    };
  }

  if (/^https?:\/\/\S+$/i.test(full.trim()) && full.length > 60) {
    return {
      headline: "请求返回了异常链接或重定向地址，请稍后重试。",
      technical: full,
      requestId
    };
  }

  // 单行裸英文 error code（无中文、无空格）：主文案收敛，原文放技术区
  if (
    !full.includes("\n") &&
    full.length < 120 &&
    !/[\u4e00-\u9fff]/.test(full) &&
    /^[a-z][a-z0-9_]*$/i.test(full.trim())
  ) {
    return {
      headline: "服务返回异常，请稍后重试。若持续出现，请重新登录或联系支持。",
      technical: full,
      requestId
    };
  }

  if (OPS_ORIENTED.test(full)) {
    if (/无法连接|upstream|编排器|orchestrator|连接编排器/i.test(full)) {
      return {
        headline: "无法连接创作服务，请稍后重试。若在本机开发，请确认编排器已启动且网络正常。",
        technical: full,
        requestId
      };
    }
    if (/网关超时|504|524|502|bad gateway|Gateway time-out|Gateway timeout/i.test(full)) {
      return {
        headline: "网络或网关暂时中断，请稍后重试。若经常发生，请联系支持并附上请求编号。",
        technical: full,
        requestId
      };
    }
    return {
      headline: "当前提示包含部署或网关相关细节，不影响您先重试；需要排查时可展开下方信息。",
      technical: full,
      requestId
    };
  }

  const blocks = full.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length >= 2 && full.length > 220) {
    const head = blocks[0].length > 320 ? `${blocks[0].slice(0, 317)}…` : blocks[0];
    return { headline: head, technical: full, requestId };
  }

  if (full.length > 360) {
    return {
      headline: `${full.slice(0, 300).trim()}…`,
      technical: full,
      requestId
    };
  }

  return { headline: full, technical: null, requestId };
}

/** catch 块中统一成字符串 */
export function errorMessageFromUnknown(err: unknown): string {
  if (err instanceof Error) return err.message || "操作失败";
  if (typeof err === "string") return err;
  if (err != null && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}
