const { Schema, model } = require('./_helpers');

const blogPostSchema = new Schema({
  id: { type: String, index: true },
  slug: { type: String, unique: true, index: true },
  tag: String,
  title: { type: String, text: true },
  excerpt: String,
  body: String,
  image: String,
  status: { type: String, default: 'published', index: true },
  publishedAt: Date,
}, { timestamps: true });

module.exports = model('BlogPost', blogPostSchema);
