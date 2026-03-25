import React, { useEffect, useState, useRef, useMemo } from 'react';
import { getApiBaseUrl } from '../apiBaseUrl';
import { buildGroupedSelectOptions } from '../voiceCatalogUtils';
import {
  readEnabledPresetKeys,
  writeSpeakerDefaultVoiceKeys,
  readSpeakerDefaultVoiceKeys,
  readSpeakerClonedVoiceIds,
  writeSpeakerClonedVoiceIds,
  PRESET_VOICES_CHANGED_EVENT,
  ENABLED_PRESET_VOICES_KEY,
  SPEAKER_DEFAULT_VOICE_KEYS_KEY,
  SPEAKER_CLONED_VOICE_IDS_KEY
} from '../presetVoicesStorage';
import './PodcastGenerator.css';

/** 文案接口返回 HTML 404 时的可读说明 */
function formatScriptDraftHttpError(status, errText, apiBase, pageHost) {
  const body = errText || '';
  const looksLikeHtml404 =
    status === 404 && (/<!doctype html/i.test(body) || /<h1>Not Found<\/h1>/i.test(body));
  const base = (apiBase || '').trim() || '（空：走当前网页同源，需 npm start 代理或 Nginx 反代）';
  if (looksLikeHtml404) {
    return [
      '接口 404：请求没有到达带「文案生成」路由的 Flask 服务。',
      `当前 API 基址：${base}；页面地址：${pageHost || '—'}。`,
      '请：① backend 用最新代码重启：../.venv/bin/python app.py；',
      '② 访问 http://127.0.0.1:5001/api/ping 应返回 {"ok":true}；',
      '③ npm start 已默认直连 :5001（见 .env.development / apiBaseUrl.js）；若仍为空请设 REACT_APP_API_URL 后重启 npm start。'
    ].join(' ');
  }
  return `HTTP ${status} ${body.replace(/\s+/g, ' ').slice(0, 200)}`;
}

/** 脚本目标正文字数（与服务端 PODCAST_CONFIG、模型可稳定输出上限一致） */
const SCRIPT_TARGET_CHARS_MIN = 200;
const SCRIPT_TARGET_CHARS_DEFAULT = 200;
const SCRIPT_TARGET_CHARS_MAX = 5000;
const DEFAULT_SCRIPT_CONSTRAINTS = '对话内容中不能包含（笑）（停顿）（思考）等动作、心理活动或场景描述，只生成纯对话文本。';

function parseScriptTargetCharsInput(raw) {
  const n = parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(n)) return null;
  if (n < SCRIPT_TARGET_CHARS_MIN) return null;
  if (n > SCRIPT_TARGET_CHARS_MAX) return null;
  return n;
}

/** 开始生成播客时使用：校验最小值与上限 */
function parseScriptTargetCharsForGenerate(raw) {
  const n = parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(n)) return null;
  if (n < SCRIPT_TARGET_CHARS_MIN) return null;
  if (n > SCRIPT_TARGET_CHARS_MAX) return null;
  return n;
}

/** 与后端未启动或接口失败时的默认音色（与 config.DEFAULT_VOICES 中 mini/max 一致） */
const FALLBACK_DEFAULT_VOICES_MAP = {
  mini: { name: 'Mini', gender: 'female', description: '女声 - 活泼亲切', voice_id: '' },
  max: { name: 'Max', gender: 'male', description: '男声 - 稳重专业', voice_id: '' }
};

