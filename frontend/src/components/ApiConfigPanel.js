import React, { useEffect, useState } from 'react';

const API_KEY_STORAGE_KEY = 'minimax_aipodcast_api_key';

const ApiConfigPanel = () => {
  const [apiKey, setApiKey] = useState('');
  const [rememberApiKey, setRememberApiKey] = useState(true);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(API_KEY_STORAGE_KEY);
      if (saved && saved.trim()) {
        setApiKey(saved);
        setRememberApiKey(true);
      }
    } catch (e) {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      if (!rememberApiKey) {
        window.localStorage.removeItem(API_KEY_STORAGE_KEY);
        return;
      }
      if (apiKey.trim()) {
        window.localStorage.setItem(API_KEY_STORAGE_KEY, apiKey.trim());
      }
    } catch (e) {
      // ignore
    }
  }, [apiKey, rememberApiKey]);

  const clearSavedApiKey = () => {
    setApiKey('');
    setRememberApiKey(false);
    try {
      window.localStorage.removeItem(API_KEY_STORAGE_KEY);
    } catch (e) {
      // ignore
    }
  };

  return (
    <div className="settings-panel">
      <div className="section">
        <h2>🔑 API 配置</h2>
        <div className="input-group">
          <label className="input-label">MiniMax API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="请输入 API Key"
            className="api-key-input"
          />
          <div className="api-key-actions">
            <label className="api-key-remember">
              <input
                type="checkbox"
                checked={rememberApiKey}
                onChange={(e) => setRememberApiKey(e.target.checked)}
              />
              记住 API Key（本机浏览器）
            </label>
            <button
              type="button"
              className="api-key-clear-btn"
              onClick={clearSavedApiKey}
              disabled={!apiKey && !rememberApiKey}
            >
              清除
            </button>
          </div>
          <p className="input-description">
            在 <a href="https://www.minimaxi.com/" target="_blank" rel="noopener noreferrer">MiniMax 官网</a> 获取你的 API Key
          </p>
        </div>
      </div>
    </div>
  );
};

export default ApiConfigPanel;
