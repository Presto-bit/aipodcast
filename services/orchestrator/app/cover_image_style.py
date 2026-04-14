"""
播客封面：从文稿/画面描述中粗粒度推断 MiniMax 文生图 `style_type`，减少固定「漫画」锁死画风。

说明：上游枚举以 MiniMax 文档为准；此处仅使用常见三类，无法匹配时回退到配置默认。
"""

from __future__ import annotations


def coarse_cover_style_type(bundle: str, image_prompt: str, *, default_type: str) -> str:
    """
    根据素材全文 + 已生成的画面描述，在三类常见画风间择优，无法区分则回退 default_type。
    """
    blob = f"{bundle}\n{image_prompt}"
    # 写实向
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
        return "写实"
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
    # 其余：插画、概念、扁平、水墨等 — API 侧用「插画」作通用容器，细画法交给 prompt
    if any(
        k in blob
        for k in (
            "水墨",
            "国画",
            "工笔",
            "水彩",
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
        return "插画"
    return default_type
