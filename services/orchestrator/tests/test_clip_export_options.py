"""clip_export_options 单元测试。"""

from __future__ import annotations

from app.clip_export_options import lame_q_from_export_options, sanitize_clip_export_options


def test_sanitize_defaults_to_q2() -> None:
    assert sanitize_clip_export_options(None) == {"encoding": {"lame_q": 2}}
    assert sanitize_clip_export_options({}) == {"encoding": {"lame_q": 2}}


def test_sanitize_clamps_lame_q() -> None:
    assert sanitize_clip_export_options({"encoding": {"lame_q": 0}}) == {"encoding": {"lame_q": 0}}
    assert sanitize_clip_export_options({"encoding": {"lame_q": 99}}) == {"encoding": {"lame_q": 9}}
    assert sanitize_clip_export_options({"encoding": {"lame_q": "bad"}}) == {"encoding": {"lame_q": 2}}


def test_lame_q_from_export_options() -> None:
    assert lame_q_from_export_options({"encoding": {"lame_q": 4}}) == 4
