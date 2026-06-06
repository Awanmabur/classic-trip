const nodemailer = require('nodemailer');
const { env } = require('../../config/env');

let transport = null;

function configured() {
  return Boolean(env.email.host);
}

function transporter() {
  if (!configured()) return null;
  if (transport) return transport;
  const port = Number(env.email.port || 587);
  transport = nodemailer.createTransport({
    host: env.email.host,
    port,
    secure: port === 465,
    auth: env.email.user ? { user: env.email.user, pass: env.email.pass } : undefined,
  });
  return transport;
}

async function sendEmail(message = {}) {
  if (!message.to) {
    return { status: 'skipped', channel: 'email', provider: 'smtp', reason: 'Missing email recipient' };
  }
  if (!configured()) {
    return { status: 'queued', channel: 'email', provider: 'smtp', reason: 'SMTP is not configured', message };
  }

  const result = await transporter().sendMail({
    from: env.email.from,
    to: message.to,
    subject: message.title || 'Classic Trip update',
    text: message.message || '',
    html: message.html || `<p>${String(message.message || '').replace(/\n/g, '<br>')}</p>`,
  });

  return {
    status: 'sent',
    channel: 'email',
    provider: 'smtp',
    providerReference: result.messageId,
    response: result.response,
  };
}

module.exports = { sendEmail };
