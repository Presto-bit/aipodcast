# 写作 Cursor · Studio 产品规格（五决策已冻结）

> **状态**：产品规格 **已拍板**（产品层，待工程排期）  
> **日期**：2026-06-04  
> **品类**：写作创作类型的 Cursor — 以 **稿件 + 版本 diff** 为中枢，不以会话气泡为中枢  
> **关联**：[composer-first-product-architecture.md](./composer-first-product-architecture.md)（侧栏/四支柱，部分 supersede）· [home-composer-experts.md](./home-composer-experts.md)（专家任务流，Studio MVP 不采用）· 技术 Job 可复用 `composer_expert` / `social_publish`  
> **扩展**：§12 国内竞品 · §13 Cursor/Claude 吸收路线图 · §16 **UI 规格** · §14 工程/设计增补

---

## 0. 落地前五决策（已按建议冻结）

| # | 决策项 | **冻结结论** | 产品层含义（必须遵守） |
|---|--------|--------------|------------------------|
| **1** | 主入口 | **新建 `/studio` 为默认创作主入口**；`/chat`（原 `/home`）保留为 **经典对话模式**，过渡期并存，最终降级为二级入口 | 登录后默认落地 **Works 列表 → Studio**；营销与 onboarding 主 CTA 指向 `/studio`；`/chat` 仅服务「纯问答、无 Work」或老用户习惯 |
| **2** | 主实体 | **`Work` + `Manuscript`（版本链）** 为唯一任务真相源；`Session/Turn` 不作为创作主实体 | 用户心智是「工单 / 稿件」，不是「聊天记录」；续做、改版、发布追踪均挂在 `workId`；聊天内容降级为 Run 内的 `note` 或 Attach |
| **3** | 第一渠道 | **MVP 仅 `xhs`（小红书）一个 Channel Template** | 不暴露四专家下拉、不多格式并行；公号/口播/播客 **不出现在 Studio MVP** 创建流（仍可从 `/works`、播客工作室等既有入口进） |
| **4** | 改动单位 | **块级 `Patch` + Apply** 为默认交互；全文重生成仅为兜底 | MVP 至少支持 **标题组（多 block）+ 正文（单 block）** 的 diff 与部分采纳；禁止「只能覆盖整篇」作为唯一改版路径 |
| **5** | 导航心智 | 侧栏一级由 **「对话」改为「创作」**，路由 **`/studio`**；**「作品」`/works` 保留** 为记忆与资产库 | 对外文案：创作 = 进行中 Works + Studio；作品 = 已生成 Job/历史资产（与现网一致，边界见 §4） |

**五决策之间的关系**

```
导航「创作」/studio ──► Works 列表 ──► Studio(Work)
                              │
主实体 Work + Manuscript ◄────┘
                              │
第一渠道 xhs ──► Channel Template（schema + Playbook）
                              │
改动单位 Patch ◄── Agent Run 输出
```

---

## 1. 定位（产品一句话）

**在你的资料库里，用可审阅的 AI 改动把小红书稿件做到能发，并拿走发布清单。**

| 是 | 不是 |
|----|------|
| 创作 IDE（稿件居中） | 第二个 ChatGPT |
| Plan → Run → Diff → Apply | 先选专家人格再填表 |
| 一个 Work 一个主渠道 | 同屏多格式勾选 |

---

## 2. 主实体（产品契约，工程可对齐）

### 2.1 对象

| 对象 | 用户可见名 | 职责 |
|------|------------|------|
| **Work** | 创作任务 | 一次「要发出去」的事；含渠道、状态、绑定的资料与 Rules |
| **Brief** | 需求说明 | 用户意图快照（一句话 + 结构化字段） |
| **Binding** | 资料范围 | 笔记本 / `@` 指定的笔记集合 |
| **Manuscript** | 稿件 | 当前可编辑成品；**版本** `v1, v2…` 不可变 |
| **Block** | 段落/块 | 标题项、正文、话题等；diff 与 Apply 的最小单位 |
| **Patch** | AI 提议 | 对 Block 的增删改提案；用户勾选后合并为新版本 |
| **Run** | 生成记录 | 一次 Plan/Generate/Revise 的执行；可折叠轨迹 |
| **ShipPack** | 发布包 | Playbook 步骤 + 可复制块（与稿件同级 Tab） |

### 2.2 Work 状态（用户可见）

