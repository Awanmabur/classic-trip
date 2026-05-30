const crypto = require("crypto");
const { APP_URL } = require("../../../config/app");

function makeProviderReference(prefix = "MOCK") {
  return `${prefix}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

function normalizeProvider(provider = "") {
  const value = String(provider || "mock").trim().toLowerCase();
  return value === "mock" ? value : "mock";
}

function buildMockCheckout(payment) {
  const baseUrl = APP_URL.replace(/\/+$/, "");
  return {
    provider: "mock",
    providerReference: makeProviderReference(),
    checkoutUrl: `${baseUrl}/api/public/payments/${payment._id}/mock-complete?status=success`
  };
}

function createCheckoutPayload(payment, provider = "mock") {
  const resolvedProvider = normalizeProvider(provider);

  if (resolvedProvider === "mock") {
    return buildMockCheckout(payment);
  }

  return buildMockCheckout(payment);
}

module.exports = {
  normalizeProvider,
  createCheckoutPayload
};
