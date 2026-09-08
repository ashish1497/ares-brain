export function match(
  method: string,
  pattern: string,
  reqMethod: string,
  reqPath: string,
): Record<string, string> | null {
  if (method !== reqMethod) return null;
  const p = pattern.split("/").filter(Boolean);
  const q = reqPath.split("?")[0].split("/").filter(Boolean);
  if (p.length !== q.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) params[p[i].slice(1)] = decodeURIComponent(q[i]);
    else if (p[i] !== q[i]) return null;
  }
  return params;
}
