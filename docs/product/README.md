# 产品文档索引

本目录收录**产品定位、商业化与规划**类文档；**技术架构、部署与运维**见仓库其他路径（文末「相关文档」）。

---

## 产品是什么

**Presto AI Podcast（FindingYourVoice）**：面向内容创作的 AI 工作台，核心路径包括「笔记 / 素材 → 播客与语音产物 → 作品管理与分发相关能力」，配套登录鉴权、订阅与用量。

一句话：**带着自己的资料，在对话里说一句话，拿走能发的成品**；播客等重出口可一键试听或送进工作室精修。详见 [composer-first-product-architecture.md](./composer-first-product-architecture.md)。

---

## 当前产品能力（按场景）

| 场景 | 说明 | 主要入口（Web） |
| ---- | ---- | ---------------- |
| 营销首页 | 产品介绍（无工作台侧栏） | `/` |
| 工作台首页 | 登录后总览与快捷入口 | `/home` |
| 笔记 | 笔记创作、笔记本风格 IP、回收站 | `/notes`、`/notes/trash` |
| 播客 | AI 播客流程、正文模板等 | `/podcast` |
| 文稿剪辑 | 上传干声、豆包词级转写、点词剪辑、导出 MP3 | `/clip` |
| 文本转语音 | TTS | `/tts` |
| 音色 | 音色浏览与管理（含原「笔记模板」入口重定向） | `/voice` |
| 任务 | 任务列表与详情 | `/jobs`、`/jobs/[jobId]` |
| 作品 | 作品库、导出、分享 | `/works`、`/works/[jobId]`、`/works/share/[jobId]` |
| 草稿 | 草稿管理 | `/drafts` |
| 订阅与个人 | 订阅、个人资料 | `/subscription`、`/me/profile` |
| 帮助 | 帮助页 | `/help` |
| 管理后台 | 用户、任务、用量、订阅矩阵、模型配置等 | `/admin/usage` 等 |

**本地与 CI 自检**：根目录 [README.md](../../README.md)「功能与本地检查」一节；端到端说明见 [docs/operations/README.md](../operations/README.md)。

---

## 本目录文档

| 文档 | 用途 |
| ---- | ---- |
| [subscription-experience-pricing-playbook.md](./subscription-experience-pricing-playbook.md) | 个人创作者向：**Free / Pro / Creator** 权益、体验礼包、按次分钟包、触发与引导、定价与埋点口径、落地节奏与文案原则 |
| [future-roadmap.md](./future-roadmap.md) | **Backlog**：多平台管家、内容再造、叙事剪辑师等方向；**非迭代承诺**，实现前需单独评审 |
| [author-ip-product-v5.md](./author-ip-product-v5.md) | **（历史）个人特色 IP v5.2**：独立工作台方案；**现行以 [v6](./author-ip-product-v6.md) 为准** |
| [author-ip-product-v6.md](./author-ip-product-v6.md) | **个人特色 IP（v6.2，现行）**：笔记本即 IP；一键提炼；三端默认本笔记本风格 |
| [author-ip-execution-schedule.md](./author-ip-execution-schedule.md) | **（历史排期）** v5 迭代 1～15；独立工作台/API 已下线，见 v6 |
| [composer-first-product-architecture.md](./composer-first-product-architecture.md) | **（现行方向）对话主入口 v1.1**：四支柱、侧栏 IA（无 drafts/侧栏回收站）、handoff、排期 |
| [home-composer-experts.md](./home-composer-experts.md) | **首页 Composer 创作专家（v3）**：专家任务流、资料计划；实现须与 architecture 文档对齐 |

---

## 相关文档（非产品专档）

| 路径 | 内容 |
| ---- | ---- |
| [README.md](../../README.md) | 技术栈、本地开发、部署入口、鉴权与数据治理要点 |
| [DEPLOYMENT.md](../../DEPLOYMENT.md) | 服务器部署 |
| [docs/operations/README.md](../operations/README.md) | 运维索引、E2E、PG 与切流等 |
| [docs/architecture/ai-native-platform.md](../architecture/ai-native-platform.md) | 服务分层、任务状态机、事件协议 |
| [docs/architecture/bff.md](../architecture/bff.md) | Next.js BFF（Route Handlers） |
| [docs/migration/cutover-runbook.md](../migration/cutover-runbook.md) | 切流运行手册 |

---

## 文档维护约定

- **产品策略与定价**：以 `subscription-experience-pricing-playbook.md` 为执行口径；代码与配置变更时应核对是否仍一致。
- **远期想法**：只写入 `future-roadmap.md`，避免与当前版本说明混在同一篇导致误解。
- **新增长文产品说明**：优先放入 `docs/product/`，并在此 README 表格中登记一行摘要链接。
