// 极简 Cookie 读写：避免额外依赖，同时把属性集中在一处，便于核对。
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export function serializeCookie(name, value, options = {}) {
  const segments = [name + "=" + encodeURIComponent(value)];
  segments.push("Path=" + (options.path ?? "/"));
  if (options.maxAge !== undefined) segments.push("Max-Age=" + options.maxAge);
  if (options.httpOnly !== false) segments.push("HttpOnly");
  segments.push("SameSite=" + (options.sameSite ?? "Lax"));
  // 本机 HTTP 演示环境不加 Secure；部署到 HTTPS 时通过 COOKIE_SECURE=1 打开。
  if (options.secure) segments.push("Secure");
  return segments.join("; ");
}
