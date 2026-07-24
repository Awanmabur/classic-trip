const cartAccessService = require('../services/cart/cartAccessService');

function wantsJson(req) {
  return String(req.originalUrl || req.path || '').startsWith('/api/')
    || req.xhr
    || String(req.headers.accept || '').includes('application/json');
}

async function requireCartAccess(req, res, next) {
  let cart;
  try {
    cart = await cartAccessService.findCartFresh(req.params.cartRef);
  } catch (error) {
    return next(error);
  }
  if (!cart) return next();
  if (cartAccessService.canAccessCart(req, cart)) {
    req.cart = cart;
    return next();
  }
  if (wantsJson(req)) {
    return res.status(403).json({ ok: false, code: 'cart_access_denied', message: 'This cart belongs to another browser or account.' });
  }
  return res.status(403).render('pages/error', {
    seo: { title: 'Cart access denied | Classic Trip' },
    status: 403,
    message: 'This cart belongs to another browser or account.',
  });
}

module.exports = { requireCartAccess };
