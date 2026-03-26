"""
AI 播客生成工具 - Flask 后端服务
支持 SSE 流式响应、并行任务处理
"""

import os
import sys
import uuid
import json
import logging
import threading
import time
import re
import math
import zipfile
import subprocess
import shutil
from flask import Flask, request, jsonify, Response, send_file, send_from_directory, stream_with_context

import auth_service
from flask_cors import CORS
from werkzeug.utils import secure_filename
from urllib.parse import urlparse

# 添加backend目录到路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import UPLOAD_DIR, OUTPUT_DIR, BGM_FILES, VOICE_STORE_FILE, PODCAST_CONFIG
from content_parser import content_parser
from voice_manager import voice_manager
from podcast_generator import podcast_generator
from minimax_client import minimax_client
from audio_utils import hex_to_audio_segment

TTS_BODY_MAX_CHARS = 10000
TTS_INTRO_OUTRO_MAX = 800
MAX_VOICE_CLONE_UPLOAD_BYTES = 20 * 1024 * 1024


def _parse_tts_dialogue_lines(text: str):
    """解析 Speaker1:/Speaker2: 对白，返回 [('1', chunk), ('2', chunk), ...]"""
    raw = (text or "").strip()
    if not raw:
        return []
    pat = re.compile(r"^\s*Speaker\s*([12])\s*[:：]\s*(.*)$", re.I)
    segments = []
    current_sp = "1"
    current_parts = []

    def flush():
        if not current_parts:
            return
        t = "\n".join(current_parts).strip()
        current_parts.clear()
        if t:
            segments.append((current_sp, t))

    for line in raw.split("\n"):
        m = pat.match(line)
        if m:
            flush()
            current_sp = m.group(1)
            rest = (m.group(2) or "").strip()
            current_parts = [rest] if rest else []
        else:
            current_parts.append(line)
    flush()
    if not segments and raw:
        return [("1", raw)]
    return segments


def _tts_synthesize_to_segment(text: str, voice_id: str, api_key: str):
    """单次 TTS，返回 pydub AudioSegment。"""
    chunks = []
    trace_id = None
    for event in minimax_client.synthesize_speech_stream(text=text, voice_id=voice_id, api_key=api_key):
        if event.get("type") == "audio_chunk":
            chunks.append(event.get("audio", ""))
        elif event.get("type") == "tts_complete":
            trace_id = event.get("trace_id")
        elif event.get("type") == "error":
            raise RuntimeError(event.get("message", "合成失败"))
    if not chunks:
        raise RuntimeError("合成失败：未返回音频数据")
    seg = hex_to_audio_segment("".join(chunks))
    if seg is None:
        raise RuntimeError("音频解码失败")
    return seg, trace_id


def _polish_tts_line(text: str, api_key: str, language: str):
    pr = minimax_client.polish_text_for_tts(text, api_key=api_key, language=language)
    if not pr.get("success"):
        return (text, None, pr.get("error"))
    out = (pr.get("text") or text).strip() or text
    return (out, pr.get("trace_id"), None)
from rag_utils import retrieve_top_chunks, build_retrieval_query, build_full_coverage_context, hybrid_rerank_chunks
from rag_store import RagStore
from cross_doc_reasoner import summarize_evidence, build_reasoned_context
from rag_utils import split_text_into_chunks
from parse_utils import (
    parse_script_target_chars as parse_script_target_chars_impl,
    parse_long_script_target_chars as parse_long_script_target_chars_impl,
    parse_url_inputs as parse_url_inputs_impl,
)
from reasoner_utils import (
    tail_dialogue_for_continuation,
    build_structured_memory,
    build_global_constitution,
    build_article_constitution,
    post_edit_script_for_coherence,
    parse_outline_segments,
    strip_premature_closing,
    extract_tail_hook_phrases,
    segment_head_suggests_restart,
)
from strategy_utils import (
    choose_auto_rag_top_k as choose_auto_rag_top_k_impl,
    apply_long_reference_strategy as apply_long_reference_strategy_impl,
)
from retry_utils import retry_target_schedule

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Flask 应用
app = Flask(__name__)
# 统一允许跨域（开发/静态站直连 :5001），并显式放行 Authorization 以避免预检失败导致 Failed to fetch
CORS(
    app,
    resources={r"/api/*": {"origins": "*"}, r"/download/*": {"origins": "*"}, r"/health": {"origins": "*"}},
    allow_headers=["Content-Type", "Authorization"],
    expose_headers=["Trace-Id", "Trace-ID"],
)
voice_store_lock = threading.Lock()
bgm_store_lock = threading.Lock()
note_store_lock = threading.Lock()

# 允许的文件扩展名
ALLOWED_AUDIO_EXTENSIONS = {'wav', 'mp3', 'flac', 'm4a', 'ogg'}
ALLOWED_PDF_EXTENSIONS = {'pdf', 'txt', 'md', 'markdown', 'doc', 'docx', 'epub'}
ALLOWED_IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}
ALLOWED_NOTE_EXTENSIONS = {'txt', 'md', 'markdown', 'pdf', 'doc', 'docx', 'epub'}
CUSTOM_BGM_DIR = os.path.join(OUTPUT_DIR, "custom_bgms")
CUSTOM_BGM_STORE_FILE = os.path.join(OUTPUT_DIR, "saved_bgms.json")
NOTE_DIR = os.path.join(OUTPUT_DIR, "notes")
NOTE_STORE_FILE = os.path.join(OUTPUT_DIR, "saved_notes.json")
NOTEBOOK_STORE_FILE = os.path.join(OUTPUT_DIR, "saved_notebooks.json")
# 单次接口返回的笔记文本上限，避免超大 PDF 拖垮浏览器
NOTE_PREVIEW_TEXT_MAX = 400_000
RAG_TRIGGER_CHARS = 12000
RAG_TOP_K = 12
RAG_VECTOR_DB = os.path.join(OUTPUT_DIR, "rag_vectors.sqlite3")
rag_store = RagStore(RAG_VECTOR_DB)


def choose_auto_rag_top_k(total_chars: int) -> int:
    return choose_auto_rag_top_k_impl(total_chars)


def apply_long_reference_strategy(
    merged_content: str,
    user_api_key: str,
    topic_text: str,
    script_style: str,
    script_language: str,
    program_name: str,
    speaker1_persona: str,
    speaker2_persona: str,
    script_constraints: str,
):
    return apply_long_reference_strategy_impl(
        merged_content=merged_content,
        user_api_key=user_api_key,
        topic_text=topic_text,
        script_style=script_style,
        script_language=script_language,
        program_name=program_name,
        speaker1_persona=speaker1_persona,
        speaker2_persona=speaker2_persona,
        script_constraints=script_constraints,
        rag_store=rag_store,
        minimax_client=minimax_client,
        split_text_into_chunks=split_text_into_chunks,
        build_retrieval_query=build_retrieval_query,
        retrieve_top_chunks=retrieve_top_chunks,
        hybrid_rerank_chunks=hybrid_rerank_chunks,
        build_full_coverage_context=build_full_coverage_context,
        summarize_evidence=summarize_evidence,
        build_reasoned_context=build_reasoned_context,
    )

os.makedirs(CUSTOM_BGM_DIR, exist_ok=True)
os.makedirs(NOTE_DIR, exist_ok=True)
if not os.path.exists(CUSTOM_BGM_STORE_FILE):
    with open(CUSTOM_BGM_STORE_FILE, "w", encoding="utf-8") as f:
        json.dump([], f, ensure_ascii=False)
if not os.path.exists(NOTE_STORE_FILE):
    with open(NOTE_STORE_FILE, "w", encoding="utf-8") as f:
        json.dump([], f, ensure_ascii=False)
if not os.path.exists(NOTEBOOK_STORE_FILE):
    with open(NOTEBOOK_STORE_FILE, "w", encoding="utf-8") as f:
        json.dump(["默认笔记本"], f, ensure_ascii=False)


