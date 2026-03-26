import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../AuthContext';
import { apiPath, resolveMediaUrl } from '../apiBaseUrl';
import { downloadWorkBundleZip } from '../workBundleDownload';
import {
  buildGroupedSelectOptions,
  filterGroupedVoiceGroups,
  uniqueLangShortsFromVoiceGroups,
} from '../voiceCatalogUtils';
import AudioStyleIntroForm from './AudioStyleIntroForm';
import WorkCoverImg from './WorkCoverImg';
import { getWorkCoverSrc } from '../workCoverImageUrl';
import './podcastWorkCards.css';
import './TextToSpeechPanel.css';

/** 与 PodcastGenerator「导入文本转语音」一致 */
export const TTS_IMPORT_SCRIPT_KEY = 'fym_podcast_import_manual_script';

const TTS_WORKS_STORAGE_KEY = 'fym_tts_works_v1';
const API_KEY_STORAGE_KEY = 'minimax_aipodcast_api_key';
const AUDIO_STYLE_CONFIG_KEY = 'minimax_aipodcast_audio_style_config';
const AUDIO_STYLE_PRESETS_KEY = 'minimax_aipodcast_audio_style_presets';
const DEFAULT_API_KEY = process.env.REACT_APP_DEFAULT_API_KEY || '';

function getStoredApiKey() {
  try {
    const fromStore = (window.localStorage.getItem(API_KEY_STORAGE_KEY) || '').trim();
    if (fromStore) return fromStore;
  } catch (e) {
    // ignore
  }
  return (DEFAULT_API_KEY || '').trim();
}

const LANGUAGE_OPTIONS = [
  { value: '中文', label: '中文（普通话）' },
  { value: 'English', label: 'English' },
  { value: '日本語', label: '日本語' },
];

// 模板内容暂不内置：等待后续逻辑接入

