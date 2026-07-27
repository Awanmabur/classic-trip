const catalogService = require('../../services/marketplace/catalogService');

async function renderHome(req, res, next) {
  try {
    res.render('pages/home', {
      seo: { title: 'Classic Trip | Multi-Tenant Booking Platform', description: 'Book buses, stays, Airbnb-style homes, flights, local taxi rides, tours, car rentals and cargo services across East Africa with protected payments, live inventory and secure trip documents.' },
      bootstrap: await catalogService.homeBootstrap(),
    });
  } catch (error) { next(error); }
}
module.exports = { renderHome };
