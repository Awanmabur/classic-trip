function money(amount, currency = 'UGX') {
  return `${currency} ${Math.round(Number(amount) || 0).toLocaleString()}`;
}

function parseMoney(value) {
  const amount = Number(String(value || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(amount) ? amount : 0;
}

module.exports = { money, parseMoney };
