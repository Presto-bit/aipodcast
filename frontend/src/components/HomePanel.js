import React from 'react';

/** 主页：品牌欢迎区 + 快捷入口 */
function HomePanel({ onNavigate }) {
  const cards = [
    { id: 'generator', title: 'AI 播客', desc: '从素材生成双人对话与语音', emoji: '🎙️' },
    { id: 'tts', title: '文本转语音', desc: '自带脚本，合成语音与成片', emoji: '🔊' },
    { id: 'notes', title: '笔记管理', desc: '整理知识库与参考笔记', emoji: '📝' },
  ];

  return (
    <div className="home-panel">
      <div className="section home-panel-hero">
        <h1 className="home-panel-title">欢迎使用</h1>
        <p className="home-panel-tagline-en">FindingYourVoice · From silence to influence</p>
        <p className="fym-tagline-cn">发现你声音的力量</p>
        <p className="home-panel-lead">解说素材、合成语音、管理音色与笔记。</p>
      </div>
      <div className="home-panel-grid">
        {cards.map((c) => (
          <button
            key={c.id}
            type="button"
            className="home-panel-card"
            onClick={() => onNavigate(c.id)}
          >
            <span className="home-panel-card-emoji" aria-hidden>
              {c.emoji}
            </span>
            <span className="home-panel-card-title">{c.title}</span>
            <span className="home-panel-card-desc">{c.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default HomePanel;
