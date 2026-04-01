from typing import Any, Literal

from pydantic import BaseModel, Field

from .subscription_manifest import WALLET_TOPUP_MAX_CENTS, WALLET_TOPUP_MIN_CENTS


JobStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]


class JobCreateRequest(BaseModel):
    project_name: str = Field(min_length=1, max_length=120)
    job_type: str = Field(default="script_draft")
    queue_name: Literal["ai", "media"] = Field(default="ai")
    payload: dict[str, Any] = Field(default_factory=dict)
    created_by: str | None = None


class JobResponse(BaseModel):
    id: str
    project_id: str | None
    status: JobStatus
    job_type: str
    queue_name: str
    progress: float
    payload: dict[str, Any]
    result: dict[str, Any]
    error_message: str | None
    created_at: str
    started_at: str | None
    completed_at: str | None


class NoteCreateRequest(BaseModel):
    project_name: str = Field(default="default-notes", min_length=1, max_length=120)
    title: str = Field(default="未命名笔记", min_length=1, max_length=200)
    notebook: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1)
    source_url: str | None = None


class NotePatchRequest(BaseModel):
    title: str = Field(min_length=1, max_length=300)


class NotebookCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class NotebookRenameRequest(BaseModel):
    new_name: str = Field(min_length=1, max_length=120)


class NoteUploadJsonRequest(BaseModel):
    project_name: str = Field(default="default-notes", min_length=1, max_length=120)
    filename: str = Field(min_length=1, max_length=260)
    notebook: str = Field(min_length=1, max_length=120)
    title: str = Field(default="", max_length=300)
    data_base64: str = Field(min_length=1)


class NoteImportUrlRequest(BaseModel):
    project_name: str = Field(default="default-notes", min_length=1, max_length=120)
    url: str = Field(min_length=1, max_length=4000)
    notebook: str = Field(min_length=1, max_length=120)
    title: str = Field(default="", max_length=300)


class SavedVoicesWriteRequest(BaseModel):
    voices: list[dict[str, Any]] = Field(default_factory=list)


class PreviewVoiceRequest(BaseModel):
    voice_id: str = Field(min_length=1, max_length=120)
    text: str = Field(default="欢迎收听我的播客节目", max_length=500)


class PolishTtsTextRequest(BaseModel):
    """独立 TTS 页：将书面稿润色为更口语化后再朗读（调用文本模型）。"""
    text: str = Field(min_length=1, max_length=48_000)
    # single：单人连贯播讲；dual：双人对话，输出 Speaker1:/Speaker2: 行（与 TTS 双人模式一致）
    tts_mode: str = Field(default="single", min_length=1, max_length=16)


class SubscriptionSelectRequest(BaseModel):
    tier: str = Field(default="free", min_length=1, max_length=20)
    billing_cycle: str | None = None


class AdminCreateUserRequest(BaseModel):
    phone: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=6, max_length=120)
    role: str = Field(default="user", min_length=1, max_length=20)
    plan: str = Field(default="free", min_length=1, max_length=20)
    billing_cycle: str | None = None


class AdminSetRoleRequest(BaseModel):
    phone: str = Field(min_length=1, max_length=32)
    role: str = Field(default="user", min_length=1, max_length=20)


class AdminTtsPolishPromptsPut(BaseModel):
    """管理员覆盖 TTS 前润色的「要求」条款（双人 / 单人）；与代码内默认结构一致（建议保留编号列表）。"""

    dual_requirements: str = Field(default="", max_length=12_000)
    single_requirements: str = Field(default="", max_length=12_000)


class AdminDeleteUserRequest(BaseModel):
    phone: str = Field(min_length=1, max_length=32)


class AdminSetSubscriptionRequest(BaseModel):
    """管理员为用户设置套餐（升级/降级）。"""

    phone: str = Field(min_length=1, max_length=32)
    tier: str = Field(min_length=1, max_length=20)
    billing_cycle: str | None = None


class AdminSubscriptionCheckoutCreateRequest(BaseModel):
    """管理员内测：创建订阅收银会话（仅生成 checkout_id 与金额，不落真实三方单）。"""

    tier: str = Field(min_length=1, max_length=20)
    billing_cycle: str = Field(min_length=1, max_length=20)


class AdminSubscriptionCheckoutCompleteRequest(BaseModel):
    """管理员内测：对本人账号模拟支付成功（写入订单并生效套餐）。"""

    checkout_id: str = Field(min_length=8, max_length=160)
    tier: str = Field(min_length=1, max_length=20)
    billing_cycle: str = Field(min_length=1, max_length=20)


class WalletTopupCheckoutCreateRequest(BaseModel):
    """钱包充值：创建模拟收银会话（不改变订阅档位）。金额单位：人民币分。"""

    amount_cents: int = Field(ge=WALLET_TOPUP_MIN_CENTS, le=WALLET_TOPUP_MAX_CENTS)


class WalletTopupCheckoutCompleteRequest(BaseModel):
    """钱包充值：确认模拟支付并入账余额。"""

    checkout_id: str = Field(min_length=8, max_length=200)


class WechatNativeSubscriptionCreateRequest(BaseModel):
    """微信 Native：创建订阅扫码单（PC 展示 code_url 二维码）。"""

    tier: str = Field(min_length=1, max_length=20)
    billing_cycle: str = Field(min_length=1, max_length=20)


class WechatNativeWalletCreateRequest(BaseModel):
    """微信 Native：创建钱包充值扫码单。"""

    amount_cents: int = Field(ge=WALLET_TOPUP_MIN_CENTS, le=WALLET_TOPUP_MAX_CENTS)


class AuthRegisterRequest(BaseModel):
    phone: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=1, max_length=120)
    invite_code: str = Field(default="", max_length=120)


class AuthLoginRequest(BaseModel):
    phone: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=1, max_length=120)


class AuthUnlockFeatureRequest(BaseModel):
    phone: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=1, max_length=120)


class AuthProfilePatchRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=48)


class UserPreferencesPatchRequest(BaseModel):
    """与 models.ALLOWED_USER_PREF_KEYS 白名单配合；值为 JSON 可序列化对象。"""

    data: dict[str, Any] = Field(default_factory=dict)


class RssChannelUpsertRequest(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    description: str = Field(default="", max_length=4000)
    author: str = Field(default="", max_length=180)
    language: str = Field(default="zh-cn", max_length=32)
    image_url: str = Field(default="", max_length=4000)


class RssPublishRequest(BaseModel):
    channel_id: str = Field(min_length=1, max_length=64)
    job_id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=300)
    summary: str = Field(default="", max_length=4000)
    show_notes: str = Field(default="", max_length=20_000)
    explicit: bool = Field(default=False)
    publish_at: str | None = None
    force_republish: bool = Field(default=False)
