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


def test_serialize_job_strips_internal_minio_audio_and_cover_urls():
    internal_audio = "http://minio:9000/aipodcast-artifacts/jobs/u/x/j.mp3?sig=1"
    internal_cover = "http://minio:9000/aipodcast-artifacts/covers/x.jpg"
    row = {
        "id": "j3",
        "result": {
            "audio_url": internal_audio,
            "cover_image": internal_cover,
            "coverImage": "https://cdn.example.com/ok.png",
        },
    }
    out = serialize_job(row)
    r = out["result"]
    assert r["audio_url"] == ""
    assert r["cover_image"] == ""
    assert r["coverImage"] == "https://cdn.example.com/ok.png"
