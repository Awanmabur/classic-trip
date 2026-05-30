const crypto = require('crypto');

module.exports = function generateCode(prefix = 'CT', length = 8) {
  const raw = crypto.randomBytes(Math.ceil(length / 2)).toString('hex').toUpperCase().slice(0, length);
  return `${prefix}-${raw}`;
};
