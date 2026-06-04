# 写作 Cursor · Studio 产品规格（Agent-first，已落地对齐）

> **状态**：**v2.0 — 与工程主路径对齐**（2026-06-04）  
> **品类**：写作创作类型的 Cursor — 以 **稿件 + 版本 diff** 为中枢；**对话仅承载解释**，不以聊天气泡承载主成品  
> **关联**：[composer-first-product-architecture.md](./composer-first-product-architecture.md)（侧栏/四支柱，部分 supersede）· [home-composer-experts.md](./home-composer-experts.md)（专家 intake 流 **非** Studio 路径，Job 可复用）· 线框 **[writing-cursor-studio-wireframes.md](./writing-cursor-studio-wireframes.md)**（历史参考，见文首说明）  
> **工程锚点**：`StudioWorkEditor` · `StudioAgentDock` · `studioOrchestrator` · `studioWorkPlan` · `homeComposerExpertJob`

---

## 0. 落地前五决策（仍有效，UI 载体已更新）

| # | 决策项 | **冻结结论** | 当前落地 |
|---|--------|--------------|----------|
| **1** | 主入口 | **`/studio` 为创作主入口**；`/chat` 为经典对话 | ✅ 登录默认 `/studio`；列表页链到 `/chat` |
| **2** | 主实体 | **`Work` + `Manuscript`（版本链）** 为真相源；对话为解释轨 | ✅ `StudioWork` + `agentTurns` 仅解释；成稿在产物区 |
| **3** | 第一渠道 | **MVP 仅小红书 `xhs`** | ✅ 隐式渠道；无四专家下拉 |
| **4** | 改动单位 | **块级 Patch + Apply** 为默认 | ✅ 改版 Job → `pendingPatch` → 勾选采纳 |
| **5** | 导航 | 侧栏 **「创作」** → `/studio`；`/works` 为资产库 | ✅ `AppShell` · `WORKBENCH_STUDIO_PATH` |

**实现载体（v2，取代原「三栏 IDE」线框）**

```
任务侧栏（Works / New Agent）
        │
        ▼
单 Work 页：对话·解释（上）→ 产物·稿件（中）→ 输入框+资料（下）
        │
        ├─ 主编排：ask | plan | generate | revise
        └─ Rules 分层注入（无输入框 Rules 芯片）
```

**明确不做（产品红线，勿写回 P0）**

- 输入框 `@` 补全、模式芯片、Rules 芯片  
- `/studio` 内四专家 / 专家 intake 主路径  
- 侧栏多 Agent 分身、对话气泡冒充「成稿 Agent」  
- 计划后再二次「确认执行」卡片门禁（见 §6）

---

## 1. 定位（产品一句话）

**在你的资料库里，用可审阅的 AI 改动把小红书稿件做到能发。**

| 是 | 不是 |
|----|------|
| 编排驱动的创作台（解释 / 计划 / 成稿 / 改版） | 第二个 ChatGPT |
| Plan → 自动成稿 → 块级 diff | 先选专家再填表 |
| 一个 Work 一个渠道 | 同屏多格式勾选 |

---

## 2. 主实体（产品契约）

### 2.1 对象

| 对象 | 用户可见名 | 职责 |
|------|------------|------|
| **Work** | 创作任务 | 一次「要发出去」的事；状态、资料绑定、Rules |
| **Brief** | 需求 | 用户对话 + `brief` / `workRules` / `plan.goal` |
| **Binding** | 资料 | 笔记本 + 笔记 id 列表（输入框内「资料」下拉，**非 `@` 菜单**） |
| **Manuscript** | 稿件 | 版本 `v1, v2…`；块：标题、正文、话题、封面说明 |
| **Patch** | 改版提议 | Job 产出 → 对比勾选 → 合并新版本 |
| **Run** | 子任务轨迹 | `agentRuns[]`：plan / generate / revise（产物区轻量展示） |
| **agentTurns** | 对话·解释 | 澄清、运营建议、成稿后附言；**不**替代稿件正文 |

### 2.2 Work 状态（用户可见）

| 状态 | 含义 | 主界面 |
|------|------|--------|
| `briefing` | 澄清需求，未出计划 | 对话 + 输入；无稿件 |
| `planned` | 计划已出（瞬态） | 计划摘要；**随即自动成稿** |
| `generating` | 成稿/改版 Job 中 | 产物区进度文案（`runPhase`） |
| `ready` | 有可编辑稿件版本 | 产物区稿件 + 可选改版对比 |
| `shipped` | 归档态（保留字段） | **无「标记已发布」入口** |

