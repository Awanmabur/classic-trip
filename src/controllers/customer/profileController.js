const store = require('../../services/data/demoStore');
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
    let user = store.state.users.find((item) => item.id === sessionUser.id);
    if (!user && sessionUser.id) {
      user = store.upsertUser({ ...sessionUser, role: sessionUser.role || 'customer' });
    }
    user = user || sessionUser;
    if (req.body.fullName) user.fullName = cleanText(req.body.fullName);
    if (req.body.email) user.email = cleanText(req.body.email).toLowerCase();
    if (req.body.phone) user.phone = cleanText(req.body.phone);
    if (req.body.city) user.city = cleanText(req.body.city);
    if (req.body.savedPassengerDetails) user.savedPassengerDetails = cleanText(req.body.savedPassengerDetails);
    user.role = user.role || 'customer';
    user.updatedAt = new Date().toISOString();
    if (req.session?.user) Object.assign(req.session.user, user);
    await persist(user);
    return res.redirect('/account#profile');
  } catch (error) {
    return next(error);
  }
}

module.exports = { update };
