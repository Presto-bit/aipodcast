"""根据播客文稿生成社交平台「爆款」结构化文案（小红书 / 抖音）。

使用独立 Chat 补全（非 build_script 播客管线），避免模型按对话稿输出。
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from .provider_router import invoke_llm_chat_messages_with_minimax_fallback

logger = logging.getLogger(__name__)


def _strip_code_fence(text: str) -> str:
    t = (text or "").strip()
    t = re.sub(r"^```(?:json)?\s*", "", t, flags=re.IGNORECASE)
    t = re.sub(r"\s*```\s*$", "", t)
    return t.strip()


def _parse_json_object(raw: str) -> dict[str, Any]:
    t = _strip_code_fence(raw)
    i = t.find("{")
    j = t.rfind("}")
    if i < 0 or j <= i:
        raise ValueError("no_json_object")
    return json.loads(t[i : j + 1])


def _normalize_tags(tags: Any) -> list[str]:
    if isinstance(tags, list):
        return [str(x).strip() for x in tags if str(x).strip()][:12]
    if isinstance(tags, str) and tags.strip():
        parts = re.split(r"[,，\s#]+", tags.strip())
        return [p for p in parts if p][:12]
    return []


def condense_podcast_script_for_social(raw: str, max_chars: int = 12000) -> str:
    """去掉 Speaker 轮次前缀，合并为连续叙述材料，供模型重写（非照抄）。"""
    lines_out: list[str] = []
    for line in (raw or "").splitlines():
        s = line.strip()
        if not s:
            continue
        s = re.sub(r"^\s*Speaker\s*\d+\s*[:：]\s*", "", s, flags=re.IGNORECASE)
        s = re.sub(r"^\s*主持人\s*[:：]\s*", "", s)
        s = re.sub(r"^\s*嘉宾\s*[:：]\s*", "", s)
        if s:
            lines_out.append(s)
    text = "\n".join(lines_out)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if len(text) > max_chars:
        text = text[:max_chars] + "…"
    return text


def _fallback_pack(platform: str) -> dict[str, Any]:
    if platform == "xiaohongshu":
        return {
            "title": "读完这篇，省下你 1 小时弯路",
            "theme": "把一期播客里的干货，整理成可收藏的笔记式摘要；适合划走前最后一眼。",
            "body": "核心观点已帮你压成短段落，可直接配封面发笔记。\n\n若正文显示异常，请刷新页面重新生成文案。",
            "tags": ["成长笔记", "播客推荐", "自我提升", "今日学习", "收藏夹吃灰系列"],
            "interaction": "哪一条最戳你？评论里交个朋友～",
        }
    return {
        "title": "30 秒讲完：这期播客到底值不值得听",
        "theme": "短视频时代的信息钩子：先给结论，再留悬念去完整节目。",
        "body": "把对话里的金句和结论拧成抖音风短句，方便你直接贴描述栏。\n\n若需更贴脸风格，可点击重新选择平台触发再次生成。",
        "tags": ["知识博主", "口播", "播客剪辑", "干货分享", "认知提升"],
        "interaction": "你同意吗？不同意也算互动～",
    }


def _invoke_social_llm(system: str, user: str, api_key: str | None) -> tuple[str, str | None]:
    """与脚本/笔记问答一致：TEXT_PROVIDER=deepseek|qwen 时先 OpenAI 兼容 Chat，失败再 MiniMax。"""
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    return invoke_llm_chat_messages_with_minimax_fallback(
        messages,
        temperature=0.65,
        api_key=api_key,
        timeout_sec=120,
    )


def generate_viral_social_copy(
    podcast_script: str,
    *,
    platform: str,
    api_key: str | None,
    subscription_tier: str | None = None,
) -> dict[str, Any]:
    """
    返回 title, theme, body, tags[], interaction, trace_id（可能为 None）
    platform: xiaohongshu | douyin
    """
    _ = subscription_tier  # 预留与套餐联动
    condensed = condense_podcast_script_for_social(podcast_script)
    if not condensed.strip():
        raise RuntimeError("empty_script_after_condense")

    platform_cn = "小红书" if platform == "xiaohongshu" else "抖音"
    style_extra = (
        "语气像闺蜜发笔记：短段落、适度 emoji（全文不超过 6 个）、避免播客腔。"
        if platform == "xiaohongshu"
        else "语气像抖音描述：第一句强钩子、短句、可带少量 emoji（不超过 4 个）、避免播客腔。"
    )

    system = f"""你是{platform_cn}头部 MCN 的内容总监。用户会给你一期播客口播底稿（可能曾是对话轮次，已去掉 Speaker 前缀）。
你必须把材料**重写**成适合在{platform_cn}发布的「信息流爆款」配套文案，而不是把底稿誊抄或轻微改写。

{style_extra}

硬性禁止：
1. 禁止输出 Speaker1/Speaker2、主持人、嘉宾等多轮对话格式；禁止剧本式一行一人。
2. 禁止照搬原材料连续 18 个以上相同汉字（必须换句式、合并、提炼或换角度表达）。
3. 禁止以「欢迎收听」「今天这期节目」「我是主播」等播客开场作为 title 或正文主体。
4. body 必须是 2～5 段全新撰写的推广型短文，像用户划到会停下来看的那种。

输出格式：只输出一个 JSON 对象，不要 markdown 代码块，不要解释。第一个字符必须是 {{ ，最后一个字符必须是 }} 。
键：title（≤28 字）、theme（40～100 字价值概括）、body（2～5 段，段间用 \\n\\n）、tags（数组 6～10 个话题词，不带#）、interaction（一句评论/互动引导）。"""

    user = (
        "请根据下面播客底稿，重写为上述 JSON。\n"
        "底稿仅作信息来源，不要当台词念。\n\n"
        f"【底稿】\n{condensed}"
    )

    raw, trace_id = _invoke_social_llm(system, user, api_key)

    data: dict[str, Any]
    try:
        data = _parse_json_object(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning("viral_copy json parse failed, retry once: %s", exc)
        fix_user = (
            "你上一次输出不是合法 JSON。请严格只输出一个 JSON 对象，"
            "键为 title, theme, body, tags, interaction；不要代码块，不要其它文字。\n\n"
            f"仍基于下列底稿重写（禁止照抄）：\n{condensed[:8000]}"
        )
        try:
            raw2, tid2 = _invoke_social_llm(system, fix_user, api_key)
            data = _parse_json_object(raw2)
            if tid2:
                trace_id = tid2
        except Exception as exc2:
            logger.warning("viral_copy retry failed: %s", exc2)
            data = dict(_fallback_pack(platform))

    title = str(data.get("title") or "").strip() or _fallback_pack(platform)["title"]
    theme = str(data.get("theme") or "").strip()
    body = str(data.get("body") or "").strip().replace("\\n\\n", "\n\n").replace("\\n", "\n")
    tags = _normalize_tags(data.get("tags"))
    interaction = str(data.get("interaction") or "").strip() or "欢迎评论交流～"

    if not tags:
        tags = _normalize_tags(_fallback_pack(platform)["tags"])

    return {
        "title": title[:120],
        "theme": theme[:500],
        "body": body[:8000],
        "tags": tags,
        "interaction": interaction[:300],
        "trace_id": trace_id,
    }
