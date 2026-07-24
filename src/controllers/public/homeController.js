const catalogService = require('../../services/marketplace/catalogService');

async function renderHome(req, res, next) {
  try {
    res.render('pages/home', {
      seo: { title: 'Classic Trip | Multi-Tenant Booking Platform', description: 'Book buses and hotels, discover routes, compare partners, and manage tickets.' },
      bootstrap: await catalogService.homeBootstrap(),
    });
  } catch (error) { next(error); }
}
module.exports = { renderHome };
