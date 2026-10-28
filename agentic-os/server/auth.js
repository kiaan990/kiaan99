// Browser-origin protection.
// Purpose: stop OTHER WEBSITES you visit from calling this local API through your browser
// (CSRF, DNS-rebinding). It does NOT protect against other programs already running as you on
// your Mac — any such program can read .env. That is outside what a local web app can defend.
import crypto from 'node:crypto';

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();

export function tokenMatches(given, expected) {
  if (typeof given !== 'string' || !given) return false;
  return crypto.timingSafeEqual(digest(given), digest(expected));
}

// getPort() is read per request because the port is only known after listen().
export function securityMiddleware({ config, getPort }) {
  const pub = config.access?.publicOrigin ? new URL(config.access.publicOrigin) : null;
  const hosts = () => new Set([`127.0.0.1:${getPort()}`, `localhost:${getPort()}`, ...(pub ? [pub.host.toLowerCase()] : [])]);
  const origins = () => new Set([`http://127.0.0.1:${getPort()}`, `http://localhost:${getPort()}`, ...(pub ? [pub.origin] : [])]);
  const allowedUsers = new Set(config.access?.tailscaleUsers ?? []);

  // Cloud mode only: every request (page and API) must come through Tailscale Serve from an
  // allowed Tailscale login. Tailscale strips any client-sent copy of this header and sets it itself.
  // Note: the app listens on 127.0.0.1, so only Tailscale (or another program on the server) can reach it.
  function identityCheck(req, res, next) {
    if (allowedUsers.size === 0) return next();
    const login = String(req.headers['tailscale-user-login'] || '').toLowerCase();
    if (!login || !allowedUsers.has(login)) {
      return res.status(403).type('text/plain').send('Forbidden: open this through Tailscale while signed in with an allowed account.');
    }
    next();
  }

  // 1) Host header must be our own loopback address (blocks DNS-rebinding attacks).
  function hostCheck(req, res, next) {
    if (!hosts().has(String(req.headers.host || '').toLowerCase())) {
      return res.status(403).type('text/plain').send('Forbidden: unexpected Host header');
    }
    next();
  }

  // 2) API: same-origin only (CORS restricted to the app's own localhost origin), then the token.
  function apiGuard(req, res, next) {
    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (!origins().has(origin)) return res.status(403).json({ error: 'Forbidden: cross-origin request' });
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Forbidden: cross-site request' });
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Local-Token');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
      return res.status(204).end();
    }
    if (!tokenMatches(req.headers['x-local-token'], config.token)) {
      return res.status(401).json({ error: 'Missing or wrong local token' });
    }
    next();
  }

  function securityHeaders(req, res, next) {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "media-src 'self' blob: mediastream:",
        `connect-src 'self' ${config.openai.baseUrl}`,
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join('; '),
    );
    next();
  }

  return { hostCheck, identityCheck, apiGuard, securityHeaders };
}
