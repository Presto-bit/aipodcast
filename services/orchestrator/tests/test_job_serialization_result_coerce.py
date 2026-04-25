from app.job_serialization import serialize_job


def test_serialize_job_coerces_result_json_string_to_dict():
    row = {
        "id": "j1",
        "project_id": "p1",
        "status": "succeeded",
        "result": '{"audio_hex":"414243","audio_url":"https://x/y.mp3"}',
    }
    out = serialize_job(row)
    assert isinstance(out["result"], dict)
    assert out["result"]["audio_hex"] == "414243"
    assert out["result"]["audio_url"] == "https://x/y.mp3"


def test_serialize_job_keeps_result_dict():
    row = {"id": "j2", "result": {"title": "t"}}
    out = serialize_job(row)
    assert out["result"] == {"title": "t"}
