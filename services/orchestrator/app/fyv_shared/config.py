"""
配置管理模块
管理 API Key、默认音色、BGM 路径等配置常量
"""

import os
import json
import logging

from ..cover_image_style import normalize_minimax_image_style_type

# ========== API Keys ==========
# 统一 API Key（文本、TTS、音色克隆、图像生成都使用同一个）
# 优先读取 MINIMAX_API_KEY；兼容别名 MINIMAX_TEXT_API_KEY / MINIMAX_OTHER_API_KEY。
MINIMAX_API_KEY = (
    os.getenv("MINIMAX_API_KEY")
    or os.getenv("MINIMAX_TEXT_API_KEY")
    or os.getenv("MINIMAX_OTHER_API_KEY")
    or ""
).strip()

# 保留上述别名以兼容调用方
MINIMAX_TEXT_API_KEY = MINIMAX_API_KEY
MINIMAX_OTHER_API_KEY = MINIMAX_API_KEY

# ========== 默认音色配置 ==========
# 扩展方式：
# 1. 在下方字典中增加一项：键（key）= 前端/表单里使用的短名（小写英文为宜，如 nova）；
#    必填字段 voice_id 须与 MiniMax 控制台「语音合成 / 音色」里可用的 voice_id 一致。
# 2. name、gender、description 仅用于前端展示；TTS 只读 voice_id。
# 3. 保存后重启后端；前端「生成播客」页会从 GET /api/default-voices 自动拉取列表，无需改前端。
# 4. 已克隆音色仍走「自定义音色 / 已保存音色ID」，与这里的预设并列。
DEFAULT_VOICES = {
    "mini": {
        "name": "Mini",
        "gender": "female",
        "voice_id": "moss_audio_aaa1346a-7ce7-11f0-8e61-2e6e3c7ee85d",
        "description": "女声 - 活泼亲切"
    },
    "max": {
        "name": "Max",
        "gender": "male",
        "voice_id": "moss_audio_ce44fc67-7ce3-11f0-8de5-96e35d26fb85",
        "description": "男声 - 稳重专业"
    }

}

# ========== BGM 与运行时路径 ==========
# fyv_shared 位于 app/fyv_shared；默认数据仍在仓库（或镜像）内 legacy_backend/。
# 自上一级起查找包含 legacy_backend 目录的路径作为仓库根（兼容 Docker：/app + /app/legacy_backend）。
def _detect_repo_root() -> str:
    here = os.path.dirname(os.path.abspath(__file__))
    cur = here
    for _ in range(14):
        if os.path.isdir(os.path.join(cur, "legacy_backend")):
            return os.path.abspath(cur)
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    return os.path.abspath(os.path.join(here, "..", ".."))


_REPO_ROOT = _detect_repo_root()
BASE_DIR = os.path.join(_REPO_ROOT, "legacy_backend")
BGM_DIR = os.path.join(BASE_DIR, "assets")

BGM_FILES = {
    "bgm01": os.path.join(BGM_DIR, "bgm01.wav"),
    "bgm02": os.path.join(BGM_DIR, "bgm02.wav")
}

# 欢迎语音配置，此处可修改自己的sogan
WELCOME_TEXT = "欢迎收听AI播客节目"
WELCOME_VOICE_ID = DEFAULT_VOICES["mini"]["voice_id"]  # 使用 Mini 音色

