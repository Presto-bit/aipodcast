/** 剪辑页 AudioConsole 驱动的隐藏 audio transport imperative 句柄。 */
export type ClipAudioHandle = {
  /** opts.snap 保留供跳转定位 API 兼容；transport 实现可忽略磁吸参数 */
  seekToMs: (ms: number, opts?: { snap?: boolean }) => void;
  playPause: () => void;
  pause: () => void;
  play: () => Promise<void>;
  /** 最近一次 timeupdate 的毫秒（无解码时可能为 0） */
  getCurrentTimeMs: () => number;
  setPlaybackRate: (rate: number) => void;
  /** 历史兼容：无波形 UI 时为 no-op */
  setZoom: (level: number) => void;
  setVolume: (volume: number) => void;
};
