"""
播客生成核心逻辑
协调并行任务、流式脚本生成与语音合成同步
"""

import os
import time
import logging
import threading
from typing import Dict, Any, Iterator
from queue import Queue
from config import (
    BGM_FILES,
    WELCOME_TEXT,
    WELCOME_VOICE_ID,
    DEFAULT_VOICES,
    PODCAST_CONFIG,
    OUTPUT_DIR
)
from minimax_client import minimax_client
from content_parser import content_parser
from voice_manager import voice_manager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class PodcastGenerator:
    """播客生成器"""

    def __init__(self):
        self.bgm01_path = BGM_FILES["bgm01"]
        self.bgm02_path = BGM_FILES["bgm02"]
        self.welcome_text = WELCOME_TEXT
        self.welcome_voice_id = WELCOME_VOICE_ID

    def _parse_speaker_line(self, line: str) -> tuple:
        """
        解析脚本行，提取 Speaker 和文本

        Args:
            line: 脚本行，格式如 "Speaker1: 文本内容"

        Returns:
            (speaker, text) 元组
        """
        if ":" in line:
            parts = line.split(":", 1)
            speaker = parts[0].strip()
            text = parts[1].strip()
            return speaker, text
        return None, line.strip()

    def _is_complete_sentence(self, buffer: str) -> bool:
        """
        判断是否为完整句子

        Args:
            buffer: 累积的文本缓冲

        Returns:
            是否完整句子
        """
        # 检查是否以换行符或句子结束标点符号结尾
        if buffer.endswith('\n') or buffer.endswith('。') or buffer.endswith('！') or buffer.endswith('？'):
            return True
        # 检查是否包含 Speaker 切换
        if '\nSpeaker' in buffer:
            return True
        return False

    def generate_podcast_stream(self,
                                content: str,
                                speaker1_voice_id: str,
                                speaker2_voice_id: str,
                                session_id: str,
                                api_key: str,
                                use_speaker1_for_welcome: bool = False,
                                intro_text: str | None = None,
                                intro_voice_id: str | None = None,
                                intro_voice_name: str = "max",
                                ending_text: str = "",
                                ending_voice_id: str | None = None,
                                ending_voice_name: str = "max",
                                bgm01_path: str | None = None,
                                bgm02_path: str | None = None,
                                ending_bgm01_path: str | None = None,
                                ending_bgm02_path: str | None = None,
                                script_mode: str = "ai",
                                manual_script: str = "",
                                script_target_chars: int = 200,
                                script_style: str = "轻松幽默，自然流畅",
                                script_language: str = "中文",
                                program_name: str = "MiniMax AI 播客节目",
                                speaker1_persona: str = "活泼亲切，引导话题",
                                speaker2_persona: str = "稳重专业，深度分析",
                                script_constraints: str = "对话内容中不能包含（笑）（停顿）（思考）等动作、心理活动或场景描述，只生成纯对话文本。",
                                cover_mode: str = "ai",
                                manual_cover_text: str = "",
                                manual_cover_filename: str | None = None) -> Iterator[Dict[str, Any]]:
        """
        流式生成播客

        Args:
            content: 解析后的内容
            speaker1_voice_id: Speaker1 音色 ID
            speaker2_voice_id: Speaker2 音色 ID
            session_id: 会话 ID
            api_key: 用户提供的 MiniMax API Key

        Yields:
            包含各种事件的字典
        """
        # 关键依赖检查：Python 3.13+ 默认缺少 audioop，pydub 无法工作，会导致音频合成流程无法进行
        try:
            import audioop  # noqa: F401
        except Exception as e:
            msg = (
                "当前 Python 环境缺少 audioop，无法进行音频处理（Python 3.13+ 已移除 audioop）。"
                "请使用 Python 3.12 或更低版本运行后端服务。"
                f" 详细错误: {str(e)}"
            )
            yield {"type": "error", "message": msg}
            return

        # 语音 ID 映射
        voice_mapping = {
            "Speaker1": speaker1_voice_id,
            "Speaker2": speaker2_voice_id
        }

        # 存储所有音频 chunk（保留用于兼容日志/统计）
        all_audio_chunks = []
        all_script_lines = []
        trace_ids = {}

        active_bgm01_path = self.bgm01_path if bgm01_path is None else bgm01_path
        active_bgm02_path = self.bgm02_path if bgm02_path is None else bgm02_path
        active_ending_bgm01_path = active_bgm01_path if ending_bgm01_path is None else ending_bgm01_path
        active_ending_bgm02_path = active_bgm02_path if ending_bgm02_path is None else ending_bgm02_path
        # 规则：
        # - intro_text is None: 使用默认欢迎语（兼容默认模式）
        # - intro_text == "": 明确不使用开头语（自定义模式下留空）
        active_intro_text = self.welcome_text if intro_text is None else str(intro_text).strip()
        _intro_key = (intro_voice_name or "max").strip().lower()
        _end_key = (ending_voice_name or "max").strip().lower()
        default_intro_voice_id = DEFAULT_VOICES.get(_intro_key, DEFAULT_VOICES["max"])["voice_id"]
        active_intro_voice_id = intro_voice_id or default_intro_voice_id
        default_ending_voice_id = DEFAULT_VOICES.get(_end_key, DEFAULT_VOICES["max"])["voice_id"]
        active_ending_voice_id = ending_voice_id or default_ending_voice_id

        # 渐进式音频文件路径和内存中的 AudioSegment 对象
        progressive_filename = f"progressive_{session_id}.mp3"
        progressive_path = os.path.join(OUTPUT_DIR, progressive_filename)
        progressive_audio_in_memory = None  # 在内存中累积,避免多次 MP3 编码/解码

        # Step 1: 生成并播放欢迎音频
        yield {
            "type": "progress",
            "step": "welcome_audio",
            "message": "正在播放欢迎音频..."
        }

        # 播放 BGM01（可选）
        if active_bgm01_path:
            yield {
                "type": "bgm",
                "bgm_type": "bgm01",
                "path": active_bgm01_path
            }

        # 合成欢迎语（可选）
        welcome_voice_id = speaker1_voice_id if use_speaker1_for_welcome else active_intro_voice_id
        if use_speaker1_for_welcome:
            yield {
                "type": "log",
                "message": "欢迎语使用 Speaker1 自定义音色"
            }
        welcome_audio_chunks = []
        if active_intro_text:
            for tts_event in minimax_client.synthesize_speech_stream(active_intro_text, welcome_voice_id, api_key=api_key):
                if tts_event["type"] == "audio_chunk":
                    welcome_audio_chunks.append(tts_event["audio"])
                    # 不发送 audio chunk 到前端（数据太大，前端不需要）
                elif tts_event["type"] == "tts_complete":
                    trace_ids["welcome_tts"] = tts_event.get("trace_id")
                    yield {
                        "type": "trace_id",
                        "api": "欢迎语合成",
                        "trace_id": tts_event.get("trace_id")
                    }
        else:
            logger.info("未配置开头语文本，已跳过开头语合成")

        # 播放 BGM02（淡出，可选）
        if active_bgm02_path:
            yield {
                "type": "bgm",
                "bgm_type": "bgm02_fadeout",
                "path": active_bgm02_path
            }

        # 合并 BGM1 + 欢迎语 + BGM2 作为开场音频
        logger.info("开始生成开场音频（BGM1 + 欢迎语 + BGM2）")
        logger.info(f"欢迎语音频 chunks 数量: {len(welcome_audio_chunks)}")
        try:
            from pydub import AudioSegment
            from pydub.effects import normalize

            if active_bgm01_path:
                logger.info(f"加载 BGM01: {active_bgm01_path}")
                bgm01 = AudioSegment.from_file(active_bgm01_path)
                logger.info(f"BGM01 时长: {len(bgm01)}ms")
            else:
                bgm01 = AudioSegment.empty()
                logger.info("未配置开场 BGM01，已跳过")

            if active_bgm02_path:
                logger.info(f"加载 BGM02: {active_bgm02_path}")
                bgm02 = AudioSegment.from_file(active_bgm02_path).fade_out(1000)
                logger.info(f"BGM02 时长: {len(bgm02)}ms")
            else:
                bgm02 = AudioSegment.empty()
                logger.info("未配置开场 BGM02，已跳过")

            # 转换欢迎语音频
            from audio_utils import hex_to_audio_segment
            welcome_audio = AudioSegment.empty()
            for i, chunk_hex in enumerate(welcome_audio_chunks):
                logger.info(f"处理欢迎语 chunk {i + 1}/{len(welcome_audio_chunks)}")
                chunk = hex_to_audio_segment(chunk_hex)
                if chunk:
                    welcome_audio += chunk
                    logger.info(f"欢迎语累计时长: {len(welcome_audio)}ms")

            logger.info(f"欢迎语总时长: {len(welcome_audio)}ms")

            # 对欢迎语音频进行 normalize 并调整到 -18 dB
            if len(welcome_audio) > 0:
                welcome_audio = normalize(welcome_audio)
                logger.info(f"欢迎语音频已标准化，音量: {welcome_audio.dBFS:.2f} dBFS")
                target_dBFS = -18.0
                change_in_dBFS = target_dBFS - welcome_audio.dBFS
                welcome_audio = welcome_audio.apply_gain(change_in_dBFS)
                logger.info(f"欢迎语音量已调整到 -18 dB，实际: {welcome_audio.dBFS:.2f} dBFS")

            # 对 BGM 也调整到 -18 dB（空音频直接跳过）
            bgm01_adjusted = bgm01.apply_gain(-18.0 - bgm01.dBFS) if len(bgm01) > 0 else bgm01
            bgm02_adjusted = bgm02.apply_gain(-18.0 - bgm02.dBFS) if len(bgm02) > 0 else bgm02

            # 合并：BGM1 + 欢迎语 + BGM2（所有部分都已经是 -18 dB）
            intro_audio = bgm01_adjusted + welcome_audio + bgm02_adjusted
            logger.info(f"开场音频总时长: {len(intro_audio)}ms，音量: {intro_audio.dBFS:.2f} dBFS")

            # 保存到内存
            progressive_audio_in_memory = intro_audio

            # 导出到文件（仅用于前端播放）
            logger.info(f"开始导出开场音频到渐进式文件: {progressive_path}")
            progressive_audio_in_memory.export(progressive_path, format="mp3")
            logger.info(f"开场音频已保存到: {progressive_path}")

            # 发送渐进式音频 URL
            yield {
                "type": "progressive_audio",
                "audio_url": f"/download/audio/{progressive_filename}?t={int(time.time())}",
                "duration_ms": len(intro_audio),
                "message": "开场音频已生成（BGM1 + 欢迎语 + BGM2）"
            }
            logger.info("开场音频 URL 已发送到前端")
        except Exception as e:
            logger.error(f"生成开场音频失败: {str(e)}")
            logger.exception("详细错误:")

        # Step 2: 并发开始脚本生成和封面生成
        yield {
            "type": "progress",
            "step": "script_generation",
            "message": "正在生成播客脚本和封面..."
        }

        script_buffer = ""
        current_speaker = None
        current_text = ""
        sentence_queue = Queue()  # 待合成的句子队列
        cover_result = {"success": False}  # 封面生成结果

        # 封面生成线程（并发）/ 手工封面
        def cover_generation_thread():
            nonlocal cover_result
            try:
                logger.info("🎨 [封面线程] 开始执行封面生成任务（并发）")
                # 提取内容摘要（取前500字符）
                content_summary = content[:500] if len(content) > 500 else content

                cover_result = minimax_client.generate_cover_image(content_summary, api_key=api_key)

                # 发送 Trace IDs
                if cover_result.get("text_trace_id"):
                    trace_ids["cover_prompt_generation"] = cover_result.get("text_trace_id")

                if cover_result.get("image_trace_id"):
                    trace_ids["cover_image_generation"] = cover_result.get("image_trace_id")

                logger.info(f"🎨 [封面线程] 封面生成完成，成功={cover_result['success']}")
            except Exception as e:
                logger.error(f"🎨 [封面线程] 封面生成线程异常: {str(e)}")
                logger.exception("详细错误:")

        # 脚本生成线程
        def script_generation_thread():
            nonlocal script_buffer
            target_chars_limit = int(
                script_target_chars or PODCAST_CONFIG.get("script_target_chars_default", 200)
            )
            generated_chars = 0

            def enqueue_sentence_with_limit(speaker_name: str, text_value: str) -> bool:
                """
                将句子按目标字数上限入队。
                返回 True 表示可继续生成；False 表示已达到上限应停止。
                """
                nonlocal generated_chars
                cleaned = (text_value or "").strip()
                if not cleaned:
                    return True

                remaining = target_chars_limit - generated_chars
                if remaining <= 0:
                    return False

                if len(cleaned) <= remaining:
                    sentence_queue.put(("sentence", speaker_name, cleaned))
                    generated_chars += len(cleaned)
                    return True

                # 更自然的收尾策略：
                # 1) 优先在句边界停下，不硬截断；
                # 2) 仅当剩余空间足够且能落在明显标点后，才做短截。
                min_tail_chars = 24
                if remaining < min_tail_chars:
                    return False

                prefix = cleaned[:remaining].rstrip()
                if not prefix:
                    return False

                # 优先在句末标点处截断（包含该标点）
                puncts = "。！？!?；;…"
                cut_idx = -1
                for i in range(len(prefix) - 1, -1, -1):
                    if prefix[i] in puncts:
                        cut_idx = i
                        break

                if cut_idx >= max(10, int(len(prefix) * 0.5)):
                    clipped = prefix[:cut_idx + 1].rstrip()
                else:
                    # 退一步：尝试在逗号停顿处收尾，避免截在词中间
                    soft_puncts = "，,、：:"
                    soft_idx = -1
                    for i in range(len(prefix) - 1, -1, -1):
                        if prefix[i] in soft_puncts:
                            soft_idx = i
                            break
                    clipped = prefix[:soft_idx + 1].rstrip() if soft_idx >= max(12, int(len(prefix) * 0.6)) else ""

                if clipped:
                    sentence_queue.put(("sentence", speaker_name, clipped))
                    generated_chars += len(clipped)
                return False

            try:
                complete_sent = False
                if script_mode == "manual":
                    logger.info("📝 [脚本线程] 手工脚本模式：跳过 AI 脚本生成")
                    lines = (manual_script or "").splitlines()
                    for raw_line in lines:
                        line = (raw_line or "").strip()
                        if not line:
                            continue
                        speaker, text = self._parse_speaker_line(line)
                        if not text:
                            continue
                        normalized_speaker = speaker if speaker in ("Speaker1", "Speaker2") else "Speaker1"
                        can_continue = enqueue_sentence_with_limit(normalized_speaker, text)
                        if not can_continue:
                            logger.info(
                                f"📝 [脚本线程] 已达到目标字数上限（{target_chars_limit}），停止继续入队手工脚本"
                            )
                            break
                    sentence_queue.put(("complete", None, None))
                    complete_sent = True
                    return

                logger.info("📝 [脚本线程] 开始执行脚本生成任务")
                stop_generation = False
                for script_event in minimax_client.generate_script_stream(
                    content,
                    target_chars_limit,
                    api_key=api_key,
                    script_style=script_style,
                    script_language=script_language,
                    program_name=program_name,
                    speaker1_persona=speaker1_persona,
                    speaker2_persona=speaker2_persona,
                    script_constraints=script_constraints
                ):
                    if script_event["type"] == "script_chunk":
                        chunk = script_event["content"]
                        script_buffer += chunk

                        # 检查是否形成完整句子
                        while self._is_complete_sentence(script_buffer):
                            # 提取完整句子
                            if '\n' in script_buffer:
                                line, script_buffer = script_buffer.split('\n', 1)
                            else:
                                line = script_buffer
                                script_buffer = ""

                            if line.strip():
                                speaker, text = self._parse_speaker_line(line)
                                if speaker and text:
                                    can_continue = enqueue_sentence_with_limit(speaker, text)
                                    logger.info(f"入队句子: {speaker}: {text[:30]}...")
                                    if not can_continue:
                                        logger.info(
                                            f"📝 [脚本线程] 已达到目标字数上限（{target_chars_limit}），提前结束脚本生成"
                                        )
                                        stop_generation = True
                                        script_buffer = ""
                                        break
                        if stop_generation:
                            break

                    elif script_event["type"] == "script_complete":
                        # 处理剩余buffer
                        if script_buffer.strip() and not stop_generation:
                            speaker, text = self._parse_speaker_line(script_buffer)
                            if speaker and text:
                                enqueue_sentence_with_limit(speaker, text)

                        trace_ids["script_generation"] = script_event.get("trace_id")
                        logger.info("脚本生成完成，发送完成信号")
                        sentence_queue.put(("complete", None, None))
                        complete_sent = True
                        stop_generation = True
                        break

                    elif script_event["type"] == "error":
                        logger.error(f"脚本生成错误: {script_event.get('message')}")
                        # 发送错误后仍需要发送完成信号
                        sentence_queue.put(("complete", None, None))
                        complete_sent = True
                        stop_generation = True
                        break

                if stop_generation and not complete_sent:
                    sentence_queue.put(("complete", None, None))

            except Exception as e:
                logger.error(f"脚本生成线程异常: {str(e)}")
                logger.exception("详细错误:")
                # 确保发送完成信号，避免主线程永久阻塞
                sentence_queue.put(("complete", None, None))

        # 启动脚本生成线程（始终需要）
        script_thread = threading.Thread(target=script_generation_thread)
        logger.info("🚀 准备启动脚本生成线程")
        script_thread.start()
        logger.info("📝 [主线程] 脚本生成线程已启动")

        # 封面：手工模式不启动线程，直接准备结果；AI 模式才并发生成
        cover_thread = None
        if cover_mode == "manual":
            if manual_cover_filename:
                cover_result = {
                    "success": True,
                    "image_url": f"/download/cover_file/{manual_cover_filename}",
                    "prompt": manual_cover_text or ""
                }
                logger.info("🎨 [主线程] 手工封面：已接收封面文件")
            else:
                cover_result = {
                    "success": True,
                    "image_url": "",
                    "prompt": manual_cover_text or "",
                    "message": "手工封面模式未提供封面文件，已跳过封面图片"
                }
                logger.info("🎨 [主线程] 手工封面：未提供封面文件，跳过封面图片")
        else:
            cover_thread = threading.Thread(target=cover_generation_thread)
            logger.info("🎨 [主线程] 启动封面生成线程（并发）")
            cover_thread.start()

        # 主线程：消费句子队列，进行语音合成
        tts_sentence_count = 0  # 总句子数
        update_counter = 0  # 累积计数器（用于判断是否需要发送更新）
        import math

        while True:
            item = sentence_queue.get()
            if item[0] == "complete":
                break

            _, speaker, text = item
            tts_sentence_count += 1

            # 发送脚本内容到前端
            full_line = f"{speaker}: {text}"
            all_script_lines.append(full_line)
            yield {
                "type": "script_chunk",
                "speaker": speaker,
                "text": text,
                "full_line": full_line
            }

            # 获取对应音色
            voice_id = voice_mapping.get(speaker, speaker1_voice_id)

            # 流式语音合成
            sentence_audio_chunks = []
            for tts_event in minimax_client.synthesize_speech_stream(text, voice_id, api_key=api_key):
                if tts_event["type"] == "audio_chunk":
                    audio_chunk = tts_event["audio"]
                    sentence_audio_chunks.append(audio_chunk)
                    all_audio_chunks.append(audio_chunk)

                    # 不发送 audio_chunk 到前端（数据太大，前端也不需要）
                    # 前端只需要 complete 事件中的最终音频 URL

                elif tts_event["type"] == "tts_complete":
                    trace_id = tts_event.get("trace_id")
                    trace_ids[f"tts_sentence_{tts_sentence_count}"] = trace_id
                    yield {
                        "type": "trace_id",
                        "api": f"{speaker} 第 {tts_sentence_count} 句合成",
                        "trace_id": trace_id
                    }

                    # 立即追加到渐进式音频文件
                    if sentence_audio_chunks:
                        try:
                            from pydub import AudioSegment
                            from pydub.effects import normalize
                            from audio_utils import hex_to_audio_segment

                            # 转换句子音频
                            sentence_audio = AudioSegment.empty()
                            for chunk_hex in sentence_audio_chunks:
                                chunk = hex_to_audio_segment(chunk_hex)
                                if chunk is not None:
                                    sentence_audio += chunk

                            # 对单句进行 normalize，然后调整到目标音量
                            if len(sentence_audio) > 0:
                                sentence_audio = normalize(sentence_audio)
                                logger.info(f"句子 {tts_sentence_count} 音频已标准化，音量: {sentence_audio.dBFS:.2f} dBFS")

                                # 将单句调整到目标音量 -18 dB
                                target_dBFS = -18.0
                                change_in_dBFS = target_dBFS - sentence_audio.dBFS
                                sentence_audio = sentence_audio.apply_gain(change_in_dBFS)
                                logger.info(f"句子 {tts_sentence_count} 音量已调整到 -18 dB，实际: {sentence_audio.dBFS:.2f} dBFS")

                            # 在内存中追加（避免多次 MP3 编码/解码）
                            if progressive_audio_in_memory is None:
                                progressive_audio_in_memory = AudioSegment.empty()
                            progressive_audio_in_memory = progressive_audio_in_memory + sentence_audio
                            logger.info(f"句子 {tts_sentence_count} 已追加到内存，当前总时长: {len(progressive_audio_in_memory)}ms，音量: {progressive_audio_in_memory.dBFS:.2f} dBFS")

                            # 渐进式累积策略：控制何时发送 progressive_audio 事件
                            update_counter += 1
                            should_send_update = False

                            if tts_sentence_count == 1:
                                # 第一句：立即发送（用户需要尽快听到内容）
                                should_send_update = True
                                logger.info(f"[后端渐进式] 第 {tts_sentence_count} 句，立即发送更新")
                            elif tts_sentence_count <= 3:
                                # 第 2-3 句：每 2 句发送一次
                                if update_counter >= 2:
                                    should_send_update = True
                                    update_counter = 0
                                    logger.info(f"[后端渐进式] 第 {tts_sentence_count} 句，累积 2 句，发送更新")
                                else:
                                    logger.info(f"[后端渐进式] 第 {tts_sentence_count} 句，累积 {update_counter} 句，暂不发送")
                            elif tts_sentence_count <= 8:
                                # 第 4-8 句：每 3 句发送一次
                                if update_counter >= 3:
                                    should_send_update = True
                                    update_counter = 0
                                    logger.info(f"[后端渐进式] 第 {tts_sentence_count} 句，累积 3 句，发送更新")
                                else:
                                    logger.info(f"[后端渐进式] 第 {tts_sentence_count} 句，累积 {update_counter} 句，暂不发送")
                            else:
                                # 第 9 句之后：每 4 句发送一次
                                if update_counter >= 4:
                                    should_send_update = True
                                    update_counter = 0
                                    logger.info(f"[后端渐进式] 第 {tts_sentence_count} 句，累积 4 句，发送更新")
                                else:
                                    logger.info(f"[后端渐进式] 第 {tts_sentence_count} 句，累积 {update_counter} 句，暂不发送")

                            # 只有在需要发送时才导出到文件并发送事件
                            if should_send_update:
                                # 导出当前内存中的音频到文件
                                progressive_audio_in_memory.export(progressive_path, format="mp3")
                                logger.info(f"第 {tts_sentence_count} 句：导出到渐进式文件，时长: {len(progressive_audio_in_memory)}ms")

                                yield {
                                    "type": "progressive_audio",
                                    "audio_url": f"/download/audio/{progressive_filename}?t={int(time.time())}",
                                    "duration_ms": len(progressive_audio_in_memory),
                                    "sentence_number": tts_sentence_count,
                                    "message": f"第 {tts_sentence_count} 句已添加到播客，播客时长: {math.ceil(len(progressive_audio_in_memory) / 1000)}秒"
                                }
                        except Exception as e:
                            logger.error(f"追加句子 {tts_sentence_count} 到渐进式音频失败: {str(e)}")

                elif tts_event["type"] == "error":
                    # TTS 错误，也记录 Trace ID
                    if tts_event.get("trace_id"):
                        trace_ids[f"tts_sentence_{tts_sentence_count}_error"] = tts_event.get("trace_id")
                        yield {
                            "type": "trace_id",
                            "api": f"{speaker} 第 {tts_sentence_count} 句合成（失败）",
                            "trace_id": tts_event.get("trace_id")
                        }
                    # 转发错误事件
                    yield tts_event
                    # 余额不足时立即终止，避免后续句子继续请求并重复报错
                    error_message = (tts_event.get("message") or "").lower()
                    if "insufficient balance" in error_message or "余额不足" in error_message:
                        yield {
                            "type": "error",
                            "message": "检测到 API 余额不足，已停止后续语音合成。请充值后重试。"
                        }
                        return

        # 等待脚本生成线程完成
        logger.info("📝 [主线程] 等待脚本生成线程完成...")
        script_thread.join()
        logger.info("📝 [主线程] 脚本生成线程已完成")

        yield {
            "type": "progress",
            "step": "script_complete",
            "message": "脚本生成完成"
        }

        yield {
            "type": "trace_id",
            "api": "脚本生成",
            "trace_id": trace_ids.get("script_generation")
        }

        # Step 3: 立即添加结束语 + 结尾 BGM 到渐进式音频（所有对话合成完毕后）
        logger.info("🎵 [主线程] 开始添加结束语与结尾 BGM（立即执行，不等封面）")
        yield {
            "type": "progress",
            "step": "adding_ending_bgm",
            "message": "正在添加结束语和结尾音乐..."
        }

        try:
            from pydub import AudioSegment
            from pydub.effects import normalize
            from audio_utils import hex_to_audio_segment

            if progressive_audio_in_memory is None:
                progressive_audio_in_memory = AudioSegment.empty()

            # 可选结束语
            ending_chunks = []
            if ending_text and ending_text.strip():
                for tts_event in minimax_client.synthesize_speech_stream(ending_text.strip(), active_ending_voice_id, api_key=api_key):
                    if tts_event["type"] == "audio_chunk":
                        ending_chunks.append(tts_event["audio"])
                    elif tts_event["type"] == "tts_complete":
                        trace_ids["ending_tts"] = tts_event.get("trace_id")
                        yield {
                            "type": "trace_id",
                            "api": "结束语合成",
                            "trace_id": tts_event.get("trace_id")
                        }

            if ending_chunks:
                ending_audio = AudioSegment.empty()
                for chunk_hex in ending_chunks:
                    chunk = hex_to_audio_segment(chunk_hex)
                    if chunk is not None:
                        ending_audio += chunk
                if len(ending_audio) > 0:
                    ending_audio = normalize(ending_audio)
                    ending_audio = ending_audio.apply_gain(-18.0 - ending_audio.dBFS)
                    progressive_audio_in_memory = progressive_audio_in_memory + ending_audio

            # 加载 BGM 并调整到 -18 dB
            bgm01 = AudioSegment.from_file(active_ending_bgm01_path) if active_ending_bgm01_path else AudioSegment.empty()
            bgm02 = AudioSegment.from_file(active_ending_bgm02_path).fade_out(1000) if active_ending_bgm02_path else AudioSegment.empty()

            bgm01_adjusted = bgm01.apply_gain(-18.0 - bgm01.dBFS) if len(bgm01) > 0 else bgm01
            bgm02_adjusted = bgm02.apply_gain(-18.0 - bgm02.dBFS) if len(bgm02) > 0 else bgm02
            logger.info(
                f"🎵 结尾 BGM 音量: BGM1={bgm01_adjusted.dBFS if len(bgm01_adjusted) > 0 else 'empty'}, "
                f"BGM2={bgm02_adjusted.dBFS if len(bgm02_adjusted) > 0 else 'empty'}"
            )

            # 在内存中追加结尾 BGM
            progressive_audio_in_memory = progressive_audio_in_memory + bgm01_adjusted + bgm02_adjusted
            logger.info(f"🎵 [主线程] 结尾 BGM 已追加到内存，最终播客时长: {len(progressive_audio_in_memory)}ms，音量: {progressive_audio_in_memory.dBFS:.2f} dBFS")

            # 导出最终版本到文件
            progressive_audio_in_memory.export(progressive_path, format="mp3")
            logger.info(f"🎵 最终播客已导出到文件: {progressive_path}")

            # 发送最终音频更新
            yield {
                "type": "progressive_audio",
                "audio_url": f"/download/audio/{progressive_filename}?t={int(time.time())}",
                "duration_ms": len(progressive_audio_in_memory),
                "message": "结尾音乐已添加"
            }
        except Exception as e:
            logger.error(f"🎵 [主线程] 添加结束语/结尾 BGM 失败: {str(e)}")

        # Step 4: 等待封面生成完成（AI 模式下封面在后台并发生成）
        if cover_thread is not None:
            logger.info("🎨 [主线程] 检查封面线程状态...")
            if cover_thread.is_alive():
                yield {
                    "type": "progress",
                    "step": "waiting_cover",
                    "message": "正在等待封面生成完成..."
                }
                logger.info("🎨 [主线程] 封面线程仍在运行，等待完成...")
            else:
                logger.info("🎨 [主线程] 封面线程已完成")

            cover_thread.join()
            logger.info("🎨 [主线程] 封面线程已 join 完成")

        # 发送封面相关的 Trace ID
        if cover_result.get("text_trace_id"):
            yield {
                "type": "trace_id",
                "api": "封面 Prompt 生成",
                "trace_id": cover_result.get("text_trace_id")
            }

        if cover_result.get("image_trace_id"):
            yield {
                "type": "trace_id",
                "api": "封面图生成",
                "trace_id": cover_result.get("image_trace_id")
            }

        # 发送封面生成结果
        if cover_result.get("success") and cover_result.get("image_url"):
            yield {
                "type": "cover_image",
                "image_url": cover_result["image_url"],
                "prompt": cover_result.get("prompt", "")
            }
            yield {
                "type": "progress",
                "step": "cover_complete",
                "message": "封面生成完成"
            }
            logger.info("封面已发送到前端")
        elif cover_mode == "manual":
            yield {
                "type": "progress",
                "step": "cover_skipped",
                "message": "未提供封面图片，已跳过封面展示"
            }
        else:
            yield {
                "type": "progress",
                "step": "cover_failed",
                "message": f"封面生成失败: {cover_result.get('message', '未知错误')}"
            }

        # Step 5: 合并完整播客音频
        yield {
            "type": "progress",
            "step": "audio_merging",
            "message": "正在合并完整播客音频..."
        }

        output_filename = f"podcast_{session_id}_{int(time.time())}.mp3"
        output_path = os.path.join(OUTPUT_DIR, output_filename)

        try:
            if progressive_audio_in_memory is None:
                from pydub import AudioSegment
                progressive_audio_in_memory = AudioSegment.empty()
            progressive_audio_in_memory.export(output_path, format="mp3")

            # 保存脚本
            script_filename = f"script_{session_id}_{int(time.time())}.txt"
            script_path = os.path.join(OUTPUT_DIR, script_filename)
            with open(script_path, 'w', encoding='utf-8') as f:
                f.write('\n'.join(all_script_lines))

            yield {
                "type": "complete",
                "audio_path": output_path,
                "audio_url": f"/download/audio/{output_filename}",
                "script_path": script_path,
                "script_url": f"/download/script/{script_filename}",
                "cover_url": cover_result.get("image_url", ""),
                "trace_ids": trace_ids,
                "message": "播客生成完成！"
            }

        except Exception as e:
            logger.error(f"音频合并失败: {str(e)}")
            yield {
                "type": "error",
                "message": f"音频合并失败: {str(e)}"
            }


# 单例实例
podcast_generator = PodcastGenerator()
