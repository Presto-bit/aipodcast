/**
 * 浏览器 localStorage / sessionStorage 按当前登录账号隔离，避免同机多账号串数据。
 * 在 AuthProvider 中通过 setStorageAccountSync 与 user 同步（useLayoutEffect）。
 */

const SCOPE_SEP = "::u::";

type UserLike = { user_id?: string; phone?: string; email?: string; username?: string };

let _accountKey = "anon";

/**
 * 与知识库对话、业务缓存等使用的账号键一致（user_id 优先，否则 phone 等）。
 */
export function accountKeyFromUser(user: UserLike | null): string {
  if (!user) return "anon";
  if (user.phone === "local" && !user.user_id) return "anon";
  const uid = typeof user.user_id === "string" ? user.user_id.trim() : "";
  if (uid) return uid;
  const ph = typeof user.phone === "string" ? user.phone.trim() : "";
  if (ph && ph !== "local") return ph;
  const em = typeof user.email === "string" ? user.email.trim() : "";
  if (em) return em;
  const un = typeof user.username === "string" ? user.username.trim() : "";
  if (un) return un;
  return "anon";
}

export function setStorageAccountSync(accountKey: string): void {
  _accountKey = (accountKey || "").trim() || "anon";
}

export function getStorageAccountKey(): string {
  return _accountKey;
}

/** 物理键名：baseKey + ::u:: + encodeURIComponent(account) */
export function storageKeyScoped(baseKey: string): string {
  return `${baseKey}${SCOPE_SEP}${encodeURIComponent(getStorageAccountKey())}`;
}

export function readLocalStorageScoped(baseKey: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const s = window.localStorage.getItem(storageKeyScoped(baseKey));
    if (s !== null) return s;
    const leg = window.localStorage.getItem(baseKey);
    if (leg !== null) {
      window.localStorage.setItem(storageKeyScoped(baseKey), leg);
      window.localStorage.removeItem(baseKey);
    }
    return leg;
  } catch {
    return null;
  }
}

export function writeLocalStorageScoped(baseKey: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKeyScoped(baseKey), value);
  } catch {
    // quota
  }
}

export function removeLocalStorageScoped(baseKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKeyScoped(baseKey));
    window.localStorage.removeItem(baseKey);
  } catch {
    // ignore
  }
}

export function readSessionStorageScoped(baseKey: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const s = window.sessionStorage.getItem(storageKeyScoped(baseKey));
    if (s !== null) return s;
    const leg = window.sessionStorage.getItem(baseKey);
    if (leg !== null) {
      window.sessionStorage.setItem(storageKeyScoped(baseKey), leg);
      window.sessionStorage.removeItem(baseKey);
    }
    return leg;
  } catch {
    return null;
  }
}

export function writeSessionStorageScoped(baseKey: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKeyScoped(baseKey), value);
  } catch {
    // ignore
  }
}

export function removeSessionStorageScoped(baseKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKeyScoped(baseKey));
    window.sessionStorage.removeItem(baseKey);
  } catch {
    // ignore
  }
}
