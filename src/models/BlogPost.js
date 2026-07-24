const { Schema, mediaSchema, model } = require('./_helpers');

const blogPostSchema = new Schema({
  id: { type: String, index: true },
  slug: { type: String, unique: true, index: true },
  tag: String,
  title: { type: String, text: true },
  excerpt: String,
  body: String,
  image: String,
  imageAlt: String,
  media: mediaSchema,
  status: { type: String, default: 'published', index: true, enum: ['published'] },
  publishedAt: Date,
}, { timestamps: true });

module.exports = model('BlogPost', blogPostSchema);
