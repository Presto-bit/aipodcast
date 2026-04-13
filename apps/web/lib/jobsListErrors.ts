import { classifyErrorTone, errorPageCopy } from "./errorCopy";

export type JobsListErrorVariant = "connectivity" | "auth" | "system" | "user";

export type JobsListErrorPresentation = {
  variant: JobsListErrorVariant;
  headline: string;
  sub: string;
};

/**
 * 创作记录列表专用：区分「连不上任务服务」与真实业务/鉴权错误，避免空环境或编排器未起时误用「开小差」吓人文案。
 * @param t i18n 文案函数（与全局错误页 errorPageCopy 一致）
 */
export function jobsListLoadErrorPresentation(
  raw: string,
  t: (key: string) => string
): JobsListErrorPresentation {
  const m = String(raw || "").trim();

  if (/未登录|需先登录|401|403|unauthorized|forbidden|登录已过期|token/i.test(m)) {
    return {
      variant: "auth",
      headline: "需要登录",
      sub: "登录后即可查看创作记录与任务状态。"
    };
  }

  if (/database_unavailable/i.test(m)) {
    return {
      variant: "connectivity",
      headline: "暂时无法加载列表",
      sub: "数据服务暂时不可用或繁忙，多为短暂故障。请稍后点击刷新；若长时间如此请联系客服。"
    };
  }

  if (/jobs_schema_outdated/i.test(m)) {
    return {
      variant: "system",
      headline: "列表暂不可用",
      sub: "服务端数据版本与接口不一致（常见于未执行数据库迁移）。请稍后重试或联系运维/客服处理。"
    };
  }

  if (/list_jobs_failed/i.test(m)) {
    return {
      variant: "system",
      headline: "创作记录加载失败",
      sub: "服务端处理列表时出错。请稍后重试；若反复出现请把下方提示原文发给客服便于排查。"
    };
  }

  if (
    /upstream_unreachable|orchestrator request failed|upstream|502|503|504|fetch failed|Failed to fetch|ECONNREFUSED|ECONNRESET|ENOTFOUND|network|连接.*被拒绝|超时|timed?\s*out|AbortError|bad gateway|nginx/i.test(
      m
    )
  ) {
    return {
      variant: "connectivity",
      headline: "暂时无法加载列表",
      sub: "多为编排器未就绪或网络抖动。确认服务已启动后点心刷新；尚无任务时加载成功后会显示「还没有创作记录」。"
    };
  }

  const tone = classifyErrorTone(m);
  const c = errorPageCopy(tone, t);
  return {
    variant: tone === "system" ? "system" : "user",
    headline: c.headline,
    sub: c.sub
  };
}
