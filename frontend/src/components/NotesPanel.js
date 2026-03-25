import React, { useEffect, useState, useRef } from 'react';
import { getApiBaseUrl } from '../apiBaseUrl';

const SELECTED_NOTES_KEY = 'minimax_aipodcast_selected_notes';

const shortenMiddle = (text, head = 18, tail = 12) => {
  const s = String(text || '');
  if (!s) return '';
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}...${s.slice(-tail)}`;
};

const NotesPanel = ({ onGoGenerator }) => {
  const [notes, setNotes] = useState([]);
  const [notebooks, setNotebooks] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [showNotebookModal, setShowNotebookModal] = useState(false);
  const [newNotebookName, setNewNotebookName] = useState('');
  const [selectedNotebook, setSelectedNotebook] = useState('默认笔记本');
  const [noteMenuOpenId, setNoteMenuOpenId] = useState(null);
  const [showRenameNoteModal, setShowRenameNoteModal] = useState(false);
  const [renameNoteId, setRenameNoteId] = useState('');
  const [renameNoteTitle, setRenameNoteTitle] = useState('');
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewTitle, setPreviewTitle] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [previewKeyword, setPreviewKeyword] = useState('');
  const [previewTruncated, setPreviewTruncated] = useState(false);

  const menuAnchorRef = useRef(null);

  const API_URL = getApiBaseUrl();

  const loadNotes = async () => {
    try {
      const params = new URLSearchParams();
      if (selectedNotebook) params.set('notebook', selectedNotebook);
      const query = params.toString();
      const resp = await fetch(`${API_URL}/api/notes${query ? `?${query}` : ''}`);
      if (!resp.ok) return;
      const data = await resp.json();
      if (data?.success && Array.isArray(data.notes)) {
        setNotes(data.notes);
      }
    } catch (e) {
      // ignore
    }
  };

  const loadNotebooks = async () => {
    try {
      const resp = await fetch(`${API_URL}/api/notebooks`);
      if (!resp.ok) return;
      const data = await resp.json();
      if (data?.success && Array.isArray(data.notebooks)) {
        setNotebooks(data.notebooks);
        if (!data.notebooks.includes(selectedNotebook)) {
          setSelectedNotebook(data.notebooks[0] || '默认笔记本');
        }
      }
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SELECTED_NOTES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) setSelectedIds(parsed);
    } catch (e) {
      // ignore
    }
    loadNotebooks();
    loadNotes();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadNotes();
  }, [selectedNotebook]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      window.localStorage.setItem(SELECTED_NOTES_KEY, JSON.stringify(selectedIds));
    } catch (e) {
      // ignore
    }
  }, [selectedIds]);

  useEffect(() => {
    if (!noteMenuOpenId) return;
    const onDoc = (e) => {
      if (menuAnchorRef.current && !menuAnchorRef.current.contains(e.target)) {
        setNoteMenuOpenId(null);
      }
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [noteMenuOpenId]);

  const toggleSelect = (noteId) => {
    setSelectedIds((prev) => (
      prev.includes(noteId) ? prev.filter((id) => id !== noteId) : [...prev, noteId]
    ));
  };

  const uploadNoteToNotebook = async (file, notebookName) => {
    if (!file) return;
    const finalNotebook = (notebookName || '').trim();
    if (!finalNotebook) {
      alert('请先新建或选择笔记本');
      return;
    }
    const formData = new FormData();
    formData.append('note_file', file);
    if (finalNotebook) formData.append('notebook', finalNotebook);

    setUploading(true);
    try {
      const resp = await fetch(`${API_URL}/api/notes`, {
        method: 'POST',
        body: formData
      });
      const data = await resp.json();
      if (!resp.ok || !data?.success) {
        throw new Error(data?.error || '上传失败');
      }
      setSelectedNotebook(finalNotebook);
      await loadNotebooks();
      await loadNotes();
    } catch (e) {
      alert(`上传失败：${e.message}`);
    } finally {
      setUploading(false);
    }
  };

  const createNotebook = async () => {
    const name = newNotebookName.trim();
    if (!name) {
      alert('请输入笔记本名称');
      return;
    }
    try {
      const resp = await fetch(`${API_URL}/api/notebooks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await resp.json();
      if (!resp.ok || !data?.success) {
        throw new Error(data?.error || '创建失败');
      }
      setSelectedNotebook(name);
      setNewNotebookName('');
      setShowNotebookModal(false);
      await loadNotebooks();
    } catch (e) {
      alert(`创建笔记本失败：${e.message}`);
    }
  };

  const deleteNote = async (noteId) => {
    if (!window.confirm('确认删除这条笔记吗？')) return;
    setDeletingId(noteId);
    setNoteMenuOpenId(null);
    try {
      const resp = await fetch(`${API_URL}/api/notes/${encodeURIComponent(noteId)}`, {
        method: 'DELETE'
      });
      const data = await resp.json();
      if (!resp.ok || !data?.success) {
        throw new Error(data?.error || '删除失败');
      }
      setSelectedIds((prev) => prev.filter((id) => id !== noteId));
      await loadNotes();
      await loadNotebooks();
    } catch (e) {
      alert(`删除失败：${e.message}`);
    } finally {
      setDeletingId('');
    }
  };

  const openRenameModal = (n) => {
    setRenameNoteId(n.noteId);
    setRenameNoteTitle(n.title || n.fileName || '');
    setShowRenameNoteModal(true);
    setNoteMenuOpenId(null);
  };

  const saveRenameNote = async () => {
    const title = renameNoteTitle.trim();
    if (!title) {
      alert('请输入名称');
      return;
    }
    try {
      const resp = await fetch(`${API_URL}/api/notes/${encodeURIComponent(renameNoteId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
      });
      const data = await resp.json();
      if (!resp.ok || !data?.success) {
        throw new Error(data?.error || '保存失败');
      }
      setShowRenameNoteModal(false);
      setRenameNoteId('');
      await loadNotes();
    } catch (e) {
      alert(`改名失败：${e.message}`);
    }
  };

  const openPreviewModal = async (n) => {
    if (!n || !n.noteId) return;
    setPreviewTitle(n.title || n.fileName || '笔记概览');
    setPreviewText('');
    setPreviewKeyword('');
    setPreviewTruncated(false);
    setPreviewLoading(true);
    setShowPreviewModal(true);
    try {
      let resp = await fetch(`${API_URL}/api/notes/${encodeURIComponent(n.noteId)}/preview_text`);
      // 兼容部分部署对嵌套路由的转发问题，自动回退到单层路径
      if (resp.status === 404) {
        resp = await fetch(`${API_URL}/api/note_preview_text?note_id=${encodeURIComponent(n.noteId)}`);
      }
      const data = await resp.json();
      if (!resp.ok || !data?.success) {
        throw new Error(data?.error || '读取概览失败');
      }
      const body = data.text ?? data.content ?? data.preview_text ?? '';
      setPreviewText(String(body).trim() || '（该笔记暂无可预览正文）');
      setPreviewTruncated(Boolean(data?.truncated));
    } catch (e) {
      setPreviewText(`读取失败：${e.message}`);
      setPreviewTruncated(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const renderHighlightedPreview = (text, keyword) => {
    const source = String(text || '');
    const kw = String(keyword || '').trim();
    if (!kw) return source;
    const lower = source.toLowerCase();
    const kwLower = kw.toLowerCase();
    const nodes = [];
    let cursor = 0;
    let idx = lower.indexOf(kwLower, cursor);
    while (idx !== -1) {
      if (idx > cursor) nodes.push(source.slice(cursor, idx));
      nodes.push(
        <mark key={`mk-${idx}`} style={{ background: '#ffe58f', padding: '0 2px' }}>
          {source.slice(idx, idx + kw.length)}
        </mark>
      );
      cursor = idx + kw.length;
      idx = lower.indexOf(kwLower, cursor);
    }
    if (cursor < source.length) nodes.push(source.slice(cursor));
    return nodes;
  };

  const copyPreviewText = async () => {
    const raw = String(previewText || '').trim();
    if (!raw) {
      alert('当前没有可复制的内容');
      return;
    }
    try {
      await navigator.clipboard.writeText(raw);
      alert('已复制概览全文');
    } catch (e) {
      alert('复制失败，请手动复制');
    }
  };

  const deleteNotebook = async (name) => {
    if (!name || name === '默认笔记本') return;
    if (!window.confirm(`确认删除笔记本「${name}」吗？其中笔记将迁移到默认笔记本。`)) return;
    try {
      const resp = await fetch(`${API_URL}/api/notebooks/${encodeURIComponent(name)}`, {
        method: 'DELETE'
      });
      const data = await resp.json();
      if (!resp.ok || !data?.success) {
        throw new Error(data?.error || '删除失败');
      }
      if (selectedNotebook === name) {
        setSelectedNotebook('默认笔记本');
      }
      await loadNotebooks();
      await loadNotes();
    } catch (e) {
      alert(`删除笔记本失败：${e.message}`);
    }
  };

  const goToAiGenerator = () => {
    try {
      window.localStorage.setItem(SELECTED_NOTES_KEY, JSON.stringify(selectedIds));
      window.localStorage.setItem('minimax_aipodcast_force_ai_mode', '1');
    } catch (e) {
      // ignore
    }
    if (onGoGenerator) onGoGenerator();
  };

  return (
    <div className="settings-panel">
      <div className="section">
        <h2>📚 知识库</h2>
        <div className="settings-voice-actions" style={{ marginBottom: 10 }}>
          <button
            type="button"
            className="api-key-clear-btn"
            onClick={() => setShowNotebookModal(true)}
          >
            ＋ 新建笔记本
          </button>
          <button
            type="button"
            className="api-key-clear-btn note-jump-btn"
            onClick={goToAiGenerator}
          >
            ⚠️ 携带已勾选笔记，跳转到AI加工模式
          </button>
        </div>
        <div className="notes-layout">
          <div className="notes-notebook-sidebar">
            <div className="input-label" style={{ marginBottom: 8 }}>笔记本</div>
            {notebooks.map((name) => (
              <div key={name} className="settings-voice-item" style={{ borderBottom: 'none', padding: '0' }}>
                <button
                  type="button"
                  className={`sidebar-item ${selectedNotebook === name ? 'active' : ''}`}
                  onClick={() => setSelectedNotebook(name)}
                  style={{ flex: 1 }}
                >
                  📁 {name}
                </button>
                {name !== '默认笔记本' && (
                  <button
                    type="button"
                    className="api-key-clear-btn"
                    onClick={() => deleteNotebook(name)}
                    title="删除笔记本"
                    aria-label={`删除笔记本 ${name}`}
                    style={{ minWidth: 40 }}
                  >
                    🗑️
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="notes-files-panel">
            <div className="settings-voice-actions" style={{ marginBottom: 8, justifyContent: 'space-between' }}>
              <div className="input-label">
                当前笔记本：{selectedNotebook}
              </div>
              <label className="api-key-clear-btn notes-upload-file-btn" style={{ cursor: uploading ? 'not-allowed' : 'pointer' }}>
                ＋ 上传文件
                <input
                  type="file"
                  accept=".txt,.md,.markdown,.pdf,.doc,.docx,.epub"
                  style={{ display: 'none' }}
                  disabled={uploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    if (file) uploadNoteToNotebook(file, selectedNotebook);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            {notes.length === 0 && <p className="input-description">该笔记本暂无文件，请先上传。</p>}
            {notes.map((n) => (
              <div key={n.noteId} className="settings-voice-item notes-file-item-row">
                <div className="notes-file-row-main">
                  <div className="api-key-remember notes-file-title-line">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(n.noteId)}
                      onChange={() => toggleSelect(n.noteId)}
                    />
                    <button
                      type="button"
                      className="notes-file-title-text"
                      title={n.title || n.fileName}
                      onClick={() => openPreviewModal(n)}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        textAlign: 'left',
                        cursor: 'pointer',
                        width: '100%',
                        display: 'block'
                      }}
                    >
                      {shortenMiddle(n.title || n.fileName, 20, 14)}
                    </button>
                  </div>
                  <div
                    className="notes-note-menu-anchor"
                    ref={noteMenuOpenId === n.noteId ? menuAnchorRef : undefined}
                  >
                    <button
                      type="button"
                      className="api-key-clear-btn notes-file-more-btn"
                      aria-label="更多操作"
                      title="更多"
                      onClick={(e) => {
                        e.stopPropagation();
                        setNoteMenuOpenId((id) => (id === n.noteId ? null : n.noteId));
                      }}
                    >
                      ···
                    </button>
                    {noteMenuOpenId === n.noteId && (
                      <div className="notes-file-dropdown">
                        <button
                          type="button"
                          onClick={() => openRenameModal(n)}
                        >
                          改名
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteNote(n.noteId)}
                          disabled={deletingId === n.noteId}
                        >
                          {deletingId === n.noteId ? '删除中…' : '删除'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <span className="input-description notes-file-meta">
                  <span title={`${n.notebook ? `📁${n.notebook} | ` : ''}${n.fileName}`}>
                    {n.notebook ? `📁${shortenMiddle(n.notebook, 12, 8)} | ` : ''}
                    {shortenMiddle(n.fileName, 28, 14)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showNotebookModal && (
        <div className="voice-rename-modal-mask" onClick={() => setShowNotebookModal(false)}>
          <div className="voice-rename-modal" onClick={(e) => e.stopPropagation()}>
            <h3>📁 新建笔记本</h3>
            <div className="input-group" style={{ marginTop: 10 }}>
              <label className="input-label">笔记本名称</label>
              <input
                type="text"
                value={newNotebookName}
                onChange={(e) => setNewNotebookName(e.target.value)}
                placeholder="例如：行业研究"
                autoFocus
              />
            </div>
            <div className="voice-rename-modal-actions">
              <button
                type="button"
                className="api-key-clear-btn"
                onClick={() => setShowNotebookModal(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="download-btn"
                style={{ minWidth: 120 }}
                onClick={createNotebook}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {showRenameNoteModal && (
        <div className="voice-rename-modal-mask" onClick={() => setShowRenameNoteModal(false)}>
          <div className="voice-rename-modal" onClick={(e) => e.stopPropagation()}>
            <h3>✏️ 笔记改名</h3>
            <p className="input-description">仅修改列表展示名称，服务器上的文件名不变。</p>
            <div className="input-group" style={{ marginTop: 10 }}>
              <label className="input-label">显示名称</label>
              <input
                type="text"
                value={renameNoteTitle}
                onChange={(e) => setRenameNoteTitle(e.target.value)}
                placeholder="输入新名称"
                autoFocus
              />
            </div>
            <div className="voice-rename-modal-actions">
              <button
                type="button"
                className="api-key-clear-btn"
                onClick={() => setShowRenameNoteModal(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="download-btn"
                style={{ minWidth: 120 }}
                onClick={saveRenameNote}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {showPreviewModal && (
        <div className="voice-rename-modal-mask" onClick={() => setShowPreviewModal(false)}>
          <div className="voice-rename-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760, width: '92vw' }}>
            <h3>📄 笔记内容概览</h3>
            <p className="input-description" style={{ marginBottom: 10 }}>
              {previewTitle}
            </p>
            {!previewLoading && (
              <p className="input-description" style={{ marginBottom: 10 }}>
                字数：{(previewText || '').length} {previewTruncated ? '（已截断预览）' : ''}
              </p>
            )}
            {previewLoading ? (
              <p className="input-description">正在加载概览…</p>
            ) : (
              <>
                <div className="settings-voice-actions" style={{ marginBottom: 8, gap: 8 }}>
                  <input
                    type="text"
                    value={previewKeyword}
                    onChange={(e) => setPreviewKeyword(e.target.value)}
                    placeholder="输入关键词高亮"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="api-key-clear-btn"
                    onClick={copyPreviewText}
                    title="复制当前概览全文"
                  >
                    快速复制
                  </button>
                </div>
                <div
                  className="final-copy-textarea"
                  style={{
                    width: '100%',
                    minHeight: 360,
                    maxHeight: '60vh',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap'
                  }}
                >
                  {renderHighlightedPreview(previewText, previewKeyword)}
                </div>
              </>
            )}
            <div className="voice-rename-modal-actions">
              <button
                type="button"
                className="api-key-clear-btn"
                onClick={() => setShowPreviewModal(false)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotesPanel;
