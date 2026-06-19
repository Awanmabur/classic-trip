const cartService = require('../../services/cart/cartService');

function renderCart(req, res, next) {
  try {
    const cart = cartService.findCart(req.params.cartRef);
    if (!cart) return next();
    return res.render('pages/cart-checkout', { seo: { title: `Cart ${cart.cartRef} | Classic Trip` }, cart: cartService.publicCart(cart), recovery: false });
  } catch (error) { return next(error); }
}
function renderRecovery(req, res, next) {
  try {
    const cart = cartService.findCart(req.params.cartRef);
    if (!cart) return next();
    return res.render('pages/cart-checkout', { seo: { title: `Recover cart ${cart.cartRef} | Classic Trip` }, cart: cartService.publicCart(cart), recovery: true });
  } catch (error) { return next(error); }
}
async function create(req, res, next) {
  try {
    const cart = cartService.createCart(req.body, req);
    if (req.accepts('html') && !req.originalUrl.startsWith('/api/')) return res.redirect(`/cart/${cart.cartRef}`);
    return res.status(201).json({ cart: cartService.publicCart(cart) });
  } catch (error) { return next(error); }
}
async function addItem(req, res, next) {
  try {
    const cart = await cartService.addItem(req.params.cartRef, req.body);
    if (req.accepts('html') && !req.originalUrl.startsWith('/api/')) return res.redirect(`/cart/${cart.cartRef}`);
    return res.status(201).json({ cart: cartService.publicCart(cart) });
  } catch (error) { return next(error); }
}
async function validate(req, res, next) {
  try {
    const cart = await cartService.validateCart(req.params.cartRef);
    if (req.accepts('html') && !req.originalUrl.startsWith('/api/')) return res.redirect(`/cart/${cart.cartRef}`);
    return res.json({ cart: cartService.publicCart(cart) });
  } catch (error) { return next(error); }
}
async function checkout(req, res, next) {
  try {
    const result = await cartService.checkout(req.params.cartRef, req.body, req);
    if (req.accepts('html') && !req.originalUrl.startsWith('/api/')) {
      if (result.cart.status === 'payment_failed') return res.redirect(`/cart/${result.cart.cartRef}/recovery`);
      return res.redirect(`/booking/success/${result.booking.bookingRef}`);
    }
    return res.status(result.booking ? 201 : 409).json({ cart: cartService.publicCart(result.cart), booking: result.booking, payment: result.payment, attempt: result.attempt });
  } catch (error) { return next(error); }
}
async function recover(req, res, next) {
  try {
    const cart = await cartService.releaseRecoverableCart(req.params.cartRef, req.body.reason || 'customer_requested');
    if (req.accepts('html') && !req.originalUrl.startsWith('/api/')) return res.redirect(`/cart/${cart.cartRef}`);
    return res.json({ cart: cartService.publicCart(cart) });
  } catch (error) { return next(error); }
}
function show(req, res, next) {
  try {
    const cart = cartService.findCart(req.params.cartRef);
    if (!cart) return next();
    return res.json({ cart: cartService.publicCart(cart) });
  } catch (error) { return next(error); }
}

module.exports = { renderCart, renderRecovery, create, addItem, validate, checkout, recover, show };
