# 个人特色 IP — 执行排期（v5.1 → M3）

> **产品方案**：[author-ip-product-v5.md](./author-ip-product-v5.md)（**v5.2**）。  
> **已定稿**：无档位 IP 限额（有余额即用）；「我的 IP」不可删可改名；复制默认 **全文克隆**；老用户不引导迁移；`/notes/trash` **双 Tab**。  
> **执行范围**：迭代 1～15，交付至 **M3**。  
> **M3 明确不做**：10% 隐式 A/B、邮件触达、外部分享 SDK 深度集成。  
> **M3 分享卡**：**仅站内生成图片**（预览 → 下载 PNG / 复制到剪贴板）。

---

## 里程碑

| 里程碑 | 目标周 | 交付要点 |
|--------|--------|----------|
| α | 6 | 二级导航 + IP 列表/新建 + 首 IP 经历卡 + 三问试写 |
| β | 10 | Resolver 一行 + 单出口风格写作 + 印记 |
| M0 | 12～14 | 分层冷启动、对照引导、像/不像、资料本教育 |
| M1 | 18～20 | AI 访谈、多场景、生命力、全量学习 |
| M2 | 24～26 | 偏好记忆、增量学习、作品回流 |
| M3 | 28～30 | 链接导入、Profile 导出、**站内分享图**、站内运营位 |
| 收尾 | 30～32 | 联调、隐私评审、全量 |

**总周期**：约 30～32 周（2 周/迭代；M0 含 1 周联调缓冲）。

---

## 迭代任务（1～15）

### 迭代 1（W1～2）地基
- [ ] `author_ips` 表 + `GET /author-ips` + `POST /author-ips/ensure-default`（幂等「我的 IP」）
- [ ] `author_profiles` 表（`authorIpId` 1:1）；`isSystemSeed`、`maturity`
- [ ] note 元数据：`authorIpId`、`authorMaterialType`、`domainIds`
- [ ] AppShell：点「知识库」→ `/notes`；**仅**二级「个人特色 IP」→ `/notes/author-ip`
- [ ] IP 列表（至少含「我的 IP」）+ 悬停文案；`navPaths` 匹配 author-ip

### 迭代 2（W3～4）新建/复制 + 素材 + 示例模板
- [ ] 种子 `xhs_ai_product_v1`（阿橘 · 小红书 AI 产品）见 `docs/product/seeds/author-ip-template-xhs-ai-product-v1.json`
- [ ] 懒创建 `isTemplate` 示例 IP；列表置顶 + 导览 5 步 + 写一篇预置成稿
- [ ] `/notes/author-ip/new` 空白向导；`POST /author-ips/{id}/duplicate` + `?copyFrom=`
- [ ] `duplicate`：默认克隆文章+经历全文（深拷贝 note）；复制前二次确认
- [ ] 「我的 IP」：API 禁止删除；PATCH 改名
- [ ] `/notes/author-ip/[ipId]` 工作台；完善「我的 IP」空状态（非「新建第一个」）
- [ ] 经历卡 4 模板 + 示例；粘贴上传 scoped 到 ipId

### 迭代 3（W5～6）冷启动 α
- [ ] `POST /author-ips/{ipId}/onboarding/quick`（三问 → oneLiner + 试写）
- [ ] 试写室；`POST /author-profile/learn?mode=lite`
- [ ] 完整度与 `sketch` 态（不阻断写作）

### 迭代 4（W7～8）Resolver + 写一篇 β
- [ ] `StyleResolver` v1 + `POST /author-style/resolve`（`resolverLine`、`confidence`）
- [ ] SceneAutoPack + `build_author_style_block`
- [ ] **`/notes/author-ip/[ipId]/write`**：`AuthorStyleBar` + `POST .../compose`（SSE）
- [ ] 默认体裁 **通用文章**（`contentType=article`）；主题+生成；成稿区 + 个人印记

### 迭代 5（W9～10）感知闭环
- [ ] 写一篇：印记完整（经历溯源 / 差异句）；`author-style/feedback`
- [ ] 经历自动 RAG；medium 置信 + 记住偏好
- [ ] write 页内联三问冷启动；列表/概览「写一篇」入口

### 迭代 6（W11～12）M0 发布
- [ ] 首次 compose：可选通用 vs 风格对照（折叠）
- [ ] 无文章：口吻滑块兜底；`compose/save` 满意入库
- [ ] 首次进「个人特色 IP」对比教育；写一篇埋点（`clicks_to_compose`）
- [ ] 社媒出口接 compose（可选）；灰度 → 全量