function TtsGroupedVoiceSelect({ groups, value, onChange, id, className }) {
  if (!groups || groups.length === 0) return null;
  const inList = groups.some((g) => g.voices.some((v) => v.key === value));
  const selectVal = inList ? value : '';
  return (
    <select
      id={id}
      className={`default-voice-grouped-select ${className || ''}`}
      value={selectVal}
      onChange={(e) => {
        const v = e.target.value;
        if (v) onChange(v);
      }}
    >
      {!inList && (
        <option value="" disabled>
          当前为克隆，选下列切换预设
        </option>
      )}
      {groups.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.voices.map((v) => (
            <option key={v.key} value={v.key} title={v.optionTitle}>
              {v.typeShort}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function IcoBrackets() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M8 5H5v14h3M16 5h3v14h-3" />
    </svg>
  );
}

function loadWorks() {
  try {
    const raw = window.localStorage.getItem(TTS_WORKS_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function saveWorks(list) {
  try {
    window.localStorage.setItem(TTS_WORKS_STORAGE_KEY, JSON.stringify(list.slice(0, 20)));
  } catch (e) {
    // ignore
  }
}

function buildVoiceOptions(defaultVoicesObj, savedList) {
  const preset = Object.keys(defaultVoicesObj || {})
    .map((k) => {
      const item = defaultVoicesObj[k];
      if (!item || !item.voice_id) return null;
      return {
        key: k,
        voice_id: item.voice_id,
        name: item.name || k,
        label: `${item.name || k}${item.description ? ` · ${item.description}` : ''}`,
        group: 'preset',
      };
    })
    .filter(Boolean);
  const saved = (savedList || [])
    .map((v) => {
      const vid = String(v.voiceId || '').trim();
      if (!vid) return null;
      return {
        key: `saved:${vid}`,
        voice_id: vid,
        name: v.displayName || vid,
        label: `${v.displayName || vid}（克隆）`,
        group: 'saved',
      };
    })
    .filter(Boolean);
  return [...preset, ...saved];
}

function TextToSpeechPanel() {
  const { ensureFeatureUnlocked, getAuthHeaders } = useAuth();
  const [defaultVoicesMap, setDefaultVoicesMap] = useState({});
  const [voiceOptions, setVoiceOptions] = useState([]);
  const [voiceKey1, setVoiceKey1] = useState('mini');
  const [voiceKey2, setVoiceKey2] = useState('max');
  const [ttsMode, setTtsMode] = useState('single');
  const [language, setLanguage] = useState('中文');
  const [aiPolish, setAiPolish] = useState(false);
  const [polishPreview, setPolishPreview] = useState('');
  const [polishPreviewBusy, setPolishPreviewBusy] = useState(false);
  const [showIoModal, setShowIoModal] = useState(false);
  const [text, setText] = useState('');
  const [dropActive, setDropActive] = useState(false);
  const [urlPopoverOpen, setUrlPopoverOpen] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const fileInputRef = useRef(null);
  const urlPopoverRef = useRef(null);
  const [ttsVoicePop, setTtsVoicePop] = useState(null);
  const [ttsVoiceGenderFilter, setTtsVoiceGenderFilter] = useState('all');
  const [ttsVoiceLangFilter, setTtsVoiceLangFilter] = useState('all');
  const ttsVoiceWrap1Ref = useRef(null);
  const ttsVoiceWrap2Ref = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastAudioUrl, setLastAudioUrl] = useState('');
  const [works, setWorks] = useState(() => loadWorks());
  const [bottomTab, setBottomTab] = useState('works');
  const [workMenuOpenId, setWorkMenuOpenId] = useState(null);
  const [ttsWorkZipBusyId, setTtsWorkZipBusyId] = useState(null);
  const [workRates, setWorkRates] = useState({});
  const workAudioRefs = useRef({});
  const workMenuRefs = useRef({});
  const [workPlayingId, setWorkPlayingId] = useState(null);
  const workInlineAudioRef = useRef(null);
  const [workMenuDir, setWorkMenuDir] = useState({});
  const [workDurations, setWorkDurations] = useState({});

  const formatDuration = useCallback((sec) => {
    const n = Number(sec);
    if (!Number.isFinite(n) || n <= 0) return '';
    const s = Math.round(n);
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    if (mm <= 0) return `${ss}s`;
    return `${mm}:${String(ss).padStart(2, '0')}`;
  }, []);

  const formatCreatedAt = useCallback((iso) => {
    const raw = String(iso || '').trim();
    if (!raw) return '';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}-${dd} ${hh}:${mi}`;
  }, []);

  const pauseOtherWorks = useCallback((keepId) => {
    const keep = String(keepId ?? '');
    const refs = workAudioRefs.current || {};
    Object.keys(refs).forEach((k) => {
      if (k === keep) return;
      const el = refs[k];
      if (!el) return;
      try {
        if (!el.paused) el.pause();
      } catch (e) {
        // ignore
      }
    });
  }, []);

  useEffect(() => {
    if (!workPlayingId) return;
    const el = workInlineAudioRef.current;
    if (!el) return;
    try {
      el.play();
    } catch (e) {
      // ignore
    }
  }, [workPlayingId]);

  const [savedCustomVoices, setSavedCustomVoices] = useState([]);
  const [savedBgms, setSavedBgms] = useState([]);

  const [introText, setIntroText] = useState('');
  const [endingText, setEndingText] = useState('');
  const [introVoiceMode, setIntroVoiceMode] = useState('speaker1');
  const [introVoiceName, setIntroVoiceName] = useState('max');
  const [introCustomVoiceId, setIntroCustomVoiceId] = useState('');
  const [endingVoiceMode, setEndingVoiceMode] = useState('default');
  const [endingVoiceName, setEndingVoiceName] = useState('max');
  const [endingCustomVoiceId, setEndingCustomVoiceId] = useState('');
  const [introBgm1Mode, setIntroBgm1Mode] = useState('default');
  const [introBgm1SavedId, setIntroBgm1SavedId] = useState('');
  const [introBgm2Mode, setIntroBgm2Mode] = useState('default');
  const [introBgm2SavedId, setIntroBgm2SavedId] = useState('');
  const [endingBgm1Mode, setEndingBgm1Mode] = useState('default');
  const [endingBgm1SavedId, setEndingBgm1SavedId] = useState('');
  const [endingBgm2Mode, setEndingBgm2Mode] = useState('none');
  const [endingBgm2SavedId, setEndingBgm2SavedId] = useState('');
  const [introBgm1File, setIntroBgm1File] = useState(null);
  const [introBgm2File, setIntroBgm2File] = useState(null);
  const [endingBgm1File, setEndingBgm1File] = useState(null);
  const [endingBgm2File, setEndingBgm2File] = useState(null);

  const [audioStylePresets, setAudioStylePresets] = useState([]);
  const [selectedAudioStylePresetId, setSelectedAudioStylePresetId] = useState('');
  const audioStyleSaveReadyRef = useRef(false);

  const defaultVoiceGroups = useMemo(
    () => buildGroupedSelectOptions(defaultVoicesMap || {}),
    [defaultVoicesMap]
  );

  const ttsComposerLangChips = useMemo(
    () => uniqueLangShortsFromVoiceGroups(defaultVoiceGroups),
    [defaultVoiceGroups]
  );

  const ttsComposerFilteredGroups = useMemo(
    () => filterGroupedVoiceGroups(defaultVoiceGroups, ttsVoiceGenderFilter, ttsVoiceLangFilter),
    [defaultVoiceGroups, ttsVoiceGenderFilter, ttsVoiceLangFilter]
  );

  useEffect(() => {
    if (!ttsVoicePop) {
      setTtsVoiceGenderFilter('all');
      setTtsVoiceLangFilter('all');
    }
  }, [ttsVoicePop]);

  useEffect(() => {
    if (!ttsVoicePop) return undefined;
    const onDoc = (e) => {
      const n = e.target;
      if (ttsVoiceWrap1Ref.current?.contains(n)) return;
      if (ttsVoiceWrap2Ref.current?.contains(n)) return;
      setTtsVoicePop(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [ttsVoicePop]);

  const voiceOptionLabel = useCallback(
    (key) => voiceOptions.find((v) => v.key === key)?.name || key || '—',
    [voiceOptions]
  );

  const handleBgmFileChange = (setter) => (e) => {
    const f = e.target.files?.[0];
    if (f) setter(f);
  };

  const buildAudioStyleConfigPayload = useCallback(
    () => ({
      introText,
      endingText,
      introVoiceMode,
      introVoiceName,
      introCustomVoiceId,
      endingVoiceMode,
      endingVoiceName,
      endingCustomVoiceId,
      introBgm1Mode,
      introBgm1SavedId,
      introBgm2Mode,
      introBgm2SavedId,
      endingBgm1Mode,
      endingBgm1SavedId,
      endingBgm2Mode,
      endingBgm2SavedId,
    }),
    [
      introText,
      endingText,
      introVoiceMode,
      introVoiceName,
      introCustomVoiceId,
      endingVoiceMode,
      endingVoiceName,
      endingCustomVoiceId,
      introBgm1Mode,
      introBgm1SavedId,
      introBgm2Mode,
      introBgm2SavedId,
      endingBgm1Mode,
      endingBgm1SavedId,
      endingBgm2Mode,
      endingBgm2SavedId,
    ]
  );

  const applyAudioStyleConfigPayload = useCallback((c = {}) => {
    setIntroText(c.introText || '');
    setEndingText(c.endingText || '');
    setIntroVoiceMode(c.introVoiceMode || 'speaker1');
    setIntroVoiceName(c.introVoiceName || 'max');
    setIntroCustomVoiceId(c.introCustomVoiceId || '');
    setEndingVoiceMode(c.endingVoiceMode || 'default');
    setEndingVoiceName(c.endingVoiceName || 'max');
    setEndingCustomVoiceId(c.endingCustomVoiceId || '');
    setIntroBgm1Mode(c.introBgm1Mode || 'default');
    setIntroBgm1SavedId(c.introBgm1SavedId || '');
    setIntroBgm2Mode(c.introBgm2Mode || 'default');
    setIntroBgm2SavedId(c.introBgm2SavedId || '');
    setEndingBgm1Mode(c.endingBgm1Mode || 'default');
    setEndingBgm1SavedId(c.endingBgm1SavedId || '');
    setEndingBgm2Mode(c.endingBgm2Mode || 'none');
    setEndingBgm2SavedId(c.endingBgm2SavedId || '');
    setIntroBgm1File(null);
    setIntroBgm2File(null);
    setEndingBgm1File(null);
    setEndingBgm2File(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const applyCatalog = (raw, savedArr) => {
      const opts = buildVoiceOptions(raw, savedArr);
      setVoiceOptions(opts);
      const pick = (prev, fallback) => (opts.some((o) => o.key === prev) ? prev : fallback);
      setVoiceKey1((p) => pick(p, opts[0]?.key || 'mini'));
      setVoiceKey2((p) => pick(p, opts.find((o) => o.key === 'max')?.key || opts[0]?.key || 'max'));
    };
    (async () => {
      try {
        const [defRes, savedRes] = await Promise.all([
          fetch(apiPath('/api/default-voices')),
          fetch(apiPath('/api/saved_voices')),
        ]);
        const defData = await defRes.json();
        const savedData = await savedRes.json();
        const raw = defData && defData.voices;
        const savedArr = Array.isArray(savedData?.voices) ? savedData.voices : [];
        if (!cancelled && raw && typeof raw === 'object') {
          setDefaultVoicesMap(raw);
          applyCatalog(raw, savedArr);
          setSavedCustomVoices(savedArr);
        }
        const savedRes2 = await fetch(apiPath('/api/saved_voices'), { cache: 'no-store' });
        const savedData2 = await savedRes2.json();
        const savedArr2 = Array.isArray(savedData2?.voices) ? savedData2.voices : [];
        if (!cancelled && raw && typeof raw === 'object') {
          applyCatalog(raw, savedArr2);
          setSavedCustomVoices(savedArr2);
        }
      } catch (e) {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(apiPath('/api/saved_bgms'));
        const d = await r.json();
        if (d && d.success && Array.isArray(d.bgms)) setSavedBgms(d.bgms);
      } catch (e) {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(AUDIO_STYLE_CONFIG_KEY);
      if (raw) {
        const c = JSON.parse(raw);
        if (c && typeof c === 'object') {
          applyAudioStyleConfigPayload(c);
        }
      }
    } catch (e) {
      // ignore
    }
    audioStyleSaveReadyRef.current = true;
  }, [applyAudioStyleConfigPayload]);

  useEffect(() => {
    if (!audioStyleSaveReadyRef.current) return;
    const payload = buildAudioStyleConfigPayload();
    try {
      window.localStorage.setItem(AUDIO_STYLE_CONFIG_KEY, JSON.stringify(payload));
    } catch (e) {
      // ignore
    }
  }, [buildAudioStyleConfigPayload]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(AUDIO_STYLE_PRESETS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const normalized = parsed
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const id = String(item.id || '').trim();
          const name = String(item.name || '').trim();
          if (!id || !name) return null;
          return {
            id,
            name,
            createdAt: item.createdAt || null,
            config: item.config && typeof item.config === 'object' ? item.config : {},
          };
        })
        .filter(Boolean);
      setAudioStylePresets(normalized);
    } catch (e) {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(AUDIO_STYLE_PRESETS_KEY, JSON.stringify(audioStylePresets));
    } catch (e) {
      // ignore
    }
  }, [audioStylePresets]);

  useEffect(() => {
    try {
      const imp = sessionStorage.getItem(TTS_IMPORT_SCRIPT_KEY);
      if (imp) {
        setText(imp);
        sessionStorage.removeItem(TTS_IMPORT_SCRIPT_KEY);
      }
    } catch (e) {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!urlPopoverOpen) return undefined;
    const onDoc = (e) => {
      if (urlPopoverRef.current && !urlPopoverRef.current.contains(e.target)) {
        setUrlPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [urlPopoverOpen]);

  useEffect(() => {
    if (!workMenuOpenId) return undefined;
    const onDoc = (e) => {
      const id = workMenuOpenId;
      const wrap = workMenuRefs.current?.[String(id)];
      if (wrap && wrap.contains(e.target)) return;
      setWorkMenuOpenId(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [workMenuOpenId]);

  const resolveVoiceId = useCallback(
    (key) => voiceOptions.find((v) => v.key === key)?.voice_id || '',
    [voiceOptions]
  );

  const loadAudioStylePreset = useCallback(() => {
    const presetId = String(selectedAudioStylePresetId || '').trim();
    if (!presetId) {
      alert('请先选择一个配置');
      return;
    }
    const preset = audioStylePresets.find((item) => item.id === presetId);
    if (!preset) {
      alert('未找到该配置，请重新选择');
      return;
    }
    applyAudioStyleConfigPayload(preset.config || {});
    alert(`已加载配置：${preset.name}`);
  }, [selectedAudioStylePresetId, audioStylePresets, applyAudioStyleConfigPayload]);

  const saveAudioStylePreset = useCallback(() => {
    const defaultName = `配置-${new Date().toLocaleString()}`;
    const name = window.prompt('配置名称', defaultName);
    if (!name || !String(name).trim()) return;
    const config = buildAudioStyleConfigPayload();
    const now = new Date().toISOString();
    const newId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const current = Array.isArray(audioStylePresets) ? audioStylePresets : [];
    const trimmed = String(name).trim();
    const existingIdx = current.findIndex((item) => item.name === trimmed);
    if (existingIdx >= 0) {
      const next = [...current];
      next[existingIdx] = { ...next[existingIdx], createdAt: now, config };
      setAudioStylePresets(next);
      setSelectedAudioStylePresetId(next[existingIdx].id);
    } else {
      const next = [{ id: newId, name: trimmed, createdAt: now, config }, ...current];
      setAudioStylePresets(next);
      setSelectedAudioStylePresetId(newId);
    }
  }, [buildAudioStyleConfigPayload, audioStylePresets]);

  const buildTtsIntroOutroVoiceIds = useCallback(
    (vid1, vid2) => {
      let intro_voice_id = '';
      let outro_voice_id = '';
      if (introText.trim()) {
        if (introVoiceMode === 'custom') intro_voice_id = introCustomVoiceId.trim();
        else if (introVoiceMode === 'default') intro_voice_id = resolveVoiceId(introVoiceName);
        else if (introVoiceMode === 'speaker1') intro_voice_id = vid1;
        else if (introVoiceMode === 'speaker2') intro_voice_id = vid2;
      }
      if (endingText.trim()) {
        if (endingVoiceMode === 'custom') outro_voice_id = endingCustomVoiceId.trim();
        else if (endingVoiceMode === 'default') outro_voice_id = resolveVoiceId(endingVoiceName);
        else if (endingVoiceMode === 'speaker1') outro_voice_id = vid1;
        else if (endingVoiceMode === 'speaker2') outro_voice_id = vid2;
      }
      return { intro_voice_id, outro_voice_id };
    },
    [
      introText,
      endingText,
      introVoiceMode,
      introVoiceName,
      introCustomVoiceId,
      endingVoiceMode,
      endingVoiceName,
      endingCustomVoiceId,
      resolveVoiceId,
    ]
  );

  const mergeFileText = (fileList) => {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;
    const f = files[0];
    const name = (f.name || '').toLowerCase();
    if (!name.endsWith('.txt') && !name.endsWith('.md') && !name.endsWith('.markdown')) {
      alert('请先上传 .txt 或 .md；其它格式请粘贴到文本框。');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || '').trim();
      if (s) setText((prev) => (prev ? `${prev.trim()}\n\n${s}` : s));
    };
    reader.readAsText(f, 'UTF-8');
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDropActive(false);
    mergeFileText(e.dataTransfer.files);
  };

  const fetchUrlIntoText = async () => {
    const u = urlDraft.trim();
    if (!u) {
      alert('请粘贴网页链接');
      return;
    }
    setUrlLoading(true);
    try {
      const res = await fetch(apiPath('/api/url_preview_text'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: u }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || `请求失败 ${res.status}`);
      }
      const t = String(data.text || '').trim();
      if (!t) {
        throw new Error('未获取到正文');
      }
      setText((prev) => (prev ? `${prev.trim()}\n\n${t}` : t));
      setUrlPopoverOpen(false);
      setUrlDraft('');
    } catch (err) {
      alert(err.message || String(err));
    } finally {
      setUrlLoading(false);
    }
  };

  const deleteWork = useCallback(
    (id) => {
      const sid = String(id || '').trim();
      if (!sid) return;
      const target = works.find((w) => String(w.id) === sid);
      const label = (target?.title || '').trim() || '该项目';
      // eslint-disable-next-line no-restricted-globals
      if (!window.confirm(`确定删除「${label}」吗？`)) return;
      const next = works.filter((w) => String(w.id) !== sid);
      setWorks(next);
      saveWorks(next);
      setWorkMenuOpenId((cur) => (String(cur) === sid ? null : cur));
      setWorkRates((prev) => {
        const n = { ...(prev || {}) };
        delete n[sid];
        return n;
      });
      if (workAudioRefs.current?.[sid]) {
        try {
          delete workAudioRefs.current[sid];
        } catch (e) {
          // ignore
        }
      }
    },
    [works]
  );

  const renameWork = useCallback(
    (id) => {
      const sid = String(id || '').trim();
      if (!sid) return;
      const target = works.find((w) => String(w.id) === sid);
      const label = (target?.title || '').trim() || '该项目';
      const nextTitleRaw = window.prompt('输入新名称', label);
      const nextTitle = String(nextTitleRaw || '').trim();
      if (!nextTitle) return;
      const next = works.map((w) => (String(w.id) === sid ? { ...w, title: nextTitle } : w));
      setWorks(next);
      saveWorks(next);
      setWorkMenuOpenId(null);
    },
    [works]
  );

  const copyWorkScript = useCallback(
    async (id) => {
      const sid = String(id || '').trim();
      if (!sid) return;
      const target = works.find((w) => String(w.id) === sid);
      const rawTxt = String(target?.scriptText || target?.text || '').trim();
      if (!rawTxt) {
        alert('暂无可复制文稿（该作品未保存脚本文本）。');
        return;
      }
      let txtToCopy = rawTxt;
      if (aiPolish) {
        // aiPolish 时用后端同款清洗逻辑，确保复制内容更适合朗读。
        try {
          const res = await fetch(apiPath('/api/tts_sanitize'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({ text: rawTxt }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data?.success && typeof data?.text === 'string') {
            const cleaned = data.text.trim();
            if (cleaned) txtToCopy = cleaned;
          }
        } catch (e) {
          // fallback to rawTxt
        }
      }
      try {
        await navigator.clipboard.writeText(txtToCopy);
        setWorkMenuOpenId(null);
      } catch (e) {
        alert('复制失败，请检查浏览器权限或使用 HTTPS 页面。');
      }
    },
    [works, aiPolish, getAuthHeaders]
  );

  const downloadTtsWorkBundle = useCallback(
    async (id) => {
      const sid = String(id || '').trim();
      if (!sid) return;
      const target = works.find((w) => String(w.id) === sid);
      if (!target?.audioUrl) {
        alert('没有可下载的音频');
        return;
      }
      let scriptText = String(target?.scriptText || target?.text || '').trim();
      if (scriptText && aiPolish) {
        try {
          const res = await fetch(apiPath('/api/tts_sanitize'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({ text: scriptText }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data?.success && typeof data?.text === 'string') {
            const cleaned = data.text.trim();
            if (cleaned) scriptText = cleaned;
          }
        } catch (e) {
          // 与「复制文稿」一致：失败则使用原文
        }
      }
      setTtsWorkZipBusyId(sid);
      setWorkMenuOpenId(null);
      try {
        await downloadWorkBundleZip({
          title: target.title || '未命名',
          audioUrl: target.audioUrl,
          scriptText,
          coverRaw: target.coverImage || target.cover_image,
          getAuthHeaders,
        });
      } catch (e) {
        alert(e?.message || String(e));
      } finally {
        setTtsWorkZipBusyId(null);
      }
    },
    [works, aiPolish, getAuthHeaders]
  );

  const setWorkPlaybackRate = useCallback((id, rate) => {
    const sid = String(id || '').trim();
    if (!sid) return;
    const r = Number(rate);
    if (!Number.isFinite(r) || r <= 0) return;
    setWorkRates((prev) => ({ ...(prev || {}), [sid]: r }));
    const el = workAudioRefs.current?.[sid];
    if (el) {
      try {
        el.playbackRate = r;
      } catch (e) {
        // ignore
      }
    }
  }, []);

  const runPolishPreview = useCallback(async () => {
    const body = text.trim();
    if (!body) {
      setPolishPreview('');
      return;
    }
    setPolishPreviewBusy(true);
    try {
      const res = await fetch(apiPath('/api/tts_sanitize'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ text: body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || `请求失败 ${res.status}`);
      }
      setPolishPreview(String(data.text || '').trim());
    } catch (e) {
      setPolishPreview('');
      const msg = e?.message || String(e);
      setError(msg);
    } finally {
      setPolishPreviewBusy(false);
    }
  }, [getAuthHeaders, text]);

  useEffect(() => {
    if (!aiPolish) {
      setPolishPreview('');
      return;
    }
    runPolishPreview();
  }, [aiPolish, runPolishPreview]);

  const runTts = async () => {
    setError('');
    const k = getStoredApiKey();
    if (!k) {
      alert('请先在左侧导航「API」页面配置 MiniMax API Key');
      return;
    }
    const body = text.trim();
    if (!body) {
      alert('请先输入或上传文本');
      return;
    }
    const vid1 = resolveVoiceId(voiceKey1);
    const vid2 = resolveVoiceId(voiceKey2);
    if (!vid1 || (ttsMode === 'dual' && !vid2)) {
      alert('正在加载音色列表，请稍后再试');
      return;
    }
    if (ttsMode === 'dual') {
      const hasLine = /^\s*Speaker\s*[12]\s*[:：]/im.test(body);
      if (!hasLine) {
        alert('双人模式请使用 Speaker1: / Speaker2: 分行标注对白。');
        return;
      }
    }
    const featureOk = await ensureFeatureUnlocked();
    if (!featureOk) {
      alert('请先登录并完成验证后再生成语音');
      return;
    }

    const introPlain = introText.trim();
    const outroPlain = endingText.trim();
    const { intro_voice_id, outro_voice_id } = buildTtsIntroOutroVoiceIds(vid1, vid2);

    setLoading(true);
    setLastAudioUrl('');
    try {
      const payload = {
        api_key: k,
        tts_mode: ttsMode,
        text: body,
        language,
        ai_polish: aiPolish,
        intro_text: introPlain,
        outro_text: outroPlain,
      };
      if (ttsMode === 'single') {
        payload.voice_id = vid1;
      } else {
        payload.voice_id_1 = vid1;
        payload.voice_id_2 = vid2;
      }
      if (intro_voice_id) payload.intro_voice_id = intro_voice_id;
      if (outro_voice_id) payload.outro_voice_id = outro_voice_id;

      const res = await fetch(apiPath('/api/text_to_speech'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || `请求失败 ${res.status}`);
      }
      const url = data.audio_url;
      setLastAudioUrl(url);
      const voiceLabel1 = voiceOptions.find((v) => String(v.key) === String(voiceKey1))?.name || voiceKey1;
      const voiceLabel2 = voiceOptions.find((v) => String(v.key) === String(voiceKey2))?.name || voiceKey2;
      const speakers = ttsMode === 'dual' ? `${voiceLabel1} · ${voiceLabel2}` : `${voiceLabel1}`;
      const entry = {
        id: `${Date.now()}`,
        title: body.slice(0, 40) + (body.length > 40 ? '…' : ''),
        audioUrl: url,
        scriptText: body,
        createdAt: new Date().toISOString(),
        polished: !!data.polished,
        speakers,
        coverImage: data.cover_image || '',
      };
      const next = [entry, ...works.filter((w) => w.id !== entry.id)];
      setWorks(next);
      saveWorks(next);
    } catch (err) {
      const msg = err?.message || String(err);
      if (String(msg).includes('Failed to fetch')) {
        setError('Failed to fetch：无法连接后端服务。请确认后端已启动（:5001）且跨域未拦截（Authorization 预检）。');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const resolveUrl = resolveMediaUrl;

  const ttsVoicePanel = (which) => {
    const curKey = which === '1' ? voiceKey1 : voiceKey2;
    const setKey = which === '1' ? setVoiceKey1 : setVoiceKey2;
    const savedOpts = voiceOptions.filter((v) => v.group === 'saved');

    return (
      <div className="tts-voice-popover-inner">
        {savedOpts.length > 0 && (
          <div className="tts-voice-block">
            <div className="tts-voice-block-title">克隆音色</div>
            <div className="tts-voice-chip-row">
              {savedOpts.map((v) => {
                const active = curKey === v.key;
                return (
                  <button
                    key={v.key}
                    type="button"
                    className={`tts-voice-chip ${active ? 'tts-voice-chip--on' : ''}`}
                    onClick={() => {
                      setKey(v.key);
                      setTtsVoicePop(null);
                    }}
                  >
                    {v.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <details className="tts-voice-preset-details">
          <summary className="tts-voice-preset-summary">预设音色（默认折叠，展开后可按类型筛选）</summary>
          <div className="tts-voice-filters">
            <span className="tts-voice-filter-label">性别</span>
            <div className="tts-voice-filter-row">
              {[
                { k: 'all', t: '全部' },
                { k: 'male', t: '男' },
                { k: 'female', t: '女' },
                { k: 'other', t: '其他' },
              ].map(({ k, t }) => (
                <button
                  key={k}
                  type="button"
                  className={`tts-voice-filter-chip ${ttsVoiceGenderFilter === k ? 'tts-voice-filter-chip--on' : ''}`}
                  onClick={() => setTtsVoiceGenderFilter(k)}
                >
                  {t}
                </button>
              ))}
            </div>
            {ttsComposerLangChips.length > 0 && (
              <>
                <span className="tts-voice-filter-label">语言</span>
                <div className="tts-voice-filter-row">
                  <button
                    type="button"
                    className={`tts-voice-filter-chip ${ttsVoiceLangFilter === 'all' ? 'tts-voice-filter-chip--on' : ''}`}
                    onClick={() => setTtsVoiceLangFilter('all')}
                  >
                    全部
                  </button>
                  {ttsComposerLangChips.map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      className={`tts-voice-filter-chip ${ttsVoiceLangFilter === lang ? 'tts-voice-filter-chip--on' : ''}`}
                      onClick={() => setTtsVoiceLangFilter(lang)}
                    >
                      {lang}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {ttsComposerFilteredGroups.length === 0 ? (
            <p className="tts-voice-filter-empty">当前筛选下暂无预设，请选「全部」或调整类型。</p>
          ) : (
            <TtsGroupedVoiceSelect
              groups={ttsComposerFilteredGroups}
              value={curKey}
              onChange={(k) => {
                setKey(k);
                setTtsVoicePop(null);
              }}
              id={which === '1' ? 'tts-composer-voice-1' : 'tts-composer-voice-2'}
              className="tts-tb-voice-grouped-select"
            />
          )}
        </details>
      </div>
    );
  };

  return (
    <div className="tts-page">
      <div className="section tts-hero-card">
        <h1 className="tts-hero-title">文本转语音</h1>
        <p className="tts-hero-sub">将文本转换为自然口语</p>
      </div>

      <div className="section tts-main-wrap">
        <div className="tts-composer-outer">
        <div
          className={`tts-composer ${dropActive ? 'tts-composer--drop' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDropActive(true);
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={handleDrop}
        >
          <textarea
            id="tts-text"
            className="tts-composer-input"
            placeholder="输入文字、上传文件或粘贴链接，我们帮你自然地读出来"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            aria-label="朗读文本"
          />
          {ttsMode === 'dual' && (
            <p className="tts-dual-hint">
              双人模式：正文请使用 <code>Speaker1:</code> / <code>Speaker2:</code> 分行书写对白。
            </p>
          )}
          {aiPolish && (polishPreviewBusy || polishPreview) && (
            <div className="tts-polish-preview">
              <div className="tts-polish-preview-head">
                <span className="tts-polish-preview-title">格式预览（用于朗读）</span>
                <button
                  type="button"
                  className="tts-polish-preview-apply"
                  disabled={polishPreviewBusy || !polishPreview}
                  onClick={() => {
                    setText(polishPreview);
                    setPolishPreview('');
                    setPolishPreviewBusy(false);
                  }}
                >
                  {polishPreviewBusy ? '生成中…' : '替换到输入框'}
                </button>
              </div>
              <textarea
                className="tts-polish-preview-box"
                value={polishPreviewBusy ? '正在生成格式预览…' : polishPreview}
                readOnly
                rows={4}
              />
            </div>
          )}

          <div className="tts-composer-toolbar">
            <div className="tts-toolbar-bar">
              <div className="tts-toolbar-pill" role="toolbar" aria-label="朗读选项">
                <div className="tts-mode-seg" role="group" aria-label="单人或双人">
                  <button
                    type="button"
                    className={`tts-mode-btn ${ttsMode === 'single' ? 'tts-mode-btn--on' : ''}`}
                    onClick={() => setTtsMode('single')}
                  >
                    单人
                  </button>
                  <button
                    type="button"
                    className={`tts-mode-btn ${ttsMode === 'dual' ? 'tts-mode-btn--on' : ''}`}
                    onClick={() => setTtsMode('dual')}
                  >
                    双人
                  </button>
                </div>
                <span className="tts-tb-divider" aria-hidden />
                <label className="tts-tb-lang">
                  <span className="tts-tb-ico" aria-hidden>
                    🌐
                  </span>
                  <select
                    className="tts-tb-select"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    aria-label="语言"
                  >
                    {LANGUAGE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="tts-tb-divider" aria-hidden />
                <div className="tts-tb-voice-wrap" ref={ttsVoiceWrap1Ref}>
                  <button
                    type="button"
                    className={`tts-tb-voice-trigger ${ttsVoicePop === '1' ? 'tts-tb-voice-trigger--on' : ''}`}
                    disabled={!voiceOptions.length}
                    onClick={() => setTtsVoicePop((p) => (p === '1' ? null : '1'))}
                    aria-expanded={ttsVoicePop === '1'}
                    aria-label={ttsMode === 'dual' ? 'Speaker1 音色' : '音色'}
                  >
                    <span className="tts-tb-ico tts-tb-ico-wave" aria-hidden>
                      ∿
                    </span>
                    <span className="tts-tb-voice-trigger-label">{ttsMode === 'dual' ? 'S1' : '音色'}</span>
                    <span className="tts-tb-voice-trigger-value">{voiceOptionLabel(voiceKey1)}</span>
                  </button>
                  {ttsVoicePop === '1' && <div className="tts-voice-popover">{ttsVoicePanel('1')}</div>}
                </div>
                {ttsMode === 'dual' && (
                  <>
                    <span className="tts-tb-divider" aria-hidden />
                    <div className="tts-tb-voice-wrap" ref={ttsVoiceWrap2Ref}>
                      <button
                        type="button"
                        className={`tts-tb-voice-trigger ${ttsVoicePop === '2' ? 'tts-tb-voice-trigger--on' : ''}`}
                        disabled={!voiceOptions.length}
                        onClick={() => setTtsVoicePop((p) => (p === '2' ? null : '2'))}
                        aria-expanded={ttsVoicePop === '2'}
                        aria-label="Speaker2 音色"
                      >
                        <span className="tts-tb-ico tts-tb-ico-wave" aria-hidden>
                          ∿
                        </span>
                        <span className="tts-tb-voice-trigger-label">S2</span>
                        <span className="tts-tb-voice-trigger-value">{voiceOptionLabel(voiceKey2)}</span>
                      </button>
                      {ttsVoicePop === '2' && <div className="tts-voice-popover">{ttsVoicePanel('2')}</div>}
                    </div>
                  </>
                )}
                <span className="tts-tb-divider" aria-hidden />
                <button
                  type="button"
                  className="tts-tb-io-btn"
                  onClick={() => {
                    setShowIoModal(true);
                    setTtsVoicePop(null);
                  }}
                  title="开场结尾配置"
                >
                  <span className="tts-tb-io-ico" aria-hidden>
                  <IcoBrackets />
                  </span>
                  <span>开场结尾</span>
                </button>
                <span className="tts-tb-divider" aria-hidden />
                <label className="tts-tb-switch">
                  <span className="tts-tb-switch-text">优化格式</span>
                  <input
                    type="checkbox"
                    className="tts-switch-input"
                    checked={aiPolish}
                    onChange={(e) => setAiPolish(e.target.checked)}
                  />
                  <span className="tts-switch-ui" />
                </label>
              </div>

              <div className="tts-toolbar-trailing">
                <div className="tts-icon-actions" ref={urlPopoverRef}>
                  <button
                    type="button"
                    className={`tts-icon-btn ${urlPopoverOpen ? 'tts-icon-btn--on' : ''}`}
                    title="从链接抓取正文"
                    aria-expanded={urlPopoverOpen}
                    onClick={() => setUrlPopoverOpen((o) => !o)}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                  </button>
                  {urlPopoverOpen && (
                    <div className="tts-url-popover" role="dialog" aria-label="粘贴网页链接">
                      <input
                        type="url"
                        className="tts-url-input"
                        placeholder="https://…"
                        value={urlDraft}
                        onChange={(e) => setUrlDraft(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && fetchUrlIntoText()}
                      />
                      <button
                        type="button"
                        className="tts-url-fetch-btn"
                        disabled={urlLoading}
                        onClick={fetchUrlIntoText}
                      >
                        {urlLoading ? '抓取中…' : '抓取正文'}
                      </button>
                    </div>
                  )}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,.markdown"
                    className="tts-hidden-file"
                    onChange={(e) => {
                      mergeFileText(e.target.files);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    className="tts-icon-btn"
                    title="上传 .txt / .md"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="12" y1="18" x2="12" y2="11" />
                      <polyline points="9 14 12 11 15 14" />
                    </svg>
                  </button>
                </div>

                <button
                  type="button"
                  className="tts-run-arrow"
                  disabled={loading}
                  onClick={runTts}
                  title={loading ? '合成中…' : '生成语音'}
                  aria-label="生成语音"
                >
                  {loading ? (
                    <span className="tts-run-spinner" />
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
        </div>

        {error && <p className="tts-error">{error}</p>}

        {lastAudioUrl && (
          <div className="tts-audio-preview">
            <p className="tts-audio-label">本次生成</p>
            <audio controls className="tts-audio-el" src={resolveUrl(lastAudioUrl)} />
            <a className="tts-download" href={resolveUrl(lastAudioUrl)} download>
              下载 MP3
            </a>
          </div>
        )}
      </div>

      <div className="section tts-bottom-section">
        <div className="tts-bottom-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={bottomTab === 'works'}
            className={`tts-bottom-tab ${bottomTab === 'works' ? 'tts-bottom-tab--active' : ''}`}
            onClick={() => setBottomTab('works')}
          >
            我的作品
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={bottomTab === 'templates'}
            className={`tts-bottom-tab ${bottomTab === 'templates' ? 'tts-bottom-tab--active' : ''}`}
            onClick={() => setBottomTab('templates')}
          >
            模板
          </button>
        </div>
        <div className="tts-bottom-panel">
          {bottomTab === 'works' && (
            <div className="tts-panel-block tts-panel-block--flat">
              {works.length === 0 ? (
                <p className="tts-empty">暂无项目</p>
              ) : (
                <div className="podcast-work-cards">
                  {works.map((w) => {
                    const sid = String(w.id);
                    const title = String(w.title || '').trim() || '未命名';
                    const durText = formatDuration(workDurations[sid]);
                    const createdText = formatCreatedAt(w.createdAt);
                    const voicesText = String(w.speakers || '').trim();
                    const metaParts = [voicesText, durText ? `时长 ${durText}` : '', createdText].filter(Boolean);
                    const metaText = metaParts.join(' · ');
                    const coverSrc = getWorkCoverSrc(w.coverImage || w.cover_image);
                    return (
                      <div key={sid} className="podcast-work-card">
                        <div className="podcast-work-card-cover">
                          <WorkCoverImg src={coverSrc} />
                        </div>
                        <div className="podcast-work-card-body">
                          <div className="podcast-work-card-title-row">
                            <div className="podcast-work-card-title" title={title}>
                              {title}
                            </div>
                            <button
                              type="button"
                              className="podcast-work-card-play"
                              onClick={() =>
                                setWorkPlayingId((cur) => (String(cur) === sid ? null : sid))
                              }
                              aria-label="播放"
                              title="播放"
                              disabled={!w.audioUrl}
                            >
                              ▶
                            </button>
                            <div
                              className="tts-work-menu"
                              ref={(el) => {
                                if (!w?.id) return;
                                workMenuRefs.current[String(w.id)] = el;
                              }}
                            >
                              <button
                                type="button"
                                className={`tts-work-more ${String(workMenuOpenId) === String(w.id) ? 'tts-work-more--on' : ''}`}
                                onClick={() => {
                                  const nextOpen = String(workMenuOpenId) === String(w.id) ? null : String(w.id);
                                  if (nextOpen) {
                                    try {
                                      const anchor = workMenuRefs.current?.[String(w.id)];
                                      const rect = anchor?.getBoundingClientRect?.();
                                      const vh = window.innerHeight || 800;
                                      const spaceBelow = rect ? vh - rect.bottom : 9999;
                                      const openUp = spaceBelow < 260;
                                      setWorkMenuDir((prev) => ({
                                        ...(prev || {}),
                                        [String(w.id)]: openUp ? 'up' : 'down'
                                      }));
                                    } catch (e) {
                                      // ignore
                                    }
                                  }
                                  setWorkMenuOpenId(nextOpen);
                                }}
                                aria-label="更多"
                                title="更多"
                              >
                                …
                              </button>
                              {String(workMenuOpenId) === String(w.id) && (
                                <div
                                  className={`tts-work-dropdown ${
                                    workMenuDir[String(w.id)] === 'up' ? 'tts-work-dropdown--up' : ''
                                  }`}
                                  role="menu"
                                  aria-label="作品操作"
                                >
                                  <button
                                    type="button"
                                    className="tts-work-dd-item"
                                    role="menuitem"
                                    disabled={String(ttsWorkZipBusyId) === String(w.id)}
                                    onClick={() => downloadTtsWorkBundle(w.id)}
                                  >
                                    {String(ttsWorkZipBusyId) === String(w.id) ? '打包中…' : '打包下载'}
                                  </button>
                                  <button type="button" className="tts-work-dd-item" onClick={() => renameWork(w.id)} role="menuitem">
                                    改名
                                  </button>
                                  <button
                                    type="button"
                                    className="tts-work-dd-item"
                                    onClick={() => copyWorkScript(w.id)}
                                    disabled={!String(w?.scriptText || w?.text || '').trim()}
                                    role="menuitem"
                                  >
                                    复制文稿
                                  </button>
                                  <div className="tts-work-dd-item tts-work-dd-item--row" role="menuitem">
                                    <span className="tts-work-dd-label">播放速度</span>
                                    <select
                                      className="tts-work-rate"
                                      value={String(workRates[String(w.id)] || 1)}
                                      onChange={(e) => setWorkPlaybackRate(w.id, e.target.value)}
                                      aria-label="播放速度"
                                    >
                                      {[0.75, 1, 1.25, 1.5, 2].map((r) => (
                                        <option key={r} value={r}>
                                          {r}×
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <button type="button" className="tts-work-dd-item tts-work-dd-danger" onClick={() => deleteWork(w.id)} role="menuitem">
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

                          {workPlayingId === sid && w.audioUrl && (
                            <div className="podcast-work-card-inline-player">
                              <audio
                                className="podcast-work-card-inline-audio"
                                ref={workInlineAudioRef}
                                controls
                                src={resolveUrl(w.audioUrl)}
                                preload="none"
                                onPlay={() => pauseOtherWorks(w.id)}
                                onLoadedMetadata={(e) => {
                                  const d = e?.currentTarget?.duration;
                                  if (Number.isFinite(d) && d > 0) {
                                    setWorkDurations((prev) => ({ ...(prev || {}), [sid]: d }));
                                  }
                                  const rate = Number(workRates[sid] || 1) || 1;
                                  try {
                                    e.currentTarget.playbackRate = rate;
                                  } catch (err) {
                                    // ignore
                                  }
                                }}
                              />
                              <div className="podcast-work-card-inline-actions">
                                <label className="podcast-work-card-inline-rate">
                                  <span>倍速</span>
                                  <select value={String(workRates[sid] || 1)} onChange={(e) => setWorkPlaybackRate(w.id, e.target.value)}>
                                    {[0.75, 1, 1.25, 1.5, 2].map((r) => (
                                      <option key={r} value={r}>
                                        {r}×
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <button type="button" className="api-key-clear-btn podcast-work-card-inline-close" onClick={() => setWorkPlayingId(null)}>
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
          )}
          {bottomTab === 'templates' && (
            <div className="tts-panel-block tts-panel-block--flat">
              {/* 预留空白：等待后续模板逻辑接入 */}
            </div>
          )}
        </div>
      </div>

      {showIoModal && (
        <div className="tts-modal-mask tts-modal-mask--wide" role="presentation" onClick={() => setShowIoModal(false)}>
          <div
            className="tts-modal tts-modal--scroll"
            role="dialog"
            aria-labelledby="tts-io-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="tts-io-title">🎼 开场结尾配置</h3>
            <AudioStyleIntroForm
              defaultVoiceGroups={defaultVoiceGroups}
              savedCustomVoices={savedCustomVoices}
              savedBgms={savedBgms}
              audioStylePresets={audioStylePresets}
              selectedAudioStylePresetId={selectedAudioStylePresetId}
              setSelectedAudioStylePresetId={setSelectedAudioStylePresetId}
              onLoadPreset={loadAudioStylePreset}
              onSavePreset={saveAudioStylePreset}
              introText={introText}
              setIntroText={setIntroText}
              endingText={endingText}
              setEndingText={setEndingText}
              introVoiceMode={introVoiceMode}
              setIntroVoiceMode={setIntroVoiceMode}
              introVoiceName={introVoiceName}
              setIntroVoiceName={setIntroVoiceName}
              introCustomVoiceId={introCustomVoiceId}
              setIntroCustomVoiceId={setIntroCustomVoiceId}
              endingVoiceMode={endingVoiceMode}
              setEndingVoiceMode={setEndingVoiceMode}
              endingVoiceName={endingVoiceName}
              setEndingVoiceName={setEndingVoiceName}
              endingCustomVoiceId={endingCustomVoiceId}
              setEndingCustomVoiceId={setEndingCustomVoiceId}
              introBgm1Mode={introBgm1Mode}
              setIntroBgm1Mode={setIntroBgm1Mode}
              introBgm1SavedId={introBgm1SavedId}
              setIntroBgm1SavedId={setIntroBgm1SavedId}
              introBgm2Mode={introBgm2Mode}
              setIntroBgm2Mode={setIntroBgm2Mode}
              introBgm2SavedId={introBgm2SavedId}
              setIntroBgm2SavedId={setIntroBgm2SavedId}
              endingBgm1Mode={endingBgm1Mode}
              setEndingBgm1Mode={setEndingBgm1Mode}
              endingBgm1SavedId={endingBgm1SavedId}
              setEndingBgm1SavedId={setEndingBgm1SavedId}
              endingBgm2Mode={endingBgm2Mode}
              setEndingBgm2Mode={setEndingBgm2Mode}
              endingBgm2SavedId={endingBgm2SavedId}
              setEndingBgm2SavedId={setEndingBgm2SavedId}
              introBgm1File={introBgm1File}
              setIntroBgm1File={setIntroBgm1File}
              introBgm2File={introBgm2File}
              setIntroBgm2File={setIntroBgm2File}
              endingBgm1File={endingBgm1File}
              setEndingBgm1File={setEndingBgm1File}
              endingBgm2File={endingBgm2File}
              setEndingBgm2File={setEndingBgm2File}
              handleBgmFileChange={handleBgmFileChange}
            />
            <div className="tts-modal-actions">
              <button type="button" className="tts-modal-done" onClick={() => setShowIoModal(false)}>
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TextToSpeechPanel;
