"use client";

import FingerprintJS from "@fingerprintjs/fingerprintjs";

const DEVICE_STORAGE = "fym_device_id_v1";

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

async function computeBrowserDeviceId(): Promise<string | null> {
  if (!loadPromise) {
    loadPromise = FingerprintJS.load();
  }
  const agent = await loadPromise;
  const { visitorId } = await agent.get();
  const id = String(visitorId || "").trim();
  return id.length >= 8 ? id : null;
}

/**
 * 浏览器设备 ID：基于开源指纹库在本地生成并持久化，无需任何 API Key。
 */
export async function getDeviceId(): Promise<DeviceIdResult | null> {
  if (memoryCache) return memoryCache;

  let id = readPersistedDeviceId();
  if (id.length < 8) {
    id = (await computeBrowserDeviceId()) || "";
    if (id.length >= 8) persistDeviceId(id);
  }
  if (id.length < 8) return null;

  memoryCache = { deviceId: id };
  return memoryCache;
}
