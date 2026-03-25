import json


def parse_script_target_chars(form_value, podcast_config):
    dflt = int(podcast_config.get("script_target_chars_default", 200))
    lo = int(podcast_config.get("script_target_chars_min", 200))
    hi = int(podcast_config.get("script_target_chars_max", 5000))
    if form_value is None:
        return dflt
    raw = str(form_value).strip()
    try:
        v = int(raw)
    except (TypeError, ValueError):
        v = dflt
    return max(lo, min(hi, v))


def parse_long_script_target_chars(form_value, podcast_config):
    dflt = int(podcast_config.get("script_target_chars_default", 200))
    lo = int(podcast_config.get("script_target_chars_min", 200))
    hi = int(podcast_config.get("long_script_target_chars_max", podcast_config.get("script_target_chars_max", 5000)))
    if form_value is None:
        return dflt
    raw = str(form_value).strip()
    try:
        v = int(raw)
    except (TypeError, ValueError):
        v = dflt
    return max(lo, min(hi, v))


def parse_url_inputs(req):
    raw_list = (req.form.get("url_list", "") or "").strip()
    urls = []
    if raw_list:
        try:
            arr = json.loads(raw_list)
            if isinstance(arr, list):
                urls = [str(u).strip() for u in arr if str(u).strip()]
        except Exception:
            urls = []
    if not urls:
        single = (req.form.get("url", "") or "").strip()
        if single:
            urls = [single]
    seen = set()
    dedup = []
    for u in urls:
        if u in seen:
            continue
        seen.add(u)
        dedup.append(u)
    return dedup
