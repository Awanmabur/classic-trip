const contentRepository = require('../../repositories/domain/contentRepository');
const seoService = require('../../services/seo/seoService');
const { blogPresentation } = require('../../config/launchMedia');

function text(value, max = 170) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

async function index(req, res, next) {
  try {
    return res.render('pages/blogs', {
      seo: {
        title: 'East Africa Travel Guides & Updates | Classic Trip',
        description: 'Read Classic Trip travel guides, booking tips, route updates and marketplace news for journeys across East Africa.',
        canonicalPath: '/blogs',
        schema: { '@type': 'Blog', name: 'Classic Trip travel guides' },
        breadcrumbs: [{ name: 'Home', url: '/' }, { name: 'Travel guides', url: '/blogs' }],
      },
      blogs: (await contentRepository.blogs.list({ status: 'published' }, { sort: { publishedAt: -1, createdAt: -1 }, limit: 200 })).map(blogPresentation),
    });
  } catch (error) { return next(error); }
}

async function show(req, res, next) {
  try {
    const foundBlog = await contentRepository.blogs.findOne({ slug: req.params.slug, status: 'published' });
    if (!foundBlog) return next();
    const blog = blogPresentation(foundBlog);
    const path = `/blogs/${blog.slug}`;
    const description = text(blog.excerpt || blog.body || `${blog.title} — a Classic Trip travel guide.`);
    return res.render('pages/blog-post', {
      seo: {
        title: `${blog.title} | Classic Trip`,
        description,
        canonicalPath: path,
        image: blog.image || blog.media?.url || '',
        imageAlt: blog.imageAlt || blog.title,
        type: 'article',
        schema: {
          '@type': 'BlogPosting',
          headline: blog.title,
          description,
          url: seoService.absoluteUrl(path),
          image: blog.image || blog.media?.url || undefined,
          datePublished: blog.publishedAt || blog.createdAt || undefined,
          dateModified: blog.updatedAt || undefined,
          author: { '@type': 'Organization', name: 'Classic Trip' },
          publisher: { '@type': 'Organization', name: 'Classic Trip' },
        },
        breadcrumbs: [
          { name: 'Home', url: '/' },
          { name: 'Travel guides', url: '/blogs' },
          { name: blog.title, url: path },
        ],
      },
      blog,
      relatedBlogs: (await contentRepository.blogs.list({ status: 'published', slug: { $ne: blog.slug } }, { sort: { publishedAt: -1, createdAt: -1 }, limit: 3 })).map((row) => ({ ...blogPresentation(row), url: `/blogs/${row.slug}` })),
    });
  } catch (error) { return next(error); }
}

module.exports = { index, show };
