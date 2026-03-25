import React, { useState } from 'react';
import './App.css';
import PodcastGenerator from './components/PodcastGenerator';
import SettingsPanel from './components/SettingsPanel';
import ApiConfigPanel from './components/ApiConfigPanel';
import NotesPanel from './components/NotesPanel';

function App() {
  const [activeNav, setActiveNav] = useState('generator');

  return (
    <div className="App">
      <header className="app-header">
        <h1>🎙️ AI播客生成器</h1>
        <p>智能生成专业播客</p>
      </header>
      <main className="app-main app-layout">
        <aside className="app-sidebar">
          <button
            type="button"
            className={`sidebar-item ${activeNav === 'generator' ? 'active' : ''}`}
            onClick={() => setActiveNav('generator')}
          >
            🎬 播客生成
          </button>
          <button
            type="button"
            className={`sidebar-item ${activeNav === 'api' ? 'active' : ''}`}
            onClick={() => setActiveNav('api')}
          >
            🔑 API配置
          </button>
          <button
            type="button"
            className={`sidebar-item ${activeNav === 'voice' ? 'active' : ''}`}
            onClick={() => setActiveNav('voice')}
          >
            🎧 音色管理
          </button>
          <button
            type="button"
            className={`sidebar-item ${activeNav === 'notes' ? 'active' : ''}`}
            onClick={() => setActiveNav('notes')}
          >
            📝 笔记管理
          </button>
        </aside>
        <section className="app-content">
          {activeNav === 'generator' && <PodcastGenerator showApiConfig={false} />}
          {activeNav === 'api' && <ApiConfigPanel />}
          {activeNav === 'voice' && <SettingsPanel />}
          {activeNav === 'notes' && <NotesPanel onGoGenerator={() => setActiveNav('generator')} />}
        </section>
      </main>
      <footer className="app-footer">
        <p>Powered by MiniMax AI | 🤖 Generated with Cursor</p>
      </footer>
    </div>
  );
}

export default App;
