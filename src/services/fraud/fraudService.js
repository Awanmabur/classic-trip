function scoreBookingRisk(booking) {
  let score = 0;
  if (booking.promoterAttribution && booking.customerUserId === booking.promoterAttribution.promoterId) score += 60;
  if (!booking.guestSnapshot?.email || !booking.guestSnapshot?.phone) score += 20;
  if ((booking.pricing?.total || 0) > 1000000) score += 15;
  return { score, level: score >= 60 ? 'high' : score >= 25 ? 'medium' : 'low' };
}

module.exports = { scoreBookingRisk };
