from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, Field, field_validator, model_validator

from .subscription_manifest import BILLING_MAX_NOTE_REFS, WALLET_TOPUP_MAX_CENTS, WALLET_TOPUP_MIN_CENTS


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
    project_name: str = Field(default="notes-podcast-studio", min_length=1, max_length=120)
    title: str = Field(default="未命名笔记", min_length=1, max_length=200)
    notebook: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1)
    source_url: str | None = None


class NotePatchRequest(BaseModel):
    title: str = Field(min_length=1, max_length=300)


class NotebookCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class NotebookPatchRequest(BaseModel):
    new_name: str | None = Field(
        default=None,
        min_length=1,
        max_length=120,
        validation_alias=AliasChoices("new_name", "newName"),
    )
    cover_mode: str | None = Field(default=None, validation_alias=AliasChoices("cover_mode", "coverMode"))
    cover_preset_id: str | None = Field(
        default=None,
        max_length=40,
        validation_alias=AliasChoices("cover_preset_id", "coverPresetId"),
    )

    @model_validator(mode="after")
    def _at_least_one_field(self) -> "NotebookPatchRequest":
        if self.new_name is None and self.cover_mode is None:
            raise ValueError("no_changes")
        return self


class NotebookSharingPatchRequest(BaseModel):
    is_public: bool = Field(validation_alias=AliasChoices("is_public", "isPublic"))
    public_access: str | None = Field(
        default=None,
        validation_alias=AliasChoices("public_access", "publicAccess"),
    )
    listed_in_discover: bool | None = Field(
        default=None,
        validation_alias=AliasChoices("listed_in_discover", "listedInDiscover"),
    )


class NotebookViewIncrementRequest(BaseModel):
    owner_user_id: str = Field(min_length=10, max_length=80, validation_alias=AliasChoices("owner_user_id", "ownerUserId"))
    notebook: str = Field(min_length=1, max_length=120)


class NoteUploadJsonRequest(BaseModel):
    project_name: str = Field(default="notes-podcast-studio", min_length=1, max_length=120)
    filename: str = Field(min_length=1, max_length=260)
    notebook: str = Field(min_length=1, max_length=120)
    title: str = Field(default="", max_length=300)
    data_base64: str = Field(min_length=1)


class NoteImportUrlRequest(BaseModel):
    project_name: str = Field(default="notes-podcast-studio", min_length=1, max_length=120)
    url: str = Field(min_length=1, max_length=4000)
    notebook: str = Field(min_length=1, max_length=120)
    title: str = Field(default="", max_length=300)


class NotesAskHintsRequest(BaseModel):
    """根据已选资料生成短摘要与 3 个可点击的提问引导（供输入框旁展示）。"""

    notebook: str = Field(min_length=1, max_length=120)
    note_ids: list[str] = Field(min_length=1, max_length=BILLING_MAX_NOTE_REFS)
    shared_from_owner_user_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("shared_from_owner_user_id", "sharedFromOwnerUserId"),
    )

    @field_validator("note_ids")
    @classmethod
    def _normalize_note_ids_hints(cls, v: list[str]) -> list[str]:
        out: list[str] = []
        seen: set[str] = set()
        for raw in v:
            s = str(raw or "").strip()
            if not s or s in seen:
                continue
            seen.add(s)
            out.append(s)
        if not out:
            raise ValueError("note_ids_required")
        if len(out) > BILLING_MAX_NOTE_REFS:
            raise ValueError("too_many_notes")
        return out


class NotesAskRequest(BaseModel):
    """对当前笔记本内已选笔记做轻量问答（基于正文摘录）。"""

    notebook: str = Field(min_length=1, max_length=120)
    note_ids: list[str] = Field(min_length=1, max_length=BILLING_MAX_NOTE_REFS)
    question: str = Field(min_length=1, max_length=800)
    shared_from_owner_user_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("shared_from_owner_user_id", "sharedFromOwnerUserId"),
    )

    @field_validator("note_ids")
    @classmethod
    def _normalize_note_ids(cls, v: list[str]) -> list[str]:
        out: list[str] = []
        seen: set[str] = set()
        for raw in v:
            s = str(raw or "").strip()
            if not s or s in seen:
                continue
            seen.add(s)
            out.append(s)
        if not out:
            raise ValueError("note_ids_required")
        if len(out) > BILLING_MAX_NOTE_REFS:
            raise ValueError("too_many_notes")
        return out


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


class SubscriptionWalletPayRequest(BaseModel):
    """使用账户余额一次性支付当前计费周期订阅（月付）。"""

    tier: str = Field(min_length=1, max_length=20)
    billing_cycle: str | None = Field(default="monthly")


class AdminCreateUserRequest(BaseModel):
    phone: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=6, max_length=120)
    role: str = Field(default="user", min_length=1, max_length=20)
    plan: str = Field(default="free", min_length=1, max_length=20)
    billing_cycle: str | None = None


class AdminWalletCreditRequest(BaseModel):
    """管理员为用户钱包增加余额（分，正整数；受单次充值上限约束）。"""

    phone: str = Field(min_length=1, max_length=64)
    amount_cents: int = Field(ge=1, le=WALLET_TOPUP_MAX_CENTS)


class AdminSetRoleRequest(BaseModel):
    phone: str = Field(min_length=1, max_length=64)
    role: str = Field(default="user", min_length=1, max_length=20)


class AdminPodcastTemplatePatch(BaseModel):
    """将成功播客成片设为全站创作模板（或取消）。"""

    enabled: bool = True


class AdminTtsPolishPromptsPut(BaseModel):
    """管理员覆盖 TTS 前润色的「要求」条款（双人 / 单人）；与代码内默认结构一致（建议保留编号列表）。"""

    dual_requirements: str = Field(default="", max_length=12_000)
    single_requirements: str = Field(default="", max_length=12_000)