### 2.3 与「会话」的关系

- **禁止**：以 `HomeComposerSession.turns[]` 驱动 Studio 成稿主流程。  
- **允许**：`/chat` 独立 session；资料与「我的特色」与 Studio 只读共享（`studioWorkStorage` / composer prefs）。

---

## 3. 信息架构与路由

### 3.1 路由

| 路由 | 角色 |
|------|------|
| **`/studio`** | Works 列表 |
| **`/studio/[workId]`** | 单任务创作页（Agent-first） |
| **`/chat`** | 经典对话 |
| **`/notes`** · **`/works`** | 不变 |

### 3.2 侧栏

| 一级 | 路由 |
|------|------|
| **创作** | `/studio` |
| 资料 | `/notes` |
| 作品 | `/works` |
| 创作工具 ▾ | 播客等（不变） |

### 3.3 单 Work 页布局（已落地，非三栏线框）

```
┌ 任务侧栏 ────┬─ 主栏（max-w-3xl 居中）────────────────────────┐
│ New Agent    │  【对话 · 解释】用户/助手气泡，可编辑用户句    │
│ 任务列表     │  【产物】标题「稿件」+ 一体正文块 + 成稿附言    │
│              │  【输入】Composer + 资料下拉 + 发送              │
└──────────────┴──────────────────────────────────────────────────┘
```

- **对话区**：需求澄清、运营类问答、成稿后温和附言（`postDoneCoach`，在稿件下方，无「亮点解读」等小标题）。  
- **产物区**：计划摘要（briefing/planned 瞬态）、生成进度、稿件、改版对比与采纳。  
- **输入区**：所有后续指令（含改版意见）**仅在此发送**。

---

## 4. 「创作」与「作品」边界

| 维度 | **创作 `/studio`（Work）** | **作品 `/works`（Job）** |
|------|---------------------------|---------------------------|
| 存什么 | 进行中任务 + 稿件版本链 | 已落库 Job 结果 |
| 用户动作 | 对话、自动成稿、Patch 采纳 | 试听、导出、分享 |
| 打通 | 生成 Job 可进 `/works`（沿用现网） | **未做**：列表「在 Studio 打开」、对话「升级为 Work」 |

---

## 5. 第一渠道：小红书（MVP 唯一）

- 创建即 `channel = xhs`，文案「发布到小红书」。  
- **Manuscript 块**：`title` · `body` · `hashtags` · `coverBrief`（说明文字，无真图生成）。  
- **不做**：四平台专家、多格式并行、公号/口播/播客 Channel（V1+）。

---

## 6. 主流程（编排 + 产物，已落地）

### 6.1 标准环

1. 用户在 **输入框** 描述需求；可绑 **资料**（笔记本 + 载入篇目）。  
2. 对话澄清（`ask`）；任务清楚后用户说 **「确认任务」** 等 → **`plan`**（`buildPlanForWork`）。  
3. 计划完成后 **自动 `generate`**（无需再点「确认执行」）。  
4. Job 完成 → 产物区 **稿件**（单块展示标题/正文/话题）。  
5. 可选：**成稿附言**（`postDoneCoach`，自然口吻，跟在稿件后）。  
6. 用户在输入框说改版 → **`revise`** Job → **Compare** → 采纳所选 / 全部 / 放弃 → 新版本。

### 6.2 主编排路由（`routeStudioAction`）

| 用户意图（示例） | 工具 | 说明 |
|------------------|------|------|
| 确认任务 / 生成计划… | `plan` | 仅 `briefing` 且无 plan |
| 确认 / 确认执行…（已有 plan） | `generate` | 亦可在自动链后省略 |
| 改版 / 改标题…（`ready`） | `revise` | 走 Job，非长文冒充已改完 |
| 其余 | `ask` | 流式解释；`question` ≤800 字，Rules/记忆走 prompt |

### 6.3 Rules（分层，无 UI 芯片）

| 层 | 来源 |
|----|------|
| 平台 | `studioPlatformRules` |
| 用户 | 对话页「我的特色」（只读引用） |
| 任务 | `workRules` / `plan.goal` |

### 6.4 验收（产品层）

