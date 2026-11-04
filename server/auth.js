import crypto from 'crypto';

/**
 * Sign-in methods. Email and password work today.
 * Google and Apple are wired as providers so they can be switched on later
 * without a new account model. No API keys are required for the app to run.
 */
export const AUTH_PROVIDERS = [
  {
    id: 'password',
    label: 'Email and password',
    enabled: true,
    env: [],
  },
  {
    id: 'google',
    label: 'Google',
    enabled: false,
    env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    note: 'Add the Google client id and secret, then set the provider enabled, to turn on Google sign-in.',
  },
  {
    id: 'apple',
    label: 'Apple',
    enabled: false,
    env: ['APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY'],
    note: 'Add the Apple client id, team id, key id and private key, then set the provider enabled, to turn on Apple sign-in.',
  },
];

export function listAuthProviders() {
  return AUTH_PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    enabled: p.enabled && p.env.every((name) => !!process.env[name]),
    configured: p.env.every((name) => !!process.env[name]),
    env: p.env,
    note: p.note || null,
  }));
}

export function oauthUnavailable(providerId) {
  const provider = AUTH_PROVIDERS.find((p) => p.id === providerId);
  if (!provider || provider.id === 'password') {
    return { error: 'That sign-in method is not available.', code: 404 };
  }
  const missing = provider.env.filter((name) => !process.env[name]);
  return {
    error: `${provider.label} sign-in is not switched on. It can be added later without changing accounts. Missing: ${missing.join(', ') || 'provider flag'}.`,
    code: 501,
    provider: provider.id,
  };
}

function inBrowser() {
  return typeof window !== 'undefined';
}

function demoDigest(salt, password) {
  let h1 = 0x811c9dc5;
  let h2 = 0x85ebca6b;
  const text = `${salt}\0${password}`;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 = Math.imul(h2 ^ code, 0x27d4eb2d);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function hashPassword(password) {
  if (inBrowser()) {
    const salt = [...crypto.randomBytes(16)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return { algo: 'demo', salt, hash: demoDigest(salt, String(password)) };
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return { algo: 'scrypt', salt, hash };
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.salt || !stored.hash) return false;
  if (stored.algo === 'demo') return demoDigest(stored.salt, String(password)) === stored.hash;
  if (stored.algo !== 'scrypt') return false;
  const next = crypto.scryptSync(String(password), stored.salt, 32);
  const prev = hexToBytes(stored.hash);
  if (prev.length !== next.length) return false;
  return crypto.timingSafeEqual(prev, next);
}

export function newSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}
