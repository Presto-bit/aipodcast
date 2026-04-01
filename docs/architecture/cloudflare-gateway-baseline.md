# Cloudflare 网关基线

应用层 BFF 的职责与代码位置见 [bff.md](./bff.md)。

## DNS 与入口
- `app.example.com` -> Cloudflare Proxy -> Next.js Web/BFF
- `api.example.com`（可选）-> Cloudflare Proxy -> 独立 BFF（未来）

## 安全基线
- 开启 WAF Managed Rules。
- 开启 Bot Fight Mode（可按业务灰度）。
- 对 `/api/*` 启用速率限制（边缘 + 应用双层）。
- 仅允许 BFF 到 Orchestrator 的内网访问。

## 缓存策略
- `/_next/static/*`：长缓存。
- `/api/*`：默认不缓存，SSE 路径强制 no-cache。
- 对象下载路径可按 artifact hash 做可控缓存。

## 零信任建议
- Worker/BFF 到 Orchestrator 使用 HMAC 内部签名头：
  - `x-internal-timestamp`
  - `x-internal-payload-sha256`
  - `x-internal-signature`
- Orchestrator 侧强制校验签名并记录审计日志。
