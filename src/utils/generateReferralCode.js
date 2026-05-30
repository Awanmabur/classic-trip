const generateCode = require('./generateCode');

module.exports = function generateReferralCode(name = 'PROMO') {
  const safe = String(name).replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 5) || 'PROMO';
  return generateCode(`CT-${safe}`, 5);
};
