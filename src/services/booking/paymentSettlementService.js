const { platformCurrency } = require('../../utils/currency');
const financeRepository = require('../../repositories/domain/financeRepository');
const promoterRepository = require('../../repositories/domain/promoterRepository');
const commissionService = require('../commission/commissionService');
const walletService = require('../wallet/walletService');
const calculateCommission = require('../../utils/calculateCommission');
const contentRepository = require('../../repositories/domain/contentRepository');

async function ensureMovement({ ownerType, ownerId, currency, amount, transactionType, status, pending, booking, session }) {
  if (!ownerId || Number(amount || 0) <= 0) return null;
  const filter = { ownerType, ownerId, transactionType, referenceType: 'booking', referenceId: booking.id };
  const existing = await financeRepository.transactions.findOne(filter, { session });
  if (existing) return existing;
  const meta = { transactionType, status, referenceType: 'booking', referenceId: booking.id, session, meta: { bookingRef: booking.bookingRef } };
  if (pending) return walletService.creditPending(ownerType, ownerId, currency, amount, meta);
  return walletService.creditAvailable(ownerType, ownerId, currency, amount, meta);
}

async function settleBookingPayment(bookingOrRef, options = {}) {
  const inputBooking = typeof bookingOrRef === 'object' ? bookingOrRef : null;
  const bookingRef = typeof bookingOrRef === 'string' ? bookingOrRef : bookingOrRef?.bookingRef;
  if (!bookingRef) return null;
  let settled;
  await financeRepository.withTransaction(async (session) => {
    const persisted = await financeRepository.bookings.findOne({ bookingRef }, { session });
    const booking = persisted ? { ...persisted, ...(inputBooking || {}) } : inputBooking;
    if (!booking || booking.paymentStatus !== 'successful') { settled = booking; return; }
    const serviceType = String(booking.serviceType || '').trim().toLowerCase();
    const hotelFulfilled = serviceType === 'hotel' && (
      ['completed', 'checked_out'].includes(String(booking.bookingStatus || '').trim().toLowerCase())
      || ['completed', 'checked_out'].includes(String(booking.hotelStay?.status || '').trim().toLowerCase())
      || Boolean(booking.completedAt || booking.checkOutAt)
    );
    const currentSettlement = String(booking.settlementStatus || '').trim().toLowerCase();
    const settlementTarget = serviceType === 'hotel'
      ? (currentSettlement === 'settled' ? 'settled' : (hotelFulfilled ? 'eligible' : 'pending_fulfillment'))
      : 'settled';
    const split = booking.pricing?.split || calculateCommission(booking.pricing?.total || 0, Boolean(booking.promoterAttribution), { commissionPercent: booking.commercialTermsSnapshot?.commissionPercent });
    const currency = booking.pricing?.currency || platformCurrency();
    await commissionService.createCommission(booking, Boolean(booking.promoterAttribution), split, { session });
    await ensureMovement({ ownerType: 'platform', ownerId: 'platform', currency, amount: split.platformFee, transactionType: 'platform_fee', status: 'completed', pending: false, booking, session });
    await ensureMovement({ ownerType: 'company', ownerId: booking.companyId, currency, amount: split.companyAmount, transactionType: 'company_earning_pending', status: 'pending', pending: true, booking, session });
    if (booking.promoterAttribution?.promoterId) {
      await ensureMovement({ ownerType: 'promoter', ownerId: booking.promoterAttribution.promoterId, currency, amount: split.promoterAmount, transactionType: 'promoter_commission_pending', status: 'pending', pending: true, booking, session });
    }
    booking.pricing = { ...(booking.pricing || {}), split };
    if (!booking.campaignCountedAt && booking.listingId) {
      const now = new Date();
      const campaign = await contentRepository.promotionCampaigns.findOne({
        listingId: booking.listingId,
        status: 'active',
        $and: [
          { $or: [{ startsAt: { $exists: false } }, { startsAt: null }, { startsAt: { $lte: now } }] },
          { $or: [{ endsAt: { $exists: false } }, { endsAt: null }, { endsAt: { $gte: now } }] },
        ],
      }, { session });
      if (campaign) {
        campaign.bookings = Number(campaign.bookings || 0) + 1;
        campaign.updatedAt = now.toISOString();
        await contentRepository.promotionCampaigns.save(campaign, { id: campaign.id }, { session });
        booking.campaignId = campaign.id;
        booking.campaignCountedAt = now.toISOString();
      }
    }
    booking.settlementStatus = settlementTarget;
    booking.settledAt = settlementTarget === 'settled' ? (booking.settledAt || new Date().toISOString()) : null;
    booking.settlementError = '';
    await financeRepository.bookings.save(booking, { bookingRef }, { session });
    settled = booking;
  });
  if (!settled) return settled;
  const [wallets, transactions, commissions] = await Promise.all([
    financeRepository.wallets.list({ $or: [{ ownerType: 'platform', ownerId: 'platform' }, { ownerType: 'company', ownerId: settled.companyId }, ...(settled.promoterAttribution?.promoterId ? [{ ownerType: 'promoter', ownerId: settled.promoterAttribution.promoterId }] : [])] }),
    financeRepository.transactions.list({ referenceType: 'booking', referenceId: settled.id }),
    financeRepository.commissions.list({ bookingId: settled.id }),
  ]);
  try {
    const promoterNetworkService = require('../promoter/promoterNetworkService');
    if (settled.promoterAttribution?.promoterId) {
      await promoterNetworkService.recordConversion(settled, options.source || 'booking');
      const promoterId = settled.promoterAttribution.promoterId;
      const selfReferral = String(settled.customerUserId || '') === String(promoterId)
        || String(settled.createdByAgentId || settled.agentId || '') === String(promoterId);
      if (selfReferral) {
        await promoterNetworkService.createFraudSignal({
          booking: settled,
          signalType: 'self_referral',
          severity: 'high',
          score: 90,
          reasons: ['Promoter or agent identity matches the booking customer/creator'],
          metadata: { source: options.source || 'booking' },
        });
      }
    }
  } catch (_) {}
  return settled;
}

module.exports = { settleBookingPayment };
