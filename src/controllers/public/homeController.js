const store = require('../../services/data/persistentStore');

function renderHome(req, res) {
  res.render('pages/home', {
    seo: { title: 'Classic Trip | Multi-Tenant Booking Platform', description: 'Book buses and hotels, discover routes, compare partners, and manage tickets.' },
    bootstrap: store.homeBootstrap(),
  });
}

module.exports = { renderHome };