def allowed_file(filename, allowed_extensions):
    """检查文件扩展名是否允许"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in allowed_extensions


def parse_script_target_chars(form_value):
    """
    解析表单中的目标正文字数，仅保留最小值限制，不限制上限。
    """
    return parse_script_target_chars_impl(form_value, PODCAST_CONFIG)


def parse_long_script_target_chars(form_value):
    """长文案模式下的总目标字数解析（仅保留最小值限制）。"""
    return parse_long_script_target_chars_impl(form_value, PODCAST_CONFIG)


def parse_url_inputs(req):
    """兼容单网址(url)与多网址(url_list JSON)。"""
    return parse_url_inputs_impl(req)


def collect_uploaded_reference_files(req, session_id, prefix="upload"):
    """
    收集请求中的参考文件，支持多文件字段 pdf_files，也兼容旧字段 pdf_file。
    返回: [{"path","ext","name"}]
    """
    results = []
    seen = set()
    file_items = []
    try:
        file_items.extend(req.files.getlist("pdf_files"))
    except Exception:
        pass
    legacy = req.files.get("pdf_file")
    if legacy:
        file_items.append(legacy)
    for file_obj in file_items:
        if not file_obj or not getattr(file_obj, "filename", ""):
            continue
        if not allowed_file(file_obj.filename, ALLOWED_PDF_EXTENSIONS):
            continue
        filename = secure_filename(file_obj.filename)
        key = (filename, getattr(file_obj, "content_length", None))
        if key in seen:
            continue
        seen.add(key)
        stored_name = f"{prefix}_{session_id}_{len(results)}_{filename}"
        save_path = os.path.join(UPLOAD_DIR, stored_name)
        file_obj.save(save_path)
        ext = filename.rsplit(".", 1)[1].lower() if "." in filename else ""
        results.append({
            "path": save_path,
            "ext": ext,
            "name": filename,
        })
    return results


def load_saved_voices():
    """读取服务端持久化音色ID列表"""
    try:
        if not os.path.exists(VOICE_STORE_FILE):
            return []
        with open(VOICE_STORE_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, list):
            return []
        normalized = []
        for item in data:
            if isinstance(item, str) and item.strip():
                voice_id = item.strip()
                normalized.append({
                    "voiceId": voice_id,
                    "displayName": voice_id,
                    "lastUsedAt": None,
                    "sourceSpeaker": None
                })
            elif isinstance(item, dict) and str(item.get("voiceId", "")).strip():
                voice_id = str(item.get("voiceId")).strip()
                display_name = str(item.get("displayName", "")).strip() or voice_id
                normalized.append({
                    "voiceId": voice_id,
                    "displayName": display_name,
                    "lastUsedAt": item.get("lastUsedAt"),
                    "sourceSpeaker": item.get("sourceSpeaker")
                })
        return normalized
    except Exception as e:
        logger.error(f"读取已保存音色失败: {str(e)}")
        return []


def save_saved_voices(voices):
    """写入服务端持久化音色ID列表"""
    try:
        with open(VOICE_STORE_FILE, 'w', encoding='utf-8') as f:
            json.dump(voices, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"写入已保存音色失败: {str(e)}")


def upsert_saved_voice(voice_id, source_speaker=None, display_name=None):
    """服务端 upsert 一个音色ID记录"""
    normalized_voice_id = str(voice_id or '').strip()
    if not normalized_voice_id:
        return
    with voice_store_lock:
        voices = load_saved_voices()
        existing = next((v for v in voices if v.get("voiceId") == normalized_voice_id), None)
        voices = [v for v in voices if v.get("voiceId") != normalized_voice_id]
        dn = (display_name or "").strip() if display_name is not None else ""
        if not dn:
            dn = (existing or {}).get("displayName") or normalized_voice_id
        voices.insert(0, {
            "voiceId": normalized_voice_id,
            "displayName": dn,
            "lastUsedAt": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            "sourceSpeaker": source_speaker
        })
        # 去重后最多保留 200 条
        dedup = []
        seen = set()
        for v in voices:
            vid = v.get("voiceId")
            if not vid or vid in seen:
                continue
            seen.add(vid)
            dedup.append(v)
            if len(dedup) >= 200:
                break
        save_saved_voices(dedup)


def load_saved_bgms():
    """读取服务端持久化 BGM 列表"""
    try:
        if not os.path.exists(CUSTOM_BGM_STORE_FILE):
            return []
        with open(CUSTOM_BGM_STORE_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, list):
            return []
        normalized = []
        for item in data:
            if not isinstance(item, dict):
                continue
            bgm_id = str(item.get("bgmId", "")).strip()
            file_name = str(item.get("fileName", "")).strip()
            if not bgm_id or not file_name:
                continue
            normalized.append({
                "bgmId": bgm_id,
                "label": str(item.get("label", "")).strip() or file_name,
                "fileName": file_name,
                "relativePath": item.get("relativePath") or f"/download/custom_bgm/{file_name}",
                "lastUsedAt": item.get("lastUsedAt")
            })
        return normalized
    except Exception as e:
        logger.error(f"读取已保存 BGM 失败: {str(e)}")
        return []


def save_saved_bgms(bgms):
    """写入服务端持久化 BGM 列表"""
    try:
        with open(CUSTOM_BGM_STORE_FILE, 'w', encoding='utf-8') as f:
            json.dump(bgms, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"写入已保存 BGM 失败: {str(e)}")


def upsert_saved_bgm(bgm_id, label, file_name):
    normalized_bgm_id = str(bgm_id or '').strip()
    normalized_file_name = str(file_name or '').strip()
    if not normalized_bgm_id or not normalized_file_name:
        return
    now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    with bgm_store_lock:
        bgms = load_saved_bgms()
        bgms = [b for b in bgms if b.get("bgmId") != normalized_bgm_id]
        bgms.insert(0, {
            "bgmId": normalized_bgm_id,
            "label": str(label or '').strip() or normalized_file_name,
            "fileName": normalized_file_name,
            "relativePath": f"/download/custom_bgm/{normalized_file_name}",
            "lastUsedAt": now
        })
        save_saved_bgms(bgms[:200])


def resolve_bgm_path(selected_mode, selected_bgm_id, uploaded_file_obj, session_id, slot_name, default_key):
    if selected_mode == 'none':
        return "", None

    if selected_mode == 'saved':
        with bgm_store_lock:
            bgms = load_saved_bgms()
        target = next((b for b in bgms if b.get("bgmId") == selected_bgm_id), None)
        if not target:
            return None, f"{slot_name} 选择了已保存 BGM，但未找到对应条目"
        file_path = os.path.join(CUSTOM_BGM_DIR, target.get("fileName"))
        if not os.path.exists(file_path):
            return None, f"{slot_name} 对应文件不存在，请重新上传"
        return file_path, None

    if selected_mode == 'upload':
        if not uploaded_file_obj or not uploaded_file_obj.filename:
            return None, f"{slot_name} 选择上传模式但未提供文件"
        if not allowed_file(uploaded_file_obj.filename, ALLOWED_AUDIO_EXTENSIONS):
            return None, f"{slot_name} 文件格式不支持"
        source_name = secure_filename(uploaded_file_obj.filename)
        file_name = f"{slot_name}_{session_id}_{int(time.time())}_{source_name}"
        file_path = os.path.join(CUSTOM_BGM_DIR, file_name)
        uploaded_file_obj.save(file_path)
        bgm_id = f"bgm_{int(time.time())}_{uuid.uuid4().hex[:8]}"
        upsert_saved_bgm(bgm_id=bgm_id, label=source_name, file_name=file_name)
        return file_path, None

    return BGM_FILES[default_key], None


def load_saved_notes():
    try:
        if not os.path.exists(NOTE_STORE_FILE):
            return []
        with open(NOTE_STORE_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, list):
            return []
        normalized = []
        for item in data:
            if not isinstance(item, dict):
                continue
            note_id = str(item.get("noteId", "")).strip()
            file_name = str(item.get("fileName", "")).strip()
            title = str(item.get("title", "")).strip() or file_name
            if not note_id or not file_name:
                continue
            normalized.append({
                "noteId": note_id,
                "title": title,
                "tag": str(item.get("tag", "")).strip(),
                "notebook": str(item.get("notebook", "默认笔记本")).strip() or "默认笔记本",
                "fileName": file_name,
                "ext": str(item.get("ext", "")).strip().lower(),
                "size": item.get("size"),
                "createdAt": item.get("createdAt"),
                "relativePath": item.get("relativePath") or f"/download/note/{file_name}"
            })
        return normalized
    except Exception as e:
        logger.error(f"读取笔记列表失败: {str(e)}")
        return []


def save_saved_notes(notes):
    try:
        with open(NOTE_STORE_FILE, 'w', encoding='utf-8') as f:
            json.dump(notes, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"写入笔记列表失败: {str(e)}")


def parse_note_file_content(file_path, ext):
    def parse_doc_binary_with_fallback(path):
        """
        解析 .doc 正文（多工具回退）：
        antiword -> catdoc -> soffice --convert-to txt -> 失败返回空串
        """
        candidates = [
            (["antiword", path], "antiword"),
            (["catdoc", path], "catdoc"),
        ]
        for cmd, _name in candidates:
            try:
                proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
                if proc.returncode == 0:
                    txt = (proc.stdout or "").strip()
                    if txt:
                        return txt
            except Exception:
                continue

        # libreoffice 转 txt（系统有 soffice 时可用）
        try:
            out_dir = os.path.dirname(path)
            proc = subprocess.run(
                ["soffice", "--headless", "--convert-to", "txt:Text", "--outdir", out_dir, path],
                capture_output=True,
                text=True,
                timeout=60
            )
            if proc.returncode == 0:
                txt_path = os.path.splitext(path)[0] + ".txt"
                if os.path.exists(txt_path):
                    with open(txt_path, "r", encoding="utf-8", errors="ignore") as f:
                        txt = f.read().strip()
                    try:
                        os.remove(txt_path)
                    except OSError:
                        pass
                    if txt:
                        return txt
        except Exception:
            pass
        return ""

    normalized_ext = str(ext or "").lower()
    if normalized_ext == "pdf":
        result = content_parser.parse_pdf(file_path)
        return result.get("content", "") if result.get("success") else ""
    if normalized_ext == "epub":
        result = content_parser.parse_epub(file_path)
        return result.get("content", "") if result.get("success") else ""
    if normalized_ext == "docx":
        try:
            with zipfile.ZipFile(file_path, "r") as zf:
                xml_data = zf.read("word/document.xml").decode("utf-8", errors="ignore")
            text = re.sub(r"</w:p>", "\n", xml_data)
            text = re.sub(r"<[^>]+>", "", text)
            text = re.sub(r"\n{2,}", "\n", text).strip()
            return text
        except Exception:
            return ""
    if normalized_ext == "doc":
        return parse_doc_binary_with_fallback(file_path)
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()
    except Exception:
        return ""


def build_doc_parse_tool_hint() -> str:
    """
    返回 .doc 解析工具可用性说明，便于前端给出明确安装建议。
    """
    tools = {
        "antiword": shutil.which("antiword"),
        "catdoc": shutil.which("catdoc"),
        "soffice": shutil.which("soffice"),
    }
    available = [name for name, path in tools.items() if path]
    if available:
        return f".doc 解析失败：系统已检测到工具 {', '.join(available)}，请检查文档是否损坏或加密。"
    return (
        ".doc 解析失败：未检测到 antiword / catdoc / soffice。"
        "可安装其中任一工具后重试，或先将 .doc 转为 .docx / PDF 再上传。"
    )


def load_notebooks():
    try:
        if not os.path.exists(NOTEBOOK_STORE_FILE):
            return ["默认笔记本"]
        with open(NOTEBOOK_STORE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, list):
            return ["默认笔记本"]
        normalized = []
        seen = set()
        for name in data:
            n = str(name or "").strip()
            if not n or n in seen:
                continue
            seen.add(n)
            normalized.append(n)
        if "默认笔记本" not in seen:
            normalized.insert(0, "默认笔记本")
        return normalized[:200]
    except Exception:
        return ["默认笔记本"]


def save_notebooks(notebooks):
    try:
        with open(NOTEBOOK_STORE_FILE, "w", encoding="utf-8") as f:
            json.dump(notebooks[:200], f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"写入笔记本失败: {str(e)}")


@app.route('/health', methods=['GET'])
def health_check():
    """健康检查接口"""
    return jsonify({"status": "ok", "message": "AI 播客生成服务运行中"})


@app.route('/api/auth/config', methods=['GET'])
def api_auth_config():
    return jsonify({"success": True, **auth_service.auth_config_dict()})


@app.route('/api/auth/register', methods=['POST'])
def api_auth_register():
    if not auth_service.is_auth_enabled():
        return jsonify({"success": False, "error": "认证未启用"}), 400
    body = request.get_json(silent=True) or {}
    phone = str(body.get("phone", "")).strip()
    password = str(body.get("password", ""))
    invite = str(body.get("invite_code", "")).strip()
    token, err = auth_service.register_user(phone, password, invite)
    if err:
        return jsonify({"success": False, "error": err}), 400
    return jsonify(
        {
            "success": True,
            "token": token,
            "user": auth_service.user_info_for_phone(phone),
        }
    )


@app.route('/api/auth/login', methods=['POST'])
def api_auth_login():
    if not auth_service.is_auth_enabled():
        return jsonify({"success": False, "error": "认证未启用"}), 400
    body = request.get_json(silent=True) or {}
    phone = str(body.get("phone", "")).strip()
    password = str(body.get("password", ""))
    token, err = auth_service.login_user(phone, password)
    if err:
        return jsonify({"success": False, "error": err}), 400
    return jsonify(
        {
            "success": True,
            "token": token,
            "user": auth_service.user_info_for_phone(phone),
        }
    )


@app.route('/api/auth/logout', methods=['POST'])
def api_auth_logout():
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        auth_service.delete_session(auth[7:].strip())
    return jsonify({"success": True})


@app.route('/api/auth/me', methods=['GET'])
def api_auth_me():
    if not auth_service.is_auth_enabled():
        return jsonify({"success": True, "user": {"phone": "local", "plan": "free"}})
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return jsonify({"success": False, "error": "未登录"}), 401
    token = auth[7:].strip()
    sess = auth_service.get_session(token)
    if not sess:
        return jsonify({"success": False, "error": "未登录"}), 401
    return jsonify({"success": True, "user": auth_service.user_info_for_phone(sess["phone"])})


@app.route('/api/auth/status', methods=['GET'])
def api_auth_status():
    if not auth_service.is_auth_enabled():
        return jsonify(
            {
                "success": True,
                "feature_unlocked": True,
                "feature_expires_in_sec": None,
            }
        )
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return jsonify({"success": False, "error": "未登录"}), 401
    token = auth[7:].strip()
    sess = auth_service.get_session(token)
    if not sess:
        return jsonify({"success": False, "error": "未登录"}), 401
    now = time.time()
    fu = sess.get("feature_unlock_expires")
    unlocked = bool(sess.get("feature_unlocked")) and (not fu or now <= float(fu))
    left = None
    if unlocked and fu:
        left = max(0, int(float(fu) - now))
    return jsonify(
        {
            "success": True,
            "feature_unlocked": unlocked,
            "feature_expires_in_sec": left,
        }
    )


@app.route('/api/auth/unlock_feature', methods=['POST'])
def api_auth_unlock_feature():
    if not auth_service.is_auth_enabled():
        return jsonify({"success": True})
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return jsonify({"success": False, "error": "未登录"}), 401
    token = auth[7:].strip()
    body = request.get_json(silent=True) or {}
    phone = str(body.get("phone", "")).strip()
    password = str(body.get("password", ""))
    ok, err = auth_service.unlock_feature(token, phone, password)
    if not ok:
        return jsonify({"success": False, "error": err or "验证失败"}), 400
    return jsonify({"success": True})


@app.route('/api/subscription/plans', methods=['GET'])
def api_subscription_plans():
    return jsonify(
        {
            "success": True,
            "plans": [
                {
                    "id": "free",
                    "name": "Free",
                    "monthly_price_cents": 0,
                    "yearly_price_cents": 0,
                    "description": "基础体验",
                },
                {
                    "id": "pro",
                    "name": "Pro",
                    "monthly_price_cents": None,
                    "yearly_price_cents": None,
                    "description": "专业创作（价格待定）",
                },
                {
                    "id": "max",
                    "name": "Max",
                    "monthly_price_cents": None,
                    "yearly_price_cents": None,
                    "description": "团队与高级能力（价格待定）",
                },
            ],
            "note": "pricing_pending",
        }
    )


@app.route('/api/subscription/me', methods=['GET'])
def api_subscription_me():
    if not auth_service.is_auth_enabled():
        return jsonify({"success": True, "plan": "free", "billing_cycle": None})
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return jsonify({"success": False, "error": "未登录"}), 401
    token = auth[7:].strip()
    sess = auth_service.get_session(token)
    if not sess:
        return jsonify({"success": False, "error": "未登录"}), 401
    info = auth_service.user_info_for_phone(sess["phone"])
    return jsonify({"success": True, **info})


@app.route('/api/subscription/select', methods=['POST'])
def api_subscription_select():
    """占位：记录用户选择的套餐与周期，支付与计费逻辑待定。"""
    if not auth_service.is_auth_enabled():
        return jsonify({"success": True, "message": "本地模式未启用订阅鉴权"})
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return jsonify({"success": False, "error": "未登录"}), 401
    token = auth[7:].strip()
    sess = auth_service.get_session(token)
    if not sess:
        return jsonify({"success": False, "error": "未登录"}), 401
    body = request.get_json(silent=True) or {}
    tier = str(body.get("tier", "free")).strip().lower()
    cycle = body.get("billing_cycle")
    cycle = str(cycle).strip().lower() if cycle else None
    ok, err = auth_service.set_user_subscription(sess["phone"], tier, cycle)
    if not ok:
        return jsonify({"success": False, "error": err}), 400
    return jsonify(
        {
            "success": True,
            "message": "已记录选择，支付与计费逻辑待定",
            "user": auth_service.user_info_for_phone(sess["phone"]),
        }
    )


@app.route('/api/default-voices', methods=['GET'])
def get_default_voices():
    """获取默认音色列表"""
    from config import DEFAULT_VOICES
    return jsonify({
        "success": True,
        "voices": DEFAULT_VOICES
    })


@app.route('/api/saved_voices', methods=['GET'])
def get_saved_voices():
    """获取服务端持久化的音色ID列表"""
    with voice_store_lock:
        voices = load_saved_voices()
    return jsonify({"success": True, "voices": voices})


@app.route('/api/saved_voices', methods=['POST'])
def set_saved_voices():
    """覆盖写入服务端音色ID列表（用于前端同步）"""
    try:
        payload = request.get_json(silent=True) or {}
        voices = payload.get("voices", [])
        if not isinstance(voices, list):
            return jsonify({"success": False, "error": "voices 必须是数组"}), 400

        normalized = []
        for item in voices:
            if not isinstance(item, dict):
                continue
            voice_id = str(item.get("voiceId", "")).strip()
            if not voice_id:
                continue
            normalized.append({
                "voiceId": voice_id,
                "displayName": str(item.get("displayName", "")).strip() or voice_id,
                "lastUsedAt": item.get("lastUsedAt"),
                "sourceSpeaker": item.get("sourceSpeaker")
            })

        with voice_store_lock:
            save_saved_voices(normalized[:200])
        return jsonify({"success": True, "count": len(normalized[:200])})
    except Exception as e:
        logger.error(f"写入服务端音色列表失败: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/saved_bgms', methods=['GET'])
def get_saved_bgms():
    """获取服务端持久化的 BGM 列表"""
    with bgm_store_lock:
        bgms = load_saved_bgms()
    return jsonify({"success": True, "bgms": bgms})


@app.route('/api/notes', methods=['GET'])
def get_notes():
    with note_store_lock:
        notes = load_saved_notes()
    tag_filter = str(request.args.get("tag", "")).strip()
    notebook_filter = str(request.args.get("notebook", "")).strip()
    if tag_filter:
        notes = [n for n in notes if str(n.get("tag", "")).strip() == tag_filter]
    if notebook_filter:
        notes = [n for n in notes if str(n.get("notebook", "默认笔记本")).strip() == notebook_filter]
    notes = sorted(notes, key=lambda n: str(n.get("createdAt") or ""), reverse=True)
    return jsonify({"success": True, "notes": notes})


def _note_preview_text_response(target_id_raw):
    """返回笔记文件解析后的纯文本，供前端「生成前预览」与知识库跳转后核对内容。"""
    target_id = str(target_id_raw or "").strip()
    if not target_id:
        return jsonify({"success": False, "error": "无效 note_id"}), 400
    try:
        with note_store_lock:
            notes = load_saved_notes()
        target = next(
            (n for n in notes if str(n.get("noteId", "")).strip() == target_id),
            None,
        )
        if not target:
            return jsonify({"success": False, "error": "笔记不存在"}), 404
        file_name = target.get("fileName")
        ext = (target.get("ext") or "").strip().lower()
        title = str(target.get("title") or file_name or target_id).strip()
        if not file_name:
            return jsonify({"success": False, "error": "笔记文件缺失"}), 404
        file_path = os.path.join(NOTE_DIR, file_name)
        if not os.path.exists(file_path):
            return jsonify({"success": False, "error": "笔记文件不存在"}), 404
        text = parse_note_file_content(file_path, ext) or ""
        truncated = False
        if len(text) > NOTE_PREVIEW_TEXT_MAX:
            text = text[:NOTE_PREVIEW_TEXT_MAX]
            truncated = True
        return jsonify({
            "success": True,
            "noteId": target_id,
            "title": title,
            "text": text,
            "truncated": truncated,
            "ext": ext,
        })
    except Exception as e:
        logger.error(f"预览笔记文本失败: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/note_preview_text', methods=['GET'])
def note_preview_text_query():
    """单层路径，避免部分环境下嵌套路由 /api/notes/<id>/preview_text 返回 404。"""
    note_id = request.args.get("note_id", "")
    return _note_preview_text_response(note_id)


@app.route('/api/notes/<note_id>/preview_text', methods=['GET'])
def preview_note_text(note_id):
    return _note_preview_text_response(note_id)


@app.route('/api/notebooks', methods=['GET'])
def get_notebooks():
    with note_store_lock:
        notebooks = load_notebooks()
    return jsonify({"success": True, "notebooks": notebooks})


@app.route('/api/notebooks', methods=['POST'])
def create_notebook():
    try:
        payload = request.get_json(silent=True) or {}
        name = str(payload.get("name", "")).strip()
        if not name:
            return jsonify({"success": False, "error": "笔记本名称不能为空"}), 400
        with note_store_lock:
            notebooks = load_notebooks()
            if name not in notebooks:
                notebooks.append(name)
                save_notebooks(notebooks)
        return jsonify({"success": True, "name": name})
    except Exception as e:
        logger.error(f"新建笔记本失败: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/notebooks/<notebook_name>', methods=['PATCH'])
def rename_notebook(notebook_name):
    """重命名笔记本：JSON { \"new_name\": \"新名称\" }，同步更新所有笔记的 notebook 字段。"""
    try:
        old = str(notebook_name or "").strip()
        payload = request.get_json(silent=True) or {}
        new_name = str(payload.get("new_name", "")).strip()
        if not old or not new_name:
            return jsonify({"success": False, "error": "名称不能为空"}), 400
        if old == "默认笔记本":
            return jsonify({"success": False, "error": "不能重命名默认笔记本"}), 400
        if new_name == "默认笔记本":
            return jsonify({"success": False, "error": "不能使用该名称"}), 400
        with note_store_lock:
            notebooks = load_notebooks()
            if old not in notebooks:
                return jsonify({"success": False, "error": "笔记本不存在"}), 404
            if new_name in notebooks and new_name != old:
                return jsonify({"success": False, "error": "该名称已存在"}), 400
            notebooks = [new_name if n == old else n for n in notebooks]
            notes = load_saved_notes()
            for item in notes:
                if str(item.get("notebook", "默认笔记本")).strip() == old:
                    item["notebook"] = new_name
            save_saved_notes(notes)
            save_notebooks(notebooks)
        return jsonify({"success": True, "old": old, "new": new_name})
    except Exception as e:
        logger.error(f"重命名笔记本失败: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/notebooks/<notebook_name>', methods=['DELETE'])
def delete_notebook(notebook_name):
    try:
        name = str(notebook_name or "").strip()
        if not name:
            return jsonify({"success": False, "error": "笔记本名称不能为空"}), 400
        if name == "默认笔记本":
            return jsonify({"success": False, "error": "默认笔记本不支持删除"}), 400

        with note_store_lock:
            notebooks = load_notebooks()
            if name not in notebooks:
                return jsonify({"success": False, "error": "笔记本不存在"}), 404

            # 删除笔记本前，将其下文件归档到默认笔记本，避免数据丢失
            notes = load_saved_notes()
            moved_count = 0
            for item in notes:
                if str(item.get("notebook", "默认笔记本")).strip() == name:
                    item["notebook"] = "默认笔记本"
                    moved_count += 1
            save_saved_notes(notes)

            notebooks = [n for n in notebooks if n != name]
            if "默认笔记本" not in notebooks:
                notebooks.insert(0, "默认笔记本")
            save_notebooks(notebooks)

        return jsonify({"success": True, "name": name, "movedCount": moved_count})
    except Exception as e:
        logger.error(f"删除笔记本失败: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/notes', methods=['POST'])
def upload_note():
    try:
        note_file = request.files.get('note_file')
        if not note_file or not note_file.filename:
            return jsonify({"success": False, "error": "未提供笔记文件"}), 400
        if not allowed_file(note_file.filename, ALLOWED_NOTE_EXTENSIONS):
            return jsonify({"success": False, "error": "笔记格式不支持，仅支持 txt/md/markdown/pdf/doc/docx/epub"}), 400

        original_name = str(note_file.filename or "").strip()
        ext = original_name.rsplit('.', 1)[1].lower() if "." in original_name else ""
        if not ext:
            return jsonify({"success": False, "error": "无法识别文件扩展名"}), 400
        note_id = f"note_{int(time.time())}_{uuid.uuid4().hex[:8]}"
        # 磁盘文件名使用 note_id，避免中文路径/特殊字符问题；展示名称保留原文件名。
        file_name = f"{note_id}.{ext}"
        file_path = os.path.join(NOTE_DIR, file_name)
        note_file.save(file_path)

        original_title = original_name.rsplit(".", 1)[0].strip() if "." in original_name else original_name
        title = str(request.form.get("title", "")).strip() or original_title or original_name or file_name
        tag = str(request.form.get("tag", "")).strip()
        notebook = str(request.form.get("notebook", "默认笔记本")).strip() or "默认笔记本"
        created_at = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        size = os.path.getsize(file_path) if os.path.exists(file_path) else None

        note_item = {
            "noteId": note_id,
            "title": title,
            "tag": tag,
            "notebook": notebook,
            "fileName": file_name,
            "ext": ext,
            "size": size,
            "createdAt": created_at,
            "relativePath": f"/download/note/{file_name}"
        }
        with note_store_lock:
            notes = load_saved_notes()
            notes.insert(0, note_item)
            save_saved_notes(notes[:500])
            notebooks = load_notebooks()
            if notebook not in notebooks:
                notebooks.append(notebook)
                save_notebooks(notebooks)
        return jsonify({"success": True, "note": note_item})
    except Exception as e:
        logger.error(f"上传笔记失败: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/notes/import_url', methods=['POST'])
def import_note_from_url():
    """从网页 URL 拉取正文并保存为 txt 笔记（与播客侧 URL 解析共用 content_parser）。"""
    try:
        payload = request.get_json(silent=True) or {}
        url = str(payload.get("url", "")).strip()
        notebook = str(payload.get("notebook", "默认笔记本")).strip() or "默认笔记本"
        custom_title = str(payload.get("title", "")).strip()
        if not url:
            return jsonify({"success": False, "error": "请提供 URL"}), 400

        result = content_parser.parse_url(url)
        if not result.get("success"):
            err = result.get("error") or "解析失败"
            return jsonify({"success": False, "error": err}), 400

        content = (result.get("content") or "").strip()
        if not content:
            return jsonify({"success": False, "error": "未能从网页提取正文"}), 400

        max_chars = 500_000
        if len(content) > max_chars:
            content = content[:max_chars] + "\n\n（内容已截断）"

        pu = urlparse(url)
        default_title = custom_title
        if not default_title:
            host = (pu.netloc or "").strip()
            default_title = f"{host} 摘录" if host else "网页笔记"

        note_id = f"note_{int(time.time())}_{uuid.uuid4().hex[:8]}"
        file_name = f"{note_id}.txt"
        file_path = os.path.join(NOTE_DIR, file_name)
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)

        created_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        size = os.path.getsize(file_path) if os.path.exists(file_path) else None

        note_item = {
            "noteId": note_id,
            "title": default_title,
            "tag": "",
            "notebook": notebook,
            "fileName": file_name,
            "ext": "txt",
            "size": size,
            "createdAt": created_at,
            "relativePath": f"/download/note/{file_name}",
            "sourceUrl": url,
        }
        with note_store_lock:
            notes = load_saved_notes()
            notes.insert(0, note_item)
            save_saved_notes(notes[:500])
            notebooks = load_notebooks()
            if notebook not in notebooks:
                notebooks.append(notebook)
                save_notebooks(notebooks)
        return jsonify({"success": True, "note": note_item})
    except Exception as e:
        logger.error(f"URL 导入笔记失败: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/notes/<note_id>', methods=['DELETE', 'PATCH'])
def note_mutate(note_id):
    """删除笔记，或 PATCH 修改展示标题（不改磁盘文件名）。"""
    target_id = str(note_id or "").strip()
    if not target_id:
        return jsonify({"success": False, "error": "无效 note_id"}), 400

    if request.method == 'PATCH':
        payload = request.get_json(silent=True) or {}
        new_title = str(payload.get("title", "")).strip()
        if not new_title:
            return jsonify({"success": False, "error": "标题不能为空"}), 400
        if len(new_title) > 300:
            return jsonify({"success": False, "error": "标题过长"}), 400
        try:
            with note_store_lock:
                notes = load_saved_notes()
                target = next((n for n in notes if n.get("noteId") == target_id), None)
                if not target:
                    return jsonify({"success": False, "error": "笔记不存在"}), 404
                target["title"] = new_title
                save_saved_notes(notes)
            return jsonify({"success": True, "note": target})
        except Exception as e:
            logger.error(f"重命名笔记失败: {str(e)}")
            return jsonify({"success": False, "error": str(e)}), 500

    try:
        with note_store_lock:
            notes = load_saved_notes()
            target = next((n for n in notes if n.get("noteId") == target_id), None)
            if not target:
                return jsonify({"success": False, "error": "笔记不存在"}), 404
            file_name = target.get("fileName")
            notes = [n for n in notes if n.get("noteId") != target_id]
            save_saved_notes(notes)
        if file_name:
            file_path = os.path.join(NOTE_DIR, file_name)
            if os.path.exists(file_path):
                os.remove(file_path)
        return jsonify({"success": True, "noteId": target_id})
    except Exception as e:
        logger.error(f"删除笔记失败: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/preview_voice', methods=['POST'])
def preview_voice():
    """音色试听（短句）"""
    fail = auth_service.guard_feature_request(request)
    if fail is not None:
        return fail
    try:
        payload = request.get_json(silent=True) or {}
        api_key = str(payload.get("api_key", "")).strip()
        voice_id = str(payload.get("voice_id", "")).strip()
        text = str(payload.get("text", "")).strip() or "欢迎收听我的播客节目"

        if not api_key:
            return jsonify({"success": False, "error": "未提供 API Key"}), 400
        if not voice_id:
            return jsonify({"success": False, "error": "未提供 voice_id"}), 400

        chunks = []
        trace_id = None
        for event in minimax_client.synthesize_speech_stream(text=text, voice_id=voice_id, api_key=api_key):
            if event.get("type") == "audio_chunk":
                chunks.append(event.get("audio", ""))
            elif event.get("type") == "tts_complete":
                trace_id = event.get("trace_id")
            elif event.get("type") == "error":
                return jsonify({
                    "success": False,
                    "error": event.get("message", "试听失败"),
                    "trace_id": event.get("trace_id")
                }), 500

        if not chunks:
            return jsonify({"success": False, "error": "试听失败：未返回音频数据"}), 500

        audio = hex_to_audio_segment("".join(chunks))
        if audio is None:
            return jsonify({"success": False, "error": "试听失败：音频解码失败"}), 500

        filename = f"preview_{int(time.time())}_{uuid.uuid4().hex[:8]}.mp3"
        output_path = os.path.join(OUTPUT_DIR, filename)
        audio.export(output_path, format="mp3")

        return jsonify({
            "success": True,
            "audio_url": f"/download/audio/{filename}",
            "trace_id": trace_id,
            "text": text
        })
    except Exception as e:
        logger.error(f"音色试听失败: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/text_to_speech', methods=['POST'])
def text_to_speech_api():
    """
    文本转语音：单人整段或双人分段（Speaker1:/Speaker2:），可选开场/结尾、AI 润色。
    JSON:
      api_key, text, language (可选), ai_polish (bool)
      tts_mode: single | dual（默认 single）
      voice_id: 单人模式必填（MiniMax voice_id）
      voice_id_1, voice_id_2: 双人模式必填
      intro_text, outro_text: 可选；单人用 voice_id，双人默认用 voice_id_1 朗读
      intro_voice_id, outro_voice_id: 可选；若提供则覆盖开场/结尾所用音色（MiniMax voice_id）
    """
    fail = auth_service.guard_feature_request(request)
    if fail is not None:
        return fail
    try:
        from pydub import AudioSegment
        import re

        def sanitize_for_tts(s: str) -> str:
            """
            将用户文本清洗为更适合朗读的格式：
            - 去除括号/方括号/花括号/书名号/尖括号等包裹的舞台指令与注释
            - 保留换行结构，但收敛多余空白与重复空行
            """
            if not s:
                return ""
            t = str(s)
            # 常见中文“舞台指令”外壳（尽量短内容，避免误删长段正文）
            t = re.sub(r"（[^）]{0,80}）", "", t)
            t = re.sub(r"\([^)]{0,80}\)", "", t)
            t = re.sub(r"\[[^\]]{0,80}\]", "", t)
            t = re.sub(r"\{[^}]{0,80}\}", "", t)
            t = re.sub(r"【[^】]{0,80}】", "", t)
            t = re.sub(r"<[^>]{0,80}>", "", t)

            # 统一标点空白
            t = t.replace("\r\n", "\n").replace("\r", "\n")
            t = re.sub(r"[ \t]+\n", "\n", t)
            t = re.sub(r"\n{3,}", "\n\n", t)
            t = re.sub(r"[ \t]{2,}", " ", t)
            return t.strip()

        payload = request.get_json(silent=True) or {}
        api_key = str(payload.get("api_key", "")).strip()
        text = str(payload.get("text", "")).strip()
        intro_text = str(payload.get("intro_text", "")).strip()
        outro_text = str(payload.get("outro_text", "")).strip()
        language = str(payload.get("language", "中文")).strip()
        ai_polish = bool(payload.get("ai_polish", False))
        tts_mode = str(payload.get("tts_mode", "single")).strip().lower()
        if tts_mode not in ("single", "dual"):
            tts_mode = "single"

        voice_id = str(payload.get("voice_id", "")).strip()
        voice_id_1 = str(payload.get("voice_id_1", "")).strip()
        voice_id_2 = str(payload.get("voice_id_2", "")).strip()

        if not api_key:
            return jsonify({"success": False, "error": "未提供 API Key"}), 400

        if intro_text and len(intro_text) > TTS_INTRO_OUTRO_MAX:
            intro_text = intro_text[:TTS_INTRO_OUTRO_MAX]
        if outro_text and len(outro_text) > TTS_INTRO_OUTRO_MAX:
            outro_text = outro_text[:TTS_INTRO_OUTRO_MAX]

        if not text and not intro_text and not outro_text:
            return jsonify({"success": False, "error": "文本为空"}), 400

        if tts_mode == "dual":
            if not voice_id_1 or not voice_id_2:
                return jsonify({"success": False, "error": "双人模式需提供 voice_id_1 与 voice_id_2"}), 400
        else:
            if not voice_id:
                return jsonify({"success": False, "error": "未提供音色 voice_id"}), 400

        main_body = text
        if len(main_body) > TTS_BODY_MAX_CHARS:
            main_body = main_body[:TTS_BODY_MAX_CHARS]

        polished = False
        polish_trace_ids = []

        # “AI 润色”改为：确定性清洗为可朗读文本（去括号/去舞台指令）
        def maybe_polish(s: str):
            nonlocal polished
            if not s:
                return s
            if not ai_polish:
                return s
            polished = True
            return sanitize_for_tts(s)

        intro_final = maybe_polish(intro_text) if intro_text else ""
        outro_final = maybe_polish(outro_text) if outro_text else ""

        audio_parts = []
        last_trace = None

        def synth_one(content: str, vid: str):
            nonlocal last_trace
            if not content.strip():
                return
            seg, tid = _tts_synthesize_to_segment(content.strip(), vid, api_key)
            audio_parts.append(seg)
            last_trace = tid

        intro_voice_override = str(payload.get("intro_voice_id", "")).strip()
        outro_voice_override = str(payload.get("outro_voice_id", "")).strip()
        if tts_mode == "single":
            intro_voice = intro_voice_override or voice_id
            outro_voice = outro_voice_override or voice_id
        else:
            intro_voice = intro_voice_override or voice_id_1
            outro_voice = outro_voice_override or voice_id_1

        if intro_final:
            synth_one(intro_final, intro_voice)

        if tts_mode == "single":
            body = maybe_polish(main_body) if main_body else ""
            if not body.strip() and not intro_final and not outro_final:
                return jsonify({"success": False, "error": "正文为空"}), 400
            if body.strip():
                synth_one(body, voice_id)
        else:
            lines = _parse_tts_dialogue_lines(main_body)
            if not lines:
                if not intro_final and not outro_final:
                    return jsonify({"success": False, "error": "正文为空"}), 400
            for sp, chunk in lines:
                c = maybe_polish(chunk) if chunk and chunk.strip() else chunk
                vid = voice_id_1 if sp == "1" else voice_id_2
                synth_one(c, vid)

        if outro_final:
            synth_one(outro_final, outro_voice)

        if not audio_parts:
            return jsonify({"success": False, "error": "没有可合成的音频内容"}), 500

        combined = AudioSegment.empty()
        for p in audio_parts:
            combined += p

        filename = f"tts_{int(time.time())}_{uuid.uuid4().hex[:8]}.mp3"
        output_path = os.path.join(OUTPUT_DIR, filename)
        combined.export(output_path, format="mp3")

        preview_main = (main_body or "")[:400] + ("…" if len(main_body or "") > 400 else "")

        # 可选：根据朗读文本生成配图封面（与播客共用 MiniMax 文生图链路）
        cover_image_url = None
        generate_cover = bool(payload.get("generate_cover", True))
        if generate_cover and api_key:
            try:
                body_for_cover = maybe_polish(main_body) if (main_body and ai_polish) else (main_body or "")
                chunks = []
                if intro_final:
                    chunks.append(str(intro_final)[:400])
                if body_for_cover:
                    chunks.append(str(body_for_cover)[:1000])
                if outro_final:
                    chunks.append(str(outro_final)[:400])
                summary = "\n".join([c for c in chunks if c]).strip()
                if not summary:
                    summary = preview_main or "语音朗读内容"
                if len(summary) > 1200:
                    summary = summary[:1200] + "…"
                cr = minimax_client.generate_cover_image(summary, api_key=api_key)
                if cr.get("success") and cr.get("image_url"):
                    cover_image_url = cr["image_url"]
            except Exception as e:
                logger.warning(f"TTS 配图生成跳过: {e}")

        out = {
            "success": True,
            "audio_url": f"/download/audio/{filename}",
            "trace_id": last_trace,
            "polish_trace_ids": polish_trace_ids,
            "polished": polished,
            "tts_mode": tts_mode,
            "text_used": preview_main,
        }
        if cover_image_url:
            out["cover_image"] = cover_image_url
        return jsonify(out)
    except RuntimeError as e:
        logger.error(f"文本转语音失败: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500
    except Exception as e:
        logger.error(f"文本转语音失败: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/tts_sanitize', methods=['POST'])
def tts_sanitize_api():
    """将文本清洗为更适合朗读的格式（不合成音频）。"""
    fail = auth_service.guard_feature_request(request)
    if fail is not None:
        return fail
    try:
        payload = request.get_json(silent=True) or {}
        text = str(payload.get("text", "")).strip()
        if not text:
            return jsonify({"success": False, "error": "文本为空"}), 400
        # 复用 text_to_speech_api 内部的清洗逻辑：sanitize_for_tts
        # 注意：sanitize_for_tts 定义在 text_to_speech_api 的 try 作用域内，为避免重复实现，这里做一次轻量同款实现
        def sanitize_for_tts_preview(s: str) -> str:
            if not s:
                return ""
            t = str(s)
            t = re.sub(r"（[^）]{0,80}）", "", t)
            t = re.sub(r"\([^)]{0,80}\)", "", t)
            t = re.sub(r"\[[^\]]{0,80}\]", "", t)
            t = re.sub(r"\{[^}]{0,80}\}", "", t)
            t = re.sub(r"【[^】]{0,80}】", "", t)
            t = re.sub(r"<[^>]{0,80}>", "", t)
            t = t.replace("\r\n", "\n").replace("\r", "\n")
            t = re.sub(r"[ \t]+\n", "\n", t)
            t = re.sub(r"\n{3,}", "\n\n", t)
            t = re.sub(r"[ \t]{2,}", " ", t)
            return t.strip()

        cleaned = sanitize_for_tts_preview(text)
        return jsonify({"success": True, "text": cleaned})
    except Exception as e:
        logger.error(f"TTS 清洗失败: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/url_preview_text', methods=['POST'])
def url_preview_text_api():
    """从网址提取正文，供文本转语音「粘贴链接」使用（与播客 URL 解析同源）。"""
    try:
        payload = request.get_json(silent=True) or {}
        url = str(payload.get("url", "")).strip()
        if not url:
            return jsonify({"success": False, "error": "URL 为空"}), 400
        result = content_parser.parse_url(url)
        if not result.get("success"):
            return jsonify({
                "success": False,
                "error": result.get("error", "网页解析失败"),
            }), 400
        text = str(result.get("content") or "").strip()
        if not text:
            return jsonify({"success": False, "error": "未提取到正文"}), 400
        max_chars = 10000
        if len(text) > max_chars:
            text = text[:max_chars]
        return jsonify({"success": True, "text": text})
    except Exception as e:
        logger.error(f"URL 正文预览失败: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/voice_clone', methods=['POST'])
def voice_clone_api():
    """上传音频并调用 MiniMax 克隆，写入 saved_voices。表单：audio, api_key, display_name（可选）。"""
    fail = auth_service.guard_feature_request(request)
    if fail is not None:
        return fail
    try:
        if 'audio' not in request.files:
            return jsonify({"success": False, "error": "未提供音频文件"}), 400
        f = request.files['audio']
        if not f or not getattr(f, 'filename', None):
            return jsonify({"success": False, "error": "音频文件为空"}), 400
        api_key = str(request.form.get("api_key", "")).strip()
        display_name = str(request.form.get("display_name", "")).strip()
        if not api_key:
            return jsonify({"success": False, "error": "未提供 API Key"}), 400

        data = f.read()
        if len(data) > MAX_VOICE_CLONE_UPLOAD_BYTES:
            mb = MAX_VOICE_CLONE_UPLOAD_BYTES // (1024 * 1024)
            return jsonify({"success": False, "error": f"文件过大，单文件最大 {mb}MB"}), 400

        raw_name = secure_filename(f.filename) or "audio"
        ext = os.path.splitext(raw_name)[1].lower()
        if ext not in ('.wav', '.mp3', '.m4a', '.flac', '.ogg', '.webm', '.mpeg', '.mpga', '.aac', '.mp4'):
            ext = '.wav'
        fname = f"clone_upload_{int(time.time())}_{uuid.uuid4().hex[:8]}{ext}"
        save_path = os.path.join(UPLOAD_DIR, fname)
        with open(save_path, 'wb') as out:
            out.write(data)

        result = voice_manager.clone_custom_voice(save_path, api_key=api_key)
        try:
            if os.path.exists(save_path):
                os.remove(save_path)
        except OSError:
            pass

        if not result.get("success"):
            return jsonify({
                "success": False,
                "error": result.get("error", result.get("message", "克隆失败")),
            }), 500

        vid = str(result.get("voice_id", "")).strip()
        if not vid:
            return jsonify({"success": False, "error": "未返回 voice_id"}), 500

        dup_name = display_name or vid
        upsert_saved_voice(vid, source_speaker="clone", display_name=dup_name)
        return jsonify({
            "success": True,
            "voice_id": vid,
            "displayName": dup_name,
            "upload_trace_id": result.get("upload_trace_id"),
            "clone_trace_id": result.get("clone_trace_id"),
        })
    except Exception as e:
        logger.error(f"语音克隆失败: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


def build_merged_ai_reference_for_script_draft(text_input, url_inputs, uploaded_files, selected_note_ids):
    """
    合并「仅生成播客文案」所需的参考素材，行为与 generate_podcast 中解析阶段一致。
    返回 (merged_content, prelude_events, fatal_error)
    - merged_content 为 None 且无 fatal_error：仅 DOC 无文本等场景下提前结束（与完整生成一致）
    - prelude_events: list[dict]，可直接作为 SSE JSON 发出（log / url_parse_warning）
    - fatal_error: str 时调用方应发送 error 事件后结束
    """
    prelude_events = []
    pdf_parts = []
    for f in (uploaded_files or []):
        fpath = f.get("path")
        fext = f.get("ext")
        fname = f.get("name") or os.path.basename(fpath or "")
        if not fpath:
            continue
        prelude_events.append({"type": "log", "message": f"已上传文件: {fname}"})
        parsed = parse_note_file_content(fpath, fext)
        if parsed and parsed.strip():
            prelude_events.append({"type": "log", "message": f"文件解析完成（{fname}），共 {len(parsed)} 字符"})
            pdf_parts.append(parsed.strip())
        else:
            if (fext or "").lower() == "doc":
                doc_hint = build_doc_parse_tool_hint()
                prelude_events.append({
                    "type": "log",
                    "message": f"DOC 文件 {fname} 已保存，但未提取到正文。{doc_hint}",
                })
                continue
            return None, prelude_events, f"上传文件解析失败：{fname}，请更换为可解析格式"
    pdf_content = "\n\n".join(pdf_parts)

    url_parts = []
    for u in (url_inputs or []):
        prelude_events.append({"type": "log", "message": f"开始解析网址: {u}"})
        url_result = content_parser.parse_url(u)
        if url_result["success"]:
            part = url_result.get("content", "")
            if part:
                url_parts.append(part)
            for log in url_result.get("logs") or []:
                prelude_events.append({"type": "log", "message": log})
        else:
            error_code = url_result.get("error_code", "unknown")
            prelude_events.append({
                "type": "url_parse_warning",
                "message": url_result["error"],
                "error_code": error_code,
            })
            for log in url_result.get("logs") or []:
                prelude_events.append({"type": "log", "message": log})
    url_content = "\n\n".join([p for p in url_parts if p and p.strip()])

    merged_content = content_parser.merge_contents(text_input, url_content, pdf_content)

    notes_content = []
    if selected_note_ids:
        with note_store_lock:
            all_notes = load_saved_notes()
        note_map = {n.get("noteId"): n for n in all_notes}
        for note_id in selected_note_ids:
            note_item = note_map.get(note_id)
            if not note_item:
                continue
            file_name = note_item.get("fileName")
            ext = note_item.get("ext")
            note_title = note_item.get("title") or note_id
            if not file_name:
                continue
            file_path = os.path.join(NOTE_DIR, file_name)
            if not os.path.exists(file_path):
                continue
            ntext = parse_note_file_content(file_path, ext)
            if ntext and ntext.strip():
                notes_content.append(f"【笔记：{note_title}】\n{ntext.strip()}")
        if notes_content:
            merged_content = (merged_content + "\n\n" if merged_content else "") + "\n\n".join(notes_content)
            prelude_events.append({
                "type": "log",
                "message": f"已附加 {len(notes_content)} 份勾选笔记内容",
            })

    if not merged_content or merged_content == "没有可用的内容":
        return None, prelude_events, "请至少提供一种可用参考内容（文本/网址/可解析文件/知识库勾选笔记）"

    prelude_events.append({"type": "log", "message": f"内容解析完成，共 {len(merged_content)} 字符"})
    return merged_content, prelude_events, None


def _tail_dialogue_for_continuation(produced: str, max_chars: int = 3600) -> str:
    return tail_dialogue_for_continuation(produced, max_chars=max_chars)


def _build_structured_memory(produced: str, max_lines: int = 20) -> str:
    return build_structured_memory(produced, max_lines=max_lines)


def _build_global_constitution(script_language, script_style, program_name, speaker1_persona, speaker2_persona):
    return build_global_constitution(script_language, script_style, program_name, speaker1_persona, speaker2_persona)


def _build_article_constitution(script_language, script_style, program_name):
    return build_article_constitution(script_language, script_style, program_name)


def _post_edit_script_for_coherence(text: str) -> str:
    return post_edit_script_for_coherence(text)


def _parse_outline_segments(outline_text: str, total_target: int, max_single: int):
    return parse_outline_segments(outline_text, total_target, max_single)


def _strip_premature_closing(text: str, keep_tail_lines: int = 14) -> str:
    return strip_premature_closing(text, keep_tail_lines=keep_tail_lines)


def _style_bucket_for_bridge(script_style: str) -> str:
    s = script_style or ""
    if any(k in s for k in ("专业严谨", "专业", "严谨", "结构清晰")):
        return "professional"
    if any(k in s for k in ("新闻播报", "新闻", "播报", "客观简洁")):
        return "news"
    if any(k in s for k in ("访谈对谈", "访谈", "观点碰撞", "对谈")):
        return "interview"
    return "casual"


def _build_bridge_sentence_pool(seg_role: str, bucket: str):
    if seg_role == "last":
        last_map = {
            "casual": [
                "顺着前面的结论，我们把最后几个关键点收束一下。",
                "接着上面的分析，我们把落地建议和收尾放在一起讲清楚。",
                "沿着刚才那条线，我们做一个有信息量的总结收口。",
            ],
            "professional": [
                "基于前面的论证链条，本节把结论与可执行建议对齐收束。",
                "承接上文要点，本节做结构化总结并明确落地检查项。",
                "在前面判断成立的前提下，我们把风险边界与行动清单说清楚。",
            ],
            "news": [
                "梳理前述事实与背景后，本节给出简明结论与后续观察点。",
                "承接上文信息，本节做客观收束并提示后续值得关注的动向。",
                "在前述脉络基础上，本节用更简洁的方式完成事实层面的收束。",
            ],
            "interview": [
                "把前面的观点对齐后，我们把争议点与共识做一次收束。",
                "顺着对话推进，本节把双方立场与可执行结论说清楚。",
                "承接上文讨论，本节用对话方式完成总结与开放式收尾。",
            ],
        }
        return last_map.get(bucket, last_map["casual"])
    mid_map = {
        "casual": [
            "顺着刚才这个点，我们再往下拆一层。",
            "在前面结论的基础上，我们把这个问题讲得更具体一点。",
            "接着上文的思路，我们换个角度把关键细节补齐。",
            "沿着这个脉络，我们把下一步最容易忽略的部分展开说说。",
            "前面这个判断先立住，下面我们看它在实际场景里的变化。",
        ],
        "professional": [
            "承接上文结论，本节把定义、边界条件与推导链条再压实一层。",
            "在前述框架下，本节聚焦机制与变量，把分析推进到可检验层面。",
            "沿着论证路径，本节补充关键反例与限制条件，避免结论过宽。",
            "基于已建立的前提，本节进入方法与步骤层，保持术语一致。",
            "承接上文判断，本节用结构化方式展开案例与对比。",
        ],
        "news": [
            "承接上文事实梳理，本节补充关键背景与时间节点。",
            "在前述信息基础上，本节对齐多方说法并指出仍待核实之处。",
            "沿着事件脉络，本节展开影响范围与后续观察要点。",
            "承接上文，本节用更简洁的方式补充数据与来源提示。",
            "基于已知事实，本节进入第二落点：原因与后续走向。",
        ],
        "interview": [
            "顺着刚才的分歧点，我们把正反论据再摊开一点。",
            "承接上文观点碰撞，本节用案例把抽象判断落到具体情境。",
            "沿着对话节奏，本节换一个提问角度把问题说透。",
            "基于前面的共识与分歧，本节进入更深一层推演。",
            "承接上文，本节用追问把关键假设挑明。",
        ],
    }
    return mid_map.get(bucket, mid_map["casual"])


def _pick_bridge_sentence(
    seg_no: int,
    seg_role: str,
    seg_transition: str,
    script_style: str,
    tail_text: str,
):
    bucket = _style_bucket_for_bridge(script_style)
    pool = _build_bridge_sentence_pool(seg_role, bucket)
    if not pool:
        return ""
    hook = extract_tail_hook_phrases(tail_text or "", max_phrases=2) if tail_text else ""
    if seg_transition:
        trans = seg_transition.lower()
        if any(k in trans for k in ["总结", "收尾", "结论"]):
            return "接上前文，我们先把核心结论收束，再补上可执行建议。"
        if any(k in trans for k in ["案例", "例子", "实操", "落地"]):
            return "顺着前面的判断，我们马上用一个具体案例把它落到实处。"
    base = pool[(max(1, int(seg_no)) - 1) % len(pool)]
    if hook and seg_role != "last":
        return f"接着刚才聊到的「{hook}」，{base}"
    return base


def _prev_segment_outline_context(plan_segments, seg_idx: int) -> str:
    """上一段在总纲中的锚点，减少段间漂移。"""
    if seg_idx <= 0:
        return ""
    prev = plan_segments[seg_idx - 1] if seg_idx - 1 < len(plan_segments) else None
    if not isinstance(prev, dict):
        return ""
    pt = str(prev.get("title", "")).strip()
    must = prev.get("must_include") or []
    if not isinstance(must, list):
        must = []
    must_s = "；".join([str(x).strip() for x in must if str(x).strip()][:5])
    th = str(prev.get("transition_hint", "")).strip()
    return (
        "\n【上一段总纲锚点】\n"
        f"标题：{pt or '（未命名）'}\n"
        f"要点：{must_s or '无'}\n"
        f"该段与下一段衔接意图：{th or '无'}\n"
        "本段开头必须承接上一段末尾话题与语气，不要重复上一段已充分交代过的信息。"
    )


def _mid_segment_transition_bans(seg_role: str) -> str:
    if seg_role == "last":
        return ""
    lines = [
        "【分段衔接禁止项】非最后一段：禁止再次写完整节目开场白/自我介绍式寒暄；禁止重新介绍本期主题与两位人设（除非与上文形成必要递进）。",
    ]
    if seg_role == "middle":
        lines.append("【中段专属】禁止突然跳到与上文无关的新话题；换题必须先有过渡句承接。")
    return "\n" + "\n".join(lines)


def _mid_segment_article_bans(seg_role: str) -> str:
    if seg_role == "last":
        return ""
    lines = [
        "【文章分段】非末段：禁止再次写与上文重复的全文导语、标题复述；换节须有过渡。",
    ]
    if seg_role == "middle":
        lines.append("【中段】禁止突然跳到与上文无关的新话题；承接末段论点或案例再展开。")
    return "\n" + "\n".join(lines)


def _non_last_closing_rule(seg_no: int, segments: int, *, is_article: bool = False) -> str:
    if seg_no >= segments:
        return ""
    if is_article:
        return (
            "\n若当前不是最后一段，严禁出现全文收束语（如「综上所述」「全文完」「以上便是本文全部内容」「感谢阅读」等）。"
        )
    return (
        "\n若当前不是最后一段，严禁出现任何结束语（如“感谢收听”“下期再见”“今天就到这里”“再见”）。"
    )


def _merge_constraints_on_segment_retry(
    *,
    global_constitution: str,
    continuity_tip: str,
    seg_title: str,
    seg_no: int,
    segments: int,
    script_constraints: str,
    prev_outline_ctx: str,
    seg_opening_rule: str,
    bridge_sentence: str,
    mid_bans: str,
    output_mode: str = "dialogue",
):
    """794/unknown 重试时保留衔接相关硬约束，避免只剩极简句导致断裂。"""
    if (output_mode or "dialogue").lower() == "article":
        minimal = (
            "只输出普通文章正文，禁止 Speaker 对话行与播客口吻。"
            "承接上文、保持主题一致并自然收尾。"
        )
    else:
        minimal = (
            "只输出 Speaker1/Speaker2 对话，一行一句。"
            "禁止动作和场景描述。保持主题一致并自然收尾。"
        )
    parts = [
        minimal,
        "【全局宪法】\n" + global_constitution,
        continuity_tip,
    ]
    sc = (script_constraints or "").strip()
    if sc:
        parts.append("【用户约束摘要】\n" + sc[:800])
    parts.append(f"本段标题：{seg_title}。")
    if prev_outline_ctx:
        parts.append(prev_outline_ctx.strip())
    if mid_bans:
        parts.append(mid_bans.strip())
    if seg_opening_rule:
        parts.append(seg_opening_rule.strip())
    if seg_no > 1 and bridge_sentence:
        parts.append(f"段间桥接句模板（优先用于本段前2句之一）：{bridge_sentence}")
    parts.append(
        _non_last_closing_rule(
            seg_no, segments, is_article=(output_mode or "dialogue").lower() == "article"
        ).strip()
    )
    if (output_mode or "dialogue").lower() == "article":
        parts.append("格式：普通文章段落；禁止 Speaker 前缀。")
    else:
        parts.append("格式：每行 Speaker1: 或 Speaker2: 开头，一行一句。")
    return "\n".join([p for p in parts if p]).strip()


def _merge_constraints_on_single_retry(*, global_constitution: str, script_constraints: str, output_mode: str = "dialogue") -> str:
    """单次生成模式 794/unknown 重试时保留全局宪法与用户约束摘要。"""
    if (output_mode or "dialogue").lower() == "article":
        minimal = (
            "只输出普通文章正文，禁止 Speaker 对话行与播客口吻。"
            "保持主题一致并自然收尾。"
        )
    else:
        minimal = (
            "只输出 Speaker1/Speaker2 对话，一行一句。"
            "禁止动作和场景描述。保持主题一致并自然收尾。"
        )
    parts = [minimal, "【全局宪法】\n" + global_constitution]
    sc = (script_constraints or "").strip()
    if sc:
        parts.append("【用户约束摘要】\n" + sc[:800])
    if (output_mode or "dialogue").lower() == "article":
        parts.append("格式：普通文章段落；禁止 Speaker 前缀。")
    else:
        parts.append("格式：每行 Speaker1: 或 Speaker2: 开头，一行一句。")
    return "\n".join(parts).strip()


def _split_new_segment_head_and_rest(new_part: str, max_speaker_lines: int = 3):
    raw_lines = new_part.split("\n")
    out_idx = 0
    sp_count = 0
    for i, ln in enumerate(raw_lines):
        s = ln.strip()
        if s.startswith("Speaker1:") or s.startswith("Speaker2:"):
            sp_count += 1
            out_idx = i + 1
            if sp_count >= max_speaker_lines:
                break
    head = "\n".join(raw_lines[:out_idx]).strip()
    rest = "\n".join(raw_lines[out_idx:])
    return head, rest


def _expected_first_speaker_from_tail(prev_tail: str):
    lines = [l.strip() for l in (prev_tail or "").splitlines() if l.strip()]
    for ln in reversed(lines):
        if ln.startswith("Speaker1:"):
            return "Speaker2"
        if ln.startswith("Speaker2:"):
            return "Speaker1"
    return None


def _parse_boundary_replacement_lines(text: str, max_lines: int = 3):
    out = []
    for ln in (text or "").splitlines():
        s = ln.strip()
        if s.startswith("Speaker1:") or s.startswith("Speaker2:"):
            out.append(s)
            if len(out) >= max_lines:
                break
    return out


def _replacement_head_valid(lines, expected_first):
    if len(lines) < 2 or len(lines) > 3:
        return False
    if expected_first:
        sp0 = "Speaker1" if lines[0].startswith("Speaker1:") else "Speaker2"
        if sp0 != expected_first:
            return False
    prev_sp = None
    for ln in lines:
        sp = "Speaker1" if ln.startswith("Speaker1:") else "Speaker2"
        if prev_sp is not None and sp == prev_sp:
            return False
        prev_sp = sp
    return True


def stream_script_draft_generation_events(merged_content,
                                          script_target_chars,
                                          user_api_key,
                                          script_style,
                                          script_language,
                                          program_name,
                                          speaker1_persona,
                                          speaker2_persona,
                                          script_constraints,
                                          long_script_mode=False,
                                          output_mode="dialogue"):
    """
    生成播客或文章文案事件流：
    - output_mode=dialogue：双人播客对话脚本
    - output_mode=article：普通文章（非对话）
    - 长文案模式：按最大单段字数自动分段生成并拼接
    """
    om = (output_mode or "dialogue").strip().lower()
    is_article = om == "article"
    max_single = int(
        PODCAST_CONFIG.get(
            "script_target_chars_preferred_max",
            PODCAST_CONFIG.get("script_target_chars_max", 5000),
        )
    )
    # 超过单段稳定字数时自动分段；long_script_mode 仅作为显式偏好保留
    use_segmented = int(script_target_chars) > max_single or bool(long_script_mode)
    global_constitution = (
        _build_article_constitution(script_language, script_style, program_name)
        if is_article
        else _build_global_constitution(
            script_language, script_style, program_name, speaker1_persona, speaker2_persona
        )
    )

    if not use_segmented:
        target_for_try = int(script_target_chars)
        max_attempts = 5
        constraints_for_try = script_constraints
        target_schedule = retry_target_schedule(target_for_try)
        for attempt in range(1, max_attempts + 1):
            completed = False
            error_message = None
            trace_id = None
            for script_event in minimax_client.generate_script_stream(
                merged_content,
                target_for_try,
                api_key=user_api_key,
                script_style=script_style,
                script_language=script_language,
                program_name=program_name,
                speaker1_persona=speaker1_persona,
                speaker2_persona=speaker2_persona,
                script_constraints=constraints_for_try,
                output_mode=om,
            ):
                if script_event["type"] == "script_chunk":
                    yield {"type": "draft_script_chunk", "content": script_event.get("content", "")}
                elif script_event["type"] == "script_complete":
                    trace_id = script_event.get("trace_id")
                    completed = True
                    break
                elif script_event["type"] == "error":
                    error_message = script_event.get("message", "脚本生成失败")
                    break

            if completed:
                yield {"type": "draft_script_complete", "trace_id": trace_id}
                return

            if not error_message:
                error_message = "脚本生成失败"
            low_msg = str(error_message).lower()
            should_retry = ("794" in low_msg) or ("unknown error" in low_msg)
            if attempt < max_attempts and should_retry:
                prev_target = target_for_try
                target_for_try = max(600, min(target_schedule[attempt], prev_target))
                if attempt >= 2:
                    constraints_for_try = _merge_constraints_on_single_retry(
                        global_constitution=global_constitution,
                        script_constraints=script_constraints,
                        output_mode=om,
                    )
                yield {
                    "type": "log",
                    "message": (
                        f"遇到上游错误（{error_message}），保留原始参考素材，第 {attempt + 1}/{max_attempts} 次重试，"
                        f"单段目标字数 {prev_target} -> {target_for_try}。"
                    ),
                }
                continue

            yield {"type": "error", "message": error_message}
            return
        return

    total_target = int(script_target_chars)
    outline_result = minimax_client.generate_script_outline(
        merged_content,
        total_target,
        api_key=user_api_key,
        script_style=script_style,
        script_language=script_language,
        program_name=program_name,
        speaker1_persona=speaker1_persona,
        speaker2_persona=speaker2_persona,
        script_constraints=script_constraints,
        output_mode=om,
    )
    if outline_result.get("success"):
        yield {"type": "log", "message": "已生成分段总纲，按总纲逐段生成正文。"}
    else:
        yield {"type": "log", "message": "总纲生成失败，回退到均分分段策略。"}
    plan_segments = _parse_outline_segments(outline_result.get("outline_text", ""), total_target, max_single)
    segments = len(plan_segments)
    produced = ""
    trace_ids = []
    continuity_state = ""

    for idx, seg_plan in enumerate(plan_segments):
        seg_no = idx + 1
        produced_snapshot_before_segment = produced
        current_target = max(600, min(int(seg_plan.get("target_chars", max_single)), max_single))
        seg_title = str(seg_plan.get("title", f"第{seg_no}段")).strip() or f"第{seg_no}段"
        seg_must = seg_plan.get("must_include") or []
        seg_transition = str(seg_plan.get("transition_hint", "")).strip()
        yield {
            "type": "progress",
            "step": "llm_script_segment",
            "message": f"长文案分段生成中：第 {seg_no}/{segments} 段"
        }
        yield {
            "type": "log",
            "message": f"开始生成第 {seg_no}/{segments} 段（{seg_title}），目标约 {current_target} 字"
        }

        if is_article:
            if seg_no == 1:
                continuity_tip = (
                    "这是文章开篇部分：引入背景与问题，明确核心议题；若后文还有段落，末段不要做全篇总结。"
                )
                seg_role = "first"
            elif seg_no < segments:
                continuity_tip = "这是文章中间部分：承接上文论点与术语，不重复开篇套话；不做全文最终总结。"
                seg_role = "middle"
            else:
                continuity_tip = "这是文章最后部分：收束论证并给出结论或建议。"
                seg_role = "last"
        else:
            if seg_no == 1:
                continuity_tip = (
                    "这是第一段：先用日常痛点/背景导入，再给核心定义，然后再进入方法展开。"
                    "不要一上来直接进入深层细节；本段末尾不要做全篇收尾。"
                )
                seg_role = "first"
            elif seg_no < segments:
                continuity_tip = "这是中间段：必须延续上文，不要重复开场，不要做最终总结。"
                seg_role = "middle"
            else:
                continuity_tip = "这是最后一段：延续上文并完成简洁收尾总结。"
                seg_role = "last"

        prev_outline_ctx = _prev_segment_outline_context(plan_segments, idx)
        mid_bans = _mid_segment_article_bans(seg_role) if is_article else _mid_segment_transition_bans(seg_role)
        seg_opening_rule = ""
        tail = ""

        seg_position = f"第{seg_no}/{segments}段"
        if seg_no == 1:
            segment_material = merged_content
        else:
            tail = _tail_dialogue_for_continuation(produced)
            memory = continuity_state or _build_structured_memory(produced)
            tail_lines = [ln.strip() for ln in tail.splitlines() if ln.strip()]
            tail_anchor = tail_lines[-2:] if tail_lines else []
            if tail_anchor:
                if is_article:
                    seg_opening_rule = (
                        "\n【段首衔接】\n"
                        "本段开头须紧接上文末段推进，不得重复全文标题或与上文重复的导语。\n"
                        "可参考上文末段锚点：\n"
                        + "\n".join([f"- {x}" for x in tail_anchor])
                    )
                else:
                    seg_opening_rule = (
                        "\n【段首衔接硬约束】\n"
                        "本段前2-3句必须紧接上文最后一句推进，不得重新寒暄或重新定义主题。\n"
                        "请先回应/承接以下上文锚点，再自然展开新信息：\n"
                        + "\n".join([f"- {x}" for x in tail_anchor])
                        + "\n若需切换子话题，先用一句过渡句（如“顺着这个点，我们再看…”）后再展开。"
                    )
            segment_material = (
                "【参考素材（供事实与术语；接续时请优先紧接下方「已生成上文」末句，勿另起炉灶重讲开场）】\n"
                f"{merged_content}\n\n"
                "【结构化记忆（用于保证跨段一致性）】\n"
                f"{memory}\n\n"
                "【已生成上文——请在本块之后续写，不要重复其中任何一行】\n"
                f"{tail}\n"
            )

        bridge_sentence = _pick_bridge_sentence(
            seg_no,
            seg_role,
            seg_transition,
            script_style,
            tail if seg_no > 1 else "",
        )
        if is_article:
            extra_constraints = (
                (script_constraints or "").strip()
                + "\n"
                + "【全局宪法】\n"
                + global_constitution
                + "\n"
                + continuity_tip
                + "\n"
                + (prev_outline_ctx.strip() if prev_outline_ctx else "")
                + "\n"
                + mid_bans.strip()
                + "\n"
                + "保持与已生成上文语气、术语一致，勿逐句复述已有段落。"
                + "\n"
                + "严格遵守结构化记忆中的术语与事实锚点：同一叫法、事实不改写。"
                + "\n"
                + f"本段章节：{seg_title}。"
                + ("\n本段须覆盖要点：" + "；".join(seg_must) if seg_must else "")
                + (f"\n段间衔接提示：{seg_transition}" if seg_transition else "")
                + _non_last_closing_rule(seg_no, segments, is_article=True)
                + "\n"
                + "格式：普通文章正文；禁止 Speaker1/Speaker2；允许 Markdown。"
                + (
                    f"\n过渡句参考（可用于段首）：{bridge_sentence}"
                    if seg_no > 1 and bridge_sentence
                    else ""
                )
            ).strip()
        else:
            extra_constraints = (
                (script_constraints or "").strip()
                + "\n"
                + "【全局宪法】\n"
                + global_constitution
                + "\n"
                + continuity_tip
                + "\n"
                + (prev_outline_ctx.strip() if prev_outline_ctx else "")
                + "\n"
                + mid_bans.strip()
                + "\n"
                + "保持与已生成内容的人设、语气、术语一致，勿逐句复述「已生成上文」。"
                + "\n"
                + "严格遵守结构化记忆中的 term_dictionary / fact_anchors / forbidden_repeats："
                + "术语保持同一叫法、事实锚点不改写、禁重复句不再复述。"
                + "\n"
                + f"本段标题：{seg_title}。"
                + ("\n本段必须覆盖要点：" + "；".join(seg_must) if seg_must else "")
                + (f"\n本段过渡提示：{seg_transition}" if seg_transition else "")
                + _non_last_closing_rule(seg_no, segments, is_article=False)
                + "\n"
                + "格式：每行 Speaker1: 或 Speaker2: 开头，一行一句。"
                + (
                    f"\n段间桥接句模板（优先用于本段前2句之一）：{bridge_sentence}"
                    if seg_no > 1 and bridge_sentence
                    else ""
                )
            ).strip()

        attempts = 0
        segment_done = False
        segment_material_for_try = segment_material
        current_target_for_try = current_target
        extra_constraints_for_try = extra_constraints
        if seg_opening_rule:
            extra_constraints_for_try = (extra_constraints_for_try + "\n" + seg_opening_rule).strip()
        max_attempts = 5
        segment_target_schedule = retry_target_schedule(current_target)
        is_first_chunk_of_segment = True
        while attempts < max_attempts and not segment_done:
            attempts += 1
            error_message = None
            for script_event in minimax_client.generate_script_stream(
                segment_material_for_try,
                current_target_for_try,
                api_key=user_api_key,
                script_style=script_style,
                script_language=script_language,
                program_name=program_name,
                speaker1_persona=speaker1_persona,
                speaker2_persona=speaker2_persona,
                script_constraints=extra_constraints_for_try,
                segment_role=seg_role,
                segment_position=seg_position,
                output_mode=om,
            ):
                if script_event["type"] == "script_chunk":
                    chunk = script_event.get("content", "")
                    # 段与段拼接时兜底补换行，避免上一段末尾与下一段首行粘连
                    if is_first_chunk_of_segment and seg_no > 1 and produced and not produced.endswith("\n"):
                        produced += "\n"
                        yield {"type": "draft_script_chunk", "content": "\n"}
                    produced += chunk
                    yield {"type": "draft_script_chunk", "content": chunk}
                    is_first_chunk_of_segment = False
                elif script_event["type"] == "script_complete":
                    trace_id = script_event.get("trace_id")
                    if trace_id:
                        trace_ids.append(trace_id)
                    if seg_role in ("first", "middle"):
                        produced = _strip_premature_closing(produced)
                    continuity_state = _build_structured_memory(produced)
                    segment_done = True
                    break
                elif script_event["type"] == "error":
                    error_message = script_event.get("message", "脚本分段生成失败")
                    break

            if segment_done:
                break

            if not error_message:
                error_message = "脚本分段生成失败"
            low_msg = str(error_message).lower()
            should_retry = ("794" in low_msg) or ("unknown error" in low_msg)
            if attempts < max_attempts and should_retry:
                segment_material_for_try = segment_material
                prev_target = current_target_for_try
                current_target_for_try = max(
                    600,
                    min(segment_target_schedule[attempts], prev_target),
                )
                if attempts >= 2:
                    extra_constraints_for_try = _merge_constraints_on_segment_retry(
                        global_constitution=global_constitution,
                        continuity_tip=continuity_tip,
                        seg_title=seg_title,
                        seg_no=seg_no,
                        segments=segments,
                        script_constraints=script_constraints,
                        prev_outline_ctx=prev_outline_ctx,
                        seg_opening_rule=seg_opening_rule,
                        bridge_sentence=bridge_sentence,
                        mid_bans=mid_bans,
                        output_mode=om,
                    )
                yield {
                    "type": "log",
                    "message": (
                        f"第 {seg_no}/{segments} 段遇到上游错误（{error_message}），"
                        f"保留原始参考素材，第 {attempts + 1}/{max_attempts} 次重试，"
                        f"单段目标字数 {prev_target} -> {current_target_for_try}。"
                    )
                }
                continue

            yield {"type": "error", "message": error_message}
            return

        if not segment_done:
            yield {"type": "error", "message": error_message or "脚本分段生成失败"}
            return

        if seg_no > 1 and PODCAST_CONFIG.get("segment_boundary_api_polish") and not is_article:
            prev_snap = produced_snapshot_before_segment
            heuristic_only = PODCAST_CONFIG.get("segment_boundary_api_heuristic_only", True)
            if not produced.startswith(prev_snap):
                yield {
                    "type": "log",
                    "message": f"第 {seg_no} 段段间衔接优化已跳过：前文经校对后边界无法对齐，避免误改。",
                }
            else:
                new_part = produced[len(prev_snap) :]
                head_raw, rest = _split_new_segment_head_and_rest(new_part, 3)
                run_api = head_raw and (not heuristic_only or segment_head_suggests_restart(head_raw))
                if run_api:
                    prev_tail = _tail_dialogue_for_continuation(prev_snap)
                    exp = _expected_first_speaker_from_tail(prev_tail)
                    pr = minimax_client.polish_segment_boundary(
                        prev_tail,
                        head_raw,
                        seg_transition=seg_transition,
                        api_key=user_api_key,
                        script_style=script_style,
                        script_language=script_language,
                        program_name=program_name,
                        speaker1_persona=speaker1_persona,
                        speaker2_persona=speaker2_persona,
                    )
                    if pr.get("success"):
                        lines = _parse_boundary_replacement_lines(pr.get("replacement_head", ""))
                        if _replacement_head_valid(lines, exp):
                            merged = "\n".join(lines)
                            suffix = ("\n" + rest) if rest.strip() else ""
                            new_part2 = merged + suffix
                            produced = prev_snap + new_part2
                            continuity_state = _build_structured_memory(produced)
                            yield {"type": "draft_script_replace", "content": produced}
                            yield {
                                "type": "log",
                                "message": f"已用 API 优化第 {seg_no}/{segments} 段段首与上文衔接。",
                            }
                        else:
                            yield {
                                "type": "log",
                                "message": "段间衔接 API 返回未通过说话人/行数校验，保留本段原文。",
                            }
                    else:
                        err = (pr.get("error") or "")[:120]
                        yield {
                            "type": "log",
                            "message": f"段间衔接 API 未成功，保留原文。{err}",
                        }

    yield {
        "type": "draft_script_complete",
        "trace_id": trace_ids[-1] if trace_ids else None
    }
    # 第三层：对话脚本收口校对（文章模式不适用，避免把正文改成 Speaker 行）
    if not is_article:
        polished = _post_edit_script_for_coherence(produced)
        if polished and polished != produced:
            yield {"type": "draft_script_replace", "content": polished}


@app.route('/api/ping', methods=['GET'])
def api_ping():
    """前端探测后端是否在线；返回 404 多为未启动或端口错误。"""
    return jsonify({"ok": True})


@app.route('/api/generate_script_draft', methods=['POST'])
def generate_script_draft():
    """
    根据参考素材 + 配置流式生成文稿（SSE）。表单 output_mode：dialogue（默认，双人播客脚本）或 article（普通文章）。
    不合成语音、不生成封面。事件类型：
    - draft_script_chunk: { content }
    - draft_script_complete: { trace_id }
    - 其它与 generate_podcast 相同: log, url_parse_warning, error, progress
    """
    fail = auth_service.guard_feature_request(request)
    if fail is not None:
        err = fail[0].get_json(silent=True) or {}
        msg = err.get("error") or "鉴权失败"

        def err_gen():
            yield "data: " + json.dumps({"type": "error", "message": msg, "code": err.get("code")}) + "\n\n"

        return Response(err_gen(), mimetype="text/event-stream")
    session_id = str(uuid.uuid4())
    user_api_key = request.form.get("api_key", "").strip()
    if not user_api_key:
        def err_gen():
            yield "data: " + json.dumps({"type": "error", "message": "未提供 API Key"}) + "\n\n"

        return Response(err_gen(), mimetype="text/event-stream")

    text_input = request.form.get("text_input", "").strip()
    url_inputs = parse_url_inputs(request)
    raw_script_target_chars = request.form.get(
        "script_target_chars",
        str(PODCAST_CONFIG.get("script_target_chars_default", 200)),
    )
    script_target_chars = parse_script_target_chars(raw_script_target_chars)
    script_style = request.form.get("script_style", "轻松幽默，自然流畅").strip()
    script_language = request.form.get("script_language", "中文").strip()
    program_name = request.form.get("program_name", "MiniMax AI 播客节目").strip()
    speaker1_persona = request.form.get("speaker1_persona", "活泼亲切，引导话题").strip()
    speaker2_persona = request.form.get("speaker2_persona", "稳重专业，深度分析").strip()
    script_constraints = request.form.get(
        "script_constraints",
        "对话内容中不能包含（笑）（停顿）（思考）等动作、心理活动或场景描述，只生成纯对话文本。",
    ).strip()
    long_script_mode = (request.form.get("long_script_mode", "0") or "0").strip() in ("1", "true", "True", "yes", "on")
    output_mode = (request.form.get("output_mode", "dialogue") or "dialogue").strip().lower()
    if output_mode not in ("dialogue", "article"):
        output_mode = "dialogue"
    use_rag = (request.form.get("use_rag", "1") or "1").strip() in ("1", "true", "True", "yes", "on")
    rag_text_mode = (request.form.get("rag_text_mode", "0") or "0").strip() in ("1", "true", "True", "yes", "on")
    rag_text_chars_raw = str(request.form.get("rag_text_chars", "") or "").strip()
    rag_text_chars = None
    if rag_text_mode and rag_text_chars_raw:
        try:
            rag_text_chars_n = int(rag_text_chars_raw)
            if rag_text_chars_n > 0:
                rag_text_chars = rag_text_chars_n
        except Exception:
            rag_text_chars = None
    if long_script_mode:
        script_target_chars = parse_long_script_target_chars(raw_script_target_chars)
    selected_note_ids_raw = request.form.get("selected_note_ids", "[]").strip()

    try:
        selected_note_ids = json.loads(selected_note_ids_raw) if selected_note_ids_raw else []
        if not isinstance(selected_note_ids, list):
            selected_note_ids = []
        selected_note_ids = [str(i).strip() for i in selected_note_ids if str(i).strip()]
    except Exception:
        selected_note_ids = []

    uploaded_files = collect_uploaded_reference_files(request, session_id, prefix="draft")

    def generate():
        try:
            yield f"data: {json.dumps({'type': 'progress', 'step': 'parsing_content', 'message': '正在解析参考素材...'})}\n\n"

            merged, prelude_events, fatal = build_merged_ai_reference_for_script_draft(
                text_input,
                url_inputs,
                uploaded_files,
                selected_note_ids,
            )
            for ev in prelude_events:
                yield f"data: {json.dumps(ev)}\n\n"

            if fatal:
                yield f"data: {json.dumps({'type': 'error', 'message': fatal})}\n\n"
                return
            if merged is None:
                return

            # 长参考资料场景：自动启用轻量 RAG，降低上游报错并提升相关性
            effective_ref_chars = len(merged)
            if use_rag and rag_text_mode and rag_text_chars:
                effective_ref_chars = rag_text_chars

            if use_rag and effective_ref_chars >= RAG_TRIGGER_CHARS:
                merged, rag_log = apply_long_reference_strategy(
                    merged,
                    user_api_key,
                    text_input,
                    script_style,
                    script_language,
                    program_name,
                    speaker1_persona,
                    speaker2_persona,
                    script_constraints,
                )
                if rag_log:
                    yield f"data: {json.dumps({'type': 'log', 'message': rag_log})}\n\n"

            llm_msg = (
                "正在调用大模型生成文章…"
                if output_mode == "article"
                else "正在调用大模型生成播客文案…"
            )
            yield f"data: {json.dumps({'type': 'progress', 'step': 'llm_script', 'message': llm_msg})}\n\n"

            for draft_event in stream_script_draft_generation_events(
                merged,
                script_target_chars,
                user_api_key,
                script_style,
                script_language,
                program_name,
                speaker1_persona,
                speaker2_persona,
                script_constraints,
                long_script_mode=long_script_mode,
                output_mode=output_mode,
            ):
                yield f"data: {json.dumps(draft_event)}\n\n"
                if draft_event.get("type") == "error":
                    return
        except Exception as e:
            logger.exception("generate_script_draft 失败")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            for f in uploaded_files:
                fpath = f.get("path")
                if fpath and os.path.exists(fpath):
                    try:
                        os.remove(fpath)
                    except OSError:
                        pass

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route('/api/generate_podcast', methods=['POST'])
def generate_podcast():
    """
    生成播客接口（SSE 流式响应）

    请求参数:
    - text_input: 文本输入（可选）
    - url: 网址输入（可选）
    - pdf_file: 参考文件（pdf/doc/docx/epub/txt/md，可选）
    - speaker1_type: "default" 或 "custom"
    - speaker1_voice_name: "mini" 或 "max"（default 时）
    - speaker1_audio: 音频文件（custom 时）
    - speaker2_type: "default" 或 "custom"
    - speaker2_voice_name: "mini" 或 "max"（default 时）
    - speaker2_audio: 音频文件（custom 时）
    """
    fail = auth_service.guard_feature_request(request)
    if fail is not None:
        err = fail[0].get_json(silent=True) or {}
        msg = err.get("error") or "鉴权失败"

        def auth_err_gen():
            yield "data: " + json.dumps({"type": "error", "message": msg, "code": err.get("code")}) + "\n\n"

        return Response(auth_err_gen(), mimetype="text/event-stream")
    # 在请求上下文中提取所有数据
    session_id = str(uuid.uuid4())
    logger.info(f"开始生成播客，Session ID: {session_id}")

    # 提取 API Key
    user_api_key = request.form.get('api_key', '').strip()
    if not user_api_key:
        def error_gen():
            yield "data: " + json.dumps({
                "type": "error",
                "message": "未提供 API Key"
            }) + "\n\n"
        return Response(error_gen(), mimetype='text/event-stream')

    # 提取表单数据
    text_input = request.form.get('text_input', '').strip()
    url_inputs = parse_url_inputs(request)
    script_mode = (request.form.get('script_mode', 'ai') or 'ai').strip().lower()
    cover_mode = (request.form.get('cover_mode', 'ai') or 'ai').strip().lower()
    manual_script = request.form.get('manual_script', '')
    manual_cover_text = request.form.get('manual_cover_text', '').strip()
    script_target_chars = parse_script_target_chars(
        request.form.get(
            'script_target_chars',
            str(PODCAST_CONFIG.get("script_target_chars_default", 200)),
        )
    )
    script_style = request.form.get('script_style', '轻松幽默，自然流畅').strip()
    script_language = request.form.get('script_language', '中文').strip()
    program_name = request.form.get('program_name', 'MiniMax AI 播客节目').strip()
    speaker1_persona = request.form.get('speaker1_persona', '活泼亲切，引导话题').strip()
    speaker2_persona = request.form.get('speaker2_persona', '稳重专业，深度分析').strip()
    script_constraints = request.form.get('script_constraints', '对话内容中不能包含（笑）（停顿）（思考）等动作、心理活动或场景描述，只生成纯对话文本。').strip()
    use_rag = (request.form.get("use_rag", "1") or "1").strip() in ("1", "true", "True", "yes", "on")
    rag_text_mode = (request.form.get("rag_text_mode", "0") or "0").strip() in ("1", "true", "True", "yes", "on")
    rag_text_chars_raw = str(request.form.get("rag_text_chars", "") or "").strip()
    rag_text_chars = None
    if rag_text_mode and rag_text_chars_raw:
        try:
            rag_text_chars_n = int(rag_text_chars_raw)
            if rag_text_chars_n > 0:
                rag_text_chars = rag_text_chars_n
        except Exception:
            rag_text_chars = None
    selected_note_ids_raw = request.form.get('selected_note_ids', '[]').strip()

    try:
        selected_note_ids = json.loads(selected_note_ids_raw) if selected_note_ids_raw else []
        if not isinstance(selected_note_ids, list):
            selected_note_ids = []
        selected_note_ids = [str(i).strip() for i in selected_note_ids if str(i).strip()]
    except Exception:
        selected_note_ids = []

    # 提取上传文件（用于 AI 参考材料，支持多文件）
    uploaded_files = collect_uploaded_reference_files(request, session_id, prefix="podcast")

    # 提取手工封面文件（可选）
    manual_cover_path = None
    manual_cover_filename = None
    if cover_mode == 'manual' and 'manual_cover_file' in request.files:
        cover_file_obj = request.files['manual_cover_file']
        if cover_file_obj and cover_file_obj.filename and allowed_file(cover_file_obj.filename, ALLOWED_IMAGE_EXTENSIONS):
            cover_filename = secure_filename(cover_file_obj.filename)
            manual_cover_filename = f"cover_{session_id}_{int(time.time())}_{cover_filename}"
            manual_cover_path = os.path.join(OUTPUT_DIR, manual_cover_filename)
            cover_file_obj.save(manual_cover_path)

    # 提取音色配置
    speaker1_type = request.form.get('speaker1_type', 'default')
    speaker1_voice_name = request.form.get('speaker1_voice_name', 'mini')
    speaker1_custom_voice_id = request.form.get('speaker1_custom_voice_id', '').strip()
    speaker1_audio_path = None
    if speaker1_type == 'custom' and 'speaker1_audio' in request.files:
        audio_file = request.files['speaker1_audio']
        if audio_file and allowed_file(audio_file.filename, ALLOWED_AUDIO_EXTENSIONS):
            filename = secure_filename(audio_file.filename)
            speaker1_audio_path = os.path.join(UPLOAD_DIR, f"{session_id}_speaker1_{filename}")
            audio_file.save(speaker1_audio_path)

    speaker2_type = request.form.get('speaker2_type', 'default')
    speaker2_voice_name = request.form.get('speaker2_voice_name', 'max')
    speaker2_custom_voice_id = request.form.get('speaker2_custom_voice_id', '').strip()
    speaker2_audio_path = None
    if speaker2_type == 'custom' and 'speaker2_audio' in request.files:
        audio_file = request.files['speaker2_audio']
        if audio_file and allowed_file(audio_file.filename, ALLOWED_AUDIO_EXTENSIONS):
            filename = secure_filename(audio_file.filename)
            speaker2_audio_path = os.path.join(UPLOAD_DIR, f"{session_id}_speaker2_{filename}")
            audio_file.save(speaker2_audio_path)

    # 开场/结尾配置
    intro_text_raw = request.form.get('intro_text')
    intro_text = intro_text_raw.strip() if isinstance(intro_text_raw, str) else None
    intro_voice_mode = (request.form.get('intro_voice_mode', 'default') or 'default').strip().lower()
    intro_voice_name = (request.form.get('intro_voice_name', 'max') or 'max').strip().lower()
    intro_custom_voice_id = request.form.get('intro_custom_voice_id', '').strip()

    ending_text = request.form.get('ending_text', '').strip()
    ending_voice_mode = (request.form.get('ending_voice_mode', 'default') or 'default').strip().lower()
    ending_voice_name = (request.form.get('ending_voice_name', 'max') or 'max').strip().lower()
    ending_custom_voice_id = request.form.get('ending_custom_voice_id', '').strip()

    intro_bgm1_mode = (request.form.get('intro_bgm1_mode', 'default') or 'default').strip().lower()
    intro_bgm2_mode = (request.form.get('intro_bgm2_mode', 'default') or 'default').strip().lower()
    intro_bgm1_saved_id = request.form.get('intro_bgm1_saved_id', '').strip()
    intro_bgm2_saved_id = request.form.get('intro_bgm2_saved_id', '').strip()
    ending_bgm1_mode = (request.form.get('ending_bgm1_mode', 'default') or 'default').strip().lower()
    ending_bgm2_mode = (request.form.get('ending_bgm2_mode', 'default') or 'default').strip().lower()
    ending_bgm1_saved_id = request.form.get('ending_bgm1_saved_id', '').strip()
    ending_bgm2_saved_id = request.form.get('ending_bgm2_saved_id', '').strip()
    intro_bgm1_file_obj = request.files.get('intro_bgm1_file')
    intro_bgm2_file_obj = request.files.get('intro_bgm2_file')
    ending_bgm1_file_obj = request.files.get('ending_bgm1_file')
    ending_bgm2_file_obj = request.files.get('ending_bgm2_file')

    # 在请求上下文有效时，预先解析/保存 BGM 路径，避免 SSE 生成阶段访问已关闭的上传流
    intro_bgm01_path, intro_bgm01_err = resolve_bgm_path(
        intro_bgm1_mode,
        intro_bgm1_saved_id,
        intro_bgm1_file_obj,
        session_id,
        "背景音1",
        "bgm01"
    )
    if intro_bgm01_err:
        return jsonify({"success": False, "error": intro_bgm01_err}), 400

    intro_bgm02_path, intro_bgm02_err = resolve_bgm_path(
        intro_bgm2_mode,
        intro_bgm2_saved_id,
        intro_bgm2_file_obj,
        session_id,
        "背景音2",
        "bgm02"
    )
    if intro_bgm02_err:
        return jsonify({"success": False, "error": intro_bgm02_err}), 400

    ending_bgm01_path, ending_bgm01_err = resolve_bgm_path(
        ending_bgm1_mode,
        ending_bgm1_saved_id,
        ending_bgm1_file_obj,
        session_id,
        "结尾背景音1",
        "bgm01"
    )
    if ending_bgm01_err:
        return jsonify({"success": False, "error": ending_bgm01_err}), 400

    ending_bgm02_path, ending_bgm02_err = resolve_bgm_path(
        ending_bgm2_mode,
        ending_bgm2_saved_id,
        ending_bgm2_file_obj,
        session_id,
        "结尾背景音2",
        "bgm02"
    )
    if ending_bgm02_err:
        return jsonify({"success": False, "error": ending_bgm02_err}), 400

    def generate():
        """SSE 生成器"""
        try:
            # Step 1: 解析输入内容（手工脚本模式允许跳过）
            yield f"data: {json.dumps({'type': 'progress', 'step': 'parsing_content', 'message': '正在解析输入内容...'})}\n\n"

            # 处理上传文件（pdf/doc/docx/epub/txt/md，支持多文件）
            pdf_parts = []
            for f in uploaded_files:
                fpath = f.get("path")
                fext = f.get("ext")
                fname = f.get("name") or os.path.basename(fpath or "")
                if not fpath:
                    continue
                yield f"data: {json.dumps({'type': 'log', 'message': f'已上传文件: {fname}'})}\n\n"
                parsed = parse_note_file_content(fpath, fext)
                if parsed and parsed.strip():
                    pdf_parts.append(parsed.strip())
                    yield f"data: {json.dumps({'type': 'log', 'message': f'文件解析完成（{fname}），共 {len(parsed)} 字符'})}\n\n"
                else:
                    if fext == "doc":
                        doc_hint = build_doc_parse_tool_hint()
                        yield f"data: {json.dumps({'type': 'log', 'message': f'DOC 文件 {fname} 已保存，但未提取到正文。{doc_hint}'})}\n\n"
                    else:
                        yield f"data: {json.dumps({'type': 'error', 'message': f'上传文件解析失败：{fname}，请更换为可解析格式'})}\n\n"
                        return
            pdf_content = "\n\n".join(pdf_parts)

            # 解析网址（如果提供）
            url_parts = []
            for u in (url_inputs or []):
                yield f"data: {json.dumps({'type': 'log', 'message': f'开始解析网址: {u}'})}\n\n"

                url_result = content_parser.parse_url(u)
                if url_result["success"]:
                    part = url_result.get("content", "")
                    if part:
                        url_parts.append(part)
                    for log in url_result.get("logs") or []:
                        yield f"data: {json.dumps({'type': 'log', 'message': log})}\n\n"
                else:
                    # 发送友好的错误提示，但不中断流程
                    error_code = url_result.get('error_code', 'unknown')
                    yield f"data: {json.dumps({'type': 'url_parse_warning', 'message': url_result['error'], 'error_code': error_code})}\n\n"
                    for log in url_result.get("logs") or []:
                        yield f"data: {json.dumps({'type': 'log', 'message': log})}\n\n"
                    # 不返回，继续处理其他输入内容
            url_content = "\n\n".join([p for p in url_parts if p and p.strip()])

            # 合并所有内容
            merged_content = content_parser.merge_contents(text_input, url_content, pdf_content)

            # 合并选中的服务端笔记内容（AI 参考）
            notes_content = []
            if selected_note_ids:
                with note_store_lock:
                    all_notes = load_saved_notes()
                note_map = {n.get("noteId"): n for n in all_notes}
                for note_id in selected_note_ids:
                    note_item = note_map.get(note_id)
                    if not note_item:
                        continue
                    file_name = note_item.get("fileName")
                    ext = note_item.get("ext")
                    note_title = note_item.get("title") or note_id
                    if not file_name:
                        continue
                    file_path = os.path.join(NOTE_DIR, file_name)
                    if not os.path.exists(file_path):
                        continue
                    content = parse_note_file_content(file_path, ext)
                    if content and content.strip():
                        notes_content.append(f"【笔记：{note_title}】\n{content.strip()}")
                if notes_content:
                    merged_content = (merged_content + "\n\n" if merged_content else "") + "\n\n".join(notes_content)
                    yield f"data: {json.dumps({'type': 'log', 'message': f'已附加 {len(notes_content)} 份勾选笔记内容'})}\n\n"

            # 手工脚本模式：允许不提供文本/网址/文件
            if script_mode == "manual":
                if not manual_script or not manual_script.strip():
                    yield f"data: {json.dumps({'type': 'error', 'message': '用户加工模式下未提供手工脚本'})}\n\n"
                    return
                if not merged_content or merged_content == "没有可用的内容":
                    merged_content = "【用户加工模式】\n用户未提供文本/网址/文件，仅使用手工脚本进行播客生成。"

            if not merged_content or merged_content == "没有可用的内容":
                yield f"data: {json.dumps({'type': 'error', 'message': '请至少提供一种可用参考内容（文本/网址/可解析文件/知识库勾选笔记）'})}\n\n"
                return

            effective_ref_chars = len(merged_content)
            if use_rag and rag_text_mode and rag_text_chars:
                effective_ref_chars = rag_text_chars

            if use_rag and script_mode != "manual" and effective_ref_chars >= RAG_TRIGGER_CHARS:
                merged_content, rag_log = apply_long_reference_strategy(
                    merged_content,
                    user_api_key,
                    text_input,
                    script_style,
                    script_language,
                    program_name,
                    speaker1_persona,
                    speaker2_persona,
                    script_constraints,
                )
                if rag_log:
                    yield f"data: {json.dumps({'type': 'log', 'message': rag_log})}\n\n"

            yield f"data: {json.dumps({'type': 'log', 'message': f'内容解析完成，共 {len(merged_content)} 字符'})}\n\n"

            # Step 2: 准备音色
            yield f"data: {json.dumps({'type': 'progress', 'step': 'preparing_voices', 'message': '正在准备音色...'})}\n\n"

            # Speaker1 配置
            speaker1_config = {"type": speaker1_type}

            if speaker1_type == 'default':
                speaker1_config["voice_name"] = speaker1_voice_name
            elif speaker1_type == 'custom':
                if speaker1_custom_voice_id:
                    speaker1_config["voice_id"] = speaker1_custom_voice_id
                    yield f"data: {json.dumps({'type': 'log', 'message': 'Speaker1 使用已保存自定义音色ID'})}\n\n"
                elif speaker1_audio_path:
                    speaker1_config["audio_file"] = speaker1_audio_path
                    yield f"data: {json.dumps({'type': 'log', 'message': 'Speaker1 音频已上传'})}\n\n"
                else:
                    yield f"data: {json.dumps({'type': 'error', 'message': 'Speaker1 选择自定义音色但未提供音频文件或音色ID'})}\n\n"
                    return

            # Speaker2 配置
            speaker2_config = {"type": speaker2_type}

            if speaker2_type == 'default':
                speaker2_config["voice_name"] = speaker2_voice_name
            elif speaker2_type == 'custom':
                if speaker2_custom_voice_id:
                    speaker2_config["voice_id"] = speaker2_custom_voice_id
                    yield f"data: {json.dumps({'type': 'log', 'message': 'Speaker2 使用已保存自定义音色ID'})}\n\n"
                elif speaker2_audio_path:
                    speaker2_config["audio_file"] = speaker2_audio_path
                    yield f"data: {json.dumps({'type': 'log', 'message': 'Speaker2 音频已上传'})}\n\n"
                else:
                    yield f"data: {json.dumps({'type': 'error', 'message': 'Speaker2 选择自定义音色但未提供音频文件或音色ID'})}\n\n"
                    return

            # 准备音色（可能涉及克隆）
            voices_result = voice_manager.prepare_voices(speaker1_config, speaker2_config, api_key=user_api_key)

            if not voices_result["success"]:
                yield f"data: {json.dumps({'type': 'error', 'message': voices_result['error']})}\n\n"
                return

            # 发送音色准备日志
            for log in voices_result["logs"]:
                yield f"data: {json.dumps({'type': 'log', 'message': log})}\n\n"

            # 发送音色克隆的 Trace ID
            for key, trace_id in voices_result.get("trace_ids", {}).items():
                if trace_id:
                    yield f"data: {json.dumps({'type': 'trace_id', 'api': key, 'trace_id': trace_id})}\n\n"

            speaker1_voice_id = voices_result["speaker1"]
            speaker2_voice_id = voices_result["speaker2"]
            speaker1_source = voices_result.get("speaker1_source", "default")
            speaker2_source = voices_result.get("speaker2_source", "default")

            intro_voice_id = None
            if intro_voice_mode == 'speaker1':
                intro_voice_id = speaker1_voice_id
            elif intro_voice_mode == 'speaker2':
                intro_voice_id = speaker2_voice_id
            elif intro_voice_mode == 'custom':
                intro_voice_id = intro_custom_voice_id or None

            ending_voice_id = None
            if ending_voice_mode == 'speaker1':
                ending_voice_id = speaker1_voice_id
            elif ending_voice_mode == 'speaker2':
                ending_voice_id = speaker2_voice_id
            elif ending_voice_mode == 'custom':
                ending_voice_id = ending_custom_voice_id or None

            # 服务端持久化：记录使用过的自定义音色ID
            if speaker1_source in ("custom_cloned", "custom_saved"):
                upsert_saved_voice(speaker1_voice_id, "speaker1")
            if speaker2_source in ("custom_cloned", "custom_saved"):
                upsert_saved_voice(speaker2_voice_id, "speaker2")

            # 返回最终生效的音色ID，便于前端缓存“可选择的自定义音色”
            yield f"data: {json.dumps({'type': 'voice_ready', 'speaker': 'speaker1', 'voice_id': speaker1_voice_id, 'source': speaker1_source})}\n\n"
            yield f"data: {json.dumps({'type': 'voice_ready', 'speaker': 'speaker2', 'voice_id': speaker2_voice_id, 'source': speaker2_source})}\n\n"

            # Step 3: 流式生成播客
            for event in podcast_generator.generate_podcast_stream(
                content=merged_content,
                speaker1_voice_id=speaker1_voice_id,
                speaker2_voice_id=speaker2_voice_id,
                session_id=session_id,
                api_key=user_api_key,
                use_speaker1_for_welcome=(speaker1_type == 'custom'),
                intro_text=intro_text,
                intro_voice_id=intro_voice_id,
                intro_voice_name=intro_voice_name,
                ending_text=ending_text,
                ending_voice_id=ending_voice_id,
                ending_voice_name=ending_voice_name,
                bgm01_path=intro_bgm01_path,
                bgm02_path=intro_bgm02_path,
                ending_bgm01_path=ending_bgm01_path,
                ending_bgm02_path=ending_bgm02_path,
                script_mode=script_mode,
                manual_script=manual_script,
                script_target_chars=script_target_chars,
                script_style=script_style,
                script_language=script_language,
                program_name=program_name,
                speaker1_persona=speaker1_persona,
                speaker2_persona=speaker2_persona,
                script_constraints=script_constraints,
                cover_mode=cover_mode,
                manual_cover_text=manual_cover_text,
                manual_cover_filename=manual_cover_filename
            ):
                yield f"data: {json.dumps(event)}\n\n"

        except Exception as e:
            logger.error(f"播客生成失败: {str(e)}", exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'message': f'播客生成失败: {str(e)}'})}\n\n"
        finally:
            for f in uploaded_files:
                fpath = f.get("path")
                if fpath and os.path.exists(fpath):
                    try:
                        os.remove(fpath)
                    except OSError:
                        pass

    return Response(generate(), mimetype='text/event-stream')


@app.route('/api/upload_audio', methods=['POST'])
def upload_audio():
    """
    上传音频文件接口（用于录音功能）
    """
    try:
        if 'audio' not in request.files:
            return jsonify({"success": False, "error": "未提供音频文件"})

        audio_file = request.files['audio']
        if not audio_file:
            return jsonify({"success": False, "error": "音频文件为空"})

        # 生成文件名
        session_id = request.form.get('session_id', str(uuid.uuid4()))
        speaker = request.form.get('speaker', 'unknown')
        filename = f"{session_id}_{speaker}_{int(time.time())}.wav"
        file_path = os.path.join(UPLOAD_DIR, filename)

        audio_file.save(file_path)

        return jsonify({
            "success": True,
            "filename": filename,
            "path": file_path
        })

    except Exception as e:
        logger.error(f"音频上传失败: {str(e)}")
        return jsonify({"success": False, "error": str(e)})


@app.route('/download/audio/<filename>', methods=['GET'])
def download_audio(filename):
    """下载音频文件"""
    try:
        return send_from_directory(OUTPUT_DIR, filename, as_attachment=True)
    except Exception as e:
        logger.error(f"下载音频失败: {str(e)}")
        return jsonify({"error": str(e)}), 404


@app.route('/download/script/<filename>', methods=['GET'])
def download_script(filename):
    """下载脚本文件"""
    try:
        return send_from_directory(OUTPUT_DIR, filename, as_attachment=True)
    except Exception as e:
        logger.error(f"下载脚本失败: {str(e)}")
        return jsonify({"error": str(e)}), 404


@app.route('/download/cover', methods=['GET'])
def download_cover():
    """下载封面图片（从OSS代理下载）"""
    try:
        import requests
        cover_url = request.args.get('url')
        if not cover_url:
            return jsonify({"error": "未提供封面URL"}), 400

        # 从 OSS 获取图片
        response = requests.get(cover_url, timeout=30)
        response.raise_for_status()

        # 生成文件名
        import time
        filename = f"podcast_cover_{int(time.time())}.jpg"

        # 返回图片数据；inline 便于前端 <img> 展示，attachment 会导致部分浏览器不内联显示
        from flask import make_response
        ct = (response.headers.get('Content-Type') or '').split(';')[0].strip() or 'image/jpeg'
        if not ct.startswith('image/'):
            ct = 'image/jpeg'
        resp = make_response(response.content)
        resp.headers['Content-Type'] = ct
        resp.headers['Content-Disposition'] = f'inline; filename="{filename}"'
        return resp

    except Exception as e:
        logger.error(f"下载封面失败: {str(e)}")
        return jsonify({"error": str(e)}), 500


@app.route('/download/cover_file/<filename>', methods=['GET'])
def download_cover_file(filename):
    """下载本地封面图片文件（手工封面模式）"""
    try:
        return send_from_directory(OUTPUT_DIR, filename, as_attachment=True)
    except Exception as e:
        logger.error(f"下载本地封面失败: {str(e)}")
        return jsonify({"error": str(e)}), 404


@app.route('/download/custom_bgm/<filename>', methods=['GET'])
def download_custom_bgm(filename):
    """访问已保存的自定义 BGM 文件"""
    try:
        return send_from_directory(CUSTOM_BGM_DIR, filename, as_attachment=False)
    except Exception as e:
        logger.error(f"下载自定义BGM失败: {str(e)}")
        return jsonify({"error": str(e)}), 404


@app.route('/download/note/<filename>', methods=['GET'])
def download_note(filename):
    """下载本地笔记文件"""
    try:
        return send_from_directory(NOTE_DIR, filename, as_attachment=True)
    except Exception as e:
        logger.error(f"下载笔记失败: {str(e)}")
        return jsonify({"error": str(e)}), 404

@app.route('/static/<path:filename>')
def serve_static(filename):
    """提供静态文件（BGM等）"""
    # 简化 BGM 访问
    if filename == 'bgm01.wav':
        return send_file(BGM_FILES["bgm01"])
    elif filename == 'bgm02.wav':
        return send_file(BGM_FILES["bgm02"])
    return jsonify({"error": "File not found"}), 404


if __name__ == '__main__':
    logger.info("=" * 50)
    logger.info("🎙️  MiniMax AI 播客生成服务启动")
    logger.info(f"📁 上传目录: {UPLOAD_DIR}")
    logger.info(f"📁 输出目录: {OUTPUT_DIR}")
    logger.info("=" * 50)
    # 生产环境关闭 debug 模式，避免自动重启导致 SSE 连接中断
    app.run(debug=False, host='0.0.0.0', port=5001, threaded=True)
