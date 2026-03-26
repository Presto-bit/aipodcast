import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../AuthContext';
import { apiPath, resolveMediaUrl } from '../apiBaseUrl';
import PodcastGenerator from './PodcastGenerator';
import WorkCoverImg from './WorkCoverImg';
import { getWorkCoverSrc } from '../workCoverImageUrl';
import { IconNotesPodcast } from './SidebarIcons';
import './podcastWorkCards.css';
import './PodcastGenerator.css';
import './NotesPodcastApp.css';

const ROOM_OUTPUTS_KEY = 'fym_notes_room_outputs_v1';
const ART_SCRIPT_MIN = 200;
const ART_SCRIPT_MAX = 9999;

/** 生成播客 · 体裁卡片选中时填入的默认 AI 提词（自定义为空） */
const PODCAST_ROOM_DEFAULT_PROMPTS = {
  custom: '',
  deep_dive: `你现在是两位顶尖大学的教授。你们的任务是针对上传的文档进行一次「知识拆解」对谈。
角色 A： 资深学者，擅长把复杂概念转化为生活中的类比（比如把「算力」类比成「体力」）。
角色 B： 极具好奇心的助教，负责追问「为什么」、「这个对普通人有什么意义」。
要求： 语气专业但不高冷，充满启发感。每到一个核心结论，必须举一个生活化的例子。严禁直接朗读原文。`,
  critique: `你现在是一位资深的行业评论员，性格犀利、一针见血。
任务： 审视这份文档，不要只说好话，要找出它逻辑不通的地方、过于理想化的地方或者隐藏的风险。
要求： 语气要带一点「冒犯性」和「幽默感」。多使用「但是」、「我并不买账」、「清醒一点」等词汇。你的目标是引发听众思考：这件事真的像文档里说的那么美好吗？`,
  debate: `你现在正在主持一场激烈的辩论赛，主题源自这份文档。
角色 A（正方）： 坚定的支持者，强调这项技术/观点的机遇和未来。
角色 B（反方）： 坚定的质疑者，强调这项技术/观点的伦理问题、成本和局限性。
要求： 两人要针锋相对，互相反驳对方的上一个观点。语气要激动、有感染力，像是在录制《奇葩说》现场。结尾不需要达成共识，留给听众自己判断。`,
};

