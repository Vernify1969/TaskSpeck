/** Hide off-platform contact in chat until a job is booked. Prices, times, and short street numbers stay. */

export const HIDDEN = '[hidden until booking]';

export const CHAT_WARNING =
  "Contact details are shared automatically once the job is booked. Please keep chat in TaskSpeck so you're protected.";

export const RULE_REMINDER =
  'A quick reminder: payments, contact and rebooking stay in TaskSpeck so ratings, SOS and the no-show rule protect you.';

const WORD_DIGIT = {
  zero: '0',
  oh: '0',
  o: '0',
  nought: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
  seventeen: '17',
  eighteen: '18',
  nineteen: '19',
  twenty: '20',
  thirty: '30',
  forty: '40',
  fifty: '50',
  sixty: '60',
  seventy: '70',
  eighty: '80',
  ninety: '90',
};

const APPS = 'whatsapp|telegram|signal|instagram|snapchat|messenger|viber|facebook';
const MAIL_HOSTS = 'gmail|hotmail|outlook|yahoo|icloud|live|bigpond|optusnet|protonmail|proton|msn';

export function shortName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  if (last.length === 1) return `${parts[0]} ${last}`;
  return `${parts[0]} ${last[0].toUpperCase()}`;
}

function isAuPhoneDigits(raw) {
  const original = String(raw || '');
  let d = original.replace(/\D/g, '');
  if (!d) return false;
  if (d.startsWith('61') && (d.length === 11 || (d.length === 12 && d[2] === '0'))) {
    d = `0${d.slice(d[2] === '0' ? 3 : 2)}`;
  }
  if (/^04\d{8}$/.test(d)) return true;
  if (/^0[2378]\d{8}$/.test(d)) return true;
  if (/^1[38]00\d{6}$/.test(d)) return true;
  return false;
}

function maskPhrases(text, phonesAllowed) {
  let next = text.replace(new RegExp(`\\b(?:${APPS})\\s+me\\b|\\bon\\s+(?:${APPS})\\b`, 'gi'), HIDDEN);
  if (!phonesAllowed) next = next.replace(/\b(?:text|call|sms)\s+me\s+on\b/gi, HIDDEN);
  return next;
}

function maskEmails(text) {
  let next = text.replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, HIDDEN);
  next = next.replace(
    new RegExp(`\\b[a-z0-9][a-z0-9._%+-]{0,40}\\s+at\\s+(?:${MAIL_HOSTS})\\b(?:\\s*\\.\\s*[a-z]{2,}|\\s+dot\\s+[a-z]{2,})?`, 'gi'),
    HIDDEN,
  );
  next = next.replace(
    /\b[a-z0-9][a-z0-9._%+-]{0,40}\s+at\s+[a-z0-9-]+\s+dot\s+(?:com\.au|net\.au|org\.au|com|net|org|au|io|app)\b/gi,
    HIDDEN,
  );
  return next;
}

function maskUrls(text) {
  let next = text.replace(/\bhttps?:\/\/\S+/gi, HIDDEN);
  next = next.replace(/\bwww\.\S+/gi, HIDDEN);
  next = next.replace(/\b[a-z0-9-]+\.(?:com\.au|net\.au|org\.au|com|net|org|io|app|ly)\b/gi, HIDDEN);
  return next;
}

function maskHandles(text) {
  return text.replace(/(^|[^A-Za-z0-9.@])@([A-Za-z][A-Za-z0-9._]{1,30})\b/g, (match, prefix) => `${prefix}${HIDDEN}`);
}

function maskDigitPhones(text) {
  return text.replace(/\+?\d(?:[\s().-]*\d){7,14}/g, (match, offset, whole) => {
    const before = whole.slice(Math.max(0, offset - 2), offset);
    if (/\$\s*$/.test(before)) return match;
    return isAuPhoneDigits(match) ? HIDDEN : match;
  });
}

function digitToken(raw) {
  if (/^\d{1,5}$/.test(raw)) return raw;
  return WORD_DIGIT[String(raw || '').toLowerCase()] || null;
}

function maskSpelledPhones(text) {
  const re = /[A-Za-z]+|\d+/g;
  const tokens = [];
  let found;
  while ((found = re.exec(text))) {
    tokens.push({ start: found.index, end: found.index + found[0].length, raw: found[0] });
  }
  const cuts = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (digitToken(tokens[i].raw) == null) continue;
    let digits = '';
    let words = 0;
    let j = i;
    while (j < tokens.length) {
      const piece = digitToken(tokens[j].raw);
      if (piece == null) break;
      if (j > i && !/^[\s.,\-()/]*$/.test(text.slice(tokens[j - 1].end, tokens[j].start))) break;
      if (/[a-z]/i.test(tokens[j].raw)) words += 1;
      digits += piece;
      j += 1;
      if (digits.length > 12) break;
    }
    if (words >= 1 && isAuPhoneDigits(digits)) {
      cuts.push([tokens[i].start, tokens[j - 1].end]);
      i = j - 1;
    }
  }
  let next = text;
  for (let n = cuts.length - 1; n >= 0; n -= 1) {
    next = next.slice(0, cuts[n][0]) + HIDDEN + next.slice(cuts[n][1]);
  }
  return next;
}

function collapse(text) {
  return text.replace(new RegExp(`(?:${HIDDEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[\\s,.;:/|-]+${HIDDEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})+)`, 'g'), HIDDEN);
}

export function guardMessage(text, { phonesAllowed = false } = {}) {
  const original = String(text ?? '');
  let next = original;
  next = maskPhrases(next, phonesAllowed);
  next = maskEmails(next);
  next = maskUrls(next);
  next = maskHandles(next);
  if (!phonesAllowed) {
    next = maskDigitPhones(next);
    next = maskSpelledPhones(next);
  }
  next = collapse(next);
  return { text: next, changed: next !== original };
}
