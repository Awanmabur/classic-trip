const { env } = require('./env');

module.exports = {
  provider: env.paymentProvider,
  webhookSecret: env.paymentWebhookSecret,
  supportedProviders: ['mock', 'mtn_momo', 'airtel_money', 'flutterwave', 'paystack', 'dpo'],
};
