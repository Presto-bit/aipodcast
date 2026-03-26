/**
 * 解析后端 API 根地址（无末尾斜杠）。
 *
 * 1) 优先使用 REACT_APP_API_URL
 * 2) CRA「npm start」常见 3000/3001：package.json 的 proxy 对流式 POST（如文案生成 SSE）易 404，
 *    故无 env 时也直连「当前 hostname + :5001」（需 Flask 已开 CORS）
 * 3) python http.server / Live Server 等端口同上
 * 4) 其它情况返回 ''，由 Nginx 等同源反代处理
 */
export function getApiBaseUrl() {
  const fromEnv = (process.env.REACT_APP_API_URL || '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;

  if (typeof window === 'undefined') return '';

  const port = window.location.port;
  const proto = window.location.protocol || 'http:';
  const host = window.location.hostname || 'localhost';

  // 直连后端 :5001 时，多数开发/本地后端为 http。
  // 若页面运行在 https（例如静态站 https 部署），直接用 https://host:5001 会触发证书/握手失败，表现为 Failed to fetch。
  const directProto = proto === 'https:' ? 'http:' : proto;

  // CRA 开发服务器：避免走 devServer proxy 导致 /api/generate_script_draft 等流式接口 404
  const craDevPorts = ['3000', '3001'];
  if (craDevPorts.includes(port)) {
    return `${directProto}//${host}:5001`;
  }

  const staticDevPorts = ['8000', '8080', '5500', '5501', '4173', '8888'];
  if (staticDevPorts.includes(port)) {
    return `${directProto}//${host}:5001`;
  }

  return '';
}

/**
 * 拼接可请求的 API 完整 URL。path 须以 / 开头，例如 apiPath('/api/ping')。
 * 全站统一用此函数，避免各组件手写 `${base}/api/...` 导致联调时漏写或双斜杠。
 */
export function apiPath(path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${getApiBaseUrl()}${p}`;
}

/**
 * 将后端返回的相对资源路径转为完整 URL（已是 http(s) 则原样返回）。
 */
export function resolveMediaUrl(maybeUrl) {
  if (!maybeUrl) return '';
  const u = String(maybeUrl).trim();
  if (u.startsWith('http://') || u.startsWith('https://')) return u;
  return `${getApiBaseUrl()}${u.startsWith('/') ? u : `/${u}`}`;
}
