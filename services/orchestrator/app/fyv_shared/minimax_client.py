"""
MiniMax API 客户端封装
统一管理所有 MiniMax API 调用，包括 M2 文本模型、TTS、音色克隆、文生图
"""

import requests
import json
import re
import logging
import time
import threading
import random
import os
import io
import zipfile
import tempfile
from collections import deque
from typing import Iterator, Dict, Any, Optional, Tuple
from .config import (
    MINIMAX_TEXT_API_KEY,
    MINIMAX_OTHER_API_KEY,
    MINIMAX_API_ENDPOINTS,
    MODELS,
    PODCAST_CONFIG,
    TTS_AUDIO_SETTINGS,
    TTS_RATE_LIMIT_CONFIG,
    TTS_SYNC_TEXT_MAX_CHARS,
    TTS_SYNC_STREAM_THRESHOLD_CHARS,
    TTS_ASYNC_TEXT_MAX_CHARS,
    TTS_ASYNC_POLL_INTERVAL_SEC,
    TTS_ASYNC_POLL_MAX_SEC,
    TTS_POLISH_INPUT_MAX_CHARS,
    TTS_POLISH_DUAL_SEGMENT_MAX_CHARS,
    TTS_POLISH_SINGLE_SEGMENT_MAX_CHARS,
    TTS_POLISH_SEGMENT_CONTEXT_CHARS,
    IMAGE_GENERATION_CONFIG,
    TIMEOUTS
)

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# TTS 前 AI 润色：双人 / 单人「要求」条款默认值（后台可写入 app_settings 覆盖）
TTS_POLISH_DEFAULT_DUAL_REQUIREMENTS = """1. 仅润色「本段原文」；输出也只包含本段对应内容，不要输出其它段或全文汇总。
2. 每一行必须以「Speaker1: 」或「Speaker2: 」开头（数字 1 或 2，半角冒号，冒号后恰好一个空格）。
3. 口语化、有交流感；可在转折、强调、举例、总结处适度加入语气词（如「其实」「说白了」「你看」「对吧」），另一方可用简短接应（如「对」「嗯」「是这样」）增强对话感；平均约每 2～4 轮对白至多一处较明显的语气点缀，避免每句开头堆叠语气词、勿连续重复同一口头禅或堆砌「嗯嗯啊啊」拖长篇幅；不要使用 Markdown、不要用编号列表当正文。
4. 可选用 MiniMax 语音合成支持的停顿与音效标记，且必须写在「Speaker1: 」/「Speaker2: 」后的正文内：停顿仅为 `<#x#>`，x 为 0.01～99.99 的秒数、最多两位小数（如 `<#0.5#>`、`<#1.2#>`），勿用 `<pause>`、勿用全角括号「（…）」写舞台说明（会被丢弃）。音效仅为半角英文小写括号标签，且仅限：laughs、chuckle、coughs、clear-throat、groans、breath、pant、inhale、exhale、gasps、sniffs、sighs、snorts、burps、lip-smacking、humming、hissing、emm、sneezes、whistles、crying、applause（示例：`(sighs)`、`(breath)`），禁止自造如 `(smile)` 等。平均约每 2～4 轮对白至多使用一处停顿或一处括号音效，勿同一句叠满，勿连续多句滥用；标签语气须符合当前行说话人。
5. 保留原意，不虚构事实；篇幅与本段接近，可略长但单段不超过本段原文 40%。
6. 不要写「以下是润色后」等说明。"""
TTS_POLISH_DEFAULT_SINGLE_REQUIREMENTS = """1. 仅润色本段原文；输出只含本段润色正文，不要输出其它段。
2. 适合中文语音单人口播：口语化，在转折、强调、过渡、总结处自然加入语气词与停顿感（如「其实」「说白了」「怎么说呢」「你看」「对吧」）；平均约每 2～4 句至多一处较明显的语气点缀，避免句首机械重复、勿连续堆砌「嗯啊噢」或拖长无心内容；不要用 Markdown、不要用编号列表当正文；可用短段落。
3. 可选用 MiniMax 语音合成支持的停顿与音效标记：停顿仅为 `<#x#>`，x 为 0.01～99.99 的秒数、最多两位小数（如 `<#0.5#>`、`<#1#>`），勿用 `<pause>`、勿用全角括号「（…）」写舞台说明。音效仅为半角英文小写括号标签，且仅限：laughs、chuckle、coughs、clear-throat、groans、breath、pant、inhale、exhale、gasps、sniffs、sighs、snorts、burps、lip-smacking、humming、hissing、emm、sneezes、whistles、crying、applause（示例：`(breath)`、`(chuckle)`），禁止自造标签名。平均约每 2～4 句至多一处停顿或一处括号音效，勿在同一句过度叠加。
4. 不要添加 Speaker1、Speaker2 等对话行格式。
5. 保留原意，不虚构事实；篇幅与本段接近，可略长但不超过本段 35%。
6. 不要写「以下是润色后」等说明。"""

# 脚本生成阶段注入的「语音向」摘要（与上文润色条款对齐要点，减少后续二次润色）
SCRIPT_GEN_TTS_ORAL_DIALOGUE_APPEND = """
【语音合成朗读向】输出应可直接交给 TTS：口语断句自然、有交流感；不要用 Markdown、不要用编号列表当对白正文；保留材料原意与数字、不虚构；
可选用停顿 `<#x#>`（x 为 0.01～99.99、最多两位小数）及白名单半角音效标签如 (breath)、(chuckle)；勿用全角括号写舞台说明；不要输出「以下是润色」「以下为脚本」等元话语。"""

SCRIPT_GEN_TTS_ORAL_ARTICLE_APPEND = """
【语音合成朗读向】该文稿将用于单人口播 TTS：请以连贯口语化段落为主，少用复杂 Markdown 标题层级与表格；避免用「1. 2. 3.」长列表代替完整论述；
可适当用语气词衔接；可选用 `<#x#>` 停顿与白名单半角音效（如 (breath)）；勿用全角括号舞台说明；不要元话语套话。"""

# 长文多段生成：减少繁体与「续写」类编排语泄漏（与 oral_for_tts 无关，文章路径始终叠用）
ARTICLE_OUTPUT_QUALITY_ZH_APPEND = """
【语言文字】若文稿为中文，须通篇使用大陆规范**简体中文**，勿使用繁体字或与繁体混排。
【输出边界】只输出可发表正文；禁止出现「续写」「第几段」「（接续）」「【接上文】」「以下为第二部分」等编排说明或分段标签；不要复述提示中的【】标记句。"""