function GroupedDefaultVoiceSelect({ groups, value, onChange, id }) {
  if (!groups || groups.length === 0) return null;
  return (
    <select
      id={id}
      className="default-voice-grouped-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
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

const PodcastGenerator = ({ showApiConfig = true }) => {
  // 状态管理
  const [apiKey, setApiKey] = useState('');
  const [rememberApiKey, setRememberApiKey] = useState(true);
  const [textInput, setTextInput] = useState('');
  const [urlInputs, setUrlInputs] = useState([]);
  const [urlInputDraft, setUrlInputDraft] = useState('');
  const [pdfFiles, setPdfFiles] = useState([]);

  // 加工模式：默认 AI，可切换到用户加工
  const [editMode, setEditMode] = useState('ai');
  const [manualScript, setManualScript] = useState('');
  const [manualCoverText, setManualCoverText] = useState('');
  const [manualCoverFile, setManualCoverFile] = useState(null);
  const [scriptTargetChars, setScriptTargetChars] = useState(String(SCRIPT_TARGET_CHARS_DEFAULT));
  const [longScriptMode, setLongScriptMode] = useState(false);
  const [scriptStyle, setScriptStyle] = useState('轻松幽默，自然流畅');
  const [scriptLanguage, setScriptLanguage] = useState('中文');
  const [programName, setProgramName] = useState('AI播客节目');
  const [speaker1Persona, setSpeaker1Persona] = useState('活泼亲切，引导话题');
  const [speaker2Persona, setSpeaker2Persona] = useState('稳重专业，深度分析');
  const [scriptConstraints, setScriptConstraints] = useState(DEFAULT_SCRIPT_CONSTRAINTS);
  const [useRag, setUseRag] = useState(true);

  const [speaker1Type, setSpeaker1Type] = useState(() =>
    readSpeakerClonedVoiceIds().speaker1 ? 'custom' : 'default'
  );
  const [speaker1Voice, setSpeaker1Voice] = useState(() => readSpeakerDefaultVoiceKeys().speaker1);
  const [speaker1Audio, setSpeaker1Audio] = useState(null);
  const [speaker1CustomMode, setSpeaker1CustomMode] = useState('upload');
  const [speaker1SavedVoiceId, setSpeaker1SavedVoiceId] = useState(
    () => readSpeakerClonedVoiceIds().speaker1 || ''
  );

  const [speaker2Type, setSpeaker2Type] = useState(() =>
    readSpeakerClonedVoiceIds().speaker2 ? 'custom' : 'default'
  );
  const [speaker2Voice, setSpeaker2Voice] = useState(() => readSpeakerDefaultVoiceKeys().speaker2);
  const [speaker2Audio, setSpeaker2Audio] = useState(null);
  const [speaker2CustomMode, setSpeaker2CustomMode] = useState('upload');
  const [speaker2SavedVoiceId, setSpeaker2SavedVoiceId] = useState(
    () => readSpeakerClonedVoiceIds().speaker2 || ''
  );
  const [savedCustomVoices, setSavedCustomVoices] = useState([]);
  const [savedBgms, setSavedBgms] = useState([]);

  const [audioStyleMode, setAudioStyleMode] = useState('default');
  const [introText, setIntroText] = useState('');
  const [endingText, setEndingText] = useState('');
  const [introVoiceMode, setIntroVoiceMode] = useState('default');
  const [introVoiceName, setIntroVoiceName] = useState('max');
  const [introCustomVoiceId, setIntroCustomVoiceId] = useState('');
  const [endingVoiceMode, setEndingVoiceMode] = useState('default');
  const [endingVoiceName, setEndingVoiceName] = useState('max');
  const [endingCustomVoiceId, setEndingCustomVoiceId] = useState('');
  const [introBgm1Mode, setIntroBgm1Mode] = useState('default');
  const [introBgm1SavedId, setIntroBgm1SavedId] = useState('');
  const [introBgm1File, setIntroBgm1File] = useState(null);
  const [introBgm2Mode, setIntroBgm2Mode] = useState('default');
  const [introBgm2SavedId, setIntroBgm2SavedId] = useState('');
  const [introBgm2File, setIntroBgm2File] = useState(null);
  const [endingBgm1Mode, setEndingBgm1Mode] = useState('default');
  const [endingBgm1SavedId, setEndingBgm1SavedId] = useState('');
  const [endingBgm1File, setEndingBgm1File] = useState(null);
  const [endingBgm2Mode, setEndingBgm2Mode] = useState('default');
  const [endingBgm2SavedId, setEndingBgm2SavedId] = useState('');
  const [endingBgm2File, setEndingBgm2File] = useState(null);
  const [audioStylePresets, setAudioStylePresets] = useState([]);
  const [selectedAudioStylePresetId, setSelectedAudioStylePresetId] = useState('');
  const [showSaveAudioStylePresetModal, setShowSaveAudioStylePresetModal] = useState(false);
  const [audioStylePresetNameInput, setAudioStylePresetNameInput] = useState('');

  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState('');
  const [logs, setLogs] = useState([]);
  const [script, setScript] = useState([]);
  const [coverImage, setCoverImage] = useState('');
  const [traceIds, setTraceIds] = useState([]);

  const [audioUrl, setAudioUrl] = useState('');
  const [scriptUrl, setScriptUrl] = useState('');

  const [showLogs, setShowLogs] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [showFinalCopyModal, setShowFinalCopyModal] = useState(false);
  const [finalCopyText, setFinalCopyText] = useState('');
  const [finalCopyLoading, setFinalCopyLoading] = useState(false);
  const [finalCopyTitle, setFinalCopyTitle] = useState('💡 加入创意');
  const [finalCopyLlmGenerating, setFinalCopyLlmGenerating] = useState(false);
  const [finalCopyDraftStatus, setFinalCopyDraftStatus] = useState('');
  const [finalCopyReadyToPickVoice, setFinalCopyReadyToPickVoice] = useState(false);

  // 渐进式播放相关状态 - 双缓冲方案
  const [activePlayer, setActivePlayer] = useState(0);  // 当前激活的播放器 (0 或 1)
  const [player0Url, setPlayer0Url] = useState('');
  const [player1Url, setPlayer1Url] = useState('');

  // URL 解析警告
  const [urlWarning, setUrlWarning] = useState(null);  // {message: string, error_code: string}
  const [selectedNoteIds, setSelectedNoteIds] = useState([]);
  const [selectedNoteItems, setSelectedNoteItems] = useState([]);
  const [availableNotes, setAvailableNotes] = useState([]);
  const [noteToAddId, setNoteToAddId] = useState('');
  const [defaultVoicesMap, setDefaultVoicesMap] = useState(FALLBACK_DEFAULT_VOICES_MAP);
  const [enabledPresetKeys, setEnabledPresetKeys] = useState(() => readEnabledPresetKeys());

  const displayVoicesMap = useMemo(() => {
    const enabled = new Set(enabledPresetKeys);
    const src = defaultVoicesMap || {};
    const out = {};
    if (src.mini) out.mini = src.mini;
    if (src.max) out.max = src.max;
    Object.keys(src).forEach((k) => {
      if (k !== 'mini' && k !== 'max' && enabled.has(k)) {
        out[k] = src[k];
      }
    });
    return out;
  }, [defaultVoicesMap, enabledPresetKeys]);

  const defaultVoiceGroups = useMemo(
    () => buildGroupedSelectOptions(displayVoicesMap),
    [displayVoicesMap]
  );

  const defaultVoicesMapRef = useRef(defaultVoicesMap);
  defaultVoicesMapRef.current = defaultVoicesMap;

  const audioRef0 = useRef(null);
  const audioRef1 = useRef(null);
  const voiceSectionRef = useRef(null);
  const generateAbortRef = useRef(null);
  const draftAbortRef = useRef(null);

  const API_KEY_STORAGE_KEY = 'minimax_aipodcast_api_key';
  const SAVED_CUSTOM_VOICES_KEY = 'minimax_aipodcast_saved_custom_voices';
  const AUDIO_STYLE_CONFIG_KEY = 'minimax_aipodcast_audio_style_config';
  const AUDIO_STYLE_PRESETS_KEY = 'minimax_aipodcast_audio_style_presets';
  const AI_ADVANCED_CONFIG_KEY = 'minimax_aipodcast_ai_advanced_config';
  const SELECTED_NOTES_KEY = 'minimax_aipodcast_selected_notes';
  const FINAL_COPY_DRAFT_KEY = 'minimax_aipodcast_final_copy_draft_text';

  // 默认 Key（可选）：用于部署时注入，不建议写死在代码仓库里
  const DEFAULT_API_KEY = process.env.REACT_APP_DEFAULT_API_KEY || '';

  // API 根地址：见 src/apiBaseUrl.js（8000/8080 静态站会指向当前主机名的 :5001，支持 127.0.0.1 / 局域网 IP）
  const API_URL = getApiBaseUrl();
  const apiPath = (path) => `${API_URL}${path}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiPath('/api/default-voices'));
        const data = await res.json();
        const v = data && data.voices;
        if (!cancelled && v && typeof v === 'object' && Object.keys(v).length > 0) {
          setDefaultVoicesMap(v);
        }
      } catch (e) {
        // 保持 FALLBACK_DEFAULT_VOICES_MAP
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [API_URL]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      const savedDraft = window.localStorage.getItem(FINAL_COPY_DRAFT_KEY);
      if (typeof savedDraft === 'string' && savedDraft.length > 0) {
        setFinalCopyText(savedDraft);
      }
    } catch (e) {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      if (finalCopyText && finalCopyText.trim()) {
        window.localStorage.setItem(FINAL_COPY_DRAFT_KEY, finalCopyText);
      } else {
        window.localStorage.removeItem(FINAL_COPY_DRAFT_KEY);
      }
    } catch (e) {
      // ignore
    }
  }, [finalCopyText]);

  useEffect(() => {
    const syncFromStorage = () => {
      setEnabledPresetKeys((prev) => {
        const next = readEnabledPresetKeys();
        if (prev.length === next.length && prev.every((x, i) => x === next[i])) {
          return prev;
        }
        return next;
      });
      const { speaker1, speaker2 } = readSpeakerDefaultVoiceKeys();
      const enabled = new Set(readEnabledPresetKeys());
      const src = defaultVoicesMapRef.current || {};
      const keySet = new Set();
      if (src.mini) keySet.add('mini');
      if (src.max) keySet.add('max');
      Object.keys(src).forEach((k) => {
        if (k !== 'mini' && k !== 'max' && enabled.has(k)) keySet.add(k);
      });
      setSpeaker1Voice((prev) => (keySet.has(speaker1) && speaker1 !== prev ? speaker1 : prev));
      setSpeaker2Voice((prev) => (keySet.has(speaker2) && speaker2 !== prev ? speaker2 : prev));
      const { speaker1: id1, speaker2: id2 } = readSpeakerClonedVoiceIds();
      setSpeaker1Type(id1 ? 'custom' : 'default');
      setSpeaker1SavedVoiceId(id1 || '');
      setSpeaker2Type(id2 ? 'custom' : 'default');
      setSpeaker2SavedVoiceId(id2 || '');
    };
    const onStorage = (e) => {
      if (
        e.key !== ENABLED_PRESET_VOICES_KEY &&
        e.key !== SPEAKER_DEFAULT_VOICE_KEYS_KEY &&
        e.key !== SPEAKER_CLONED_VOICE_IDS_KEY
      ) {
        return;
      }
      syncFromStorage();
    };
    window.addEventListener(PRESET_VOICES_CHANGED_EVENT, syncFromStorage);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(PRESET_VOICES_CHANGED_EVENT, syncFromStorage);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    writeSpeakerDefaultVoiceKeys(speaker1Voice, speaker2Voice);
  }, [speaker1Voice, speaker2Voice]);

  useEffect(() => {
    const s1 =
      speaker1Type === 'custom' && speaker1SavedVoiceId.trim() ? speaker1SavedVoiceId.trim() : null;
    const s2 =
      speaker2Type === 'custom' && speaker2SavedVoiceId.trim() ? speaker2SavedVoiceId.trim() : null;
    writeSpeakerClonedVoiceIds(s1, s2);
  }, [speaker1Type, speaker2Type, speaker1SavedVoiceId, speaker2SavedVoiceId]);

  useEffect(() => {
    const keys = new Set(Object.keys(displayVoicesMap));
    if (keys.size === 0) return;
    const { speaker1, speaker2 } = readSpeakerDefaultVoiceKeys();
    setSpeaker1Voice((prev) => (keys.has(speaker1) && speaker1 !== prev ? speaker1 : prev));
    setSpeaker2Voice((prev) => (keys.has(speaker2) && speaker2 !== prev ? speaker2 : prev));
  }, [displayVoicesMap, enabledPresetKeys]);

  useEffect(() => {
    const keys = Object.keys(displayVoicesMap);
    if (keys.length === 0) return;
    const keySet = new Set(keys);
    const first = keys.includes('mini') ? 'mini' : keys[0];
    const second = keys.includes('max') ? 'max' : keys.find((k) => k !== first) || first;
    if (!keySet.has(speaker1Voice)) setSpeaker1Voice(first);
    if (!keySet.has(speaker2Voice)) setSpeaker2Voice(second);
    if (!keySet.has(introVoiceName)) setIntroVoiceName(first);
    if (!keySet.has(endingVoiceName)) setEndingVoiceName(second);
  }, [displayVoicesMap, speaker1Voice, speaker2Voice, introVoiceName, endingVoiceName]);

  const normalizeServerVoices = (voices) => {
    return (voices || [])
      .map((item) => {
        if (typeof item === 'string') {
          const voiceId = item.trim();
          if (!voiceId) return null;
          return { voiceId, displayName: voiceId, lastUsedAt: null, sourceSpeaker: null };
        }
        if (item && typeof item === 'object' && item.voiceId) {
          const voiceId = String(item.voiceId).trim();
          if (!voiceId) return null;
          return {
            voiceId,
            displayName: String(item.displayName || '').trim() || voiceId,
            lastUsedAt: item.lastUsedAt || null,
            sourceSpeaker: item.sourceSpeaker || null
          };
        }
        return null;
      })
      .filter(v => v && v.voiceId);
  };

  // 初始化：优先用本地保存的 Key，其次用环境变量默认 Key
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(API_KEY_STORAGE_KEY);
      if (saved && saved.trim()) {
        setApiKey(saved);
        setRememberApiKey(true);
        return;
      }
    } catch (e) {
      // ignore
    }

    if (DEFAULT_API_KEY && DEFAULT_API_KEY.trim()) {
      setApiKey(DEFAULT_API_KEY);
      setRememberApiKey(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const loadSavedBgms = async () => {
      try {
        const resp = await fetch(apiPath('/api/saved_bgms'));
        if (!resp.ok) return;
        const data = await resp.json();
        if (data && data.success && Array.isArray(data.bgms)) {
          setSavedBgms(data.bgms);
        }
      } catch (e) {
        // ignore
      }
    };
    loadSavedBgms();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      const forceAi = window.localStorage.getItem('minimax_aipodcast_force_ai_mode');
      if (forceAi === '1') {
        setEditMode('ai');
        window.localStorage.removeItem('minimax_aipodcast_force_ai_mode');
      }
    } catch (e) {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SELECTED_NOTES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        const ids = parsed.map((id) => String(id || '').trim()).filter(Boolean);
        setSelectedNoteIds(ids);
      }
    } catch (e) {
      // ignore
    }
  }, []);

  useEffect(() => {
    const loadSelectedNotes = async () => {
      try {
        const resp = await fetch(apiPath('/api/notes'));
        if (!resp.ok) return;
        const data = await resp.json();
        const allNotes = Array.isArray(data?.notes) ? data.notes : [];
        setAvailableNotes(allNotes);
        const map = new Map(
          allNotes.map((n) => [String(n.noteId || '').trim(), n])
        );
        const normalizedIds = selectedNoteIds
          .map((id) => String(id || '').trim())
          .filter(Boolean);
        const validIds = normalizedIds.filter((id) => map.has(id));
        if (validIds.length !== normalizedIds.length) {
          setSelectedNoteIds(validIds);
          try {
            window.localStorage.setItem(SELECTED_NOTES_KEY, JSON.stringify(validIds));
          } catch (e) {
            // ignore
          }
        }
        const selected = validIds.map((id) => map.get(id)).filter(Boolean);
        setSelectedNoteItems(selected);
      } catch (e) {
        // ignore
      }
    };
    loadSelectedNotes();
  }, [selectedNoteIds]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(AUDIO_STYLE_CONFIG_KEY);
      if (!raw) return;
      const c = JSON.parse(raw);
      if (!c || typeof c !== 'object') return;
      setAudioStyleMode(c.audioStyleMode || 'default');
      setIntroText(c.introText || '');
      setEndingText(c.endingText || '');
      setIntroVoiceMode(c.introVoiceMode || 'default');
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
      setEndingBgm2Mode(c.endingBgm2Mode || 'default');
      setEndingBgm2SavedId(c.endingBgm2SavedId || '');
    } catch (e) {
      // ignore
    }
  }, []);

  useEffect(() => {
    const payload = {
      audioStyleMode,
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
      endingBgm2SavedId
    };
    try {
      window.localStorage.setItem(AUDIO_STYLE_CONFIG_KEY, JSON.stringify(payload));
    } catch (e) {
      // ignore
    }
  }, [
    audioStyleMode,
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
    endingBgm2SavedId
  ]);

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
            config: item.config && typeof item.config === 'object' ? item.config : {}
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
      const raw = window.localStorage.getItem(AI_ADVANCED_CONFIG_KEY);
      if (!raw) return;
      const cfg = JSON.parse(raw);
      if (!cfg || typeof cfg !== 'object') return;
      if (cfg.scriptTargetChars !== undefined && cfg.scriptTargetChars !== null) {
        const n = Number(cfg.scriptTargetChars);
        if (Number.isFinite(n)) {
          const clamped = Math.max(SCRIPT_TARGET_CHARS_MIN, Math.min(SCRIPT_TARGET_CHARS_MAX, Math.round(n)));
          setScriptTargetChars(String(clamped));
        }
      }
      if (cfg.longScriptMode !== undefined) setLongScriptMode(Boolean(cfg.longScriptMode));
      if (cfg.scriptStyle) setScriptStyle(cfg.scriptStyle);
      if (cfg.scriptLanguage) setScriptLanguage(cfg.scriptLanguage);
      if (cfg.programName) setProgramName(cfg.programName);
      if (cfg.speaker1Persona) setSpeaker1Persona(cfg.speaker1Persona);
      if (cfg.speaker2Persona) setSpeaker2Persona(cfg.speaker2Persona);
      if (cfg.scriptConstraints) setScriptConstraints(cfg.scriptConstraints);
      if (cfg.useRag !== undefined) setUseRag(Boolean(cfg.useRag));
    } catch (e) {
      // ignore
    }
  }, []);

  useEffect(() => {
    const n = parseInt(String(scriptTargetChars).trim(), 10);
    const payload = {
      scriptTargetChars: Number.isFinite(n)
        ? Math.max(SCRIPT_TARGET_CHARS_MIN, Math.min(SCRIPT_TARGET_CHARS_MAX, n))
        : SCRIPT_TARGET_CHARS_DEFAULT,
      longScriptMode,
      scriptStyle,
      scriptLanguage,
      programName,
      speaker1Persona,
      speaker2Persona,
      scriptConstraints,
      useRag
    };
    try {
      window.localStorage.setItem(AI_ADVANCED_CONFIG_KEY, JSON.stringify(payload));
    } catch (e) {
      // ignore
    }
  }, [
    scriptTargetChars,
    longScriptMode,
    scriptStyle,
    scriptLanguage,
    programName,
    speaker1Persona,
    speaker2Persona,
    scriptConstraints,
    useRag
  ]);

  // 记住 Key：同步到 localStorage（关闭则清除）
  useEffect(() => {
    try {
      if (!rememberApiKey) {
        window.localStorage.removeItem(API_KEY_STORAGE_KEY);
        return;
      }
      if (apiKey && apiKey.trim()) {
        window.localStorage.setItem(API_KEY_STORAGE_KEY, apiKey.trim());
      }
    } catch (e) {
      // ignore
    }
  }, [apiKey, rememberApiKey]);

  // 初始化已保存自定义音色列表（优先服务端，其次本地）
  useEffect(() => {
    const loadSavedVoices = async (silent = false) => {
      try {
        const resp = await fetch(apiPath('/api/saved_voices'));
        if (resp.ok) {
          const data = await resp.json();
          if (data && data.success && Array.isArray(data.voices)) {
            const normalized = normalizeServerVoices(data.voices);
            setSavedCustomVoices(normalized);
            try {
              window.localStorage.setItem(SAVED_CUSTOM_VOICES_KEY, JSON.stringify(normalized));
            } catch (e) {
              // ignore
            }
            return;
          }
        }
      } catch (e) {
        if (!silent) {
          // ignore and fallback to local
        }
      }

      try {
        const raw = window.localStorage.getItem(SAVED_CUSTOM_VOICES_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const normalized = normalizeServerVoices(parsed);
          setSavedCustomVoices(normalized);
        }
      } catch (e) {
        // ignore
      }
    };
    loadSavedVoices();

    // 热加载：定时从服务端拉取，支持手工编辑 saved_voices.json 后自动刷新
    const timer = setInterval(async () => {
      try {
        const resp = await fetch(apiPath('/api/saved_voices'));
        if (!resp.ok) return;
        const data = await resp.json();
        if (!(data && data.success && Array.isArray(data.voices))) return;
        const normalized = normalizeServerVoices(data.voices);
        setSavedCustomVoices((prev) => {
          const prevStr = JSON.stringify(prev || []);
          const nextStr = JSON.stringify(normalized);
          if (prevStr === nextStr) return prev;
          try {
            window.localStorage.setItem(SAVED_CUSTOM_VOICES_KEY, nextStr);
          } catch (e) {
            // ignore
          }
          return normalized;
        });
      } catch (e) {
        // ignore polling errors
      }
    }, 5000);

    return () => clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const normalizeSavedVoices = (voices) => {
    const map = new Map();
    (voices || []).forEach((item) => {
      if (!item) return;
      const voiceId = String(item.voiceId || '').trim();
      if (!voiceId) return;
      const existing = map.get(voiceId) || {};
      map.set(voiceId, {
        voiceId,
        displayName: String(item.displayName || '').trim() || String(existing.displayName || '').trim() || voiceId,
        lastUsedAt: item.lastUsedAt || existing.lastUsedAt || null,
        sourceSpeaker: item.sourceSpeaker || existing.sourceSpeaker || null
      });
    });
    const merged = Array.from(map.values()).sort((a, b) => {
      const ta = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
      const tb = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
      return tb - ta;
    });
    return merged;
  };

  const buildAudioStyleConfigPayload = () => ({
    audioStyleMode,
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
    endingBgm2SavedId
  });

  const applyAudioStyleConfigPayload = (c = {}) => {
    setAudioStyleMode(c.audioStyleMode || 'default');
    setIntroText(c.introText || '');
    setEndingText(c.endingText || '');
    setIntroVoiceMode(c.introVoiceMode || 'default');
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
    setEndingBgm2Mode(c.endingBgm2Mode || 'default');
    setEndingBgm2SavedId(c.endingBgm2SavedId || '');
    // 上传型文件无法持久化，加载预设时需用户手动补传
    setIntroBgm1File(null);
    setIntroBgm2File(null);
    setEndingBgm1File(null);
    setEndingBgm2File(null);
  };

  const getAudioStylePresetMissingTips = (c = {}) => {
    const tips = [];
    const hasVoice = (voiceId) =>
      savedCustomVoices.some((item) => String(item.voiceId || '') === String(voiceId || ''));
    const hasBgm = (bgmId) =>
      savedBgms.some((item) => String(item.bgmId || '') === String(bgmId || ''));

    if (c.introVoiceMode === 'custom') {
      if (!c.introCustomVoiceId) tips.push('开头语音色：请选择已保存音色名称');
      else if (!hasVoice(c.introCustomVoiceId)) tips.push('开头语音色：当前缺少该已保存音色');
    }
    if (c.endingVoiceMode === 'custom') {
      if (!c.endingCustomVoiceId) tips.push('结束语音色：请选择已保存音色名称');
      else if (!hasVoice(c.endingCustomVoiceId)) tips.push('结束语音色：当前缺少该已保存音色');
    }
    if (c.introBgm1Mode === 'saved') {
      if (!c.introBgm1SavedId) tips.push('开场背景音1：请选择已保存 BGM');
      else if (!hasBgm(c.introBgm1SavedId)) tips.push('开场背景音1：当前缺少该已保存 BGM');
    }
    if (c.introBgm2Mode === 'saved') {
      if (!c.introBgm2SavedId) tips.push('开场背景音2：请选择已保存 BGM');
      else if (!hasBgm(c.introBgm2SavedId)) tips.push('开场背景音2：当前缺少该已保存 BGM');
    }
    if (c.endingBgm1Mode === 'saved') {
      if (!c.endingBgm1SavedId) tips.push('结尾背景音1：请选择已保存 BGM');
      else if (!hasBgm(c.endingBgm1SavedId)) tips.push('结尾背景音1：当前缺少该已保存 BGM');
    }
    if (c.endingBgm2Mode === 'saved') {
      if (!c.endingBgm2SavedId) tips.push('结尾背景音2：请选择已保存 BGM');
      else if (!hasBgm(c.endingBgm2SavedId)) tips.push('结尾背景音2：当前缺少该已保存 BGM');
    }
    if (c.introBgm1Mode === 'upload') tips.push('开场背景音1：请重新上传文件');
    if (c.introBgm2Mode === 'upload') tips.push('开场背景音2：请重新上传文件');
    if (c.endingBgm1Mode === 'upload') tips.push('结尾背景音1：请重新上传文件');
    if (c.endingBgm2Mode === 'upload') tips.push('结尾背景音2：请重新上传文件');
    return tips;
  };

  const openSaveAudioStylePresetModal = () => {
    const defaultName = `配置-${new Date().toLocaleString()}`;
    setAudioStylePresetNameInput(defaultName);
    setShowSaveAudioStylePresetModal(true);
  };

  const confirmSaveAudioStylePreset = () => {
    const name = String(audioStylePresetNameInput || '').trim();
    if (!name) {
      alert('请输入配置名称');
      return;
    }
    const config = buildAudioStyleConfigPayload();
    const now = new Date().toISOString();
    const newId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const current = Array.isArray(audioStylePresets) ? audioStylePresets : [];
    const existingIdx = current.findIndex((item) => item.name === name);
    if (existingIdx >= 0) {
      const next = [...current];
      next[existingIdx] = {
        ...next[existingIdx],
        createdAt: now,
        config
      };
      setAudioStylePresets(next);
      setSelectedAudioStylePresetId(next[existingIdx].id);
    } else {
      const next = [
        {
          id: newId,
          name,
          createdAt: now,
          config
        },
        ...current
      ];
      setAudioStylePresets(next);
      setSelectedAudioStylePresetId(newId);
    }
    setShowSaveAudioStylePresetModal(false);
    addLog(`✓ 已保存开头/结尾配置：${name}`);
  };

  const loadAudioStylePreset = () => {
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
    const cfg = preset.config || {};
    applyAudioStyleConfigPayload(cfg);
    const missing = getAudioStylePresetMissingTips(cfg);
    if (missing.length > 0) {
      alert(`配置「${preset.name}」已加载，但有未补全项：\n- ${missing.join('\n- ')}`);
    } else {
      addLog(`✓ 已加载开头/结尾配置：${preset.name}`);
    }
  };

  const upsertSavedVoice = (voiceId, sourceSpeaker = null) => {
    const normalizedVoiceId = String(voiceId || '').trim();
    if (!normalizedVoiceId) return;
    const now = new Date().toISOString();
    setSavedCustomVoices((prev) => {
      const current = Array.isArray(prev) ? prev : [];
      const existing = current.find(v => v.voiceId === normalizedVoiceId);
      const withoutCurrent = current.filter(v => v.voiceId !== normalizedVoiceId);
      const merged = normalizeSavedVoices([
        {
          voiceId: normalizedVoiceId,
          displayName: (existing && existing.displayName) || normalizedVoiceId,
          lastUsedAt: now,
          sourceSpeaker
        },
        ...withoutCurrent
      ]);
      try {
        window.localStorage.setItem(SAVED_CUSTOM_VOICES_KEY, JSON.stringify(merged));
      } catch (e) {
        // ignore
      }
      fetch(apiPath('/api/saved_voices'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voices: merged })
      }).catch(() => {});
      return merged;
    });
  };

  const clearSavedApiKey = () => {
    try {
      window.localStorage.removeItem(API_KEY_STORAGE_KEY);
    } catch (e) {
      // ignore
    }
    setApiKey('');
    setRememberApiKey(false);
  };

  // 处理文件上传
  const handlePdfChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const allowedExt = ['.pdf', '.doc', '.docx', '.epub', '.txt', '.md', '.markdown'];
    const validFiles = files.filter((file) => {
      const fileName = (file.name || '').toLowerCase();
      return allowedExt.some((ext) => fileName.endsWith(ext));
    });
    if (!validFiles.length) {
      alert('请上传支持格式：pdf/doc/docx/epub/txt/md');
      return;
    }
    setPdfFiles((prev) => {
      const current = Array.isArray(prev) ? prev : [];
      const next = [...current];
      validFiles.forEach((file) => {
        const key = `${file.name}__${file.size}__${file.lastModified}`;
        const exists = next.some((f) => `${f.name}__${f.size}__${f.lastModified}` === key);
        if (!exists) next.push(file);
      });
      return next;
    });
    e.target.value = '';
  };

  const addUrlInput = () => {
    const val = String(urlInputDraft || '').trim();
    if (!val) return;
    if (urlInputs.includes(val)) {
      alert('该网址已添加');
      return;
    }
    setUrlInputs((prev) => [...prev, val]);
    setUrlInputDraft('');
  };

  const removeUrlInput = (idx) => {
    setUrlInputs((prev) => prev.filter((_, i) => i !== idx));
  };

  const removeUploadedFile = (index) => {
    setPdfFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSpeaker1AudioChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSpeaker1Audio(file);
    }
  };

  const handleSpeaker2AudioChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSpeaker2Audio(file);
    }
  };

  const handleManualCoverChange = (e) => {
    const file = e.target.files[0];
    if (!file) {
      setManualCoverFile(null);
      return;
    }
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowed.includes(file.type)) {
      alert('请上传 PNG/JPG/WEBP 图片作为封面');
      return;
    }
    setManualCoverFile(file);
  };

  const handleBgmFileChange = (setter) => (e) => {
    const file = e.target.files[0];
    if (!file) {
      setter(null);
      return;
    }
    setter(file);
  };

  // 添加日志
  const addLog = (message) => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), message }]);
  };

  // 添加 Trace ID
  const addTraceId = (api, traceId) => {
    setTraceIds(prev => [...prev, { api, traceId }]);
  };

  // 双缓冲播放器 - 后端已控制更新频率，前端直接更新即可
  const updateProgressiveAudio = (newUrl) => {
    console.log(`[前端播放器] 收到后端更新事件，URL: ${newUrl.substring(newUrl.length - 30)}`);
    performUpdate(newUrl);
  };

  // 执行实际的播放器更新
  const performUpdate = (newUrl) => {
    console.log(`[播放器更新] 开始更新，URL: ${newUrl.substring(newUrl.length - 30)}`);
    const currentAudio = activePlayer === 0 ? audioRef0.current : audioRef1.current;
    const nextAudio = activePlayer === 0 ? audioRef1.current : audioRef0.current;

    // 如果当前播放器正在播放
    if (currentAudio && !currentAudio.paused) {
      const currentTime = currentAudio.currentTime;
      console.log(`[播放器更新] 当前播放中，位置: ${currentTime.toFixed(2)}s，将切换到播放器 ${activePlayer === 0 ? 1 : 0}`);

      // 预加载下一个播放器
      if (activePlayer === 0) {
        setPlayer1Url(newUrl);
      } else {
        setPlayer0Url(newUrl);
      }

      // 等待下一个播放器加载完成后切换
      setTimeout(() => {
        if (nextAudio) {
          nextAudio.currentTime = currentTime;
          nextAudio.play().then(() => {
            // 切换激活的播放器
            setActivePlayer(prev => prev === 0 ? 1 : 0);
            // 暂停之前的播放器
            if (currentAudio) {
              currentAudio.pause();
            }
          }).catch(err => {
            console.error('切换播放失败:', err);
          });
        }
      }, 500);
    } else {
      // 如果没有播放，直接更新当前播放器
      if (activePlayer === 0) {
        setPlayer0Url(newUrl);
      } else {
        setPlayer1Url(newUrl);
      }
    }
  };

  const handleGenerate = async () => {
    // 验证输入
    if (!apiKey.trim()) {
      alert('请输入 MiniMax API Key');
      return;
    }

    addLog('🚀 已开始生成流程，准备发起请求...');

    if (editMode === 'manual') {
      if (!manualScript.trim()) {
        alert('用户加工模式下，请先填写对话脚本');
        return;
      }
    } else {
      const hasSelectedNotes = Array.isArray(selectedNoteIds) && selectedNoteIds.length > 0;
      const topicOk = (textInput || '').trim();
      if (!topicOk && urlInputs.length === 0 && pdfFiles.length === 0 && !hasSelectedNotes) {
        alert('请至少提供一种输入内容（文本/网址/文件/知识库勾选笔记）');
        return;
      }
      const chars = parseScriptTargetCharsForGenerate(scriptTargetChars);
      if (chars === null) {
        alert(`目标正文字数请输入 ${SCRIPT_TARGET_CHARS_MIN}~${SCRIPT_TARGET_CHARS_MAX} 的整数`);
        return;
      }
    }

    if (speaker1Type === 'custom') {
      if (speaker1CustomMode === 'saved') {
        if (!speaker1SavedVoiceId.trim()) {
          alert('Speaker1 已选择自定义音色，请选择一个已保存的音色ID');
          return;
        }
      } else if (!speaker1Audio) {
        alert('Speaker1 已选择自定义音色，请上传音频文件');
        return;
      }
    }

    if (speaker2Type === 'custom') {
      if (speaker2CustomMode === 'saved') {
        if (!speaker2SavedVoiceId.trim()) {
          alert('Speaker2 已选择自定义音色，请选择一个已保存的音色ID');
          return;
        }
      } else if (!speaker2Audio) {
        alert('Speaker2 已选择自定义音色，请上传音频文件');
        return;
      }
    }

    if (audioStyleMode === 'custom') {
      if (introVoiceMode === 'custom' && !introCustomVoiceId.trim()) {
        alert('开头语音色选择了已保存音色，请选择音色名称');
        return;
      }
      if (endingVoiceMode === 'custom' && !endingCustomVoiceId.trim()) {
        alert('结束语音色选择了已保存音色，请选择音色名称');
        return;
      }
              if (introBgm1Mode === 'saved' && !introBgm1SavedId) {
        alert('背景音1 选择了已保存，请选择一个条目');
        return;
      }
      if (introBgm1Mode === 'upload' && !introBgm1File) {
        alert('背景音1 选择了上传，请先选择文件');
        return;
      }
      if (introBgm2Mode === 'saved' && !introBgm2SavedId) {
        alert('背景音2 选择了已保存，请选择一个条目');
        return;
      }
      if (introBgm2Mode === 'upload' && !introBgm2File) {
        alert('背景音2 选择了上传，请先选择文件');
        return;
      }
              if (endingBgm1Mode === 'saved' && !endingBgm1SavedId) {
        alert('结尾背景音1 选择了已保存，请选择一个条目');
        return;
      }
      if (endingBgm1Mode === 'upload' && !endingBgm1File) {
        alert('结尾背景音1 选择了上传，请先选择文件');
        return;
      }
      if (endingBgm2Mode === 'saved' && !endingBgm2SavedId) {
        alert('结尾背景音2 选择了已保存，请选择一个条目');
        return;
      }
      if (endingBgm2Mode === 'upload' && !endingBgm2File) {
        alert('结尾背景音2 选择了上传，请先选择文件');
        return;
      }
    }

    // 清空之前的状态
    setLogs([]);
    setScript([]);
    setTraceIds([]);
    setCoverImage('');
    setAudioUrl('');
    setScriptUrl('');
    setPlayer0Url('');
    setPlayer1Url('');
    setActivePlayer(0);
    setUrlWarning(null);
    generateAbortRef.current?.abort();
    const generateAbortController = new AbortController();
    generateAbortRef.current = generateAbortController;
    setIsGenerating(true);

    // 构建 FormData
    const formData = new FormData();
    formData.append('api_key', apiKey);
    const topicTrimmed = (textInput || '').trim();
    if (topicTrimmed) formData.append('text_input', topicTrimmed);
    if (urlInputs.length > 0) {
      formData.append('url', urlInputs[0]);
      formData.append('url_list', JSON.stringify(urlInputs));
    }
    pdfFiles.forEach((file) => formData.append('pdf_files', file));

    // 新增：用户加工模式参数（默认不影响现有流程）
    if (editMode === 'manual') {
      formData.append('script_mode', 'manual');
      formData.append('manual_script', manualScript);
      formData.append('cover_mode', 'manual');
      formData.append('manual_cover_text', manualCoverText);
      if (manualCoverFile) formData.append('manual_cover_file', manualCoverFile);
    } else {
      formData.append('script_mode', 'ai');
      formData.append('cover_mode', 'ai');
      formData.append('selected_note_ids', JSON.stringify(selectedNoteIds));
      formData.append(
        'script_target_chars',
        String(parseScriptTargetCharsForGenerate(scriptTargetChars) ?? SCRIPT_TARGET_CHARS_DEFAULT)
      );
      formData.append('use_rag', useRag ? '1' : '0');
      formData.append('script_style', scriptStyle);
      formData.append('script_language', scriptLanguage);
      formData.append('program_name', programName);
      formData.append('speaker1_persona', speaker1Persona);
      formData.append('speaker2_persona', speaker2Persona);
      formData.append('script_constraints', scriptConstraints);
    }

    formData.append('speaker1_type', speaker1Type);
    if (speaker1Type === 'default') {
      formData.append('speaker1_voice_name', speaker1Voice);
    } else if (speaker1CustomMode === 'saved') {
      formData.append('speaker1_custom_voice_id', speaker1SavedVoiceId.trim());
    } else if (speaker1Audio) {
      formData.append('speaker1_audio', speaker1Audio);
    }

    formData.append('speaker2_type', speaker2Type);
    if (speaker2Type === 'default') {
      formData.append('speaker2_voice_name', speaker2Voice);
    } else if (speaker2CustomMode === 'saved') {
      formData.append('speaker2_custom_voice_id', speaker2SavedVoiceId.trim());
    } else if (speaker2Audio) {
      formData.append('speaker2_audio', speaker2Audio);
    }

    if (audioStyleMode === 'custom') {
      formData.append('intro_text', introText);
      formData.append('ending_text', endingText);
      formData.append('intro_voice_mode', introVoiceMode);
      formData.append('intro_voice_name', introVoiceName);
      formData.append('intro_custom_voice_id', introCustomVoiceId.trim());
      formData.append('ending_voice_mode', endingVoiceMode);
      formData.append('ending_voice_name', endingVoiceName);
      formData.append('ending_custom_voice_id', endingCustomVoiceId.trim());
      formData.append('intro_bgm1_mode', introBgm1Mode);
      formData.append('intro_bgm1_saved_id', introBgm1SavedId);
      if (introBgm1Mode === 'upload' && introBgm1File) formData.append('intro_bgm1_file', introBgm1File);
      formData.append('intro_bgm2_mode', introBgm2Mode);
      formData.append('intro_bgm2_saved_id', introBgm2SavedId);
      if (introBgm2Mode === 'upload' && introBgm2File) formData.append('intro_bgm2_file', introBgm2File);
      formData.append('ending_bgm1_mode', endingBgm1Mode);
      formData.append('ending_bgm1_saved_id', endingBgm1SavedId);
      if (endingBgm1Mode === 'upload' && endingBgm1File) formData.append('ending_bgm1_file', endingBgm1File);
      formData.append('ending_bgm2_mode', endingBgm2Mode);
      formData.append('ending_bgm2_saved_id', endingBgm2SavedId);
      if (endingBgm2Mode === 'upload' && endingBgm2File) formData.append('ending_bgm2_file', endingBgm2File);
    }

    // 建立 SSE 连接
    try {
      addLog(`🌐 正在请求: ${API_URL || '(同源)'} /api/generate_podcast`);
      const response = await fetch(`${API_URL}/api/generate_podcast`, {
        method: 'POST',
        body: formData,
        signal: generateAbortController.signal
      });

      addLog(`✅ 已收到响应: HTTP ${response.status} ${response.statusText}`);

      if (!response.ok || !response.body) {
        const errText = await response.text().catch(() => '');
        addLog(`❌ 请求失败: HTTP ${response.status} ${response.statusText}${errText ? ` - ${errText.slice(0, 200)}` : ''}`);
        setIsGenerating(false);
        generateAbortRef.current = null;
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = ''; // 用于累积不完整的行

      addLog('📡 已建立流式连接，开始接收事件...');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // 将新数据追加到缓冲区
        buffer += decoder.decode(value, { stream: true });

        // 按行分割，但保留最后一个可能不完整的行
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 保存最后一个不完整的行

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith('data: ')) {
            const jsonStr = trimmedLine.substring(6);
            // 跳过空的 data 行
            if (!jsonStr.trim()) continue;

            try {
              const data = JSON.parse(jsonStr);
              handleSSEEvent(data);
            } catch (e) {
              console.error('解析 SSE 数据失败:', e);
              console.error('问题行长度:', jsonStr.length);
              console.error('问题行开头:', jsonStr.substring(0, 100));
              console.error('问题行结尾:', jsonStr.substring(Math.max(0, jsonStr.length - 100)));
              // 不中断流程，继续处理其他事件
            }
          }
        }
      }

      // 处理缓冲区中剩余的数据
      if (buffer.trim() && buffer.startsWith('data: ')) {
        try {
          const data = JSON.parse(buffer.substring(6));
          handleSSEEvent(data);
        } catch (e) {
          console.error('解析最后一行 SSE 数据失败:', e);
        }
      }
    } catch (error) {
      if (error && error.name === 'AbortError') {
        addLog('⏹ 已停止生成播客（连接已中断）');
        setProgress('');
      } else {
        console.error('生成播客失败:', error);
        addLog(`错误: ${error.message}`);
      }
      setIsGenerating(false);
    } finally {
      if (generateAbortRef.current === generateAbortController) {
        generateAbortRef.current = null;
      }
    }
  };

  const stopGenerate = () => {
    generateAbortRef.current?.abort();
  };

  const removeSelectedNote = (noteId) => {
    const nextIds = selectedNoteIds.filter((id) => id !== noteId);
    setSelectedNoteIds(nextIds);
    try {
      window.localStorage.setItem(SELECTED_NOTES_KEY, JSON.stringify(nextIds));
    } catch (e) {
      // ignore
    }
  };

  const addNoteAsReferenceFile = () => {
    const id = String(noteToAddId || '').trim();
    if (!id) {
      alert('请先选择一个笔记');
      return;
    }
    if (selectedNoteIds.includes(id)) {
      alert('该笔记已在文件列表中');
      return;
    }
    const nextIds = [...selectedNoteIds, id];
    setSelectedNoteIds(nextIds);
    try {
      window.localStorage.setItem(SELECTED_NOTES_KEY, JSON.stringify(nextIds));
    } catch (e) {
      // ignore
    }
    setNoteToAddId('');
  };

  const importDraftToManualMode = () => {
    const t = (finalCopyText || '').trim();
    if (!t) {
      alert('文案为空，请先生成大模型文案或自行粘贴内容');
      return;
    }
    setManualScript(t);
    setEditMode('manual');
    setShowFinalCopyModal(false);
    addLog('✓ 已导入「用户加工模式」：可继续编辑脚本后生成播客（不再调用 AI 写脚本）。');
  };

  const skipToVoiceSection = () => {
    voiceSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    addLog('✓ 🤖 AI自动生成：已滚动到「选择音色」');
  };

  const runScriptDraftLLM = async () => {
    if (!apiKey.trim()) {
      alert('请先填写 MiniMax API Key');
      return;
    }
    const hasNotes = Array.isArray(selectedNoteIds) && selectedNoteIds.length > 0;
    if (!textInput && urlInputs.length === 0 && pdfFiles.length === 0 && !hasNotes) {
      alert('请至少提供一种参考内容（文本/网址/文件/知识库勾选笔记）');
      return;
    }
    const targetChars = parseScriptTargetCharsInput(scriptTargetChars);
    if (targetChars === null) {
      alert(`目标正文字数请输入 ${SCRIPT_TARGET_CHARS_MIN}~${SCRIPT_TARGET_CHARS_MAX} 的整数`);
      return;
    }

    draftAbortRef.current?.abort();
    const draftAbortController = new AbortController();
    draftAbortRef.current = draftAbortController;

    setFinalCopyLlmGenerating(true);
    setFinalCopyDraftStatus('正在连接服务器…');
    setFinalCopyTitle('💡 加入创意 · 生成中…');
    setFinalCopyText('');
    setFinalCopyReadyToPickVoice(false);

    const formData = new FormData();
    formData.append('api_key', apiKey.trim());
    if (textInput) formData.append('text_input', textInput);
    if (urlInputs.length > 0) {
      formData.append('url', urlInputs[0]);
      formData.append('url_list', JSON.stringify(urlInputs));
    }
    pdfFiles.forEach((file) => formData.append('pdf_files', file));
    formData.append('selected_note_ids', JSON.stringify(selectedNoteIds));
    formData.append('script_target_chars', String(targetChars));
    formData.append('long_script_mode', longScriptMode ? '1' : '0');
    formData.append('use_rag', useRag ? '1' : '0');
    formData.append('script_style', scriptStyle);
    formData.append('script_language', scriptLanguage);
    formData.append('program_name', programName);
    formData.append('speaker1_persona', speaker1Persona);
    formData.append('speaker2_persona', speaker2Persona);
    formData.append('script_constraints', scriptConstraints);

    try {
      addLog(`🌐 请求仅生成文案: ${API_URL || '(同源)'} /api/generate_script_draft`);
      const response = await fetch(`${API_URL}/api/generate_script_draft`, {
        method: 'POST',
        body: formData,
        signal: draftAbortController.signal
      });
      if (!response.ok || !response.body) {
        const errText = await response.text().catch(() => '');
        throw new Error(
          formatScriptDraftHttpError(
            response.status,
            errText,
            API_URL,
            typeof window !== 'undefined' ? window.location.host : ''
          )
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() || '';
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine.startsWith('data:')) continue;
          const jsonStr = trimmedLine.substring(6).trim();
          if (!jsonStr) continue;
          try {
            const data = JSON.parse(jsonStr);
            switch (data.type) {
              case 'draft_script_chunk':
                if (data.content) {
                  setFinalCopyText((prev) => prev + data.content);
                }
                break;
              case 'progress':
                setFinalCopyDraftStatus(data.message || '');
                break;
              case 'log':
                addLog(data.message);
                break;
              case 'url_parse_warning':
                addLog(`⚠️ ${data.message}`);
                setUrlWarning({
                  message: data.message,
                  error_code: data.error_code
                });
                break;
              case 'draft_script_complete':
                setFinalCopyDraftStatus('生成完成，可直接编辑或导入用户加工模式');
                addLog('✓ 大模型播客文案已生成');
                setFinalCopyReadyToPickVoice(true);
                break;
              case 'draft_script_replace':
                if (data.content) {
                  setFinalCopyText(data.content);
                  addLog('✓ 已应用后端一致性收口校对');
                }
                break;
              case 'error':
                addLog(`❌ ${data.message}`);
                alert(data.message);
                setFinalCopyDraftStatus('');
                setFinalCopyLlmGenerating(false);
                setFinalCopyTitle('💡 加入创意');
                setFinalCopyReadyToPickVoice(false);
                return;
              default:
                break;
            }
          } catch (e) {
            console.error('文案 SSE 解析失败', e);
          }
        }
      }
      if (sseBuffer.trim().startsWith('data:')) {
        try {
          const data = JSON.parse(sseBuffer.trim().substring(6).trim());
          if (data.type === 'draft_script_chunk' && data.content) {
            setFinalCopyText((prev) => prev + data.content);
          }
        } catch (e) {
          // ignore
        }
      }
    } catch (e) {
      if (e && e.name === 'AbortError') {
        addLog('⏹ 已停止文案生成（连接已中断）');
        setFinalCopyDraftStatus('');
        setFinalCopyReadyToPickVoice(false);
      } else {
        addLog(`❌ 文案生成失败: ${e.message}`);
        alert(`文案生成失败：${e.message}`);
        setFinalCopyDraftStatus('');
        setFinalCopyReadyToPickVoice(false);
      }
    } finally {
      if (draftAbortRef.current === draftAbortController) {
        draftAbortRef.current = null;
      }
      setFinalCopyLlmGenerating(false);
      setFinalCopyTitle('💡 加入创意');
    }
  };

  const refineScriptConstraints = () => {
    const raw = String(scriptConstraints || '').trim();
    if (!raw) {
      alert('当前没有可提炼的约束内容');
      return;
    }

    const splitByPunct = raw
      .replace(/\r/g, '\n')
      .split(/\n+|[。；;！？!?]/g)
      .map((s) => s.trim())
      .filter(Boolean);

    // 去重并按关键词优先级排序，尽量保留“硬约束”。
    const seen = new Set();
    const deduped = splitByPunct.filter((s) => {
      const k = s.replace(/\s+/g, '');
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const score = (line) => {
      let v = 0;
      if (/严禁|禁止|不能|必须|仅|只输出|一行一句/.test(line)) v += 6;
      if (/括号|动作|场景|过渡|换题|术语|案例|收束|真人|口语/.test(line)) v += 4;
      if (/重复|生硬|独白|书面语|排比|赞同/.test(line)) v += 3;
      v += Math.min(3, Math.floor(line.length / 18));
      return v;
    };

    const top = [...deduped]
      .sort((a, b) => score(b) - score(a))
      .slice(0, 14);

    const refined = [
      '对话内容中不能包含动作、心理活动或场景描述，只生成纯对话文本。',
      '每行必须以 Speaker1: 或 Speaker2: 开头，一行一句。',
      ...top.map((x) => x.replace(/^[-•\d.)(、\s]+/, '').trim()).filter(Boolean)
    ].slice(0, 16).join('\n');

    setScriptConstraints(refined);
    addLog(`✨ 已智能提炼脚本约束：${raw.length} → ${refined.length} 字`);
  };

  const stopScriptDraftLLM = () => {
    draftAbortRef.current?.abort();
  };

  const clearDraftAndConstraints = () => {
    if (finalCopyLlmGenerating) return;
    setFinalCopyText('');
    setScriptConstraints(DEFAULT_SCRIPT_CONSTRAINTS);
    setFinalCopyDraftStatus('');
    setFinalCopyReadyToPickVoice(false);
    try {
      window.localStorage.removeItem(FINAL_COPY_DRAFT_KEY);
    } catch (e) {
      // ignore
    }
  };

  // 处理 SSE 事件
  const handleSSEEvent = (data) => {
    switch (data.type) {
      case 'progress':
        setProgress(data.message);
        addLog(data.message);
        break;

      case 'log':
        addLog(data.message);
        break;

      case 'script_chunk':
        setScript(prev => [...prev, data.full_line]);
        break;

      case 'trace_id':
        addTraceId(data.api, data.trace_id);
        break;

      case 'voice_ready':
        if (data && data.voice_id && (data.source === 'custom_cloned' || data.source === 'custom_saved')) {
          upsertSavedVoice(data.voice_id, data.speaker || null);
        }
        break;

      case 'cover_image':
        setCoverImage(data.image_url);
        addLog('封面生成完成');
        break;

      case 'audio_chunk':
        // 这里可以实现流式音频播放
        // 暂时跳过，等待complete事件获取完整音频
        break;

      case 'bgm':
      case 'welcome_audio_chunk':
        // BGM 和欢迎语音频事件，前端不需要处理
        break;

      case 'progressive_audio':
        // 收到渐进式音频更新 - 使用双缓冲策略
        const progressiveUrl = `${API_URL}${data.audio_url}`;

        // 调用双缓冲更新函数（会自动累积并平滑切换）
        updateProgressiveAudio(progressiveUrl);

        // 使用后端发送的 message，或生成默认消息
        let logMessage;
        if (data.message) {
          logMessage = `✅ ${data.message}`;
        } else if (data.sentence_number) {
          logMessage = `✅ 第 ${data.sentence_number} 句已添加，播客时长: ${Math.round(data.duration_ms / 1000)}秒`;
        } else {
          logMessage = `✅ 开场音频已生成，播客时长: ${Math.round(data.duration_ms / 1000)}秒`;
        }
        addLog(logMessage);
        break;

      case 'complete':
        // 不覆盖 progressiveAudioUrl，因为渐进式文件已经是最终版本
        // 只设置 audioUrl 和 scriptUrl 用于下载按钮
        setAudioUrl(data.audio_url);
        setScriptUrl(data.script_url);
        setIsGenerating(false);
        setProgress('播客生成完成！');
        addLog('🎉 播客生成完成！可以下载了');
        break;

      case 'url_parse_warning':
        // URL 解析失败的警告，但不中断流程
        addLog(`⚠️ ${data.message}`);
        setUrlWarning({
          message: data.message,
          error_code: data.error_code
        });
        if (data.error_code === '403') {
          setProgress('网址解析遇到问题，但您可以继续使用其他输入方式');
        }
        break;

      case 'error':
        addLog(`❌ 错误: ${data.message}`);
        setIsGenerating(false);
        setProgress('');
        break;

      default:
        console.log('未知事件类型:', data);
    }
  };

  const resolveMediaUrl = (maybeUrl) => {
    if (!maybeUrl) return '';
    if (maybeUrl.startsWith('http://') || maybeUrl.startsWith('https://')) return maybeUrl;
    return `${API_URL}${maybeUrl}`;
  };

  /**
   * 跨域时 <a download> 会被浏览器忽略（安全策略），导致点击后只播放/打开而不保存。
   * 通过 fetch 拉取 Blob 再触发本地下载，本地开发（3000/8000 → 5001）与生产同源均可使用。
   */
  const pickFilenameFromContentDisposition = (header) => {
    if (!header) return null;
    const m = /filename\*?=(?:UTF-8'')?([^;\n]+)/i.exec(header);
    if (!m) return null;
    let raw = m[1].trim().replace(/^["']|["']$/g, '');
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  };

  const pickFilenameFromUrl = (fullUrl) => {
    try {
      const u = fullUrl.startsWith('http') ? new URL(fullUrl) : new URL(fullUrl, window.location.origin);
      const seg = u.pathname.split('/').filter(Boolean).pop();
      return seg ? seg.split('?')[0] : null;
    } catch {
      return null;
    }
  };

  const downloadFileByFetch = async (fullUrl, suggestedFilename) => {
    if (!fullUrl || downloadBusy) return;
    setDownloadBusy(true);
    try {
      addLog(`⬇️ 正在准备下载…`);
      const res = await fetch(fullUrl, { mode: 'cors' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const fromHeader = pickFilenameFromContentDisposition(res.headers.get('Content-Disposition'));
      const filename =
        fromHeader || suggestedFilename || pickFilenameFromUrl(fullUrl) || 'download';
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
      addLog(`✓ 已保存：${filename}`);
    } catch (e) {
      addLog(`❌ 下载失败: ${e.message}。已在新标签页打开链接，可右键「另存为」。`);
      window.open(fullUrl, '_blank', 'noopener,noreferrer');
    } finally {
      setDownloadBusy(false);
    }
  };

  const openFinalCopyModal = async () => {
    setShowFinalCopyModal(true);
    setFinalCopyDraftStatus('');
    setFinalCopyReadyToPickVoice(false);
    setFinalCopyLoading(true);
    try {
      if (scriptUrl) {
        setFinalCopyTitle('📝 已生成的播客脚本（可编辑）');
        const resp = await fetch(resolveMediaUrl(scriptUrl));
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const text = await resp.text();
        setFinalCopyText(text || '（脚本为空）');
      } else if (script.length > 0) {
        setFinalCopyTitle('📝 已生成的播客脚本（可编辑）');
        setFinalCopyText(script.join('\n'));
      } else {
        let cachedDraft = '';
        try {
          cachedDraft = window.localStorage.getItem(FINAL_COPY_DRAFT_KEY) || '';
        } catch (e) {
          cachedDraft = '';
        }
        setFinalCopyTitle('💡 加入创意');
        setFinalCopyText(cachedDraft);
      }
    } catch (e) {
      const fallback = script.length > 0 ? script.join('\n') : '';
      if (fallback) {
        setFinalCopyTitle('📝 已生成的播客脚本（可编辑）');
        setFinalCopyText(fallback);
      } else if (scriptUrl) {
        setFinalCopyTitle('📝 已生成的播客脚本（可编辑）');
        setFinalCopyText(`从服务器加载脚本失败：${e.message}`);
      } else {
        let cachedDraft = '';
        try {
          cachedDraft = window.localStorage.getItem(FINAL_COPY_DRAFT_KEY) || '';
        } catch (err) {
          cachedDraft = '';
        }
        setFinalCopyTitle('💡 加入创意');
        setFinalCopyText(cachedDraft);
      }
    } finally {
      setFinalCopyLoading(false);
    }
  };

  return (
    <div className="podcast-generator">
      {showApiConfig && (
        <div className="section">
          <h2>🔑 API Key 配置</h2>
          <div className="input-content">
            <div className="input-group">
              <label className="input-label">MiniMax API Key</label>
              <input
                type="password"
                placeholder="请输入你的 MiniMax API Key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="api-key-input"
              />
              <div className="api-key-actions">
                <label className="api-key-remember">
                  <input
                    type="checkbox"
                    checked={rememberApiKey}
                    onChange={(e) => setRememberApiKey(e.target.checked)}
                  />
                  记住 API Key（本机浏览器）
                </label>
                <button
                  type="button"
                  className="api-key-clear-btn"
                  onClick={clearSavedApiKey}
                  disabled={!apiKey && !rememberApiKey}
                >
                  清除
                </button>
              </div>
              <p className="input-description">
                在 <a href="https://www.minimaxi.com/" target="_blank" rel="noopener noreferrer">MiniMax 官网</a> 获取你的 API Key
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 加工模式切换 */}
      <div className="section">
        <h2>🧩 加工模式</h2>
        <div className="mode-tabs">
          <button
            type="button"
            className={`mode-tab ${editMode === 'ai' ? 'active' : ''}`}
            onClick={() => setEditMode('ai')}
          >
            🤖 AI加工模式
          </button>
          <button
            type="button"
            className={`mode-tab ${editMode === 'manual' ? 'active' : ''}`}
            onClick={() => setEditMode('manual')}
          >
            ✍️ 用户加工模式
          </button>
        </div>

        {editMode === 'ai' ? (
          <div className="input-content">
            <p className="input-hint">AI 将根据你输入的内容自动生成脚本和封面。</p>
            <div className="input-group">
              <label className="input-label">💬 话题文本</label>
              <textarea
                placeholder="输入你想讨论的话题..."
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                rows={5}
              />
            </div>

            <div className="input-group upload-unified-card">
              <label className="input-label">📄 参考资料</label>
              <div className="notes-inline-picker">
                <input
                  type="text"
                  placeholder="输入网址 URL..."
                  value={urlInputDraft}
                  onChange={(e) => setUrlInputDraft(e.target.value)}
                />
                <button
                  type="button"
                  className="api-key-clear-btn"
                  onClick={addUrlInput}
                  disabled={!String(urlInputDraft || '').trim()}
                >
                  添加网址
                </button>
              </div>
              <div className="file-upload">
                <label htmlFor="pdf-upload" className="upload-label">
                  本地文件
                </label>
                <input
                  id="pdf-upload"
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.epub,.txt,.md,.markdown"
                  onChange={handlePdfChange}
                  style={{ display: 'none' }}
                />
              </div>
              <div className="notes-inline-picker">
                <select
                  value={noteToAddId}
                  onChange={(e) => setNoteToAddId(e.target.value)}
                >
                  <option value="">笔记文件</option>
                  {availableNotes
                    .filter((n) => !selectedNoteIds.includes(String(n.noteId || '')))
                    .map((n) => (
                      <option key={n.noteId} value={n.noteId}>
                        {n.title || n.fileName}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  className="api-key-clear-btn"
                  onClick={addNoteAsReferenceFile}
                  disabled={!noteToAddId}
                >
                  加入文件
                </button>
              </div>
              <div className="script-box" style={{ maxHeight: 180 }}>
                {urlInputs.length === 0 && pdfFiles.length === 0 && selectedNoteItems.length === 0 ? (
                  <p className="input-description" style={{ margin: 0 }}>当前未添加文件或网址</p>
                ) : (
                  <>
                    {urlInputs.map((url, idx) => (
                      <div key={`${url}_${idx}`} className="settings-voice-item" style={{ borderBottom: 'none', padding: '4px 0' }}>
                        <p style={{ margin: 0 }}>🔗 {url}</p>
                        <button
                          type="button"
                          className="api-key-clear-btn"
                          onClick={() => removeUrlInput(idx)}
                        >
                          删除
                        </button>
                      </div>
                    ))}
                    {pdfFiles.map((file, idx) => (
                      <div key={`${file.name}_${file.size}_${idx}`} className="settings-voice-item" style={{ borderBottom: 'none', padding: '4px 0' }}>
                        <p style={{ margin: 0 }}>📎 {file.name}</p>
                        <button
                          type="button"
                          className="api-key-clear-btn"
                          onClick={() => removeUploadedFile(idx)}
                        >
                          删除
                        </button>
                      </div>
                    ))}
                    {selectedNoteItems.map((n) => (
                      <div key={n.noteId} className="settings-voice-item" style={{ borderBottom: 'none', padding: '4px 0' }}>
                        <p style={{ margin: 0 }}>
                          📚 {n.title || n.fileName}
                          {n.notebook ? `（${n.notebook}）` : ''}
                        </p>
                        <button
                          type="button"
                          className="api-key-clear-btn"
                          onClick={() => removeSelectedNote(n.noteId)}
                        >
                          删除
                        </button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>

            <div className="input-group">
              <div className="final-copy-action-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                <button
                  type="button"
                  className="api-key-clear-btn final-copy-btn"
                  onClick={skipToVoiceSection}
                  disabled={isGenerating}
                  title="跳过文案编辑步骤，直接滚动到音色区，按当前素材走 AI 自动生成流程"
                >
                  🤖 AI自动生成
                </button>
                <button
                  type="button"
                  className="api-key-clear-btn final-copy-btn"
                  onClick={openFinalCopyModal}
                  disabled={isGenerating}
                >
                  💡 加入创意
                </button>
              </div>
              <p className="input-description">
                「🤖 AI自动生成」直接定位到下方「选择音色」，按当前参考素材走默认 AI 流程。「💡 加入创意」打开弹窗，可调整高级配置、生成或编辑脚本，并一键导入「用户加工模式」。
              </p>
            </div>
          </div>
        ) : (
          <div className="input-content">
            <p className="input-hint">
              对话脚本和封面文案/封面图完全由你提供，系统不再调用 AI 生成它们（但仍会继续做语音合成与音频合并）。
            </p>
            <div className="input-group">
              <label className="input-label">📄 手工对话脚本</label>
              <textarea
                placeholder={`每句一行，格式示例：\nSpeaker1: 大家好，今天我们聊...\nSpeaker2: 没错，我补充一点...`}
                value={manualScript}
                onChange={(e) => setManualScript(e.target.value)}
                rows={10}
              />
              <p className="input-description">
                仅支持两位说话人：Speaker1 / Speaker2。未标注说话人的行会默认归为 Speaker1。
              </p>
            </div>

            <div className="input-group">
              <label className="input-label">🖼️ 手工封面文案（可选）</label>
              <input
                type="text"
                placeholder="例如：本期主题：xxx（可留空）"
                value={manualCoverText}
                onChange={(e) => setManualCoverText(e.target.value)}
              />
            </div>

            <div className="input-group">
              <label className="input-label">🖼️ 上传封面图片（可选）</label>
              <div className="file-upload">
                <label htmlFor="manual-cover-upload" className="upload-label">
                  {manualCoverFile ? `已选择: ${manualCoverFile.name}` : '点击选择封面图片（可不上传）'}
                </label>
                <input
                  id="manual-cover-upload"
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp"
                  onChange={handleManualCoverChange}
                  style={{ display: 'none' }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 音色选择区 */}
      <div className="section" ref={voiceSectionRef}>
        <h2>🎤 选择音色</h2>
        <p className="input-description" style={{ marginTop: '-0.5rem' }}>
          下拉中仅显示 Mini / Max 及已在「设置 → 音色管理」中点击「使用」加入的预设；更多预设请在该页选择 Speaker1 或 Speaker2。
        </p>
        <div className="voice-config">
          <div className="speaker-config">
            <h3>Speaker 1</h3>
            <div className="radio-group">
              <label>
                <input
                  type="radio"
                  checked={speaker1Type === 'default'}
                  onChange={() => setSpeaker1Type('default')}
                />
                默认音色
              </label>
              {speaker1Type === 'default' && (
                <GroupedDefaultVoiceSelect
                  groups={defaultVoiceGroups}
                  value={speaker1Voice}
                  onChange={setSpeaker1Voice}
                  id="speaker1-default-voice"
                />
              )}
            </div>
            <div className="radio-group">
              <label>
                <input
                  type="radio"
                  checked={speaker1Type === 'custom'}
                  onChange={() => setSpeaker1Type('custom')}
                />
                自定义音色
              </label>
              {speaker1Type === 'custom' && (
                <div>
                  <select value={speaker1CustomMode} onChange={(e) => setSpeaker1CustomMode(e.target.value)}>
                    <option value="upload">上传新音频并克隆</option>
                    <option value="saved">选择已保存音色ID</option>
                  </select>
                  {speaker1CustomMode === 'upload' ? (
                    <div className="file-upload">
                      <label htmlFor="speaker1-audio" className="upload-label">
                        {speaker1Audio ? speaker1Audio.name : '上传音频文件'}
                      </label>
                      <input
                        id="speaker1-audio"
                        type="file"
                        accept=".wav,.mp3,.flac,.m4a,.ogg"
                        onChange={handleSpeaker1AudioChange}
                        style={{ display: 'none' }}
                      />
                    </div>
                  ) : (
                    <select
                      value={speaker1SavedVoiceId}
                      onChange={(e) => {
                        const value = e.target.value;
                        setSpeaker1SavedVoiceId(value);
                        if (value) upsertSavedVoice(value, 'speaker1');
                      }}
                    >
                      <option value="">请选择已保存音色ID</option>
                      {savedCustomVoices.map((voice) => (
                        <option key={voice.voiceId} value={voice.voiceId}>
                          {voice.displayName || voice.voiceId}
                          {voice.displayName && voice.displayName !== voice.voiceId ? ` (${voice.voiceId})` : ''}
                          {voice.sourceSpeaker ? ` | 来源:${voice.sourceSpeaker}` : ''}
                          {voice.lastUsedAt ? ` | 最近:${new Date(voice.lastUsedAt).toLocaleString()}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="speaker-config">
            <h3>Speaker 2</h3>
            <div className="radio-group">
              <label>
                <input
                  type="radio"
                  checked={speaker2Type === 'default'}
                  onChange={() => setSpeaker2Type('default')}
                />
                默认音色
              </label>
              {speaker2Type === 'default' && (
                <GroupedDefaultVoiceSelect
                  groups={defaultVoiceGroups}
                  value={speaker2Voice}
                  onChange={setSpeaker2Voice}
                  id="speaker2-default-voice"
                />
              )}
            </div>
            <div className="radio-group">
              <label>
                <input
                  type="radio"
                  checked={speaker2Type === 'custom'}
                  onChange={() => setSpeaker2Type('custom')}
                />
                自定义音色
              </label>
              {speaker2Type === 'custom' && (
                <div>
                  <select value={speaker2CustomMode} onChange={(e) => setSpeaker2CustomMode(e.target.value)}>
                    <option value="upload">上传新音频并克隆</option>
                    <option value="saved">选择已保存音色ID</option>
                  </select>
                  {speaker2CustomMode === 'upload' ? (
                    <div className="file-upload">
                      <label htmlFor="speaker2-audio" className="upload-label">
                        {speaker2Audio ? speaker2Audio.name : '上传音频文件'}
                      </label>
                      <input
                        id="speaker2-audio"
                        type="file"
                        accept=".wav,.mp3,.flac,.m4a,.ogg"
                        onChange={handleSpeaker2AudioChange}
                        style={{ display: 'none' }}
                      />
                    </div>
                  ) : (
                    <select
                      value={speaker2SavedVoiceId}
                      onChange={(e) => {
                        const value = e.target.value;
                        setSpeaker2SavedVoiceId(value);
                        if (value) upsertSavedVoice(value, 'speaker2');
                      }}
                    >
                      <option value="">请选择已保存音色ID</option>
                      {savedCustomVoices.map((voice) => (
                        <option key={voice.voiceId} value={voice.voiceId}>
                          {voice.displayName || voice.voiceId}
                          {voice.displayName && voice.displayName !== voice.voiceId ? ` (${voice.voiceId})` : ''}
                          {voice.sourceSpeaker ? ` | 来源:${voice.sourceSpeaker}` : ''}
                          {voice.lastUsedAt ? ` | 最近:${new Date(voice.lastUsedAt).toLocaleString()}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 开场/结尾配置 */}
      <div className="section">
        <h2>🎼 开场/结尾配置</h2>
        <div className="input-group">
          <div className="mode-tabs">
            <button
              type="button"
              className={`mode-tab ${audioStyleMode === 'default' ? 'active' : ''}`}
              onClick={() => setAudioStyleMode('default')}
            >
              使用默认配置
            </button>
            <button
              type="button"
              className={`mode-tab ${audioStyleMode === 'custom' ? 'active' : ''}`}
              onClick={() => setAudioStyleMode('custom')}
            >
              使用自定义配置
            </button>
          </div>
          <p className="input-description" style={{ marginTop: 10 }}>
            播客默认使用背景音1+开头语+背景音2+主体内容+结束背景音1的格式，可以在下方自行配置想要的模式。
          </p>
          {audioStyleMode === 'custom' && (
            <div className="audio-style-preset-bar">
              <select
                value={selectedAudioStylePresetId}
                onChange={(e) => setSelectedAudioStylePresetId(e.target.value)}
              >
                <option value="">选择已保存配置</option>
                {audioStylePresets.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="api-key-clear-btn"
                onClick={loadAudioStylePreset}
                disabled={!audioStylePresets.length}
              >
                加载配置
              </button>
              <button
                type="button"
                className="api-key-clear-btn"
                onClick={openSaveAudioStylePresetModal}
              >
                保存当前配置
              </button>
            </div>
          )}
        </div>

        {audioStyleMode === 'custom' && (
          <div className="audio-style-square-grid">
            <div className="audio-style-square-card">
              <h3>🎬 开场配置</h3>
              <div className="input-group">
                <label className="input-label">开头语文本（可选）</label>
                <input
                  type="text"
                  value={introText}
                  onChange={(e) => setIntroText(e.target.value)}
                  placeholder="例如：欢迎收听本期节目（留空不使用开头语）"
                />
              </div>
              <div className="input-group">
                <label className="input-label">开头语音色（可选）</label>
                <select value={introVoiceMode} onChange={(e) => setIntroVoiceMode(e.target.value)}>
                  <option value="default">不配置（使用默认音色）</option>
                  <option value="speaker1">跟随 Speaker1</option>
                  <option value="speaker2">跟随 Speaker2</option>
                  <option value="custom">已保存音色名称</option>
                </select>
                {introVoiceMode === 'default' && (
                  <GroupedDefaultVoiceSelect
                    groups={defaultVoiceGroups}
                    value={introVoiceName}
                    onChange={setIntroVoiceName}
                    id="intro-default-voice"
                  />
                )}
                {introVoiceMode === 'custom' && (
                  <select
                    value={introCustomVoiceId}
                    onChange={(e) => setIntroCustomVoiceId(e.target.value)}
                  >
                    <option value="">请选择音色名称</option>
                    {savedCustomVoices.map((voice) => (
                      <option key={voice.voiceId} value={voice.voiceId}>
                        {voice.displayName || voice.voiceId}
                        {voice.displayName && voice.displayName !== voice.voiceId ? ` (${voice.voiceId})` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="input-group">
                <label className="input-label">开场背景音1（可选）</label>
                <select value={introBgm1Mode} onChange={(e) => setIntroBgm1Mode(e.target.value)}>
                  <option value="none">不使用背景音1</option>
                  <option value="default">默认 BGM1</option>
                  <option value="saved">已保存 BGM</option>
                  <option value="upload">上传新 BGM</option>
                </select>
                {introBgm1Mode === 'saved' && (
                  <select value={introBgm1SavedId} onChange={(e) => setIntroBgm1SavedId(e.target.value)}>
                    <option value="">请选择</option>
                    {savedBgms.map((bgm) => (
                      <option key={bgm.bgmId} value={bgm.bgmId}>{bgm.label || bgm.fileName}</option>
                    ))}
                  </select>
                )}
                {introBgm1Mode === 'upload' && (
                  <div className="file-upload">
                    <label htmlFor="intro-bgm1-upload" className="upload-label">
                      {introBgm1File ? introBgm1File.name : '上传开场背景音1'}
                    </label>
                    <input
                      id="intro-bgm1-upload"
                      type="file"
                      accept=".wav,.mp3,.flac,.m4a,.ogg"
                      onChange={handleBgmFileChange(setIntroBgm1File)}
                      style={{ display: 'none' }}
                    />
                  </div>
                )}
              </div>
              <div className="input-group">
                <label className="input-label">开场背景音2（可选）</label>
                <select value={introBgm2Mode} onChange={(e) => setIntroBgm2Mode(e.target.value)}>
                  <option value="none">不使用背景音2</option>
                  <option value="default">默认 BGM2</option>
                  <option value="saved">已保存 BGM</option>
                  <option value="upload">上传新 BGM</option>
                </select>
                {introBgm2Mode === 'saved' && (
                  <select value={introBgm2SavedId} onChange={(e) => setIntroBgm2SavedId(e.target.value)}>
                    <option value="">请选择</option>
                    {savedBgms.map((bgm) => (
                      <option key={bgm.bgmId} value={bgm.bgmId}>{bgm.label || bgm.fileName}</option>
                    ))}
                  </select>
                )}
                {introBgm2Mode === 'upload' && (
                  <div className="file-upload">
                    <label htmlFor="intro-bgm2-upload" className="upload-label">
                      {introBgm2File ? introBgm2File.name : '上传开场背景音2'}
                    </label>
                    <input
                      id="intro-bgm2-upload"
                      type="file"
                      accept=".wav,.mp3,.flac,.m4a,.ogg"
                      onChange={handleBgmFileChange(setIntroBgm2File)}
                      style={{ display: 'none' }}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="audio-style-square-card">
              <h3>🏁 结尾配置</h3>
              <div className="input-group">
                <label className="input-label">结束语文本（可选）</label>
                <input
                  type="text"
                  value={endingText}
                  onChange={(e) => setEndingText(e.target.value)}
                  placeholder="例如：感谢收听，我们下期再见（留空则不额外添加）"
                />
              </div>
              <div className="input-group">
                <label className="input-label">结束语音色（可选）</label>
                <select value={endingVoiceMode} onChange={(e) => setEndingVoiceMode(e.target.value)}>
                  <option value="default">不配置（使用默认音色）</option>
                  <option value="speaker1">跟随 Speaker1</option>
                  <option value="speaker2">跟随 Speaker2</option>
                  <option value="custom">已保存音色名称</option>
                </select>
                {endingVoiceMode === 'default' && (
                  <GroupedDefaultVoiceSelect
                    groups={defaultVoiceGroups}
                    value={endingVoiceName}
                    onChange={setEndingVoiceName}
                    id="ending-default-voice"
                  />
                )}
                {endingVoiceMode === 'custom' && (
                  <select
                    value={endingCustomVoiceId}
                    onChange={(e) => setEndingCustomVoiceId(e.target.value)}
                  >
                    <option value="">请选择音色名称</option>
                    {savedCustomVoices.map((voice) => (
                      <option key={voice.voiceId} value={voice.voiceId}>
                        {voice.displayName || voice.voiceId}
                        {voice.displayName && voice.displayName !== voice.voiceId ? ` (${voice.voiceId})` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="input-group">
                <label className="input-label">结尾背景音1（可选）</label>
                <select value={endingBgm1Mode} onChange={(e) => setEndingBgm1Mode(e.target.value)}>
                  <option value="none">不使用背景音1</option>
                  <option value="default">默认 BGM1</option>
                  <option value="saved">已保存 BGM</option>
                  <option value="upload">上传新 BGM</option>
                </select>
                {endingBgm1Mode === 'saved' && (
                  <select value={endingBgm1SavedId} onChange={(e) => setEndingBgm1SavedId(e.target.value)}>
                    <option value="">请选择</option>
                    {savedBgms.map((bgm) => (
                      <option key={bgm.bgmId} value={bgm.bgmId}>{bgm.label || bgm.fileName}</option>
                    ))}
                  </select>
                )}
                {endingBgm1Mode === 'upload' && (
                  <div className="file-upload">
                    <label htmlFor="ending-bgm1-upload" className="upload-label">
                      {endingBgm1File ? endingBgm1File.name : '上传结尾背景音1'}
                    </label>
                    <input
                      id="ending-bgm1-upload"
                      type="file"
                      accept=".wav,.mp3,.flac,.m4a,.ogg"
                      onChange={handleBgmFileChange(setEndingBgm1File)}
                      style={{ display: 'none' }}
                    />
                  </div>
                )}
              </div>
              <div className="input-group">
                <label className="input-label">结尾背景音2（可选）</label>
                <select value={endingBgm2Mode} onChange={(e) => setEndingBgm2Mode(e.target.value)}>
                  <option value="none">不使用背景音2</option>
                  <option value="default">默认 BGM2</option>
                  <option value="saved">已保存 BGM</option>
                  <option value="upload">上传新 BGM</option>
                </select>
                {endingBgm2Mode === 'saved' && (
                  <select value={endingBgm2SavedId} onChange={(e) => setEndingBgm2SavedId(e.target.value)}>
                    <option value="">请选择</option>
                    {savedBgms.map((bgm) => (
                      <option key={bgm.bgmId} value={bgm.bgmId}>{bgm.label || bgm.fileName}</option>
                    ))}
                  </select>
                )}
                {endingBgm2Mode === 'upload' && (
                  <div className="file-upload">
                    <label htmlFor="ending-bgm2-upload" className="upload-label">
                      {endingBgm2File ? endingBgm2File.name : '上传结尾背景音2'}
                    </label>
                    <input
                      id="ending-bgm2-upload"
                      type="file"
                      accept=".wav,.mp3,.flac,.m4a,.ogg"
                      onChange={handleBgmFileChange(setEndingBgm2File)}
                      style={{ display: 'none' }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 生成按钮 */}
      <div className="generate-actions-row">
        <button
          type="button"
          className="generate-btn"
          onClick={handleGenerate}
          disabled={isGenerating}
        >
          {isGenerating ? '🎙️ 生成中...' : '🚀 开始生成播客'}
        </button>
        {isGenerating && (
          <button
            type="button"
            className="generate-stop-btn"
            onClick={stopGenerate}
          >
            停止生成
          </button>
        )}
      </div>

      {/* URL 解析警告 */}
      {urlWarning && (
        <div className="warning-box">
          <div className="warning-icon">⚠️</div>
          <div className="warning-content">
            <div className="warning-title">网址解析遇到问题</div>
            <div className="warning-message">{urlWarning.message}</div>
            {urlWarning.error_code === '403' && (
              <div className="warning-suggestion">
                💡 <strong>建议操作：</strong>
                <br />
                1. 打开该网址，复制页面中的文本内容
                <br />
                2. 粘贴到上方的"话题文本"输入框中
                <br />
                3. 点击"开始生成播客"继续
              </div>
            )}
          </div>
          <div className="close-warning" onClick={() => setUrlWarning(null)}>×</div>
        </div>
      )}

      {/* 进度显示 */}
      {progress && (
        <div className="progress-bar">
          <div className="progress-text">{progress}</div>
        </div>
      )}

      {/* 播客播放器和封面 - 并排显示 */}
      {((player0Url || player1Url || audioUrl) || coverImage) && (
        <div className="player-cover-container">
          {/* 播客封面 - 左侧 */}
          {coverImage && (
            <div className="cover-section">
              <h2>🖼️ 播客封面</h2>
              <img src={resolveMediaUrl(coverImage)} alt="播客封面" className="cover-image" />
            </div>
          )}

          {/* 播客播放器 - 右侧 - 双缓冲 */}
          {(player0Url || player1Url || audioUrl) && (
            <div className="player-section">
              <h2>🎧 播客播放器</h2>
              {/* 播放器 0 */}
              <audio
                ref={audioRef0}
                controls={activePlayer === 0}
                className="audio-player"
                src={player0Url || (audioUrl && activePlayer === 0 ? `${API_URL}${audioUrl}` : '')}
                preload="metadata"
                style={{ display: activePlayer === 0 ? 'block' : 'none' }}
              />
              {/* 播放器 1 */}
              <audio
                ref={audioRef1}
                controls={activePlayer === 1}
                className="audio-player"
                src={player1Url || (audioUrl && activePlayer === 1 ? `${API_URL}${audioUrl}` : '')}
                preload="metadata"
                style={{ display: activePlayer === 1 ? 'block' : 'none' }}
              />
            </div>
          )}
        </div>
      )}

      {/* 对话脚本 */}
      {script.length > 0 && (
        <div className="section">
          <h2>📄 对话脚本</h2>
          <div className="script-box">
            {script.map((line, index) => (
              <p key={index}>{line}</p>
            ))}
          </div>
        </div>
      )}

      {/* 下载按钮 */}
      {audioUrl && (
        <div className="download-section">
          <button
            type="button"
            className="download-btn"
            disabled={downloadBusy}
            onClick={() => downloadFileByFetch(resolveMediaUrl(audioUrl), 'podcast.mp3')}
          >
            ⬇️ 下载音频
          </button>
          {scriptUrl && (
            <button
              type="button"
              className="download-btn"
              disabled={downloadBusy}
              onClick={() => downloadFileByFetch(resolveMediaUrl(scriptUrl), 'podcast_script.txt')}
            >
              ⬇️ 下载脚本
            </button>
          )}
          {coverImage && (
            <button
              type="button"
              className="download-btn"
              disabled={downloadBusy}
              onClick={() => {
                const fullUrl =
                  coverImage.startsWith('http://') || coverImage.startsWith('https://')
                    ? `${API_URL}/download/cover?url=${encodeURIComponent(coverImage)}`
                    : resolveMediaUrl(coverImage);
                downloadFileByFetch(fullUrl, `podcast_cover_${Date.now()}.jpg`);
              }}
            >
              ⬇️ 下载封面
            </button>
          )}
        </div>
      )}

      {/* 详细日志 */}
      <div className="section logs-section">
        <h2 onClick={() => setShowLogs(!showLogs)} style={{ cursor: 'pointer' }}>
          🔍 详细日志 {showLogs ? '▼' : '▶'}
        </h2>
        {showLogs && (
          <div className="logs-box">
            {logs.map((log, index) => (
              <p key={index}>
                <span className="log-time">[{log.time}]</span> {log.message}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Trace IDs */}
      {traceIds.length > 0 && (
        <div className="trace-ids">
          <h3>Trace IDs</h3>
          {traceIds.map((trace, index) => (
            <p key={index}>
              <strong>{trace.api}:</strong> <code>{trace.traceId}</code>
            </p>
          ))}
        </div>
      )}

      {showFinalCopyModal && (
        <div
          className="voice-rename-modal-mask"
          onClick={() => {
            if (!finalCopyLlmGenerating) setShowFinalCopyModal(false);
          }}
        >
          <div
            className="voice-rename-modal final-copy-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="final-copy-modal-header">
              <h3>{finalCopyTitle}</h3>
              <p className="voice-rename-modal-subtitle final-copy-modal-lead">
                可先编辑脚本；需要改风格、字数或人设时，展开「AI 加工高级配置」。配置满意后调用大模型生成，并可导入「用户加工模式」继续调整。
              </p>
            </div>

            <div className="final-copy-modal-body">
              <details className="final-copy-summary-details ai-advanced-config-details">
                <summary className="final-copy-summary-summary">⚙️ AI 加工高级配置</summary>
                <div className="final-copy-summary-inner final-copy-advanced-config">
                  <div className="input-group">
                    <label className="input-label">目标正文字数</label>
                    <input
                      type="number"
                      min={SCRIPT_TARGET_CHARS_MIN}
                      max={SCRIPT_TARGET_CHARS_MAX}
                      step={1}
                      value={scriptTargetChars}
                      onChange={(e) => setScriptTargetChars(e.target.value)}
                      disabled={finalCopyLlmGenerating}
                    />
                    <label className="api-key-remember" style={{ marginTop: 4 }}>
                      <input
                        type="checkbox"
                        checked={longScriptMode}
                        onChange={(e) => setLongScriptMode(e.target.checked)}
                        disabled={finalCopyLlmGenerating}
                      />
                      自动分段生成长文案模式
                    </label>
                    <p className="input-description">
                      指对话正文总字数（不含每行 Speaker1:/Speaker2: 前缀）。
                      当前范围 {SCRIPT_TARGET_CHARS_MIN}~{SCRIPT_TARGET_CHARS_MAX} 字。
                      {longScriptMode ? '已启用分段生成，系统将自动分段并拼接以保持风格一致。' : '默认单次生成，适合短文案快速产出。'}
                    </p>
                  </div>

                  <div className="input-group">
                    <label className="input-label">脚本风格</label>
                    <select
                      value={scriptStyle}
                      onChange={(e) => setScriptStyle(e.target.value)}
                      disabled={finalCopyLlmGenerating}
                    >
                      <option value="轻松幽默，自然流畅">轻松幽默</option>
                      <option value="专业严谨，结构清晰">专业严谨</option>
                      <option value="科普讲解，通俗易懂">科普讲解</option>
                      <option value="访谈对谈，观点碰撞">访谈对谈</option>
                      <option value="新闻播报，客观简洁">新闻播报</option>
                    </select>
                  </div>

                  <div className="input-group">
                    <label className="input-label">脚本输出语言</label>
                    <select
                      value={scriptLanguage}
                      onChange={(e) => setScriptLanguage(e.target.value)}
                      disabled={finalCopyLlmGenerating}
                    >
                      <option value="中文">中文</option>
                      <option value="英文">英文</option>
                      <option value="中英混合">中英混合</option>
                    </select>
                  </div>

                  <div className="input-group">
                    <label className="api-key-remember" style={{ marginTop: 0 }}>
                      <input
                        type="checkbox"
                        checked={useRag}
                        onChange={(e) => setUseRag(e.target.checked)}
                        disabled={finalCopyLlmGenerating}
                      />
                      长参考资料检索模式（推荐开启）
                    </label>
                    <p className="input-description">
                      当参考资料较长时，先分块检索再生成，可降低报错并提升相关性。
                    </p>
                  </div>

                  <div className="input-group">
                    <label className="input-label">节目名</label>
                    <input
                      type="text"
                      value={programName}
                      onChange={(e) => setProgramName(e.target.value)}
                      placeholder="例如：AI科技快报"
                      disabled={finalCopyLlmGenerating}
                    />
                  </div>

                  <div className="input-group">
                    <label className="input-label">Speaker1 人设</label>
                    <input
                      type="text"
                      value={speaker1Persona}
                      onChange={(e) => setSpeaker1Persona(e.target.value)}
                      placeholder="例如：活泼亲切，引导话题"
                      disabled={finalCopyLlmGenerating}
                    />
                  </div>

                  <div className="input-group">
                    <label className="input-label">Speaker2 人设</label>
                    <input
                      type="text"
                      value={speaker2Persona}
                      onChange={(e) => setSpeaker2Persona(e.target.value)}
                      placeholder="例如：稳重专业，深度分析"
                      disabled={finalCopyLlmGenerating}
                    />
                  </div>

                  <div className="input-group advanced-constraints-group">
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px'
                      }}
                    >
                      <label className="input-label" style={{ marginBottom: 0 }}>脚本细节约束</label>
                      <button
                        type="button"
                        className="api-key-clear-btn"
                        onClick={refineScriptConstraints}
                        disabled={finalCopyLlmGenerating}
                        title="自动提炼为高优先级短规则"
                      >
                        智能提炼
                      </button>
                    </div>
                    <textarea
                      value={scriptConstraints}
                      onChange={(e) => setScriptConstraints(e.target.value)}
                      rows={4}
                      placeholder="例如：不要出现括号动作描述；每句控制在 30 字以内。"
                      disabled={finalCopyLlmGenerating}
                    />
                    <p className="input-description">
                      当前约束长度：{(scriptConstraints || '').length} 字。建议控制在 1500 字以内；过长时后端会自动压缩后再请求模型，以降低报错概率。
                    </p>
                  </div>
                </div>
              </details>

              {(finalCopyDraftStatus || finalCopyLlmGenerating) && (
                <div
                  className={`final-copy-status-bar ${finalCopyLlmGenerating ? 'is-busy' : ''}`}
                  role="status"
                >
                  {finalCopyLlmGenerating ? `⏳ ${finalCopyDraftStatus || '处理中…'}` : finalCopyDraftStatus}
                </div>
              )}

              <div className="final-copy-editor-section">
                <div className="final-copy-editor-head">
                  <div>
                    <label className="input-label" htmlFor="final-copy-textarea-main">
                      播客对话脚本
                    </label>
                    <span className="input-description final-copy-editor-hint">
                      每行一句，格式：Speaker1: … / Speaker2: …
                    </span>
                  </div>
                  <button
                    type="button"
                    className="api-key-clear-btn"
                    onClick={clearDraftAndConstraints}
                    disabled={finalCopyLlmGenerating}
                    title="清空当前文案与脚本细节约束，并删除本地自动保存内容"
                  >
                    一键清除文案
                  </button>
                </div>
                <p className="input-description" style={{ marginTop: 6, marginBottom: 8 }}>
                  脚本细节约束与文案已自动保存到本地；点击上方「一键清除文案」可一起清空。
                </p>
                {finalCopyLoading ? (
                  <p className="input-description">正在加载已生成脚本…</p>
                ) : (
                  <textarea
                    id="final-copy-textarea-main"
                    className="final-copy-textarea"
                    rows={14}
                    value={finalCopyText}
                    onChange={(e) => setFinalCopyText(e.target.value)}
                    placeholder="点击底部「调用大模型生成文案」自动生成；也可粘贴编辑后，右侧「导入人工」转入用户加工模式。"
                    disabled={finalCopyLlmGenerating}
                  />
                )}
              </div>
            </div>
            <div className="final-copy-modal-footer final-copy-modal-footer-bar">
              <div className="final-copy-footer-side final-copy-footer-left">
                <button
                  type="button"
                  className="api-key-clear-btn"
                  onClick={() => {
                    if (!finalCopyLlmGenerating) setShowFinalCopyModal(false);
                  }}
                  disabled={finalCopyLlmGenerating}
                >
                  关闭
                </button>
              </div>
              <div className="final-copy-footer-center">
                <div className="final-copy-llm-actions-row">
                  <button
                    type="button"
                    className="final-copy-llm-main-btn"
                    onClick={() => {
                      if (finalCopyReadyToPickVoice && !finalCopyLlmGenerating) {
                        setShowFinalCopyModal(false);
                        skipToVoiceSection();
                        return;
                      }
                      runScriptDraftLLM();
                    }}
                    disabled={finalCopyLlmGenerating || finalCopyLoading || isGenerating}
                  >
                    {finalCopyLlmGenerating
                      ? '生成中…'
                      : finalCopyReadyToPickVoice
                        ? '去选择音色'
                        : '调用大模型生成文案'}
                  </button>
                  {finalCopyLlmGenerating && (
                    <button
                      type="button"
                      className="final-copy-llm-stop-btn"
                      onClick={stopScriptDraftLLM}
                    >
                      停止生成
                    </button>
                  )}
                </div>
              </div>
              <div className="final-copy-footer-side final-copy-footer-right">
                <button
                  type="button"
                  className="final-copy-import-mini-btn"
                  onClick={importDraftToManualMode}
                  disabled={finalCopyLlmGenerating || finalCopyLoading}
                  title="将当前正文导入「用户加工模式」，可继续编辑后再生成播客"
                >
                  导入人工
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSaveAudioStylePresetModal && (
        <div
          className="voice-rename-modal-mask"
          onClick={() => setShowSaveAudioStylePresetModal(false)}
        >
          <div
            className="voice-rename-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>保存开头/结尾配置</h3>
            <p className="voice-rename-modal-subtitle">输入配置名称，后续可一键加载。</p>
            <input
              type="text"
              value={audioStylePresetNameInput}
              onChange={(e) => setAudioStylePresetNameInput(e.target.value)}
              placeholder="例如：采访通用模板"
              autoFocus
            />
            <div className="voice-rename-modal-actions">
              <button
                type="button"
                className="api-key-clear-btn"
                onClick={() => setShowSaveAudioStylePresetModal(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="api-key-clear-btn final-copy-btn"
                onClick={confirmSaveAudioStylePreset}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PodcastGenerator;
