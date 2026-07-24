const promoterRepository = require('../../repositories/domain/promoterRepository');
const { assertContactAvailableLive } = require('../../utils/uniqueContact');
const verificationService = require('../../services/onboarding/verificationService');
function cleanText(value, max = 1000) { return String(value || '').replace(/<[^>]*>/g, '').trim().replace(/\s+/g, ' ').slice(0, max); }
function normalizePhone(value) { return String(value || '').replace(/[^\d+]/g, '').replace(/^00/, '+').trim(); }
async function activePromoter(req) {
  const id = req.session?.user?.id;
  const user = id ? await promoterRepository.users.findOne({ id }) : null;
  if (!user || user.role !== 'promoter' || user.status !== 'active') { const error = new Error('Active promoter account not found'); error.status = 403; throw error; }
  return user;
}
async function update(req, res, next) {
  try {
    const user = await activePromoter(req);
    await assertContactAvailableLive(user.id, { email: req.body.email, phone: req.body.phone });
    const nextEmail = req.body.email ? cleanText(req.body.email, 254).toLowerCase() : user.email;
    const nextPhone = req.body.phone ? normalizePhone(req.body.phone) : user.phone;
    const emailChanged = Boolean(req.body.email && nextEmail !== String(user.email || '').toLowerCase());
    const phoneChanged = Boolean(req.body.phone && nextPhone !== String(user.phone || ''));
    if (req.body.fullName) user.fullName = cleanText(req.body.fullName, 160);
    if (req.body.email) user.email = nextEmail;
    if (req.body.phone) user.phone = nextPhone;
    user.promoterProfile = { ...(user.promoterProfile || {}), defaultChannel: cleanText(req.body.defaultChannel || user.promoterProfile?.defaultChannel, 80), bio: cleanText(req.body.bio || user.promoterProfile?.bio, 1000), payoutMethod: cleanText(req.body.payoutMethod || user.promoterProfile?.payoutMethod, 40), payoutProvider: cleanText(req.body.payoutProvider || user.promoterProfile?.payoutProvider, 80), payoutAccount: cleanText(req.body.payoutAccount || user.promoterProfile?.payoutAccount, 180) };
    user.payoutAccount = { method: user.promoterProfile.payoutMethod || user.promoterProfile.payoutProvider || user.payoutAccount?.method || 'Mobile Money', account: user.promoterProfile.payoutAccount || user.payoutAccount?.account || user.phone || '' };
    user.updatedAt = new Date().toISOString();
    await promoterRepository.users.save(user, { id: user.id });
    if (emailChanged || phoneChanged) {
      await verificationService.invalidateContactVerificationForUser(user.id, { emailChanged, phoneChanged }, user.id);
      if (emailChanged) await require('../../services/auth/authService').resendVerificationEmail(user.id);
      if (phoneChanged && nextPhone) await require('../../services/auth/phoneVerificationService').requestCode(user.id);
    }
    const refreshed = await promoterRepository.users.findOne({ id: user.id });
    if (req.session?.user && refreshed) Object.assign(req.session.user, refreshed);
    return res.redirect('/promoter/dashboard#profile');
  } catch (error) { return next(error); }
}
async function updateVerification(req, res, next) {
  try {
    const user = await activePromoter(req);
    await verificationService.submitPromoterChecklist(user.id, req.body, user.id);
    const refreshed = await promoterRepository.users.findOne({ id: user.id });
    if (req.session?.user && refreshed) Object.assign(req.session.user, refreshed);
    if (req.flash) req.flash('success', 'Promoter verification was submitted for review.');
    return res.redirect('/promoter/profile#verification');
  } catch (error) { return next(error); }
}

module.exports = { update, updateVerification };
