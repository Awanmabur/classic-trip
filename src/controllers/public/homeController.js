const catalogService = require('../../services/marketplace/catalogService');

async function renderHome(req, res, next) {
  try {
    res.render('pages/home', {
      seo: { title: 'Classic Trip | Book Buses, Stays, Flights & Travel in East Africa', description: 'Search and book verified buses, stays, flights, local rides, tours, car rentals and cargo across East Africa with live availability and secure payments.' },
      bootstrap: await catalogService.homeBootstrap(),
    });
  } catch (error) { next(error); }
}
module.exports = { renderHome };
