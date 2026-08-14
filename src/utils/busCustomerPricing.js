'use strict';

const { calculateCustomerFees } = require('./calculateCustomerFees');

function amount(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function serviceFeeForTicket(customerFare, currency = '') {
  const fare = amount(customerFare);
  if (!fare) return 0;
  return calculateCustomerFees(fare).totalFees;
}

function discountForTicket(partnerTicketAmount, { discountAmount = 0 } = {}) {
  const ticket = amount(partnerTicketAmount);
  return Math.min(ticket, Math.max(0, amount(discountAmount)));
}

function priceBusTicket({ partnerFare = 0, seatDelta = 0, discountAmount = 0, currency = '' } = {}) {
  const partnerTicketAmount = amount(Number(partnerFare || 0) + Number(seatDelta || 0));
  const discount = discountForTicket(partnerTicketAmount, { discountAmount });
  const customerFare = Math.max(0, partnerTicketAmount - discount);
  const serviceFee = serviceFeeForTicket(customerFare, currency);
  return {
    partnerTicketAmount,
    customerFare,
    discount,
    serviceFee,
    customerTotal: customerFare + serviceFee,
    currency: String(currency || '').toUpperCase(),
  };
}

module.exports = { serviceFeeForTicket, discountForTicket, priceBusTicket };