function loadRoomOutputs() {
  try {
    const raw = window.localStorage.getItem(ROOM_OUTPUTS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function saveRoomOutputs(list) {
  try {
    window.localStorage.setItem(ROOM_OUTPUTS_KEY, JSON.stringify((list || []).slice(0, 200)));
  } catch (e) {
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

function formatDuration(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return '';
  const s = Math.round(n);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  if (mm <= 0) return `${ss}s`;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

function parseScriptChars(raw) {
  const n = parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(n)) return null;
  if (n < ART_SCRIPT_MIN || n > ART_SCRIPT_MAX) return null;
  return n;
}

function IconArticleGenSend() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function IconArticleGenLoading() {
  return (
    <svg className="notes-modal-gen-btn-spinner" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="42 48" />
    </svg>
  );
}

function IconArticleGenStop() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}

const ART_KIND_PRESETS = {
  custom: {
    label: '私人订制模式',
    scriptStyle: '轻松幽默，自然流畅',
    textPrefix: '',
  },
  brief: {
    label: '简报',
    scriptStyle: '极简、客观、结果导向，不要有文学修饰',
    textPrefix: `你现在是顶级咨询公司的资深顾问。请将这份文档转化为一份「决策简报」。
要求：
1. 第一段用 500 字以内说明核心背景（发生了什么）。
2. 使用 Bullet Points（重点清单）列出对我们最有价值的 5 条关键信息。
3. 分析潜在的挑战与机遇。
风格：极简、客观、结果导向，不要有文学修饰。`,
  },
  blog: {
    label: '爆款文章',
    scriptStyle: '口语化、有张力、充满干货但读起来很爽',
    textPrefix: `你现在是一位全网粉丝百万的深度内容创作者。请根据这份资料写一篇吸引人的推文。
要求：
1. 起一个带点「情绪」或者「反直觉」的爆款标题。
2. 第一段要用一个引人入胜的场景或痛点切入。
3. 把专业术语转化为大白话，并加入你的个人洞察（POV）。
4. 结尾要能引发读者评论。
风格：口语化、有张力、充满干货但读起来很爽。`,
  },
  guide: {
    label: '知识点手册',
    scriptStyle: '结构严谨，层次分明，逻辑性极强',
    textPrefix: `你现在是一位拥有 10 年经验的金牌教师。请根据上传资料制作一份「知识点手册」。
要求：
1. 列出 5-10 个必须掌握的核心术语（名词解释）。
2. 总结出文档中的 3 个底层逻辑或原理。
3. 设置 3 道启发性的思考题，并附带基于原文的参考答案。
风格：结构严谨，层次分明，逻辑性极强。`,
  },
};

async function streamArticleDraft({
  apiKey,
  getAuthHeaders,
  textInput,
  selectedNoteIds,
  scriptLanguage,
  scriptTargetChars,
  scriptStyle,
  programName,
  signal,
  onProgress,
}) {
  const formData = new FormData();
  formData.append('api_key', apiKey);
  const topic = String(textInput || '').trim();
  if (topic) formData.append('text_input', topic);
  formData.append('selected_note_ids', JSON.stringify(selectedNoteIds || []));
  formData.append('script_target_chars', String(scriptTargetChars));
  formData.append('script_style', scriptStyle || '轻松幽默，自然流畅');
  formData.append('script_language', scriptLanguage);
  formData.append('program_name', programName || '笔记文稿');
  formData.append('output_mode', 'article');
  formData.append(
    'script_constraints',
    '输出为普通文章正文（非播客、非双人对话）。禁止使用 Speaker1/Speaker2 行，以及主持人、听众、欢迎收听等播客用语。'
  );
  formData.append('use_rag', '1');

  const response = await fetch(apiPath('/api/generate_script_draft'), {
    method: 'POST',
    body: formData,
    signal,
    headers: getAuthHeaders(),
  });

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => '');
    throw new Error(errText?.slice(0, 200) || `HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let out = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data: ')) continue;
      const jsonStr = t.slice(6);
      if (!jsonStr.trim()) continue;
      let data;
      try {
        data = JSON.parse(jsonStr);
      } catch (e) {
        continue;
      }
      if (data.type === 'draft_script_chunk' && data.content) {
        out += data.content;
      }
      if (data.type === 'draft_script_replace' && typeof data.content === 'string') {
        out = data.content;
      }
      if (data.type === 'progress' && data.message && onProgress) {
        onProgress(data.message);
      }
      if (data.type === 'log' && data.message && onProgress) {
        onProgress(data.message);
      }
      if (data.type === 'error') {
        throw new Error(data.message || '生成失败');
      }
    }
  }

  if (buffer.trim().startsWith('data: ')) {
    try {
      const data = JSON.parse(buffer.trim().slice(6));
      if (data.type === 'error') throw new Error(data.message || '生成失败');
    } catch (e) {
      if (e.message) throw e;
    }
  }

  return out.trim();
}

export default function NotesPodcastApp() {
  const { ensureFeatureUnlocked, getAuthHeaders } = useAuth();
  const [view, setView] = useState('hub');
  const [roomNotebook, setRoomNotebook] = useState('');
  const [notebooks, setNotebooks] = useState([]);
  const [notes, setNotes] = useState([]);
  const [selectedNoteIds, setSelectedNoteIds] = useState([]);
  const [allOutputs, setAllOutputs] = useState(() => loadRoomOutputs());
  const [hubMenuOpen, setHubMenuOpen] = useState(null);
  const [noteMenuOpenId, setNoteMenuOpenId] = useState(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef(null);
  const hubMenuRef = useRef(null);
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const [newNotebookOpen, setNewNotebookOpen] = useState(false);
  const [newNotebookName, setNewNotebookName] = useState('');
  const [renameNbOpen, setRenameNbOpen] = useState(false);
  const [renameNbOld, setRenameNbOld] = useState('');
  const [renameNbNew, setRenameNbNew] = useState('');

  const [urlModalOpen, setUrlModalOpen] = useState(false);
  const [urlImportValue, setUrlImportValue] = useState('');

  const [renameNoteOpen, setRenameNoteOpen] = useState(false);
  const [renameNoteId, setRenameNoteId] = useState('');
  const [renameNoteTitle, setRenameNoteTitle] = useState('');

  const [podcastModalOpen, setPodcastModalOpen] = useState(false);
  const [podcastRoomKind, setPodcastRoomKind] = useState(null);
  const [podcastRoomPrompt, setPodcastRoomPrompt] = useState('');
  const [articleModalOpen, setArticleModalOpen] = useState(false);

  const [artText, setArtText] = useState('');
  const [artScriptLang, setArtScriptLang] = useState('中文');
  const [artChars, setArtChars] = useState('2000');
  const [artKind, setArtKind] = useState(null);
  const [artBusy, setArtBusy] = useState(false);
  const [artProgress, setArtProgress] = useState('');
  const artAbortRef = useRef(null);

  const [roomPlayId, setRoomPlayId] = useState(null);
  const [roomDurations, setRoomDurations] = useState({});
  const [roomOutMenuId, setRoomOutMenuId] = useState(null);

  const roomOutputs = useMemo(() => {
    const nb = roomNotebook;
    return (allOutputs || [])
      .filter((o) => o.notebook === nb)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }, [allOutputs, roomNotebook]);

  const loadNotebooks = useCallback(async () => {
    try {
      const [nbResp, notesResp] = await Promise.all([
        fetch(apiPath('/api/notebooks')),
        fetch(apiPath('/api/notes')),
      ]);
      if (!nbResp.ok) return;
      const nbData = await nbResp.json();
      if (!nbData?.success || !Array.isArray(nbData.notebooks)) return;
      const nbs = nbData.notebooks;
      let sorted = nbs;
      if (notesResp.ok) {
        const notesData = await notesResp.json();
        if (notesData?.success && Array.isArray(notesData.notes)) {
          const latestByNb = {};
          for (const n of notesData.notes) {
            const nb = String(n.notebook || '默认笔记本').trim();
            if (!(nb in latestByNb)) latestByNb[nb] = n.createdAt;
          }
          sorted = [...nbs].sort((a, b) => {
            const ta = new Date(latestByNb[a] || 0).getTime();
            const tb = new Date(latestByNb[b] || 0).getTime();
            if (tb !== ta) return tb - ta;
            return String(a).localeCompare(String(b), 'zh-CN');
          });
        }
      }
      setNotebooks(sorted);
    } catch (e) {
      // ignore
    }
  }, []);

  const loadNotes = useCallback(async () => {
    const nb = (roomNotebook || '').trim();
    if (!nb) return;
    try {
      const params = new URLSearchParams({ notebook: nb });
      const resp = await fetch(apiPath(`/api/notes?${params}`));
      if (!resp.ok) return;
      const data = await resp.json();
      if (data?.success && Array.isArray(data.notes)) {
        const list = [...data.notes].sort((a, b) => {
          const ta = new Date(a.createdAt || 0).getTime();
          const tb = new Date(b.createdAt || 0).getTime();
          return tb - ta;
        });
        setNotes(list);
      }
    } catch (e) {
      // ignore
    }
  }, [roomNotebook]);

  useEffect(() => {
    loadNotebooks();
  }, [loadNotebooks]);

  useEffect(() => {
    if (view === 'room' && roomNotebook) {
      loadNotes();
    }
  }, [view, roomNotebook, loadNotes]);

  useEffect(() => {
    if (view !== 'room') return;
    const ids = notes.map((n) => String(n.noteId)).filter(Boolean);
    setSelectedNoteIds(ids);
  }, [view, roomNotebook, notes]);

  useEffect(() => {
    if (!addMenuOpen) return;
    const onDoc = (e) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target)) {
        setAddMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [addMenuOpen]);

  useEffect(() => {
    if (!hubMenuOpen) return;
    const onDoc = (e) => {
      if (hubMenuRef.current && !hubMenuRef.current.contains(e.target)) {
        setHubMenuOpen(null);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [hubMenuOpen]);

  useEffect(() => {
    if (!articleModalOpen) return;
    setArtKind(null);
    setArtText('');
    setArtProgress('');
  }, [articleModalOpen]);

  useEffect(() => {
    if (!podcastModalOpen) return;
    setPodcastRoomKind(null);
    setPodcastRoomPrompt('');
  }, [podcastModalOpen]);

  const openRoom = (name) => {
    setRoomNotebook(name);
    setView('room');
    setHubMenuOpen(null);
  };

  const backToHub = () => {
    setView('hub');
    setRoomNotebook('');
    setNoteMenuOpenId(null);
    setAddMenuOpen(false);
    setPodcastModalOpen(false);
    setArticleModalOpen(false);
    loadNotebooks();
  };

  const createNotebook = async () => {
    const name = newNotebookName.trim();
    if (!name) {
      alert('请输入笔记本名称');
      return;
    }
    try {
      const resp = await fetch(apiPath('/api/notebooks'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await resp.json();
      if (!resp.ok || !data?.success) throw new Error(data?.error || '创建失败');
      setNewNotebookName('');
      setNewNotebookOpen(false);
      await loadNotebooks();
    } catch (e) {
      alert(`创建失败：${e.message}`);
    }
  };

  const submitRenameNotebook = async () => {
    const newName = renameNbNew.trim();
    const oldName = renameNbOld;
    if (!newName || !oldName) {
      alert('请输入新名称');
      return;
    }
    if (newName === oldName) {
      setRenameNbOpen(false);
      return;
    }
    try {
      const resp = await fetch(apiPath(`/api/notebooks/${encodeURIComponent(oldName)}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_name: newName }),
      });
      const data = await resp.json();
      if (!resp.ok || !data?.success) throw new Error(data?.error || '重命名失败');
      setAllOutputs((prev) => {
        const next = prev.map((o) => (o.notebook === oldName ? { ...o, notebook: newName } : o));
        saveRoomOutputs(next);
        return next;
      });
      if (roomNotebook === oldName) setRoomNotebook(newName);
      setRenameNbOpen(false);
      await loadNotebooks();
    } catch (e) {
      alert(`重命名失败：${e.message}`);
    }
  };

  const deleteNotebook = async (name) => {
    if (!name || name === '默认笔记本') return;
    if (!window.confirm(`确认删除笔记本「${name}」吗？其中笔记将迁移到默认笔记本。`)) return;
    try {
      const resp = await fetch(apiPath(`/api/notebooks/${encodeURIComponent(name)}`), {
        method: 'DELETE',
      });
      const data = await resp.json();
      if (!resp.ok || !data?.success) throw new Error(data?.error || '删除失败');
      if (roomNotebook === name) backToHub();
      await loadNotebooks();
    } catch (e) {
      alert(`删除失败：${e.message}`);
    }
  };

  const uploadFile = async (file) => {
    if (!file || !roomNotebook) return;
    const formData = new FormData();
    formData.append('note_file', file);
    formData.append('notebook', roomNotebook);
    setUploading(true);
    try {
      const resp = await fetch(apiPath('/api/notes'), { method: 'POST', body: formData });
      const data = await resp.json();
      if (!resp.ok || !data?.success) throw new Error(data?.error || '上传失败');
      await loadNotes();
    } catch (e) {
      alert(`上传失败：${e.message}`);
    } finally {
      setUploading(false);
    }
  };

  const importUrlNote = async () => {
    const url = urlImportValue.trim();
    if (!url || !roomNotebook) {
      alert('请输入有效 URL');
      return;
    }
    setUploading(true);
    try {
      const resp = await fetch(apiPath('/api/notes/import_url'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, notebook: roomNotebook }),
      });
      const data = await resp.json();
      if (!resp.ok || !data?.success) throw new Error(data?.error || '导入失败');
      setUrlImportValue('');
      setUrlModalOpen(false);
      await loadNotes();
    } catch (e) {
      alert(`导入失败：${e.message}`);
    } finally {
      setUploading(false);
    }
  };

  const deleteNote = async (noteId) => {
    if (!window.confirm('确认删除这条笔记吗？')) return;
    setNoteMenuOpenId(null);
    try {
      const resp = await fetch(apiPath(`/api/notes/${encodeURIComponent(noteId)}`), {
        method: 'DELETE',
      });
      const data = await resp.json();
      if (!resp.ok || !data?.success) throw new Error(data?.error || '删除失败');
      setSelectedNoteIds((prev) => prev.filter((id) => id !== noteId));
      await loadNotes();
    } catch (e) {
      alert(`删除失败：${e.message}`);
    }
  };

  const saveRenameNote = async () => {
    const title = renameNoteTitle.trim();
    if (!title || !renameNoteId) {
      alert('请输入名称');
      return;
    }
    try {
      const resp = await fetch(apiPath(`/api/notes/${encodeURIComponent(renameNoteId)}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      const data = await resp.json();
      if (!resp.ok || !data?.success) throw new Error(data?.error || '保存失败');
      setRenameNoteOpen(false);
      setRenameNoteId('');
      await loadNotes();
    } catch (e) {
      alert(`改名失败：${e.message}`);
    }
  };

  const toggleNoteSelect = (id) => {
    const sid = String(id);
    setSelectedNoteIds((prev) =>
      prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]
    );
  };

  const appendOutput = useCallback((row) => {
    setAllOutputs((prev) => {
      const next = [row, ...(Array.isArray(prev) ? prev : [])].slice(0, 200);
      saveRoomOutputs(next);
      return next;
    });
  }, []);

  const onPodcastComplete = useCallback(
    (entry) => {
      appendOutput({
        ...entry,
        type: 'podcast',
        notebook: roomNotebook,
      });
      setPodcastModalOpen(false);
    },
    [appendOutput, roomNotebook]
  );

  const runArticle = async () => {
    const ok = await ensureFeatureUnlocked();
    if (!ok) return;
    let apiKey = '';
    try {
      apiKey = (window.localStorage.getItem('minimax_aipodcast_api_key') || '').trim();
    } catch (e) {
      // ignore
    }
    if (!apiKey) {
      alert('请先在「API 设置」或 AI 播客页配置 MiniMax API Key');
      return;
    }
    const chars = parseScriptChars(artChars);
    if (chars === null) {
      alert(`目标字数请输入 ${ART_SCRIPT_MIN}~${ART_SCRIPT_MAX} 的整数`);
      return;
    }
    if (!artKind || !ART_KIND_PRESETS[artKind]) {
      alert('请先选择一种文章类型（上方四个小卡片）');
      return;
    }
    const preset = ART_KIND_PRESETS[artKind];
    const combined = String(artText || '').trim();
    const hasNotes = selectedNoteIds.length > 0;
    if (!combined && !hasNotes) {
      alert('请至少勾选左侧笔记，或在下方填写 AI 提词');
      return;
    }
    artAbortRef.current?.abort();
    const ac = new AbortController();
    artAbortRef.current = ac;
    setArtBusy(true);
    setArtProgress('准备生成…');
    try {
      const text = await streamArticleDraft({
        apiKey,
        getAuthHeaders,
        textInput: combined,
        selectedNoteIds,
        scriptLanguage: artScriptLang,
        scriptTargetChars: chars,
        scriptStyle: preset.scriptStyle,
        programName: `笔记文稿 · ${preset.label}`,
        signal: ac.signal,
        onProgress: (m) => setArtProgress(m),
      });
      if (!text) {
        alert('未收到文稿内容，请重试');
        return;
      }
      const titleBase = artText.trim() || `${preset.label}`;
      appendOutput({
        id: `art_${Date.now()}`,
        type: 'article',
        notebook: roomNotebook,
        title: titleBase.length > 40 ? `${titleBase.slice(0, 40)}…` : titleBase,
        scriptText: text,
        createdAt: new Date().toISOString(),
      });
      setArticleModalOpen(false);
      setArtProgress('');
    } catch (e) {
      if (e && e.name === 'AbortError') {
        setArtProgress('');
      } else {
        alert(`生成失败：${e.message || e}`);
      }
    } finally {
      setArtBusy(false);
      artAbortRef.current = null;
    }
  };

  const removeRoomOutput = (id) => {
    setAllOutputs((prev) => {
      const next = (prev || []).filter((o) => String(o.id) !== String(id));
      saveRoomOutputs(next);
      return next;
    });
    setRoomOutMenuId(null);
  };

  const copyArticle = async (text) => {
    try {
      await navigator.clipboard.writeText(String(text || ''));
      alert('已复制全文');
    } catch (e) {
      alert('复制失败');
    }
  };

  const openRenameNote = (n) => {
    setRenameNoteId(n.noteId);
    setRenameNoteTitle(n.title || n.fileName || '');
    setRenameNoteOpen(true);
    setNoteMenuOpenId(null);
  };

  /* —— Hub —— */
  if (view === 'hub') {
    return (
      <div className="notes-podcast-app notes-podcast-app--hub">
        <div className="notes-hub-head">
          <h1 className="notes-hub-title">笔记管理</h1>
        </div>
        <div className="notes-hub-grid">
          <button
            type="button"
            className="notes-hub-card notes-hub-card--new"
            onClick={() => setNewNotebookOpen(true)}
          >
            <span className="notes-hub-card-icon" aria-hidden>
              ＋
            </span>
            <span className="notes-hub-card-label">新建笔记本</span>
          </button>
          {notebooks.map((name) => (
            <div
              key={name}
              ref={hubMenuOpen === name ? hubMenuRef : null}
              className="notes-hub-card"
              onClick={() => openRoom(name)}
              role="presentation"
            >
              <span className="notes-hub-card-icon" aria-hidden>
                <IconNotesPodcast />
              </span>
              <span className="notes-hub-card-label" title={name}>
                {name}
              </span>
              <div className="notes-hub-card-actions">
                <button
                  type="button"
                  className="notes-hub-card-more"
                  aria-label="更多"
                  onClick={(e) => {
                    e.stopPropagation();
                    setHubMenuOpen((o) => (o === name ? null : name));
                  }}
                >
                  …
                </button>
                {hubMenuOpen === name && (
                  <div className="notes-hub-dropdown">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenameNbOld(name);
                        setRenameNbNew(name);
                        setRenameNbOpen(true);
                        setHubMenuOpen(null);
                      }}
                    >
                      重命名
                    </button>
                    {name !== '默认笔记本' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setHubMenuOpen(null);
                          deleteNotebook(name);
                        }}
                      >
                        删除
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {newNotebookOpen && (
          <div
            className="notes-podcast-modal-mask"
            role="dialog"
            aria-modal="true"
            aria-labelledby="nb-new-title"
            onClick={() => setNewNotebookOpen(false)}
          >
            <div className="notes-podcast-modal" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="notes-podcast-modal-close"
                aria-label="关闭"
                onClick={() => setNewNotebookOpen(false)}
              >
                ×
              </button>
              <h2 id="nb-new-title" className="notes-podcast-modal-title">
                新建笔记本
              </h2>
              <input
                type="text"
                className="notes-article-textarea"
                style={{ minHeight: 44 }}
                placeholder="笔记本名称"
                value={newNotebookName}
                onChange={(e) => setNewNotebookName(e.target.value)}
              />
              <div className="notes-article-footer-row">
                <button type="button" className="podcast-quick-flow-btn-primary" onClick={createNotebook}>
                  创建
                </button>
                <button type="button" className="podcast-quick-flow-btn-secondary" onClick={() => setNewNotebookOpen(false)}>
                  取消
                </button>
              </div>
            </div>
          </div>
        )}

        {renameNbOpen && (
          <div
            className="notes-podcast-modal-mask"
            onClick={() => setRenameNbOpen(false)}
            role="dialog"
            aria-modal="true"
          >
            <div className="notes-podcast-modal" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="notes-podcast-modal-close"
                onClick={() => setRenameNbOpen(false)}
              >
                ×
              </button>
              <h2 className="notes-podcast-modal-title">重命名笔记本</h2>
              <input
                type="text"
                className="notes-article-textarea"
                style={{ minHeight: 44 }}
                value={renameNbNew}
                onChange={(e) => setRenameNbNew(e.target.value)}
              />
              <div className="notes-article-footer-row">
                <button type="button" className="podcast-quick-flow-btn-primary" onClick={submitRenameNotebook}>
                  保存
                </button>
                <button type="button" className="podcast-quick-flow-btn-secondary" onClick={() => setRenameNbOpen(false)}>
                  取消
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* —— Room —— */
  return (
    <div className="notes-podcast-app">
      <div className="notes-room">
        <div className="notes-room-left">
          <div className="notes-room-toolbar">
            <button type="button" className="notes-room-back" onClick={backToHub}>
              ← 笔记本列表
            </button>
            <div className="notes-room-add-wrap" ref={addMenuRef}>
              <button
                type="button"
                className="notes-room-add-btn"
                title="添加笔记"
                aria-label="添加笔记"
                onClick={() => setAddMenuOpen((o) => !o)}
              >
                ＋
              </button>
              {addMenuOpen && (
                <div className="notes-room-add-menu">
                  <button
                    type="button"
                    onClick={() => {
                      setAddMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                  >
                    本地上传
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddMenuOpen(false);
                      setUrlModalOpen(true);
                    }}
                  >
                    从 URL 导入
                  </button>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              accept=".txt,.md,.markdown,.pdf,.doc,.docx,.epub"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) uploadFile(f);
              }}
            />
          </div>
          <div className="notes-room-nb-title">{roomNotebook}</div>
          {uploading && <p className="input-description">处理中…</p>}
          <ul className="notes-room-note-list">
            {notes.length === 0 ? (
              <li className="notes-room-output-empty">暂无笔记，点击上方 ＋ 添加</li>
            ) : (
              notes.map((n) => {
                const id = String(n.noteId || '');
                const checked = selectedNoteIds.includes(id);
                return (
                  <li key={id} className="notes-room-note-item notes-room-note-row">
                    <input
                      type="checkbox"
                      className="notes-room-note-check"
                      checked={checked}
                      onChange={() => toggleNoteSelect(id)}
                      aria-label="选中参与生成"
                    />
                    <span className="notes-room-note-title" title={n.title || n.fileName}>
                      {n.title || n.fileName || id}
                    </span>
                    <button
                      type="button"
                      className="notes-room-note-more"
                      onClick={() =>
                        setNoteMenuOpenId((o) => (o === id ? null : id))
                      }
                    >
                      …
                    </button>
                    {noteMenuOpenId === id && (
                      <div className="notes-room-note-dd">
                        <button type="button" onClick={() => openRenameNote(n)}>
                          重命名
                        </button>
                        <button type="button" onClick={() => deleteNote(id)}>
                          删除
                        </button>
                      </div>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>

        <div className="notes-room-right">
          <div className="notes-room-actions">
            <button
              type="button"
              className="notes-room-action-card"
              onClick={() => setPodcastModalOpen(true)}
            >
              <h3>生成播客</h3>
              <p>使用已选笔记与 AI 播客同款工具栏配置，生成语音节目。</p>
            </button>
            <button
              type="button"
              className="notes-room-action-card"
              onClick={() => setArticleModalOpen(true)}
            >
              <h3>生成文章</h3>
              <p>基于勾选笔记与补充说明，流式生成对话体文稿（可再编辑）。</p>
            </button>
          </div>

          <div className="notes-room-outputs">
            <p className="notes-room-outputs-head">产出内容</p>
            {roomOutputs.length === 0 ? (
              <p className="notes-room-output-empty">完成生成后，作品将显示在这里</p>
            ) : (
              <div className="podcast-work-cards">
                {roomOutputs.map((w) => {
                  const sid = String(w.id);
                  const isPodcast = w.type === 'podcast';
                  const coverSrc = isPodcast ? getWorkCoverSrc(w.coverImage || w.cover_image) : '';
                  const createdText = formatCreatedAt(w.createdAt);
                  const dur = roomDurations[sid];
                  const durText = formatDuration(dur);
                  const metaParts = [
                    isPodcast ? '播客' : '文稿',
                    durText,
                    createdText,
                  ].filter(Boolean);
                  const metaText = metaParts.join(' · ');

                  return (
                    <div key={sid} className="podcast-work-card">
                      <div className="podcast-work-card-cover">
                        <WorkCoverImg src={coverSrc} />
                      </div>
                      <div className="podcast-work-card-body">
                        <div className="podcast-work-card-title-row">
                          <div className="podcast-work-card-title" title={w.title}>
                            {w.title}
                          </div>
                          {isPodcast && w.audioUrl && (
                            <button
                              type="button"
                              className="podcast-work-card-play"
                              onClick={() =>
                                setRoomPlayId((p) => (p === sid ? null : sid))
                              }
                              aria-label="播放"
                            >
                              ▶
                            </button>
                          )}
                          <div className="tts-work-menu" style={{ position: 'relative' }}>
                            <button
                              type="button"
                              className={`tts-work-more ${roomOutMenuId === sid ? 'tts-work-more--on' : ''}`}
                              onClick={() =>
                                setRoomOutMenuId((o) => (o === sid ? null : sid))
                              }
                            >
                              …
                            </button>
                            {roomOutMenuId === sid && (
                              <div className="tts-work-dropdown" role="menu" style={{ right: 0, left: 'auto' }}>
                                {!isPodcast && (
                                  <button
                                    type="button"
                                    className="tts-work-dd-item"
                                    onClick={() => copyArticle(w.scriptText)}
                                  >
                                    复制全文
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="tts-work-dd-item tts-work-dd-danger"
                                  onClick={() => removeRoomOutput(w.id)}
                                >
                                  从此列表移除
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="podcast-work-card-meta">
                          <span className="podcast-work-card-meta-item podcast-work-card-meta-item--clamp" title={metaText}>
                            {metaText}
                          </span>
                        </div>
                        {!isPodcast && w.scriptText && (
                          <p className="input-description" style={{ marginTop: 8, maxHeight: 72, overflow: 'hidden' }}>
                            {String(w.scriptText).slice(0, 160)}
                            {String(w.scriptText).length > 160 ? '…' : ''}
                          </p>
                        )}
                        {isPodcast && roomPlayId === sid && w.audioUrl && (
                          <div className="podcast-work-card-inline-player">
                            <audio
                              className="podcast-work-card-inline-audio"
                              controls
                              src={resolveMediaUrl(w.audioUrl)}
                              preload="none"
                              onLoadedMetadata={(e) => {
                                const d = e?.currentTarget?.duration;
                                if (Number.isFinite(d) && d > 0) {
                                  setRoomDurations((prev) => ({ ...prev, [sid]: d }));
                                }
                              }}
                            />
                            <button
                              type="button"
                              className="api-key-clear-btn podcast-work-card-inline-close"
                              onClick={() => setRoomPlayId(null)}
                            >
                              收起
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {urlModalOpen && (
        <div className="notes-podcast-modal-mask" onClick={() => !uploading && setUrlModalOpen(false)}>
          <div className="notes-podcast-modal" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="notes-podcast-modal-close"
              onClick={() => setUrlModalOpen(false)}
              disabled={uploading}
            >
              ×
            </button>
            <h2 className="notes-podcast-modal-title">从 URL 导入为笔记</h2>
            <input
              type="url"
              className="notes-article-textarea"
              style={{ minHeight: 44 }}
              placeholder="https://..."
              value={urlImportValue}
              onChange={(e) => setUrlImportValue(e.target.value)}
            />
            <div className="notes-article-footer-row">
              <button
                type="button"
                className="podcast-quick-flow-btn-primary"
                disabled={uploading}
                onClick={importUrlNote}
              >
                {uploading ? '导入中…' : '导入'}
              </button>
              <button type="button" className="podcast-quick-flow-btn-secondary" onClick={() => setUrlModalOpen(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {renameNoteOpen && (
        <div className="notes-podcast-modal-mask" onClick={() => setRenameNoteOpen(false)}>
          <div className="notes-podcast-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="notes-podcast-modal-close" onClick={() => setRenameNoteOpen(false)}>
              ×
            </button>
            <h2 className="notes-podcast-modal-title">重命名笔记</h2>
            <input
              type="text"
              className="notes-article-textarea"
              style={{ minHeight: 44 }}
              value={renameNoteTitle}
              onChange={(e) => setRenameNoteTitle(e.target.value)}
            />
            <div className="notes-article-footer-row">
              <button type="button" className="podcast-quick-flow-btn-primary" onClick={saveRenameNote}>
                保存
              </button>
              <button type="button" className="podcast-quick-flow-btn-secondary" onClick={() => setRenameNoteOpen(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {podcastModalOpen && (
        <div className="notes-podcast-modal-mask" role="presentation" aria-hidden={false}>
          <div
            className="notes-podcast-modal notes-podcast-modal--podcast-config"
            role="document"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="notes-podcast-modal-close"
              aria-label="关闭"
              onClick={() => setPodcastModalOpen(false)}
            >
              ×
            </button>
            <h2 className="notes-podcast-modal-title">生成播客 · 配置</h2>
            <p className="input-description">
              已勾选笔记 {selectedNoteIds.length} 条；先选播客体裁，再调整工具栏与 AI 提词。
            </p>
            <div className="notes-article-kind-grid" role="group" aria-label="播客体裁">
              {[
                ['custom', '自定义模式', '自由使用工具栏与提词'],
                ['deep_dive', '学霸模式', '知识分享 · Deep Dive'],
                ['critique', '锐评频道', '态度点评 · Critique'],
                ['debate', '左右互搏', '双人对辩 · Debate'],
              ].map(([key, title, sub]) => (
                <button
                  key={key}
                  type="button"
                  className={`notes-article-kind-card ${podcastRoomKind === key ? 'notes-article-kind-card--on' : ''}`}
                  onClick={() => {
                    setPodcastRoomKind(key);
                    setPodcastRoomPrompt(PODCAST_ROOM_DEFAULT_PROMPTS[key] ?? '');
                  }}
                >
                  <span className="notes-article-kind-card-title">{title}</span>
                  <span className="notes-article-kind-card-sub">{sub}</span>
                </button>
              ))}
            </div>
            {podcastRoomKind && (
              <div className="notes-podcast-room-settings">
                <PodcastGenerator
                  showApiConfig={false}
                  notesPodcastMode={false}
                  roomConfigModal
                  roomNotebookName={roomNotebook}
                  roomSelectedNoteIds={selectedNoteIds}
                  roomPodcastKind={podcastRoomKind}
                  roomPodcastPrompt={podcastRoomPrompt}
                  onRoomGenerationComplete={onPodcastComplete}
                  roomPromptSlot={
                    <>
                      <label className="notes-article-prompt-label" htmlFor="notes-podcast-room-prompt">
                        AI 提词
                      </label>
                      <textarea
                        id="notes-podcast-room-prompt"
                        className="notes-article-textarea"
                        placeholder="补充你希望强调的角度、听众、风格等（将与体裁说明合并后参与生成；可留空）"
                        value={podcastRoomPrompt}
                        onChange={(e) => setPodcastRoomPrompt(e.target.value)}
                        rows={4}
                      />
                    </>
                  }
                />
              </div>
            )}
          </div>
        </div>
      )}

      {articleModalOpen && (
        <div className="notes-podcast-modal-mask" onClick={() => !artBusy && setArticleModalOpen(false)}>
          <div className="notes-podcast-modal notes-podcast-modal--article" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="notes-podcast-modal-close"
              disabled={artBusy}
              onClick={() => setArticleModalOpen(false)}
            >
              ×
            </button>
            <h2 className="notes-podcast-modal-title">生成文章 · 配置</h2>
            <p className="input-description">
              已勾选笔记 {selectedNoteIds.length} 条；先选体裁，再填写语言、字数与 AI 提词。
            </p>
            <div className="notes-article-kind-grid" role="group" aria-label="文章体裁">
              {[
                ['custom', '私人订制模式', '自由发挥主题与方向'],
                ['brief', '简报', '决策简报：要点清单与挑战机遇'],
                ['blog', '爆款文章', '情绪标题、场景切入、口语化干货'],
                ['guide', '知识点手册', '术语释义、底层逻辑、思考题'],
              ].map(([key, title, sub]) => (
                <button
                  key={key}
                  type="button"
                  className={`notes-article-kind-card ${artKind === key ? 'notes-article-kind-card--on' : ''}`}
                  onClick={() => {
                    if (artKind !== key) {
                      setArtText(ART_KIND_PRESETS[key]?.textPrefix ?? '');
                    }
                    setArtKind(key);
                  }}
                >
                  <span className="notes-article-kind-card-title">{title}</span>
                  <span className="notes-article-kind-card-sub">{sub}</span>
                </button>
              ))}
            </div>
            {artKind && (
              <div className="notes-article-kind-settings">
                <div className="notes-article-toolbar notes-article-toolbar--inline">
                  <label>
                    语言
                    <select value={artScriptLang} onChange={(e) => setArtScriptLang(e.target.value)}>
                      <option value="中文">中文</option>
                      <option value="English">English</option>
                      <option value="日本語">日本語</option>
                    </select>
                  </label>
                  <label>
                    字数
                    <input
                      type="number"
                      min={ART_SCRIPT_MIN}
                      max={ART_SCRIPT_MAX}
                      value={artChars}
                      onChange={(e) => setArtChars(e.target.value)}
                    />
                  </label>
                </div>
                <label className="notes-article-prompt-label" htmlFor="notes-art-prompt">
                  AI 提词
                </label>
                <textarea
                  id="notes-art-prompt"
                  className="notes-article-textarea"
                  placeholder="选中体裁后，默认提词会显示在此，可直接编辑；也可留空，仅用左侧已勾选笔记生成。"
                  value={artText}
                  onChange={(e) => setArtText(e.target.value)}
                  rows={5}
                />
              </div>
            )}
            {artProgress && <p className="notes-article-progress">{artProgress}</p>}
            <div className="notes-modal-generate-bar">
              <div className="notes-room-config-actions">
                <button
                  type="button"
                  className="notes-modal-gen-btn notes-modal-gen-btn--article"
                  disabled={artBusy || !artKind}
                  onClick={runArticle}
                  aria-label={artBusy ? '生成中' : '生成文章'}
                  title={artBusy ? '生成中' : '生成文章'}
                >
                  {artBusy ? <IconArticleGenLoading /> : <IconArticleGenSend />}
                </button>
                {artBusy && (
                  <button
                    type="button"
                    className="notes-modal-gen-btn notes-modal-gen-btn--stop"
                    onClick={() => artAbortRef.current?.abort()}
                    aria-label="停止生成"
                    title="停止生成"
                  >
                    <IconArticleGenStop />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
