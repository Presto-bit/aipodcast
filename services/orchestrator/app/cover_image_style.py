"""
播客封面：从文稿/画面描述中粗粒度推断 MiniMax 文生图 `style_type`。

MiniMax `image-01-live` 仅接受文档枚举：漫画、元气、中世纪、水彩（见官方 OpenAPI StyleObject）。
旧版代码使用的「插画」「写实」等会触发 base_resp 2013 invalid style。
"""

from __future__ import annotations

# 与 https://platform.minimaxi.com/docs/api-reference/image-generation-t2i 中 StyleObject 对齐
MINIMAX_IMAGE_STYLE_TYPES = frozenset({"漫画", "元气", "中世纪", "水彩"})

# 历史中文名 + 常见英文 .env 误填；均映射到官方四枚举
_LEGACY_STYLE_MAP: dict[str, str] = {
    "插画": "元气",
    "写实": "元气",
    "概念": "元气",
    "扁平": "元气",
    "illustration": "元气",
    "realistic": "元气",
    "photo": "元气",
    "photography": "元气",
    "watercolor": "水彩",
    "medieval": "中世纪",
    "comic": "漫画",
    "manga": "漫画",
    "anime": "漫画",
    "cartoon": "漫画",
}


def normalize_minimax_image_style_type(style: str, *, fallback: str = "元气") -> str:
    """将配置或历史返回值收敛为上游合法枚举，避免 2013 invalid style。"""
    s = (style or "").strip()
    if not s:
        fb0 = (fallback or "元气").strip()
        return fb0 if fb0 in MINIMAX_IMAGE_STYLE_TYPES else "元气"
    if s in MINIMAX_IMAGE_STYLE_TYPES:
        return s
    if s in _LEGACY_STYLE_MAP:
        return _LEGACY_STYLE_MAP[s]
    sl = s.lower()
    if sl in _LEGACY_STYLE_MAP:
        return _LEGACY_STYLE_MAP[sl]
    fb = (fallback or "元气").strip()
    return fb if fb in MINIMAX_IMAGE_STYLE_TYPES else "元气"


def coarse_cover_style_type(bundle: str, image_prompt: str, *, default_type: str) -> str:
    """
    根据素材全文 + 已生成的画面描述，在合法 style_type 间择优；无法区分则回退 default_type（会先归一化）。
    """
    blob = f"{bundle}\n{image_prompt}"
    default_type = normalize_minimax_image_style_type(default_type)

    # 水彩 / 传统绘画媒介（API 枚举「水彩」）
    if any(
        k in blob
        for k in (
            "水墨",
            "国画",
            "工笔",
            "水彩",
            "水粉",
            "晕染",
        )
    ):
        return "水彩"

    # 中世纪题材
    if any(
        k in blob
        for k in (
            "中世纪",
            "古堡",
            "骑士",
            "城堡",
            "哥特",
        )
    ):
        return "中世纪"

    # 漫画向
    if any(
        k in blob
        for k in (
            "漫画",
            "条漫",
            "四格",
            "动漫",
            "日漫",
            "分镜",
            "卡通",
        )
    ):
        return "漫画"

    # 写实 / 摄影向：无「写实」枚举，用「元气」作偏立体、偏清晰的通用容器（细质感仍靠 prompt）
    if any(
        k in blob
        for k in (
            "写实",
            "摄影",
            "棚拍",
            "纪实",
            "新闻现场",
            "相机",
            "胶片",
            "肖像",
            "自然光",
        )
    ):
        return "元气"

    # 数字插画、概念、科技风等 → 元气
    if any(
        k in blob
        for k in (
            "油画",
            "版画",
            "赛博",
            "霓虹",
            "科幻",
            "3D",
            "等距",
            "扁平",
            "矢量",
            "信息图",
            "概念图",
            "手绘",
            "插画风",
        )
    ):
        return "元气"

    return default_type
