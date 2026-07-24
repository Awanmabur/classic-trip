const contentRepository = require('../../repositories/domain/contentRepository');
async function index(req, res, next) {
  try { res.render('pages/blogs', { seo: { title: 'Classic Trip blog' }, blogs: await contentRepository.blogs.list({ status: 'published' }, { sort: { publishedAt: -1, createdAt: -1 }, limit: 200 }) }); }
  catch (error) { next(error); }
}
async function show(req, res, next) {
  try {
    const blog = await contentRepository.blogs.findOne({ slug: req.params.slug, status: 'published' });
    if (!blog) return next();
    return res.render('pages/blog-post', { seo: { title: `${blog.title} | Classic Trip` }, blog });
  } catch (error) { return next(error); }
}
module.exports = { index, show };
