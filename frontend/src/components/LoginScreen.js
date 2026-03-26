import React, { useState } from 'react';

function LoginScreen({
  onLogin,
  onRegister,
  onForgotPassword,
  onResetPassword,
  inviteRequired = false,
  inviteHint = '',
  passwordResetEnabled = false,
  passwordResetDebug = false,
}) {
  const [mode, setMode] = useState('login');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [debugCode, setDebugCode] = useState('');

  const isLoginMode = mode === 'login';
  const isRegisterMode = mode === 'register';
  const isResetMode = mode === 'reset';
  const phoneTrimmed = phone.trim();
  const invitePlaceholder = inviteHint || '向管理员索取（如启用）';
  const submitText = busy
    ? '请稍候…'
    : isLoginMode
      ? '进入应用'
      : isRegisterMode
        ? '注册并进入'
        : '确认重置';
  const brandSubTitle = inviteRequired ? '管理员邀请注册 · 手机号登录' : '手机号注册登录';

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      if (isLoginMode) {
        await onLogin(phoneTrimmed, password);
      } else if (isRegisterMode) {
        await onRegister(phoneTrimmed, password, inviteCode.trim());
      } else {
        await onResetPassword(phoneTrimmed, resetCode.trim(), newPassword);
        setSuccess('密码重置成功，请使用新密码登录。');
        setMode('login');
        setPassword('');
        setNewPassword('');
        setResetCode('');
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const sendResetCode = async () => {
    setError('');
    setSuccess('');
    setDebugCode('');
    if (!phoneTrimmed) {
      setError('请先输入手机号');
      return;
    }
    setBusy(true);
    try {
      const result = await onForgotPassword(phoneTrimmed);
      setSuccess(result.message || '验证码已发送');
      if (passwordResetDebug && result.debugResetCode) {
        setDebugCode(String(result.debugResetCode));
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-brand-mark">FYV</span>
          <div>
            <div className="login-brand-name">FindingYourVoice</div>
            <div className="login-brand-sub">{brandSubTitle}</div>
          </div>
        </div>

        <div className="login-tabs">
          <button
            type="button"
            className={`login-tab ${isLoginMode ? 'active' : ''}`}
            onClick={() => setMode('login')}
          >
            登录
          </button>
          <button
            type="button"
            className={`login-tab ${isRegisterMode ? 'active' : ''}`}
            onClick={() => setMode('register')}
          >
            注册
          </button>
          {passwordResetEnabled && (
            <button
              type="button"
                className={`login-tab ${isResetMode ? 'active' : ''}`}
              onClick={() => setMode('reset')}
            >
              重置密码
            </button>
          )}
        </div>

        <form className="login-form" onSubmit={submit}>
          <label className="login-field">
            <span>手机号</span>
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="11 位中国大陆手机号"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </label>
          {!isResetMode && (
            <label className="login-field">
              <span>密码</span>
              <input
                type="password"
                autoComplete={isLoginMode ? 'current-password' : 'new-password'}
                placeholder="至少 6 位"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </label>
          )}
          {isResetMode && (
            <>
              <div className="login-field login-field-inline">
                <span>验证码</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    autoComplete="one-time-code"
                    placeholder="6位验证码"
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value)}
                    required
                  />
                  <button type="button" className="login-submit" disabled={busy} onClick={sendResetCode}>
                    发送验证码
                  </button>
                </div>
              </div>
              <label className="login-field">
                <span>新密码</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="至少 6 位"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </label>
              {passwordResetDebug && debugCode ? (
                <p className="login-error" style={{ color: '#0f766e' }}>
                  调试验证码：{debugCode}
                </p>
              ) : null}
            </>
          )}
          {isRegisterMode && inviteRequired && (
            <label className="login-field">
              <span>邀请码</span>
              <input
                type="text"
                autoComplete="off"
                placeholder={invitePlaceholder}
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                required
              />
            </label>
          )}
          {isLoginMode && passwordResetEnabled && (
            <button
              type="button"
              className="login-tab"
              style={{ alignSelf: 'flex-start', marginTop: -4 }}
              onClick={() => setMode('reset')}
            >
              忘记密码？
            </button>
          )}
          {error ? <p className="login-error">{error}</p> : null}
          {success ? <p className="login-error" style={{ color: '#0f766e' }}>{success}</p> : null}
          <button type="submit" className="login-submit" disabled={busy}>
            {submitText}
          </button>
        </form>
      </div>
    </div>
  );
}

export default LoginScreen;
