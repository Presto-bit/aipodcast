import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TTS_IMPORT_SCRIPT_KEY } from './TextToSpeechPanel';
import './DraftsPanel.css';

const DRAFTS_STORAGE_KEY = 'fym_podcast_drafts_v1';

function loadDrafts() {
  try {
    const raw = window.localStorage.getItem(DRAFTS_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function saveDrafts(list) {
  try {
    window.localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify((list || []).slice(0, 100)));
  } catch (e) {
    // ignore
  }
}

function nowIso() {
  return new Date().toISOString();
}

function formatIsoShort(iso) {
  const raw = String(iso || '').trim();
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}

export default function DraftsPanel({ onNavigateToTts }) {
  const [drafts, setDrafts] = useState(() => loadDrafts());
  const [activeId, setActiveId] = useState(() => (loadDrafts()[0]?.id ? String(loadDrafts()[0].id) : null));
  const [titleInput, setTitleInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [dirty, setDirty] = useState(false);
  const lastLoadedIdRef = useRef(null);
  const autosaveTimerRef = useRef(null);

  const sortedDrafts = useMemo(() => {
    const arr = Array.isArray(drafts) ? drafts.slice() : [];
    arr.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return arr;
  }, [drafts]);

  const activeDraft = useMemo(() => {
    if (!activeId) return null;
    return sortedDrafts.find((d) => String(d.id) === String(activeId)) || null;
  }, [sortedDrafts, activeId]);

  useEffect(() => {
    if (!activeDraft) {
      if (sortedDrafts[0]?.id) setActiveId(String(sortedDrafts[0].id));
      return;
    }
    const sid = String(activeDraft.id);
    if (lastLoadedIdRef.current === sid) return;
    lastLoadedIdRef.current = sid;
    setTitleInput(String(activeDraft.title || '').trim() || '未命名草稿');
    setTextInput(String(activeDraft.text || ''));
    setDirty(false);
  }, [activeDraft, sortedDrafts]);

  const createDraft = useCallback(() => {
    const id = `${Date.now()}`;
    const t = nowIso();
    const entry = {
      id,
      title: '未命名草稿',
      text: '',
      createdAt: t,
      updatedAt: t,
    };
    const next = [entry, ...sortedDrafts].slice(0, 100);
    setDrafts(next);
    saveDrafts(next);
    setActiveId(id);
  }, [sortedDrafts]);

  // 删除功能已改为卡片标题右侧入口（deleteDraftById）

  const saveActive = useCallback(() => {
    if (!activeDraft) return;
    const sid = String(activeDraft.id);
    const title = String(titleInput || '').trim() || '未命名草稿';
    const text = String(textInput || '');
    const t = nowIso();
    const next = sortedDrafts.map((d) =>
      String(d.id) === sid ? { ...d, title, text, updatedAt: t } : d
    );
    setDrafts(next);
    saveDrafts(next);
    setDirty(false);
  }, [activeDraft, sortedDrafts, titleInput, textInput]);

  const renameDraftById = useCallback(
    (id) => {
      const sid = String(id || '').trim();
      if (!sid) return;
      const target = sortedDrafts.find((d) => String(d.id) === sid);
      const current = String(target?.title || '').trim() || '未命名草稿';
      const nextTitleRaw = window.prompt('输入新名称', current);
      const nextTitle = String(nextTitleRaw || '').trim();
      if (!nextTitle) return;
      const t = nowIso();
      const next = sortedDrafts.map((d) => (String(d.id) === sid ? { ...d, title: nextTitle, updatedAt: t } : d));
      setDrafts(next);
      saveDrafts(next);
      if (String(activeId) === sid) {
        setTitleInput(nextTitle);
        setDirty(true);
      }
    },
    [sortedDrafts, activeId]
  );

  const deleteDraftById = useCallback(
    (id) => {
      const sid = String(id || '').trim();
      if (!sid) return;
      const target = sortedDrafts.find((d) => String(d.id) === sid);
      const label = String(target?.title || '').trim() || '该草稿';
      // eslint-disable-next-line no-restricted-globals
      if (!window.confirm(`确定删除「${label}」吗？`)) return;
      const next = sortedDrafts.filter((d) => String(d.id) !== sid);
      setDrafts(next);
      saveDrafts(next);
      if (String(activeId) === sid) {
        lastLoadedIdRef.current = null;
        setActiveId(next[0]?.id ? String(next[0].id) : null);
      }
    },
    [sortedDrafts, activeId]
  );

  // 自动保存：编辑后短暂延迟写入本地
  useEffect(() => {
    if (!activeDraft) return undefined;
    if (!dirty) return undefined;
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      saveActive();
    }, 800);
    return () => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    };
  }, [activeDraft, dirty, titleInput, textInput, saveActive]);

  const importToTts = useCallback(() => {
    if (!activeDraft) return;
    const text = String(textInput || '').trim();
    if (!text) {
      alert('草稿内容为空');
      return;
    }
    try {
      sessionStorage.setItem(TTS_IMPORT_SCRIPT_KEY, text);
    } catch (e) {
      // ignore
    }
    if (typeof onNavigateToTts === 'function') onNavigateToTts();
  }, [activeDraft, textInput, onNavigateToTts]);

  return (
    <div className="drafts-page">
      <div className="section drafts-hero">
        <h2 className="drafts-title">播客草稿箱</h2>
        <p className="drafts-sub">写下你的播客文稿，保存为草稿，随时导入「文本转语音」。</p>
      </div>

      <div className="section drafts-body">
        <div className="drafts-left">
          <div className="drafts-left-head">
            <button type="button" className="drafts-new-plus" onClick={createDraft} aria-label="新建草稿" title="新建草稿">
              ＋
            </button>
          </div>
          {sortedDrafts.length === 0 ? (
            <p className="tts-empty">暂无草稿</p>
          ) : (
            <div className="drafts-cards">
              {sortedDrafts.map((d) => {
                const sid = String(d.id);
                const active = sid === String(activeId);
                const title = String(d.title || '').trim() || '未命名草稿';
                const updated = formatIsoShort(d.updatedAt);
                const preview = String(d.text || '').trim().slice(0, 80);
                return (
                  <button
                    key={sid}
                    type="button"
                    className={`drafts-card ${active ? 'drafts-card--active' : ''}`}
                    onClick={() => setActiveId(sid)}
                  >
                    <div className="drafts-card-title-row">
                      <div
                        className="drafts-card-title"
                        title={title}
                        onDoubleClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          renameDraftById(sid);
                        }}
                      >
                        {title}
                      </div>
                      <button
                        type="button"
                        className="drafts-card-del"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          deleteDraftById(sid);
                        }}
                        aria-label="删除草稿"
                        title="删除"
                      >
                        ×
                      </button>
                    </div>
                    <div className="drafts-card-meta">
                      {updated ? `最近编辑 ${updated}` : '—'}
                    </div>
                    <div className="drafts-card-preview" title={preview}>
                      {preview || '（空草稿）'}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="drafts-right">
          {!activeDraft ? (
            <div className="drafts-editor-empty">
              <p className="tts-empty">选择一个草稿，或新建草稿开始编辑</p>
            </div>
          ) : (
            <div className="drafts-editor">
              <div className="drafts-editor-head">
                <input
                  className="drafts-title-input"
                  value={titleInput}
                  onChange={(e) => {
                    setTitleInput(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="草稿名称"
                />
                <div className="drafts-actions">
                  <button type="button" className="api-key-clear-btn" onClick={importToTts}>
                    导入文本转语音
                  </button>
                </div>
              </div>
              <textarea
                className="drafts-textarea"
                value={textInput}
                onChange={(e) => {
                  setTextInput(e.target.value);
                  setDirty(true);
                }}
                placeholder="在此编辑播客文稿…"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

