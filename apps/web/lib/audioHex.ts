/** MP3 hex string (from orchestrator jobs) → data URL for <audio>. */
export function hexToMp3DataUrl(hex: string): string {
  const clean = (hex || "").trim();
  if (!clean) return "";
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
  return `data:audio/mp3;base64,${btoa(binary)}`;
}
