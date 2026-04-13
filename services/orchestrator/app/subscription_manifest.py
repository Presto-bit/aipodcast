"""
订阅、权益与价目统一清单（单一 manifest）。

- 档位标签、权益数值、人民币分价目、按次包期限等均在此维护。
- `entitlement_matrix`（矩阵与 enforcement 派生）与 `plan_catalog`（套餐/加购 API）均从此读取。
"""

from __future__ import annotations

SUBSCRIPTION_MANIFEST_VERSION = "1.3.3"

# ---------------------------------------------------------------------------
# 档位
# ---------------------------------------------------------------------------

TIER_KEYS: tuple[str, ...] = ("free", "basic", "pro", "max", "payg")
TIER_LABELS: dict[str, str] = {
    "free": "Free",
    "basic": "Basic",
    "pro": "Pro",
    "max": "Max",
    "payg": "按次（无订阅）",
}

# 可写入 users.plan / 订阅事件的档位（不含 payg）
USER_SUBSCRIPTION_TIERS: frozenset[str] = frozenset({"free", "basic", "pro", "max"})

# ---------------------------------------------------------------------------
# 权益数值（enforcement 与矩阵派生同源）
# ---------------------------------------------------------------------------

# 已取消「近 30 天完成创作次数」产品口径；保留字段供兼容，统一为 0（不在 UI/矩阵展示用量条）。
JOBS_TERMINAL_MONTHLY_BY_TIER: dict[str, int] = {
    "free": 0,
    "basic": 0,
    "pro": 0,
    "max": 0,
    "payg": 0,
}

MONTHLY_MINUTES_PRODUCT_BY_TIER: dict[str, int] = {
    "free": 20,
    "basic": 80,
    "pro": 400,
    "max": 800,
    "payg": 0,
}

TIER_AI_POLISH_MONTHLY_BY_TIER: dict[str, int] = {
    "free": 0,
    "basic": 0,
    "pro": 30,
    "max": -1,
    "payg": 0,
}

MAX_NOTE_REFS_BY_TIER: dict[str, int] = {
    "free": 1,
    "basic": 3,
    "pro": 5,
    "max": 10,
    "payg": 1,
}

VOICE_CLONE_MONTHLY_INCLUDED_BY_TIER: dict[str, int] = {
    "free": 0,
    "basic": 1,
    "pro": 2,
    "max": 3,
    "payg": 0,
}

# 长文 / 长文播客：单次 script_target_chars 上限（产品口径，与 worker 脚本生成一致）
LONG_FORM_SCRIPT_CHARS_CAP_BY_TIER: dict[str, int] = {
    "free": 5000,
    "basic": 8000,
    "pro": 20_000,
    "max": 50_000,
    "payg": 5000,
}

PAYWALL_RECOMMEND_USAGE_THRESHOLD_MINUTES = 120

# ---------------------------------------------------------------------------
# 价目（人民币分）与按次包规则
# ---------------------------------------------------------------------------

# 仅月付；年付价为 0 表示不提供年付收银。
BASIC_MONTHLY_CENTS = 1990
BASIC_YEARLY_CENTS = 0
PRO_MONTHLY_CENTS = 7990
PRO_YEARLY_CENTS = 0
MAX_MONTHLY_CENTS = 19900
MAX_YEARLY_CENTS = 0

# 历史：固定分钟包价目（矩阵展示可引用；收银已改为钱包充值）
PAYG_30_MINUTES = 30
PAYG_100_MINUTES = 100
PAYG_30_CENTS = 750
PAYG_100_CENTS = 2500

# 钱包充值页「文本量→时长」展示用参考语速（字/分钟，口语近似），非扣费公式
WALLET_REFERENCE_CHARS_PER_SPOKEN_MINUTE = 250

PAYG_MINUTE_PACK_EXPIRE_DAYS = 90
PAYG_EXPIRE_DAYS = PAYG_MINUTE_PACK_EXPIRE_DAYS

# TTS / 播客成片：超出「月配额分钟」与「按次分钟包」后，钱包按分钟扣费；单价与 30 分钟包一致（分/分钟）。
MEDIA_WALLET_CENTS_PER_MINUTE = max(1, int(PAYG_30_CENTS // max(1, PAYG_30_MINUTES)))

# 钱包充值：人民币分，单次最低 10 元
WALLET_TOPUP_MIN_CENTS = 1000
WALLET_TOPUP_MAX_CENTS = 10_000_000

VOICE_CLONE_PAYG_CENTS = 1290
