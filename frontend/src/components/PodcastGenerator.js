import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { getApiBaseUrl, apiPath, resolveMediaUrl } from '../apiBaseUrl';
import { downloadWorkBundleZip } from '../workBundleDownload';
import {
  buildGroupedSelectOptions,
  filterGroupedVoiceGroups,
  uniqueLangShortsFromVoiceGroups,
} from '../voiceCatalogUtils';
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
import WorkCoverImg from './WorkCoverImg';
import { getWorkCoverSrc } from '../workCoverImageUrl';
import './podcastWorkCards.css';
import './PodcastGenerator.css';

// 已移除“仅生成文案”能力，相关错误格式化不再需要

/** 脚本目标正文字数（与服务端 PODCAST_CONFIG、模型可稳定输出上限一致） */
const SCRIPT_TARGET_CHARS_MIN = 200;
const SCRIPT_TARGET_CHARS_DEFAULT = 2000;
const SCRIPT_TARGET_CHARS_MAX = 9999;
const DURATION_PRESET_TO_CHARS = {
  short: 800,
  medium: 2000,
  long: 4500,
};
const DURATION_PRESET_TO_HINT = {
  short: '约 3-4 分钟',
  medium: '约 7-9 分钟',
  long: '约 15-18 分钟',
};
const DEFAULT_SCRIPT_CONSTRAINTS = '对话内容中不能包含（笑）（停顿）（思考）等动作、心理活动或场景描述，只生成纯对话文本。';

/** 笔记房间「生成播客」体裁：前缀写入 text_input，script_style / program_name 覆盖默认（custom 用界面状态） */
const PODCAST_ROOM_PRESETS = {
  custom: {
    label: '自定义模式',
    textPrefix: '',
    scriptStyle: null,
    programName: null,
  },
  deep_dive: {
    label: '学霸模式',
    textPrefix:
      '【体裁：知识分享 Deep Dive】请将笔记材料转化为知识讲解类播客：结构清晰、循序渐进，帮助听众建立系统理解。',
    scriptStyle: '深入浅出、条理清晰、适合系统学习的知识分享类播客',
    programName: '学霸模式 · Deep Dive',
  },
  critique: {
    label: '锐评频道',
    textPrefix:
      '【体裁：观点点评】请基于笔记材料做有态度、有观点的播客点评，观点可鲜明，但保持可听性与基本尊重。',
    scriptStyle: '观点鲜明、有态度、点评类播客',
    programName: '锐评频道 · Critique',
  },
  debate: {
    label: '左右互搏',
    textPrefix:
      '【体裁：双人对辩】请以两位角色就材料中的争议点或对立观点展开讨论与辩论，有交锋、有来回，保持可听性。',
    scriptStyle: '观点交锋、对话张力、辩论型双人播客',
    programName: '左右互搏 · Debate',
  },
};

const PODCAST_WORKS_STORAGE_KEY = 'fym_podcast_works_v1';

function loadPodcastWorks() {
  try {
    const raw = window.localStorage.getItem(PODCAST_WORKS_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function savePodcastWorks(list) {
  try {
    window.localStorage.setItem(PODCAST_WORKS_STORAGE_KEY, JSON.stringify((list || []).slice(0, 30)));
  } catch (e) {
    // ignore
  }
}

/** 参考 ListenHub 等产品的提示词示例 */
const LISTENHUB_EXAMPLE_PROMPTS = [
  '将你最感兴趣的一本书或一篇文章，做成一期深度闲聊播客。',
  '把最近一周的科技新闻，整理成一期「划重点」对话节目。',
  '用轻松语气讲解一个职业或技能入门，面向完全外行听众。',
];

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

function GroupedDefaultVoiceSelect({ groups, value, onChange, id, className }) {
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

const SCRIPT_LANG_LABELS = {
  中文: '中文（普通话）',
  English: 'English',
  日本語: '日本語',
};

function PodcastTbIcon({ children, className }) {
  return (
    <span className={`podcast-tb-ico ${className || ''}`} aria-hidden>
      {children}
    </span>
  );
}

function IcoUser() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function IcoUsers() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IcoGlobe() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function IcoWave() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M4 14c2-4 6-4 8 0s6 4 8 0M4 10c2 4 6 4 8 0s6-4 8 0" />
    </svg>
  );
}

function IcoBulb() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 13v2h8v-2a7 7 0 0 0-4-13z" />
    </svg>
  );
}

function IcoClock() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

function IcoLayers() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
    </svg>
  );
}

function IcoBrackets() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M8 5H5v14h3M16 5h3v14h-3" />
    </svg>
  );
}

function IcoSend() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.25" strokeLinecap="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/** 笔记房间弹窗底部：生成（仅图标） */
function IcoRoomGenSend() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function IcoRoomGenStop() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}

function IcoRoomGenLoading() {
  return (
    <svg className="notes-modal-gen-btn-spinner" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="42 48" />
    </svg>
  );
}

