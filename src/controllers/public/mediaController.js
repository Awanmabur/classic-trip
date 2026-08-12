'use strict';

const path = require('path');
const {
  SEEDED_BLOG_IMAGE_FILES,
  SEEDED_OPERATOR_IMAGE_FILES,
} = require('../../utils/seedMedia');

function sendBundledAsset(fileMap) {
  return (req, res, next) => {
    const key = String(req.params.slug || req.params.key || '').trim();
    const publicPath = fileMap[key];
    if (!publicPath) return next();
    const absolutePath = path.join(__dirname, '..', '..', '..', 'public', publicPath.replace(/^\//, ''));
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.sendFile(absolutePath, (error) => {
      if (error) return next(error);
      return undefined;
    });
  };
}

module.exports = {
  blog: sendBundledAsset(SEEDED_BLOG_IMAGE_FILES),
  operator: sendBundledAsset(SEEDED_OPERATOR_IMAGE_FILES),
};
