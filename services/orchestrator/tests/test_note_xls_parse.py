from app.note_document_extract import _xls_bytes_to_text


def test_xls_rejects_non_workbook_bytes():
    r = _xls_bytes_to_text(b"not-a-valid-xls-binary")
    assert r.status == "error"
    assert r.text == ""
