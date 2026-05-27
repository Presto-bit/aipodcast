"""笔记本列表与 author IP 隐藏本过滤。"""
from __future__ import annotations

from app.author_ip_store import exclude_author_ip_notebooks


def test_exclude_author_ip_notebooks_only_system_prefix() -> None:
    names = ["工作笔记", "__author_ip:deadbeef", "学习资料"]
    assert exclude_author_ip_notebooks(names, "user-1") == ["工作笔记", "学习资料"]


def test_exclude_author_ip_notebooks_keeps_v6_bound_user_notebook() -> None:
    """v6：用户真实笔记本名即使会写入 author_ips，也不应从列表剔除。"""
    names = ["我的播客素材", "其他本"]
    assert exclude_author_ip_notebooks(names, "user-1") == names
