import type { IncomingMessage } from "node:http";

function serverPort(): number {
  return Number(process.env.ARES_BRAIN_DASHBOARD_PORT) || 4319;
}

/**
 * Same-origin guard for state-changing routes. Returns an error string to
 * reject with, or null to allow. Blocks cross-origin POSTs and DNS-rebinding:
 * the Host header must be loopback on our port, and any Origin present must
 * be a known local / Vite dev origin.
 */
export function guardOrigin(req: IncomingMessage): string | null {
  const port = serverPort();
  const host = req.headers.host;
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return "bad host";
  const origin = req.headers.origin;
  if (
    origin &&
    ![
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ].includes(origin)
  )
    return "bad origin";
  return null;
}
