const promoterRepository = require('../repositories/domain/promoterRepository');

async function requireVerifiedPromoter(req, res, next) {
  try {
    const userId = req.session?.user?.id;
    const user = userId ? await promoterRepository.users.findOne({ id: userId, role: 'promoter' }) : null;
    if (!user) {
      const error = new Error('Promoter account not found');
      error.status = 403;
      throw error;
    }
    if (String(user.verificationStatus || '').toLowerCase() !== 'verified') {
      if (req.flash) req.flash('error', 'Complete promoter verification before withdrawals or offline sales.');
      return res.redirect('/promoter/profile#verification');
    }
    req.promoterUser = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { requireVerifiedPromoter };
