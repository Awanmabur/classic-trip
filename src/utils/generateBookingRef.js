const generateCode = require('./generateCode');

module.exports = function generateBookingRef(serviceType = 'GEN') {
  const prefix = `CT-${String(serviceType || 'GEN').toUpperCase().slice(0, 5)}`;
  return generateCode(prefix, 6);
};
