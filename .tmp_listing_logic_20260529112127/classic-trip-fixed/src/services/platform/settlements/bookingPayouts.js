const { credit, debit } = require("../../shared/wallet");
const { getPlatformUser } = require("../admin");
const { calculateSettlement } = require("./calculator");

async function settleBookingPayouts(booking, session = null) {
  if (booking.settlementStatus === "settled") {
    return {
      grossAmount: Number(booking.grossAmount || booking.amount || 0),
      promoterPercent: Number(booking.referralPercent || 0),
      promoterAmount: Number(booking.promoterAmount || 0),
      platformPercent: Number(booking.platformPercent || 0),
      platformAmount: Number(booking.platformAmount || 0),
      ownerPercent: Number(booking.ownerPercent || 0),
      ownerAmount: Number(booking.ownerAmount || 0),
      platformUserId: booking.platformUserId || null
    };
  }

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
  settleBookingPayouts,
  reverseBookingPayouts
};