const PodcastGenerator = ({
  showApiConfig = true,
  onNavigateToTts,
  notesPodcastMode = false,
  roomConfigModal = false,
  roomNotebookName = '',
  roomSelectedNoteIds = null,
  onRoomGenerationComplete,
  roomPodcastKind = null,
  roomPodcastPrompt = '',
  roomPromptSlot = null,
}) => {
  const { ensureFeatureUnlocked, getAuthHeaders } = useAuth();
  // 状态管理
  const [apiKey, setApiKey] = useState('');
  const [rememberApiKey, setRememberApiKey] = useState(true);
  const [textInput, setTextInput] = useState('');
  const [urlInputs, setUrlInputs] = useState([]);
  const [urlInputDraft, setUrlInputDraft] = useState('');
  const [pdfFiles, setPdfFiles] = useState([]);

  const [scriptTargetChars, setScriptTargetChars] = useState(String(SCRIPT_TARGET_CHARS_DEFAULT));
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
  const [speaker1CustomMode, setSpeaker1CustomMode] = useState('saved');
  const [speaker1SavedVoiceId, setSpeaker1SavedVoiceId] = useState(
    () => readSpeakerClonedVoiceIds().speaker1 || ''
  );

  const [speaker2Type, setSpeaker2Type] = useState(() =>
    readSpeakerClonedVoiceIds().speaker2 ? 'custom' : 'default'
  );
  const [speaker2Voice, setSpeaker2Voice] = useState(() => readSpeakerDefaultVoiceKeys().speaker2);
  const [speaker2CustomMode, setSpeaker2CustomMode] = useState('saved');
  const [speaker2SavedVoiceId, setSpeaker2SavedVoiceId] = useState(
    () => readSpeakerClonedVoiceIds().speaker2 || ''
  );
  const [savedCustomVoices, setSavedCustomVoices] = useState([]);
  const [savedBgms, setSavedBgms] = useState([]);

  const [audioStyleMode, setAudioStyleMode] = useState('custom');
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
  const [introBgm1File, setIntroBgm1File] = useState(null);
  const [introBgm2Mode, setIntroBgm2Mode] = useState('default');
  const [introBgm2SavedId, setIntroBgm2SavedId] = useState('');
  const [introBgm2File, setIntroBgm2File] = useState(null);
  const [endingBgm1Mode, setEndingBgm1Mode] = useState('default');
  const [endingBgm1SavedId, setEndingBgm1SavedId] = useState('');
  const [endingBgm1File, setEndingBgm1File] = useState(null);
  const [endingBgm2Mode, setEndingBgm2Mode] = useState('none');
  const [endingBgm2SavedId, setEndingBgm2SavedId] = useState('');
  const [endingBgm2File, setEndingBgm2File] = useState(null);
  const [audioStylePresets, setAudioStylePresets] = useState([]);
  const [selectedAudioStylePresetId, setSelectedAudioStylePresetId] = useState('');
  const [showSaveAudioStylePresetModal, setShowSaveAudioStylePresetModal] = useState(false);
  const [audioStylePresetNameInput, setAudioStylePresetNameInput] = useState('');

  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState('');
  const [progressEta, setProgressEta] = useState('');
  const progressStartAtRef = useRef(0);
  const [podcastWorksTemplatesTab, setPodcastWorksTemplatesTab] = useState('works');
  const [, setScript] = useState([]);
  const scriptRef = useRef([]);
  const [coverImage, setCoverImage] = useState('');

  const [audioUrl, setAudioUrl] = useState('');
  const [showFinalCopyModal, setShowFinalCopyModal] = useState(false);

  // 渐进式播放相关状态 - 双缓冲方案
  const [activePlayer, setActivePlayer] = useState(0);  // 当前激活的播放器 (0 或 1)
  const [player0Url, setPlayer0Url] = useState('');
  const [player1Url, setPlayer1Url] = useState('');

  // URL 解析警告
  const [urlWarning, setUrlWarning] = useState(null);  // {message: string, error_code: string}
  const [pdfDropActive, setPdfDropActive] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState([]);
  const [selectedNoteItems, setSelectedNoteItems] = useState([]);
  const [availableNotes, setAvailableNotes] = useState([]);
  const [availableNotebooks, setAvailableNotebooks] = useState([]);
  const [noteNotebookFilter, setNoteNotebookFilter] = useState('默认笔记本');
  const [podcastSpeakerMode, setPodcastSpeakerMode] = useState('dual');
  const [podcastUploadOpen, setPodcastUploadOpen] = useState(false);
  const podcastUploadRef = useRef(null);
  const [podcastTbModeOpen, setPodcastTbModeOpen] = useState(false);
  const [podcastTbVoiceOpen, setPodcastTbVoiceOpen] = useState(false);
  // 播客时长：短/中/长（映射为目标正文字数）
  const [durationPreset, setDurationPreset] = useState('medium');
  // 时长选择模式：预设短/中/长 或 自定义字数（长文模式）
  const [durationMode, setDurationMode] = useState('preset'); // 'preset' | 'text'
  const [podcastTbDurationOpen, setPodcastTbDurationOpen] = useState(false);
  const [podcastVoiceGenderFilter, setPodcastVoiceGenderFilter] = useState('all');
  const [podcastVoiceLangFilter, setPodcastVoiceLangFilter] = useState('all');
  const podcastTbModeRef = useRef(null);
  const podcastTbVoiceRef = useRef(null);
  const podcastTbDurationRef = useRef(null);
  const [showPodcastIntroModal, setShowPodcastIntroModal] = useState(false);
  const [defaultVoicesMap, setDefaultVoicesMap] = useState(FALLBACK_DEFAULT_VOICES_MAP);
  const [enabledPresetKeys, setEnabledPresetKeys] = useState(() => readEnabledPresetKeys());

  const [podcastWorks, setPodcastWorks] = useState(() => loadPodcastWorks());
  const [podcastWorkMenuOpenId, setPodcastWorkMenuOpenId] = useState(null);
  const [podcastWorkZipBusyId, setPodcastWorkZipBusyId] = useState(null);
  const [podcastWorkRates, setPodcastWorkRates] = useState({});
  const podcastWorkAudioRefs = useRef({});
  /** 笔记出播客：1 仅选笔记 · 2 配置与补充话题 · 3 生成 */
  const [notesPodcastStep, setNotesPodcastStep] = useState(1);
  const podcastWorkMenuRefs = useRef({});
  const [podcastWorkPlayingId, setPodcastWorkPlayingId] = useState(null);
  const podcastWorkInlineAudioRef = useRef(null);
  const [podcastWorkDurations, setPodcastWorkDurations] = useState({});
  const [podcastWorkMenuDir, setPodcastWorkMenuDir] = useState({});
  const roomGenMetaRef = useRef({ programName: '', topic: '' });

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

  const pauseOtherPodcastWorks = useCallback((keepId) => {
    const keep = String(keepId ?? '');
    const refs = podcastWorkAudioRefs.current || {};
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

  const onToggleWorkPlay = useCallback(
    (workId) => {
      const sid = String(workId);
      if (!sid) return;
      setPodcastWorkMenuOpenId(null);
      setPodcastWorkPlayingId((cur) => {
        const curId = cur ? String(cur) : null;
        return curId === sid ? null : sid;
      });
    },
    []
  );

  useEffect(() => {
    if (!podcastWorkPlayingId) return;
    const el = podcastWorkInlineAudioRef.current;
    if (!el) return;
    try {
      el.play();
    } catch (e) {
      // ignore (autoplay may be blocked)
    }
  }, [podcastWorkPlayingId]);

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

  const podcastComposerLangChips = useMemo(
    () => uniqueLangShortsFromVoiceGroups(defaultVoiceGroups),
    [defaultVoiceGroups]
  );

  const podcastComposerFilteredGroups = useMemo(
    () => filterGroupedVoiceGroups(defaultVoiceGroups, podcastVoiceGenderFilter, podcastVoiceLangFilter),
    [defaultVoiceGroups, podcastVoiceGenderFilter, podcastVoiceLangFilter]
  );

  useEffect(() => {
    if (!podcastTbVoiceOpen) {
      setPodcastVoiceGenderFilter('all');
      setPodcastVoiceLangFilter('all');
    }
  }, [podcastTbVoiceOpen]);

  const defaultVoicesMapRef = useRef(defaultVoicesMap);
  defaultVoicesMapRef.current = defaultVoicesMap;

  const audioRef0 = useRef(null);
  const audioRef1 = useRef(null);
  const podcastPdfInputRef = useRef(null);
  const generateAbortRef = useRef(null);
  // 已移除“仅生成文案（SSE）”能力，因此不再需要 draftAbortRef

  const API_KEY_STORAGE_KEY = 'minimax_aipodcast_api_key';
  const SAVED_CUSTOM_VOICES_KEY = 'minimax_aipodcast_saved_custom_voices';
  const AUDIO_STYLE_CONFIG_KEY = 'minimax_aipodcast_audio_style_config';
  const AUDIO_STYLE_PRESETS_KEY = 'minimax_aipodcast_audio_style_presets';
  const AI_ADVANCED_CONFIG_KEY = 'minimax_aipodcast_ai_advanced_config';
  const SELECTED_NOTES_KEY = 'minimax_aipodcast_selected_notes';
  // 加入创意弹窗不再生成/缓存“播客对话脚本”，仅保存高级配置

  // 默认 Key（可选）：用于部署时注入，不建议写死在代码仓库里
  const DEFAULT_API_KEY = process.env.REACT_APP_DEFAULT_API_KEY || '';

  // API 根地址：见 src/apiBaseUrl.js（8000/8080 静态站会指向当前主机名的 :5001，支持 127.0.0.1 / 局域网 IP）
  const API_URL = getApiBaseUrl();

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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps


  useEffect(() => {
    if (podcastSpeakerMode !== 'single') return;
    setSpeaker2Voice(speaker1Voice);
  }, [podcastSpeakerMode, speaker1Voice]);

  useEffect(() => {
    if (
      !podcastUploadOpen &&
      !podcastTbModeOpen &&
      !podcastTbVoiceOpen &&
      !podcastTbDurationOpen
    ) {
      return undefined;
    }
    const onDoc = (e) => {
      if (podcastUploadRef.current && !podcastUploadRef.current.contains(e.target)) {
        setPodcastUploadOpen(false);
      }
      if (podcastTbModeRef.current && !podcastTbModeRef.current.contains(e.target)) {
        setPodcastTbModeOpen(false);
      }
      if (podcastTbVoiceRef.current && !podcastTbVoiceRef.current.contains(e.target)) {
        setPodcastTbVoiceOpen(false);
      }
      if (podcastTbDurationRef.current && !podcastTbDurationRef.current.contains(e.target)) {
        setPodcastTbDurationOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [
    podcastUploadOpen,
    podcastTbModeOpen,
    podcastTbVoiceOpen,
    podcastTbDurationOpen,
  ]);

  const closePodcastTbPopovers = useCallback(() => {
    setPodcastTbModeOpen(false);
    setPodcastTbVoiceOpen(false);
    setPodcastUploadOpen(false);
    setPodcastTbDurationOpen(false);
  }, []);

  useEffect(() => {
    if (!podcastWorkMenuOpenId) return undefined;
    const onDoc = (e) => {
      const id = podcastWorkMenuOpenId;
      const wrap = podcastWorkMenuRefs.current?.[String(id)];
      if (wrap && wrap.contains(e.target)) return;
      setPodcastWorkMenuOpenId(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [podcastWorkMenuOpenId]);

  const deletePodcastWork = useCallback(
    (id) => {
      const sid = String(id || '').trim();
      if (!sid) return;
      const target = (podcastWorks || []).find((w) => String(w.id) === sid);
      const label = (target?.title || '').trim() || '该项目';
      // eslint-disable-next-line no-restricted-globals
      if (!window.confirm(`确定删除「${label}」吗？`)) return;
      const next = (podcastWorks || []).filter((w) => String(w.id) !== sid);
      setPodcastWorks(next);
      savePodcastWorks(next);
      setPodcastWorkMenuOpenId((cur) => (String(cur) === sid ? null : cur));
      setPodcastWorkRates((prev) => {
        const n = { ...(prev || {}) };
        delete n[sid];
        return n;
      });
    },
    [podcastWorks]
  );

  const renamePodcastWork = useCallback(
    (id) => {
      const sid = String(id || '').trim();
      if (!sid) return;
      const target = (podcastWorks || []).find((w) => String(w.id) === sid);
      const nextTitleRaw = window.prompt('输入新名称', target?.title || '');
      const nextTitle = String(nextTitleRaw || '').trim();
      if (!nextTitle) return;
      const next = (podcastWorks || []).map((w) => (String(w.id) === sid ? { ...w, title: nextTitle } : w));
      setPodcastWorks(next);
      savePodcastWorks(next);
      setPodcastWorkMenuOpenId(null);
    },
    [podcastWorks]
  );

  const copyPodcastWorkScript = useCallback(
    async (id) => {
      const sid = String(id || '').trim();
      if (!sid) return;
      const target = (podcastWorks || []).find((w) => String(w.id) === sid);
      let txt = String(target?.scriptText || '').trim();
      if (!txt && target?.scriptUrl) {
        try {
          const res = await fetch(resolveMediaUrl(target.scriptUrl), {
            headers: getAuthHeaders(),
          });
          if (res.ok) txt = String(await res.text()).trim();
        } catch (e) {
          // ignore and fall back to alert
        }
      }
      if (!txt) {
        alert('暂无脚本可复制（请先生成播客并确保已生成文稿）。');
        return;
      }
      try {
        await navigator.clipboard.writeText(txt);
        setPodcastWorkMenuOpenId(null);
      } catch (e) {
        alert('复制失败，请检查浏览器权限或使用 HTTPS 页面。');
      }
    },
    [podcastWorks, getAuthHeaders]
  );

  const downloadPodcastWorkBundle = useCallback(
    async (id) => {
      const sid = String(id || '').trim();
      if (!sid) return;
      const target = (podcastWorks || []).find((w) => String(w.id) === sid);
      if (!target?.audioUrl) {
        alert('没有可下载的音频');
        return;
      }
      setPodcastWorkZipBusyId(sid);
      setPodcastWorkMenuOpenId(null);
      try {
        await downloadWorkBundleZip({
          title: target.title || '未命名',
          audioUrl: target.audioUrl,
          scriptText: target.scriptText,
          scriptUrl: target.scriptUrl,
          coverRaw: target.coverImage,
          getAuthHeaders,
        });
      } catch (e) {
        alert(e?.message || String(e));
      } finally {
        setPodcastWorkZipBusyId(null);
      }
    },
    [podcastWorks, getAuthHeaders]
  );

  const setPodcastWorkPlaybackRate = useCallback((id, rate) => {
    const sid = String(id || '').trim();
    if (!sid) return;
    const r = Number(rate);
    if (!Number.isFinite(r) || r <= 0) return;
    setPodcastWorkRates((prev) => ({ ...(prev || {}), [sid]: r }));
    const el = podcastWorkAudioRefs.current?.[sid];
    if (el) {
      try {
        el.playbackRate = r;
      } catch (e) {
        // ignore
      }
    }
  }, []);

  const pickPodcastComposerClone = useCallback(
    (which, voiceId) => {
      const id = String(voiceId || '').trim();
      if (!id) return;
      if (podcastSpeakerMode === 'single') {
        setSpeaker1Type('custom');
        setSpeaker1CustomMode('saved');
        setSpeaker1SavedVoiceId(id);
        setSpeaker2Type('custom');
        setSpeaker2CustomMode('saved');
        setSpeaker2SavedVoiceId(id);
        return;
      }
      if (which === '1') {
        setSpeaker1Type('custom');
        setSpeaker1CustomMode('saved');
        setSpeaker1SavedVoiceId(id);
      } else if (which === '2') {
        setSpeaker2Type('custom');
        setSpeaker2CustomMode('saved');
        setSpeaker2SavedVoiceId(id);
      }
    },
    [podcastSpeakerMode]
  );

  const voiceToolbarLabel = useMemo(() => {
    const cloneName = (id) =>
      savedCustomVoices.find((x) => String(x.voiceId) === String(id))?.displayName || id;
    const n1 =
      speaker1Type === 'custom' && speaker1CustomMode === 'saved' && speaker1SavedVoiceId
        ? cloneName(speaker1SavedVoiceId)
        : defaultVoicesMap[speaker1Voice]?.name || speaker1Voice;
    if (podcastSpeakerMode === 'single') return n1;
    const n2 =
      speaker2Type === 'custom' && speaker2CustomMode === 'saved' && speaker2SavedVoiceId
        ? cloneName(speaker2SavedVoiceId)
        : defaultVoicesMap[speaker2Voice]?.name || speaker2Voice;
    return `${n1} · ${n2}`;
  }, [
    defaultVoicesMap,
    speaker1Voice,
    speaker2Voice,
    podcastSpeakerMode,
    speaker1Type,
    speaker2Type,
    speaker1CustomMode,
    speaker2CustomMode,
    speaker1SavedVoiceId,
    speaker2SavedVoiceId,
    savedCustomVoices,
  ]);

  const durationToolbarLabel = useMemo(() => {
    if (roomConfigModal) {
      const n = parseInt(String(scriptTargetChars || '').trim(), 10);
      if (Number.isFinite(n)) return `约 ${n} 字`;
      return '字数';
    }
    if (durationMode === 'text') return '字数';
    if (durationPreset === 'short') return '短';
    if (durationPreset === 'long') return '长';
    return '中';
  }, [durationPreset, durationMode, roomConfigModal, scriptTargetChars]);

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
    if (notesPodcastMode) {
      setNotesPodcastStep(1);
    }
  }, [notesPodcastMode]);

  const roomIdsSerialized =
    roomConfigModal && Array.isArray(roomSelectedNoteIds) ? JSON.stringify(roomSelectedNoteIds) : null;

  useEffect(() => {
    if (!roomConfigModal) return;
    const nb = (roomNotebookName || '').trim();
    if (nb) setNoteNotebookFilter(nb);
  }, [roomConfigModal, roomNotebookName]);

  useEffect(() => {
    if (roomIdsSerialized == null) return;
    try {
      const ids = JSON.parse(roomIdsSerialized);
      if (!Array.isArray(ids)) return;
      setSelectedNoteIds(ids.map((id) => String(id)));
    } catch (e) {
      // ignore
    }
  }, [roomIdsSerialized]);

  useEffect(() => {
    if (roomConfigModal) {
      setDurationMode('text');
    }
  }, [roomConfigModal]);

  useEffect(() => {
    if (!roomConfigModal || roomPodcastKind !== 'debate') return;
    setPodcastSpeakerMode('dual');
  }, [roomConfigModal, roomPodcastKind]);

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
        // 先拉笔记本列表，再按笔记本筛选拉笔记
        const nbResp = await fetch(apiPath('/api/notebooks'));
        if (nbResp.ok) {
          const nbData = await nbResp.json().catch(() => ({}));
          const nbs = Array.isArray(nbData?.notebooks) ? nbData.notebooks : [];
          setAvailableNotebooks(nbs);
          if (nbs.length > 0 && !nbs.includes(noteNotebookFilter)) {
            setNoteNotebookFilter(nbs[0]);
          }
        }

        const qs = noteNotebookFilter ? `?notebook=${encodeURIComponent(noteNotebookFilter)}` : '';
        const resp = await fetch(apiPath(`/api/notes${qs}`));
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
  }, [selectedNoteIds, noteNotebookFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(AUDIO_STYLE_CONFIG_KEY);
      if (!raw) return;
      const c = JSON.parse(raw);
      if (!c || typeof c !== 'object') return;
      setAudioStyleMode(
        c.audioStyleMode === 'default' || c.audioStyleMode === 'custom' ? c.audioStyleMode : 'custom'
      );
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

  // 让顶部“短/中/长”与当前 scriptTargetChars 保持一致（不反向写回 scriptTargetChars）
  useEffect(() => {
    if (durationMode !== 'preset') return;
    const v = parseInt(String(scriptTargetChars || '').trim(), 10);
    if (!Number.isFinite(v)) return;
    const entries = Object.entries(DURATION_PRESET_TO_CHARS);
    let bestKey = durationPreset;
    let bestDist = Infinity;
    entries.forEach(([k, num]) => {
      const dist = Math.abs(num - v);
      if (dist < bestDist) {
        bestDist = dist;
        bestKey = k;
      }
    });
    if (bestKey && bestKey !== durationPreset) setDurationPreset(bestKey);
  }, [scriptTargetChars, durationMode, durationPreset]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const n = parseInt(String(scriptTargetChars).trim(), 10);
    const payload = {
      scriptTargetChars: Number.isFinite(n)
        ? Math.max(SCRIPT_TARGET_CHARS_MIN, Math.min(SCRIPT_TARGET_CHARS_MAX, n))
        : SCRIPT_TARGET_CHARS_DEFAULT,
      scriptStyle,
      scriptLanguage,
      programName,
      speaker1Persona,
      speaker2Persona,
      scriptConstraints,
      useRag,
    };
    try {
      window.localStorage.setItem(AI_ADVANCED_CONFIG_KEY, JSON.stringify(payload));
    } catch (e) {
      // ignore
    }
  }, [
    scriptTargetChars,
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
    setAudioStyleMode(
      c.audioStyleMode === 'default' || c.audioStyleMode === 'custom' ? c.audioStyleMode : 'custom'
    );
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

  const mergePdfFilesFromList = (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const allowedExt = ['.pdf', '.doc', '.docx', '.epub', '.txt', '.md', '.markdown'];
    const validFiles = files.filter((file) => {
      const fileName = (file.name || '').toLowerCase();
      return allowedExt.some((ext) => fileName.endsWith(ext));
    });
    if (!validFiles.length) {
      alert('请上传支持格式：pdf / doc / docx / epub / txt / md');
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
  };

  const handlePdfChange = (e) => {
    mergePdfFilesFromList(e.target.files);
    e.target.value = '';
  };

  const handlePdfDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setPdfDropActive(true);
  };

  const handlePdfDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setPdfDropActive(false);
  };

  const handlePdfDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setPdfDropActive(false);
    mergePdfFilesFromList(e.dataTransfer.files);
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

  const handleBgmFileChange = (setter) => (e) => {
    const file = e.target.files[0];
    if (!file) {
      setter(null);
      return;
    }
    setter(file);
  };

  const addLog = () => {};

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
    const featureOk = await ensureFeatureUnlocked();
    if (!featureOk) return;

    addLog('🚀 已开始生成流程，准备发起请求...');

    if (roomConfigModal) {
      if (!roomPodcastKind || !PODCAST_ROOM_PRESETS[roomPodcastKind]) {
        alert('请先选择一种播客体裁（上方四个小卡片）');
        return;
      }
    }

    const hasSelectedNotes = Array.isArray(selectedNoteIds) && selectedNoteIds.length > 0;
    const presetRoom = roomConfigModal && roomPodcastKind ? PODCAST_ROOM_PRESETS[roomPodcastKind] : null;
    const effectiveTopic = presetRoom
      ? [presetRoom.textPrefix || '', String(roomPodcastPrompt || '').trim()]
          .filter(Boolean)
          .join('\n\n')
          .trim()
      : (textInput || '').trim();
    const effectiveScriptStyle = presetRoom?.scriptStyle != null ? presetRoom.scriptStyle : scriptStyle;
    const effectiveProgramName = presetRoom?.programName != null ? presetRoom.programName : programName;

    if (roomConfigModal) {
      roomGenMetaRef.current = {
        programName: String(effectiveProgramName || '').trim(),
        topic: effectiveTopic,
      };
    } else {
      roomGenMetaRef.current = { programName: '', topic: '' };
    }

    if (
      !effectiveTopic &&
      urlInputs.length === 0 &&
      pdfFiles.length === 0 &&
      !hasSelectedNotes
    ) {
      alert('请至少提供一种输入内容（文本/网址/文件/知识库勾选笔记）');
      return;
    }
    const chars = parseScriptTargetCharsForGenerate(scriptTargetChars);
    if (chars === null) {
      alert(`目标正文字数请输入 ${SCRIPT_TARGET_CHARS_MIN}~${SCRIPT_TARGET_CHARS_MAX} 的整数`);
      return;
    }

    if (speaker1Type === 'custom') {
      if (speaker1CustomMode !== 'saved') {
        alert('请先在侧栏「你的声音」完成克隆，再在工具栏选择已保存音色');
        return;
      }
      if (!speaker1SavedVoiceId.trim()) {
        alert('Speaker1 已选择自定义音色，请在工具栏选择一个已保存的克隆音色');
        return;
      }
    }

    if (speaker2Type === 'custom') {
      if (speaker2CustomMode !== 'saved') {
        alert('请先在侧栏「你的声音」完成克隆，再在工具栏选择已保存音色');
        return;
      }
      if (!speaker2SavedVoiceId.trim()) {
        alert('Speaker2 已选择自定义音色，请在工具栏选择一个已保存的克隆音色');
        return;
      }
    }

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

    // 清空之前的状态
    setScript([]);
    scriptRef.current = [];
    setCoverImage('');
    setAudioUrl('');
    setPlayer0Url('');
    setPlayer1Url('');
    setActivePlayer(0);
    setUrlWarning(null);
    generateAbortRef.current?.abort();
    const generateAbortController = new AbortController();
    generateAbortRef.current = generateAbortController;
    setIsGenerating(true);
    setProgress('正在准备生成…');
    setProgressEta('预计 2-4 分钟');
    progressStartAtRef.current = Date.now();

    // 构建 FormData
    const formData = new FormData();
    formData.append('api_key', apiKey);
    const topicTrimmed = effectiveTopic;
    if (topicTrimmed) formData.append('text_input', topicTrimmed);
    if (urlInputs.length > 0) {
      formData.append('url', urlInputs[0]);
      formData.append('url_list', JSON.stringify(urlInputs));
    }
    pdfFiles.forEach((file) => formData.append('pdf_files', file));

    formData.append('script_mode', 'ai');
    formData.append('cover_mode', 'ai');
    formData.append('selected_note_ids', JSON.stringify(selectedNoteIds));
    formData.append(
      'script_target_chars',
      String(parseScriptTargetCharsForGenerate(scriptTargetChars) ?? SCRIPT_TARGET_CHARS_DEFAULT)
    );
    formData.append('use_rag', useRag ? '1' : '0');
    // 参考文本字数（rag_text_chars）仅在「加入创意」高级配置中维护；当前生成流程不从此处传递
    formData.append('script_style', effectiveScriptStyle);
    formData.append('script_language', scriptLanguage);
    formData.append('program_name', effectiveProgramName);
    formData.append('speaker1_persona', speaker1Persona);
    formData.append('speaker2_persona', speaker2Persona);
    formData.append('script_constraints', scriptConstraints);

    formData.append('speaker1_type', speaker1Type);
    if (speaker1Type === 'default') {
      formData.append('speaker1_voice_name', speaker1Voice);
    } else {
      formData.append('speaker1_custom_voice_id', speaker1SavedVoiceId.trim());
    }

    formData.append('speaker2_type', speaker2Type);
    if (speaker2Type === 'default') {
      formData.append('speaker2_voice_name', speaker2Voice);
    } else {
      formData.append('speaker2_custom_voice_id', speaker2SavedVoiceId.trim());
    }

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

    // 建立 SSE 连接
    try {
      addLog(`🌐 正在请求: ${API_URL || '(同源)'} /api/generate_podcast`);
      const response = await fetch(apiPath('/api/generate_podcast'), {
        method: 'POST',
        body: formData,
        signal: generateAbortController.signal,
        headers: getAuthHeaders(),
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

  const toggleNoteSelected = (noteId) => {
    const id = String(noteId || '').trim();
    if (!id) return;
    const has = selectedNoteIds.includes(id);
    const nextIds = has ? selectedNoteIds.filter((x) => x !== id) : [...selectedNoteIds, id];
    setSelectedNoteIds(nextIds);
    try {
      window.localStorage.setItem(SELECTED_NOTES_KEY, JSON.stringify(nextIds));
    } catch (e) {
      // ignore
    }
  };

  const saveAiAdvancedConfigAndClose = () => {
    setShowFinalCopyModal(false);
    addLog('✓ 已保存 AI 加工高级配置（生成时将自动应用）');
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

  const clearAdvancedConstraints = () => {
    setScriptConstraints(DEFAULT_SCRIPT_CONSTRAINTS);
  };

  // 处理 SSE 事件
  const handleSSEEvent = (data) => {
    switch (data.type) {
      case 'progress':
        setProgress(data.message);
        if (progressStartAtRef.current) {
          const elapsedSec = Math.max(0, Math.round((Date.now() - progressStartAtRef.current) / 1000));
          // 粗略 ETA：脚本+封面+合成通常在 60~240s；这里动态展示“已用时 + 预计剩余”
          const baselineTotal = 180;
          const remain = Math.max(15, baselineTotal - elapsedSec);
          setProgressEta(`已用时 ${elapsedSec}s · 预计剩余 ${remain}s`);
        }
        addLog(data.message);
        break;

      case 'log':
        addLog(data.message);
        break;

      case 'script_chunk':
        setScript((prev) => {
          const next = [...prev, data.full_line];
          scriptRef.current = next;
          return next;
        });
        break;

      case 'trace_id':
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
        const progressiveUrl = resolveMediaUrl(data.audio_url);

        // 实时刷新“正在生成”的进度文案（有些后端只在 progressive_audio 推进度）
        if (data && (data.message || data.sentence_number || data.duration_ms)) {
          if (data.message) {
            setProgress(String(data.message));
          } else if (data.sentence_number) {
            setProgress(`已生成第 ${data.sentence_number} 句…`);
          } else {
            setProgress('正在生成播客…');
          }
          if (progressStartAtRef.current) {
            const elapsedSec = Math.max(0, Math.round((Date.now() - progressStartAtRef.current) / 1000));
            const baselineTotal = 180;
            const remain = Math.max(15, baselineTotal - elapsedSec);
            setProgressEta(`已用时 ${elapsedSec}s · 预计剩余 ${remain}s`);
          }
        }

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
        setAudioUrl(data.audio_url);
        setIsGenerating(false);
        setProgress('播客生成完成！');
        setProgressEta('');
        addLog('🎉 播客生成完成！可在「我的作品」中试听或打包下载');
        setPodcastWorks((prev) => {
          const nowId = `${Date.now()}`;
          const titleRaw =
            roomConfigModal && roomGenMetaRef.current?.programName
              ? roomGenMetaRef.current.programName
              : (programName || '').trim() || (textInput || '').trim();
          const title = titleRaw ? titleRaw.slice(0, 40) + (titleRaw.length > 40 ? '…' : '') : `播客-${nowId}`;
          const entry = {
            id: nowId,
            title,
            audioUrl: data.audio_url || '',
            scriptUrl: data.script_url || '',
            coverImage: data.cover_image || coverImage || '',
            scriptText: Array.isArray(scriptRef.current) && scriptRef.current.length ? scriptRef.current.join('\n') : '',
            createdAt: new Date().toISOString(),
            speakers: voiceToolbarLabel,
            durationHint: durationMode === 'preset' ? (DURATION_PRESET_TO_HINT[durationPreset] || '') : '',
          };
          const next = [entry, ...(Array.isArray(prev) ? prev : [])].slice(0, 30);
          savePodcastWorks(next);
          if (
            roomConfigModal &&
            typeof onRoomGenerationComplete === 'function'
          ) {
            queueMicrotask(() => onRoomGenerationComplete(entry));
          }
          return next;
        });
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
        setProgressEta('');
        break;

      default:
        console.log('未知事件类型:', data);
    }
  };

  const openFinalCopyModal = async () => {
    setShowFinalCopyModal(true);
  };

  const npS1 = notesPodcastMode && !roomConfigModal && notesPodcastStep === 1;
  const npS2 = notesPodcastMode && !roomConfigModal && notesPodcastStep === 2;
  const npS3 = notesPodcastMode && !roomConfigModal && notesPodcastStep === 3;
  const showNotesComposer = !notesPodcastMode || npS2 || roomConfigModal;
  const hideMaterialsInNotesFlow = notesPodcastMode && !roomConfigModal;
  const hideToolbarGenerateInNotesFlow = (notesPodcastMode && npS2) || roomConfigModal;

  return (
    <div className={`podcast-generator${roomConfigModal ? ' podcast-generator--room-modal' : ''}`}>
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

      <div className="section section--listenhub">
        {!roomConfigModal && (
          <h2 className="section-title">{notesPodcastMode ? '笔记出播客' : '创作'}</h2>
        )}
        <div className="input-content lh-ai-flow">
            {!roomConfigModal && (
            <div className="lh-hero">
              <h1 className="lh-hero-title">{notesPodcastMode ? '笔记出播客' : 'AI 播客'}</h1>
              <p className="lh-hero-subtitle">
                {notesPodcastMode
                  ? '① 选择笔记 → ② 配置与创作 → ③ 生成播客'
                  : '解说万物，一键生成播客'}
              </p>
            </div>
            )}

            <div
              className={`podcast-composer-outer ${pdfDropActive ? 'podcast-composer-outer--drop' : ''}`}
              onDragOver={
                notesPodcastMode && !roomConfigModal && (npS1 || npS3)
                  ? (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }
                  : handlePdfDragOver
              }
              onDragLeave={notesPodcastMode && !roomConfigModal && (npS1 || npS3) ? (e) => e.preventDefault() : handlePdfDragLeave}
              onDrop={
                notesPodcastMode && !roomConfigModal && (npS1 || npS3)
                  ? (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }
                  : handlePdfDrop
              }
            >
              {notesPodcastMode && !roomConfigModal && (
                <div className="notes-podcast-stepper" role="navigation" aria-label="笔记出播客步骤">
                  <button
                    type="button"
                    className={`notes-podcast-step-btn ${notesPodcastStep === 1 ? 'is-active' : ''}`}
                    onClick={() => setNotesPodcastStep(1)}
                  >
                    ① 选择笔记
                  </button>
                  <span className="notes-podcast-step-arrow" aria-hidden>
                    →
                  </span>
                  <button
                    type="button"
                    className={`notes-podcast-step-btn ${notesPodcastStep === 2 ? 'is-active' : ''}`}
                    onClick={() => setNotesPodcastStep(2)}
                  >
                    ② 配置与创作
                  </button>
                  <span className="notes-podcast-step-arrow" aria-hidden>
                    →
                  </span>
                  <button
                    type="button"
                    className={`notes-podcast-step-btn ${notesPodcastStep === 3 ? 'is-active' : ''}`}
                    onClick={() => setNotesPodcastStep(3)}
                  >
                    ③ 生成播客
                  </button>
                </div>
              )}
              {npS1 && (
                <div className="notes-podcast-step1-panel">
                  <p className="notes-podcast-step1-lead">本步仅选择笔记，不包含链接、文件与其它选项。</p>
                  <div className="podcast-notes-col">
                    <select
                      className="podcast-notebook-select"
                      value={noteNotebookFilter}
                      onChange={(e) => setNoteNotebookFilter(e.target.value)}
                      aria-label="选择笔记本"
                    >
                      {(availableNotebooks.length > 0 ? availableNotebooks : ['默认笔记本']).map((nb) => (
                        <option key={nb} value={nb}>
                          {nb}
                        </option>
                      ))}
                    </select>
                    <div className="podcast-notes-checklist" role="listbox" aria-label="从笔记库选择">
                      {availableNotes.length === 0 ? (
                        <div className="podcast-notes-checklist-empty">暂无笔记，请先在「笔记管理」中上传。</div>
                      ) : (
                        availableNotes.map((n) => {
                          const id = String(n.noteId || '').trim();
                          if (!id) return null;
                          const checked = selectedNoteIds.includes(id);
                          const label = n.title || n.fileName || id;
                          return (
                            <label key={id} className={`podcast-note-check-item ${checked ? 'is-on' : ''}`}>
                              <input type="checkbox" checked={checked} onChange={() => toggleNoteSelected(id)} />
                              <span className="podcast-note-check-text">{label}</span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                  <div className="notes-podcast-step-nav">
                    <button type="button" className="podcast-quick-flow-btn-primary" onClick={() => setNotesPodcastStep(2)}>
                      下一步
                    </button>
                  </div>
                </div>
              )}
              {npS3 && (
                <div className="notes-podcast-step3-panel" role="region" aria-label="生成播客">
                  <p className="notes-podcast-step3-title">确认并生成</p>
                  <ul className="notes-podcast-step3-summary">
                    <li>已选笔记：{selectedNoteIds.length} 篇</li>
                    <li>补充话题：约 {String(textInput || '').trim().length} 字</li>
                    <li>篇幅：{durationToolbarLabel}</li>
                    <li>
                      模式：{podcastSpeakerMode === 'single' ? '单人' : '双人'} ·{' '}
                      {SCRIPT_LANG_LABELS[scriptLanguage] || scriptLanguage} · 音色：{voiceToolbarLabel}
                    </li>
                  </ul>
                  <div className="notes-podcast-step-nav">
                    <button type="button" className="podcast-quick-flow-btn-secondary" onClick={() => setNotesPodcastStep(2)}>
                      上一步
                    </button>
                    <button
                      type="button"
                      className="podcast-quick-flow-btn-primary"
                      disabled={isGenerating}
                      onClick={() => {
                        closePodcastTbPopovers();
                        handleGenerate();
                      }}
                    >
                      {isGenerating ? '生成中…' : '生成播客'}
                    </button>
                  </div>
                  {isGenerating && (
                    <button type="button" className="notes-podcast-step3-stop" onClick={stopGenerate}>
                      <span className="podcast-tb-stop-btn-inner" aria-hidden>
                        ■
                      </span>{' '}
                      停止生成
                    </button>
                  )}
                </div>
              )}
              {showNotesComposer && (
                <div
                  className={`podcast-composer ${pdfDropActive ? 'podcast-composer--drop' : ''}${
                    roomConfigModal ? ' podcast-composer--room-config' : ''
                  }`}
                >
              {!roomConfigModal && (
              <textarea
                id="lh-topic-input"
                className="podcast-composer-input"
                placeholder={
                  notesPodcastMode
                    ? '可选：补充你希望播客强调的方向、话题或听众（也可留空，仅用笔记生成）'
                    : '输入文字、上传文件或粘贴链接，我们帮你生成播客'
                }
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                rows={notesPodcastMode ? 5 : 8}
              />
              )}

              <div className={`podcast-composer-toolbar${roomConfigModal ? ' podcast-composer-toolbar--room' : ''}`}>
                <div className={`podcast-toolbar-bar${roomConfigModal ? ' podcast-toolbar-bar--room' : ''}`}>
                  <div className="podcast-toolbar-pill" role="toolbar" aria-label="创作选项">
                    <div className="podcast-tb-item-wrap" ref={podcastTbModeRef}>
                      <button
                        type="button"
                        className={`podcast-tb-item ${podcastTbModeOpen ? 'is-on' : ''}`}
                        onClick={() => {
                          setPodcastTbModeOpen((o) => !o);
                          setPodcastTbVoiceOpen(false);
                          setPodcastUploadOpen(false);
                        }}
                        aria-expanded={podcastTbModeOpen}
                        aria-haspopup="listbox"
                      >
                        <PodcastTbIcon>{podcastSpeakerMode === 'single' ? <IcoUser /> : <IcoUsers />}</PodcastTbIcon>
                        <span className="podcast-tb-item-text">
                          {podcastSpeakerMode === 'single' ? '单人' : '双人'}
                        </span>
                      </button>
                      {podcastTbModeOpen && (
                        <div className="podcast-tb-popover" role="listbox">
                          <button
                            type="button"
                            className={podcastSpeakerMode === 'single' ? 'is-active' : ''}
                            onClick={() => {
                              setPodcastSpeakerMode('single');
                              setSpeaker1Type('default');
                              setSpeaker2Type('default');
                              setPodcastTbModeOpen(false);
                            }}
                          >
                            单人
                          </button>
                          <button
                            type="button"
                            className={podcastSpeakerMode === 'dual' ? 'is-active' : ''}
                            onClick={() => {
                              setPodcastSpeakerMode('dual');
                              setPodcastTbModeOpen(false);
                            }}
                          >
                            双人
                          </button>
                        </div>
                      )}
                    </div>
                    <span className="podcast-tb-divider" aria-hidden />
                    <label className="podcast-tb-item podcast-tb-item--lang">
                      <PodcastTbIcon>
                        <IcoGlobe />
                      </PodcastTbIcon>
                      <span className="podcast-tb-item-text podcast-tb-item-text--select">
                        {SCRIPT_LANG_LABELS[scriptLanguage] || scriptLanguage}
                      </span>
                      <select
                        className="podcast-tb-item-native-select"
                        value={scriptLanguage}
                        onChange={(e) => setScriptLanguage(e.target.value)}
                        aria-label="脚本语言"
                      >
                        <option value="中文">中文</option>
                        <option value="English">English</option>
                        <option value="日本語">日本語</option>
                      </select>
                    </label>
                    <span className="podcast-tb-divider" aria-hidden />
                    <div className="podcast-tb-item-wrap" ref={podcastTbVoiceRef}>
                      <button
                        type="button"
                        className={`podcast-tb-item podcast-tb-item--voice ${podcastTbVoiceOpen ? 'is-on' : ''}`}
                        onClick={() => {
                          setPodcastTbVoiceOpen((o) => !o);
                          setPodcastTbModeOpen(false);
                          setPodcastUploadOpen(false);
                        }}
                        aria-expanded={podcastTbVoiceOpen}
                        title={voiceToolbarLabel}
                      >
                        <PodcastTbIcon>
                          <IcoWave />
                        </PodcastTbIcon>
                        <span className="podcast-tb-item-text podcast-tb-item-text--truncate">{voiceToolbarLabel}</span>
                      </button>
                      {podcastTbVoiceOpen && (
                        <div className="podcast-tb-popover podcast-tb-popover--wide" role="dialog" aria-label="选择音色">
                          <div className="podcast-voice-popover-inner">
                            {savedCustomVoices.length > 0 && (
                              <div className="podcast-voice-block">
                                <div className="podcast-voice-block-title">克隆音色</div>
                                {podcastSpeakerMode === 'single' ? (
                                  <div className="podcast-voice-chip-row">
                                    {savedCustomVoices.map((cv) => {
                                      const id = String(cv.voiceId || '').trim();
                                      const active =
                                        speaker1Type === 'custom' &&
                                        speaker1CustomMode === 'saved' &&
                                        speaker1SavedVoiceId === id;
                                      return (
                                        <button
                                          key={id}
                                          type="button"
                                          className={`podcast-voice-chip ${active ? 'podcast-voice-chip--on' : ''}`}
                                          onClick={() => pickPodcastComposerClone('1', id)}
                                        >
                                          {cv.displayName || id}
                                        </button>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <>
                                    <div className="podcast-voice-block-sub">Speaker 1</div>
                                    <div className="podcast-voice-chip-row">
                                      {savedCustomVoices.map((cv) => {
                                        const id = String(cv.voiceId || '').trim();
                                        const active =
                                          speaker1Type === 'custom' &&
                                          speaker1CustomMode === 'saved' &&
                                          speaker1SavedVoiceId === id;
                                        return (
                                          <button
                                            key={`1-${id}`}
                                            type="button"
                                            className={`podcast-voice-chip ${active ? 'podcast-voice-chip--on' : ''}`}
                                            onClick={() => pickPodcastComposerClone('1', id)}
                                          >
                                            {cv.displayName || id}
                                          </button>
                                        );
                                      })}
                                    </div>
                                    <div className="podcast-voice-block-sub">Speaker 2</div>
                                    <div className="podcast-voice-chip-row">
                                      {savedCustomVoices.map((cv) => {
                                        const id = String(cv.voiceId || '').trim();
                                        const active =
                                          speaker2Type === 'custom' &&
                                          speaker2CustomMode === 'saved' &&
                                          speaker2SavedVoiceId === id;
                                        return (
                                          <button
                                            key={`2-${id}`}
                                            type="button"
                                            className={`podcast-voice-chip ${active ? 'podcast-voice-chip--on' : ''}`}
                                            onClick={() => pickPodcastComposerClone('2', id)}
                                          >
                                            {cv.displayName || id}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                            <details className="podcast-voice-preset-details">
                              <summary className="podcast-voice-preset-summary">预设音色（默认折叠，展开后可按类型筛选）</summary>
                              <div className="podcast-voice-filters">
                                <span className="podcast-voice-filter-label">性别</span>
                                <div className="podcast-voice-filter-row">
                                  {[
                                    { k: 'all', t: '全部' },
                                    { k: 'male', t: '男' },
                                    { k: 'female', t: '女' },
                                    { k: 'other', t: '其他' },
                                  ].map(({ k, t }) => (
                                    <button
                                      key={k}
                                      type="button"
                                      className={`podcast-voice-filter-chip ${podcastVoiceGenderFilter === k ? 'podcast-voice-filter-chip--on' : ''}`}
                                      onClick={() => setPodcastVoiceGenderFilter(k)}
                                    >
                                      {t}
                                    </button>
                                  ))}
                                </div>
                                {podcastComposerLangChips.length > 0 && (
                                  <>
                                    <span className="podcast-voice-filter-label">语言</span>
                                    <div className="podcast-voice-filter-row">
                                      <button
                                        type="button"
                                        className={`podcast-voice-filter-chip ${podcastVoiceLangFilter === 'all' ? 'podcast-voice-filter-chip--on' : ''}`}
                                        onClick={() => setPodcastVoiceLangFilter('all')}
                                      >
                                        全部
                                      </button>
                                      {podcastComposerLangChips.map((lang) => (
                                        <button
                                          key={lang}
                                          type="button"
                                          className={`podcast-voice-filter-chip ${podcastVoiceLangFilter === lang ? 'podcast-voice-filter-chip--on' : ''}`}
                                          onClick={() => setPodcastVoiceLangFilter(lang)}
                                        >
                                          {lang}
                                        </button>
                                      ))}
                                    </div>
                                  </>
                                )}
                              </div>
                              {podcastComposerFilteredGroups.length === 0 ? (
                                <p className="podcast-voice-filter-empty">当前筛选下暂无预设，请选「全部」或调整类型。</p>
                              ) : podcastSpeakerMode === 'single' ? (
                                <GroupedDefaultVoiceSelect
                                  groups={podcastComposerFilteredGroups}
                                  value={speaker1Voice}
                                  onChange={(v) => {
                                    setSpeaker1Type('default');
                                    setSpeaker2Type('default');
                                    setSpeaker1Voice(v);
                                    setSpeaker2Voice(v);
                                  }}
                                  id="podcast-composer-voice-single"
                                  className="podcast-tb-voice-select"
                                />
                              ) : (
                                <div className="podcast-tb-voice-dual">
                                  <label className="podcast-tb-voice-field">
                                    <span>Speaker 1</span>
                                    <GroupedDefaultVoiceSelect
                                      groups={podcastComposerFilteredGroups}
                                      value={speaker1Voice}
                                      onChange={(v) => {
                                        setSpeaker1Type('default');
                                        setSpeaker1Voice(v);
                                      }}
                                      id="podcast-composer-voice-1"
                                      className="podcast-tb-voice-select"
                                    />
                                  </label>
                                  <label className="podcast-tb-voice-field">
                                    <span>Speaker 2</span>
                                    <GroupedDefaultVoiceSelect
                                      groups={podcastComposerFilteredGroups}
                                      value={speaker2Voice}
                                      onChange={(v) => {
                                        setSpeaker2Type('default');
                                        setSpeaker2Voice(v);
                                      }}
                                      id="podcast-composer-voice-2"
                                      className="podcast-tb-voice-select"
                                    />
                                  </label>
                                </div>
                              )}
                            </details>
                          </div>
                        </div>
                      )}
                    </div>
                    <span className="podcast-tb-divider" aria-hidden />
                    <button
                      type="button"
                      className="podcast-tb-item"
                      onClick={() => {
                        openFinalCopyModal();
                        closePodcastTbPopovers();
                      }}
                      disabled={isGenerating}
                    >
                      <PodcastTbIcon>
                        <IcoBulb />
                      </PodcastTbIcon>
                      <span className="podcast-tb-item-text">加入创意</span>
                    </button>
                    <span className="podcast-tb-divider" aria-hidden />
                    <div className="podcast-tb-item-wrap" ref={podcastTbDurationRef}>
                      <button
                        type="button"
                        className={`podcast-tb-item ${podcastTbDurationOpen ? 'is-on' : ''}`}
                        onClick={() => {
                          setPodcastTbDurationOpen((o) => !o);
                          setPodcastTbModeOpen(false);
                          setPodcastTbVoiceOpen(false);
                          setPodcastUploadOpen(false);
                        }}
                        aria-expanded={podcastTbDurationOpen}
                        title={roomConfigModal ? '目标字数' : '选择时长'}
                        aria-haspopup="listbox"
                      >
                        <PodcastTbIcon>
                          <IcoClock />
                        </PodcastTbIcon>
                        <span className="podcast-tb-item-text">{durationToolbarLabel}</span>
                      </button>
                      {podcastTbDurationOpen && (
                        <div
                          className={`podcast-tb-popover${roomConfigModal ? ' podcast-tb-popover--room-chars' : ''}`}
                          role={roomConfigModal ? 'dialog' : 'listbox'}
                          aria-label={roomConfigModal ? '目标字数' : '选择时长'}
                        >
                          {roomConfigModal ? (
                            <div className="podcast-duration-text-input podcast-duration-text-input--room-only">
                              <div className="podcast-duration-text-head">目标正文字数</div>
                              <input
                                type="number"
                                min={SCRIPT_TARGET_CHARS_MIN}
                                max={SCRIPT_TARGET_CHARS_MAX}
                                step={50}
                                className="podcast-duration-text-number"
                                value={scriptTargetChars}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  // 允许先自由输入，避免“首位数字立即被夹断到最小值”导致无法编辑
                                  if (raw === '') {
                                    setScriptTargetChars('');
                                    return;
                                  }
                                  if (!/^\d+$/.test(String(raw))) return;
                                  setScriptTargetChars(String(raw));
                                }}
                                onBlur={() => {
                                  const raw = String(scriptTargetChars || '').trim();
                                  if (!raw) {
                                    setScriptTargetChars(String(SCRIPT_TARGET_CHARS_DEFAULT));
                                    return;
                                  }
                                  const n = parseInt(raw, 10);
                                  if (!Number.isFinite(n)) {
                                    setScriptTargetChars(String(SCRIPT_TARGET_CHARS_DEFAULT));
                                    return;
                                  }
                                  const clamped = Math.max(
                                    SCRIPT_TARGET_CHARS_MIN,
                                    Math.min(SCRIPT_TARGET_CHARS_MAX, n)
                                  );
                                  setScriptTargetChars(String(clamped));
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.currentTarget.blur();
                                  }
                                }}
                              />
                              <p className="podcast-room-chars-hint">
                                范围 {SCRIPT_TARGET_CHARS_MIN}～{SCRIPT_TARGET_CHARS_MAX} 字
                              </p>
                            </div>
                          ) : (
                            <>
                              {(['short', 'medium', 'long']).map((k) => {
                                const title = k === 'short' ? '短' : k === 'medium' ? '中' : '长';
                                const hint = DURATION_PRESET_TO_HINT[k];
                                const chars = String(DURATION_PRESET_TO_CHARS[k]);
                                const active = durationMode === 'preset' && durationPreset === k;
                                return (
                                  <button
                                    // eslint-disable-next-line react/no-array-index-key
                                    key={k}
                                    type="button"
                                    className={active ? 'is-active' : ''}
                                    onClick={() => {
                                      setDurationMode('preset');
                                      setDurationPreset(k);
                                      setScriptTargetChars(chars);
                                      setPodcastTbDurationOpen(false);
                                    }}
                                  >
                                    <div className="podcast-duration-opt">
                                      <div className="podcast-duration-opt-title">{title}</div>
                                      <div className="podcast-duration-opt-sub">{hint}</div>
                                    </div>
                                  </button>
                                );
                              })}
                              <button
                                type="button"
                                className={durationMode === 'text' ? 'is-active' : ''}
                                onClick={() => {
                                  setDurationMode('text');
                                }}
                              >
                                <div className="podcast-duration-opt">
                                  <div className="podcast-duration-opt-title">长文模式</div>
                                  <div className="podcast-duration-opt-sub">自定义目标字数（小于 1 万字）</div>
                                </div>
                              </button>
                              {durationMode === 'text' && (
                                <div className="podcast-duration-text-input">
                                  <div className="podcast-duration-text-head">目标字数</div>
                                  <input
                                    type="number"
                                    min={SCRIPT_TARGET_CHARS_MIN}
                                    max={SCRIPT_TARGET_CHARS_MAX}
                                    step={50}
                                    className="podcast-duration-text-number"
                                    value={scriptTargetChars}
                                    onChange={(e) => {
                                      const raw = e.target.value;
                                      if (raw === '') {
                                        setScriptTargetChars('');
                                        return;
                                      }
                                      if (!/^\d+$/.test(String(raw))) return;
                                      setScriptTargetChars(String(raw));
                                    }}
                                    onBlur={() => {
                                      const raw = String(scriptTargetChars || '').trim();
                                      if (!raw) {
                                        setScriptTargetChars(String(SCRIPT_TARGET_CHARS_DEFAULT));
                                        return;
                                      }
                                      const n = parseInt(raw, 10);
                                      if (!Number.isFinite(n)) {
                                        setScriptTargetChars(String(SCRIPT_TARGET_CHARS_DEFAULT));
                                        return;
                                      }
                                      const clamped = Math.max(
                                        SCRIPT_TARGET_CHARS_MIN,
                                        Math.min(SCRIPT_TARGET_CHARS_MAX, n)
                                      );
                                      setScriptTargetChars(String(clamped));
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.currentTarget.blur();
                                      }
                                    }}
                                  />
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    <span className="podcast-tb-divider" aria-hidden />
                    <button
                      type="button"
                      className="podcast-tb-item podcast-tb-item--ghost"
                      onClick={() => {
                        setShowPodcastIntroModal(true);
                        closePodcastTbPopovers();
                      }}
                    >
                      <PodcastTbIcon>
                        <IcoBrackets />
                      </PodcastTbIcon>
                      <span className="podcast-tb-item-text">开场结尾</span>
                    </button>
                  </div>

                  <div className="podcast-toolbar-trailing">
                    {!hideMaterialsInNotesFlow && !roomConfigModal && (
                      <>
                        <input
                          ref={podcastPdfInputRef}
                          type="file"
                          multiple
                          accept=".pdf,.doc,.docx,.epub,.txt,.md,.markdown"
                          onChange={handlePdfChange}
                          className="podcast-composer-file"
                          aria-hidden
                        />
                        <div className="podcast-upload-wrap" ref={podcastUploadRef}>
                          <button
                            type="button"
                            className={`podcast-tb-item podcast-tb-item--ghost ${podcastUploadOpen ? 'is-on' : ''}`}
                            onClick={() => {
                              setPodcastUploadOpen((o) => !o);
                              setPodcastTbModeOpen(false);
                              setPodcastTbVoiceOpen(false);
                            }}
                            aria-expanded={podcastUploadOpen}
                            title="链接、文件、笔记"
                          >
                            <PodcastTbIcon>
                              <IcoLayers />
                            </PodcastTbIcon>
                            <span className="podcast-tb-item-text">资料</span>
                          </button>
                          {podcastUploadOpen && (
                            <div className="podcast-upload-popover" role="dialog" aria-label="添加参考资料">
                              <div className="podcast-composer-row">
                                <input
                                  type="text"
                                  className="podcast-composer-url"
                                  placeholder="粘贴网页 URL…"
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
                              <div className="podcast-composer-row" style={{ marginTop: 8 }}>
                                <button
                                  type="button"
                                  className="api-key-clear-btn podcast-composer-upload-btn"
                                  onClick={() => podcastPdfInputRef.current?.click()}
                                >
                                  上传文件
                                </button>
                                {!roomConfigModal && (
                                <div className="podcast-notes-col">
                                  <select
                                    className="podcast-notebook-select"
                                    value={noteNotebookFilter}
                                    onChange={(e) => setNoteNotebookFilter(e.target.value)}
                                    aria-label="选择笔记本"
                                  >
                                    {(availableNotebooks.length > 0 ? availableNotebooks : ['默认笔记本']).map((nb) => (
                                      <option key={nb} value={nb}>
                                        {nb}
                                      </option>
                                    ))}
                                  </select>
                                  <div
                                    className="podcast-notes-checklist"
                                    role="listbox"
                                    aria-label="从笔记库选择"
                                  >
                                    {availableNotes.length === 0 ? (
                                      <div className="podcast-notes-checklist-empty">暂无笔记</div>
                                    ) : (
                                      availableNotes.map((n) => {
                                        const id = String(n.noteId || '').trim();
                                        if (!id) return null;
                                        const checked = selectedNoteIds.includes(id);
                                        const label = n.title || n.fileName || id;
                                        return (
                                          <label
                                            key={id}
                                            className={`podcast-note-check-item ${checked ? 'is-on' : ''}`}
                                          >
                                            <input
                                              type="checkbox"
                                              checked={checked}
                                              onChange={() => toggleNoteSelected(id)}
                                            />
                                            <span className="podcast-note-check-text">{label}</span>
                                          </label>
                                        );
                                      })
                                    )}
                                  </div>
                                </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                    {!hideToolbarGenerateInNotesFlow && (
                      <>
                        <button
                          type="button"
                          className="podcast-tb-generate-btn"
                          disabled={isGenerating}
                          onClick={() => {
                            closePodcastTbPopovers();
                            handleGenerate();
                          }}
                          title={isGenerating ? '生成中…' : '生成播客'}
                          aria-label={isGenerating ? '生成中' : '生成播客'}
                        >
                          {isGenerating ? <span className="podcast-tb-generate-busy">…</span> : <IcoSend />}
                        </button>
                        {isGenerating && (
                          <button
                            type="button"
                            className="podcast-tb-stop-btn"
                            onClick={() => {
                              closePodcastTbPopovers();
                              stopGenerate();
                            }}
                            title="停止生成"
                            aria-label="停止生成"
                          >
                            <span className="podcast-tb-stop-btn-inner" aria-hidden>
                              ■
                            </span>
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {!notesPodcastMode && !roomConfigModal && (
                  <div className="podcast-composer-chips">
                    <span className="lh-prompt-chips-label">试试这些主意</span>
                    <div className="lh-prompt-chips-row">
                      {LISTENHUB_EXAMPLE_PROMPTS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          className="lh-prompt-chip"
                          onClick={() => setTextInput(p)}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {!roomConfigModal && null}

              {((!notesPodcastMode && (urlInputs.length > 0 || pdfFiles.length > 0 || selectedNoteItems.length > 0)) ||
                (notesPodcastMode && selectedNoteItems.length > 0)) && (
                <div className="podcast-composer-refs">
                  <div className="script-box lh-script-box-list">
                    {!notesPodcastMode &&
                      urlInputs.map((url, idx) => (
                        <div key={`${url}_${idx}`} className="settings-voice-item lh-ref-line" style={{ borderBottom: 'none', padding: '4px 0' }}>
                          <p style={{ margin: 0 }}>🔗 {url}</p>
                          <button type="button" className="api-key-clear-btn" onClick={() => removeUrlInput(idx)}>
                            删除
                          </button>
                        </div>
                      ))}
                    {!notesPodcastMode &&
                      pdfFiles.map((file, idx) => (
                        <div key={`${file.name}_${file.size}_${idx}`} className="settings-voice-item lh-ref-line" style={{ borderBottom: 'none', padding: '4px 0' }}>
                          <p style={{ margin: 0 }}>📎 {file.name}</p>
                          <button type="button" className="api-key-clear-btn" onClick={() => removeUploadedFile(idx)}>
                            删除
                          </button>
                        </div>
                      ))}
                    {selectedNoteItems.map((n) => (
                      <div key={n.noteId} className="settings-voice-item lh-ref-line" style={{ borderBottom: 'none', padding: '4px 0' }}>
                        <p style={{ margin: 0 }}>
                          📚 {n.title || n.fileName}
                          {n.notebook ? `（${n.notebook}）` : ''}
                        </p>
                        <button type="button" className="api-key-clear-btn" onClick={() => removeSelectedNote(n.noteId)}>
                          删除
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {npS2 && (
                <div className="notes-podcast-step-nav notes-podcast-step-nav--inline">
                  <button type="button" className="podcast-quick-flow-btn-secondary" onClick={() => setNotesPodcastStep(1)}>
                    上一步
                  </button>
                  <button type="button" className="podcast-quick-flow-btn-primary" onClick={() => setNotesPodcastStep(3)}>
                    下一步
                  </button>
                </div>
              )}

              {roomConfigModal && roomPromptSlot && (
                <div className="notes-room-prompt-slot">{roomPromptSlot}</div>
              )}

              {roomConfigModal && (
                <div className="notes-room-config-footer">
                  {isGenerating && progress && (
                    <div className="podcast-works-progress notes-room-config-progress" aria-live="polite">
                      <div className="podcast-works-progress-title">正在生成播客</div>
                      <div className="podcast-works-progress-msg">{progress}</div>
                      {progressEta && <div className="podcast-works-progress-eta">{progressEta}</div>}
                    </div>
                  )}
                  <div className="notes-modal-generate-bar">
                    <div className="notes-room-config-actions">
                      <button
                        type="button"
                        className="notes-modal-gen-btn notes-modal-gen-btn--podcast"
                        disabled={isGenerating}
                        onClick={() => {
                          closePodcastTbPopovers();
                          handleGenerate();
                        }}
                        aria-label={isGenerating ? '生成中' : '生成播客'}
                        title={isGenerating ? '生成中' : '生成播客'}
                      >
                        {isGenerating ? <IcoRoomGenLoading /> : <IcoRoomGenSend />}
                      </button>
                      {isGenerating && (
                        <button
                          type="button"
                          className="notes-modal-gen-btn notes-modal-gen-btn--stop"
                          onClick={stopGenerate}
                          aria-label="停止生成"
                          title="停止生成"
                        >
                          <IcoRoomGenStop />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

            </div>
              )}

            {!roomConfigModal && (
            <div className="tts-bottom-section">
                <div className="tts-bottom-tabs" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={podcastWorksTemplatesTab === 'works'}
                    className={`tts-bottom-tab ${podcastWorksTemplatesTab === 'works' ? 'tts-bottom-tab--active' : ''}`}
                    onClick={() => {
                      setPodcastWorksTemplatesTab('works');
                      setPodcastWorkMenuOpenId(null);
                    }}
                  >
                    我的作品
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={podcastWorksTemplatesTab === 'templates'}
                    className={`tts-bottom-tab ${podcastWorksTemplatesTab === 'templates' ? 'tts-bottom-tab--active' : ''}`}
                    onClick={() => {
                      setPodcastWorksTemplatesTab('templates');
                      setPodcastWorkMenuOpenId(null);
                    }}
                  >
                    模板
                  </button>
                </div>
                {isGenerating && progress && (
                  <div className="podcast-works-progress" aria-live="polite">
                    <div className="podcast-works-progress-title">正在生成播客</div>
                    <div className="podcast-works-progress-msg">{progress}</div>
                    {progressEta && <div className="podcast-works-progress-eta">{progressEta}</div>}
                  </div>
                )}
                <div className="tts-bottom-panel">
                  {podcastWorksTemplatesTab === 'works' ? (
                    <div className="tts-panel-block tts-panel-block--flat">
                      {podcastWorks.length === 0 ? (
                        <p className="tts-empty">暂无项目</p>
                      ) : (
                        <div className="podcast-work-cards">
                          {podcastWorks.map((w) => {
                            const sid = String(w.id);
                            const dur = podcastWorkDurations[sid];
                            const durText = formatDuration(dur);
                            const voicesText = String(w.speakers || '').trim();
                            const createdText = formatCreatedAt(w.createdAt);
                            const durationText =
                              String(w.durationHint || '').trim() || (durText ? `时长 ${durText}` : '');
                            const metaParts = [voicesText, durationText, createdText].filter(Boolean);
                            const metaText = metaParts.join(' · ');
                            const coverSrc = getWorkCoverSrc(w.coverImage || w.cover_image);

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
                                    <button
                                      type="button"
                                      className="podcast-work-card-play"
                                      onClick={() => onToggleWorkPlay(w.id)}
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
                                        podcastWorkMenuRefs.current[String(w.id)] = el;
                                      }}
                                    >
                                      <button
                                        type="button"
                                        className={`tts-work-more ${String(podcastWorkMenuOpenId) === String(w.id) ? 'tts-work-more--on' : ''}`}
                                        onClick={() => {
                                          const nextOpen =
                                            String(podcastWorkMenuOpenId) === String(w.id) ? null : String(w.id);
                                          if (nextOpen) {
                                            try {
                                              const anchor = podcastWorkMenuRefs.current?.[String(w.id)];
                                              const rect = anchor?.getBoundingClientRect?.();
                                              const vh = window.innerHeight || 800;
                                              const spaceBelow = rect ? vh - rect.bottom : 9999;
                                              const openUp = spaceBelow < 260;
                                              setPodcastWorkMenuDir((prev) => ({
                                                ...(prev || {}),
                                                [String(w.id)]: openUp ? 'up' : 'down'
                                              }));
                                            } catch (e) {
                                              // ignore
                                            }
                                          }
                                          setPodcastWorkMenuOpenId(nextOpen);
                                        }}
                                        aria-label="更多"
                                        title="更多"
                                      >
                                        …
                                      </button>
                                      {String(podcastWorkMenuOpenId) === String(w.id) && (
                                        <div
                                          className={`tts-work-dropdown ${
                                            podcastWorkMenuDir[String(w.id)] === 'up' ? 'tts-work-dropdown--up' : ''
                                          }`}
                                          role="menu"
                                          aria-label="作品操作"
                                        >
                                          {w.audioUrl && (
                                            <button
                                              type="button"
                                              className="tts-work-dd-item"
                                              role="menuitem"
                                              disabled={String(podcastWorkZipBusyId) === String(w.id)}
                                              onClick={() => downloadPodcastWorkBundle(w.id)}
                                            >
                                              {String(podcastWorkZipBusyId) === String(w.id) ? '打包中…' : '打包下载'}
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            className="tts-work-dd-item"
                                            onClick={() => renamePodcastWork(w.id)}
                                            role="menuitem"
                                          >
                                            改名
                                          </button>
                                          <button
                                            type="button"
                                            className="tts-work-dd-item"
                                            onClick={() => copyPodcastWorkScript(w.id)}
                                            disabled={!w?.scriptText && !w?.scriptUrl}
                                            role="menuitem"
                                          >
                                            复制文稿
                                          </button>
                                          <div className="tts-work-dd-item tts-work-dd-item--row" role="menuitem">
                                            <span className="tts-work-dd-label">播放速度</span>
                                            <select
                                              className="tts-work-rate"
                                              value={String(podcastWorkRates[String(w.id)] || 1)}
                                              onChange={(e) => setPodcastWorkPlaybackRate(w.id, e.target.value)}
                                              aria-label="播放速度"
                                            >
                                              {[0.75, 1, 1.25, 1.5, 2].map((r) => (
                                                <option key={r} value={r}>
                                                  {r}×
                                                </option>
                                              ))}
                                            </select>
                                          </div>
                                          <button
                                            type="button"
                                            className="tts-work-dd-item tts-work-dd-danger"
                                            onClick={() => deletePodcastWork(w.id)}
                                            role="menuitem"
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

                                  {podcastWorkPlayingId === sid && w.audioUrl && (
                                    <div className="podcast-work-card-inline-player">
                                      <audio
                                        className="podcast-work-card-inline-audio"
                                        ref={podcastWorkInlineAudioRef}
                                        controls
                                        src={resolveMediaUrl(w.audioUrl)}
                                        preload="none"
                                        onPlay={() => pauseOtherPodcastWorks(w.id)}
                                        onLoadedMetadata={(e) => {
                                          const d = e?.currentTarget?.duration;
                                          if (Number.isFinite(d) && d > 0) {
                                            setPodcastWorkDurations((prev) => ({ ...(prev || {}), [sid]: d }));
                                          }
                                          const rate = Number(podcastWorkRates[sid] || 1) || 1;
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
                                          <select
                                            value={String(podcastWorkRates[sid] || 1)}
                                            onChange={(e) => setPodcastWorkPlaybackRate(w.id, e.target.value)}
                                          >
                                            {[0.75, 1, 1.25, 1.5, 2].map((r) => (
                                              <option key={r} value={r}>
                                                {r}×
                                              </option>
                                            ))}
                                          </select>
                                        </label>
                                        <button
                                          type="button"
                                          className="api-key-clear-btn podcast-work-card-inline-close"
                                          onClick={() => setPodcastWorkPlayingId(null)}
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
                  ) : (
                    <div className="tts-panel-block tts-panel-block--flat">
                      <p className="tts-templates-hint">（待接入）这里将展示可一键套用的节目模板</p>
                    </div>
                  )}
                </div>
              </div>
            )}
            </div>
          </div>
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
                3. 点击工具栏右侧生成按钮继续
              </div>
            )}
          </div>
          <div className="close-warning" onClick={() => setUrlWarning(null)}>×</div>
        </div>
      )}

      {/* 渐进式合成仍依赖双缓冲 audio 节点；不在页面底部展示播放器（请到「我的作品」卡片内试听） */}
      {(player0Url || player1Url || audioUrl) && (
        <div className="podcast-progressive-audio-host" aria-hidden="true">
          <audio
            ref={audioRef0}
            controls={false}
            src={player0Url || (audioUrl && activePlayer === 0 ? resolveMediaUrl(audioUrl) : '')}
            preload="metadata"
            style={{ display: 'none' }}
          />
          <audio
            ref={audioRef1}
            controls={false}
            src={player1Url || (audioUrl && activePlayer === 1 ? resolveMediaUrl(audioUrl) : '')}
            preload="metadata"
            style={{ display: 'none' }}
          />
        </div>
      )}

      {showPodcastIntroModal && (
        <div className="voice-rename-modal-mask" onClick={() => setShowPodcastIntroModal(false)}>
          <div
            className="voice-rename-modal podcast-audio-style-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="podcast-io-title"
          >
            <div className="podcast-audio-style-modal-header">
              <h3 id="podcast-io-title">开场结尾配置</h3>
              <p className="voice-rename-modal-subtitle" style={{ marginTop: 6, marginBottom: 0 }}>
                自定义开场与结尾文案、音色路由与背景音；将写入本地并与生成请求同步。
              </p>
            </div>
            <div className="podcast-audio-style-modal-body">
              <div className="input-group">
                <p className="input-description" style={{ marginTop: 10 }}>
                  播客将按「背景音1+开头语+背景音2+主体内容+结束背景音1」的格式拼接，下方可逐项调整参数。
                </p>
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
                  <button type="button" className="api-key-clear-btn" onClick={openSaveAudioStylePresetModal}>
                    保存当前配置
                  </button>
                </div>
              </div>

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
            </div>
            <div className="podcast-audio-style-modal-footer">
              <button type="button" className="generate-btn" onClick={() => setShowPodcastIntroModal(false)}>
                完成
              </button>
            </div>
          </div>
        </div>
      )}

      {showFinalCopyModal && (
        <div
          className="voice-rename-modal-mask"
          onClick={() => setShowFinalCopyModal(false)}
        >
          <div
            className="voice-rename-modal final-copy-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="final-copy-modal-header">
              <h3>💡 加入创意</h3>
              <p className="voice-rename-modal-subtitle final-copy-modal-lead">
                保存 AI 加工高级配置（风格/语言/人设/约束等）。保存后生成播客时会自动应用这些配置。
              </p>
            </div>

            <div className="final-copy-modal-body">
              <div className="final-copy-summary-inner final-copy-advanced-config">
                  <div className="input-group">
                    <label className="input-label">脚本风格</label>
                    <select
                      value={scriptStyle}
                      onChange={(e) => setScriptStyle(e.target.value)}
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
                    >
                      <option value="中文">中文</option>
                      <option value="英文">英文</option>
                      <option value="中英混合">中英混合</option>
                    </select>
                  </div>

                  <div className="input-group">
                    <label className="input-label">节目名</label>
                    <input
                      type="text"
                      value={programName}
                      onChange={(e) => setProgramName(e.target.value)}
                      placeholder="例如：AI科技快报"
                    />
                  </div>

                  <div className="input-group">
                    <label className="input-label">Speaker1 人设</label>
                    <input
                      type="text"
                      value={speaker1Persona}
                      onChange={(e) => setSpeaker1Persona(e.target.value)}
                      placeholder="例如：活泼亲切，引导话题"
                    />
                  </div>

                  <div className="input-group">
                    <label className="input-label">Speaker2 人设</label>
                    <input
                      type="text"
                      value={speaker2Persona}
                      onChange={(e) => setSpeaker2Persona(e.target.value)}
                      placeholder="例如：稳重专业，深度分析"
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
                    />
                    <p className="input-description">
                      当前约束长度：{(scriptConstraints || '').length} 字。建议控制在 1500 字以内；过长时后端会自动压缩后再请求模型，以降低报错概率。
                    </p>
                    <button type="button" className="api-key-clear-btn" onClick={clearAdvancedConstraints}>
                      恢复默认约束
                    </button>
                  </div>
              </div>
            </div>
            <div className="final-copy-modal-footer final-copy-modal-footer-bar">
              <div className="final-copy-footer-side final-copy-footer-left">
                <button type="button" className="api-key-clear-btn" onClick={() => setShowFinalCopyModal(false)}>
                  关闭
                </button>
              </div>
              <div className="final-copy-footer-center">
                <button
                  type="button"
                  className="final-copy-llm-main-btn"
                  onClick={saveAiAdvancedConfigAndClose}
                  disabled={isGenerating}
                >
                  保存
                </button>
              </div>
              <div className="final-copy-footer-side final-copy-footer-right" />
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
