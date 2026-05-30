async function sendWhatsapp(message) {
  return { queued: true, channel: 'whatsapp', message };
}
module.exports = { sendWhatsapp };