class AdminDeleteUserRequest(BaseModel):
    phone: str = Field(min_length=1, max_length=64)


class AdminSetSubscriptionRequest(BaseModel):
    """管理员为用户设置套餐（升级/降级）。"""

    phone: str = Field(min_length=1, max_length=64)
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


class AlipayPageSubscriptionCreateRequest(BaseModel):
    """支付宝电脑网站支付：创建订阅收银跳转 URL。"""

    tier: str = Field(min_length=1, max_length=20)
    billing_cycle: str = Field(min_length=1, max_length=20)


class AlipayPageWalletCreateRequest(BaseModel):
    """支付宝电脑网站支付：创建钱包充值收银跳转 URL。"""

    amount_cents: int = Field(ge=WALLET_TOPUP_MIN_CENTS, le=WALLET_TOPUP_MAX_CENTS)


class AuthRegisterRequest(BaseModel):
    password: str = Field(min_length=1, max_length=120)
    invite_code: str = Field(default="", max_length=120)
    phone: str | None = Field(default=None, max_length=32)
    email: str | None = Field(default=None, max_length=160)
    username: str | None = Field(default=None, max_length=32)


class AuthRegisterSendCodeRequest(BaseModel):
    email: str = Field(min_length=3, max_length=160)
    username: str = Field(min_length=3, max_length=32)
    invite_code: str = Field(default="", max_length=120)

    @field_validator("email")
    @classmethod
    def _register_send_code_email(cls, v: str) -> str:
        from app.fyv_shared.auth_service import register_email_format_ok

        s = (v or "").strip().lower()
        if not register_email_format_ok(s):
            raise ValueError("邮箱格式不正确，请填写含 @ 与域名后缀的有效地址（如 name@example.com）")
        return s


class AuthRegisterVerifyCodeRequest(BaseModel):
    email: str = Field(min_length=3, max_length=160)
    # 允许含空格/短输入，由 auth_service._normalize_register_otp_code 统一校验 6 位数字
    code: str = Field(min_length=1, max_length=32)


class AuthRegisterCompleteRequest(BaseModel):
    registration_ticket: str = Field(min_length=8, max_length=200)
    password: str = Field(min_length=6, max_length=120)


class AuthLoginRequest(BaseModel):
    password: str = Field(min_length=1, max_length=120)
    identifier: str = Field(
        min_length=1,
        max_length=160,
        validation_alias=AliasChoices("identifier", "phone", "login"),
    )


class AuthUnlockFeatureRequest(BaseModel):
    password: str = Field(min_length=1, max_length=120)
    phone: str = Field(default="", max_length=160)


class AuthVerifyEmailRequest(BaseModel):
    token: str = Field(min_length=8, max_length=200)


class AuthForgotPasswordRequest(BaseModel):
    email: str = Field(min_length=3, max_length=160)


class AuthResetPasswordRequest(BaseModel):
    token: str = Field(min_length=8, max_length=200)
    new_password: str = Field(min_length=6, max_length=120)


class AuthChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=120)
    new_password: str = Field(min_length=6, max_length=120)


class AuthProfilePatchRequest(BaseModel):
    """PATCH 时至少提供其一；未传的字段不更新。"""

    display_name: str | None = Field(default=None, max_length=48)
    username: str | None = Field(default=None, max_length=32)


class UserPreferencesPatchRequest(BaseModel):
    """与 models.ALLOWED_USER_PREF_KEYS 白名单配合；值为 JSON 可序列化对象。"""

    data: dict[str, Any] = Field(default_factory=dict)


class RssChannelUpsertRequest(BaseModel):
    """不传 id 时新建频道；传 id 时更新该用户名下已有频道。"""

    id: str | None = Field(default=None, max_length=64)
    title: str = Field(min_length=1, max_length=180)
    description: str = Field(default="", max_length=4000)
    author: str = Field(default="", max_length=180)
    language: str = Field(default="zh-cn", max_length=32)
    image_url: str = Field(default="", max_length=4000)


class SocialViralCopyRequest(BaseModel):
    """根据播客源任务生成小红书/抖音配套爆款文案。"""

    source_job_id: str = Field(min_length=8, max_length=64)
    platform: str = Field(min_length=1, max_length=24)

    @field_validator("platform")
    @classmethod
    def _norm_platform(cls, v: str) -> str:
        p = (v or "").strip().lower()
        if p not in ("xiaohongshu", "douyin"):
            raise ValueError("platform_must_be_xiaohongshu_or_douyin")
        return p


class RssPublishRequest(BaseModel):
    channel_id: str = Field(min_length=1, max_length=64)
    job_id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=300)
    summary: str = Field(default="", max_length=4000)
    show_notes: str = Field(default="", max_length=20_000)
    explicit: bool = Field(default=False)
    publish_at: str | None = None
    force_republish: bool = Field(default=False)


class JobAudioExportRequest(BaseModel):
    """导出带 ID3 与可选章节的 MP3。"""

    title: str = Field(default="", max_length=300)
    artist: str = Field(default="", max_length=120)
    album: str = Field(default="", max_length=120)
    embed_chapters: bool = Field(default=True)


class JobCoverDataRequest(BaseModel):
    """Base64 图片正文，供 BFF JSON 签名透传。"""

    image_base64: str = Field(min_length=1, max_length=12_000_000)
    content_type: str = Field(default="image/jpeg", max_length=120)


class JobResultScriptBodyRequest(BaseModel):
    """终态任务：将口播稿写入 jobs.result.script_text（作品详情改稿；长稿优先于短 result + 工件回退）。"""

    script_text: str = Field(default="", max_length=600_000)
