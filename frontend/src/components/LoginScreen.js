import React, { useState } from 'react';

function LoginScreen({ onLogin, onRegister }) {
  const [mode, setMode] = useState('login');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') {
        await onLogin(phone.trim(), password);
      } else {
        await onRegister(phone.trim(), password, inviteCode.trim());
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
            <div className="login-brand-sub">管理员邀请注册 · 手机号登录</div>
          </div>
        </div>

        <div className="login-tabs">
          <button
            type="button"
            className={`login-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => setMode('login')}
          >
            登录
          </button>
          <button
            type="button"
            className={`login-tab ${mode === 'register' ? 'active' : ''}`}
            onClick={() => setMode('register')}
          >
            注册
          </button>
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
          <label className="login-field">
            <span>密码</span>
            <input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder="至少 6 位"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </label>
          {mode === 'register' && (
            <label className="login-field">
              <span>邀请码</span>
              <input
                type="text"
                autoComplete="off"
                placeholder="向管理员索取"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                required
              />
            </label>
          )}
          {error ? <p className="login-error">{error}</p> : null}
          <button type="submit" className="login-submit" disabled={busy}>
            {busy ? '请稍候…' : mode === 'login' ? '进入应用' : '注册并进入'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default LoginScreen;