# ========== MiniMax API 端点配置 ==========
# 控制台常见域名为 api.minimaxi.com；若文生图/TTS 与文档不一致可通过 MINIMAX_API_BASE 覆盖
MINIMAX_API_BASE = (os.getenv("MINIMAX_API_BASE") or "https://api.minimax.chat/v1").strip().rstrip("/") or "https://api.minimax.chat/v1"
_MINIMAX_API_PATHS = {
    "text_completion": "/text/chatcompletion_v2",
    "embeddings": "/embeddings",
    "tts": "/t2a_v2",
    # 长文本异步语音：[创建任务](https://platform.minimaxi.com/docs/api-reference/speech-t2a-async-create)
    "tts_async_create": "/t2a_async_v2",
    "tts_async_query": "/query/t2a_async_query_v2",
    "file_retrieve_content": "/files/retrieve_content",
    "voice_clone": "/voice_clone",
    "file_upload": "/files/upload",
    "image_generation": "/image_generation",
}
MINIMAX_API_ENDPOINTS = {k: f"{MINIMAX_API_BASE}{path}" for k, path in _MINIMAX_API_PATHS.items()}

# ========== 模型配置 ==========
# 可通过环境变量覆盖（推荐写入仓库根目录 .env.ai-native），未设置时使用下列默认值。
def _model_from_env(env_name: str, default: str) -> str:
    raw = os.getenv(env_name)
    if raw is None or not str(raw).strip():
        return default
    return str(raw).strip()


MODELS = {
    "text": _model_from_env("MINIMAX_TEXT_MODEL", "MiniMax-M2-Preview"),
    "tts": _model_from_env("MINIMAX_TTS_MODEL", "speech-2.8-turbo"),
    "voice_clone": _model_from_env("MINIMAX_VOICE_CLONE_MODEL", "speech-02-turbo"),
    "image": _model_from_env("MINIMAX_IMAGE_MODEL", "image-01-live"),
}

# ========== 播客生成配置 ==========
_SCRIPT_TARGET_CHARS_MAX = 50_000
PODCAST_CONFIG = {
    # 长文案分段：是否在每段生成后（第 2 段起）可选调用 API，用「边界补丁」优化段首衔接
    # heuristic_only=True 时仅在检测到重复开场倾向时调用，节省费用
    "segment_boundary_api_polish": False,
    "segment_boundary_api_heuristic_only": True,
    # 脚本生成目标字数（正文，不含 Speaker 前缀）；与前端、大模型输出能力对齐
    # 未显式传目标字数时的默认篇幅（与常见单集时长对齐）；显式传值上限于 hard_cap
    "script_target_chars_default": 800,
    "script_target_chars_min": 200,
    "script_target_chars_max": _SCRIPT_TARGET_CHARS_MAX,
    # 未显式传 script_target_chars 时上限（避免暗含过长目标拖慢生成）
    "script_target_chars_preferred_max": 2400,
    # 客户端显式传入时的服务端上限（仍需长稿可提高该值）
    "script_target_chars_hard_cap": 4000,
    "long_script_target_chars_max": _SCRIPT_TARGET_CHARS_MAX,
    "style": "轻松幽默",
    "speakers": ["Speaker1", "Speaker2"],
    # 脚本生成：上游 max_tokens / 轻量续写（材料内「已生成上文」）
    # MiniMax chatcompletion_v2 文档：max_completion_tokens 上限 2048
    "minimax_script_max_completion_tokens": 2048,
    # OpenAI 兼容（DeepSeek-V3.2 chat 等）：官方 max output 常见 8K 量级，勿超过文档
    "openai_compat_script_max_tokens_cap": 8192,
    # 单轮提示中的「本段目标字数」上限：与 minimax_script_max_completion_tokens 对齐（中文约 3k 量级）
    "script_generation_segment_target_chars_max": 4200,
    # OpenAI 兼容路径单段上限（常见 8K output，略放宽）
    "openai_compat_script_segment_target_chars_max": 4500,
    # 多轮续写上限略抬高，便于 MiniMax 2048t/轮 拼至 5 万言长文
    # Max 档 5 万言需多轮续写（MiniMax 单轮 completion 上限约 2048 tokens）
    "script_generation_max_continue_rounds": 32,
    # 未达目标且 finish_reason≠length 时：仅当当前字数 ≥ goal*ratio 才停续写（调高则更愿多续几轮）
    "script_generation_shortfall_ratio": 0.90,
    # 续写轮过短阈值略降，减少「略低于 80 字」被误判截断（仍防噪声）
    "script_continue_min_round_gain_chars": 60,
    "script_continue_material_tail_max_chars": 64_000,
    # 续写轮参考书截尾略增，平衡「有后文依据」与上下文体积
    "script_continue_reference_tail_max_chars": 28_000,
}

