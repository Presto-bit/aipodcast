# BFF（Backend for Frontend）

本文档描述本仓库中 **BFF 的职责、实现位置与演进方向**，替代原先分散在 `services/bff/README.md` 与架构简述中的重复说明。

## 当前实现

- **位置**：`apps/web/app/api/**` 的 [Next.js Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)（App Router）。
- **上游**：浏览器与前端页面只与此 BFF 交互；BFF 再调用 **`services/orchestrator`**（FastAPI），使用环境变量中的 `ORCHESTRATOR_URL` / `NEXT_PUBLIC_ORCHESTRATOR_URL` 及编排器要求的 **HMAC 内部签名头**（`x-internal-timestamp`、`x-internal-payload-sha256`、`x-internal-signature`），与 [`cloudflare-gateway-baseline.md`](./cloudflare-gateway-baseline.md) 中的零信任基线一致。

## 职责（应用层）

- 鉴权相关请求头的透传与过滤（会话 / 用户上下文进入编排器前在边缘或 BFF 侧收敛）。
- 面向编排器的 **内部请求签名**，避免公网直达编排器。
- 简单 **限流** 或与其他中间件配合的占位（具体策略可按部署调整）。
- **统一错误码 / 响应形态**，便于前端消费。

## 与 `services/bff` 目录

- `services/bff/` **暂不承载运行时代码**，仅作 **独立 BFF / API Gateway** 的占位。
- 当路由、鉴权聚合或协议适配复杂度继续上升时，可将上述能力 **从 `apps/web` 的 Route Handlers 拆出** 到独立 Node（或其他运行时）服务，再与此目录对齐。

## 相关文档

- [AI-Native 平台底座](./ai-native-platform.md) — 服务分层与本地启动。
- [Cloudflare 网关基线](./cloudflare-gateway-baseline.md) — DNS、边缘 WAF/缓存、BFF→编排器访问控制。
