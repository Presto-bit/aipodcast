import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from './I18nContext';
import { useAuth } from './AuthContext';
import './App.css';
import PodcastGenerator from './components/PodcastGenerator';
import SettingsPanel from './components/SettingsPanel';
import ApiConfigPanel from './components/ApiConfigPanel';
import HomePanel from './components/HomePanel';
import AppSettingsPanel, { DISPLAY_NAME_KEY } from './components/AppSettingsPanel';
import TextToSpeechPanel from './components/TextToSpeechPanel';
import YourVoicePanel from './components/YourVoicePanel';
import LoginScreen from './components/LoginScreen';
import SubscriptionPanel from './components/SubscriptionPanel';
import DraftsPanel from './components/DraftsPanel';
import NotesPodcastApp from './components/NotesPodcastApp';
import ToneManagementPanel from './components/ToneManagementPanel';
import MyWorksPanel from './components/MyWorksPanel';
import {
  IconHome,
  IconPodcast,
  IconTts,
  IconNotesPodcast,
  IconDrafts,
  IconVoiceCatalog,
  IconWorks,
  IconSubscription,
  IconSettings,
  IconApi,
  IconUser,
  IconChevronLeft,
  IconChevronRight,
} from './components/SidebarIcons';

const VALID_NAV_KEYS = [
  'home',
  'generator',
  'notes_podcast',
  'tts',
  'voice_clone',
  'drafts',
  'voice',
  'tone_management',
  'my_works',
  'subscription',
  'app_settings',
  'api',
];

const VALID_NAV = new Set(VALID_NAV_KEYS);