| 状态 | 含义 | 主界面 |
|------|------|--------|
| `briefing` | 仅有 Brief，未 Plan | Studio：空稿 + 右侧 Brief |
| `planned` | Plan 已出，未确认 Run | Studio：Plan Card 置顶 |
| `generating` | Run 进行中 | Studio：进度 + 稿件预览只读 |
| `ready` | 有可用 Manuscript 版本 | Studio：编辑 + diff + Ship |
| `shipped` | 用户标记已发布（手动，P0） | Works 列表归档态 |

### 2.3 与「会话」的关系

- **禁止**：以 `HomeComposerSession.turns[]` 驱动 Studio 主流程。  
- **允许**：`/chat` 继续使用 session/turn；用户从对话 **「升级为 Work」**（P1）时拷贝 Brief + Binding，而非自动等价。

---

## 3. 信息架构与路由（产品冻结）

### 3.1 路由

| 路由 | 角色 | 默认 |
|------|------|------|
| **`/studio`** | Works 列表（进行中优先） | 登录后创作主入口 |
| **`/studio/[workId]`** | 三栏 Studio | 点击某 Work |
| **`/chat`** | 经典对话 Composer | 二级；侧栏或 Works 页脚「纯聊天」 |
| **`/notes`** | 资料 | 不变 |
| **`/works`** | 作品记忆（Job 资产） | 不变；见 §4 |

### 3.2 侧栏（supersede composer-first §2 一级「对话」）

| 现网 v1.1 | **Studio 路线（冻结）** |
|-----------|-------------------------|
| 对话 `/home`→`/chat` | **创作** `/studio`（short：**创**） |
| 资料 `/notes` | 资料 `/notes`（不变） |
| 作品 `/works` | 作品 `/works`（不变） |
| 创作工具 ▾ | 创作工具 ▾（不变） |

**折叠态窄轨**：`创` | `料` | `作` | `具`（无「话」）。

### 3.3 Studio 三栏（单 Work 页）

```
┌ Corpus ─────┬─ Manuscript Editor ─────┬─ Agent Rail ─┐
│ @ 资料      │  Block 结构 + 版本 v▼    │ Plan         │
│ 引用钉选    │  [Compare] [Apply]      │ Chat（解释） │
│             │  Tab: 稿件 | 发布包      │ Runs         │
└─────────────┴──────────────────────────┴──────────────┘
```

- **Chat** 仅解释 Plan、引用依据；**不**替代 Patch Apply。  
- **发布包** = 原专家模式 `Ops Playbook` 的产品化命名，MVP 跟小红书模板走。

---

## 4. 「创作」与「作品」边界（避免双列表心智）

| 维度 | **创作 `/studio`（Work）** | **作品 `/works`（Job 资产）** |
|------|---------------------------|-------------------------------|
| 存什么 | 进行中的任务 + 稿件版本链 | 已落库的 Job 结果（音频、历史社媒稿等） |
| 用户动作 | Plan、Apply、Ship 打勾 | 试听、导出、分享、回到 Studio 续做 |
| MVP 关系 | 生成 **完成后** 可「保存为作品」写入 `/works`（同现 Job） | 列表中 **「在 Studio 中打开」** 仅当该 Job 能映射为 Manuscript（P1）；MVP 可只做 forward：Studio Run 完成 → 自动出现到 `/works` |

**冻结**：不合并两个列表为一个页面；用文案区分 **「进行中」vs「已归档资产」**。

---

## 5. 第一渠道：小红书 Channel Template（MVP 唯一）

### 5.1 用户创建 Work 时

- 不展示渠道选择器；**隐式 `channel = xhs`**。  
- 文案：**「发布到小红书」**（可副标题：公号/口播即将接入）。

### 5.2 Manuscript Blocks（MVP 最小集）

| blockId | 类型 | Apply 粒度 |
|---------|------|------------|
| `title.*` | 标题候选（多条） | 每条独立 |
| `body` | 正文 | 整段 |
| `hashtags` | 话题 | 整段 |
| `coverBrief` | 封面说明（假预览 P0） | 可选 P0 只读 |

### 5.3 ShipPack

- 复用红书 **7 步 Playbook** 产品语义（制作→发布→互动→复盘）；步骤 **手动打勾**，不接平台 API。  
- 与 [home-composer-experts.md §8](./home-composer-experts.md) Ops 对齐内容，**交互**改为 Ship Tab，不再用专家 intake 流。

### 5.4 明确 MVP 不做

- 四平台专家 ▾、`ComposerExpertBlocks` intake/confirm 作为主路径。  
- 多格式并行 Job。  
- 公号/口播/播客 Channel（V1+）。

---

