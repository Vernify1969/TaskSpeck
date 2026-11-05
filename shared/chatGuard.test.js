import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardMessage, shortName, HIDDEN, CHAT_WARNING } from './chatGuard.js';

function hidden(text, options) {
  const result = guardMessage(text, options);
  assert.equal(result.changed, true, text);
  assert.match(result.text, /\[hidden until booking\]/);
  assert.equal(result.text.includes('0412'), false, result.text);
  assert.equal(result.text.includes('@'), false, result.text);
  return result;
}

function kept(text, options) {
  const result = guardMessage(text, options);
  assert.equal(result.changed, false, `${text} -> ${result.text}`);
  assert.equal(result.text, text);
}

test('short names stay stable', () => {
  assert.equal(shortName('Maya Chen'), 'Maya C');
  assert.equal(shortName('Sam Taylor'), 'Sam T');
  assert.equal(shortName('Priya Nair'), 'Priya N');
  assert.equal(shortName('Jordan'), 'Jordan');
  assert.equal(shortName('Sam T'), 'Sam T');
});

test('the warning sentence is the one shown before send', () => {
  assert.match(CHAT_WARNING, /Contact details are shared automatically once the job is booked/);
  assert.match(CHAT_WARNING, /keep chat in TaskSpeck/i);
});

test('phone numbers, emails, links, and social asks are hidden before booking', () => {
  for (const sample of [
    'text me on 0412 345 678',
    'call me on 0412345678',
    '0412-345-678',
    '0412.345.678',
    '04 1234 5678',
    '+61 412 345 678',
    '+61412345678',
    '+61 03 9123 4567',
    '(03) 9123 4567',
    '03 9123 4567',
    '1300 123 456',
    'zero four one two three four five six seven eight',
    'oh four one two three four five six seven eight',
    'zero four 12 345 678',
    'maya at gmail dot com',
    'maya at gmail.com',
    'pat at me dot com',
    'maya@gmail.com',
    'see https://example.com/job',
    'www.example.com',
    'my site is example.com',
    'find me @maya_helps',
    'whatsapp me',
    'WhatsApp me tonight',
    'on instagram',
    'text me on',
  ]) {
    hidden(sample);
  }
  const mixed = guardMessage('Can you text me on 0412 345 678 after 2pm?');
  assert.equal(mixed.changed, true);
  assert.match(mixed.text, /\[hidden until booking\]/);
  assert.match(mixed.text, /2pm/);
  assert.equal(mixed.text.includes('0412'), false);
});

test('prices, times, dates, addresses, and quantities stay', () => {
  for (const sample of [
    '$120',
    '120 dollars',
    'AUD 120',
    'The price is $1,200',
    '2pm',
    '2 pm',
    '10:00',
    '10:30am',
    'Does the lift booking cover 2pm?',
    'Yes, 2pm to 3pm.',
    '12 Spencer St',
    '200 Spencer Street',
    'Apt 1204, 200 Spencer St, Melbourne VIC 3000',
    'Unit 4',
    'level 18',
    'level 6',
    'postcode 3000',
    '3000',
    '20 boxes',
    '10 km',
    '15%',
    'Saturday 8 Nov',
    'I can bring a drill. Saturday morning works.',
    'see you at 10',
    'meet at the door',
    'look at me',
    'about 20 boxes from the lobby',
  ]) {
    kept(sample);
  }
});

test('after booking, phone numbers can be shared and other contact still cannot', () => {
  kept('text me on 0412 345 678', { phonesAllowed: true });
  kept('I am running late, call 0412 345 678', { phonesAllowed: true });
  kept('+61 412 345 678', { phonesAllowed: true });
  hidden('whatsapp me', { phonesAllowed: true });
  hidden('maya at gmail dot com', { phonesAllowed: true });
  hidden('maya@gmail.com', { phonesAllowed: true });
  hidden('https://example.com', { phonesAllowed: true });
  hidden('@maya_helps', { phonesAllowed: true });
  assert.equal(HIDDEN, '[hidden until booking]');
});
