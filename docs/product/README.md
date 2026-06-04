# 产品文档索引

本目录收录**产品定位、商业化与规划**类文档；**技术架构、部署与运维**见仓库其他路径（文末「相关文档」）。

---

## 产品是什么

**Presto AI Podcast（FindingYourVoice）**：面向内容创作的 AI 工作台，核心路径包括「笔记 / 素材 → 播客与语音产物 → 作品管理与分发相关能力」，配套登录鉴权、订阅与用量。

一句话（**创作主入口，2026-06-04 起**）：**在你的资料库里，用可审阅的 AI 改动把稿件做到能发** — 见 [writing-cursor-studio.md](./writing-cursor-studio.md)。播客等重出口仍从作品/创作工具进。经典对话路径见 [composer-first-product-architecture.md](./composer-first-product-architecture.md)。

---

## 当前产品能力（按场景）

| 场景 | 说明 | 主要入口（Web） |
| ---- | ---- | ---------------- |
| 营销首页 | 产品介绍（无工作台侧栏） | `/` |
| 创作 Studio（**目标主入口**） | Works 列表 + 稿件编辑（写作 Cursor） | `/studio`（规格已冻结，待实现） |
| 经典对话 | 流式问答 + 过渡期 Composer | `/chat`（原 `/home` 重定向） |
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
| [writing-cursor-studio.md](./writing-cursor-studio.md) | **（现行创作主入口）** 五决策冻结；§12 竞品、§13 Cursor/Claude、§16 UI |
| [writing-cursor-studio-wireframes.md](./writing-cursor-studio-wireframes.md) | **Studio 线框图（Lo-Fi ASCII）**：Works、三栏 Studio、稿件/Compare/发布包、播客态 |
| [composer-first-product-architecture.md](./composer-first-product-architecture.md) | **对话/四支柱 v1.1**：资料·作品·工具仍有效；一级「对话」已由 Studio 文档 supersede |
| [home-composer-experts.md](./home-composer-experts.md) | **Composer 专家任务流（v3）**：**非 Studio MVP 路径**；Job/Playbook 可复用 |

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