## 6. 块级 Patch + Apply（产品交互冻结）

### 6.1 标准环

1. 用户 Brief + `@` Binding + Rules  
2. **Plan Card** → 用户 **确认 Run**（门禁：未确认不生成）  
3. Agent 输出 **Patch 集**（非默认全文替换）  
4. UI **Compare** `v{n}` vs `v{n+1}` 预览  
5. 用户 **Apply selected / Apply all / Reject**  
6. 合并为新的 **Manuscript 版本**（immutable）

### 6.2 Revise（改版）输入

- 占位符：**「对 v2 改：…」**  
- 解析为 **scope**：`titles_only | body | hashtags | full`（产品展示为自然语言，内部可结构化）  
- **默认** 走 Patch；仅当用户选「全文重生成」或校验失败时走全文兜底（需二次确认）。

### 6.3 验收（产品层，发布前必过）

| ID | 场景 |
|----|------|
| A1 | 只 Apply 2 个标题，正文与 v1 字节级一致 |
| A2 | Plan 未点确认时，Run 按钮不可用或无效 |
| A3 | `@` 绑定笔记本后，Plan 列出将用的篇名（≥1 篇时有列表） |
| A4 | 资料为空时，须勾选「允许通识兜底」才可 Run |
| A5 | Works 列表可见状态 `generating` / `ready` |
| A6 | 侧栏一级为「创作」，默认路由 `/studio` |
| A7 | Rules（Voice）在 Plan 上显示「已生效 / 未填」 |

---

## 7. 与经典对话 `/chat` 的迁移（产品节奏）

| 阶段 | 用户可见 |
|------|----------|
| **T0 现网** | 默认 `/chat`，专家模式可选 |
| **T1 Studio MVP** | 新用户 onboarding → `/studio`；侧栏「创作」；`/chat` 标「经典对话」 |
| **T2** | Works 详情「用 Studio 改版」；对话内「转为创作任务」 |
| **T3** | 评估下线专家块主路径或仅保留在 `/chat` |

**冻结**：T1 起 **不在 `/studio` 复刻四专家 intake**；避免双套任务流。

---

## 8. Rules 与资料（继承现网概念）

| 现网概念 | Studio 命名 |
|----------|-------------|
| 我的特色 `featureCore` | **Voice Rules** |
| 写作习惯 | **Style Rules**（MVP 可合并进 Plan 展示） |
| 资料笔记本 | **Binding / Corpus** |
| 专家人设 | **废弃**；改为 Channel 模板说明条 |

Work 级 **本篇约束**（Work Rules）：如「今晚必发」「别提竞品 X」— P0 可在 Brief 附加，P1 独立面板。

---

## 9. MVP 范围清单（产品交付定义）

### 9.1 包含

- `/studio` Works 列表 + `/studio/[workId]` 三栏  
- 单渠道小红书：Brief → Plan → Run → Manuscript v1  
- 块级 Patch：标题组 + 正文；Compare + Apply  
- Ship Tab：Playbook 勾选 + 复制块  
- Voice Rules 与 Binding 在 Plan 可见  
- Run 进度与失败可重试（用户文案，非技术细节）  
- 生成完成 → 出现在 `/works`（沿用 Job，类型可与现 `social_publish` / `composer_expert` 对齐）

### 9.2 不包含（MVP）

- `/studio` 内公号/口播/播客  
- 平台自动发布 API  
- 真封面 PNG 生成（P1）  
- best-of-N 多稿并行  
- 团队协作  
- 计费/UV 展示（继续暂缓，与 [home-composer-experts](./home-composer-experts.md) 一致）

---

## 10. 用户体验叙事（MVP 走通一次）

1. 登录 → 侧栏点 **「创作」** → Works 列表，点 **「新建小红书任务」**。  
2. Studio 打开：左侧 `@产品笔记`，中间空稿，右侧写 Brief：「把 Q1 复盘写成可发笔记」。  
3. 点 **生成计划** → Plan Card 展示结构、资料 3 篇、Voice 已启用。  
4. 点 **确认生成** → 进度条；中间出现 **v1**（3 标题 + 正文 + 话题）。  
5. 右侧输入「标题太温，正文别动」→ **对比视图** → 只勾选 2 个新标题 → **采纳** → **v2**。  
6. 切 **发布包**：复制发布文案，勾选「已发布」。  
7. 回 Works 列表：任务 **可发布**；在 **作品** 中看到对应 Job，可复制到小红书。

用户应能描述为：**「像 Cursor 改稿，不是像聊天碰运气。」**

---