| ID | 场景 | 状态 |
|----|------|------|
| A1 | 只采纳部分标题块，正文不变 | ✅ |
| A2 | 确认任务后自动成稿，无二次确认卡片 | ✅（取代旧「未 Confirm 不可 Run」） |
| A3 | 绑资料后 Plan/生成可使用篇目 | ✅ |
| A4 | 未绑资料时允许通识兜底（`allowModelFallback`） | ✅ 默认允许 |
| A5 | 列表可见 generating / ready | ✅ |
| A6 | 侧栏「创作」、默认 `/studio` | ✅ |
| A7 | Plan/产物区可见资料与特色状态 | ✅ 文案「我的特色」 |

---

## 7. 与经典对话 `/chat` 的迁移

| 阶段 | 用户可见 |
|------|----------|
| **T1（当前）** | Studio MVP + `/chat` 经典对话并存；用户句可编辑重发 |
| **T2** | `/works` 续做 Studio、对话「升级为 Work」 |
| **T3** | 评估专家块仅留 `/chat` |

---

## 8. Rules 与资料（命名）

| 概念 | Studio |
|------|--------|
| 我的特色 | 用户 Rules（对话页维护） |
| 资料笔记本 | Binding / Corpus |
| 专家人设 | **不用**；Channel 模板 + 编排 |

---

## 9. MVP 范围（与代码一致）

### 9.1 包含

- `/studio` 列表 + `/studio/[workId]` Agent-first 页  
- 任务侧栏：**New Agent**、删除任务  
- 小红书：对话 → 确认任务 → 计划 → **自动成稿** → 稿件  
- 块级 Patch：对比勾选、部分采纳  
- 分层 Rules；子任务轨迹 `agentRuns`；生成进度 `runPhase`  
- 成稿后 **postDoneCoach**（稿件下，自然对话）  
- 用户消息 **点击编辑** → 截断后续并重发  
- Work **云端同步**（`fym_studio_works_v1`）  
- 侧栏创作入口、登录默认 `/studio`  

### 9.2 不包含（勿写入待办 P0）

- `@` 补全、输入框 Rules/模式芯片  
- 三栏 Corpus | 稿件 | Agent Rail（历史线框）  
- 发布包 Tab / 7 步 Playbook 打勾（组件遗留未接线）  
- 「标记已发布」、二次「确认执行」卡片  
- 块级引用钉、脚注跳转资料  
- 计划后再手动点「确认生成」为主路径  
- 产物区独立改版输入框  
- `/studio` 四专家、侧栏多 Agent  
- 公号/口播/播客 Channel、自动发布 API、真封面图  
- best-of-N、团队协作、计费 UV 展示  
- `/chat`→Work、`/works`→Studio 双向入口  

---

## 10. 用户体验叙事（当前走通路径）

1. 侧栏 **创作** → **新建小红书任务**（或 New Agent）。  
2. 输入需求；可绑资料；与助手澄清。  
3. 回复 **「确认任务」** → 出计划 → **自动开始写稿**（进度：排队 / 检索 / 生成…）。  
4. 产物区出现 **稿件**（标题+正文+话题一体展示）；下方可有 **一两句温和附言**。  
5. 若要改稿：在 **同一输入框** 说「标题更短，正文别动」→ 对比 → **采纳所选** → 新版本。  
6. 在 **作品** 查看对应 Job（如已同步）。

---

## 11. 下游文档

| 文档 | 动作 |
|------|------|
| [composer-first-product-architecture.md](./composer-first-product-architecture.md) | 已 supersede 主入口；四支柱仍有效 |
| [home-composer-experts.md](./home-composer-experts.md) | 非 Studio UI 路径；`composer_expert_deliverable` 复用 |
| [writing-cursor-studio-wireframes.md](./writing-cursor-studio-wireframes.md) | 标 **历史参考**；实现以本文 §3.3、§16 为准 |

---

## 12. 国内竞品格局

> 结论不变：差异化在 **资料 + Work 版本 + Patch 审阅 + 编排可信**，而非「也能写小红书」。

（象限、对比表、话术见 v1.1 原文，此处不重复展开；季度更新竞品表即可。）

---

## 13. Cursor / Claude 吸收路线图（修订）

### 13.1 已吸收（MVP）

| 来源 | 能力 | Studio 对应 |
|------|------|-------------|
| Cursor | 主编排 / 子任务 | `studioOrchestrator` · `agentRuns` |
| Cursor | Rules 分层 | 平台 + 用户 + 任务 prompt |
| Cursor | Plan | `buildPlanForWork` → 自动 generate |
| Cursor | Diff / Apply | `pendingPatch` + 勾选采纳 |
| Claude | 成稿后短评 | `postDoneCoach`（非对话区小标题） |

