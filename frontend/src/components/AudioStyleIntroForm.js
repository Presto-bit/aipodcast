import React from 'react';

/** 与 PodcastGenerator 中 GroupedDefaultVoiceSelect 一致 */
export function GroupedDefaultVoiceSelect({ groups, value, onChange, id, className }) {
  if (!groups || groups.length === 0) return null;
  return (
    <select
      id={id}
      className={`default-voice-grouped-select ${className || ''}`}
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

/**
 * 与 AI 播客页「开场结尾配置」同结构；背景音等仅与播客成片同步，TTS 仅使用文案与音色路由。
 */
export default function AudioStyleIntroForm({
  defaultVoiceGroups,
  savedCustomVoices,
  savedBgms,
  audioStylePresets,
  selectedAudioStylePresetId,
  setSelectedAudioStylePresetId,
  onLoadPreset,
  onSavePreset,
  introText,
  setIntroText,
  endingText,
  setEndingText,
  introVoiceMode,
  setIntroVoiceMode,
  introVoiceName,
  setIntroVoiceName,
  introCustomVoiceId,
  setIntroCustomVoiceId,
  endingVoiceMode,
  setEndingVoiceMode,
  endingVoiceName,
  setEndingVoiceName,
  endingCustomVoiceId,
  setEndingCustomVoiceId,
  introBgm1Mode,
  setIntroBgm1Mode,
  introBgm1SavedId,
  setIntroBgm1SavedId,
  introBgm2Mode,
  setIntroBgm2Mode,
  introBgm2SavedId,
  setIntroBgm2SavedId,
  endingBgm1Mode,
  setEndingBgm1Mode,
  endingBgm1SavedId,
  setEndingBgm1SavedId,
  endingBgm2Mode,
  setEndingBgm2Mode,
  endingBgm2SavedId,
  setEndingBgm2SavedId,
  introBgm1File,
  setIntroBgm1File,
  introBgm2File,
  setIntroBgm2File,
  endingBgm1File,
  setEndingBgm1File,
  endingBgm2File,
  setEndingBgm2File,
  handleBgmFileChange,
}) {
  return (
    <div className="audio-style-intro-form">
      <p className="tts-audio-style-scope-note input-description">
        与「AI 播客」页开场结尾配置共用本地保存。文本转语音仅合成语音轨；背景音与多轨混音在播客成片流程中生效。
      </p>
      <div className="input-group">
        <p className="input-description" style={{ marginTop: 10 }}>
          默认按「背景音1+开头语+背景音2+主体内容+结束背景音1」拼接；可直接在本页修改参数。
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
          <button type="button" className="api-key-clear-btn" onClick={onLoadPreset} disabled={!audioStylePresets.length}>
            加载配置
          </button>
          <button type="button" className="api-key-clear-btn" onClick={onSavePreset}>
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
                id="tts-intro-default-voice"
              />
            )}
            {introVoiceMode === 'custom' && (
              <select value={introCustomVoiceId} onChange={(e) => setIntroCustomVoiceId(e.target.value)}>
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
                  <option key={bgm.bgmId} value={bgm.bgmId}>
                    {bgm.label || bgm.fileName}
                  </option>
                ))}
              </select>
            )}
            {introBgm1Mode === 'upload' && (
              <div className="file-upload">
                <label htmlFor="tts-intro-bgm1-upload" className="upload-label">
                  {introBgm1File ? introBgm1File.name : '上传开场背景音1'}
                </label>
                <input
                  id="tts-intro-bgm1-upload"
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
                  <option key={bgm.bgmId} value={bgm.bgmId}>
                    {bgm.label || bgm.fileName}
                  </option>
                ))}
              </select>
            )}
            {introBgm2Mode === 'upload' && (
              <div className="file-upload">
                <label htmlFor="tts-intro-bgm2-upload" className="upload-label">
                  {introBgm2File ? introBgm2File.name : '上传开场背景音2'}
                </label>
                <input
                  id="tts-intro-bgm2-upload"
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
                id="tts-ending-default-voice"
              />
            )}
            {endingVoiceMode === 'custom' && (
              <select value={endingCustomVoiceId} onChange={(e) => setEndingCustomVoiceId(e.target.value)}>
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
                  <option key={bgm.bgmId} value={bgm.bgmId}>
                    {bgm.label || bgm.fileName}
                  </option>
                ))}
              </select>
            )}
            {endingBgm1Mode === 'upload' && (
              <div className="file-upload">
                <label htmlFor="tts-ending-bgm1-upload" className="upload-label">
                  {endingBgm1File ? endingBgm1File.name : '上传结尾背景音1'}
                </label>
                <input
                  id="tts-ending-bgm1-upload"
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
                  <option key={bgm.bgmId} value={bgm.bgmId}>
                    {bgm.label || bgm.fileName}
                  </option>
                ))}
              </select>
            )}
            {endingBgm2Mode === 'upload' && (
              <div className="file-upload">
                <label htmlFor="tts-ending-bgm2-upload" className="upload-label">
                  {endingBgm2File ? endingBgm2File.name : '上传结尾背景音2'}
                </label>
                <input
                  id="tts-ending-bgm2-upload"
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
  );
}