## 11. 文档与实现优先级（产品 → 工程输入）

| 下游文档/模块 | 动作 |
|---------------|------|
| [composer-first-product-architecture.md](./composer-first-product-architecture.md) | §2 一级入口、§1.1 一句话 — 标注 **Studio 路线 supersede**，见该文顶部说明 |
| [home-composer-experts.md](./home-composer-experts.md) | 标注 **非 Studio MVP 路径**；Job/schema 可复用 |
| `navPaths` / `AppShell` / `i18nDict` | 工程：创作 `/studio`、默认重定向 |
| 新建 PRD 附录（工程） | Block/Patch JSON schema、Plan API 字段 — **实现阶段**再写 |
| **§12–§14** | 竞品与 Cursor/Claude 路线图 — 评审、排期、对外话术 |

---

## 12. 国内竞品格局（2026，产品判断）

> **结论**：国内有**片段重叠**的竞品，尚无完整对标「写作版 Cursor」的产品；差异化应打在 **Corpus + Plan/Patch + Work 版本 + Ship** 组合，而非「也能 AI 写小红书」。

### 12.1 象限（资料强度 × 发布闭环）

```
                    强「个人资料 / RAG」
                           ↑
              得到大脑(原Get笔记)    腾讯 IMA
              语雀 AI               飞书知识库
                           │
    弱「可发布闭环」 ────────┼──────── 强「发布闭环」
                           │
              秘塔 / 笔灵 / 橙篇      壹伴 / 小墨鹰 / 有一云
              Kimi / 豆包             小红书垂直助手
                           ↓
                    弱「个人资料」
```

**Studio 目标象限**：右上（强资料 + 强发布闭环 + **块级 diff**）— 国内仍属空白带。

### 12.2 最接近玩家（重叠度）

| 产品 | 重叠能力 | 与 Studio 差距 |
|------|----------|----------------|
| **得到大脑（原 Get 笔记）** | 记录→知识库→多智能体→小红书/公号；GetDraft | 主路径非 Work+Patch；偏移动记录，弱审阅改版 |
| **腾讯 IMA** | 知识库 + 搜公众号 + 写稿 | 弱渠道模板、Playbook、版本 diff |
| **语雀 AI** | 结构化知识库 + 协作写作 | B 端文档，非「复制就能发」工单 |
| **有一云 / AIWriteX** | 多平台智能体、分发 | 矩阵分发强，弱个人 Corpus 与 Patch |
| **笔灵 AI** | 场景模板、小红书爆款 | 模板/chat 全文，无 Plan 门禁与块级 Apply |
| **壹伴 / 小墨鹰** | 公号 AI 写+排版插件 | 单渠道、资料在外部、无稿件版本链 |
| **秘塔 / 橙篇 / 火山写作** | 润色、长文、办公 | 无「笔记=工作区」 |
| **Kimi / 豆包 / 通义** | 长文、通用问答 | 无 Work、无 Ship Playbook |

**海外参照（用户混用，非国内直接竞品）**：Notion AI（Q&A+写作）、Jasper 类（营销文案）。**Cursor 不覆盖写作发布**。

### 12.3 能力组合在国内的常见度

| 组合 | 国内 |
|------|------|
| 个人笔记/RAG 写作 | ✅ 多 |
| 小红书/公号 AI 成稿 | ✅ 多 |
| 多平台分发 | △ 部分 |
| Plan 确认后再生成 | △ 弱 |
| 块级 diff + 部分采纳 | ❌ 极少 |
| 发布 Playbook（发后步骤内嵌） | △ 弱 |
| Work 工单 + 稿件 v1/v2 | ❌ 基本没有 |
| 播客素材与同 Corpus 多形态 | △ **本产品差异化** |

### 12.4 对外差异化话术（打竞品用）

| 对比 | 一句话 |
|------|--------|
| vs 笔灵 / 有一云 | 不是换模板，是在**你自己的笔记里改稿**，改哪段你说了算 |
| vs Get / IMA | 不只问知识库，是**做到能发 + 发完有清单** |
| vs 壹伴 | 不只排版，是**资料→稿件→版本**全链 |
| vs Kimi | 不是聊天，是**创作 IDE**（Plan、Apply、Works） |

**建议品类自称**：「发布型创作 IDE」或「带资料库的 Cursor 写作台」（国内尚无成熟品类名）。

### 12.5 竞争风险（产品）

