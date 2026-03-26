import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../AuthContext';
import { apiPath, resolveMediaUrl } from '../apiBaseUrl';
import { buildSettingsVoiceTree, getLanguageShortLabel, sortUniqueLanguages } from '../voiceCatalogUtils';
import { assignPresetToSpeaker, assignClonedVoiceToSpeaker } from '../presetVoicesStorage';

const API_KEY_STORAGE_KEY = 'minimax_aipodcast_api_key';

const GENDER_FILTER_ITEMS = [
  { id: 'all', label: '全部' },
  { id: '男', label: '男声' },
  { id: '女', label: '女声' },
  { id: '其他', label: '其他' }
];

const SettingsPanel = ({ variant = 'full', embedded = false }) => {
  const { ensureFeatureUnlocked, getAuthHeaders } = useAuth();
  const showCatalog = variant === 'full' || variant === 'catalog';
  const [defaultVoiceTree, setDefaultVoiceTree] = useState([]);
  const [genderFilter, setGenderFilter] = useState('all');
  const [langFilter, setLangFilter] = useState('all');
  const [savedVoices, setSavedVoices] = useState([]);
  const [previewText, setPreviewText] = useState('欢迎收听我的播客节目');
  const [previewLoadingVoiceId, setPreviewLoadingVoiceId] = useState('');
  const [playingVoiceId, setPlayingVoiceId] = useState('');
  const [editingVoiceId, setEditingVoiceId] = useState('');
  const [editingVoiceName, setEditingVoiceName] = useState('');
  const [renamingVoiceId, setRenamingVoiceId] = useState('');
  const [assignModal, setAssignModal] = useState(null);

  useEffect(() => {
    const loadVoices = async () => {
      try {
        const [defaultRes, savedRes] = await Promise.all([
          fetch(apiPath('/api/default-voices')),
          fetch(apiPath('/api/saved_voices'))
        ]);
        const defaultData = await defaultRes.json();
        const savedData = await savedRes.json();

        if (defaultData?.success && defaultData?.voices) {
          setDefaultVoiceTree(buildSettingsVoiceTree(defaultData.voices));
        }
        setSavedVoices(Array.isArray(savedData?.voices) ? savedData.voices : []);
      } catch (e) {
        // ignore
      }
    };
    loadVoices();
  }, []);

  const languageChips = useMemo(() => {
    const langs = [];
    defaultVoiceTree.forEach((b) => {
      b.languages.forEach((l) => langs.push(l.language));
    });
    return sortUniqueLanguages(langs);
  }, [defaultVoiceTree]);

  const filteredVoiceTree = useMemo(() => {
    return defaultVoiceTree
      .filter((b) => genderFilter === 'all' || b.genderGroup === genderFilter)
      .map((b) => ({
        ...b,
        languages: b.languages.filter((l) => langFilter === 'all' || l.language === langFilter)
      }))
      .filter((b) => b.languages.length > 0);
  }, [defaultVoiceTree, genderFilter, langFilter]);

  const playPreview = async (voiceId) => {
    const savedApiKey = (window.localStorage.getItem(API_KEY_STORAGE_KEY) || '').trim();
    if (!savedApiKey) {
      alert('请先在左侧导航「API」中填写 API Key');
      return;
    }
    const featureOk = await ensureFeatureUnlocked();
    if (!featureOk) return;
    setPreviewLoadingVoiceId(voiceId);
    try {
      const res = await fetch(apiPath('/api/preview_voice'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          api_key: savedApiKey,
          voice_id: voiceId,
          text: previewText || '欢迎收听我的播客节目'
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || '试听失败');
      }
      const audioRes = await fetch(resolveMediaUrl(data.audio_url));
      const blob = await audioRes.blob();
      const objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(objectUrl);
      setPlayingVoiceId(voiceId);
      audio.onended = () => {
        setPlayingVoiceId('');
        URL.revokeObjectURL(objectUrl);
      };
      await audio.play();
    } catch (e) {
      alert(`试听失败：${e.message}`);
      setPlayingVoiceId('');
    } finally {
      setPreviewLoadingVoiceId('');
    }
  };

  const startRenameSavedVoice = (voice) => {
    setEditingVoiceId(voice.voiceId);
    setEditingVoiceName((voice.displayName || voice.voiceId || '').trim());
  };

  const cancelRenameSavedVoice = () => {
    setEditingVoiceId('');
    setEditingVoiceName('');
  };

  const submitRenameSavedVoice = async (voiceId) => {
    const normalizedName = (editingVoiceName || '').trim();
    if (!normalizedName) {
      alert('音色名称不能为空');
      return;
    }

    const updatedVoices = savedVoices.map((v) => (
      v.voiceId === voiceId ? { ...v, displayName: normalizedName } : v
    ));

    setRenamingVoiceId(voiceId);
    try {
      const res = await fetch(apiPath('/api/saved_voices'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voices: updatedVoices })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || '重命名失败');
      }
      setSavedVoices(updatedVoices);
      setEditingVoiceId('');
      setEditingVoiceName('');
    } catch (e) {
      alert(`重命名失败：${e.message}`);
    } finally {
      setRenamingVoiceId('');
    }
  };

  const sortedSavedVoices = [...savedVoices].sort((a, b) => {
    const aTs = a?.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
    const bTs = b?.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
    if (bTs !== aTs) return bTs - aTs;
    return String(a?.voiceId || '').localeCompare(String(b?.voiceId || ''));
  });

  const pageTitle = variant === 'catalog' ? '音色管理' : '🎧 音色管理';

  return (
    <div className="settings-panel">
      <div className="section">
        {!embedded && <h2>{pageTitle}</h2>}
        <div className="input-group">
          <label className="input-label">试听文案（默认10字）</label>
          <input
            type="text"
            value={previewText}
            onChange={(e) => setPreviewText(e.target.value)}
            placeholder="欢迎收听我的播客节目"
          />
        </div>

        {showCatalog && (
        <div className="speaker-config settings-catalog-card">
          <h3>我的克隆音色</h3>
          {sortedSavedVoices.length === 0 ? (
            <p className="input-description" style={{ marginTop: 0 }}>
              暂无。请前往「你的声音」录制或上传音频完成克隆后，将显示在此处并可在播客 / 文本转语音中选择。
            </p>
          ) : (
            <>
              <p className="input-description" style={{ marginTop: 0 }}>
                与「你的声音」页同步；可试听、重命名，或分配给 Speaker1 / Speaker2。
              </p>
              {sortedSavedVoices.map((v) => (
                <div key={v.voiceId} className="settings-voice-item">
                  <div className="settings-voice-main">
                    {editingVoiceId === v.voiceId ? (
                      <input
                        type="text"
                        value={editingVoiceName}
                        onChange={(e) => setEditingVoiceName(e.target.value)}
                        placeholder="请输入音色名称"
                      />
                    ) : (
                      <span>{v.displayName || v.voiceId}</span>
                    )}
                    <span className="input-description">{v.voiceId}</span>
                  </div>
                  <div className="settings-voice-actions">
                    <button
                      type="button"
                      className="api-key-clear-btn"
                      onClick={() => playPreview(v.voiceId)}
                      disabled={previewLoadingVoiceId === v.voiceId || renamingVoiceId === v.voiceId}
                    >
                      {playingVoiceId === v.voiceId ? '播放中...' : '试听'}
                    </button>
                    {editingVoiceId === v.voiceId ? (
                      <>
                        <button
                          type="button"
                          className="api-key-clear-btn"
                          onClick={() => submitRenameSavedVoice(v.voiceId)}
                          disabled={renamingVoiceId === v.voiceId}
                        >
                          {renamingVoiceId === v.voiceId ? '保存中...' : '保存'}
                        </button>
                        <button
                          type="button"
                          className="api-key-clear-btn"
                          onClick={cancelRenameSavedVoice}
                          disabled={renamingVoiceId === v.voiceId}
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="api-key-clear-btn"
                          onClick={() =>
                            setAssignModal({
                              kind: 'cloned',
                              voiceId: v.voiceId,
                              label: v.displayName || v.voiceId,
                            })
                          }
                          disabled={renamingVoiceId === v.voiceId}
                        >
                          使用
                        </button>
                        <button
                          type="button"
                          className="api-key-clear-btn"
                          onClick={() => startRenameSavedVoice(v)}
                          disabled={renamingVoiceId === v.voiceId}
                        >
                          重命名
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
        )}

        {showCatalog && (
        <div className="speaker-config settings-catalog-card">
          <h3>默认音色</h3>
          <p className="input-description" style={{ marginTop: 0 }}>
            使用下方筛选缩小范围；分类默认折叠，点击标题展开。悬停条目可看完整说明。点击「使用」可将该预设分配给 Speaker1 或 Speaker2，并出现在「播客生成 → 选择音色」的下拉中（Mini / Max 始终可选）。
          </p>

          <div className="settings-voice-filter-wrap">
            <div className="settings-voice-filter-row">
              <span className="settings-voice-filter-label">性别</span>
              <div className="settings-voice-filter-chips">
                {GENDER_FILTER_ITEMS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`settings-voice-filter-chip ${genderFilter === item.id ? 'is-active' : ''}`}
                    onClick={() => setGenderFilter(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-voice-filter-row">
              <span className="settings-voice-filter-label">语言</span>
              <div className="settings-voice-filter-chips settings-voice-filter-chips-scroll">
                <button
                  type="button"
                  className={`settings-voice-filter-chip ${langFilter === 'all' ? 'is-active' : ''}`}
                  onClick={() => setLangFilter('all')}
                >
                  全部
                </button>
                {languageChips.map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    className={`settings-voice-filter-chip ${langFilter === lang ? 'is-active' : ''}`}
                    onClick={() => setLangFilter(lang)}
                    title={lang}
                  >
                    {getLanguageShortLabel(lang)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="settings-voice-tree">
            {filteredVoiceTree.length === 0 && (
              <p className="input-description settings-voice-filter-empty">当前筛选下无音色，请调整筛选条件。</p>
            )}
            {filteredVoiceTree.map((block) => {
              const genderCount = block.languages.reduce((n, l) => n + l.voices.length, 0);
              return (
                <details key={block.genderGroup} className="settings-voice-details settings-voice-details-gender">
                  <summary className="settings-voice-details-summary">
                    <span className="settings-voice-details-summary-text">{block.genderTitle}</span>
                    <span className="settings-voice-details-count">{genderCount}</span>
                  </summary>
                  <div className="settings-voice-details-body">
                    {block.languages.map((langBlock) => (
                      <details
                        key={`${block.genderGroup}-${langBlock.language}`}
                        className="settings-voice-details settings-voice-details-lang"
                      >
                        <summary className="settings-voice-details-summary settings-voice-details-summary-lang">
                          <span className="settings-voice-details-summary-text">{langBlock.langTitle}</span>
                          <span className="settings-voice-details-count">{langBlock.voices.length}</span>
                        </summary>
                        <div className="settings-voice-lang-rows settings-voice-lang-rows-nested">
                          {langBlock.voices.map((m) => (
                            <div
                              key={m.key}
                              className="settings-voice-compact-row"
                              title={m.optionTitle}
                            >
                              <span className="settings-voice-compact-name">{m.typeShort}</span>
                              <div className="settings-voice-compact-actions">
                                <button
                                  type="button"
                                  className="api-key-clear-btn settings-voice-compact-preview"
                                  onClick={() => playPreview(m.voiceId)}
                                  disabled={previewLoadingVoiceId === m.voiceId || !m.voiceId}
                                >
                                  {playingVoiceId === m.voiceId ? '播放中' : '试听'}
                                </button>
                                <button
                                  type="button"
                                  className="api-key-clear-btn settings-voice-compact-use"
                                  onClick={() =>
                                    setAssignModal({
                                      kind: 'preset',
                                      key: m.key,
                                      label: m.typeShort || m.key
                                    })
                                  }
                                >
                                  使用
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </details>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        </div>
        )}
      </div>

      {assignModal && (
        <div
          className="voice-rename-modal-mask"
          onClick={() => setAssignModal(null)}
          role="presentation"
        >
          <div
            className="voice-rename-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="assign-voice-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="assign-voice-dialog-title">分配给说话人</h3>
            <p className="voice-rename-modal-subtitle">
              {assignModal.kind === 'preset'
                ? `将「${assignModal.label}」设为 Speaker1 或 Speaker2 的默认预设音色，并加入生成页「选择音色」下拉列表。`
                : `将已克隆音色「${assignModal.label}」分配给 Speaker1 或 Speaker2；生成页将切换为「自定义音色」并选中该音色 ID。`}
            </p>
            <div className="voice-rename-modal-actions">
              <button
                type="button"
                className="generate-btn"
                onClick={() => {
                  if (assignModal.kind === 'preset') {
                    assignPresetToSpeaker('speaker1', assignModal.key);
                  } else {
                    assignClonedVoiceToSpeaker('speaker1', assignModal.voiceId);
                  }
                  setAssignModal(null);
                }}
              >
                Speaker1
              </button>
              <button
                type="button"
                className="generate-btn"
                onClick={() => {
                  if (assignModal.kind === 'preset') {
                    assignPresetToSpeaker('speaker2', assignModal.key);
                  } else {
                    assignClonedVoiceToSpeaker('speaker2', assignModal.voiceId);
                  }
                  setAssignModal(null);
                }}
              >
                Speaker2
              </button>
              <button type="button" className="api-key-clear-btn" onClick={() => setAssignModal(null)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsPanel;
