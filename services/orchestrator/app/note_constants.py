NOTE_PREVIEW_TEXT_MAX = 400_000
ALLOWED_NOTE_EXT = {"txt", "md", "markdown", "pdf", "doc", "docx", "epub", "html", "htm", "xhtml"}
MAX_NOTE_UPLOAD_BYTES = 15 * 1024 * 1024
# 视频容器：正文无法可靠抽取，上传前即拒绝（与「除视频外可识别」一致）
VIDEO_NOTE_EXT = frozenset(
    {
        "mp4",
        "m4v",
        "webm",
        "mov",
        "avi",
        "mkv",
        "wmv",
        "flv",
        "mpeg",
        "mpg",
        "mpg2",
        "3gp",
        "3g2",
        "ts",
        "m2ts",
        "mts",
        "ogv",
        "asf",
        "rm",
        "rmvb",
    }
)
NOTEBOOK_COVER_MAX_BYTES = 2 * 1024 * 1024
ALLOWED_NOTEBOOK_COVER_IMAGE_EXT = frozenset({"png", "jpg", "jpeg", "webp", "gif", "avif"})
NOTEBOOK_COVER_PRESET_IDS = frozenset({"mist", "dawn", "slate", "forest"})
MAX_URL_IMPORT_CHARS = 500_000