class MinimaxClient:
    """MiniMax API 客户端"""

    def __init__(self):
        self.text_api_key = MINIMAX_TEXT_API_KEY
        self.other_api_key = MINIMAX_OTHER_API_KEY
        self.endpoints = MINIMAX_API_ENDPOINTS
        self.models = MODELS
        # TTS 请求滑动窗口（用于主动 RPM 限速）
        self._tts_request_times = deque()
        self._tts_rate_lock = threading.Lock()

    def _is_rate_limit_error(self, error_msg: str) -> bool:
        """判断是否为限流错误。"""
        if not error_msg:
            return False
        msg = error_msg.lower()
        keywords = [
            "rate limit",
            "rpm",
            "too many requests",
            "429",
            "请求过于频繁",
            "限流"
        ]
        return any(k in msg for k in keywords)

    def _is_insufficient_balance_error(self, error_msg: str) -> bool:
        """判断是否为余额不足错误。"""
        if not error_msg:
            return False
        msg = error_msg.lower()
        keywords = [
            "insufficient balance",
            "余额不足",
            "insufficient quota",
            "quota exceeded"
        ]
        return any(k in msg for k in keywords)

    def _is_proxy_tunnel_error(self, error_msg: str) -> bool:
        """判断是否为代理隧道失败错误。"""
        if not error_msg:
            return False
        msg = error_msg.lower()
        keywords = [
            "proxyerror",
            "tunnel connection failed",
            "unable to connect to proxy",
            "407",
            "403 forbidden"
        ]
        return any(k in msg for k in keywords)

    def _is_transient_tts_transport_error(self, exc: BaseException) -> bool:
        """TLS/中间网络偶发断连等，可退避重试（限流单独处理）。"""
        if isinstance(exc, requests.exceptions.Timeout):
            return True
        if isinstance(exc, (requests.exceptions.ConnectionError, requests.exceptions.ChunkedEncodingError)):
            return True
        msg = str(exc).lower()
        markers = (
            "connection reset",
            "connection aborted",
            "remotedisconnected",
            "broken pipe",
            "eof occurred in violation",
            "temporarily unavailable",
        )
        return any(m in msg for m in markers)

    def _post_with_proxy_fallback(self, url: str, **kwargs) -> requests.Response:
        """
        先按当前环境发请求；若代理隧道失败，则自动改为直连重试一次。
        """
        try:
            return requests.post(url, **kwargs)
        except requests.exceptions.RequestException as e:
            err_msg = str(e)
            if not self._is_proxy_tunnel_error(err_msg):
                raise
            logger.warning(f"检测到代理连接失败，尝试直连重试: {err_msg}")
            direct_kwargs = dict(kwargs)
            direct_kwargs.pop("proxies", None)
            direct_kwargs.pop("verify", None)
            session = requests.Session()
            session.trust_env = False  # 忽略 HTTP(S)_PROXY 环境变量
            return session.post(url, **direct_kwargs)

    def _throttle_tts_request(self):
        """主动限速，确保 TTS 请求不超过配置的 RPM。"""
        rpm_limit = max(1, int(TTS_RATE_LIMIT_CONFIG.get("rpm_limit", 20)))
        while True:
            with self._tts_rate_lock:
                now = time.time()
                window_start = now - 60.0
                while self._tts_request_times and self._tts_request_times[0] < window_start:
                    self._tts_request_times.popleft()

                if len(self._tts_request_times) < rpm_limit:
                    self._tts_request_times.append(now)
                    return

                wait_sec = max(0.1, 60.0 - (now - self._tts_request_times[0]))

            logger.warning(f"TTS 主动限速触发，等待 {wait_sec:.2f}s 后继续请求")
            time.sleep(wait_sec)

    def _get_headers(self, api_type: str = "other", api_key: Optional[str] = None) -> Dict[str, str]:
        """
        获取请求头

        Args:
            api_type: "text" 或 "other"
            api_key: 可选的自定义 API Key，如果不提供则使用默认配置

        Returns:
            请求头字典
        """
        if api_key:
            # 使用用户提供的 API Key
            key = api_key
        else:
            # 使用配置文件中的默认 API Key
            key = self.text_api_key if api_type == "text" else self.other_api_key

        return {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json"
        }

    def _extract_trace_id(self, response: requests.Response) -> Optional[str]:
        """
        从响应中提取 Trace ID

        Args:
            response: requests 响应对象

        Returns:
            Trace ID 字符串
        """
        trace_id = response.headers.get("Trace-ID") or response.headers.get("Trace-Id")
        if trace_id:
            logger.info(f"Trace-ID: {trace_id}")
        return trace_id

    def _extract_file_id_from_upload_result(self, upload_result: Dict[str, Any]) -> Optional[str]:
        """兼容不同上传接口返回结构，提取 file_id。"""
        if not isinstance(upload_result, dict):
            return None

        # 常见结构 1: {"file": {"file_id": "..."}}
        file_obj = upload_result.get("file")
        if isinstance(file_obj, dict):
            if file_obj.get("file_id"):
                return file_obj.get("file_id")
            if file_obj.get("id"):
                return file_obj.get("id")

        # 常见结构 2: {"file_id": "..."}
        if upload_result.get("file_id"):
            return upload_result.get("file_id")

        # 常见结构 3: {"data": {"file_id": "..."}}
        data_obj = upload_result.get("data")
        if isinstance(data_obj, dict):
            if data_obj.get("file_id"):
                return data_obj.get("file_id")
            if data_obj.get("id"):
                return data_obj.get("id")

        # 常见结构 4: {"files": [{"file_id":"..."}]}
        files_obj = upload_result.get("files")
        if isinstance(files_obj, list) and files_obj:
            first = files_obj[0]
            if isinstance(first, dict):
                if first.get("file_id"):
                    return first.get("file_id")
                if first.get("id"):
                    return first.get("id")

        return None

    def _prepare_voice_clone_upload_file(self, audio_file_path: str) -> tuple[str, Optional[str]]:
        """
        准备音色克隆上传文件：
        - 若扩展名已兼容则直接使用
        - 否则转码为 wav 临时文件后上传
        返回 (上传文件路径, 临时文件路径[用于清理])
        """
        supported_exts = {"wav", "mp3", "flac"}
        ext = os.path.splitext(audio_file_path)[1].lower().replace(".", "")
        if ext in supported_exts:
            return audio_file_path, None

        # 转码为 wav
        from pydub import AudioSegment
        audio = AudioSegment.from_file(audio_file_path)
        tmp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
        tmp_path = tmp_file.name
        tmp_file.close()
        audio.export(tmp_path, format="wav")
        logger.info(f"音色克隆上传前已转码: {audio_file_path} -> {tmp_path}")
        return tmp_path, tmp_path

    def _compose_article_script_prompt(
        self,
        *,
        content: str,
        target_chars: int,
        script_style: str,
        script_language: str,
        program_name: str,
        constraints_block: str,
        segment_role: Optional[str],
        segment_position: Optional[str],
        oral_for_tts: bool = False,
        full_goal_chars: Optional[int] = None,
    ) -> str:
        """普通文章（非双人播客对话）生成提示。"""
        pos_note = f"（{segment_position}）" if segment_position else ""
        if segment_role in ("middle", "last"):
            segment_banner = f"""
【长文章分段·接续写作{pos_note}】
下方「材料内容」中含「已生成上文」区块：你必须在该文之后续写，不要重复已有段落或句子。
严禁：再次写与上文重复的全文导语、标题或开篇套话；严禁使用 Speaker1/Speaker2 或对话体。
必须：本段从第一个字起即紧接「已生成上文」最后 1～2 句的话题、指代与语气（如同同一段落的自然延伸），禁止另起炉灶或再列提纲。
术语与事实与上文一致；段首禁止出现「续写」「接下来」「第二部分」等自我说明用语。
"""
        elif segment_role == "first":
            segment_banner = f"""
【长文章分段·开篇部分{pos_note}】
本段为长文的前段：需要清晰引入主题并展开论述；若非全文最后一段，末尾不要做「全文总结、致谢、再见」式收尾。
"""
        else:
            segment_banner = ""

        if segment_role == "first":
            rules_tail = """7. 开篇吸引读者并进入主题；本段末尾若后文仍有段落，不要做全篇总结或告别语。
8. 只输出文章正文，不要输出任务说明或元话语。
9. 禁止使用 Speaker1:/Speaker2: 行、禁止播客主持/听众口吻。
10. 严格遵守字数上限；可使用 Markdown 标题与列表辅助结构。"""
        elif segment_role == "middle":
            rules_tail = """7. 本段为中途续写：首句须直接承接上文末句语义，禁止重复标题与开篇、禁止对话体。
8. 只输出文章正文，不要任何分段/续写标记或小标题式编排说明。
9. 禁止使用 Speaker 行；论述与上文末段无缝衔接。
10. 严格遵守字数上限；本段末尾若非全文末段，不要做全篇总结。"""
        elif segment_role == "last":
            rules_tail = """7. 本段为收尾段：承接上文完成论证，并做简洁收束。
8. 只输出文章正文。
9. 禁止使用 Speaker 行；可做小结但不要编造上文未出现的新事实。
10. 严格遵守字数上限。"""
        else:
            rules_tail = """7. 结构完整：有引入、展开与收束（视篇幅调整详略）。
8. 只输出文章正文，不要输出任务说明或分段标记。
9. 禁止使用 Speaker1:/Speaker2:、禁止播客/对话脚本格式。
10. 严格遵守字数上限；接近收尾时自然收束。"""

        sl = (script_language or "").strip()
        _zh_article_quality = ""
        if "中文" in sl or sl.lower() in ("zh", "zh-cn", "简体", "简体中文"):
            _zh_article_quality = ARTICLE_OUTPUT_QUALITY_ZH_APPEND

        fg = int(full_goal_chars) if full_goal_chars is not None else 0
        if segment_role in ("first", "middle", "last") and fg > target_chars:
            span_block = (
                f"【篇幅】本段汉字量请控制在约 {target_chars} 字以内，充实但不堆砌。"
                f" 全文总目标约 {fg} 字，本段为多段之一：勿重复「已生成上文」已有内容。"
            )
        else:
            span_block = (
                f"【篇幅】全文汉字量请控制在约 {target_chars} 字以内，充实但不堆砌；材料不足时可略短。"
            )

        return f"""你是专业文章写作助手。请基于以下材料，写出一篇普通文章（非双人对话、非播客脚本）。
{segment_banner}
{span_block}

文稿信息：
- 主题/标题参考：{program_name}
- 语言：{script_language}
- 文风：{script_style}
- 用户与体裁约束：{constraints_block}

硬性要求：
1. 输出为连续可读的文章：可使用多级标题、段落、列表；允许使用 Markdown。
2. 不要写成两人问答；不要出现「Speaker1」「Speaker2」「主持人」「听众」「欢迎收听」等播客用语。
3. 基于材料写作，避免无根据编造；专业术语前后一致。
4. 不要以剧本、台词、对话行形式排版。
5. 不要单独输出「以下是正文」等提示语。
6. 若材料中有用户给出的结构要求（如分点、小结），请尽量满足。
{rules_tail}
{_zh_article_quality}
{SCRIPT_GEN_TTS_ORAL_ARTICLE_APPEND if oral_for_tts else ""}

材料内容：
{content}

请直接输出文章正文。"""

    def generate_script_stream(self,
                               content: str,
                               target_chars: int = 200,
                               api_key: Optional[str] = None,
                               script_style: str = "轻松幽默，自然流畅",
                               script_language: str = "中文",
                               program_name: str = "MiniMax AI 播客节目",
                               speaker1_persona: str = "活泼亲切，引导话题",
                               speaker2_persona: str = "稳重专业，深度分析",
                               script_constraints: str = "对话内容中不能包含（笑）（停顿）（思考）等动作、心理活动或场景描述，只生成纯对话文本。",
                               segment_role: Optional[str] = None,
                               segment_position: Optional[str] = None,
                               output_mode: str = "dialogue",
                               oral_for_tts: bool = True,
                               full_goal_chars: Optional[int] = None) -> Iterator[Dict[str, Any]]:
        """
        流式生成播客脚本

        Args:
            content: 解析后的内容文本
            target_chars: 目标正文字数上限（不含每行 Speaker 前缀），由服务端按配置裁剪
            api_key: 可选的自定义 API Key
            segment_role: 长文案分段时使用 first / middle / last；默认 None 表示单次完整生成
            segment_position: 可选，如「第 2/3 段」，写入提示便于模型理解任务
            oral_for_tts: True 时在提示中附加「语音合成朗读向」约束，便于下游少做二次润色
            full_goal_chars: 多段续写时的全文目标字数；仅当大于本段 target_chars 时写入提示

        Yields:
            包含脚本 chunk 和 trace_id 的字典
        """
        # 文本模型使用用户提供的 API Key
        url = self.endpoints["text_completion"]
        headers = self._get_headers("text", api_key=api_key)

        normalized_style = (script_style or "轻松幽默，自然流畅").strip()
        normalized_language = (script_language or "中文").strip()
        normalized_program_name = (program_name or "MiniMax AI 播客节目").strip()
        normalized_speaker1_persona = (speaker1_persona or "活泼亲切，引导话题").strip()
        normalized_speaker2_persona = (speaker2_persona or "稳重专业，深度分析").strip()
        normalized_constraints = (script_constraints or "").strip()
        if normalized_constraints:
            # 约束词过长时容易触发上游不稳定错误，做一次温和压缩：
            # 保留前部关键规则 + 后部收尾规则，兼顾稳定性和约束效果。
            max_constraint_chars = 1800
            if len(normalized_constraints) > max_constraint_chars:
                head_len = int(max_constraint_chars * 0.7)
                tail_len = max_constraint_chars - head_len
                normalized_constraints = (
                    normalized_constraints[:head_len].rstrip()
                    + "\n...\n"
                    + normalized_constraints[-tail_len:].lstrip()
                )
                logger.warning(
                    f"script_constraints 过长，已自动压缩后再请求模型（原始长度={len(script_constraints or '')}）"
                )

        constraints_block = normalized_constraints if normalized_constraints else "无额外约束。"

        output_mode = (output_mode or "dialogue").strip().lower()
        if output_mode == "article":
            logger.info(
                f"开始生成文章稿，内容长度: {len(content)} 字符，目标约 {target_chars} 字，"
                f"segment_role={segment_role!r} segment_position={segment_position!r}"
            )
            prompt = self._compose_article_script_prompt(
                content=content,
                target_chars=target_chars,
                script_style=normalized_style,
                script_language=normalized_language,
                program_name=normalized_program_name,
                constraints_block=constraints_block,
                segment_role=segment_role,
                segment_position=segment_position,
                oral_for_tts=oral_for_tts,
                full_goal_chars=full_goal_chars,
            )
        else:
            logger.info(
                f"开始生成播客脚本，内容长度: {len(content)} 字符，目标正文字数约: {target_chars}，"
                f"风格: {script_style}，语言: {script_language}，"
                f"segment_role={segment_role!r} segment_position={segment_position!r}"
            )
            pos_note = f"（{segment_position}）" if segment_position else ""
            if segment_role in ("middle", "last"):
                segment_banner = f"""
【长文案分段·接续写作{pos_note}】
下方「材料内容」中含「已生成上文」区块：那是已定稿的对话结尾。你必须输出**紧接该块最后一行之后**的新对话。
严禁：复制或改述「已生成上文」里已有句子；再次完整开场（如「大家好」「欢迎收听」「今天我们来聊」等）；像新开一期那样重讲大纲。
必须：你输出的第一行对话在话题、指代与语气上与「已生成上文」最后一行自然衔接；人设与参考素材一致。
"""
            elif segment_role == "first":
                segment_banner = f"""
【长文案分段·开篇段{pos_note}】
本段是同一期长节目的前半；开场要吸引人并进入主题，但末尾不要写全篇结束语（勿写「以上就是今天全部内容」「感谢收听再见」等），便于下一段接续。
"""
            else:
                segment_banner = ""

            if segment_role == "first":
                rules_7_10 = """7. 开场白要吸引人，快速进入主题；本段末尾只收束到小节点或自然停顿，不要写全篇总结或告别语。
8. 不要有多余的说明文字，只输出对话内容
9. 对话内容中不能包含（笑）（停顿）（思考）等动作、心理活动或场景描述，只生成纯对话文本
10. 严格遵守上述字数上限；本段结尾为「待续」感，不要宣称节目已结束"""
            elif segment_role == "middle":
                rules_7_10 = """7. 本段为中途接续：禁止问候听众、禁止重复节目开场与主题引入；从「已生成上文」末句自然延伸。
8. 不要有多余的说明文字，只输出对话内容
9. 对话内容中不能包含（笑）（停顿）（思考）等动作、心理活动或场景描述，只生成纯对话文本
10. 严格遵守上述字数上限；本段末尾仍不要做全篇总结，保留空间给下一段"""
            elif segment_role == "last":
                rules_7_10 = """7. 本段为收尾接续：禁止重新开场问候、禁止重复前文已出现过的完整开场套话；承接「已生成上文」末句继续展开，并在全段末尾用对话做简短小结，自然收束本期话题。
8. 不要有多余的说明文字，只输出对话内容
9. 对话内容中不能包含（笑）（停顿）（思考）等动作、心理活动或场景描述，只生成纯对话文本
10. 严格遵守上述字数上限；接近本段收尾时做简洁总结，结束要自然，勿突兀截断"""
            else:
                rules_7_10 = """7. 开场白要吸引人，结尾要有总结
8. 不要有多余的说明文字，只输出对话内容
9. 对话内容中不能包含（笑）（停顿）（思考）等动作、心理活动或场景描述，只生成纯对话文本
10. 严格遵守上述字数上限，接近收尾时主动收束、做简短总结，不要突然超长发挥"""

            if segment_role in ("middle", "last"):
                format_example = """格式示例（接续结构示意，勿照抄）：
Speaker1: 那我们接着刚才这点往下说。
Speaker2: 对，我补充一个具体例子。"""
            else:
                format_example = """格式示例（仅示意结构，勿照抄内容）：
Speaker1: 大家好，欢迎收听本期节目。
Speaker2: 今天咱们聊聊这个话题。"""

            tail_remind = ""
            if segment_role in ("middle", "last"):
                tail_remind = "请从「已生成上文」最后一行之后开始写，第一行必须是 Speaker1: 或 Speaker2:，且与上一行话题连贯。"

            _fg = int(full_goal_chars) if full_goal_chars is not None else 0
            if segment_role in ("first", "middle", "last") and _fg > target_chars:
                span_dialogue = (
                    f"【篇幅要求】统计字数时只计算对话正文，不要计入每行开头的 “Speaker1:” / “Speaker2:” 前缀。\n"
                    f"本段对话正文字数请控制在约 {target_chars} 字以内；整期节目对话正文总目标约 {_fg} 字，本段为多段之一。"
                    "尽量写满本段但不要明显超过本段上限；若材料不足可适当缩短。"
                )
            else:
                span_dialogue = (
                    "【篇幅要求】统计字数时只计算对话正文，不要计入每行开头的 “Speaker1:” / “Speaker2:” 前缀。\n"
                    f"全文对话正文字数请控制在约 {target_chars} 字以内，尽量写满但不要明显超过该上限；"
                    "若材料不足可适当缩短，避免无意义的冗长堆砌。"
                )

            # 构建 prompt
            prompt = f"""你是一个专业的播客脚本编写助手。请基于以下材料，生成一段双人播客对话脚本。
{segment_banner}
{span_dialogue}

播客节目信息：
- 节目名称：{normalized_program_name}
- 主持人：Mini（Speaker1）和 Max（Speaker2）

要求：
1. 输出语言：{normalized_language}
2. 对话风格：{normalized_style}
3. 说话人：Speaker1（Mini，{normalized_speaker1_persona}）和 Speaker2（Max，{normalized_speaker2_persona}）
4. 额外约束：{constraints_block}
5. 文本要自然，包含适当的重复、语气词、停顿等真人对话特征
6. 【行格式必须严格遵守】全文只能输出对话行，不要标题、不要 Markdown、不要编号列表说明。
   - 每一行恰好对应一句对话；禁止在同一行内写两句或以上（不要用分号、句号把多句拼在同一行）。
   - 每行必须以英文标识开头：`Speaker1:` 或 `Speaker2:`（注意大小写与冒号），冒号后接该句台词。
   - 除上述前缀外，行内只写台词正文，不要加「第几句」「旁白」等标签。
{rules_7_10}

{format_example}

材料内容：
{content}

请开始生成播客脚本。再次强调：（1）每行必须以 Speaker1: 或 Speaker2: 开头，一行一句；（2）对话正文中绝对不能包含括号内的动作/心理/场景说明，如（笑）（停顿）（思考）等。{tail_remind}"""
            if oral_for_tts:
                prompt = prompt.rstrip() + SCRIPT_GEN_TTS_ORAL_DIALOGUE_APPEND

        try:
            _mct = int(PODCAST_CONFIG.get("minimax_script_max_completion_tokens", 2048))
        except (TypeError, ValueError):
            _mct = 2048
        # 与 MiniMax chatcompletion_v2 OpenAPI 一致：单轮 completion 上限 2048 tokens
        max_completion_tokens = max(1, min(2048, _mct))

        payload = {
            "model": self.models["text"],
            "messages": [
                {"role": "system", "name": "MiniMax AI"},
                {"role": "user", "content": prompt}
            ],
            "stream": True,
            "max_completion_tokens": max_completion_tokens,
        }

        logger.info(f"发送脚本生成请求到: {url}")
        logger.info(f"请求模型: {self.models['text']}")

        trace_id = None
        try:
            response = self._post_with_proxy_fallback(
                url,
                headers=headers,
                json=payload,
                stream=True,
                timeout=TIMEOUTS["script_generation"]
            )

            # 立即提取 Trace ID（即使失败也要记录）
            trace_id = self._extract_trace_id(response)

            logger.info(f"脚本生成响应状态码: {response.status_code}")

            response.raise_for_status()

            logger.info("开始流式读取脚本内容...")

            # 流式读取响应
            chunk_count = 0
            finish_reason: Optional[str] = None
            for line in response.iter_lines():
                if line:
                    line = line.decode('utf-8')
                    raw_sse = line[5:].strip() if line.startswith('data:') else ""
                    if line.startswith('data:') and raw_sse == '[DONE]':
                        break
                    if line.startswith('data:'):
                        try:
                            data = json.loads(raw_sse)

                            # 检查是否有 base_resp 错误
                            if 'base_resp' in data:
                                base_resp = data.get('base_resp', {})
                                if base_resp.get('status_code') != 0:
                                    error_msg = base_resp.get('status_msg', '未知错误')
                                    logger.error(f"脚本生成 API 返回错误: {error_msg}")
                                    yield {
                                        "type": "error",
                                        "message": f"脚本生成失败: {error_msg}",
                                        "trace_id": trace_id
                                    }
                                    return

                            choices = data.get('choices')
                            if not isinstance(choices, list) or len(choices) == 0:
                                # 某些流式片段可能只有状态字段，choices 可能为 null，直接跳过
                                continue

                            first_choice = choices[0] if isinstance(choices[0], dict) else {}
                            fr = first_choice.get('finish_reason')
                            if fr:
                                finish_reason = str(fr)

                            delta = first_choice.get('delta') or {}
                            if not isinstance(delta, dict):
                                continue

                            content_chunk = delta.get('content')
                            if content_chunk is None:
                                continue
                            content_chunk = str(content_chunk)
                            if content_chunk:
                                chunk_count += 1
                                if chunk_count % 10 == 0:
                                    logger.info(f"已接收 {chunk_count} 个脚本 chunk")
                                yield {
                                    "type": "script_chunk",
                                    "content": content_chunk,
                                    "trace_id": trace_id
                                }
                        except json.JSONDecodeError as je:
                            logger.warning(f"JSON 解析失败: {line[:100]}")
                            continue

            logger.info(
                f"脚本生成完成，共接收 {chunk_count} 个 chunk，finish_reason={finish_reason!r}"
            )
            if chunk_count == 0:
                yield {
                    "type": "error",
                    "message": "脚本生成失败: 上游返回空内容（0 chunk）",
                    "trace_id": trace_id
                }
                return

            # 完成信号
            yield {
                "type": "script_complete",
                "trace_id": trace_id,
                "finish_reason": finish_reason or "stop",
            }

        except requests.exceptions.Timeout:
            error_msg = f"脚本生成超时（{TIMEOUTS['script_generation']}秒）"
            logger.error(error_msg)
            yield {
                "type": "error",
                "message": error_msg,
                "trace_id": trace_id
            }
        except requests.exceptions.RequestException as e:
            error_msg = f"脚本生成网络请求失败: {str(e)}"
            logger.error(error_msg)
            # 尝试从异常中提取 Trace ID
            if trace_id is None and hasattr(e, 'response') and e.response is not None:
                trace_id = self._extract_trace_id(e.response)
            yield {
                "type": "error",
                "message": error_msg,
                "trace_id": trace_id
            }
        except Exception as e:
            error_msg = f"脚本生成失败: {str(e)}"
            logger.error(error_msg)
            logger.exception("详细错误信息:")
            yield {
                "type": "error",
                "message": error_msg,
                "trace_id": trace_id
            }

    def polish_segment_boundary(
        self,
        prev_tail: str,
        new_segment_head: str,
        *,
        seg_transition: str = "",
        api_key: Optional[str] = None,
        script_style: str = "轻松幽默，自然流畅",
        script_language: str = "中文",
        program_name: str = "MiniMax AI 播客节目",
        speaker1_persona: str = "活泼亲切，引导话题",
        speaker2_persona: str = "稳重专业，深度分析",
    ) -> Dict[str, Any]:
        """
        边界补丁：根据上文末尾与本段开头草稿，生成更可读的 2～3 行接续对话（非流式）。
        失败时返回 success=False，由调用方保留原文。
        """
        url = self.endpoints["text_completion"]
        headers = self._get_headers("text", api_key=api_key)
        pt = (prev_tail or "").strip()
        nh = (new_segment_head or "").strip()
        if not pt or not nh:
            return {"success": False, "replacement_head": "", "error": "empty tail or head", "trace_id": None}
        if len(pt) > 4500:
            pt = pt[(len(pt) - 4500) :]
        if len(nh) > 2800:
            nh = nh[:2800]
        trans = (seg_transition or "").strip()[:400]
        trans_line = f"6) 段间衔接意图（参考）：{trans}\n" if trans else ""
        prompt = f"""你是播客双人对话脚本编辑。任务：只重写「本段开头草案」的前 2～3 句对话，使它们从「上文末尾」自然接续。

硬性规则：
1) 只输出 2 行或 3 行；每行必须以 Speaker1: 或 Speaker2: 开头，一行一句台词；不要标题、不要 Markdown、不要解释。
2) 严禁：大家好、欢迎收听、本期节目、我是主持人、今天我们来聊 等**又一次完整节目开场**。
3) 严禁编造新事实、新数据、新人名；沿用上文与草案中的说法即可。
4) 第一行说话人必须与「上文最后一行」交替（若上文末行是 Speaker1，则你必须以 Speaker2 开头）。
5) 语言：{script_language}；风格：{script_style}；节目：{program_name}；Speaker1（{speaker1_persona}）与 Speaker2（{speaker2_persona}）人设不变。
{trans_line}
【上文末尾（不可改写，仅用于承接）】
{pt}

【本段开头草案（请只替换其前 2～3 句为更顺的接续；其余内容不要输出）】
{nh}
"""
        payload = {
            "model": self.models["text"],
            "messages": [
                {"role": "system", "name": "MiniMax AI"},
                {"role": "user", "content": prompt},
            ],
            "stream": False,
        }
        timeout = TIMEOUTS.get("segment_boundary_polish", 55)
        trace_id = None
        try:
            resp = self._post_with_proxy_fallback(
                url,
                headers=headers,
                json=payload,
                timeout=timeout,
            )
            trace_id = self._extract_trace_id(resp)
            resp.raise_for_status()
            data = resp.json()
            base_resp = data.get("base_resp", {})
            if base_resp.get("status_code") not in (None, 0):
                return {
                    "success": False,
                    "replacement_head": "",
                    "error": base_resp.get("status_msg", "polish failed"),
                    "trace_id": trace_id,
                }
            raw = data.get("choices", [{}])[0].get("message", {}).get("content", "") or ""
            raw = raw.strip()
            if not raw:
                return {
                    "success": False,
                    "replacement_head": "",
                    "error": "empty model output",
                    "trace_id": trace_id,
                }
            return {
                "success": True,
                "replacement_head": raw,
                "error": "",
                "trace_id": trace_id,
            }
        except Exception as e:
            logger.warning("段间衔接 API 调用失败: %s", e)
            return {"success": False, "replacement_head": "", "error": str(e), "trace_id": trace_id}

    def polish_text_for_tts(
        self,
        text: str,
        *,
        api_key: Optional[str] = None,
        language: str = "中文",
    ) -> Dict[str, Any]:
        """
        将长文本润色为更适合 TTS 朗读的口语稿（非流式）。
        """
        raw = (text or "").strip()
        if not raw:
            return {"success": False, "text": "", "error": "empty text", "trace_id": None}
        if len(raw) > 12000:
            raw = raw[:12000]
        lang = (language or "中文").strip()
        prompt = f"""你是口语朗读稿编辑。请将下列文字润色为适合「语音合成朗读」的文稿：断句自然、语气顺畅，不改变事实与数字，不编造内容。
语言：{lang}。
只输出润色后的正文，不要标题、不要前言、不要 Markdown、不要引号包裹。"""
        url = self.endpoints["text_completion"]
        headers = self._get_headers("text", api_key=api_key)
        payload = {
            "model": self.models["text"],
            "messages": [
                {"role": "system", "name": "MiniMax AI"},
                {"role": "user", "content": f"{prompt}\n\n---\n\n{raw}"},
            ],
            "stream": False,
        }
        timeout = TIMEOUTS.get("polish_tts_text", 60)
        trace_id = None
        try:
            resp = self._post_with_proxy_fallback(
                url,
                headers=headers,
                json=payload,
                timeout=timeout,
            )
            trace_id = self._extract_trace_id(resp)
            resp.raise_for_status()
            data = resp.json()
            base_resp = data.get("base_resp", {})
            if base_resp.get("status_code") not in (None, 0):
                return {
                    "success": False,
                    "text": "",
                    "error": base_resp.get("status_msg", "polish failed"),
                    "trace_id": trace_id,
                }
            out = data.get("choices", [{}])[0].get("message", {}).get("content", "") or ""
            out = out.strip()
            if not out:
                return {
                    "success": False,
                    "text": "",
                    "error": "empty model output",
                    "trace_id": trace_id,
                }
            return {"success": True, "text": out, "error": "", "trace_id": trace_id}
        except Exception as e:
            logger.warning("TTS 润色 API 失败: %s", e)
            return {"success": False, "text": "", "error": str(e), "trace_id": trace_id}

    @staticmethod
    def _t2a_async_audio_setting_payload() -> Dict[str, Any]:
        """异步 T2A 使用 audio_sample_rate 字段名，与同步略有不同。"""
        return {
            "audio_sample_rate": TTS_AUDIO_SETTINGS["sample_rate"],
            "bitrate": TTS_AUDIO_SETTINGS["bitrate"],
            "format": TTS_AUDIO_SETTINGS["format"],
            "channel": TTS_AUDIO_SETTINGS["channel"],
        }

    @staticmethod
    def _bytes_from_t2a_async_download(data: bytes) -> bytes:
        """异步结果可能是单文件 mp3，或为含 mp3 的 zip。"""
        if len(data) >= 2 and data[:2] == b"PK":
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                names = [n for n in zf.namelist() if n.lower().endswith(".mp3")]
                if not names:
                    raise ValueError("异步 TTS 返回的压缩包中未找到 mp3")
                names.sort(key=len)
                return zf.read(names[0])
        return data

    def _parse_t2a_v2_streaming_http(self, response: requests.Response) -> Tuple[Optional[str], Optional[str]]:
        """
        解析同步 T2A 在 stream=true 时的 HTTP 流式正文（NDJSON / SSE data: 行）。
        优先使用 status==2 的完整 hex；否则拼接 status==1 的分片。
        """
        trace_id = None
        final_hex: Optional[str] = None
        partial: list[bytes] = []
        for raw in response.iter_lines(decode_unicode=False):
            if not raw:
                continue
            line = raw.decode("utf-8", errors="ignore").strip() if isinstance(raw, bytes) else str(raw).strip()
            if line.startswith("data:"):
                line = line[5:].strip()
            if not line or line == "[DONE]":
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                logger.warning("TTS stream 跳过无法解析的行: %s", line[:160])
                continue
            rows = obj if isinstance(obj, list) else [obj]
            for item in rows:
                if not isinstance(item, dict):
                    continue
                trace_id = item.get("trace_id") or trace_id
                base_resp = item.get("base_resp") or {}
                code = base_resp.get("status_code")
                if code not in (None, 0):
                    raise RuntimeError(base_resp.get("status_msg") or "T2A stream error")
                data = item.get("data")
                if not isinstance(data, dict):
                    continue
                aud = data.get("audio")
                st = data.get("status")
                if aud and st == 2:
                    final_hex = str(aud)
                elif aud and st == 1:
                    try:
                        partial.append(bytes.fromhex(str(aud)))
                    except ValueError:
                        pass
        if final_hex:
            return final_hex, trace_id
        if partial:
            return b"".join(partial).hex(), trace_id
        return None, trace_id

    def _synthesize_speech_async_blocking(
        self, text: str, voice_id: str, api_key: Optional[str] = None
    ) -> Tuple[str, Optional[str]]:
        """
        长文本：创建异步任务 → 轮询 → 下载二进制 → 返回 hex。
        文档：https://platform.minimaxi.com/docs/guides/speech-t2a-async
        """
        create_url = self.endpoints.get("tts_async_create")
        query_url = self.endpoints.get("tts_async_query")
        retrieve_url = self.endpoints.get("file_retrieve_content")
        if not create_url or not query_url or not retrieve_url:
            raise RuntimeError("缺少 tts_async_create / tts_async_query / file_retrieve_content 配置")

        key = ((api_key if api_key else self.other_api_key) or "").strip()
        if not key:
            raise RuntimeError("缺少 API Key")

        headers_json = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        payload = {
            "model": self.models["tts"],
            "text": text,
            "voice_setting": {
                "voice_id": voice_id,
                "speed": 1,
                "vol": 1,
                "pitch": 0,
            },
            "audio_setting": self._t2a_async_audio_setting_payload(),
        }

        self._throttle_tts_request()
        cre = self._post_with_proxy_fallback(
            create_url,
            headers=headers_json,
            json=payload,
            timeout=TIMEOUTS.get("tts_async_create", 60),
        )
        trace_id = self._extract_trace_id(cre)
        cre.raise_for_status()
        body = cre.json()
        base_resp = body.get("base_resp") or {}
        if base_resp.get("status_code") not in (None, 0):
            raise RuntimeError(base_resp.get("status_msg", "异步 TTS 创建失败"))

        task_id = body.get("task_id")
        if task_id is None:
            raise RuntimeError("异步 TTS 未返回 task_id")

        interval = float(TTS_ASYNC_POLL_INTERVAL_SEC)
        deadline = time.time() + float(TTS_ASYNC_POLL_MAX_SEC)
        audio_file_id = None
        q_headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

        while time.time() < deadline:
            resp = requests.get(
                query_url,
                params={"task_id": task_id},
                headers=q_headers,
                timeout=30,
            )
            trace_id = self._extract_trace_id(resp) or trace_id
            resp.raise_for_status()
            data = resp.json()
            br = data.get("base_resp") or {}
            if br.get("status_code") not in (None, 0):
                raise RuntimeError(br.get("status_msg", "异步 TTS 查询失败"))

            st = str(data.get("status") or "").strip().lower()
            if st == "success":
                audio_file_id = data.get("file_id")
                break
            if st in ("failed", "expired"):
                raise RuntimeError(f"异步 TTS 任务状态: {data.get('status')}")

            time.sleep(interval)

        if audio_file_id is None:
            raise RuntimeError("异步 TTS 轮询超时仍未完成")

        dl = requests.get(
            retrieve_url,
            params={"file_id": audio_file_id},
            headers=q_headers,
            timeout=TIMEOUTS.get("tts_async_download", 120),
        )
        trace_id = self._extract_trace_id(dl) or trace_id
        dl.raise_for_status()
        raw_bytes = self._bytes_from_t2a_async_download(dl.content)
        return raw_bytes.hex(), trace_id

    def synthesize_speech_stream(self, text: str, voice_id: str, api_key: Optional[str] = None) -> Iterator[Dict[str, Any]]:
        """
        语音合成：
        - 文本长度 > 同步单段上限（10000）：走异步 T2A（单段 text 最长 5 万字符按配置）；
        - 否则走同步 T2A；长度 > 3000 时 stream=true，否则 stream=false。

        Args:
            text: 要合成的文本
            voice_id: 音色 ID
            api_key: 可选的自定义 API Key

        Yields:
            包含音频 chunk 和 trace_id 的字典
        """
        n = len(text or "")
        if n > int(TTS_ASYNC_TEXT_MAX_CHARS):
            yield {
                "type": "error",
                "message": f"语音合成失败: 文本过长（{n} 字符），上限 {TTS_ASYNC_TEXT_MAX_CHARS}",
                "trace_id": None,
            }
            return

        if n > int(TTS_SYNC_TEXT_MAX_CHARS):
            trace_id: Optional[str] = None
            try:
                audio_hex, trace_id = self._synthesize_speech_async_blocking(text, voice_id, api_key)
                if not audio_hex:
                    yield {
                        "type": "error",
                        "message": "语音合成失败: 异步任务未返回音频数据",
                        "trace_id": trace_id,
                    }
                    return
                logger.info("异步 TTS 成功，hex 长度: %s", len(audio_hex))
                yield {"type": "audio_chunk", "audio": audio_hex, "trace_id": trace_id}
                yield {"type": "tts_complete", "trace_id": trace_id}
            except Exception as e:
                err_msg = str(e)
                logger.error("异步 TTS: %s", err_msg)
                yield {
                    "type": "error",
                    "message": f"语音合成失败: {err_msg}",
                    "trace_id": trace_id,
                }
            return

        url = self.endpoints["tts"]
        headers = self._get_headers("other", api_key=api_key)
        use_stream = n > int(TTS_SYNC_STREAM_THRESHOLD_CHARS)

        payload = {
            "model": self.models["tts"],
            "text": text,
            "stream": use_stream,
            "voice_setting": {
                "voice_id": voice_id,
                "speed": 1,
                "vol": 1,
                "pitch": 0
            },
            "audio_setting": TTS_AUDIO_SETTINGS,
            "subtitle_enable": False
        }

        max_retries = max(0, int(TTS_RATE_LIMIT_CONFIG.get("max_retries", 5)))
        initial_backoff_sec = float(TTS_RATE_LIMIT_CONFIG.get("initial_backoff_sec", 2.0))
        max_backoff_sec = float(TTS_RATE_LIMIT_CONFIG.get("max_backoff_sec", 20.0))
        jitter_sec = float(TTS_RATE_LIMIT_CONFIG.get("jitter_sec", 0.5))

        trace_id = None
        for attempt in range(max_retries + 1):
            try:
                self._throttle_tts_request()

                read_sec = int(TIMEOUTS.get("tts_stream_read", 300)) if use_stream else int(TIMEOUTS["tts_per_sentence"])
                req_timeout = (15, read_sec) if use_stream else read_sec

                response = self._post_with_proxy_fallback(
                    url,
                    headers=headers,
                    json=payload,
                    stream=bool(use_stream),
                    timeout=req_timeout
                )

                trace_id = self._extract_trace_id(response)
                response.raise_for_status()

                if use_stream:
                    audio_hex, tid = self._parse_t2a_v2_streaming_http(response)
                    trace_id = tid or trace_id
                    if not audio_hex:
                        logger.error("TTS 流式响应未解析到音频")
                        yield {
                            "type": "error",
                            "message": "语音合成失败: 流式响应未解析到音频",
                            "trace_id": trace_id
                        }
                        return
                    logger.info("TTS 流式成功，hex 长度: %s", len(audio_hex))
                    yield {"type": "audio_chunk", "audio": audio_hex, "trace_id": trace_id}
                    yield {"type": "tts_complete", "trace_id": trace_id}
                    return

                result = response.json()
                logger.info("TTS 响应: %s", result.get("base_resp", {}))

                base_resp = result.get("base_resp", {})
                if base_resp.get("status_code") != 0:
                    error_msg = base_resp.get("status_msg", "未知错误")
                    if self._is_insufficient_balance_error(error_msg):
                        yield {
                            "type": "error",
                            "message": "语音合成失败: API 账户余额不足（insufficient balance），请充值后重试。",
                            "trace_id": trace_id
                        }
                        return
                    if self._is_rate_limit_error(error_msg) and attempt < max_retries:
                        backoff = min(max_backoff_sec, initial_backoff_sec * (2 ** attempt))
                        backoff += random.uniform(0, max(0.0, jitter_sec))
                        logger.warning("TTS 命中限流(base_resp)，第 %s 次重试，等待 %.2fs", attempt + 1, backoff)
                        time.sleep(backoff)
                        continue

                    logger.error("TTS API 返回错误: %s, 完整响应: %s", error_msg, result)
                    yield {
                        "type": "error",
                        "message": f"语音合成失败: {error_msg}",
                        "trace_id": trace_id
                    }
                    return

                if "data" in result and "audio" in result["data"]:
                    audio_hex = result["data"]["audio"]
                    logger.info("TTS 成功，音频数据长度: %s 字符", len(audio_hex))
                    yield {
                        "type": "audio_chunk",
                        "audio": audio_hex,
                        "trace_id": trace_id
                    }
                else:
                    logger.error("TTS 响应中没有音频数据: %s", result)
                    yield {
                        "type": "error",
                        "message": "语音合成失败: 响应中没有音频数据",
                        "trace_id": trace_id
                    }
                    return

                yield {
                    "type": "tts_complete",
                    "trace_id": trace_id
                }
                return

            except Exception as e:
                err_msg = str(e)
                if trace_id is None and hasattr(e, "response") and e.response is not None:
                    trace_id = self._extract_trace_id(e.response)

                if self._is_insufficient_balance_error(err_msg):
                    yield {
                        "type": "error",
                        "message": "语音合成失败: API 账户余额不足（insufficient balance），请充值后重试。",
                        "trace_id": trace_id
                    }
                    return

                if self._is_rate_limit_error(err_msg) and attempt < max_retries:
                    backoff = min(max_backoff_sec, initial_backoff_sec * (2 ** attempt))
                    backoff += random.uniform(0, max(0.0, jitter_sec))
                    logger.warning(
                        "TTS 命中限流(异常)，第 %s 次重试，等待 %.2fs，错误: %s",
                        attempt + 1, backoff, err_msg,
                    )
                    time.sleep(backoff)
                    continue

                if self._is_transient_tts_transport_error(e) and attempt < max_retries:
                    backoff = min(max_backoff_sec, initial_backoff_sec * (2 ** attempt))
                    backoff += random.uniform(0, max(0.0, jitter_sec))
                    logger.warning(
                        "TTS 连接被对端重置或传输中断（第 %s 次重试，等待 %.2fs）: %s",
                        attempt + 1, backoff, err_msg,
                    )
                    time.sleep(backoff)
                    continue

                logger.error("TTS error: %s", err_msg)
                yield {
                    "type": "error",
                    "message": f"语音合成失败: {err_msg}",
                    "trace_id": trace_id
                }
                return

    def clone_voice(self, audio_file_path: str, voice_id: str, sample_text: str = "您好，我是客户经理李娜。", api_key: Optional[str] = None) -> Dict[str, Any]:
        """
        音色克隆

        Args:
            audio_file_path: 音频文件路径
            voice_id: 自定义音色 ID
            sample_text: 示例文本
            api_key: 可选的自定义 API Key

        Returns:
            包含 voice_id 和 trace_id 的字典
        """
        # Step 1: 上传音频文件
        upload_url = self.endpoints["file_upload"]
        key_to_use = api_key if api_key else self.other_api_key
        headers_upload = {
            "Authorization": f"Bearer {key_to_use}"
        }

        temp_upload_path = None
        try:
            upload_audio_path, temp_upload_path = self._prepare_voice_clone_upload_file(audio_file_path)
            logger.info(f"开始上传音频文件: {audio_file_path}")
            with open(upload_audio_path, 'rb') as f:
                files = {'file': f}
                data = {'purpose': 'voice_clone'}
                response_upload = self._post_with_proxy_fallback(
                    upload_url,
                    headers=headers_upload,
                    data=data,
                    files=files,
                    timeout=30
                )
                logger.info(f"文件上传响应状态码: {response_upload.status_code}")
                response_upload.raise_for_status()
                upload_trace_id = self._extract_trace_id(response_upload)

                upload_result = response_upload.json()
                logger.info(f"文件上传响应: {upload_result}")
                file_id = self._extract_file_id_from_upload_result(upload_result)

                if not file_id:
                    base_resp = upload_result.get("base_resp", {}) if isinstance(upload_result, dict) else {}
                    status_code = base_resp.get("status_code")
                    status_msg = base_resp.get("status_msg")
                    raw_text = (response_upload.text or "").strip()
                    raw_text_snippet = raw_text[:800] + ("..." if len(raw_text) > 800 else "")
                    if raw_text_snippet:
                        logger.error(f"文件上传原始响应（截断）: {raw_text_snippet}")
                    logger.error(f"文件上传失败，未获取到 file_id。完整响应: {upload_result}")
                    raise Exception(f"文件上传失败，未获取到 file_id（status_code={status_code}, status_msg={status_msg}）")

            # Step 2: 调用音色克隆 API
            logger.info(f"开始调用音色克隆 API，file_id: {file_id}, voice_id: {voice_id}")
            clone_url = self.endpoints["voice_clone"]
            headers_clone = self._get_headers("other", api_key=api_key)

            payload = {
                "file_id": file_id,
                "voice_id": voice_id,
                "text": sample_text,
                "model": self.models["voice_clone"]
            }

            logger.info(f"音色克隆请求 payload: {payload}")
            response_clone = self._post_with_proxy_fallback(
                clone_url,
                headers=headers_clone,
                json=payload,
                timeout=TIMEOUTS["voice_clone"]
            )
            logger.info(f"音色克隆响应状态码: {response_clone.status_code}")
            response_clone.raise_for_status()
            clone_trace_id = self._extract_trace_id(response_clone)

            result = response_clone.json()
            logger.info(f"音色克隆响应: {result}")

            # 检查 base_resp.status_code
            base_resp = result.get("base_resp", {})
            if base_resp.get("status_code") != 0:
                error_msg = base_resp.get("status_msg", "未知错误")
                logger.error(f"音色克隆 API 返回错误: status_code={base_resp.get('status_code')}, msg={error_msg}")
                logger.error(f"完整响应: {result}")
                return {
                    "success": False,
                    "error": error_msg,
                    "message": f"音色克隆失败: {error_msg}",
                    "upload_trace_id": upload_trace_id,
                    "clone_trace_id": clone_trace_id
                }

            return {
                "success": True,
                "voice_id": voice_id,
                "upload_trace_id": upload_trace_id,
                "clone_trace_id": clone_trace_id,
                "message": "音色克隆成功"
            }

        except Exception as e:
            logger.error(f"Voice clone error: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "message": f"音色克隆失败: {str(e)}"
            }
        finally:
            if temp_upload_path and os.path.exists(temp_upload_path):
                try:
                    os.unlink(temp_upload_path)
                except Exception:
                    pass

    def generate_cover_image(self, content_summary: str, api_key: Optional[str] = None) -> Dict[str, Any]:
        """
        生成播客封面图

        Args:
            content_summary: 内容摘要
            api_key: 可选的自定义 API Key

        Returns:
            包含图片 URL 和 trace_id 的字典
        """
        # Step 1: 生成图片 prompt
        prompt_generation_prompt = f"""基于以下播客内容摘要，生成一个简洁的图片描述 prompt。

要求：
1. 描述要简洁直观，30字以内

播客内容摘要：
{content_summary}

请直接输出图片描述 prompt（不要有多余说明）："""

        text_trace_id = None
        try:
            # Step 1: 调用 M2 生成 prompt（文本模型使用用户提供的 API Key）
            logger.info("开始生成封面图 Prompt...")
            url_text = self.endpoints["text_completion"]
            headers_text = self._get_headers("text", api_key=api_key)

            payload_text = {
                "model": self.models["text"],
                "messages": [
                    {"role": "system", "name": "MiniMax AI"},
                    {"role": "user", "content": prompt_generation_prompt}
                ],
                "stream": False
            }

            logger.info(f"发送 Prompt 生成请求到: {url_text}")
            response_text = self._post_with_proxy_fallback(
                url_text,
                headers=headers_text,
                json=payload_text,
                timeout=TIMEOUTS["cover_prompt_generation"]
            )

            # 立即提取 Trace ID
            text_trace_id = self._extract_trace_id(response_text)
            logger.info(f"Prompt 生成响应状态码: {response_text.status_code}")

            response_text.raise_for_status()

            text_result = response_text.json()
            image_prompt = text_result.get("choices", [{}])[0].get("message", {}).get("content", "")

            logger.info(f"生成的图片 Prompt: {image_prompt}")

            if not image_prompt:
                image_prompt = "一男一女两个人坐在播客录音室里，漫画风格"
                logger.info(f"使用默认 Prompt: {image_prompt}")

            # Step 2: 调用文生图 API
            logger.info("开始生成封面图...")
            url_image = self.endpoints["image_generation"]
            headers_image = self._get_headers("other", api_key=api_key)

            payload_image = {
                "model": self.models["image"],
                "prompt": image_prompt,
                "aspect_ratio": IMAGE_GENERATION_CONFIG["aspect_ratio"],
                "response_format": "url",
                "n": IMAGE_GENERATION_CONFIG["n"],
                "prompt_optimizer": IMAGE_GENERATION_CONFIG["prompt_optimizer"],
                "style": {
                    "style_type": IMAGE_GENERATION_CONFIG["style_type"],
                    "style_weight": IMAGE_GENERATION_CONFIG["style_weight"]
                }
            }

            logger.info(f"图像生成 API: {url_image}")
            logger.info(f"图像生成请求 payload: {payload_image}")

            response_image = self._post_with_proxy_fallback(
                url_image,
                headers=headers_image,
                json=payload_image,
                timeout=TIMEOUTS["image_generation"]
            )

            # 立即提取 Trace ID（即使请求失败也要记录）
            image_trace_id = self._extract_trace_id(response_image)

            logger.info(f"图像生成响应状态码: {response_image.status_code}")
            logger.info(f"图像生成响应内容前500字符: {response_image.text[:500]}")

            response_image.raise_for_status()
            logger.info("图像生成请求状态检查通过")

            image_result = response_image.json()

            logger.info(f"图像生成完整响应: {image_result}")

            # 检查 base_resp.status_code
            base_resp = image_result.get("base_resp", {})
            if base_resp.get("status_code") != 0:
                error_msg = base_resp.get("status_msg", "未知错误")
                logger.error(f"API 返回错误状态: status_code={base_resp.get('status_code')}, msg={error_msg}")
                return {
                    "success": False,
                    "error": error_msg,
                    "message": f"封面生成失败: {error_msg}",
                    "text_trace_id": text_trace_id,
                    "image_trace_id": image_trace_id
                }

            image_url = self._first_image_url_from_generation_response(image_result)
            if not image_url:
                logger.error(f"无法从文生图响应解析图片: {image_result}")
                return {
                    "success": False,
                    "error": "API 响应格式错误，未解析到图片 URL 或 base64",
                    "message": "封面生成失败: API 响应格式异常",
                    "text_trace_id": text_trace_id,
                    "image_trace_id": image_trace_id
                }

            logger.info(f"成功获取封面图: {image_url[:96]}{'…' if len(image_url) > 96 else ''}")

            return {
                "success": True,
                "image_url": image_url,
                "prompt": image_prompt,
                "text_trace_id": text_trace_id,
                "image_trace_id": image_trace_id,
                "message": "封面生成成功"
            }

        except requests.exceptions.RequestException as e:
            error_msg = f"网络请求失败: {str(e)}"
            logger.error(f"Cover image generation error: {error_msg}")

            # 尝试从异常中提取 response 对象
            image_trace_id = None
            if hasattr(e, 'response') and e.response is not None:
                image_trace_id = self._extract_trace_id(e.response)

            return {
                "success": False,
                "error": error_msg,
                "message": f"封面生成失败: {error_msg}",
                "text_trace_id": text_trace_id if 'text_trace_id' in locals() else None,
                "image_trace_id": image_trace_id
            }
        except Exception as e:
            error_msg = str(e) if str(e) else "未知错误"
            logger.error(f"Cover image generation error: {error_msg}")
            return {
                "success": False,
                "error": error_msg,
                "message": f"封面生成失败: {error_msg}",
                "text_trace_id": text_trace_id if 'text_trace_id' in locals() else None,
                "image_trace_id": None
            }

    def _first_image_url_from_generation_response(self, image_result: Dict[str, Any]) -> Optional[str]:
        """兼容多种文生图响应：image_urls、images[].url、image_base64 等。"""
        data = image_result.get("data")
        if not isinstance(data, dict):
            data = {}
        urls = data.get("image_urls")
        if isinstance(urls, list):
            for u in urls:
                if isinstance(u, str) and u.strip():
                    return u.strip()
        imgs = data.get("images") or data.get("image_list")
        if isinstance(imgs, list):
            for it in imgs:
                if isinstance(it, dict):
                    for k in ("url", "image_url", "download_url", "imageUrl"):
                        v = it.get(k)
                        if isinstance(v, str) and v.strip():
                            return v.strip()
                elif isinstance(it, str) and it.strip():
                    return it.strip()
        for key in ("image_base64", "image", "base64", "b64_json"):
            b64 = data.get(key)
            if isinstance(b64, str) and b64.strip():
                raw = b64.strip()
                if raw.startswith("data:"):
                    return raw
                return f"data:image/png;base64,{raw}"
        return None

    def generate_script_outline(self,
                                content: str,
                                total_target_chars: int,
                                api_key: Optional[str] = None,
                                script_style: str = "轻松幽默，自然流畅",
                                script_language: str = "中文",
                                program_name: str = "MiniMax AI 播客节目",
                                speaker1_persona: str = "活泼亲切，引导话题",
                                speaker2_persona: str = "稳重专业，深度分析",
                                script_constraints: str = "",
                                output_mode: str = "dialogue") -> Dict[str, Any]:
        """
        先生成结构化总纲（JSON），用于长文案分段一致性。
        """
        url = self.endpoints["text_completion"]
        headers = self._get_headers("text", api_key=api_key)
        constraints = (script_constraints or "").strip()
        if len(constraints) > 1200:
            constraints = constraints[:1200]

        om = (output_mode or "dialogue").strip().lower()
        if om == "article":
            prompt = f"""请先为长文章生成“分段总纲”，不要输出正文。
输出必须是 JSON（不要 markdown 代码块），结构如下：
{{
  "segments":[
    {{
      "id": 1,
      "title": "章节标题",
      "target_chars": 1200,
      "must_include": ["要点1","要点2"],
      "transition_hint": "与上一章如何衔接"
    }}
  ]
}}

要求：
1) 各段 target_chars 之和接近 {total_target_chars}。
2) 在总字数允许的前提下，优先使用较少段数；每章写得更完整。
3) 结构循序渐进：背景与问题 -> 核心论点/定义 -> 展开论证 -> 案例或数据 -> 小结与展望（按需）。
4) 每段必须含 transition_hint。
5) 语言={script_language}，风格={script_style}，文稿主题={program_name}。
6) 这是文章结构（非双人对话），各段为章节脉络。
7) 约束（参考）：{constraints or "无"}。

素材：
{content}
"""
        else:
            prompt = f"""请先为播客正文生成“分段总纲”，不要输出正文台词。
输出必须是 JSON（不要 markdown 代码块），结构如下：
{{
  "segments":[
    {{
      "id": 1,
      "title": "段标题",
      "target_chars": 1200,
      "must_include": ["要点1","要点2"],
      "transition_hint": "与上一段如何衔接"
    }}
  ]
}}

要求：
1) 各段 target_chars 之和接近 {total_target_chars}。
2) 在总字数允许的前提下，优先使用较少段数：每段写得更完整、减少段间接缝与重复铺垫；不要为了凑段而切碎。
3) 结构循序渐进：背景导入 -> 核心定义 -> 方法展开 -> 案例验证 -> 收束总结。
4) 每段必须含 transition_hint。
5) 语言={script_language}，风格={script_style}，节目名={program_name}。
6) 人设：Speaker1={speaker1_persona}；Speaker2={speaker2_persona}。
7) 约束（参考）：{constraints or "无"}。

素材：
{content}
"""
        payload = {
            "model": self.models["text"],
            "messages": [
                {"role": "system", "name": "MiniMax AI"},
                {"role": "user", "content": prompt}
            ],
            "stream": False
        }
        try:
            resp = self._post_with_proxy_fallback(
                url,
                headers=headers,
                json=payload,
                timeout=TIMEOUTS["script_generation"]
            )
            trace_id = self._extract_trace_id(resp)
            resp.raise_for_status()
            data = resp.json()
            base_resp = data.get("base_resp", {})
            if base_resp.get("status_code") not in (None, 0):
                return {
                    "success": False,
                    "error": base_resp.get("status_msg", "outline failed"),
                    "outline_text": "",
                    "trace_id": trace_id
                }
            raw = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            return {"success": True, "outline_text": raw or "", "trace_id": trace_id}
        except Exception as e:
            return {"success": False, "error": str(e), "outline_text": ""}

    def generate_cross_doc_reasoning(self,
                                     evidence_text: str,
                                     api_key: Optional[str] = None) -> Dict[str, Any]:
        """
        跨文档证据归纳（JSON 输出）。
        """
        url = self.endpoints["text_completion"]
        headers = self._get_headers("text", api_key=api_key)
        prompt = f"""你是跨文档证据分析助手。基于给定证据，输出 JSON：
{{
  "facts":[{{"claim":"", "sources":["chunk#1"]}}],
  "conflicts":[{{"topic":"", "a":"", "b":"", "sources":["chunk#2","chunk#5"]}}],
  "consensus":[""],
  "open_questions":[""]
}}

要求：
1) 仅输出 JSON，不要 markdown。
2) facts 只保留有证据支撑的结论。
3) conflicts 仅在证据明显冲突时输出。
4) consensus 最多 10 条，open_questions 最多 6 条。

证据：
{evidence_text}
"""
        payload = {
            "model": self.models["text"],
            "messages": [
                {"role": "system", "name": "MiniMax AI"},
                {"role": "user", "content": prompt}
            ],
            "stream": False
        }
        try:
            resp = self._post_with_proxy_fallback(
                url,
                headers=headers,
                json=payload,
                timeout=TIMEOUTS["script_generation"]
            )
            trace_id = self._extract_trace_id(resp)
            resp.raise_for_status()
            data = resp.json()
            txt = data.get("choices", [{}])[0].get("message", {}).get("content", "") or ""
            # 尝试直接/抽取 JSON
            parsed = None
            try:
                parsed = json.loads(txt)
            except Exception:
                m = re.search(r"\{[\s\S]*\}", txt)
                if m:
                    try:
                        parsed = json.loads(m.group(0))
                    except Exception:
                        parsed = None
            if not isinstance(parsed, dict):
                return {"success": False, "error": "reasoning json parse failed", "trace_id": trace_id}
            return {"success": True, "reasoning": parsed, "trace_id": trace_id}
        except Exception as e:
            return {"success": False, "error": str(e)}

    @staticmethod
    def _split_lines_into_char_segments(lines: list[str], max_chars: int) -> list[str]:
        """按行打包，单段字符数不超过 max_chars（含换行）。"""
        segments: list[str] = []
        buf: list[str] = []
        size = 0
        for line in lines:
            need = len(line) + (1 if buf else 0)
            if buf and size + need > max_chars:
                segments.append("\n".join(buf))
                buf = [line]
                size = len(line)
            else:
                buf.append(line)
                size += need
        if buf:
            segments.append("\n".join(buf))
        return [s for s in segments if s.strip()]

    @staticmethod
    def _split_single_into_segments(raw: str, max_chars: int) -> list[str]:
        """单人稿：优先按空行分段，再合并为不超过 max_chars 的块；单段超长则硬切。"""
        t = (raw or "").strip()
        if not t:
            return []
        paras = [p.strip() for p in re.split(r"\n\s*\n+", t) if p.strip()]
        if not paras:
            return [t] if len(t) <= max_chars else MinimaxClient._hard_chunk_text(t, max_chars)
        segs: list[str] = []
        buf: list[str] = []
        n = 0
        for p in paras:
            if len(p) > max_chars:
                if buf:
                    segs.append("\n\n".join(buf))
                    buf = []
                    n = 0
                segs.extend(MinimaxClient._hard_chunk_text(p, max_chars))
                continue
            add = len(p) + (2 if buf else 0)
            if buf and n + add > max_chars:
                segs.append("\n\n".join(buf))
                buf = [p]
                n = len(p)
            else:
                buf.append(p)
                n += add
        if buf:
            segs.append("\n\n".join(buf))
        return [s for s in segs if s.strip()]

    @staticmethod
    def _hard_chunk_text(p: str, max_chars: int) -> list[str]:
        if len(p) <= max_chars:
            return [p]
        out: list[str] = []
        i = 0
        while i < len(p):
            out.append(p[i : i + max_chars])
            i += max_chars
        return out

    @staticmethod
    def _polish_tail_for_next_segment(polished_chunk: str, max_chars: int) -> str:
        ls = [x.strip() for x in polished_chunk.split("\n") if x.strip()]
        if not ls:
            return ""
        tail_lines = ls[-2:] if len(ls) >= 2 else ls[-1:]
        t = "\n".join(tail_lines)
        if len(t) > max_chars:
            t = t[-max_chars:]
        return t

    def _polish_tts_chat_completion(self, user_content: str, api_key: Optional[str]) -> Tuple[str, Optional[str]]:
        url = self.endpoints["text_completion"]
        headers = self._get_headers("text", api_key=api_key)
        payload = {
            "model": self.models["text"],
            "messages": [
                {"role": "system", "name": "MiniMax AI"},
                {"role": "user", "content": user_content},
            ],
            "stream": False,
        }
        resp = self._post_with_proxy_fallback(
            url,
            headers=headers,
            json=payload,
            timeout=TIMEOUTS["script_generation"],
        )
        trace_id = self._extract_trace_id(resp)
        resp.raise_for_status()
        data = resp.json()
        base = data.get("base_resp") or {}
        if isinstance(base, dict) and base.get("status_code") not in (0, None):
            raise RuntimeError(str(base.get("status_msg") or "upstream_error"))
        txt = data.get("choices", [{}])[0].get("message", {}).get("content", "") or ""
        return str(txt).strip(), trace_id

    def chat_completion_messages(
        self,
        messages: list[Dict[str, Any]],
        api_key: Optional[str] = None,
        *,
        temperature: float = 0.65,
    ) -> Tuple[str, Optional[str]]:
        """非流式多轮文本补全（结构化 JSON、运营文案等非播客脚本场景）。"""
        url = self.endpoints["text_completion"]
        headers = self._get_headers("text", api_key=api_key)
        norm: list[Dict[str, Any]] = []
        for m in messages:
            if not isinstance(m, dict):
                continue
            role = str(m.get("role") or "user").strip().lower()
            if role not in ("system", "user", "assistant"):
                role = "user"
            content = str(m.get("content") or "").strip()
            if not content:
                continue
            entry: Dict[str, Any] = {"role": role, "content": content}
            name = m.get("name")
            if name:
                entry["name"] = str(name)
            norm.append(entry)
        if not norm:
            raise ValueError("chat_messages_empty")
        payload = {
            "model": self.models["text"],
            "messages": norm,
            "stream": False,
            "temperature": float(temperature),
        }
        resp = self._post_with_proxy_fallback(
            url,
            headers=headers,
            json=payload,
            timeout=TIMEOUTS["script_generation"],
        )
        trace_id = self._extract_trace_id(resp)
        resp.raise_for_status()
        data = resp.json()
        base = data.get("base_resp") or {}
        if isinstance(base, dict) and base.get("status_code") not in (0, None):
            raise RuntimeError(str(base.get("status_msg") or "upstream_error"))
        txt = data.get("choices", [{}])[0].get("message", {}).get("content", "") or ""
        return str(txt).strip(), trace_id

    @staticmethod
    def _resolve_polish_requirements(override: Optional[str], default: str) -> str:
        if override is None:
            return default
        s = str(override).strip()
        return s if s else default

    def polish_intro_outro_bundle(
        self,
        intro: str,
        outro: str,
        api_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        单次文本模型调用：将开场、收场两段分别润色为适合 TTS 单人口播的口语稿。
        解析失败时由调用方回退为两次独立润色。
        """
        intro_t = (intro or "").strip()
        outro_t = (outro or "").strip()
        if not intro_t or not outro_t:
            return {"success": False, "error": "开场或收场为空"}
        user_prompt = f"""你是中文播客撰稿编辑。下面两段分别是同一期节目的「开场原文」与「收场原文」。
请分别润色为适合单人口播语音合成的口语稿：自然断句、语气顺畅；不用 Markdown；不编造事实；不要「以下是润色」等元说明。

输出格式必须严格如下（大写标记单独成行，从第一行开始）：
BEGIN_INTRO
（仅开场润色正文）
END_INTRO
BEGIN_OUTRO
（仅收场润色正文）
END_OUTRO

开场原文：
{intro_t}

收场原文：
{outro_t}"""
        last_trace: Optional[str] = None
        try:
            raw, last_trace = self._polish_tts_chat_completion(user_prompt, api_key)
        except Exception as e:
            return {"success": False, "error": str(e), "trace_id": last_trace}
        m = re.search(
            r"BEGIN_INTRO\s*\n(.*?)\n\s*END_INTRO\s*\n\s*BEGIN_OUTRO\s*\n(.*)",
            raw,
            flags=re.DOTALL | re.IGNORECASE,
        )
        if not m:
            return {
                "success": False,
                "error": "bundle_parse_failed",
                "trace_id": last_trace,
            }
        pi = m.group(1).strip()
        rest = m.group(2).strip()
        po = re.split(r"\n\s*END_OUTRO\b", rest, maxsplit=1, flags=re.IGNORECASE)[0].strip()
        if not pi or not po:
            return {"success": False, "error": "bundle_empty_segment", "trace_id": last_trace}
        return {"success": True, "intro": pi, "outro": po, "trace_id": last_trace}

    def polish_article_for_tts(
        self,
        text: str,
        api_key: Optional[str] = None,
        *,
        tts_mode: str = "single",
        dual_requirements: Optional[str] = None,
        single_requirements: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        MiniMax 文本模型：口述润色。
        - single：单人口播；超长则按段多次请求。
        - dual：双人 Speaker1/Speaker2 脚本；超长按行打包分段多次请求，并带上一段结尾作衔接参考。
        - dual_requirements / single_requirements：可选，覆盖「要求」编号条款（后台配置）；空字符串沿用内置默认。
        """
        raw = (text or "").strip()
        if not raw:
            return {"success": False, "error": "文本为空"}
        in_max = int(TTS_POLISH_INPUT_MAX_CHARS)
        if len(raw) > in_max:
            raw = raw[:in_max]

        mode = str(tts_mode or "single").strip().lower()
        if mode not in ("single", "dual"):
            mode = "single"

        dual_seg_max = int(TTS_POLISH_DUAL_SEGMENT_MAX_CHARS)
        single_seg_max = int(TTS_POLISH_SINGLE_SEGMENT_MAX_CHARS)
        ctx_max = int(TTS_POLISH_SEGMENT_CONTEXT_CHARS)

        dual_req = self._resolve_polish_requirements(dual_requirements, TTS_POLISH_DEFAULT_DUAL_REQUIREMENTS)
        single_req = self._resolve_polish_requirements(single_requirements, TTS_POLISH_DEFAULT_SINGLE_REQUIREMENTS)

        last_trace: Optional[str] = None
        try:
            if mode == "dual":
                lines = raw.splitlines()
                chunks = (
                    ["\n".join(lines)]
                    if len(raw) <= dual_seg_max
                    else self._split_lines_into_char_segments(lines, dual_seg_max)
                )
                if not chunks:
                    return {"success": False, "error": "双人稿分段为空"}
                in_tag = len(re.findall(r"(?im)^\s*Speaker\s*[12]\s*[:：]", raw))
                for attempt in range(2):
                    repair_block = ""
                    if attempt == 1:
                        repair_block = (
                            "\n【格式补救】上一版润色后，行首带 Speaker1:/Speaker2: 的对白行过少（或未保留双人轮次）。"
                            "本段每一句对白须单独成行，且行首必须是 Speaker1: 或 Speaker2:（半角冒号，冒号后恰好一个空格），"
                            "禁止整段无标签口述；禁止改用 Mini/Max/主持人A 等替代标签。\n"
                        )
                    combined: list[str] = []
                    prior_tail = ""
                    total = len(chunks)
                    for idx, chunk in enumerate(chunks):
                        n = idx + 1
                        ctx_block = ""
                        if prior_tail:
                            ctx_block = (
                                f"\n衔接参考（上一段润色结尾，请勿整段复述，仅保持语气与话题连贯）：\n{prior_tail}\n"
                            )
                        user_prompt = f"""你是播客对话撰稿人。当前为全文润色的第 {n}/{total} 段（仅处理本段）。

要求：
{dual_req}{repair_block}{ctx_block}
本段原文：
{chunk}

请直接输出本段润色结果（仅 Speaker1/Speaker2 行）。"""
                        seg_txt, last_trace = self._polish_tts_chat_completion(user_prompt, api_key)
                        if not seg_txt:
                            return {
                                "success": False,
                                "error": f"模型第 {n}/{total} 段返回空文本",
                                "trace_id": last_trace,
                            }
                        combined.append(seg_txt)
                        prior_tail = self._polish_tail_for_next_segment(seg_txt, ctx_max)
                    out = "\n".join(combined).strip()
                    n_tag = len(re.findall(r"(?im)^\s*Speaker\s*[12]\s*[:：]", out))
                    if n_tag >= 2 or in_tag < 2 or attempt == 1:
                        return {"success": True, "text": out, "trace_id": last_trace}
                raise RuntimeError("dual polish: unexpected loop exit")

            chunks = (
                [raw]
                if len(raw) <= single_seg_max
                else self._split_single_into_segments(raw, single_seg_max)
            )
            if not chunks:
                return {"success": False, "error": "单人稿分段为空"}
            combined_single: list[str] = []
            prior_tail_s = ""
            total_s = len(chunks)
            for idx, chunk in enumerate(chunks):
                n = idx + 1
                ctx_block = ""
                if prior_tail_s:
                    ctx_block = (
                        f"\n衔接参考（上一段润色结尾，请勿复述，仅保持语气连贯）：\n{prior_tail_s}\n"
                    )
                user_prompt = f"""你是播客撰稿人。当前为全文润色的第 {n}/{total_s} 段（仅处理本段）。

要求：
{single_req}{ctx_block}
本段原文：
{chunk}

请直接输出本段润色后的正文。"""
                seg_txt, last_trace = self._polish_tts_chat_completion(user_prompt, api_key)
                if not seg_txt:
                    return {
                        "success": False,
                        "error": f"模型第 {n}/{total_s} 段返回空文本",
                        "trace_id": last_trace,
                    }
                combined_single.append(seg_txt)
                prior_tail_s = self._polish_tail_for_next_segment(seg_txt, ctx_max)
            return {
                "success": True,
                "text": "\n\n".join(combined_single).strip(),
                "trace_id": last_trace,
            }
        except Exception as e:
            return {"success": False, "error": str(e), "trace_id": last_trace}


# 单例实例
minimax_client = MinimaxClient()
