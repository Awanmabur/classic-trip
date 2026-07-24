'use strict';

const crypto = require('crypto');
const inventoryService = require('./busInventoryService');
const { env } = require('../../../config/env');
const { cleanText, validationError, conflictError } = require('../domain/busDomain');

const SESSION_KEY = 'busBookingDrafts';
const MAX_SESSION_DRAFTS = 8;
const DRAFT_GRACE_MS = 30_000;
const DRAFT_LIFETIME_MS = 60 * 60 * 1000;


const TOKEN_CIPHER = 'aes-256-gcm';
const TOKEN_KEY = crypto.createHash('sha256').update(`classic-trip:bus-booking-draft:${env.sessionSecret}`).digest();

function sealToken(token) {
  const value = cleanText(token, 500);
  if (!value) throw validationError('Seat-hold access token is required', 403);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(TOKEN_CIPHER, TOKEN_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

function openToken(sealed) {
  const [version, ivValue, tagValue, ciphertextValue] = String(sealed || '').split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue) throw validationError('Secure booking draft is invalid', 403);
  try {
    const decipher = crypto.createDecipheriv(TOKEN_CIPHER, TOKEN_KEY, Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, 'base64url')), decipher.final()]).toString('utf8');
  } catch (_) {
    throw validationError('Secure booking draft cannot be decrypted', 403);
  }
}

function listCsv(value) {
  return [...new Set((Array.isArray(value) ? value : String(value || '').split(','))
    .map((item) => cleanText(item, 80).toUpperCase())
    .filter(Boolean))];
}


function listValues(value, maxLength = 180) {
  return [...new Set((Array.isArray(value) ? value : String(value || '').split(','))
    .map((item) => cleanText(item, maxLength))
    .filter(Boolean))];
}

function sorted(values = []) {
  return [...values].map((item) => String(item || '').trim().toUpperCase()).filter(Boolean).sort();
}

