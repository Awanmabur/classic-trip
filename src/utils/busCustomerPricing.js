'use strict';

const FULL_ROUTE_DISCOUNT_UGX = 3000;
const MIN_CUSTOMER_FARE_UGX = 1000;

function amount(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function isUgx(currency) {
  return String(currency || '').trim().toUpperCase() === 'UGX';
}

function serviceFeeForTicket(partnerTicketAmount, currency = 'UGX') {
  const ticket = amount(partnerTicketAmount);
  if (!ticket || !isUgx(currency) || ticket < 1000) return 0;
  if (ticket <= 30000) return 1000;
  if (ticket <= 100000) return 2000;
  if (ticket <= 150000) return 3000;
  return 5000;
}

function discountForTicket(partnerTicketAmount, { isMainRoute = false, currency = 'UGX' } = {}) {
  const ticket = amount(partnerTicketAmount);
  if (!ticket || !isMainRoute || !isUgx(currency)) return 0;
  // Never turn a very low fare into a zero/negative customer price.
  return Math.min(FULL_ROUTE_DISCOUNT_UGX, Math.max(0, ticket - MIN_CUSTOMER_FARE_UGX));
}

function priceBusTicket({ partnerFare = 0, seatDelta = 0, isMainRoute = false, currency = 'UGX' } = {}) {
  const partnerTicketAmount = amount(Number(partnerFare || 0) + Number(seatDelta || 0));
  const discount = discountForTicket(partnerTicketAmount, { isMainRoute, currency });
  const customerFare = Math.max(0, partnerTicketAmount - discount);
  const serviceFee = serviceFeeForTicket(customerFare, currency);
  return {
    partnerTicketAmount,
    customerFare,
    discount,
    serviceFee,
    customerTotal: customerFare + serviceFee,
    isMainRoute: Boolean(isMainRoute),
    currency: String(currency || 'UGX').toUpperCase(),
  };
}

module.exports = {
  FULL_ROUTE_DISCOUNT_UGX,
  MIN_CUSTOMER_FARE_UGX,
  serviceFeeForTicket,
  discountForTicket,
  priceBusTicket,
};
