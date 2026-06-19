const futureServiceArchitecture = require('../../services/release/futureServiceArchitecture');

function index(req, res) {
  res.render('pages/future-services', {
    seo: { title: 'Future services architecture | Classic Trip' },
    modules: futureServiceArchitecture.modules(),
  });
}

function show(req, res, next) {
  const module = futureServiceArchitecture.findModule(req.params.serviceType);
  if (!module) return next();
  res.status(200).render('pages/future-service-detail', {
    seo: { title: `${module.label} coming soon | Classic Trip` },
    module,
  });
}

function json(req, res) {
  res.json({ modules: futureServiceArchitecture.modules() });
}

module.exports = { index, show, json };
