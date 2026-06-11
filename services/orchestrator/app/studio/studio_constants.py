"""Studio Agent 共享常量（上下文与 reply 上限）。"""

# 有稿 reply / Planner 读稿：与前端 studioAgentContext 稿件上限对齐
STUDIO_MANUSCRIPT_EXCERPT_CHARS = 6000

# Planner reply 字段（草稿，正文由下游按 intent 扩展）
STUDIO_PLANNER_REPLY_MAX_CHARS = 1200

# SSE / 用户可见 reply 硬顶
STUDIO_USER_REPLY_MAX_CHARS = 2400
