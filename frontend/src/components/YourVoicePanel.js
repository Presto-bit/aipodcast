import React, { useRef, useState } from 'react';
import { useAuth } from '../AuthContext';
import { apiPath } from '../apiBaseUrl';
import './YourVoicePanel.css';

const API_KEY_STORAGE_KEY = 'minimax_aipodcast_api_key';
const DEFAULT_API_KEY = process.env.REACT_APP_DEFAULT_API_KEY || '';

function getStoredApiKey() {
  try {
    const s = (window.localStorage.getItem(API_KEY_STORAGE_KEY) || '').trim();
    if (s) return s;
  } catch (e) {
    // ignore
  }
  return (DEFAULT_API_KEY || '').trim();
}

const MAX_BYTES = 20 * 1024 * 1024;

const DIALOGUE_HELP = [
  '在安静环境录制，避免回声与背景噪声。',
  '建议连续朗读 15～60 秒，口齿清晰、音量稳定。',
  '录制完成后点击「克隆声音」，将消耗 MiniMax 音色克隆额度。',
];

const UPLOAD_HELP = [
  '支持常见格式：wav / mp3 / m4a / flac / ogg / aac / webm 等，单文件最大 20MB。',
  '音频需包含至少约 10 秒有效人声（服务端会校验时长）。',
  '克隆成功后音色会出现在「音色管理」及所有音色下拉中。',
];

function YourVoicePanel({ compact = false } = {}) {
  const { ensureFeatureUnlocked, getAuthHeaders } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [cloneLoading, setCloneLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const fileRef = useRef(null);

  const postClone = async (blob, filename) => {
    const k = getStoredApiKey();
    if (!k) {
      alert('请先在左侧「API」页面配置 MiniMax API Key');
      return;
    }
    if (blob.size > MAX_BYTES) {
      alert('文件过大，最大 20MB');
      return;
    }
    const featureOk = await ensureFeatureUnlocked();
    if (!featureOk) return;
    setCloneLoading(true);
    setMsg('');
    try {
      const fd = new FormData();
      fd.append('audio', blob, filename);
      fd.append('api_key', k);
      if (displayName.trim()) fd.append('display_name', displayName.trim());
      const res = await fetch(apiPath('/api/voice_clone'), {
        method: 'POST',
        body: fd,
        headers: getAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || `请求失败 ${res.status}`);
      }
      setMsg(`克隆成功：${data.displayName || data.voice_id}（ID: ${data.voice_id}）`);
    } catch (e) {
      alert(e.message || String(e));
    } finally {
      setCloneLoading(false);
    }
  };

  const startRecord = async () => {
    setMsg('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.start(200);
      setRecording(true);
    } catch (e) {
      alert(`无法访问麦克风：${e.message || e}`);
    }
  };

  const stopRecordAndClone = async () => {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state === 'inactive') {
      setRecording(false);
      return;
    }
    await new Promise((resolve) => {
      mr.addEventListener('stop', resolve, { once: true });
      mr.stop();
    });
    const stream = streamRef.current;
    if (stream) {
      try {
        stream.getTracks().forEach((t) => t.stop());
      } catch (err) {
        // ignore
      }
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    setRecording(false);
    const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || 'audio/webm' });
    chunksRef.current = [];
    if (!blob.size) {
      alert('未录制到有效音频');
      return;
    }
    const ext = blob.type.includes('webm') ? 'webm' : 'wav';
    await postClone(blob, `record_${Date.now()}.${ext}`);
  };

  const onPickFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > MAX_BYTES) {
      alert('文件过大，最大 20MB');
      return;
    }
    await postClone(f, f.name || 'upload.wav');
  };

  return (
    <div className="your-voice-page">
      {!compact && (
        <div className="section your-voice-hero">
          <h1 className="your-voice-title">你的声音</h1>
          <p className="your-voice-sub">克隆后可在一键播客、文本转语音等所有音色选择处使用。</p>
          <div className="your-voice-name-row">
            <label htmlFor="yv-display-name">显示名称（可选）</label>
            <input
              id="yv-display-name"
              type="text"
              placeholder="例如：我的播客声线"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="your-voice-grid">
        <section className="your-voice-card">
          <h2>对话克隆</h2>
          <p className="your-voice-lead">按下录音，朗读任意一段中文或英文，停止后一键克隆。</p>
          <ul className="your-voice-help">
            {DIALOGUE_HELP.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <div className="your-voice-actions">
            {!recording ? (
              <button type="button" className="your-voice-btn primary" disabled={cloneLoading} onClick={startRecord}>
                开始录音
              </button>
            ) : (
              <button type="button" className="your-voice-btn danger" disabled={cloneLoading} onClick={stopRecordAndClone}>
                停止并克隆
              </button>
            )}
          </div>
          {recording && <p className="your-voice-rec-hint">录音中… 再次点击「停止并克隆」结束。</p>}
        </section>

        <section className="your-voice-card">
          <h2>上传文件克隆</h2>
          <p className="your-voice-lead">选择本地音频文件，由服务端上传并完成克隆。</p>
          <ul className="your-voice-help">
            {UPLOAD_HELP.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <div className="your-voice-actions">
            <input
              ref={fileRef}
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg,.aac,.webm,.mp4"
              className="your-voice-file-input"
              onChange={onPickFile}
            />
            <button
              type="button"
              className="your-voice-btn primary"
              disabled={cloneLoading}
              onClick={() => fileRef.current?.click()}
            >
              选择文件并克隆
            </button>
          </div>
        </section>
      </div>

      {cloneLoading && <p className="your-voice-status">处理中，请稍候…</p>}
      {msg && <p className="your-voice-success">{msg}</p>}
    </div>
  );
}

export default YourVoicePanel;
