const { credit, debit } = require("./wallet");
const { getPlatformUser } = require("./platform");

const PROMOTER_PERCENT = 3;
const PLATFORM_PERCENT_WITH_PROMOTER = 7;
const PLATFORM_PERCENT_WITHOUT_PROMOTER = 10;

function calculateSettlement(grossAmount, hasPromoter) {
  const roundedGross = Math.max(0, Number(grossAmount || 0));
  const promoterPercent = hasPromoter ? PROMOTER_PERCENT : 0;
  const platformPercent = hasPromoter ? PLATFORM_PERCENT_WITH_PROMOTER : PLATFORM_PERCENT_WITHOUT_PROMOTER;

  const promoterAmount = Math.round((roundedGross * promoterPercent) / 100);
  const platformAmount = Math.round((roundedGross * platformPercent) / 100);
  const ownerAmount = Math.max(0, roundedGross - promoterAmount - platformAmount);

  return {
    grossAmount: roundedGross,
    promoterPercent,
    promoterAmount,
    platformPercent,
    platformAmount,
    ownerPercent: roundedGross ? Number(((ownerAmount / roundedGross) * 100).toFixed(2)) : 0,
    ownerAmount
  };
}

async function settleBookingPayouts(booking, session = null) {
  const hasPromoter = Boolean(booking.referralUserId);
  const split = calculateSettlement(booking.grossAmount || booking.amount, hasPromoter);
  const platformUser = await getPlatformUser(session);

  if (split.promoterAmount && booking.referralUserId) {
    await credit(
      booking.referralUserId,
      split.promoterAmount,
      booking.currency,
      {
        type: "promoter_commission",
        bookingId: booking._id,
        sourceBookingId: booking._id,
        note: `Promoter share on booking ${booking._id.toString()}`
      },
      session
    );
  }

  if (split.platformAmount) {
    await credit(
      platformUser._id,
      split.platformAmount,
      booking.currency,
      {
        type: "platform_commission",
        bookingId: booking._id,
        sourceBookingId: booking._id,
        note: `Platform share on booking ${booking._id.toString()}`
      },
      session
    );
  }

  if (split.ownerAmount) {
    await credit(
      booking.ownerId,
      split.ownerAmount,
      booking.currency,
      {
        type: "operator_sale_share",
        bookingId: booking._id,
        sourceBookingId: booking._id,
        note: `Operator share on booking ${booking._id.toString()}`
      },
      session
    );
  }

  booking.referralPercent = split.promoterPercent;
  booking.promoterAmount = split.promoterAmount;
  booking.platformPercent = split.platformPercent;
  booking.platformAmount = split.platformAmount;
  booking.ownerPercent = split.ownerPercent;
  booking.ownerAmount = split.ownerAmount;
  booking.platformUserId = platformUser._id;
  booking.settlementStatus = "settled";

  return {
    ...split,
    platformUserId: platformUser._id
  };
}

async function reverseBookingPayouts(booking, session = null) {
  if (booking.settlementStatus !== "settled") return;

  if (booking.ownerAmount) {
    await debit(
      booking.ownerId,
      booking.ownerAmount,
      booking.currency,
      {
        type: "commission_reversal",
        bookingId: booking._id,
        sourceBookingId: booking._id,
        note: `Operator reversal on cancelled booking ${booking._id.toString()}`
      },
      session
    );
  }

  if (booking.platformAmount && booking.platformUserId) {
    await debit(
      booking.platformUserId,
      booking.platformAmount,
      booking.currency,
      {
        type: "commission_reversal",
        bookingId: booking._id,
        sourceBookingId: booking._id,
        note: `Platform reversal on cancelled booking ${booking._id.toString()}`
      },
      session
    );
  }

  if (booking.promoterAmount && booking.referralUserId) {
    await debit(
      booking.referralUserId,
      booking.promoterAmount,
      booking.currency,
      {
        type: "commission_reversal",
        bookingId: booking._id,
        sourceBookingId: booking._id,
        note: `Promoter reversal on cancelled booking ${booking._id.toString()}`
      },
      session
    );
  }

  booking.settlementStatus = "reversed";
}

module.exports = {
  PROMOTER_PERCENT,
  PLATFORM_PERCENT_WITH_PROMOTER,
  PLATFORM_PERCENT_WITHOUT_PROMOTER,
  calculateSettlement,
  settleBookingPayouts,
  reverseBookingPayouts
};
