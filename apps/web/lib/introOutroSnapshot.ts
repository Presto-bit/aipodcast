/**
 * 开场/结尾面板可序列化快照（文本、跟随与自定义音色 key、BGM 模式与可选上传 hex）。
 */
import type { BgmUiMode } from "./bgmUpload";
import { fileToMp3Hex } from "./bgmUpload";

export const INTRO_OUTRO_SNAPSHOT_VERSION = 1 as const;

/** 单段 hex 上限，避免撑爆 localStorage（过长则保存时丢弃该段） */
export const INTRO_OUTRO_HEX_MAX_CHARS = 900_000;

export type IntroOutroSnapshotV1 = {
  v: typeof INTRO_OUTRO_SNAPSHOT_VERSION;
  introText: string;
  outroText: string;
  introVoiceFollow: boolean;
  introVoiceKey: string;
  outroVoiceFollow: boolean;
  outroVoiceKey: string;
  introBgm1Mode: BgmUiMode;
  introBgm2Mode: BgmUiMode;
  outroBgm3Mode: BgmUiMode;
  introBgm1Hex?: string;
  introBgm2Hex?: string;
  outroBgm3Hex?: string;
};

function clampHex(hex: string | undefined): string | undefined {
  if (!hex || !/^[0-9a-fA-F]+$/.test(hex)) return undefined;
  if (hex.length > INTRO_OUTRO_HEX_MAX_CHARS) return undefined;
  return hex;
}

async function hexFromUpload(mode: BgmUiMode, file: File | null, existingHex: string | null): Promise<string | undefined> {
  if (mode !== "upload") return undefined;
  if (file) {
    const h = await fileToMp3Hex(file);
    return clampHex(h);
  }
  return clampHex(existingHex ?? undefined);
}

export function isIntroOutroSnapshotV1(x: unknown): x is IntroOutroSnapshotV1 {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.v !== 1) return false;
  return (
    typeof o.introText === "string" &&
    typeof o.outroText === "string" &&
    typeof o.introVoiceFollow === "boolean" &&
    typeof o.introVoiceKey === "string" &&
    typeof o.outroVoiceFollow === "boolean" &&
    typeof o.outroVoiceKey === "string" &&
    typeof o.introBgm1Mode === "string" &&
    typeof o.introBgm2Mode === "string" &&
    typeof o.outroBgm3Mode === "string"
  );
}

export type IntroOutroSnapshotInput = {
  introText: string;
  outroText: string;
  introVoiceFollow: boolean;
  introVoiceKey: string;
  outroVoiceFollow: boolean;
  outroVoiceKey: string;
  introBgm1Mode: BgmUiMode;
  introBgm2Mode: BgmUiMode;
  outroBgm3Mode: BgmUiMode;
  introBgm1File: File | null;
  introBgm2File: File | null;
  outroBgm3File: File | null;
  introBgm1StoredHex: string | null;
  introBgm2StoredHex: string | null;
  outroBgm3StoredHex: string | null;
};

export async function buildIntroOutroSnapshot(input: IntroOutroSnapshotInput): Promise<IntroOutroSnapshotV1> {
  const [h1, h2, h3] = await Promise.all([
    hexFromUpload(input.introBgm1Mode, input.introBgm1File, input.introBgm1StoredHex),
    hexFromUpload(input.introBgm2Mode, input.introBgm2File, input.introBgm2StoredHex),
    hexFromUpload(input.outroBgm3Mode, input.outroBgm3File, input.outroBgm3StoredHex)
  ]);
  const snap: IntroOutroSnapshotV1 = {
    v: 1,
    introText: input.introText,
    outroText: input.outroText,
    introVoiceFollow: input.introVoiceFollow,
    introVoiceKey: input.introVoiceKey,
    outroVoiceFollow: input.outroVoiceFollow,
    outroVoiceKey: input.outroVoiceKey,
    introBgm1Mode: input.introBgm1Mode,
    introBgm2Mode: input.introBgm2Mode,
    outroBgm3Mode: input.outroBgm3Mode
  };
  if (h1) snap.introBgm1Hex = h1;
  if (h2) snap.introBgm2Hex = h2;
  if (h3) snap.outroBgm3Hex = h3;
  return snap;
}

export type IntroOutroImportResult =
  | { kind: "apply"; snapshot: IntroOutroSnapshotV1 }
  | { kind: "add_named"; label: string; snapshot: IntroOutroSnapshotV1 }
  | { kind: "many_named"; items: { label: string; snapshot: IntroOutroSnapshotV1 }[] };

/** 解析导出的 JSON：支持裸快照、包一层 snapshot、或带 label 的命名预设 / presets 数组 */
export function parseIntroOutroImportJson(raw: unknown): IntroOutroImportResult | null {
  if (raw === null || typeof raw !== "object") return null;
  const rootObj = raw as Record<string, unknown>;

  if (rootObj.kind === "intro_outro_export_v1" && rootObj.snapshot && typeof rootObj.snapshot === "object") {
    const snap = extractSnapshot(rootObj.snapshot as Record<string, unknown>);
    if (!snap) return null;
    const label = typeof rootObj.label === "string" ? rootObj.label.trim() : "";
    if (label) return { kind: "add_named", label, snapshot: snap };
    return { kind: "apply", snapshot: snap };
  }

  const root = rootObj;
  if (Array.isArray(root.presets)) {
    const items: { label: string; snapshot: IntroOutroSnapshotV1 }[] = [];
    for (const row of root.presets) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const label = typeof o.label === "string" ? o.label.trim() : "";
      const snap = extractSnapshot(o);
      if (label && snap) items.push({ label, snapshot: snap });
    }
    return items.length ? { kind: "many_named", items } : null;
  }

  const labeled = typeof root.label === "string" ? root.label.trim() : "";
  const snap =
    extractSnapshot(root) ||
    (root.snapshot && typeof root.snapshot === "object" ? extractSnapshot(root.snapshot as Record<string, unknown>) : null);
  if (!snap) return null;
  if (labeled) return { kind: "add_named", label: labeled, snapshot: snap };
  return { kind: "apply", snapshot: snap };
}

function extractSnapshot(o: Record<string, unknown>): IntroOutroSnapshotV1 | null {
  if (!isIntroOutroSnapshotV1(o)) return null;
  return {
    v: 1,
    introText: o.introText,
    outroText: o.outroText,
    introVoiceFollow: o.introVoiceFollow,
    introVoiceKey: o.introVoiceKey,
    outroVoiceFollow: o.outroVoiceFollow,
    outroVoiceKey: o.outroVoiceKey,
    introBgm1Mode: o.introBgm1Mode,
    introBgm2Mode: o.introBgm2Mode,
    outroBgm3Mode: o.outroBgm3Mode,
    introBgm1Hex: o.introBgm1Hex,
    introBgm2Hex: o.introBgm2Hex,
    outroBgm3Hex: o.outroBgm3Hex
  };
}
