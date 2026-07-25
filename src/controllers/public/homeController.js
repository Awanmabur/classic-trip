const catalogService = require('../../services/marketplace/catalogService');

async function renderHome(req, res, next) {
  try {
    res.render('pages/home', {
      seo: { title: 'Classic Trip | Multi-Tenant Booking Platform', description: 'Book buses, hotels, flights and local taxi rides across East Africa with protected payments, live inventory and secure trip documents.' },
      bootstrap: await catalogService.homeBootstrap(),
    });
  } catch (error) { next(error); }
}
module.exports = { renderHome };
