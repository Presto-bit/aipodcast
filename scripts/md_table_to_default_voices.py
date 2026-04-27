#!/usr/bin/env python3
"""
将用户粘贴的 Markdown 音色表（| 序号 | 语言 | `voice_id` | 名称 |）转为 config.DEFAULT_VOICES 风格片段。
用法: python md_table_to_default_voices.py < scripts/minimax_voice_table.md > /tmp/voices_snippet.py

编排器系统音色表已改为 `services/orchestrator/app/fyv_shared/minimax_system_voices.json`；
若本脚本输出需同步到线上表，请将生成的键值合并进该 JSON（或写脚本从 stdout 转 JSON）。
"""
import re
import sys
from typing import Dict, List, Tuple


def slug_key(vid: str, used: Dict[str, bool]) -> str:
    s = vid.strip().replace("（", "(").replace("）", ")")
    s = re.sub(r"\s+", "_", s)
    s = re.sub(r"[^0-9a-zA-Z_\-]+", "_", s)
    s = s.strip("_").lower()
    s = s.replace("-", "_")
    s = re.sub(r"_+", "_", s)
    if not s:
        s = "voice"
    if s[0].isdigit():
        s = "v_" + s
    base = s
    n = 1
    out = s
    while out in used:
        n += 1
        out = f"{base}_{n}"
    used[out] = True
    return out


def guess_gender(voice_id: str, display_name: str) -> str:
    v = voice_id.lower()
    n = display_name
    if v.startswith("female-") or v.startswith("female_"):
        return "female"
    if v.startswith("male-") or v.startswith("male_"):
        return "male"
    if "female" in v and "male" not in v.split("female")[0]:
        return "female"
    if "_girl" in v or "_lady" in v or "_woman" in v or "_mother" in v or "_princess" in v or "_queen" in v:
        return "female"
    if "_boy" in v or "_man" in v or v.endswith("_man") or "husband" in v or "gentleman" in v or "bloke" in v:
        return "male"
    if "sweetgirl" in v.replace("_", "") or "shygirl" in v.replace("_", "") or "sassygirl" in v.replace("_", ""):
        return "female"
    # 中文名称
    if any(
        x in n
        for x in (
            "女",
            "少女",
            "御姐",
            "学姐",
            "学妹",
            "萌妹",
            "小姐",
            "大婶",
            "空姐",
            "闺蜜",
            "奶奶",
            "女童",
            "女声",
            "女孩",
            "主持",
        )
    ):
        if "男主持" in n or "男声" in n or "小哥" in n or "男友" in n or "男童" in n:
            pass
        elif "女" in n or "女孩" in n or "女童" in n:
            return "female"
    if any(x in n for x in ("男声", "男童", "男友", "少爷", "小哥", "大爷", "青年", "学长", "学弟", "高管", "男主播", "青年")):
        if "女大学生" in n or "女声" in n:
            return "female"
        if "女" not in n or "男" in n:
            return "male"
    if "Santa" in n or "Grinch" in n or "Rudolph" in n or "Arnold" in n or "Robot" in n or "猪" in n or "战甲" in n:
        return "male"
    return "female"


def parse_md_table(text: str) -> List[Tuple[str, str, str]]:
    rows: List[Tuple[str, str, str]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        parts = [p.strip() for p in line.split("|")]
        parts = [p for p in parts if p]
        if len(parts) < 4:
            continue
        if parts[0] in ("序号", ":--", "---") or re.match(r"^:?-+:?$", parts[0]):
            continue
        if not re.match(r"^\d+$", parts[0]):
            continue
        lang = parts[1]
        vid_raw = parts[2].strip().strip("`").strip()
        name = parts[3]
        if not vid_raw:
            continue
        rows.append((lang, vid_raw, name))
    return rows


def parse_tsv(text: str) -> List[Tuple[str, str, str]]:
    rows: List[Tuple[str, str, str]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        rows.append((parts[0].strip(), parts[1].strip(), parts[2].strip()))
    return rows


def main() -> None:
    text = sys.stdin.read()
    parsed = parse_md_table(text)
    if not parsed:
        parsed = parse_tsv(text)
    if not parsed:
        print("# 未解析到任何行：请使用 Markdown 表或 TSV（语言<TAB>voice_id<TAB>名称）", file=sys.stderr)
        sys.exit(1)

    used_keys: Dict[str, bool] = {}
    print("# 以下片段可合并进 services/orchestrator/app/fyv_shared/config.py 的 DEFAULT_VOICES（勿重复 mini/max 键名）")
    print("# 生成条目数:", len(parsed))
    print()

    for lang, voice_id, display_name in parsed:
        key = slug_key(voice_id, used_keys)
        gender = guess_gender(voice_id, display_name)
        desc = f"{lang.strip()} · {display_name.strip()}"
        name_short = display_name.strip()
        # 转义 docstring 风险：description 用引号包裹时转义
        def q(s: str) -> str:
            return s.replace("\\", "\\\\").replace('"', '\\"')

        print(f'    "{key}": {{')
        print(f'        "name": "{q(name_short)}",')
        print(f'        "gender": "{gender}",')
        print(f'        "voice_id": "{q(voice_id.strip())}",')
        print(f'        "description": "{q(desc)}",')
        print("    },")


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        try:
            sys.stdout.close()
        except BrokenPipeError:
            pass
        raise SystemExit(0)
