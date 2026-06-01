"use client";

import FingerprintJS from "@fingerprintjs/fingerprintjs";

const DEVICE_STORAGE = "fym_device_id_v1";
const FINGERPRINT_WAIT_MS = 4000;

export type DeviceIdResult = {
  deviceId: string;
};

let loadPromise: ReturnType<typeof FingerprintJS.load> | null = null;
let memoryCache: DeviceIdResult | null = null;

function readPersistedDeviceId(): string {
  try {
    return String(localStorage.getItem(DEVICE_STORAGE) || "").trim();
  } catch {
    return "";
  }
}

function persistDeviceId(id: string): void {
  try {
    localStorage.setItem(DEVICE_STORAGE, id);
  } catch {
    // ignore
  }
}

function newLocalDeviceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `d_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
}

async function computeBrowserDeviceId(): Promise<string | null> {
  if (!loadPromise) {
    loadPromise = FingerprintJS.load();
  }
  const agent = await loadPromise;
  const { visitorId } = await agent.get();
  const id = String(visitorId || "").trim();
  return id.length >= 8 ? id : null;
}

async function resolveNewDeviceId(): Promise<string> {
  try {
    const fpId = await Promise.race([
      computeBrowserDeviceId(),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), FINGERPRINT_WAIT_MS);
      })
    ]);
    if (fpId) return fpId;
  } catch {
    // 指纹库加载失败时用本地持久化 ID（仍按设备维度去重，不用 Cookie）
  }
  return newLocalDeviceId();
}

/**
 * 浏览器设备 ID：优先指纹库，失败则 localStorage 持久化随机 ID；无需 API Key。
 */
export async function getDeviceId(): Promise<DeviceIdResult> {
  if (memoryCache) return memoryCache;

  let id = readPersistedDeviceId();
  if (id.length < 8) {
    id = await resolveNewDeviceId();
    persistDeviceId(id);
  }

  memoryCache = { deviceId: id };
  return memoryCache;
}
