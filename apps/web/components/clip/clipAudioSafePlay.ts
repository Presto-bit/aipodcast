/** 等待 canplay 后再 play，处理 NotAllowedError 静音回退。 */
export function safePlayAudioElement(
  el: HTMLAudioElement,
  onError?: (message: string) => void,
  playToken?: { current: number }
): void {
  const token = playToken ? ++playToken.current : 0;
  const fail = (err?: unknown) => {
    if (playToken && token !== playToken.current) return;
    const name = err && typeof err === "object" && "name" in err ? String((err as { name?: string }).name) : "";
    if (name === "AbortError") return;
    onError?.("无法播放音频");
  };
  const tryPlay = () => {
    if (playToken && token !== playToken.current) return;
    void el.play().catch((err) => {
      const name = err && typeof err === "object" && "name" in err ? String((err as { name?: string }).name) : "";
      if (name === "NotAllowedError") {
        const prevMuted = el.muted;
        el.muted = true;
        const onPlaying = () => {
          el.muted = prevMuted;
          el.removeEventListener("playing", onPlaying);
        };
        el.addEventListener("playing", onPlaying, { once: true });
        void el.play().catch((e2) => {
          el.removeEventListener("playing", onPlaying);
          el.muted = prevMuted;
          fail(e2);
        });
        return;
      }
      fail(err);
    });
  };
  if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    tryPlay();
  } else {
    const onCanPlay = () => {
      el.removeEventListener("error", onErr);
      tryPlay();
    };
    const onErr = () => {
      el.removeEventListener("canplay", onCanPlay);
      fail();
    };
    el.addEventListener("canplay", onCanPlay, { once: true });
    el.addEventListener("error", onErr, { once: true });
  }
}