function readNavFromHash() {
  if (typeof window === 'undefined') return 'home';
  try {
    const key = (window.location.hash || '').replace(/^#/, '').trim();
    if (key && VALID_NAV.has(key)) return key;
  } catch (e) {
    // ignore
  }
  return 'home';
}

function SidebarNavButton({ active, collapsed, onClick, label, Icon }) {
  return (
    <button
      type="button"
      className={`sidebar-nav-btn ${active ? 'active' : ''}`}
      onClick={onClick}
      title={collapsed ? label : undefined}
    >
      <span className="sidebar-nav-btn-icon">
        <Icon />
      </span>
      {!collapsed && <span className="sidebar-nav-btn-label">{label}</span>}
    </button>
  );
}

function SidebarNavSubButton({ active, collapsed, onClick, label, Icon }) {
  return (
    <button
      type="button"
      className={`sidebar-nav-btn sidebar-nav-btn--sub ${active ? 'active' : ''}`}
      onClick={onClick}
      title={collapsed ? label : undefined}
    >
      <span className="sidebar-nav-btn-icon">
        <Icon />
      </span>
      {!collapsed && <span className="sidebar-nav-btn-label">{label}</span>}
    </button>
  );
}

function AppShell() {
  const { t } = useI18n();
  const {
    authRequired,
    token,
    login,
    register,
    logout,
    user,
  } = useAuth();
  const [activeNav, setActiveNav] = useState(readNavFromHash);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [displayName, setDisplayName] = useState('本地用户');

  const navigate = useCallback((nav) => {
    if (!VALID_NAV.has(nav)) return;
    setActiveNav(nav);
    const next = `#${nav}`;
    if (typeof window !== 'undefined' && window.location.hash !== next) {
      window.history.pushState({ nav }, '', next);
    }
  }, []);

  const refreshDisplayName = useCallback(() => {
    try {
      const v = (window.localStorage.getItem(DISPLAY_NAME_KEY) || '').trim();
      setDisplayName(v || '本地用户');
    } catch (e) {
      setDisplayName('本地用户');
    }
  }, []);

  useEffect(() => {
    refreshDisplayName();
  }, [refreshDisplayName]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.location.hash) {
      window.history.replaceState({ nav: 'home' }, '', '#home');
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const key = (window.location.hash || '').replace(/^#/, '').trim() || 'home';
      setActiveNav(VALID_NAV.has(key) ? key : 'home');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const toggleSidebarCollapsed = () => setSidebarCollapsed((v) => !v);

  if (authRequired === null) {
    return (
      <div className="App auth-loading">
        <p>加载中…</p>
      </div>
    );
  }

  if (authRequired && !token) {
    return <LoginScreen onLogin={login} onRegister={register} />;
  }

  const showPhone = user?.phone && user.phone !== 'local';

  return (
    <div className="App">
      <main
        className={`app-main app-layout ${sidebarCollapsed ? 'app-layout--sidebar-collapsed' : ''}`}
      >
        <aside className={`app-sidebar ${sidebarCollapsed ? 'app-sidebar--collapsed' : ''}`}>
          <div
            className={`sidebar-brand ${sidebarCollapsed ? 'sidebar-brand--collapsed' : ''}`}
            title="FindingYourVoice — From silence to influence"
          >
            <span className="sidebar-brand-mark">FYV</span>
            {!sidebarCollapsed && (
              <div className="sidebar-brand-copy">
                <span className="sidebar-brand-name">FindingYourVoice</span>
                <span className="sidebar-brand-slogan">From silence to influence</span>
                <span className="sidebar-brand-cn">发现你声音的力量</span>
              </div>
            )}
          </div>
          <nav className="sidebar-nav" aria-label="主导航">
            <SidebarNavButton
              active={activeNav === 'home'}
              collapsed={sidebarCollapsed}
              onClick={() => navigate('home')}
              label={t('navHome')}
              Icon={IconHome}
            />

            {!sidebarCollapsed && (
              <div className="sidebar-section-label" role="presentation">
                {t('navProducts')}
              </div>
            )}
            {sidebarCollapsed && <div className="sidebar-section-gap" aria-hidden />}

            <SidebarNavSubButton
              active={activeNav === 'notes_podcast'}
              collapsed={sidebarCollapsed}
              onClick={() => navigate('notes_podcast')}
              label={t('navNotesPodcast')}
              Icon={IconNotesPodcast}
            />
            <SidebarNavSubButton
              active={activeNav === 'generator'}
              collapsed={sidebarCollapsed}
              onClick={() => navigate('generator')}
              label={t('navPodcast')}
              Icon={IconPodcast}
            />
            <SidebarNavSubButton
              active={activeNav === 'tts'}
              collapsed={sidebarCollapsed}
              onClick={() => navigate('tts')}
              label={t('navTts')}
              Icon={IconTts}
            />
            <SidebarNavSubButton
              active={activeNav === 'tone_management'}
              collapsed={sidebarCollapsed}
              onClick={() => navigate('tone_management')}
              label={t('navVoices')}
              Icon={IconVoiceCatalog}
            />

            <SidebarNavButton
              active={activeNav === 'my_works'}
              collapsed={sidebarCollapsed}
              onClick={() => navigate('my_works')}
              label={t('navMyWorks')}
              Icon={IconWorks}
            />
            <SidebarNavSubButton
              active={activeNav === 'drafts'}
              collapsed={sidebarCollapsed}
              onClick={() => navigate('drafts')}
              label={t('navDrafts')}
              Icon={IconDrafts}
            />

            <div className="sidebar-divider" role="separator" />

            <SidebarNavButton
              active={activeNav === 'subscription'}
              collapsed={sidebarCollapsed}
              onClick={() => navigate('subscription')}
              label={t('navSubscription')}
              Icon={IconSubscription}
            />

            <SidebarNavButton
              active={activeNav === 'app_settings'}
              collapsed={sidebarCollapsed}
              onClick={() => navigate('app_settings')}
              label={t('navSettings')}
              Icon={IconSettings}
            />
            <SidebarNavButton
              active={activeNav === 'api'}
              collapsed={sidebarCollapsed}
              onClick={() => navigate('api')}
              label={t('navApi')}
              Icon={IconApi}
            />

            {authRequired && (
              <button
                type="button"
                className="sidebar-nav-btn sidebar-nav-btn--sub"
                onClick={() => logout()}
                title={sidebarCollapsed ? t('navLogout') : undefined}
              >
                <span className="sidebar-nav-btn-icon" aria-hidden>
                  <span className="sidebar-logout-icon">⎋</span>
                </span>
                {!sidebarCollapsed && <span className="sidebar-nav-btn-label">{t('navLogout')}</span>}
              </button>
            )}

            <button
              type="button"
              className={`sidebar-user-pill ${activeNav === 'app_settings' ? 'active' : ''}`}
              onClick={() => navigate('app_settings')}
              title={sidebarCollapsed ? `${displayName}（点击打开设置）` : undefined}
            >
              <span className="sidebar-nav-btn-icon">
                <IconUser />
              </span>
              {!sidebarCollapsed && (
                <span className="sidebar-user-pill-name">{displayName}</span>
              )}
            </button>
          </nav>

          <div className="sidebar-footer">
            <button
              type="button"
              className="sidebar-rail-toggle"
              onClick={toggleSidebarCollapsed}
              aria-label={sidebarCollapsed ? t('navExpand') : t('navCollapse')}
              title={sidebarCollapsed ? t('navExpand') : t('navCollapse')}
            >
              <span className="sidebar-rail-toggle-icon">
                {sidebarCollapsed ? <IconChevronRight /> : <IconChevronLeft />}
              </span>
              {!sidebarCollapsed && <span className="sidebar-rail-toggle-text">{t('navCollapse')}</span>}
            </button>
          </div>
        </aside>

        <section className="app-content">
          {activeNav === 'home' && <HomePanel onNavigate={navigate} />}
          {activeNav === 'generator' && (
            <PodcastGenerator
              showApiConfig={false}
              notesPodcastMode={false}
              onNavigateToTts={() => navigate('tts')}
            />
          )}
          {activeNav === 'notes_podcast' && <NotesPodcastApp />}
          {activeNav === 'my_works' && <MyWorksPanel />}
          {activeNav === 'tts' && (
            <TextToSpeechPanel />
          )}
          {activeNav === 'voice_clone' && <YourVoicePanel />}
          {activeNav === 'voice' && <SettingsPanel variant="catalog" />}
          {activeNav === 'tone_management' && <ToneManagementPanel />}
          {activeNav === 'drafts' && <DraftsPanel onNavigateToTts={() => navigate('tts')} />}
          {activeNav === 'subscription' && <SubscriptionPanel />}
          {activeNav === 'app_settings' && (
            <AppSettingsPanel onDisplayNameChange={refreshDisplayName} />
          )}
          {activeNav === 'api' && <ApiConfigPanel />}
        </section>
      </main>
      <footer className="app-footer">
        <p className="app-footer-line-en">FindingYourVoice · From silence to influence</p>
        <p className="fym-tagline-cn">发现你声音的力量</p>
        {showPhone && (
          <p className="app-footer-account">已登录 {user.phone}</p>
        )}
      </footer>
    </div>
  );
}

export default function App() {
  return <AppShell />;
}
