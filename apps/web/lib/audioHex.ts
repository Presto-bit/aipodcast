/** MP3 hex string (from orchestrator jobs) → data URL for <audio>. */
export function hexToMp3DataUrl(hex: string): string {
  const clean = (hex || "").trim();
  if (!clean || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) return "";
  const byteLen = clean.length / 2;
  const bytes = new Uint8Array(byteLen);
  for (let i = 0; i < byteLen; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  // IANA 类型为 audio/mpeg；部分浏览器对 data:audio/mp3 报「不支持的视频源」
  return `data:audio/mpeg;base64,${btoa(binary)}`;
}
