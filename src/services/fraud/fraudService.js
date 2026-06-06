function scoreBookingRisk(booking) {
  let score = 0;
  if (booking.promoterAttribution && booking.customerUserId === booking.promoterAttribution.promoterId) score += 60;
  if (!booking.guestSnapshot?.email || !booking.guestSnapshot?.phone) score += 20;
  if ((booking.pricing?.total || 0) > 1000000) score += 15;
  if (booking.promoterAttribution && !booking.customerUserId) score += 5;
  return {
    score,
    level: score >= 60 ? 'high' : score >= 25 ? 'medium' : 'low',
    reasons: [
      booking.promoterAttribution && booking.customerUserId === booking.promoterAttribution.promoterId ? 'possible_self_referral' : '',
      !booking.guestSnapshot?.email || !booking.guestSnapshot?.phone ? 'missing_contact' : '',
      (booking.pricing?.total || 0) > 1000000 ? 'large_transaction' : '',
    ].filter(Boolean),
  };
}

function needsManualReview(risk = {}) {
  return risk.level === 'high' || Number(risk.score || 0) >= 60;
}

module.exports = { scoreBookingRisk, needsManualReview };
