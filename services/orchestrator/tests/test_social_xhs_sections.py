from app.social_xhs import normalize_xhs_llm_data, _repair_python_dict_sections_in_body


def test_normalize_sections_dict_list_to_markdown():
    data = {
        "titles": ["标题一", "标题二", "标题三"],
        "opening_30": "你是不是也加班到深夜？",
        "sections": [
            {
                "heading": "先撕开一个真相：出租时间=帮别人做嫁衣",
                "content": "📌 硅谷投资人纳瓦尔一句话点醒我。",
            },
            {"heading": "再来看看你的专长", "content": "📌 专长不是学校教出来的。"},
        ],
        "tags": ["干货分享", "个人成长", "财务自由", "纳瓦尔宝典", "职场思考"],
        "interaction": "评论区聊聊～",
    }
    norm = normalize_xhs_llm_data(data)
    assert "{'heading'" not in norm["body_main"]
    assert "## 先撕开一个真相" in norm["body_main"]
    assert "📌 硅谷投资人纳瓦尔" in norm["body_main"]
    assert "## 再来看看你的专长" in norm["body_main"]


def test_repair_python_dict_leak_in_body():
    leaked = (
        "{'heading': '小节一', 'content': '正文甲。'}\n\n"
        "{'heading': '小节二', 'content': '正文乙。'}"
    )
    fixed = _repair_python_dict_sections_in_body(leaked)
    assert "## 小节一" in fixed
    assert "正文甲" in fixed
    assert "{'heading'" not in fixed
