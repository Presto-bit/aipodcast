"""安全审计日志（mock logger）。"""
from unittest.mock import patch

from app.security_audit import log_idor_denied


@patch("app.security_audit._logger")
def test_log_idor_denied_calls_warning(mock_log):
    log_idor_denied("job", "abc-123", "+8613800000000")
    mock_log.warning.assert_called_once()
    args = mock_log.warning.call_args[0]
    assert "job" in args
    assert "abc-123" in args