1. **大厂组合抄袭**：IMA/语雀加发布清单即可逼近叙事 — 需尽快占 **Work + diff** 心智。  
2. **得到大脑路线最近**：记录→多智能体→小红书，用户重叠高 — 差异在 **Studio 三栏 + Patch**。  
3. **迁移成本**：壹伴/笔灵存量用户 — 依赖 `/works` 续做、对话「升级为 Work」（§7 T2）。  
4. **「Kimi 够用」**：须卖**可信、可改、可续**，非「也能生成」。

---

## 13. Cursor / Claude 能力吸收路线图

> **原则**：从 **Cursor** 吸收「工作区、@、Plan、diff、Rules、Agent 透明、后台任务」；从 **Claude** 吸收「项目知识、Artifacts、深度调研、引用溯源」。全部挂在 **Work / Manuscript**，**不**靠加长聊天记录。  
> **禁止硬抄**：无限聊天主界面、无确认自动发布、黑盒专家人格、全文覆盖式重 roll（见 §13.4）。

### 13.1 映射总表

| 来源 | 原能力 | Studio 对应物 | 优先级 |
|------|--------|---------------|--------|
| Cursor | `@file` / `@folder` / `@Docs` | `@笔记` `@笔记本` `@段落` `@v{n}` `@模板` | P0（§3、§6） |
| Cursor | Plan mode | **Plan Card** + Confirm Run | P0 |
| Cursor | Diff / Apply | **Block Patch** + Compare + Apply selected | P0 |
| Cursor | Rules | Voice + Channel + Work Rules | P0 |
| Cursor | Agent tool 轨迹 | **Run 折叠条**（检索→写块→校验） | P0.5 |
| Cursor | Background agent | Works 列表后台 Generating + 通知 | P1 |
| Cursor | MCP | Corpus 导入、导出草稿、日历提醒等 | P1.5 |
| Cursor | Skills | 用户/团队 **创作 Skill**（Brief+Plan 模板） | P1 |
| Cursor | Best-of-N | 标题 3 组并排选 Apply | P1 |
| Cursor | Tab 补全 | 编辑器内续写下一句 | P2 |
| Cursor | Checkpoints | 版本自动快照 / 回滚 | P2 |
| Claude | Projects + 知识 | **Corpus = Project**；Work 继承默认 Binding | P0.5 |
| Claude | Artifacts | **稿件 Tab** + **发布包 Tab** 双 Artifact | P0.5 |
| Claude | 深度思考 / Research | **深度 Run**（仅提纲+摘要+待核实） | P1.5 |
| Claude | 引用溯源 | 块脚注 `[1][2]` + 证据三档标记 | P0.5 |
| Claude | Project memory | Work 内偏好（显式、可删） | P1 |
| Claude | Cowork / 文件夹 | 监听目录新笔记入 Corpus | P2 |

### 13.2 P0 / P0.5 — 与 MVP 对齐（必做或紧跟 MVP）

#### （1）`@` 上下文 + 引用钉（Cursor）

- Brief / 编辑器 / Agent 输入统一 `@` 菜单。  
- Manuscript 块旁 **引用钉**：`[资料: 标题]` → 跳转 Corpus。  
- **验收**：Plan 列出将用篇名；正文至少 1 处可点引用（P0.5 可先做 Plan 列表，块内钉选跟 MVP+1 周）。

#### （2）Plan Card 加深（Cursor Plan + Claude 对齐）

- 除结构/资料外，增加：**风险**（缺资料、违规词）、**Applied rules**、可编辑大纲顺序。  
- 未 Confirm **不可 Run**（与 §6.3 A2 一致）。

#### （3）双 Artifact（Claude）

| Tab | 对象 | 行为 |
|-----|------|------|
| **稿件** | Manuscript blocks | 编辑、Patch、Apply、版本 v▼ |
| **发布包** | ShipPack | Playbook 勾选、复制块；改标题时提示同步检查转发语（P1） |

- 右侧 Agent 默认「对当前 Tab 的 Artifact 操作」，避免漂在聊天里。

#### （4）证据三档 + 脚注（Claude Research）

| 标记 | 含义 |
|------|------|
| 来自资料 | 有 corpus chunk id |
| 模型补充 | 无引用，Plan 已勾选兜底 |
| 待核实 | 敏感事实，发布前人工确认 |

#### （5）Run 透明条（Cursor Agent）

- 折叠示例：`检索 3 篇 · 生成标题组 · 校验 schema`；失败标明步骤；支持取消。  
- 不默认展示原始 prompt（进阶可展开「技术详情」）。

### 13.3 P1 — 留存与差异化

