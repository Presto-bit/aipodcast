import React from 'react';

/** 主页：品牌欢迎区 + 快捷入口 */
function HomePanel({ onNavigate }) {
  const primary = [
    {
      id: 'notes_podcast',
      title: '笔记出播客',
      desc: '勾选笔记，一键生成播客或文章',
      emoji: '📝',
    },
    {
      id: 'generator',
      title: 'AI 播客',
      desc: '从话题/网页/PDF 生成双人播客',
      emoji: '🎙️',
    },
    {
      id: 'tts',
      title: '文本转语音',
      desc: '把文字变成自然拟人的配音',
      emoji: '🔊',
    },
  ];

  const secondary = [
    { id: 'my_works', title: '我的作品', desc: '统一管理导出与文件夹', emoji: '🗂️' },
    { id: 'tone_management', title: '音色管理', desc: '你的声音 + 音色库', emoji: '🎚️' },
    { id: 'drafts', title: '播客草稿箱', desc: '草稿、进度与素材管理', emoji: '📦' },
  ];

  return (
    <div className="home-panel">
      <div className="section home-panel-hero">
        <div className="home-panel-hero-inner">
          <div className="home-panel-hero-copy">
            <p className="home-panel-kicker">发现你声音的力量</p>
            <h1 className="home-panel-title">一键生成播客、文章与语音</h1>
            <p className="home-panel-lead">
              把你的笔记、网页与 PDF 转化为可发布的内容。支持音色管理、流式生成、作品归档与下载。
            </p>
            <div className="home-panel-cta">
              <button type="button" className="home-panel-cta-btn primary" onClick={() => onNavigate('notes_podcast')}>
                立即开始
              </button>
              <button type="button" className="home-panel-cta-btn" onClick={() => onNavigate('my_works')}>
                查看我的作品
              </button>
            </div>
          </div>
          <div className="home-panel-hero-preview" aria-hidden>
            <div className="home-panel-preview-card">
              <div className="home-panel-preview-row">
                <span className="home-panel-preview-dot on" />
                <span className="home-panel-preview-dot" />
                <span className="home-panel-preview-dot" />
              </div>
              <div className="home-panel-preview-title">内容工作台</div>
              <div className="home-panel-preview-lines">
                <div className="home-panel-preview-line w90" />
                <div className="home-panel-preview-line w76" />
                <div className="home-panel-preview-line w82" />
              </div>
              <div className="home-panel-preview-pills">
                <span className="home-panel-preview-pill">笔记出播客</span>
                <span className="home-panel-preview-pill">AI 播客</span>
                <span className="home-panel-preview-pill">文本转语音</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="home-panel-section home-panel-section--intro">
        <div className="home-panel-intro-card">
          <h2 className="home-panel-section-title">产品介绍</h2>
          <p className="home-panel-intro-text">
            FindingYourVoice 是面向个人创作者的增长型内容工作台。把灵感、笔记、网页和文档快速转成可发布的播客、文章与配音内容，持续提升更新频率、完播体验与账号活跃度。你只需要专注选题和观点，剩下的生成、整理、复用和分发节奏交给系统。
          </p>
          <div className="home-panel-intro-points">
            <span className="home-panel-intro-point">提效：1 份素材，多平台复用</span>
            <span className="home-panel-intro-point">增长：稳定更新，持续产出</span>
            <span className="home-panel-intro-point">沉淀：作品资产可检索可管理</span>
          </div>
        </div>
      </div>

      <div className="home-panel-section">
        <div className="home-panel-section-head">
          <h2 className="home-panel-section-title">核心能力</h2>
          <p className="home-panel-section-sub">从输入到成片，覆盖创作全链路。</p>
        </div>
        <div className="home-panel-grid">
          {primary.map((c) => (
            <button
              key={c.id}
              type="button"
              className="home-panel-card home-panel-card--primary"
              onClick={() => onNavigate(c.id)}
            >
              <span className="home-panel-card-emoji" aria-hidden>
                {c.emoji}
              </span>
              <span className="home-panel-card-title">{c.title}</span>
              <span className="home-panel-card-desc">{c.desc}</span>
              <span className="home-panel-card-go">进入 →</span>
            </button>
          ))}
        </div>
      </div>

      <div className="home-panel-section">
        <div className="home-panel-section-head">
          <h2 className="home-panel-section-title">管理与沉淀</h2>
          <p className="home-panel-section-sub">把内容资产可视化、可复用、可下载。</p>
        </div>
        <div className="home-panel-grid home-panel-grid--secondary">
          {secondary.map((c) => (
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

      <div className="home-panel-section home-panel-section--examples">
        <div className="home-panel-section-head">
          <h2 className="home-panel-section-title">示例灵感</h2>
          <p className="home-panel-section-sub">直接复制到你的素材/提词中即可开跑。</p>
        </div>
        <div className="home-panel-examples">
          <div className="home-panel-example">
            <div className="home-panel-example-title">咨询决策简报</div>
            <div className="home-panel-example-body">
              你现在是顶级咨询公司的资深顾问。请将资料转化为“决策简报”：核心背景（≤500字）+ 5条关键信息清单 + 挑战与机遇。
            </div>
          </div>
          <div className="home-panel-example">
            <div className="home-panel-example-title">爆款推文结构</div>
            <div className="home-panel-example-body">
              反直觉标题 + 场景/痛点切入 + 大白话解释 + 个人 POV + 结尾引发评论。
            </div>
          </div>
          <div className="home-panel-example">
            <div className="home-panel-example-title">知识点手册</div>
            <div className="home-panel-example-body">
              5-10 个核心术语解释 + 3 个底层原理 + 3 道思考题与参考答案，结构严谨、层次分明。
            </div>
          </div>
        </div>
      </div>

      <div className="home-panel-bottom-cta">
        <div className="home-panel-bottom-cta-card">
          <div className="home-panel-bottom-cta-title">准备好开始创作了吗？</div>
          <div className="home-panel-bottom-cta-sub">从「笔记出播客」开始，最快 1 分钟出结果。</div>
          <button
            type="button"
            className="home-panel-cta-btn primary"
            onClick={() => onNavigate('notes_podcast')}
          >
            去生成
          </button>
        </div>
      </div>
    </div>
  );
}

export default HomePanel;
