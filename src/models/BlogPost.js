const { Schema, mediaSchema, model } = require('./_helpers');

const blogPostSchema = new Schema({
  id: { type: String },
  slug: { type: String, required: true, unique: true, index: true },
  tag: { type: String, default: 'Guide', index: true },
  title: { type: String, required: true, text: true },
  excerpt: String,
  body: String,
  image: String,
  imageAlt: String,
  media: mediaSchema,
  status: { type: String, default: 'draft', index: true, enum: ['draft', 'published', 'archived'] },
  publishedAt: Date,
  createdBy: { type: String, index: true },
  updatedBy: { type: String, index: true },
}, { timestamps: true });

blogPostSchema.index(
  { id: 1 },
  { name: 'blogpost_external_id_unique', unique: true, sparse: true },
);

module.exports = model('BlogPost', blogPostSchema);
