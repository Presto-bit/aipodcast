"""
订阅与权限矩阵（展示与 enforcement 派生）。

- 数值与价目以 `subscription_manifest` 为唯一数据源；本模块负责矩阵行构建与对外查询函数。
- 纯文案型权益（如队列优先级、导出格式说明）保留在静态行表中。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .subscription_manifest import (
    BASIC_MONTHLY_CENTS,
    BASIC_YEARLY_CENTS,
    JOBS_TERMINAL_MONTHLY_BY_TIER,
    LONG_FORM_SCRIPT_CHARS_CAP_BY_TIER,
    MAX_MONTHLY_CENTS,
    MAX_NOTE_REFS_BY_TIER,
    MAX_YEARLY_CENTS,
    MONTHLY_MINUTES_PRODUCT_BY_TIER,
    PAYG_100_CENTS,
    PAYG_30_CENTS,
    PAYG_MINUTE_PACK_EXPIRE_DAYS,
    PAYWALL_RECOMMEND_USAGE_THRESHOLD_MINUTES,
    PRO_MONTHLY_CENTS,
    PRO_YEARLY_CENTS,
    SUBSCRIPTION_MANIFEST_VERSION,
    TIER_AI_POLISH_MONTHLY_BY_TIER,
    TIER_KEYS,
    TIER_LABELS,
    VOICE_CLONE_MONTHLY_INCLUDED_BY_TIER,
    VOICE_CLONE_PAYG_CENTS,
)

ENTITLEMENT_MATRIX_VERSION = "1.5.0"


def _norm_tier(tier: str | None) -> str:
    t = (tier or "free").strip().lower()
    return t if t in TIER_KEYS else "free"


def _tier_cells(cell: Callable[[str], str]) -> dict[str, str]:
    return {tk: cell(tk) for tk in TIER_KEYS}


def jobs_terminal_monthly_quota(tier: str | None) -> int:
    """近 30 天完成创作次数上限（与现有用量条一致）。"""
    return int(JOBS_TERMINAL_MONTHLY_BY_TIER[_norm_tier(tier)])


def monthly_minutes_product_target(tier: str | None) -> int:
    """产品口径：月配额分钟（展示/定价，不替代 jobs 计数）。"""
    return int(MONTHLY_MINUTES_PRODUCT_BY_TIER[_norm_tier(tier)])


def tier_ai_polish_monthly_quota(tier: str | None) -> int:
    """
    AI 润色月上限：0=不可用，-1=不限（仅矩阵语义，具体 enforcement 可后续接用量表）。
    """
    return int(TIER_AI_POLISH_MONTHLY_BY_TIER[_norm_tier(tier)])


def tier_allows_ai_polish_entitlement(tier: str | None) -> bool:
    """是否具备 AI 润色权益（不含 AI_POLISH_FEATURE_ENABLED 总开关）。"""
    return tier_ai_polish_monthly_quota(tier) != 0


def max_note_refs_for_plan(tier: str | None) -> int:
    """笔记播客 RAG 参考条数上限。"""
    return int(MAX_NOTE_REFS_BY_TIER[_norm_tier(tier)])


def voice_clone_monthly_included(tier: str | None) -> int:
    """套餐内每月含克隆次数（产品口径；扣费 enforcement 可后续接）。"""
    return int(VOICE_CLONE_MONTHLY_INCLUDED_BY_TIER[_norm_tier(tier)])


def voice_clone_payg_cents() -> int:
    """超额/按次克隆单价（分，产品口径）。"""
    return int(VOICE_CLONE_PAYG_CENTS)


def long_form_script_chars_cap(tier: str | None) -> int:
    """长文 / 长文播客单次目标字数上限（与脚本生成 enforcement 一致）。"""
    return int(LONG_FORM_SCRIPT_CHARS_CAP_BY_TIER[_norm_tier(tier)])


def apply_script_options_subscription_caps(opts: dict[str, Any], tier: str | None) -> dict[str, Any]:
    """按档位裁剪 script_target_chars，供文本提供方（MiniMax / OpenAI 兼容）共用。"""
    cap = long_form_script_chars_cap(tier)
    out = dict(opts)
    if "script_target_chars" in out and out["script_target_chars"] is not None:
        try:
            n = int(out["script_target_chars"])
            out["script_target_chars"] = max(200, min(cap, n))
        except (TypeError, ValueError):
            pass
    return out


# ---------------------------------------------------------------------------
# 矩阵行：由数值常量派生
# ---------------------------------------------------------------------------


def _row_monthly_minutes_product() -> dict[str, Any]:
    def cell(tier: str) -> str:
        if tier == "payg":
            return "0（仅分钟包）"
        return str(MONTHLY_MINUTES_PRODUCT_BY_TIER[tier])

    return {
        "key": "quota.monthly_minutes_product",
        "label": "月配额分钟（产品口径）",
        **_tier_cells(cell),
    }


def _row_jobs_terminal_monthly() -> dict[str, Any]:
    return {
        "key": "quota.jobs_terminal_monthly",
        "label": "月完成创作次数上限（系统用量条）",
        **_tier_cells(lambda t: str(JOBS_TERMINAL_MONTHLY_BY_TIER[t])),
    }


def _row_long_form_script_chars_cap() -> dict[str, Any]:
    return {
        "key": "feature.long_form.script_target_chars_max",
        "label": "长文 / 长文播客单次目标字数上限",
        **_tier_cells(lambda t: str(LONG_FORM_SCRIPT_CHARS_CAP_BY_TIER[t])),
    }


def _row_feature_ai_polish() -> dict[str, Any]:
    def cell(tier: str) -> str:
        q = TIER_AI_POLISH_MONTHLY_BY_TIER[tier]
        if q == 0:
            return "否"
        if q < 0:
            return "是（不限）"
        return f"是（月上限 {q} 次，待计量接入）"

    return {
        "key": "feature.ai_polish",
        "label": "AI 润色（进 TTS 前）",
        **_tier_cells(cell),
    }


def _row_note_refs_max_count() -> dict[str, Any]:
    return {
        "key": "feature.note_refs.max_count",
        "label": "笔记引用条数上限",
        **_tier_cells(lambda t: str(MAX_NOTE_REFS_BY_TIER[t])),
    }


def _row_voice_clone_monthly_included() -> dict[str, Any]:
    def cell(tier: str) -> str:
        if tier == "payg":
            return "0（按次买）"
        return str(VOICE_CLONE_MONTHLY_INCLUDED_BY_TIER[tier])

    return {
        "key": "voice.clone.monthly_included",
        "label": "每月含克隆次数（产品口径）",
        **_tier_cells(cell),
    }


def _row_voice_clone_payg_cents() -> dict[str, Any]:
    s = str(VOICE_CLONE_PAYG_CENTS)
    return {
        "key": "voice.clone.payg_cents",
        "label": "超额克隆单买（分，产品口径）",
        "free": s,
        "basic": s,
        "pro": s,
        "max": s,
        "payg": s,
    }


def _row_billing_payg_expire_days() -> dict[str, Any]:
    d = str(PAYG_MINUTE_PACK_EXPIRE_DAYS)
    return {
        "key": "billing.payg.expire_days",
        "label": "按次分钟包有效期（天）",
        "free": "—",
        "basic": "—",
        "pro": "—",
        "max": "—",
        "payg": d,
    }


def _row_paywall_recommend_minutes() -> dict[str, Any]:
    return {
        "key": "paywall.recommendation.usage_threshold_minutes",
        "label": "推荐订阅/按次阈值（近30天分钟，产品口径）",
        "free": str(PAYWALL_RECOMMEND_USAGE_THRESHOLD_MINUTES),
        "basic": "—",
        "pro": "—",
        "max": "—",
        "payg": "—",
    }


# ---------------------------------------------------------------------------
# 矩阵：静态文案行（无独立 enforcement 函数）
# ---------------------------------------------------------------------------

_QUOTA_STATIC_ROWS: list[dict[str, Any]] = [
    {
        "key": "job.max_concurrency",
        "label": "并发任务数",
        "free": "1",
        "basic": "1",
        "pro": "2",
        "max": "3",
        "payg": "1",
    },
    {
        "key": "job.queue_priority",
        "label": "队列优先级",
        "free": "低",
        "basic": "中低",
        "pro": "中",
        "max": "高",
        "payg": "低/中（按策略）",
    },
    {
        "key": "job.peak_throttle_exempt",
        "label": "高峰限流豁免",
        "free": "否",
        "basic": "否",
        "pro": "部分",
        "max": "是",
        "payg": "否",
    },
]

_FEATURES_STATIC_ROWS: list[dict[str, Any]] = [
    {
        "key": "feature.batch.enabled",
        "label": "批量处理",
        "free": "否",
        "basic": "否",
        "pro": "基础",
        "max": "高级",
        "payg": "否",
    },
    {
        "key": "feature.batch.max_items_per_run",
        "label": "单次批量上限（条）",
        "free": "0",
        "basic": "0",
        "pro": "8",
        "max": "30",
        "payg": "0",
    },
    {
        "key": "export.quality_tier",
        "label": "导出质量档位",
        "free": "基础",
        "basic": "基础",
        "pro": "高",
        "max": "专业",
        "payg": "基础",
    },
    {
        "key": "export.watermark.remove",
        "label": "去水印",
        "free": "否",
        "basic": "否",
        "pro": "是",
        "max": "是",
        "payg": "否",
    },
    {
        "key": "export.allowed_formats",
        "label": "导出格式",
        "free": "mp3",
        "basic": "mp3",
        "pro": "mp3、wav",
        "max": "mp3、wav、ZIP 合集",
        "payg": "mp3",
    },
    {
        "key": "feature.works.bulk_download",
        "label": "作品批量下载",
        "free": "否",
        "basic": "否",
        "pro": "是",
        "max": "是",
        "payg": "否",
    },
    {
        "key": "feature.rss_publish.enabled",
        "label": "RSS 发布",
        "free": "否",
        "basic": "否",
        "pro": "是",
        "max": "是",
        "payg": "否",
    },
    {
        "key": "feature.rss_publish.schedule",
        "label": "RSS 定时发布",
        "free": "否",
        "basic": "否",
        "pro": "可选",
        "max": "是",
        "payg": "否",
    },
    {
        "key": "license.commercial",
        "label": "商用授权",
        "free": "否",
        "basic": "否",
        "pro": "标准",
        "max": "增强",
        "payg": "否",
    },
    {
        "key": "voice.favorite.max_count",
        "label": "预设音色收藏上限",
        "free": "20",
        "basic": "50",
        "pro": "300",
        "max": "1200",
        "payg": "20",
    },
    {
        "key": "integration.api_webhook",
        "label": "API / Webhook",
        "free": "否",
        "basic": "否",
        "pro": "基础",
        "max": "完整",
        "payg": "否",
    },
    {
        "key": "support.sla_tier",
        "label": "支持",
        "free": "社区",
        "basic": "社区",
        "pro": "工单 48h",
        "max": "优先",
        "payg": "社区",
    },
]

_BILLING_STATIC_ROWS: list[dict[str, Any]] = [
    {
        "key": "billing.charge_on_success_only",
        "label": "仅成功扣量",
        "free": "true",
        "basic": "true",
        "pro": "true",
        "max": "true",
        "payg": "true",
    },
    {
        "key": "billing.rollback_on_failed_job",
        "label": "失败任务回滚预扣",
        "free": "true",
        "basic": "true",
        "pro": "true",
        "max": "true",
        "payg": "true",
    },
    {
        "key": "billing.payg.stack_with_subscription",
        "label": "按次包可与订阅叠加",
        "free": "—",
        "basic": "是",
        "pro": "是",
        "max": "是",
        "payg": "是",
    },
    {
        "key": "billing.subscription.expire_fallback_free",
        "label": "订阅到期回落 Free",
        "free": "—",
        "basic": "是",
        "pro": "是",
        "max": "是",
        "payg": "—",
    },
    {
        "key": "billing.consume_order",
        "label": "消耗顺序",
        "free": "套餐月配额 → 按次包 / 余额",
        "basic": "同左",
        "pro": "同左",
        "max": "同左",
        "payg": "仅按次包",
    },
    {
        "key": "pricing.annual_discount_max",
        "label": "年付折扣上限",
        "free": "—",
        "basic": "约 15–20%",
        "pro": "约 15–20%",
        "max": "约 15–20%",
        "payg": "—",
    },
]

_PAYWALL_STATIC_ROWS: list[dict[str, Any]] = [
    {
        "key": "paywall.soft_alert_70",
        "label": "70% 用量软提醒",
        "free": "开",
        "basic": "开",
        "pro": "开",
        "max": "开",
        "payg": "开",
    },
    {
        "key": "paywall.soft_alert_90",
        "label": "90% 用量软提醒",
        "free": "开",
        "basic": "开",
        "pro": "开",
        "max": "开",
        "payg": "开",
    },
    {
        "key": "paywall.feature_gate",
        "label": "高级功能硬门槛",
        "free": "开",
        "basic": "开",
        "pro": "开",
        "max": "—",
        "payg": "开",
    },
]


def _matrix_sections() -> list[dict[str, Any]]:
    """结构化矩阵：供管理端 JSON 与页面渲染。"""
    features_rows: list[dict[str, Any]] = [
        _row_feature_ai_polish(),
        _row_long_form_script_chars_cap(),
        _row_note_refs_max_count(),
        *_FEATURES_STATIC_ROWS[:8],
        _row_voice_clone_monthly_included(),
        _row_voice_clone_payg_cents(),
        *_FEATURES_STATIC_ROWS[8:],
    ]

    billing_rows: list[dict[str, Any]] = [
        *_BILLING_STATIC_ROWS[:5],
        _row_billing_payg_expire_days(),
        _BILLING_STATIC_ROWS[5],
    ]

    paywall_rows: list[dict[str, Any]] = [
        *_PAYWALL_STATIC_ROWS,
        _row_paywall_recommend_minutes(),
    ]

    return [
        {
            "id": "quota",
            "title": "配额与效率",
            "rows": [
                _row_monthly_minutes_product(),
                _row_jobs_terminal_monthly(),
                *_QUOTA_STATIC_ROWS,
            ],
        },
        {
            "id": "features",
            "title": "功能权益",
            "rows": features_rows,
        },
        {
            "id": "billing",
            "title": "计费与扣减规则",
            "rows": billing_rows,
        },
        {
            "id": "paywall",
            "title": "升级触发",
            "rows": paywall_rows,
        },
    ]


def get_entitlement_matrix_payload() -> dict[str, Any]:
    """管理员只读：完整矩阵 JSON。"""
    return {
        "version": ENTITLEMENT_MATRIX_VERSION,
        "manifest_version": SUBSCRIPTION_MANIFEST_VERSION,
        "tier_keys": list(TIER_KEYS),
        "tier_labels": dict(TIER_LABELS),
        "sections": _matrix_sections(),
        "helpers": {
            "jobs_terminal_monthly_quota": {k: jobs_terminal_monthly_quota(k) for k in TIER_KEYS},
            "monthly_minutes_product_target": {k: monthly_minutes_product_target(k) for k in TIER_KEYS},
            "tier_ai_polish_monthly_quota": {k: tier_ai_polish_monthly_quota(k) for k in TIER_KEYS},
            "max_note_refs_for_plan": {k: max_note_refs_for_plan(k) for k in TIER_KEYS},
            "voice_clone_monthly_included": {k: voice_clone_monthly_included(k) for k in TIER_KEYS},
            "long_form_script_chars_cap": {k: long_form_script_chars_cap(k) for k in TIER_KEYS},
            "voice_clone_payg_cents": voice_clone_payg_cents(),
            "paywall_recommend_usage_threshold_minutes": PAYWALL_RECOMMEND_USAGE_THRESHOLD_MINUTES,
            "payg_minute_pack_expire_days": PAYG_MINUTE_PACK_EXPIRE_DAYS,
        },
        "pricing": {
            "currency": "CNY",
            "unit": "fen",
            "basic_monthly_cents": BASIC_MONTHLY_CENTS,
            "basic_yearly_cents": BASIC_YEARLY_CENTS,
            "pro_monthly_cents": PRO_MONTHLY_CENTS,
            "pro_yearly_cents": PRO_YEARLY_CENTS,
            "max_monthly_cents": MAX_MONTHLY_CENTS,
            "max_yearly_cents": MAX_YEARLY_CENTS,
            "payg_30_cents": PAYG_30_CENTS,
            "payg_100_cents": PAYG_100_CENTS,
            "payg_minute_pack_expire_days": PAYG_MINUTE_PACK_EXPIRE_DAYS,
            "voice_clone_payg_cents": VOICE_CLONE_PAYG_CENTS,
        },
    }
