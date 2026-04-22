from app.work_result_title import derive_work_result_title


def test_episode_title_priority():
    assert derive_work_result_title({"episode_title": "  本期焦点  "}, "Speaker1: 无关", job_type="podcast_generate") == "本期焦点"


def test_program_name_when_not_default():
    assert (
        derive_work_result_title({"program_name": "商业内参"}, "正文很长\n第二行", job_type="podcast_generate")
        == "商业内参"
    )


def test_skips_default_program_name():
    t = derive_work_result_title({"program_name": "本期播客"}, "第一行实质内容比较长一些", job_type="podcast_generate")
    assert t == "第一行实质内容比较长一些"


def test_first_note_title():
    pl = {
        "selected_note_ids": ["a"],
        "selected_note_titles": ["季度复盘要点"],
    }
    assert derive_work_result_title(pl, "", job_type="script_draft") == "季度复盘要点"


def test_script_line_strip_speaker():
    body = "Speaker1: 这是讨论的核心话题\nSpeaker2: 嗯"
    assert derive_work_result_title({}, body, job_type="podcast") == "这是讨论的核心话题"