# ========== 超时配置（秒）==========
TIMEOUTS = {
    "segment_boundary_polish": 55,
    "polish_tts_text": 60,
    "url_parsing": 30,
    "pdf_parsing": 30,
    "voice_clone": 60,
    "script_generation": 180,
    "script_generation_openai_compat": 300,
    "tts_per_sentence": 30,
    # 同步 T2A stream=true 时读超时（connect, read 由调用方组合）
    "tts_stream_read": 300,
    "tts_async_create": 60,
    "tts_async_download": 120,
    "cover_prompt_generation": 60,  # 封面 Prompt 生成超时
    "image_generation": 90  # 图像生成超时（增加到90秒）
}

# ========== 文件路径配置 ==========
# 统一为 runtime 根目录下的 uploads / outputs / data，可由环境变量覆盖：
# - FYV_RUNTIME_DIR（总根目录，默认 <repo>/legacy_backend）
# - FYV_UPLOAD_DIR / FYV_OUTPUT_DIR / FYV_DATA_DIR（可单独覆盖）
def _resolve_runtime_dir(env_name: str, default_path: str) -> str:
    raw = os.environ.get(env_name, "").strip()
    path = raw if raw else default_path
    if not os.path.isabs(path):
        path = os.path.join(BASE_DIR, path)
    return os.path.abspath(path)


RUNTIME_DIR = _resolve_runtime_dir("FYV_RUNTIME_DIR", BASE_DIR)
UPLOAD_DIR = _resolve_runtime_dir("FYV_UPLOAD_DIR", os.path.join(RUNTIME_DIR, "uploads"))
OUTPUT_DIR = _resolve_runtime_dir("FYV_OUTPUT_DIR", os.path.join(RUNTIME_DIR, "outputs"))
DATA_DIR = _resolve_runtime_dir("FYV_DATA_DIR", os.path.join(RUNTIME_DIR, "data"))
VOICE_STORE_FILE = os.path.join(DATA_DIR, "saved_voices.json")
LEGACY_VOICE_STORE_FILE = os.path.join(OUTPUT_DIR, "saved_voices.json")

# 确保目录存在
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

# 初始化音色持久化文件
if not os.path.exists(VOICE_STORE_FILE):
    # 兼容迁移：优先沿用旧版 outputs 中的音色收藏
    if os.path.exists(LEGACY_VOICE_STORE_FILE):
        with open(LEGACY_VOICE_STORE_FILE, "r", encoding="utf-8") as src:
            payload = src.read()
        with open(VOICE_STORE_FILE, "w", encoding="utf-8") as dst:
            dst.write(payload)
    else:
        with open(VOICE_STORE_FILE, "w", encoding="utf-8") as f:
            json.dump([], f, ensure_ascii=False)

# ========== TTS 音频配置 ==========
TTS_AUDIO_SETTINGS = {
    "sample_rate": 32000,
    "bitrate": 128000,
    "format": "mp3",
    "channel": 1
}

# 与 MiniMax 文档对齐：https://platform.minimaxi.com/docs/api-reference/speech-t2a-http
TTS_SYNC_TEXT_MAX_CHARS = 10000  # 同步 T2A 单请求文本上限
TTS_SYNC_STREAM_THRESHOLD_CHARS = 3000  # 超过则同步请求使用 stream=true
# 异步创建接口 text 字段：https://platform.minimaxi.com/docs/api-reference/speech-t2a-async-create
TTS_ASYNC_TEXT_MAX_CHARS = 50_000
# 异步任务轮询（查询接口请勿高于约 10 次/秒）
TTS_ASYNC_POLL_INTERVAL_SEC = 2.0
TTS_ASYNC_POLL_MAX_SEC = 900

