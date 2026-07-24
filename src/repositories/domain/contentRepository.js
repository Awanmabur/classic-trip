const { MongoCollection } = require('./mongoCollection');

module.exports = {
  blogs: new MongoCollection('blogPosts'),
  listings: new MongoCollection('listings'),
  categories: new MongoCollection('categories'),
  companies: new MongoCollection('companies'),
  reviews: new MongoCollection('reviews'),
  promotionCampaigns: new MongoCollection('promotionCampaigns'),
  platformSettings: new MongoCollection('platformSettings'),
  auditLogs: new MongoCollection('auditLogs'),
};
