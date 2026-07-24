const crypto = require('crypto');
const commerceRepository = require('../../repositories/domain/commerceRepository');
const { canonicalRole } = require('../../config/accessControl');

function sha256(value = '') {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function generateAccessToken() {
  return crypto.randomBytes(32).toString('hex');
}

function timingSafeEqual(a, b) {
  if (!a || !b) return false;
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function grantSessionAccess(req, cartRef, token) {
  if (!req?.session || !cartRef || !token) return;
  req.session.cartAccess = req.session.cartAccess || {};
  req.session.cartAccess[String(cartRef)] = String(token);
}

function tokenFromRequest(req = {}, cartRef = '') {
  return req.get?.('x-cart-access-token')
    || req.body?.accessToken
    || req.query?.accessToken
    || req.session?.cartAccess?.[String(cartRef)]
    || '';
}

function isPrivilegedRole(role) {
  return ['super_admin', 'admin', 'support_admin'].includes(canonicalRole(role));
}

function canAccessCart(req = {}, cart = {}) {
  const user = req.session?.user || {};
  if (isPrivilegedRole(user.role)) return true;
  if (cart.userId && user.id && String(cart.userId) === String(user.id)) return true;
  const token = tokenFromRequest(req, cart.cartRef);
  if (token && cart.guestKey && timingSafeEqual(sha256(token), cart.guestKey)) return true;
  return false;
}

async function findCart(cartRef) {
  const value = String(cartRef || '').trim();
  if (!value) return null;
  return commerceRepository.carts.findOne({ $or: [{ cartRef: value }, { id: value }] });
}

module.exports = {
  sha256,
  generateAccessToken,
  grantSessionAccess,
  tokenFromRequest,
  canAccessCart,
  findCart,
  findCartFresh: findCart,
};
