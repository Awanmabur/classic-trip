async function sendEmail(message) {
  return { queued: true, channel: 'email', message };
}
module.exports = { sendEmail };
