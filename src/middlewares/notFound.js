function notFound(req, res) {
  res.status(404).render('pages/error', {
    seo: { title: 'Page not found | Classic Trip', robots: 'noindex,nofollow' },
    status: 404,
    message: 'This Classic Trip page was not found.',
  });
}

module.exports = notFound;
