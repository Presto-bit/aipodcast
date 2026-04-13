export type BgmUiMode = "none" | "preset_bgm01" | "preset_bgm02" | "upload";

export async function fileToMp3Hex(file: File): Promise<string | undefined> {
  if (file.size > 2_800_000) return undefined;
  const buf = await file.arrayBuffer();
  const u8 = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < u8.length; i++) hex += u8[i]!.toString(16).padStart(2, "0");
  return hex;
}

export async function bgmSegmentPayload(
  mode: BgmUiMode,
  file: File | null
): Promise<{ slot?: string; mp3_hex?: string }> {
  return bgmSegmentPayloadFromState(mode, file, null);
}

/**
 * 与 {@link bgmSegmentPayload} 相同，但若本地上传且未选文件，可使用上次保存的 hex（如从预设恢复）。
 */
export async function bgmSegmentPayloadFromState(
  mode: BgmUiMode,
  file: File | null,
  storedHex: string | null | undefined
): Promise<{ slot?: string; mp3_hex?: string }> {
  if (mode === "none") return {};
  if (mode === "preset_bgm01") return { slot: "bgm01" };
  if (mode === "preset_bgm02") return { slot: "bgm02" };
  if (mode === "upload") {
    if (file) {
      const hex = await fileToMp3Hex(file);
      if (hex) return { mp3_hex: hex };
    }
    const h = storedHex?.trim();
    if (h && /^[0-9a-fA-F]+$/.test(h)) return { mp3_hex: h };
  }
  return {};
}