### 迭代 3（续）/ 迭代 6
- [ ] `/notes/trash` Tab：参考资料 | 个人特色 IP

### 迭代 7（W13～14）M1·多 IP + 场景
- [ ] IP 列表多卡、默认 IP、`isDefault` 切换
- [ ] 写作页：多 IP 时下拉；单 IP 隐藏
- [ ] 复制异步队列 + 批量 preprocess/学习（扣费对齐余额）
- [ ] 多场景聚类 + `domains[]` + **场景化 displayName**
- [ ] IP 本·场景 Tab；`learn?mode=full` + trait 确认页

### 迭代 8（W15～16）M1·Resolver
- [ ] 多质心、high/medium/low；`immature` 不参与匹配
- [ ] stale「待学习」+ 一键学习

### 迭代 9（W17～18）M1·访谈
- [ ] AI 访谈 → 3 经历卡 + trait 草稿（`source=ai_interview`）

### 迭代 10（W19～20）M1·生命力
- [ ] `GET /author-profile/vitality`（标签云 / 雷达 / 变像 diff / 贡献 Top3）
- [ ] 试写室学习前后对比；**M1 扩量**

### 迭代 11（W21～22）M2·学习
- [ ] 增量学习；`topicCluster→domain`；trait 降权 ↔ AutoPack

### 迭代 12（W23～24）M2·回流
- [ ] 「微调风格」三滑块 + 经历 少/默认/多
- [ ] 作品回流确认入库；**M2 全量**

### 迭代 13（W25～26）M3·导入与导出
- [ ] 链接导入进 IP 本（公众号 / 飞书等，复用 URL note 能力）
- [ ] Profile 导出 Markdown（摘要级，不含全文素材；需登录）

### 迭代 14（W27～28）M3·站内分享图 + 站内触达
- [ ] **站内分享图**（见下节）；帮助中心条目
- [ ] **站内** banner / 通知（深链 IP 本）；**不做邮件**
- [ ] 功能开关：`author_ip_share_card` 分项灰度

### 迭代 15（W29～30）M3 收尾
- [ ] 隐私与安全评审（分享图、导出）
- [ ] M0～M3 全链路回归；客服 playbook；**M3 全量**
- [ ] W31～32 缓冲：导入成功率、Resolver 缓存

---

## M3：站内分享图（唯一增长向 UI）

### 范围

| 做 | 不做 |
|----|------|
| IP 本概览 / 生命力页入口「生成我的写作标签图」 | 邮件配图、邮件触达 |
| 服务端或前端 Canvas 生成 PNG（3 关键词 + oneLiner + 品牌水印） | 第三方分享 SDK、小程序卡片 |
| 预览 → 下载 PNG → 复制图片（若浏览器支持） | 隐式 A/B、自动发帖 |
| 生成前二次确认（不含经历原文、不含敏感句） | 公开 URL 托管用户图（默认仅本地下载） |

### 接口（建议）

- `POST /author-profile/share-card/preview` → 返回预览 URL 或 base64（短期有效）
- `POST /author-profile/share-card/download` → `image/png` attachment

### 验收

- 仅登录用户可生成；频控例如 10 次/日
- 预览文案用户可编辑关键词后再生成
- 删除 IP 或注销账号后清理临时图缓存

---

## 功能开关

| 开关 | 阶段 |
|------|------|
| `author_ip_enabled` | M0 |
| `author_ip_interview` | M1 |
| `author_ip_link_import` | M3 迭代 13 |
| `author_ip_share_card` | M3 迭代 14 |

---

## 人力粗算（人日）

| 阶段 | 合计约 |
|------|--------|
| M0（迭代 1～6） | 118～147 |
| M1（迭代 7～10） | 93～118 |
| M2（迭代 11～12） | 58～72 |
| M3（迭代 13～15，含站内图、无邮件） | 38～48 |
| **总计** | **约 307～385** |

---

## 发布节奏

| 周 | 动作 |
|----|------|
| 6 | 内部 α |
| 10 | 种子 β |
| 12～14 | M0 灰度 → 全量 |
| 20 | M1 扩量 |
| 24 | M2 全量 |
| 30 | M3 全量（导入 / 导出 / 站内图 / 站内 banner） |

---

## 排除项（全周期）

- 10% 隐式 A/B
- 邮件运营触达
- 外部分享渠道一键发布

---

*最后更新：与 v4 产品方案及「M3 仅站内图生成」决策对齐。*
