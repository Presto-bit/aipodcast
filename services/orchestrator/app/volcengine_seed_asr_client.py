"""火山 / 豆包「大模型录音文件识别 2.0」（Seed-ASR，异步 submit + query）。"""

from __future__ import annotations

import base64
import json
import logging
import os
import time
import uuid
from typing import Any

import requests

logger = logging.getLogger(__name__)


def _strip_env_secret(raw: str | None) -> str:
    """去掉首尾空白；若整段被一对引号包裹则去掉（.env 里常见误加引号导致鉴权失败）。"""
    t = (raw or "").strip()
    if len(t) >= 2 and t[0] == t[-1] and t[0] in "\"'":
        t = t[1:-1].strip()
    return t


SUBMIT_URL_DEFAULT = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit"
QUERY_URL_DEFAULT = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/query"
RESOURCE_ID_DEFAULT = "volc.seedasr.auc"

# 与官方文档及社区示例一致：排队 / 处理中需继续轮询
_PENDING_STATUS = frozenset({"20000001", "20000002"})
_SUCCESS = "20000000"


def _infer_audio_format_from_url(url: str) -> str:
    """从 URL 路径推断 format；预签名 URL 常无扩展名，需结合文件名 / MIME / 环境变量。"""
    path = (url or "").split("?", 1)[0].rstrip("/").lower()
    for suf in (".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".webm", ".wma"):
        if path.endswith(suf):
            return suf.removeprefix(".")
    return "mp3"


def _resolve_seed_audio_format(*, file_url: str, filename: str | None, mime: str | None) -> str:
    forced = _strip_env_secret(os.getenv("VOLCENGINE_SEED_AUDIO_FORMAT") or "")
    if forced:
        return forced.lower()
    fn = (filename or "").strip().lower()
    for suf in (".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".webm", ".wma"):
        if fn.endswith(suf):
            return suf.removeprefix(".")
    m = (mime or "").strip().lower()
    if "wav" in m:
        return "wav"
    if "mpeg" in m or "mp3" in m:
        return "mp3"
    if "mp4" in m or "m4a" in m or "aac" in m:
        return "m4a"
    if "ogg" in m or "opus" in m:
        return "ogg"
    if "flac" in m:
        return "flac"
    if "webm" in m:
        return "webm"
    return _infer_audio_format_from_url(file_url)


def _volc_seed_env() -> dict[str, Any]:
    api_key = _strip_env_secret(
        os.getenv("VOLCENGINE_SPEECH_API_KEY") or os.getenv("VOLCENGINE_OPENSPEECH_API_KEY") or ""
    )
    app_key = _strip_env_secret(os.getenv("VOLCENGINE_SPEECH_APP_KEY") or "")
    access_key = _strip_env_secret(
        os.getenv("VOLCENGINE_SPEECH_ACCESS_KEY") or os.getenv("VOLCENGINE_SPEECH_ACCESS_TOKEN") or ""
    )
    return {
        "api_key": api_key,
        "app_key": app_key,
        "access_key": access_key,
        "uid": _strip_env_secret(
            os.getenv("VOLCENGINE_SPEECH_UID") or os.getenv("VOLCENGINE_SPEECH_API_KEY") or api_key or ""
        ),
        "submit_url": (os.getenv("VOLCENGINE_SPEECH_SUBMIT_URL") or SUBMIT_URL_DEFAULT).strip(),
        "query_url": (os.getenv("VOLCENGINE_SPEECH_QUERY_URL") or QUERY_URL_DEFAULT).strip(),
        "resource_id": (os.getenv("VOLCENGINE_SEED_ASR_RESOURCE_ID") or RESOURCE_ID_DEFAULT).strip(),
        "submit_timeout_sec": max(30.0, float(os.getenv("VOLCENGINE_SEED_SUBMIT_TIMEOUT_SEC") or "120")),
        "query_timeout_sec": max(30.0, float(os.getenv("VOLCENGINE_SEED_QUERY_TIMEOUT_SEC") or "120")),
        "poll_interval_sec": max(0.5, float(os.getenv("VOLCENGINE_SEED_POLL_INTERVAL_SEC") or "2")),
        "poll_max_sec": max(60.0, float(os.getenv("VOLCENGINE_SEED_POLL_MAX_SEC") or str(2 * 3600))),
    }


def _headers(
    *,
    api_key: str,
    app_key: str,
    access_key: str,
    resource_id: str,
    request_id: str,
    logid: str | None,
) -> dict[str, str]:
    """
    新控制台：X-Api-Key。
    旧控制台（FAQ 中的 appid + access token）：X-Api-App-Key + X-Api-Access-Key，勿再传 X-Api-Key。
    """
    h: dict[str, str] = {
        "Content-Type": "application/json",
        "X-Api-Resource-Id": resource_id,
        "X-Api-Request-Id": request_id,
        "X-Api-Sequence": "-1",
    }
    if app_key and access_key:
        h["X-Api-App-Key"] = app_key
        h["X-Api-Access-Key"] = access_key
    elif api_key:
        h["X-Api-Key"] = api_key
    if logid:
        h["X-Tt-Logid"] = logid
    return h


def _volc_seed_submit(
    *,
    uid: str,
    api_key: str,
    app_key: str,
    access_key: str,
    resource_id: str,
    submit_url: str,
    timeout_sec: float,
    diarization_enabled: bool,
    channel_split: bool,
    audio_format: str,
    audio_url: str | None = None,
    audio_data_b64: str | None = None,
) -> tuple[str, str | None]:
    """返回 (task_id, x_tt_logid)。task_id 即请求头中的 X-Api-Request-Id。"""
    task_id = str(uuid.uuid4())
    u = (audio_url or "").strip()
    if audio_data_b64:
        audio_obj: dict[str, Any] = {"data": audio_data_b64, "format": audio_format}
        audio_mode = "inline"
    elif u:
        audio_obj = {"url": u, "format": audio_format}
        audio_mode = "url"
    else:
        raise RuntimeError("豆包 submit：需提供 audio_url 或内联 audio_data_b64")
    body: dict[str, Any] = {
        "user": {"uid": str(uid)},
        "audio": audio_obj,
        "request": {
            "model_name": "bigmodel",
            "show_utterances": True,
            "enable_itn": True,
            "enable_punc": True,
            "enable_ddc": True,
            "enable_speaker_info": bool(diarization_enabled),
            "enable_channel_split": bool(channel_split),
        },
    }
    headers = _headers(
        api_key=api_key,
        app_key=app_key,
        access_key=access_key,
        resource_id=resource_id,
        request_id=task_id,
        logid=None,
    )
    r = requests.post(submit_url, headers=headers, data=json.dumps(body), timeout=timeout_sec)
    st = (r.headers.get("X-Api-Status-Code") or r.headers.get("x-api-status-code") or "").strip()
    msg = (r.headers.get("X-Api-Message") or r.headers.get("x-api-message") or "").strip()
    logid = (r.headers.get("X-Tt-Logid") or r.headers.get("x-tt-logid") or "").strip() or None
    logger.info(
        "volc_seed_submit status=%s message=%s logid=%s http=%s audio.mode=%s audio.format=%s",
        st,
        msg[:200],
        (logid or "")[:80],
        r.status_code,
        audio_mode,
        audio_format,
    )
    if r.status_code != 200:
        raw = (r.text or "")[:800]
        hint = ""
        try:
            errj = r.json()
            hdr = errj.get("header") if isinstance(errj, dict) else None
            if isinstance(hdr, dict) and str(hdr.get("code") or "") == "45000010":
                hint = (
                    "（请确认：1）豆包语音控制台创建的「API Key」写入 VOLCENGINE_SPEECH_API_KEY，"
                    "勿用方舟/通用 AK、SK 或其它产品密钥；"
                    "2）若控制台仅提供 appid + access token，请改设 VOLCENGINE_SPEECH_APP_KEY 与 VOLCENGINE_SPEECH_ACCESS_KEY，"
                    "并清空错误的 X-Api-Key 单密钥配置。）"
                )
        except Exception:
            pass
        raise RuntimeError(f"豆包录音识别 submit HTTP {r.status_code}: {raw}{hint}")
    if st != _SUCCESS:
        detail = ""
        try:
            payload = r.json()
            if isinstance(payload, dict):
                detail = str(payload.get("message") or payload.get("result") or "")[:400]
        except Exception:
            pass
        hint = ""
        if st == "45000006":
            hint = (
                "（常见原因：1）audio.format 与真实文件不符或 URL 无法被豆包公网拉取，请确认 OBJECT_PRESIGN_ENDPOINT 为公网 HTTPS；"
                "2）音频格式不在支持列表。）"
            )
        raise RuntimeError(f"豆包录音识别 submit 失败 X-Api-Status-Code={st} X-Api-Message={msg} {detail}{hint}".strip())
    return task_id, logid


def _volc_seed_query_once(
    *,
    task_id: str,
    logid: str | None,
    api_key: str,
    app_key: str,
    access_key: str,
    resource_id: str,
    query_url: str,
    timeout_sec: float,
) -> tuple[str, dict[str, Any] | None, str | None, str]:
    """返回 (X-Api-Status-Code, json_body 若可解析 else None, 更新后的 X-Tt-Logid, X-Api-Message)。"""
    headers = _headers(
        api_key=api_key,
        app_key=app_key,
        access_key=access_key,
        resource_id=resource_id,
        request_id=task_id,
        logid=logid,
    )
    r = requests.post(query_url, headers=headers, data=json.dumps({}), timeout=timeout_sec)
    st = (r.headers.get("X-Api-Status-Code") or r.headers.get("x-api-status-code") or "").strip()
    msg = (r.headers.get("X-Api-Message") or r.headers.get("x-api-message") or "").strip()
    new_log = (r.headers.get("X-Tt-Logid") or r.headers.get("x-tt-logid") or "").strip()
    next_logid = new_log if new_log else logid
    logger.info(
        "volc_seed_query status=%s message=%s http=%s",
        st,
        msg[:200],
        r.status_code,
    )
    if r.status_code != 200:
        raw = (r.text or "")[:800]
        raise RuntimeError(f"豆包录音识别 query HTTP {r.status_code}: {raw}")
    data: dict[str, Any] | None = None
    try:
        j = r.json()
        if isinstance(j, dict):
            data = j
    except Exception:
        data = None
    return st, data, next_logid, msg


def volc_seed_recognize_url_wait(
    *,
    file_url: str = "",
    audio_bytes: bytes | None = None,
    diarization_enabled: bool = True,
    channel_ids: list[int] | None = None,
    audio_filename: str | None = None,
    audio_mime: str | None = None,
) -> dict[str, Any]:
    """
    提交音频异步任务并轮询 query，返回与极速版类似的 JSON 体（含 audio_info / result）。

    二选一：
    - ``audio_bytes``：内联 Base64（``audio.data``），适用于对象存储仅内网可达、豆包无法拉预签名 URL 的场景；
    - ``file_url``：公网可下载的音频 URL（``audio.url``）。

    鉴权二选一：
    - 新控制台：VOLCENGINE_SPEECH_API_KEY（或别名 VOLCENGINE_OPENSPEECH_API_KEY）
    - 旧控制台：VOLCENGINE_SPEECH_APP_KEY + VOLCENGINE_SPEECH_ACCESS_KEY（或 ACCESS_TOKEN）
    可选 VOLCENGINE_SEED_ASR_RESOURCE_ID（默认 volc.seedasr.auc）。
    """
    cfg = _volc_seed_env()
    has_single = bool(cfg["api_key"])
    has_pair = bool(cfg["app_key"] and cfg["access_key"])
    if not has_single and not has_pair:
        raise RuntimeError(
            "未配置豆包语音鉴权：请设置 VOLCENGINE_SPEECH_API_KEY（新控制台 API Key），"
            "或同时设置 VOLCENGINE_SPEECH_APP_KEY 与 VOLCENGINE_SPEECH_ACCESS_KEY（旧控制台）"
        )
    uid = (cfg["uid"] or cfg["api_key"]).strip()
    ch = channel_ids if isinstance(channel_ids, list) and len(channel_ids) >= 2 else []
    channel_split = len(ch) >= 2
    u = (file_url or "").strip()
    inline = audio_bytes if isinstance(audio_bytes, (bytes, bytearray)) and len(audio_bytes) > 0 else None
    if inline is not None:
        audio_format = _resolve_seed_audio_format(file_url=u, filename=audio_filename, mime=audio_mime)
        b64 = base64.b64encode(bytes(inline)).decode("ascii")
        task_id, logid = _volc_seed_submit(
            uid=uid,
            api_key=cfg["api_key"],
            app_key=cfg["app_key"],
            access_key=cfg["access_key"],
            resource_id=cfg["resource_id"],
            submit_url=cfg["submit_url"],
            timeout_sec=float(cfg["submit_timeout_sec"]),
            diarization_enabled=diarization_enabled,
            channel_split=channel_split,
            audio_format=audio_format,
            audio_url=None,
            audio_data_b64=b64,
        )
    else:
        if not u:
            raise RuntimeError("file_url 为空且未提供 audio_bytes")
        audio_format = _resolve_seed_audio_format(file_url=u, filename=audio_filename, mime=audio_mime)
        task_id, logid = _volc_seed_submit(
            uid=uid,
            api_key=cfg["api_key"],
            app_key=cfg["app_key"],
            access_key=cfg["access_key"],
            resource_id=cfg["resource_id"],
            submit_url=cfg["submit_url"],
            timeout_sec=float(cfg["submit_timeout_sec"]),
            diarization_enabled=diarization_enabled,
            channel_split=channel_split,
            audio_format=audio_format,
            audio_url=u,
            audio_data_b64=None,
        )

    deadline = time.monotonic() + float(cfg["poll_max_sec"])
    last_st = ""
    while time.monotonic() < deadline:
        st, body, logid, qmsg = _volc_seed_query_once(
            task_id=task_id,
            logid=logid,
            api_key=cfg["api_key"],
            app_key=cfg["app_key"],
            access_key=cfg["access_key"],
            resource_id=cfg["resource_id"],
            query_url=cfg["query_url"],
            timeout_sec=float(cfg["query_timeout_sec"]),
        )
        last_st = st
        if st == _SUCCESS:
            if not isinstance(body, dict):
                raise RuntimeError("豆包录音识别完成但响应体非 JSON 对象")
            return body
        if st in _PENDING_STATUS:
            time.sleep(float(cfg["poll_interval_sec"]))
            continue
        if st == "20000003":
            raise RuntimeError("豆包录音识别：静音或无可识别语音（20000003）")
        detail = ""
        hdr_msg = ""
        if isinstance(body, dict):
            detail = str(body.get("message") or body.get("result") or "")[:400]
            hdr = body.get("header")
            if isinstance(hdr, dict):
                hdr_msg = str(hdr.get("message") or "")[:300]
        hint = ""
        if st == "45000006":
            hint = (
                "（常见原因：音频 URL 无法被豆包公网下载、或 format/编码与文件不符；"
                "请确认预签名域名对公网可访问且与 OBJECT_PRESIGN_ENDPOINT 一致。）"
            )
        raise RuntimeError(
            f"豆包录音识别失败 X-Api-Status-Code={st} X-Api-Message={qmsg} body_header.message={hdr_msg} {detail}{hint}".strip()
        )

    raise RuntimeError(f"豆包录音识别超时（最后状态码 {last_st or 'unknown'}）")


def volc_seed_auth_configured() -> bool:
    """编排器启动或接口预检：是否已配置豆包 OpenSpeech 所需鉴权。"""
    cfg = _volc_seed_env()
    return bool(cfg["api_key"]) or (bool(cfg["app_key"]) and bool(cfg["access_key"]))