function sameValues(left = [], right = []) {
  const a = sorted(left);
  const b = sorted(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function requireSession(req) {
  if (!req?.session) throw validationError('A secure browser session is required to continue booking', 403);
  return req.session;
}

function sessionDrafts(req) {
  const session = requireSession(req);
  if (!session[SESSION_KEY] || typeof session[SESSION_KEY] !== 'object' || Array.isArray(session[SESSION_KEY])) {
    session[SESSION_KEY] = {};
  }
  return session[SESSION_KEY];
}

function purgeExpired(req) {
  const drafts = sessionDrafts(req);
  const now = Date.now();
  for (const [id, draft] of Object.entries(drafts)) {
    const expiresAt = new Date(draft?.expiresAt || draft?.createdAt || 0).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt + DRAFT_GRACE_MS <= now) delete drafts[id];
  }
  const remaining = Object.values(drafts).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  for (const draft of remaining.slice(MAX_SESSION_DRAFTS)) delete drafts[draft.id];
  return drafts;
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    if (!req?.session?.save) return resolve();
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function legInput(payload = {}, isReturn = false) {
  return {
    legType: isReturn ? 'return' : 'outbound',
    holdId: cleanText(isReturn ? payload.returnHoldId : payload.holdId, 180),
    holdToken: cleanText(isReturn ? payload.returnHoldToken : payload.holdToken, 500),
    scheduleId: cleanText(isReturn ? payload.returnScheduleId : payload.scheduleId, 180),
    originStopId: cleanText(isReturn ? payload.returnOriginStopId : payload.originStopId, 180),
    destinationStopId: cleanText(isReturn ? payload.returnDestinationStopId : payload.destinationStopId, 180),
    selectedSeats: listCsv(isReturn ? payload.returnSeats : (payload.selectedSeats || payload.selected)),
  };
}

async function validateLeg(input, { listing, outboundHold = null, req = null } = {}) {
  let hold;
  let token = input.holdToken;
  let createdInternally = false;
  if (input.holdId) {
    if (!token) throw validationError(`The ${input.legType} seat-hold access token is required`, 403);
    hold = await inventoryService.assertActiveHold(input.holdId, token);
  } else {
    if (!input.scheduleId || !input.originStopId || !input.destinationStopId || !input.selectedSeats.length) {
      throw validationError(`Select a ${input.legType} departure, boarding point, drop-off point, and seats before continuing`);
    }
    hold = await inventoryService.holdSeats({
      scheduleId: input.scheduleId,
      originStopId: input.originStopId,
      destinationStopId: input.destinationStopId,
      selectedSeats: input.selectedSeats,
      context: {
        createdBy: req?.session?.user?.id || 'guest',
        ip: req?.ip || '',
        userAgent: req?.headers?.['user-agent'] || '',
        requestId: req?.id || req?.headers?.['x-request-id'] || '',
        source: `checkout_continue_${input.legType}`,
      },
    });
    token = hold.accessToken;
    createdInternally = true;
  }
  if (input.scheduleId && String(hold.scheduleId) !== input.scheduleId) throw validationError(`${input.legType} hold belongs to another departure`, 403);
  if (input.originStopId && String(hold.originStopId) !== input.originStopId) throw validationError(`${input.legType} boarding point does not match the held journey`, 403);
  if (input.destinationStopId && String(hold.destinationStopId) !== input.destinationStopId) throw validationError(`${input.legType} drop-off point does not match the held journey`, 403);
  if (input.selectedSeats.length && !sameValues(input.selectedSeats, hold.seatNumbers || hold.seatNumber)) {
    throw validationError(`${input.legType} seats do not match the active hold`, 403);
  }
  if (!outboundHold && String(hold.listingId) !== String(listing.id)) throw validationError('Seat hold belongs to another listing', 403);
  if (outboundHold) {
    if (String(hold.companyId) !== String(outboundHold.companyId)) throw validationError('Round-trip legs must belong to the same bus company', 403);
    if (String(hold.originStopId) !== String(outboundHold.destinationStopId) || String(hold.destinationStopId) !== String(outboundHold.originStopId)) {
      throw validationError('Return journey must reverse the outbound origin and destination', 403);
    }
    if (!sameValues(hold.seatNumbers || hold.seatNumber, outboundHold.seatNumbers || outboundHold.seatNumber)) {
      const outboundCount = listCsv(outboundHold.seatNumbers || outboundHold.seatNumber).length;
      const returnCount = listCsv(hold.seatNumbers || hold.seatNumber).length;
      if (outboundCount !== returnCount) throw validationError('Outbound and return holds must contain the same passenger count', 403);
    }
  }
  return { hold, token, createdInternally };
}

function snapshotLeg(hold, token, legType) {
  return {
    legType,
    holdId: hold.id,
    accessTokenCiphertext: sealToken(token),
    scheduleId: hold.scheduleId,
    listingId: hold.listingId,
    companyId: hold.companyId,
    routeId: hold.routeId,
    originStopId: hold.originStopId,
    destinationStopId: hold.destinationStopId,
    selectedSeats: listCsv(hold.seatNumbers || hold.seatNumber),
    expiresAt: hold.expiresAt,
  };
}


function assertHoldMatchesDraft(hold, leg, label) {
  if (String(hold.id) !== String(leg.holdId)
    || String(hold.scheduleId) !== String(leg.scheduleId)
    || String(hold.listingId) !== String(leg.listingId)
    || String(hold.companyId) !== String(leg.companyId)
    || String(hold.routeId) !== String(leg.routeId)
    || String(hold.originStopId) !== String(leg.originStopId)
    || String(hold.destinationStopId) !== String(leg.destinationStopId)
    || !sameValues(hold.seatNumbers || hold.seatNumber, leg.selectedSeats)) {
    throw validationError(`${label} booking draft no longer matches the active hold`, 403);
  }
}


function holdCanBeReacquired(error) {
  return Number(error?.status) === 404 || String(error?.code || '') === 'hold_expired';
}

async function resolveOrReacquireLeg(req, draft, key, listing, outboundHold = null) {
  const leg = draft[key];
  if (!leg) return { hold: null, reacquired: false };
  const token = openToken(leg.accessTokenCiphertext);
  try {
    const hold = await inventoryService.assertActiveHold(leg.holdId, token);
    assertHoldMatchesDraft(hold, leg, key === 'outbound' ? 'Outbound' : 'Return');
    return { hold, reacquired: false };
  } catch (error) {
    if (!holdCanBeReacquired(error)) throw error;
    const hold = await inventoryService.holdSeats({
      scheduleId: leg.scheduleId,
      originStopId: leg.originStopId,
      destinationStopId: leg.destinationStopId,
      selectedSeats: leg.selectedSeats,
      context: {
        createdBy: req?.session?.user?.id || 'guest',
        ip: req?.ip || '',
        userAgent: req?.headers?.['user-agent'] || '',
        requestId: req?.id || req?.headers?.['x-request-id'] || '',
        source: `checkout_reacquire_${leg.legType}`,
      },
    });
    if (String(hold.listingId) !== String(listing.id)) {
      await inventoryService.releaseHold(hold.id, 'booking_draft_scope_mismatch', 'booking-draft');
      throw validationError('Seat selection belongs to another listing', 403);
    }
    if (outboundHold) {
      const sameCompany = String(hold.companyId) === String(outboundHold.companyId);
      const reverseJourney = String(hold.originStopId) === String(outboundHold.destinationStopId)
        && String(hold.destinationStopId) === String(outboundHold.originStopId);
      const samePassengerCount = listCsv(hold.seatNumbers || hold.seatNumber).length
        === listCsv(outboundHold.seatNumbers || outboundHold.seatNumber).length;
      if (!sameCompany || !reverseJourney || !samePassengerCount) {
        await inventoryService.releaseHold(hold.id, 'booking_draft_return_mismatch', 'booking-draft');
        throw validationError('Return journey no longer matches the outbound selection', 409);
      }
    }
    draft[key] = snapshotLeg(hold, hold.accessToken, leg.legType);
    return { hold, reacquired: true };
  }
}

async function createDraft(req, { listing, payload = {} } = {}) {
  if (!listing || String(listing.serviceType || '').toLowerCase() !== 'bus') throw validationError('Secure bus booking draft requires a bus listing');
  const outboundInput = legInput(payload, false);
  const outboundResult = await validateLeg(outboundInput, { listing, req });
  const outboundHold = outboundResult.hold;
  const returnInput = legInput(payload, true);
  const wantsReturn = Boolean(returnInput.holdId || returnInput.holdToken || returnInput.scheduleId || returnInput.selectedSeats.length);
  let returnResult = null;
  let returnHold = null;
  try {
    if (wantsReturn) {
      returnResult = await validateLeg(returnInput, { listing, outboundHold, req });
      returnHold = returnResult.hold;
    }
  } catch (error) {
    if (outboundResult.createdInternally) await inventoryService.releaseHold(outboundHold.id, 'return_checkout_prepare_failed', 'booking-draft');
    throw error;
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + DRAFT_LIFETIME_MS).toISOString();
  const inventoryExpiresAt = new Date(Math.min(
    new Date(outboundHold.expiresAt).getTime(),
    returnHold ? new Date(returnHold.expiresAt).getTime() : Number.POSITIVE_INFINITY,
  )).toISOString();
  const draft = {
    id,
    serviceType: 'bus',
    listingId: listing.id,
    listingSlug: listing.slug,
    referralCode: cleanText(payload.ref, 180),
    addonIds: listValues(payload.addons),
    outbound: snapshotLeg(outboundHold, outboundResult.token, 'outbound'),
    return: returnHold ? snapshotLeg(returnHold, returnResult.token, 'return') : null,
    passengerCount: listCsv(outboundHold.seatNumbers || outboundHold.seatNumber).length,
    createdAt,
    expiresAt,
    inventoryExpiresAt,
  };
  const drafts = purgeExpired(req);
  drafts[id] = draft;
  purgeExpired(req);
  await saveSession(req);
  return {
    id,
    expiresAt,
    inventoryExpiresAt,
    redirectUrl: `/book/bus/${encodeURIComponent(listing.slug)}?draft=${encodeURIComponent(id)}`,
  };
}

async function resolveDraft(req, { draftId, listing } = {}) {
  const id = cleanText(draftId, 80);
  if (!id) throw conflictError('Choose your journey and seats before opening checkout', 'booking_draft_required');
  const draft = purgeExpired(req)[id];
  if (!draft) throw conflictError('The secure booking draft expired. Select the seats again.', 'booking_draft_expired');
  if (!listing || String(draft.listingId) !== String(listing.id) || String(draft.listingSlug) !== String(listing.slug)) {
    throw validationError('Booking draft belongs to another listing', 403);
  }
  const outboundResult = await resolveOrReacquireLeg(req, draft, 'outbound', listing);
  try {
    if (draft.return) await resolveOrReacquireLeg(req, draft, 'return', listing, outboundResult.hold);
  } catch (error) {
    if (outboundResult.reacquired) await inventoryService.releaseHold(outboundResult.hold.id, 'return_reacquire_failed', 'booking-draft');
    throw error;
  }
  draft.inventoryExpiresAt = new Date(Math.min(
    new Date(draft.outbound.expiresAt).getTime(),
    draft.return ? new Date(draft.return.expiresAt).getTime() : Number.POSITIVE_INFINITY,
  )).toISOString();
  if (outboundResult.reacquired || draft.return) await saveSession(req);
  return draft;
}

async function applyDraftToPayload(req, payload = {}, listing = null) {
  const draft = await resolveDraft(req, { draftId: payload.bookingDraftId, listing });
  return {
    ...payload,
    listingId: draft.listingId,
    holdId: draft.outbound.holdId,
    holdToken: openToken(draft.outbound.accessTokenCiphertext),
    scheduleId: draft.outbound.scheduleId,
    selected: draft.outbound.selectedSeats.join(','),
    selectedSeats: draft.outbound.selectedSeats.join(','),
    originStopId: draft.outbound.originStopId,
    destinationStopId: draft.outbound.destinationStopId,
    passengerCount: draft.passengerCount,
    returnHoldId: draft.return?.holdId || '',
    returnHoldToken: draft.return ? openToken(draft.return.accessTokenCiphertext) : '',
    returnScheduleId: draft.return?.scheduleId || '',
    returnSeats: draft.return?.selectedSeats?.join(',') || '',
    returnOriginStopId: draft.return?.originStopId || '',
    returnDestinationStopId: draft.return?.destinationStopId || '',
    addons: draft.addonIds,
    ref: cleanText(payload.ref || draft.referralCode, 180),
  };
}

async function discardDraft(req, draftId) {
  if (!req?.session) return;
  const drafts = purgeExpired(req);
  delete drafts[cleanText(draftId, 80)];
  await saveSession(req);
}

module.exports = {
  createDraft,
  resolveDraft,
  applyDraftToPayload,
  discardDraft,
};
