import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { apiPath } from './apiBaseUrl';

export const AUTH_TOKEN_KEY = 'fym_auth_token';
export const AUTH_PHONE_KEY = 'fym_auth_phone';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [authRequired, setAuthRequired] = useState(null);
  const [token, setToken] = useState(() => {
    try {
      return (window.localStorage.getItem(AUTH_TOKEN_KEY) || '').trim();
    } catch (e) {
      return '';
    }
  });
  const [phone, setPhone] = useState(() => {
    try {
      return (window.localStorage.getItem(AUTH_PHONE_KEY) || '').trim();
    } catch (e) {
      return '';
    }
  });
  const [user, setUser] = useState(null);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const unlockResolverRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiPath('/api/auth/config'));
        const data = await res.json().catch(() => ({}));
        if (!cancelled) {
          setAuthRequired(!!data.auth_required);
        }
      } catch (e) {
        if (!cancelled) setAuthRequired(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authRequired === false) {
      setUser({ phone: 'local', plan: 'free' });
      return;
    }
    if (!authRequired || !token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiPath('/api/auth/me'), {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.success && data.user) {
          setUser(data.user);
          if (data.user.phone) {
            setPhone(data.user.phone);
            try {
              window.localStorage.setItem(AUTH_PHONE_KEY, data.user.phone);
            } catch (e) {
              // ignore
            }
          }
        } else {
          setToken('');
          setUser(null);
          try {
            window.localStorage.removeItem(AUTH_TOKEN_KEY);
          } catch (e) {
            // ignore
          }
        }
      } catch (e) {
        if (!cancelled) setUser(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authRequired, token]);

  const persistSession = useCallback((t, p) => {
    setToken(t || '');
    setPhone((p || '').trim());
    try {
      if (t) window.localStorage.setItem(AUTH_TOKEN_KEY, t);
      else window.localStorage.removeItem(AUTH_TOKEN_KEY);
      if (p) window.localStorage.setItem(AUTH_PHONE_KEY, p.trim());
    } catch (e) {
      // ignore
    }
  }, []);

  const login = useCallback(
    async (phoneInput, password) => {
      const res = await fetch(apiPath('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneInput, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || `登录失败 ${res.status}`);
      }
      persistSession(data.token, phoneInput);
      setUser(data.user || { phone: phoneInput, plan: 'free' });
    },
    [persistSession]
  );

  const register = useCallback(
    async (phoneInput, password, inviteCode) => {
      const res = await fetch(apiPath('/api/auth/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phoneInput,
          password,
          invite_code: inviteCode,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || `注册失败 ${res.status}`);
      }
      persistSession(data.token, phoneInput);
      setUser(data.user || { phone: phoneInput, plan: 'free' });
    },
    [persistSession]
  );

  const logout = useCallback(async () => {
    try {
      const t = token;
      if (t) {
        await fetch(apiPath('/api/auth/logout'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${t}` },
        });
      }
    } catch (e) {
      // ignore
    }
    persistSession('', '');
    setUser(null);
  }, [persistSession, token]);

  const getAuthHeaders = useCallback(() => {
    if (!authRequired || !token) return {};
    return { Authorization: `Bearer ${token}` };
  }, [authRequired, token]);

  const ensureFeatureUnlocked = useCallback(async () => {
    if (!authRequired) return true;
    if (!token) return false;
    try {
      const res = await fetch(apiPath('/api/auth/status'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success && data.feature_unlocked) {
        return true;
      }
    } catch (e) {
      return false;
    }
    return new Promise((resolve) => {
      setUnlockPassword('');
      setUnlockError('');
      unlockResolverRef.current = resolve;
      setUnlockOpen(true);
    });
  }, [authRequired, token]);

  const submitUnlock = useCallback(async () => {
    if (!token) return;
    setUnlockBusy(true);
    setUnlockError('');
    try {
      const res = await fetch(apiPath('/api/auth/unlock_feature'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ phone: phone.trim(), password: unlockPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || '验证失败');
      }
      setUnlockOpen(false);
      const r = unlockResolverRef.current;
      unlockResolverRef.current = null;
      if (r) r(true);
    } catch (e) {
      setUnlockError(e.message || String(e));
    } finally {
      setUnlockBusy(false);
    }
  }, [token, phone, unlockPassword]);

  const cancelUnlock = useCallback(() => {
    setUnlockOpen(false);
    const r = unlockResolverRef.current;
    unlockResolverRef.current = null;
    if (r) r(false);
  }, []);

  const value = useMemo(
    () => ({
      authRequired,
      token,
      phone,
      user,
      login,
      register,
      logout,
      getAuthHeaders,
      ensureFeatureUnlocked,
    }),
    [
      authRequired,
      token,
      phone,
      user,
      login,
      register,
      logout,
      getAuthHeaders,
      ensureFeatureUnlocked,
    ]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {unlockOpen && (
        <div className="feature-unlock-overlay" role="dialog" aria-modal="true" aria-labelledby="feature-unlock-title">
          <div className="feature-unlock-card">
            <h2 id="feature-unlock-title">使用功能前验证</h2>
            <p className="feature-unlock-hint">调用 AI 能力前需确认账号密码（验证后一段时间内有效）。</p>
            <label className="feature-unlock-label">
              手机号
              <input
                type="tel"
                className="feature-unlock-input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="username"
              />
            </label>
            <label className="feature-unlock-label">
              密码
              <input
                type="password"
                className="feature-unlock-input"
                value={unlockPassword}
                onChange={(e) => setUnlockPassword(e.target.value)}
                autoComplete="current-password"
                onKeyDown={(e) => e.key === 'Enter' && submitUnlock()}
              />
            </label>
            {unlockError ? <p className="feature-unlock-err">{unlockError}</p> : null}
            <div className="feature-unlock-actions">
              <button type="button" className="feature-unlock-btn secondary" onClick={cancelUnlock}>
                取消
              </button>
              <button
                type="button"
                className="feature-unlock-btn primary"
                disabled={unlockBusy}
                onClick={submitUnlock}
              >
                {unlockBusy ? '验证中…' : '验证并继续'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    return {
      authRequired: false,
      token: '',
      phone: '',
      user: null,
      login: async () => {},
      register: async () => {},
      logout: async () => {},
      getAuthHeaders: () => ({}),
      ensureFeatureUnlocked: async () => true,
    };
  }
  return ctx;
}