### 13.2  backlog（未做，可排 V1+）

| 能力 | 说明 |
|------|------|
| `@` 笔记/段落 | 现为资料下拉 |
| 发布包 Ship Tab | `StudioManuscriptPanel` 未接入主路径 |
| 引用钉 / 证据脚注 | 块上仅资料/待核实标记（实现可隐藏「补充」） |
| 后台 Work + 通知 | — |
| best-of-N 标题 | — |
| 深度 Research Run、MCP、Skills | — |
| `/chat` 升级 Work、`/works` 打开 Studio | §7 T2 |
| 列表分段（进行中/可发布/已发布） | 现单列 + 状态 pill |

### 13.3 明确不吸收

纯聊天主界面、无门禁自动发布、专家人格主路径、代码 Terminal、Studio 内 `@` / 模式芯片。

---

## 16. UI 规格（Agent-first，已实现）

> **目标**：第一眼是 **产物·稿件**；解释在对话轨；指令在底栏。  
> **Token**：`HomeComposerShell` / `COMPOSER_CONTENT_MAX_W`（`max-w-3xl`）。

### 16.1 原则

| # | 原则 |
|---|------|
| 1 | 产物居中偏上，输入固定底部 |
| 2 | 稿件 **单标题「稿件」**，正文一体块（非多块卡片墙） |
| 3 | 改版 = 产物区 Compare + 输入框发指令 |
| 4 | 对话区仅解释；**禁止**把成稿全文塞进助手气泡 |
| 5 | 资料在输入区右下，点击空白关闭菜单 |

### 16.2 `/studio` 列表

- 标题「创作」；**新建小红书任务**；单列任务卡片（状态 + 资料 + `runPhase`）。  
- 页脚：经典对话 → `/chat`、已生成作品 → `/works`。  
- **无** 进行中/可发布/已发布 Tab 分段。

### 16.3 `/studio/[workId]`

| 区 | 内容 |
|----|------|
| 侧栏 | New Agent、任务列表、删除 |
| 对话 | 用户/助手；用户句悬停 **编辑/回滚** |
| 产物 | 错误、生成进度、计划（瞬态）、**稿件**、`postDoneCoach`、改版采纳条 |
| 输入 | `StudioAgentComposer`；快捷提示（空任务） |

### 16.4 稿件与复制

- 一块圆角容器内：标题、正文、话题、封面说明。  
- 复制：**图标按钮**（块级 + 复制全部）。  
- 证据：仅展示「资料」「待核实」（不展示「补充」字样）。

### 16.5 验收 U1–U4（取代原 U1–U6）

| ID | 检查 |
|----|------|
| U1 | 成稿后主视觉为产物区稿件，非长助手文 |
| U2 | 确认任务后自动进入生成，无二次确认大卡 |
| U3 | 改版后 Compare，可只勾标题 |
| U4 | 生成中 `runPhase` 随 Job 更新，非永久「生成稿件中…」 |

---

## 17. 工程实现索引

| 能力 | 锚点 |
|------|------|
| 列表 | `StudioWorksListClient` |
| 任务页 | `StudioWorkEditor` · `StudioAgentDock` |
| 编排 | `studioOrchestrator.ts` |
| 计划 | `studioWorkPlan.ts` |
| 成稿/改版 Job | `homeComposerExpertJob.ts` |
| 稿件/Patch | `studioDeliverable.ts` · `StudioOutputManuscript.tsx` |
| 产物区 | `StudioAgentOutputCards.tsx` |
| 成稿附言 | `studioPostDoneFollowUp.ts` |
| 存储/同步 | `studioWorkStorage.ts` |
| 导航 | `navPaths.ts` · `AppShell` |

**未接线遗留**：`StudioArtifactPanel` / `StudioManuscriptPanel`（含发布包 UI）— **不属当前 MVP**。

**手测**：创作 → 新建任务 → 对话澄清 → 确认任务 → 见进度 → 见稿件与附言 → 输入框改版 → 采纳所选。

---

## 15. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| **v2.0** | 2026-06-04 | **按 Agent-first 已落地功能重写**：删三栏/@/发布包/二次确认/标记已发布/产物区改版框；补编排、自动成稿、postDoneCoach、用户句编辑 |
| v1.4 | 2026-06-04 | 云端同步、默认 Studio（部分 UI 描述已被 v2 取代） |
| v1.3 | 2026-06-04 | 首版工程落地 |
| v1.0 | 2026-06-04 | 五决策冻结 |
