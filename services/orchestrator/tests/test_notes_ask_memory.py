"""知识库对话记忆打包与检索问句扩展。"""
from app.notes_ask_memory import (
    build_conversation_context_blocks,
    expand_retrieval_query,
    normalize_session_state,
    pack_chat_history_rows,
)


def test_pack_chat_history_by_budget():
    rows = [{"role": "user", "content": "a" * 5000}] * 3 + [{"role": "assistant", "content": "b" * 200}]
    packed = pack_chat_history_rows(rows)
    assert len(packed) >= 1
    assert packed[-1]["role"] == "assistant"


def test_session_state_block():
    st = normalize_session_state(
        {
            "v": 1,
            "topic": "马太福音结构",
            "threads": [{"id": "t1", "about": "结构", "status": "active"}],
            "facts": ["共五段论述"],
            "prefs": [],
            "turnCursor": 3,
        }
    )
    block = build_conversation_context_blocks([], st)
    assert "会话延续" in block
    assert "马太福音" in block


def test_expand_follow_up_query():
    st = normalize_session_state(
        {
            "v": 1,
            "topic": "约翰福音",
            "threads": [],
            "facts": ["开篇强调道成肉身"],
            "prefs": [],
            "turnCursor": 2,
        }
    )
    q = expand_retrieval_query("继续展开刚才那段", st)
    assert "约翰" in q or "道成肉身" in q