| 能力 | 说明 | 来源 |
|------|------|------|
| 后台 Work | 关页继续 Run；Works 列表进度 | Cursor Background |
| 标题 best-of-N | 3 组标题对比，选一组 Apply | Cursor 多分支 |
| 创作 Skill | 保存「清单体复盘」= Brief+Plan+Block 预设 | Cursor Skills |
| Work 偏好记忆 | 「用户常拒绝绝对化」— 显式 opt-in，可删 | Claude Projects memory |
| Revise 结构化 | `titles_only \| body \| full` → 映射 Patch scope | Cursor 意图+局部改 |
| 深度 Research Run | 可选：只出提纲+资料摘要+待核实清单，再 Produce | Claude extended |

### 13.4 P1.5 / P2 — 生态与进阶

| 能力 | 说明 |
|------|------|
| **MCP / 开放** | Notion/飞书导入 Corpus；导出公众号草稿；违规词库 Channel Rules |
| **Tab 续写** | 正文/口播块内低延迟补全 |
| **Checkpoints** | 每次 Apply 前自动快照 |
| **桌面监听** | 文件夹新 md → Corpus（Claude Cowork 式） |
| **Canvas** | 竞品矩阵、选题表（知识工作者，可选独立视图） |
| **多 Agent 叙事** | UI 展示 Strategist/Writer/Editor 分工（与 Get 笔记叙事兼容，底层仍单 Run） |

### 13.5 明确不吸收（产品红线）

| 能力 | 原因 |
|------|------|
| 纯聊天主界面 | 品类是 IDE，见 §0、§3 |
| 无门禁全自动发布 | 合规与信任 |
| 「选专家人格」主路径 | 用 Channel Template + Rules（§5） |
| 代码 Terminal | Ship 人工 checklist 即可 |
| 每次全文重生成作为唯一改版 | 违背 §0 决策 #4 |

### 13.6 路线图一览（工程排期可引用）

```
P0   Plan · @ · Patch Apply · Rules 显式        （§9 MVP）
P0.5 双 Artifact · 引用/证据 · Run 条 · Corpus=Project
P1   后台 Work · best-of-N 标题 · Skills · Work 偏好 · 结构化 Revise
P1.5 深度 Research Run · MCP 导入/导出
P2   Tab 续写 · Checkpoints · 桌面 Corpus · Canvas
```

### 13.7 与竞品的组合优势（对外叙事）

| 组合 | 国内常见缺口 |
|------|----------------|
| Corpus(Project) + Artifact(稿件) + Patch(Cursor) | Get/笔灵仅有片段 |
| Plan + 引用 + Apply | 有一云/笔灵：快但难核对、难只改一段 |
| Rules + Run 轨迹 | 大模型 App：无工单与过程可信 |
| MCP + 播客同库 | 纯图文工具无音视频后链路（**本产品**） |

---

## 16. UI 规格（贴合最终成品要求）

> **目标**：用户打开即知「在改一份要发的稿件」，而非「在聊天」。视觉锚点 = **Manuscript 编辑区**；输入与 Agent 为附属。  
> **实现锚点**：沿用 `HomeComposerShell` / `HomeComposerFirstScreenDemo` 的 token（`brand`、`line`、`surface`；中栏 `max-width: 820px` 参考 `COMPOSER_CONTENT_MAX_W`）；**禁止**用对话气泡流承载主成品。

### 16.1 五条 UI 原则

| # | 原则 | 落地 |
|---|------|------|
| 1 | **成品在上、输入在下** | 中栏 Manuscript 占 ≥60% 可视高度；Brief/改版输入在**中栏底或右栏底**，不置顶 |
| 2 | **块可扫、可点、可采纳** | 标题/正文/话题为**卡片块**，非一整段 Markdown 气泡 |
| 3 | **状态永远可见** | 顶栏 Work 条：渠道 · 状态 · 版本 · 资料 · Rules |
| 4 | **改稿 = diff，不是新消息** | 改版出现 **Compare 条** 或并排对比，不用新 `UserBubble` |
| 5 | **聊天降级** | 右栏 Chat 默认折叠或窄轨；Plan / Runs 优先 |

### 16.2 页面级布局

#### A. `/studio` — Works 列表（创作首页）

