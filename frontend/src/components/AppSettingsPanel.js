import React, { useState } from 'react';
import { useI18n } from '../I18nContext';

const DISPLAY_NAME_KEY = 'minimax_aipodcast_display_name';

function readStoredDisplayName() {
  try {
    const v = (window.localStorage.getItem(DISPLAY_NAME_KEY) || '').trim();
    return v || '本地用户';
  } catch (e) {
    return '本地用户';
  }
}

function AppSettingsPanel({ onDisplayNameChange }) {
  const { lang, setLang, t } = useI18n();
  const [name, setName] = useState(() => readStoredDisplayName());

  const save = () => {
    const v = (name || '').trim() || '本地用户';
    try {
      window.localStorage.setItem(DISPLAY_NAME_KEY, v);
    } catch (e) {
      // ignore
    }
    setName(v);
    if (typeof onDisplayNameChange === 'function') onDisplayNameChange(v);
  };

  return (
    <div className="app-settings-panel">
      <div className="section">
        <h2>{t('settingsTitle')}</h2>
        <p className="input-description">{t('settingsHint')}</p>

        <div className="input-group">
          <label className="input-label" htmlFor="ui-lang-select">
            {t('settingsLang')}
          </label>
          <select
            id="ui-lang-select"
            className="api-key-input"
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            style={{ maxWidth: 280 }}
          >
            <option value="zh">{t('settingsLangZh')}</option>
            <option value="en">{t('settingsLangEn')}</option>
          </select>
        </div>

        <div className="input-group">
          <label className="input-label" htmlFor="display-name-input">
            {t('settingsDisplayName')}
          </label>
          <input
            id="display-name-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="在侧栏底部显示的名字"
            maxLength={32}
          />
          <button type="button" className="generate-btn" style={{ marginTop: 12 }} onClick={save}>
            {t('settingsSave')}
          </button>
        </div>
      </div>
    </div>
  );
}

export { DISPLAY_NAME_KEY };
export default AppSettingsPanel;
