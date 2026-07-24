const { cleanEmail, cleanPhone, phoneVariants } = require('../services/auth/identityContact');

async function assertContactAvailableLive(currentUserId, { email, phone } = {}, options = {}) {
  const identityRepository = require('../repositories/domain/identityRepository');
  const normalizedEmail = cleanEmail(email);
  const normalizedPhone = cleanPhone(phone);
  if (normalizedEmail) {
    const clash = await identityRepository.users.findOne({ email: normalizedEmail, id: { $ne: currentUserId } });
    if (clash) {
      const error = new Error(options.allowRecoveryEmail ? 'That recovery email belongs to another account.' : 'That email address is already in use by another account.');
      error.status = 409;
      error.code = 'account_exists';
      error.conflictFields = ['email'];
      throw error;
    }
  }
  const phones = phoneVariants(normalizedPhone);
  if (phones.length) {
    const clash = await identityRepository.users.findOne({ phone: { $in: phones }, id: { $ne: currentUserId } });
    if (clash) {
      const error = new Error('That phone number is already in use by another account.');
      error.status = 409;
      error.code = 'account_exists';
      error.conflictFields = ['phone'];
      throw error;
    }
  }
}

module.exports = { assertContactAvailableLive };