```
┌────────────────────────────────────────────────────────────┐
│ 创作                                    [+ 新建小红书任务]  │
├────────────────────────────────────────────────────────────┤
│ [进行中] [可发布] [已发布]                    🔍 搜索…      │
├────────────────────────────────────────────────────────────┤
│ ● 小红书 · Q1产品复盘          Generating 62%    2分钟前   │
│   资料·产品笔记(3) · v1 草稿                              │
├────────────────────────────────────────────────────────────┤
│ ○ 小红书 · 清单体教程          待确认计划        昨天      │
│   缺资料 · 未填 Voice                                     │
└────────────────────────────────────────────────────────────┘
│ 经典对话 → /chat          在作品中查看 → /works            │
└────────────────────────────────────────────────────────────┘
```

| 元素 | 规范 |
|------|------|
| 行卡片 | 左：渠道 chip（粉红「小红书」）+ 任务标题一行；右：状态 pill + 时间 |
| 副行 | `资料·N篇 · v{n} · Voice✓/未填`；`generating` 时细进度条 |
| 主 CTA | 右上实心 `brand`「新建」；空状态中央同 CTA + 3 条示例 Work |
| 勿用 | 会话标题列表、侧栏气泡预览 |

#### B. `/studio/[workId]` — Studio 三栏

**桌面（≥1024px）建议比例**

| 栏 | 宽度 | 职责 |
|----|------|------|
| **左 Corpus** | 240–280px，可折叠 | `@` 搜索、笔记本树、本篇引用列表 |
| **中 Manuscript** | `flex-1`，`max-width: 820px` 居中 | 主舞台 |
| **右 Agent** | 320–360px，可折叠 | Plan / Runs / Chat |

**顶栏（全宽，sticky）**

```
[← Works]  小红书 · Q1复盘  ·  planned ▾  ·  v2 ▾  ·  资料3 · Voice✓
                                              [生成计划] [确认生成] (按状态显隐)
```

| 状态 | 顶栏主按钮 |
|------|------------|
| `briefing` | **生成计划** |
| `planned` | **确认生成**（primary）；次：**改 Brief** |
| `generating` | disabled + **取消** |
| `ready` | 底栏 **改版**；**标记已发布** |

**中栏结构（自上而下）**

```
┌─ Plan Card（planned 时置顶，可折叠）──────────────────┐
│ 目标 · 大纲 · 资料列表 · Rules · 风险                  │
│ [确认生成]  [编辑 Brief]                               │
└──────────────────────────────────────────────────────┘
┌─ Tab: [ 稿件 ] [ 发布包 ] ─────────────────────────────┐
│  Block 列表 / Ship checklist                          │
└──────────────────────────────────────────────────────┘
┌─ Compare 条（有 pending patch 时）──────────────────────┐
│  v2 提议 · 2 标题变更 · 正文无变更  [对比][采纳所选]…  │
└──────────────────────────────────────────────────────┘
┌─ 改版输入 sticky bottom（ready）──────────────────────┐
│  对 v2 改：…                              [提交改版]  │
└──────────────────────────────────────────────────────┘
```

### 16.3 稿件 Tab — Block 组件

统一块外壳 + 类型样式：

| Block | UI |
|-------|-----|
| **标题组** | 多条小卡，每条「复制」；Compare 时 checkbox + 新旧文案 |
| **正文** | 单卡 `text-[15px] leading-[1.72]`；左侧引用钉 `[复盘#2]` |
| **话题** | `#chip` 行，一键复制全部 |
| **封面 brief** | 虚线框假预览（P0） |

**证据标记（P0.5）**：来自资料 `text-brand` · 模型补充「补充」· 待核实小旗。

**勿用**：`UserBubble` 样式承载正文；无结构 Markdown 墙。

### 16.4 Compare / Apply

- **MVP**：变更块默认勾选；未变块折叠「未改动」；底栏 **采纳所选 (n)** / **全部** / **放弃**。  
- **P1**：v1 | v2 并排双栏。  
- 采纳后版本 ▾ 递增，Compare 条消失。

### 16.5 右栏 Agent Rail

| 分区 | 何时展开 | 内容 |
|------|----------|------|
| Plan | `planned` | 与中转顶 Plan 同构或精简 |
| Runs | `generating` | 步骤勾选 + 失败重试 |
| Chat | 默认折叠 | 短问答，**不**流式长文顶替中栏 |

### 16.6 发布包 Tab

- Checklist + 每步可复制块 + 手动 ☑。  
- 视觉密度参考 `HomeComposerFormatCard`，纵向清单。

### 16.7 左栏 Corpus

搜索 + 笔记本树；已绑定 `bg-brand/10`；「Plan 将用 N 篇」列表。

### 16.8 与 `/chat`、Demo 的差异

