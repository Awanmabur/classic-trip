const store = require('../data/persistentStore');

const FUTURE_SERVICE_MODULES = [
  {
    key: 'flight',
    label: 'Flights',
    releaseStatus: 'teaser',
    bookable: false,
    bookingGuard: 'coming_soon_read_only',
    entities: ['airline', 'airport', 'flight_offer', 'flight_segment', 'pnr', 'passenger', 'baggage', 'ancillary', 'booking', 'payment', 'ticket', 'refund', 'notification', 'support'],
    workflows: ['search offers', 'hold offer', 'create PNR', 'take payment', 'issue e-ticket', 'refund/exchange support'],
    readinessChecklist: ['provider API integration', 'fare rules parser', 'PNR/ticketing certification', 'baggage/ancillary settlement', 'refund/exchange webhooks'],
  },
  {
    key: 'train',
    label: 'Trains',
    releaseStatus: 'architecture-ready',
    bookable: false,
    bookingGuard: 'coming_soon_read_only',
    entities: ['station', 'route', 'coach', 'seat', 'schedule', 'ticket', 'check_in', 'boarding', 'manifest'],
    workflows: ['publish train schedule', 'select coach/seat', 'issue rail ticket', 'QR boarding', 'manifest export'],
    readinessChecklist: ['operator station inventory', 'coach/seat templates', 'boarding scanner rules', 'route/schedule feed'],
  },
  {
    key: 'tour',
    label: 'Tours',
    releaseStatus: 'architecture-ready',
    bookable: false,
    bookingGuard: 'coming_soon_read_only',
    entities: ['package', 'tour_date', 'capacity', 'guide', 'pickup_point', 'participant', 'voucher', 'check_in'],
    workflows: ['publish package dates', 'reserve participant capacity', 'issue voucher', 'guide check-in'],
    readinessChecklist: ['guide assignment rules', 'participant waiver fields', 'capacity/cutoff controls', 'pickup manifest'],
  },
  {
    key: 'car_rental',
    label: 'Car rentals',
    releaseStatus: 'architecture-ready',
    bookable: false,
    bookingGuard: 'coming_soon_read_only',
    entities: ['vehicle', 'location', 'availability', 'driver_option', 'renter_documents', 'deposit', 'pickup', 'return', 'inspection', 'damage'],
    workflows: ['quote rental window', 'collect documents/deposit', 'pickup inspection', 'return inspection', 'damage/claim handling'],
    readinessChecklist: ['deposit provider rules', 'driver license validation', 'inspection media upload', 'damage charge authorization'],
  },
  {
    key: 'event',
    label: 'Events',
    releaseStatus: 'architecture-ready',
    bookable: false,
    bookingGuard: 'coming_soon_read_only',
    entities: ['venue', 'event', 'ticket_tier', 'seat_map', 'qr_entry', 'promoter_link'],
    workflows: ['publish event/tier', 'sell ticket/seat', 'QR entry validation', 'promoter conversion attribution'],
    readinessChecklist: ['venue/tier capacity locks', 'entry scanner permissions', 'organizer settlement rules'],
  },
  {
    key: 'cargo',
    label: 'Cargo',
    releaseStatus: 'architecture-ready',
    bookable: false,
    bookingGuard: 'coming_soon_read_only',
    entities: ['shipment', 'sender', 'receiver', 'route', 'waybill', 'tracking', 'payment', 'delivery_proof'],
    workflows: ['create shipment', 'pay waybill', 'track movement', 'capture delivery proof'],
    readinessChecklist: ['parcel rules', 'weight/dimension pricing', 'tracking updates', 'proof-of-delivery upload'],
  },
  {
    key: 'insurance',
    label: 'Travel insurance',
    releaseStatus: 'architecture-ready',
    bookable: false,
    bookingGuard: 'coming_soon_read_only',
    entities: ['policy', 'coverage', 'premium', 'beneficiary', 'claim_link'],
    workflows: ['quote policy', 'bind cover', 'issue certificate', 'link claim support'],
    readinessChecklist: ['underwriter integration', 'policy wording approval', 'certificate issuance', 'claim handoff process'],
  },
  {
    key: 'corporate_travel',
    label: 'Corporate travel',
    releaseStatus: 'architecture-ready',
    bookable: false,
    bookingGuard: 'coming_soon_read_only',
    entities: ['company_account', 'employee_traveler', 'approval_workflow', 'monthly_invoice', 'travel_policy'],
    workflows: ['employee request', 'manager approval', 'policy check', 'monthly invoice settlement'],
    readinessChecklist: ['company billing contract', 'approver hierarchy', 'policy engine', 'statement/invoice cycle'],
  },
  {
    key: 'loyalty',
    label: 'Loyalty',
    releaseStatus: 'architecture-ready',
    bookable: false,
    bookingGuard: 'coming_soon_read_only',
    entities: ['points', 'wallet_credit', 'coupon', 'tier', 'referral_reward'],
    workflows: ['earn points', 'redeem credits', 'coupon rules', 'tier upgrade', 'referral reward'],
    readinessChecklist: ['anti-fraud controls', 'expiry rules', 'ledger integration', 'refund reversals'],
  },
];

function modules() {
  const categories = store.state.categories || [];
  return FUTURE_SERVICE_MODULES.map((module) => {
    const category = categories.find((item) => item.key === module.key) || {};
    const listings = (store.state.listings || []).filter((listing) => listing.serviceType === module.key);
    return {
      ...module,
      icon: category.icon || 'fa-layer-group',
      release: category.release || module.releaseStatus,
      listingCount: listings.length,
      activeListingCount: listings.filter((listing) => listing.status === 'active').length,
      checkoutEnabled: false,
      publicMessage: `${module.label} are visible as a read-only future-service architecture module. Checkout stays disabled until the module is complete end to end and the feature flag is enabled.`,
    };
  });
}

function findModule(key) {
  const normalized = String(key || '').toLowerCase().replace(/-/g, '_');
  return modules().find((module) => module.key === normalized || module.label.toLowerCase() === normalized);
}

function assertCheckoutAllowed(serviceType) {
  const module = findModule(serviceType);
  if (!module) return true;
  const error = new Error(`${module.label} checkout is coming soon. This module is read-only behind feature flags until its full end-to-end flow is enabled.`);
  error.status = 409;
  error.code = 'FUTURE_SERVICE_COMING_SOON';
  error.module = module;
  throw error;
}

function reportRows() {
  return modules().map((module) => [
    module.key,
    module.label,
    module.releaseStatus,
    module.bookable ? 'yes' : 'no',
    module.entities.join(' | '),
    module.workflows.join(' | '),
    module.readinessChecklist.join(' | '),
  ]);
}

module.exports = { FUTURE_SERVICE_MODULES, modules, findModule, assertCheckoutAllowed, reportRows };
