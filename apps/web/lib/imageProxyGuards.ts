/**
 * /api/image-proxy 安全：阻断常见 SSRF 目标，并校验响应为图片。
 */

/** 拒绝解析为私网/保留/元数据等地址（仅基于 URL 字符串，无法防御 DNS 重绑定） */
export function isImageProxyUrlBlocked(url: URL): boolean {
  const host = url.hostname.toLowerCase();

  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return true;
  }
  if (host === "metadata.google.internal" || host === "metadata") {
    return true;
  }

  if (host.includes(":")) {
    return isBlockedIpv6Literal(host);
  }

  return isBlockedIpv4Literal(host);
}

function isBlockedIpv4Literal(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const d = Number(m[4]);
  if ([a, b, c, d].some((x) => !Number.isFinite(x) || x < 0 || x > 255)) return true;

  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 88 && c === 99) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return false;
}

function isBlockedIpv6Literal(host: string): boolean {
  let h = host;
  if (h.startsWith("[") && h.endsWith("]")) {
    h = h.slice(1, -1);
  }
  const lower = h.toLowerCase();
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true;
  if (lower.startsWith("fe80:")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("::ffff:")) {
    const v4 = lower.slice("::ffff:".length);
    return isBlockedIpv4Literal(v4);
  }
  return false;
}

/**
 * `IMAGE_PROXY_HOST_SUFFIXES` 环境变量：逗号分隔主机名后缀；任一非空则仅允许匹配该列表的主机。
 * 例：`amazonaws.com,cloudfront.net,storage.googleapis.com`
 */
export function parseImageProxyHostSuffixes(raw: string | undefined): string[] {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isImageProxyHostAllowedBySuffixList(hostname: string, suffixes: string[]): boolean {
  if (suffixes.length === 0) return true;
  const h = hostname.toLowerCase();
  return suffixes.some((pat) => {
    const p = pat.trim().toLowerCase();
    if (!p) return false;
    return h === p || h.endsWith(`.${p}`);
  });
}

const IMAGE_CT_PREFIX = "image/";

/** 校验 Content-Type 或魔数为常见图片格式 */
export function validateImageProxyBody(buf: ArrayBuffer, contentTypeHeader: string | null): { ok: boolean; contentType: string } {
  const ct = (contentTypeHeader || "").split(";")[0]?.trim().toLowerCase() || "";
  if (ct.startsWith(IMAGE_CT_PREFIX)) {
    return { ok: true, contentType: ct };
  }

  const u8 = new Uint8Array(buf);
  if (u8.length < 12) {
    return { ok: false, contentType: "application/octet-stream" };
  }

  if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) {
    return { ok: true, contentType: "image/jpeg" };
  }
  if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) {
    return { ok: true, contentType: "image/png" };
  }
  if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x38) {
    return { ok: true, contentType: "image/gif" };
  }
  if (u8.length >= 12 && u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46) {
    const webp = String.fromCharCode(u8[8]!, u8[9]!, u8[10]!, u8[11]!);
    if (webp === "WEBP") {
      return { ok: true, contentType: "image/webp" };
    }
  }

  return { ok: false, contentType: "application/octet-stream" };
}
