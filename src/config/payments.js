const { env } = require('./env');
const paymentService = require('../services/payment/paymentService');

module.exports = {
  provider: env.paymentProvider,
  webhookSecret: env.paymentWebhookSecret,
  supportedProviders: paymentService.supportedProviders,
  providers: env.paymentProviders,
};
