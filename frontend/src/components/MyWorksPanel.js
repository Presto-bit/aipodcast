import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { resolveMediaUrl } from '../apiBaseUrl';
import { downloadWorkBundleZip } from '../workBundleDownload';
import WorkCoverImg from './WorkCoverImg';
import { getWorkCoverSrc } from '../workCoverImageUrl';
import './MyWorksPanel.css';
import './podcastWorkCards.css';

const NOTES_OUTPUTS_KEY = 'fym_notes_room_outputs_v1';
const AI_PODCAST_WORKS_KEY = 'fym_podcast_works_v1';
const TTS_WORKS_KEY = 'fym_tts_works_v1';

const NOTES_OUTPUTS_SLICE = 200;
const AI_PODCAST_WORKS_SLICE = 30;
const TTS_WORKS_SLICE = 20;

const FOLDERS_NOTES_KEY = 'fym_my_works_folders_notes_v1';
const FOLDERS_AI_KEY = 'fym_my_works_folders_ai_v1';
const FOLDERS_TTS_KEY = 'fym_my_works_folders_tts_v1';

function safeJsonParse(raw, fallback) {
  try {
    const v = raw ? JSON.parse(raw) : fallback;
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function loadWorksList(key, slice) {
  try {
    const raw = window.localStorage.getItem(key);
    const arr = safeJsonParse(raw, []);
    if (!Array.isArray(arr)) return [];
    return (slice ? arr.slice(0, slice) : arr);
  } catch {
    return [];
  }
}

function saveWorksList(key, slice, list) {
  try {
    window.localStorage.setItem(key, JSON.stringify((list || []).slice(0, slice || 200)));
  } catch {
    // ignore
  }
}

function loadFoldersList(key) {
  return loadWorksList(key, 200);
}

function saveFoldersList(key, list) {
  try {
    window.localStorage.setItem(key, JSON.stringify((list || []).slice(0, 200)));
  } catch {
    // ignore
  }
}

function formatCreatedAt(iso) {
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

function MyWorksPanel() {
  const { getAuthHeaders } = useAuth();

  const [notesOutputs, setNotesOutputs] = useState(() => loadWorksList(NOTES_OUTPUTS_KEY, NOTES_OUTPUTS_SLICE));
  const [aiWorks, setAiWorks] = useState(() => loadWorksList(AI_PODCAST_WORKS_KEY, AI_PODCAST_WORKS_SLICE));
  const [ttsWorks, setTtsWorks] = useState(() => loadWorksList(TTS_WORKS_KEY, TTS_WORKS_SLICE));

  const [notesFolders, setNotesFolders] = useState(() => loadFoldersList(FOLDERS_NOTES_KEY));
  const [aiFolders, setAiFolders] = useState(() => loadFoldersList(FOLDERS_AI_KEY));
  const [ttsFolders, setTtsFolders] = useState(() => loadFoldersList(FOLDERS_TTS_KEY));

  const [notesFolderFilter, setNotesFolderFilter] = useState('all'); // all | inbox | folderId
  const [aiFolderFilter, setAiFolderFilter] = useState('all');
  const [ttsFolderFilter, setTtsFolderFilter] = useState('all');

  const [playingByCat, setPlayingByCat] = useState({ notes: null, ai: null, tts: null });
  const [zipBusyKey, setZipBusyKey] = useState(null);
  const [menuOpenKey, setMenuOpenKey] = useState(null); // `${cat}:${id}`
  const [menuDir, setMenuDir] = useState({}); // key -> 'up' | 'down'
  const menuRefs = useRef({});
  const [openNotes, setOpenNotes] = useState(false);
  const [openAi, setOpenAi] = useState(false);
  const [openTts, setOpenTts] = useState(false);

  useEffect(() => {
    if (!menuOpenKey) return undefined;
    const onDoc = (e) => {
      const anchor = menuRefs.current?.[String(menuOpenKey)];
      if (anchor && anchor.contains(e.target)) return;
      setMenuOpenKey(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpenKey]);

  const notesWorks = useMemo(() => notesOutputs.filter((w) => w && w.type === 'podcast'), [notesOutputs]);
  const notesWorksSorted = useMemo(() => {
    const arr = Array.isArray(notesWorks) ? [...notesWorks] : [];
    arr.sort((a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime());
    return arr;
  }, [notesWorks]);

  const aiWorksSorted = useMemo(() => {
    const arr = Array.isArray(aiWorks) ? [...aiWorks] : [];
    arr.sort((a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime());
    return arr;
  }, [aiWorks]);

  const ttsWorksSorted = useMemo(() => {
    const arr = Array.isArray(ttsWorks) ? [...ttsWorks] : [];
    arr.sort((a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime());
    return arr;
  }, [ttsWorks]);

  const folderMatch = useCallback((w, filter) => {
    if (filter === 'all') return true;
    const fid = w?.folderId || null;
    if (filter === 'inbox') return !fid;
    return String(fid) === String(filter);
  }, []);

  const notesShown = useMemo(() => notesWorksSorted.filter((w) => folderMatch(w, notesFolderFilter)), [notesWorksSorted, notesFolderFilter, folderMatch]);
  const aiShown = useMemo(() => aiWorksSorted.filter((w) => folderMatch(w, aiFolderFilter)), [aiWorksSorted, aiFolderFilter, folderMatch]);
  const ttsShown = useMemo(() => ttsWorksSorted.filter((w) => folderMatch(w, ttsFolderFilter)), [ttsWorksSorted, ttsFolderFilter, folderMatch]);

  const createFolder = useCallback((cat) => {
    const nameRaw = window.prompt('请输入文件夹名称');
    const name = String(nameRaw || '').trim();
    if (!name) return;
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    if (cat === 'notes') {
      setNotesFolders((prev) => {
        const next = [...(Array.isArray(prev) ? prev : []), { id, name, createdAt: now }];
        saveFoldersList(FOLDERS_NOTES_KEY, next);
        return next;
      });
      setNotesFolderFilter(id);
      setOpenNotes(true);
    } else if (cat === 'ai') {
      setAiFolders((prev) => {
        const next = [...(Array.isArray(prev) ? prev : []), { id, name, createdAt: now }];
        saveFoldersList(FOLDERS_AI_KEY, next);
        return next;
      });
      setAiFolderFilter(id);
      setOpenAi(true);
    } else {
      setTtsFolders((prev) => {
        const next = [...(Array.isArray(prev) ? prev : []), { id, name, createdAt: now }];
        saveFoldersList(FOLDERS_TTS_KEY, next);
        return next;
      });
      setTtsFolderFilter(id);
      setOpenTts(true);
    }
  }, []);

  const moveWorkToFolder = useCallback((cat, workId, folderId) => {
    const sid = String(workId || '').trim();
    if (!sid) return;
    const fid = String(folderId || '').trim();
    const nextFolderId = fid ? fid : null;

    if (cat === 'notes') {
      setNotesOutputs((prev) => {
        const next = (Array.isArray(prev) ? prev : []).map((w) => (String(w?.id) === sid ? { ...w, folderId: nextFolderId } : w));
        saveWorksList(NOTES_OUTPUTS_KEY, NOTES_OUTPUTS_SLICE, next);
        return next;
      });
    } else if (cat === 'ai') {
      setAiWorks((prev) => {
        const next = (Array.isArray(prev) ? prev : []).map((w) => (String(w?.id) === sid ? { ...w, folderId: nextFolderId } : w));
        saveWorksList(AI_PODCAST_WORKS_KEY, AI_PODCAST_WORKS_SLICE, next);
        return next;
      });
    } else {
      setTtsWorks((prev) => {
        const next = (Array.isArray(prev) ? prev : []).map((w) => (String(w?.id) === sid ? { ...w, folderId: nextFolderId } : w));
        saveWorksList(TTS_WORKS_KEY, TTS_WORKS_SLICE, next);
        return next;
      });
    }
  }, []);

  const deleteWork = useCallback(
    (cat, workId) => {
      const sid = String(workId || '').trim();
      if (!sid) return;
      // eslint-disable-next-line no-restricted-globals
      if (!window.confirm('确定删除该作品吗？')) return;
      if (cat === 'notes') {
        setNotesOutputs((prev) => {
          const next = (Array.isArray(prev) ? prev : []).filter((w) => String(w?.id) !== sid);
          saveWorksList(NOTES_OUTPUTS_KEY, NOTES_OUTPUTS_SLICE, next);
          return next;
        });
      } else if (cat === 'ai') {
        setAiWorks((prev) => {
          const next = (Array.isArray(prev) ? prev : []).filter((w) => String(w?.id) !== sid);
          saveWorksList(AI_PODCAST_WORKS_KEY, AI_PODCAST_WORKS_SLICE, next);
          return next;
        });
      } else {
        setTtsWorks((prev) => {
          const next = (Array.isArray(prev) ? prev : []).filter((w) => String(w?.id) !== sid);
          saveWorksList(TTS_WORKS_KEY, TTS_WORKS_SLICE, next);
          return next;
        });
      }
      setPlayingByCat((p) => ({ ...p, [cat]: String(p[cat]) === sid ? null : p[cat] }));
    },
    []
  );

  const downloadWork = useCallback(
    async (cat, work) => {
      const sid = String(work?.id || '').trim();
      if (!sid) return;
      const audioUrl = work?.audioUrl || '';
      if (!audioUrl) {
        window.alert('该作品缺少可下载音频');
        return;
      }
      const key = `${cat}:${sid}`;
      setZipBusyKey(key);
      try {
        await downloadWorkBundleZip({
          title: work?.title || '未命名',
          audioUrl: work?.audioUrl,
          scriptText: String(work?.scriptText || '').trim(),
          scriptUrl: work?.scriptUrl,
          coverRaw: work?.coverImage || work?.cover_image,
          getAuthHeaders,
        });
      } catch (e) {
        window.alert(e?.message || String(e));
      } finally {
        setZipBusyKey(null);
      }
    },
    [getAuthHeaders]
  );

  const renderSection = (cat, title, shownWorks, folders, folderFilter, setFolderFilter, open, setOpen) => {
    const getFolders = () => (Array.isArray(folders) ? folders : []);
    const shown = Array.isArray(shownWorks) ? shownWorks : [];

    return (
      <details
        className="my-works-section"
        open={open}
        onToggle={(e) => setOpen(e.currentTarget.open)}
      >
        <summary className="my-works-section-summary">
          <span className="my-works-section-title">{title}</span>
          <span className="my-works-section-count">{shown.length}</span>
        </summary>

        <div className="my-works-section-body">
          <div className="my-works-section-head">
            <div className="my-works-toolbar">
              <label className="my-works-folder-label">
                <span>筛选</span>
                <select value={folderFilter} onChange={(e) => setFolderFilter(e.target.value)}>
                  <option value="all">全部</option>
                  <option value="inbox">未归类</option>
                  {getFolders().map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="my-works-new-folder-btn" onClick={() => createFolder(cat)}>
                新建文件夹
              </button>
            </div>
          </div>

          <div className="my-works-folder-chips" role="tablist" aria-label={`${title} 文件夹`}>
            {[
              { id: 'all', name: '全部' },
              { id: 'inbox', name: '未归类' },
              ...getFolders().map((f) => ({ id: f.id, name: f.name })),
            ].map((f) => {
              const on = String(folderFilter) === String(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  className={`my-works-folder-chip ${on ? 'my-works-folder-chip--on' : ''}`}
                  onClick={() => setFolderFilter(String(f.id))}
                  title={String(f.name)}
                >
                  {f.name}
                </button>
              );
            })}
          </div>

          {shown.length === 0 ? (
            <p className="my-works-empty">暂无作品</p>
          ) : (
            <div className="podcast-work-cards">
              {shown.map((w) => {
              const sid = String(w.id);
              const titleRaw = String(w.title || '').trim();
              const titleText = titleRaw || '未命名';
              const createdText = formatCreatedAt(w.createdAt);
              const speakersText = String(w.speakers || '').trim();
              const durationHintText = String(w.durationHint || '').trim();
              const metaParts = [speakersText, durationHintText, createdText].filter(Boolean);
              const metaText = metaParts.join(' · ');

              const coverSrc = getWorkCoverSrc(w.coverImage || w.cover_image);
              const audioUrl = w.audioUrl;
              const isPlaying = String(playingByCat[cat]) === sid;
              const workKey = `${cat}:${sid}`;
              const isMenuOpen = String(menuOpenKey) === workKey;

              return (
                <div key={sid} className="podcast-work-card">
                  <div className="podcast-work-card-cover">
                    <WorkCoverImg src={coverSrc} />
                  </div>
                  <div className="podcast-work-card-body">
                    <div className="podcast-work-card-title-row">
                      <div className="podcast-work-card-title" title={titleText}>
                        {titleText}
                      </div>
                      <button
                        type="button"
                        className="podcast-work-card-play"
                        onClick={() =>
                          setPlayingByCat((p) => {
                            const nextOpen = isPlaying ? null : sid;
                            return { ...p, [cat]: nextOpen };
                          })
                        }
                        aria-label="播放"
                        title="播放"
                        disabled={!audioUrl}
                      >
                        ▶
                      </button>
                      <div
                        className="tts-work-menu"
                        ref={(el) => {
                          if (!workKey) return;
                          if (el) menuRefs.current[String(workKey)] = el;
                        }}
                      >
                        <button
                          type="button"
                          className={`tts-work-more ${isMenuOpen ? 'tts-work-more--on' : ''}`}
                          onClick={() => {
                            const nextOpen = isMenuOpen ? null : workKey;
                            if (nextOpen) {
                              try {
                                const anchor = menuRefs.current?.[String(workKey)];
                                const rect = anchor?.getBoundingClientRect?.();
                                const vh = window.innerHeight || 800;
                                const spaceBelow = rect ? vh - rect.bottom : 9999;
                                const openUp = spaceBelow < 260;
                                setMenuDir((prev) => ({
                                  ...(prev || {}),
                                  [String(workKey)]: openUp ? 'up' : 'down',
                                }));
                              } catch (e) {
                                // ignore
                              }
                            }
                            setMenuOpenKey(nextOpen);
                          }}
                          aria-label="更多"
                          title="更多"
                        >
                          …
                        </button>
                        {isMenuOpen && (
                          <div
                            className={`tts-work-dropdown ${
                              menuDir[String(workKey)] === 'up' ? 'tts-work-dropdown--up' : ''
                            }`}
                            role="menu"
                            aria-label="作品操作"
                            style={{ right: 0, left: 'auto' }}
                          >
                            <div className="tts-work-dd-item tts-work-dd-item--row" role="menuitem">
                              <span className="tts-work-dd-label">移动到文件夹</span>
                              <select
                                className="tts-work-rate"
                                value={w.folderId ? String(w.folderId) : ''}
                                onChange={(e) => {
                                  moveWorkToFolder(cat, sid, e.target.value);
                                }}
                                aria-label="移动到文件夹"
                              >
                                <option value="">未归类</option>
                                {getFolders().map((f) => (
                                  <option key={f.id} value={f.id}>
                                    {f.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <button
                              type="button"
                              className="tts-work-dd-item"
                              role="menuitem"
                              disabled={zipBusyKey === workKey || !audioUrl}
                              onClick={() => {
                                setMenuOpenKey(null);
                                downloadWork(cat, w);
                              }}
                            >
                              {zipBusyKey === workKey ? '打包中…' : '打包下载'}
                            </button>
                            <button
                              type="button"
                              className="tts-work-dd-item tts-work-dd-danger"
                              role="menuitem"
                              onClick={() => {
                                setMenuOpenKey(null);
                                deleteWork(cat, sid);
                              }}
                            >
                              删除
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="podcast-work-card-meta">
                      {metaText ? (
                        <span className="podcast-work-card-meta-item podcast-work-card-meta-item--clamp" title={metaText}>
                          {metaText}
                        </span>
                      ) : (
                        <span className="podcast-work-card-meta-item podcast-work-card-meta-item--muted">—</span>
                      )}
                    </div>

                    {isPlaying && audioUrl && (
                      <div className="podcast-work-card-inline-player">
                        <audio
                          className="podcast-work-card-inline-audio"
                          controls
                          src={resolveMediaUrl(audioUrl)}
                          preload="none"
                          onPlay={() => {
                            setPlayingByCat((p) => ({ notes: null, ai: null, tts: null, [cat]: sid }));
                          }}
                        />
                        <div className="podcast-work-card-inline-actions">
                          <button
                            type="button"
                            className="api-key-clear-btn podcast-work-card-inline-close"
                            onClick={() => setPlayingByCat((p) => ({ ...p, [cat]: null }))}
                          >
                            收起
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
              })}
            </div>
          )}
        </div>
      </details>
    );
  };

  return (
    <div className="my-works-page">
      <div className="section my-works-hero">
        <h1 className="my-works-hero-title">我的作品</h1>
        <p className="my-works-hero-sub">按创作时间聚合浏览，并用文件夹管理不同类型作品。</p>
      </div>

      {renderSection('notes', '笔记出播客', notesShown, notesFolders, notesFolderFilter, setNotesFolderFilter, openNotes, setOpenNotes)}
      {renderSection('ai', 'AI 播客', aiShown, aiFolders, aiFolderFilter, setAiFolderFilter, openAi, setOpenAi)}
      {renderSection('tts', '文本转语音', ttsShown, ttsFolders, ttsFolderFilter, setTtsFolderFilter, openTts, setOpenTts)}
    </div>
  );
}

export default MyWorksPanel;

