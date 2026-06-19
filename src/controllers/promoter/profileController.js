const store = require('../../services/data/persistentStore');
const { mongoose } = require('../../config/db');

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

async function persist(user) {
  if (mongoose.connection.readyState !== 1 || !user) return;
  const User = require('../../models/User');
  await User.updateOne({ id: user.id }, { $set: user }, { upsert: true, runValidators: true });
}

async function update(req, res, next) {
  try {
    const sessionUser = req.session?.user || {};
    const user = store.state.users.find((item) => item.id === sessionUser.id) || sessionUser;
    if (req.body.fullName) user.fullName = cleanText(req.body.fullName);
    if (req.body.email) user.email = cleanText(req.body.email).toLowerCase();
    if (req.body.phone) user.phone = cleanText(req.body.phone);
    user.role = user.role || 'promoter';
    user.promoterProfile = {
      ...(user.promoterProfile || {}),
      defaultChannel: cleanText(req.body.defaultChannel || user.promoterProfile?.defaultChannel || ''),
      bio: cleanText(req.body.bio || user.promoterProfile?.bio || ''),
      payoutMethod: cleanText(req.body.payoutMethod || user.promoterProfile?.payoutMethod || ''),
      payoutProvider: cleanText(req.body.payoutProvider || user.promoterProfile?.payoutProvider || ''),
      payoutAccount: cleanText(req.body.payoutAccount || user.promoterProfile?.payoutAccount || ''),
    };
    user.payoutAccount = {
      method: user.promoterProfile.payoutMethod || user.promoterProfile.payoutProvider || user.payoutAccount?.method || 'Mobile Money',
      account: user.promoterProfile.payoutAccount || user.payoutAccount?.account || user.phone || '',
    };
    user.updatedAt = new Date().toISOString();
    if (req.session?.user) Object.assign(req.session.user, user);
    await persist(user);
    res.redirect('/promoter/dashboard#profile');
  } catch (error) {
    next(error);
  }
}

async function updateVerification(req, res, next) {
  try {
    const sessionUser = req.session?.user || {};
    const user = store.state.users.find((item) => item.id === sessionUser.id) || sessionUser;
    user.role = 'promoter';
    user.verificationStatus = cleanText(req.body.verificationStatus || 'pending').toLowerCase();
    user.verificationDocumentType = cleanText(req.body.documentType || req.body.verificationDocumentType || 'national_id');
    user.verificationReference = cleanText(req.body.documentReference || req.body.verificationReference || '');
    user.payoutAccount = {
      method: cleanText(req.body.payoutMethod || user.payoutAccount?.method || 'Mobile Money'),
      account: cleanText(req.body.payoutAccount || user.payoutAccount?.account || user.phone || ''),
    };
    user.promoterProfile = {
      ...(user.promoterProfile || {}),
      verificationNote: cleanText(req.body.message || req.body.notes || ''),
    };
    user.updatedAt = new Date().toISOString();
    if (req.session?.user) Object.assign(req.session.user, user);
    await persist(user);
    res.redirect('/promoter/dashboard#settings');
  } catch (error) {
    next(error);
  }
}

module.exports = { update, updateVerification };
