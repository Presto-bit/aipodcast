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

  // CRA 开发服务器：避免走 devServer proxy 导致 /api/generate_script_draft 等流式接口 404
  const craDevPorts = ['3000', '3001'];
  if (craDevPorts.includes(port)) {
    return `${proto}//${host}:5001`;
  }

  const staticDevPorts = ['8000', '8080', '5500', '5501', '4173', '8888'];
  if (staticDevPorts.includes(port)) {
    return `${proto}//${host}:5001`;
  }

  return '';
}
