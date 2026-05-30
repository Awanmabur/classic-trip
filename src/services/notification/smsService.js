async function sendSms(message) {
  return { queued: true, channel: 'sms', message };
}
module.exports = { sendSms };
