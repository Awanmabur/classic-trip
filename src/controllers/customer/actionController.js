const store = require('../../services/data/persistentStore');
const walletService = require('../../services/wallet/walletService');
const { mongoose } = require('../../config/db');

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function amountValue(value) {
  const amount = Number(String(value || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(amount) ? amount : 0;
}

function nextId(prefix, rows = []) {
  let index = rows.length + 1;
  let id = `${prefix}-${index}`;
  while (rows.some((row) => row.id === id)) {
    index += 1;
    id = `${prefix}-${index}`;
  }
  return id;
}

function sessionUser(req) {
  const current = req.session?.user || {};
  let user = store.state.users.find((item) => item.id === current.id);
  if (!user && current.id) {
    user = { id: current.id, role: current.role || 'customer', fullName: current.fullName || 'Customer', email: current.email || '', phone: current.phone || '', status: 'active' };
    store.state.users.push(user);
  }
  return user || store.state.users.find((item) => item.role === 'customer') || {};
}

async function persist(modelName, row, filter = { id: row.id }) {
  if (mongoose.connection.readyState !== 1 || !row) return;
  const Model = require(`../../models/${modelName}`);
  await Model.updateOne(filter, { $set: row }, { upsert: true, runValidators: true });
}

function ensureSavedListings() {
  if (!Array.isArray(store.state.savedListings)) store.state.savedListings = [];
}

async function saveTrip(req, res, next) {
  try {
    ensureSavedListings();
    const user = sessionUser(req);
    const listing = store.findListing(req.body.listingId || req.body.listingSlug || req.body.title);
    if (!listing) {
      const error = new Error('Listing not found');
      error.status = 404;
      throw error;
    }

    let saved = store.state.savedListings.find((row) => row.userId === user.id && row.listingId === listing.id);
    if (!saved) {
      saved = {
        id: nextId('saved-listing', store.state.savedListings),
        userId: user.id,
        listingId: listing.id,
        companyId: listing.companyId,
        serviceType: listing.serviceType,
        status: 'saved',
        createdAt: new Date().toISOString(),
      };
      store.state.savedListings.unshift(saved);
    }
    saved.notes = cleanText(req.body.notes || saved.notes || '');
    saved.status = 'saved';
    saved.updatedAt = new Date().toISOString();
    await persist('SavedListing', saved, { userId: saved.userId, listingId: saved.listingId });
    res.redirect('/saved');
  } catch (error) {
    next(error);
  }
}

async function topUpWallet(req, res, next) {
  try {
    const user = sessionUser(req);
    const amount = amountValue(req.body.amount);
    if (amount <= 0) {
      const error = new Error('Wallet top-up amount must be greater than zero');
      error.status = 422;
      throw error;
    }
    // Top-ups are never credited to spendable balance directly from a client-supplied amount —
    // that would let anyone mint their own wallet funds. This only records a pending request;
    // finance/admin must verify the actual payment and approve it before the balance moves.
    const before = store.state.walletTransactions.length;
    const wallet = walletService.creditPending('customer', user.id, amount, {
      currency: cleanText(req.body.currency || 'UGX'),
      transactionType: 'wallet_top_up_request',
      referenceType: 'customer_wallet_top_up',
      referenceId: cleanText(req.body.paymentReference || `topup-${Date.now()}`),
      status: 'pending',
    });
    const transaction = store.state.walletTransactions[before];
    if (transaction) {
      transaction.method = cleanText(req.body.method || 'manual');
      transaction.reference = cleanText(req.body.paymentReference || transaction.referenceId);
      transaction.meta = { source: 'customer_dashboard', note: cleanText(req.body.notes || '') };
      await persist('WalletTransaction', transaction);
    }
    await persist('Wallet', wallet);
    res.redirect('/account#wallet');
  } catch (error) {
    next(error);
  }
}

async function becomePromoter(req, res, next) {
  try {
    const user = sessionUser(req);
    const root = cleanText(req.body.referralCode || `${(user.fullName || 'promoter').replace(/[^a-z0-9]+/gi, '-').toUpperCase()}-${Date.now().toString().slice(-4)}`)
      .toUpperCase()
      .replace(/[^A-Z0-9-]+/g, '-');
    let code = root || `PROMOTER-${Date.now()}`;
    let index = 1;
    while (store.state.users.some((item) => item.id !== user.id && String(item.referralCode || '').toUpperCase() === code)) {
      index += 1;
      code = `${root}-${index}`;
    }
    user.role = 'promoter';
    user.referralCode = code;
    user.verificationStatus = 'pending';
    user.payoutAccount = {
      method: cleanText(req.body.payoutMethod || 'Mobile Money'),
      account: cleanText(req.body.payoutAccount || user.phone || ''),
    };
    user.promoterProfile = {
      ...(user.promoterProfile || {}),
      defaultChannel: cleanText(req.body.defaultChannel || 'social'),
      bio: cleanText(req.body.bio || ''),
    };
    user.updatedAt = new Date().toISOString();
    const wallet = walletService.getOrCreateWallet('promoter', user.id, cleanText(req.body.currency || 'UGX'));
    if (req.session?.user) Object.assign(req.session.user, user);
    await persist('User', user);
    await persist('Wallet', wallet);
    res.redirect('/promoter/dashboard');
  } catch (error) {
    next(error);
  }
}

async function updateSecurity(req, res, next) {
  try {
    const user = sessionUser(req);
    user.twoFactorEnabled = ['on', 'true', '1', 'enabled'].includes(String(req.body.twoFactorEnabled || '').toLowerCase());
    user.loginAlertsEnabled = req.body.loginAlertsEnabled === undefined
      ? true
      : ['on', 'true', '1', 'enabled'].includes(String(req.body.loginAlertsEnabled || '').toLowerCase());
    user.recoveryEmail = cleanText(req.body.recoveryEmail || user.recoveryEmail || '').toLowerCase();
    if (req.body.passwordChanged === 'on') user.passwordChangedAt = new Date().toISOString();
    user.updatedAt = new Date().toISOString();
    if (req.session?.user) Object.assign(req.session.user, user);
    await persist('User', user);
    res.redirect('/account#security');
  } catch (error) {
    next(error);
  }
}

module.exports = { saveTrip, topUpWallet, becomePromoter, updateSecurity };
