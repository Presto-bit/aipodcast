"""SMTP 辅助逻辑单元测试（不连外网、不发信）。"""

from app.fyv_shared import auth_service as m


def test_tls_server_name_hostname():
    assert m._smtp_tls_server_name("smtp.163.com") == "smtp.163.com"


def test_tls_server_name_ipv4():
    assert m._smtp_tls_server_name("127.0.0.1") is None


def test_likely_connection_layer_fail():
    assert m._smtp_likely_connection_layer_fail("Connection unexpectedly closed")
    assert m._smtp_likely_connection_layer_fail("STARTTLS failed: foo")
    assert not m._smtp_likely_connection_layer_fail("535 5.7.8 Authentication failed")


def test_implicit_ssl_ports():
    assert m._smtp_implicit_ssl(465) is True
    assert m._smtp_implicit_ssl(587) is False


def test_normalize_otp_accepts_separators():
    assert m._normalize_register_otp_code("123 456") == "123456"
    assert m._normalize_register_otp_code("123-456") == "123456"


def test_register_email_format_ok():
    assert m.register_email_format_ok("a@b.co")
    assert m.register_email_format_ok("User_Name+tag@example.com")
    assert not m.register_email_format_ok("")
    assert not m.register_email_format_ok("no-at")
    assert not m.register_email_format_ok("@nodomain.com")
    assert not m.register_email_format_ok("a @b.com")
