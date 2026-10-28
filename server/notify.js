import fs from 'fs';
import path from 'path';

/**
 * Email and SMS delivery.
 *
 * NOTIFY_PROVIDER selects the transport (default "log"):
 *   log      print to the console and append a line to the log file
 *   file     append a line to the log file only
 *   webhook  POST JSON to NOTIFY_WEBHOOK_URL
 *   twilio   send SMS through Twilio when TWILIO_* keys are set
 *   smtp     send email when SMTP_HOST is set (falls back to the log if sending is not possible)
 *
 * If the chosen provider has no keys, the message is logged instead.
 * Nothing here is sent to a real inbox or phone unless those keys are set.
 */

function dataDir() {
  return process.env.TASKSPECK_DATA || path.join(process.cwd(), 'data');
}

function logFile() {
  return process.env.NOTIFY_LOG_FILE || path.join(dataDir(), 'notifications.log');
}

function appendLog(record) {
  const line = JSON.stringify(record);
  console.log(`[notify] ${record.channel} → ${record.to}: ${record.subject}`);
  try {
    fs.mkdirSync(path.dirname(logFile()), { recursive: true });
    fs.appendFileSync(logFile(), line + '\n');
  } catch (err) {
    console.error('[notify] could not write log', err.message);
  }
  return record;
}

const transports = {
  log: {
    ready: () => true,
    send: async (msg) => appendLog({ ...msg, provider: 'log', at: new Date().toISOString() }),
  },
  file: {
    ready: () => true,
    send: async (msg) => {
      const record = { ...msg, provider: 'file', at: new Date().toISOString() };
      fs.mkdirSync(path.dirname(logFile()), { recursive: true });
      fs.appendFileSync(logFile(), JSON.stringify(record) + '\n');
      return record;
    },
  },
  webhook: {
    ready: () => !!process.env.NOTIFY_WEBHOOK_URL,
    send: async (msg) => {
      const res = await fetch(process.env.NOTIFY_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg),
      });
      const record = { ...msg, provider: 'webhook', at: new Date().toISOString(), status: res.status };
      appendLog(record);
      return record;
    },
  },
  twilio: {
    ready: () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM),
    send: async (msg) => {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN;
      const body = new URLSearchParams({
        To: msg.to,
        From: process.env.TWILIO_FROM,
        Body: `${msg.subject}\n${msg.body}`,
      });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      const record = { ...msg, provider: 'twilio', at: new Date().toISOString(), status: res.status };
      appendLog(record);
      return record;
    },
  },
  smtp: {
    ready: () => !!process.env.SMTP_HOST,
    send: async (msg) => {
      // A full SMTP conversation needs a mail library. Until one is configured,
      // record the message so it is not dropped when the host is set but sending is not.
      const record = {
        ...msg,
        provider: 'smtp',
        at: new Date().toISOString(),
        note: `SMTP_HOST is ${process.env.SMTP_HOST}. Message logged because no mail library is bundled. Set NOTIFY_PROVIDER=webhook to hand it to your own sender.`,
      };
      appendLog(record);
      return record;
    },
  },
};

export async function deliver(msg) {
  const name = String(process.env.NOTIFY_PROVIDER || 'log').toLowerCase();
  const chosen = transports[name] || transports.log;
  if (!chosen.ready()) {
    const record = await transports.log.send({
      ...msg,
      fallback: `Provider "${name}" has no keys configured, so this was logged instead.`,
    });
    record.requestedProvider = name;
    return record;
  }
  try {
    return await chosen.send(msg);
  } catch (err) {
    return transports.log.send({ ...msg, fallback: `Provider "${name}" failed: ${err.message}` });
  }
}

export function outboxPath() {
  return logFile();
}