# MiniMax 润色：超长稿按段多次 chat completion（仅 legacy minimax_client 使用）
TTS_POLISH_INPUT_MAX_CHARS = 48_000
# 略增大单段上限，减少超长稿润色时的模型调用次数（仍受上游上下文与安全余量约束）
TTS_POLISH_DUAL_SEGMENT_MAX_CHARS = 4800
TTS_POLISH_SINGLE_SEGMENT_MAX_CHARS = 9000
TTS_POLISH_SEGMENT_CONTEXT_CHARS = 400

# ========== TTS 限流与重试配置 ==========
TTS_RATE_LIMIT_CONFIG = {
    "rpm_limit": 20,            # 主动限速：每分钟最多发起多少次 TTS 请求
    "max_retries": 5,           # 遇到限流时最多重试次数
    "initial_backoff_sec": 2.0, # 首次退避秒数
    "max_backoff_sec": 20.0,    # 退避上限秒数
    "jitter_sec": 0.5           # 随机抖动，避免并发雪崩
}

# ========== 图像生成配置 ==========
# 画风可被环境变量覆盖（部署后无需改代码）；非法值会记录 warning 并映射为合法枚举。
_IMAGE_STYLE_ENV_RAW = (
    os.getenv("MINIMAX_IMAGE_STYLE_TYPE")
    or os.getenv("MINIMAX_COVER_STYLE_TYPE")
    or os.getenv("AIPODCAST_IMAGE_STYLE_TYPE")
    or ""
).strip()
_IMAGE_STYLE_DEFAULT = "元气"
_IMAGE_STYLE_RESOLVED = (
    normalize_minimax_image_style_type(_IMAGE_STYLE_ENV_RAW, fallback=_IMAGE_STYLE_DEFAULT)
    if _IMAGE_STYLE_ENV_RAW
    else _IMAGE_STYLE_DEFAULT
)
if _IMAGE_STYLE_ENV_RAW and _IMAGE_STYLE_RESOLVED != _IMAGE_STYLE_ENV_RAW:
    logging.getLogger(__name__).warning(
        "图像画风环境变量原值=%r 与 MiniMax 要求不一致，已收敛为 %r；"
        "合法取值仅为：漫画、元气、中世纪、水彩（勿再使用「插画」「写实」等旧参数）。",
        _IMAGE_STYLE_ENV_RAW,
        _IMAGE_STYLE_RESOLVED,
    )

_IMAGE_SW_RAW = os.getenv("MINIMAX_IMAGE_STYLE_WEIGHT")
_IMAGE_STYLE_WEIGHT = 0.38
if _IMAGE_SW_RAW is not None and str(_IMAGE_SW_RAW).strip():
    try:
        _IMAGE_STYLE_WEIGHT = float(str(_IMAGE_SW_RAW).strip())
    except ValueError:
        _IMAGE_STYLE_WEIGHT = 0.38
if not (0.0 < _IMAGE_STYLE_WEIGHT <= 1.0):
    logging.getLogger(__name__).warning(
        "MINIMAX_IMAGE_STYLE_WEIGHT=%r 超出 (0,1]，已回退为 0.38",
        _IMAGE_SW_RAW,
    )
    _IMAGE_STYLE_WEIGHT = 0.38

IMAGE_GENERATION_CONFIG = {
    # 文生图（image-01-live）的 style.style_type 仅接受上列四值；见官方 StyleObject
    "style_type": _IMAGE_STYLE_RESOLVED,
    # 压低固定画风权重，避免覆盖「按主题写的」画面与媒介描述
    "style_weight": _IMAGE_STYLE_WEIGHT,
    "aspect_ratio": "1:1",
    "prompt_optimizer": True,
    "n": 1,
}

# ========== 日志配置 ==========
LOG_LEVEL = "INFO"
LOG_FORMAT = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
