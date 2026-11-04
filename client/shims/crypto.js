function hex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomBytes(size) {
  const buf = new Uint8Array(size);
  globalThis.crypto.getRandomValues(buf);
  buf.toString = (enc) => (enc === 'hex' ? hex(buf) : [...buf].join(','));
  return buf;
}

export function scryptSync() {
  throw new Error('The phone demo does not use a server password hash');
}

export function timingSafeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function createHash() {
  let data = '';
  return {
    update(value) { data += String(value); return this; },
    digest(enc) {
      let h = 0x811c9dc5;
      for (let i = 0; i < data.length; i++) {
        h ^= data.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      const out = (h >>> 0).toString(16).padStart(8, '0');
      return enc === 'hex' || enc == null ? out : out;
    },
  };
}

export default { randomBytes, scryptSync, timingSafeEqual, createHash };
