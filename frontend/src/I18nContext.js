import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export const UI_LANG_KEY = 'minimax_aipodcast_ui_lang';

const DICT = {
  zh: {
    navHome: '主页',
    navProducts: '产品',
    navPodcast: 'AI 播客',
    navTts: '文本转语音',
    navYourVoice: '你的声音',
    navNotes: '笔记管理',
    navNotesPodcast: '笔记出播客',
    navVoices: '音色管理',
    navSubscription: '订阅',
    navLogout: '退出登录',
    navSettings: '设置',
    navApi: 'API',
    navDrafts: '播客草稿箱',
    navMyWorks: '我的作品',
    navCollapse: '收起',
    navExpand: '展开',
    settingsTitle: '设置',
    settingsHint: '本地偏好（仅存于本机浏览器）。',
    settingsLang: '界面语言',
    settingsLangZh: '中文',
    settingsLangEn: 'English',
    settingsDisplayName: '显示名称',
    settingsSave: '保存',
  },
  en: {
    navHome: 'Home',
    navProducts: 'Products',
    navPodcast: 'AI Podcast',
    navTts: 'Text to Speech',
    navYourVoice: 'Your Voice',
    navNotes: 'Notes',
    navNotesPodcast: 'Notes to Podcast',
    navVoices: 'Voices',
    navSubscription: 'Subscription',
    navLogout: 'Log out',
    navSettings: 'Settings',
    navApi: 'API',
    navDrafts: 'Drafts',
    navMyWorks: 'My Works',
    navCollapse: 'Collapse',
    navExpand: 'Expand',
    settingsTitle: 'Settings',
    settingsHint: 'Local preferences (stored in this browser only).',
    settingsLang: 'Language',
    settingsLangZh: '中文',
    settingsLangEn: 'English',
    settingsDisplayName: 'Display name',
    settingsSave: 'Save',
  },
};

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try {
      const s = window.localStorage.getItem(UI_LANG_KEY);
      if (s === 'en' || s === 'zh') return s;
    } catch (e) {
      // ignore
    }
    return 'zh';
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(UI_LANG_KEY, lang);
      document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
    } catch (e) {
      // ignore
    }
  }, [lang]);

  const setLang = useCallback((l) => {
    if (l === 'en' || l === 'zh') setLangState(l);
  }, []);

  const value = useMemo(() => {
    const table = DICT[lang] || DICT.zh;
    const t = (key) => table[key] || DICT.zh[key] || key;
    return { lang, setLang, t };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    const t = (key) => DICT.zh[key] || key;
    return { lang: 'zh', setLang: () => {}, t };
  }
  return ctx;
}
