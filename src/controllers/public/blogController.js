const store = require('../../services/data/demoStore');

function index(req, res) {
  res.render('pages/blogs', { seo: { title: 'Classic Trip blog' }, blogs: store.state.blogs });
}

function show(req, res, next) {
  const blog = store.state.blogs.find((item) => item.slug === req.params.slug);
  if (!blog) return next();
  return res.render('pages/blog-post', { seo: { title: `${blog.title} | Classic Trip` }, blog });
}

module.exports = { index, show };