| | `/chat` | `/studio` | `FirstScreenDemo` |
|--|---------|-----------|-------------------|
| 布局 | 居中对话流 | 三栏编辑器 | 输入下、预览上 |
| 成品 | 流内卡片 | **中栏 Block** | 预览区（可借样式） |
| 专家/多格式 | 有 | **无** | 有四下拉 |

Studio **不**用「未发送整页居中仅输入框」；进入 Work 即三栏骨架。

### 16.9 响应式

`<1024px`：默认中栏；Corpus/Agent 为 bottom sheet 或顶 Tab「资料｜助手」。`generating` 只挡编辑不挡进度。

### 16.10 组件复用

`FirstScreenDemo` 成品区 · `FormatCard` 复制 · `ComposerDropAnchor` 压到 Brief 底栏 · `WorkspaceScrimModal` Voice/重生成确认 · `UserBubble` **仅** `/chat`。

### 16.11 UI 验收 U1–U6

| ID | 检查 |
|----|------|
| U1 | 第一眼主区域是稿件块，不是对话 |
| U2 | `planned` 时确认生成在 Plan 上且门禁有效 |
| U3 | 改版有 Compare，可只勾标题 |
| U4 | 顶栏见版本 + 资料篇数 |
| U5 | 发布包为 Tab checklist |
| U6 | 与 FirstScreenDemo 成品层级一致、载体为编辑器 |

### 16.12 设计交付（5 张线框）

完整 ASCII 线框见 **[writing-cursor-studio-wireframes.md](./writing-cursor-studio-wireframes.md)**（含 Works、三栏、稿件/Compare/发布包、生成态、移动 Tab、播客增补、页面流 Mermaid）。

交付清单：Works 列表 · Studio 桌面（planned/ready+Compare）· Block 四型 · Ship 一步 · 移动 Tab 版。

---

## 14. 文档与实现优先级（增补）

| 下游 | 动作 |
|------|------|
| 工程 PRD 附录 | Block/Patch/Plan/Run JSON schema；引用 id 与 corpus chunk 对齐 |
| 设计 | 按 **§16 UI 规格** 交付 5 张线框；含双 Tab、Compare、Run 条、引用钉（P0.5） |
| 埋点 | `plan_confirm`、`patch_apply_partial`、`evidence_click`、`run_cancel` |
| 竞品监测 | 季度更新 §12.2 表（得到大脑、IMA、笔灵） |

---

## 17. MVP 实现状态（工程）

| 能力 | 状态 | 锚点 |
|------|------|------|
| `/studio` Works 列表 | ✅ | `StudioWorksListClient` |
| `/studio/[workId]` 编辑 | ✅ | `StudioWorkEditor` |
| Plan → 确认 → `composer_expert_deliverable` | ✅ | `studioWorkPlan` + `homeComposerExpertJob` |
| 稿件 Block + 发布包 Tab | ✅ | `StudioManuscriptPanel` |
| Patch Compare + 部分采纳 | ✅ | `studioDeliverable` |
| 侧栏一级「创作」 | ✅ | `AppShell` · `WORKBENCH_STUDIO_PATH` |
| 资料：笔记本下拉 + 载入篇目 | ✅ | `/api/notebooks` · `/api/notes` |
| Work 云端同步 | ✅ | `fym_studio_works_v1` · `user_preferences` 白名单 |
| 登录默认 `/studio` | ✅ | `WORKBENCH_DEFAULT_PATH` |
| 完整三栏 / 移动 Tab | ✅ | 桌面三栏；窄屏 稿件/资料/助手 Tab |
| 公号/口播/播客 channel | ❌ V1 | 见 §5、§8 |

**手测**：登录 → 侧栏「创作」→ 新建小红书任务 → 写 Brief → 生成计划 → 确认生成 → 改版 → 采纳所选 → 发布包打勾。

---

## 15. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.4 | 2026-06-04 | P1：云端同步、登录默认 Studio、`/home`→`/studio`、移动 Tab、Voice 左栏编辑、nav 预取 |
| v1.3 | 2026-06-04 | **MVP 工程落地**：`/studio` 列表 + Work 编辑、Plan、红书 Job、Patch Apply、侧栏「创作」 |
| v1.2 | 2026-06-04 | 新增 §16 UI 规格（布局、Block、Compare、验收 U1–U6） |
| v1.1 | 2026-06-04 | 新增 §12 国内竞品、§13 Cursor/Claude 吸收路线图、§14 增补 |
| v1.0 | 2026-06-04 | 落地前五决策冻结；Studio IA、实体、小红书 MVP、Patch Apply、导航「创作」 |
