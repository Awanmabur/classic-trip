const fs = require('fs');
const path = require('path');
const store = require('../data/persistentStore');
const repositories = require('../../repositories');

const root = path.join(__dirname, '..', '..', '..');

const SECTIONS = [
  {
    id: 'A',
    title: 'Super Admin controlled partner and driver onboarding',
    requirements: [
      'Public lead/session request page',
      'Super Admin lead pipeline',
      'Discovery session scheduling and notes',
      'Agreement record with terms, commission/subscription plan, documents, dates and approval history',
      'Secure invitations for companies, drivers, hotels, fleet owners, promoters, agents and providers',
      'Invite resend, revoke, expire, accept, reject and audit log',
      'Account setup with verification, documents and profile completion',
      'Verification checklist before activation',
    ],
    files: [
      'src/controllers/admin/partnerPipelineController.js',
      'src/controllers/admin/invitationController.js',
      'src/controllers/admin/verificationController.js',
      'src/controllers/public/invitationController.js',
      'src/services/onboarding/partnerPipelineService.js',
      'src/services/onboarding/invitationService.js',
      'src/services/onboarding/verificationService.js',
      'src/models/PartnerLead.js',
      'src/models/DiscoverySession.js',
      'src/models/Agreement.js',
      'src/models/Invitation.js',
      'src/models/VerificationReview.js',
      'src/views/pages/partner-onboarding.ejs',
      'src/views/pages/invite-accept.ejs',
    ],
    collections: ['partnerLeads', 'discoverySessions', 'agreements', 'invitations', 'verificationReviews', 'auditLogs', 'notifications'],
    tests: ['tests/integration/onboardingAComplete.test.js'],
  },
  {
    id: 'B',
    title: 'Company and driver operations',
    requirements: [
      'Company profile, branches, documents, staff, roles, policies, service categories, contacts and payout account',
      'Driver profile, license, documents, fleet/company assignments, schedules, safety status and trip history',
      'Company driver invite request with Super Admin approval gate',
      'Driver dashboard with trips, vehicle, manifest, customer list, seat map, check-in assistance, incidents and trip status',
    ],
    files: [
      'src/controllers/company/operationsController.js',
      'src/controllers/company/employeeController.js',
      'src/controllers/employee/driverController.js',
      'src/services/company/companyService.js',
      'src/services/operations/manifestService.js',
      'src/models/CompanyBranch.js',
      'src/models/CompanyPolicy.js',
      'src/models/DriverAssignment.js',
      'src/models/DriverIncident.js',
      'src/models/TripStatusUpdate.js',
      'src/views/pages/driver-manifest-print.ejs',
      'src/views/pages/driver-ticket-detail.ejs',
    ],
    collections: ['companies', 'companyBranches', 'companyPolicies', 'companyEmployees', 'driverAssignments', 'driverIncidents', 'tripStatusUpdates'],
    tests: ['tests/integration/companyDriverOperationsB.test.js'],
  },
  {
    id: 'C',
    title: 'Bus booking and route operations',
    requirements: [
      'Routes with stops, terminals, duration, policies and active/inactive status',
      'Vehicles with plate, capacity, seat layout, amenities, maintenance/blocking and driver/schedule assignment',
      'Visual seat map for customer, company, driver and employee scanner pages',
      'Seat statuses: available, selected, held, booked, checked-in, no-show, cancelled, refunded, blocked, maintenance, reserved and disabled',
      'Private passenger data hidden from customer view and visible to authorized operational roles',
      'Schedule pages show booked/held/remaining seats, revenue, passengers, check-ins, no-shows and printable manifest',
      'One-way, round-trip, multi-city architecture and group/multi-ticket purchase',
      'Separate passenger details, tickets and QR per leg',
    ],
    files: [
      'src/controllers/company/routeController.js',
      'src/controllers/company/vehicleController.js',
      'src/controllers/company/scheduleController.js',
      'src/services/booking/bookingService.js',
      'src/services/booking/seatLockService.js',
      'src/services/data/persistentStore.js',
      'src/models/Route.js',
      'src/models/RouteStop.js',
      'src/models/Vehicle.js',
      'src/models/TripSchedule.js',
      'src/models/Seat.js',
      'src/models/InventoryHold.js',
    ],
    collections: ['routes', 'routeStops', 'vehicles', 'schedules', 'seats', 'inventoryHolds', 'bookings', 'passengers'],
    tests: ['tests/integration/busOperationsC.test.js', 'tests/integration/bookingFlow.test.js'],
  },
  {
    id: 'D',
    title: 'Hotel and room booking',
    requirements: [
      'Hotel properties, room types, units, nightly inventory, pricing, amenities, images, policies, taxes and availability',
      'Room map/list statuses: available, held, booked, occupied, maintenance, cleaning, reserved, cancelled and refunded',
      'Customer books one or multiple rooms and enters guest details',
      'Employees/admins open booked room/night details',
      'Hotel manifest/list for arrivals, in-house guests, departures, room status and PDF',
    ],
    files: [
      'src/controllers/company/hotelController.js',
      'src/controllers/public/hotelBookingController.js',
      'src/services/hotel/hotelService.js',
      'src/services/booking/roomReservationService.js',
      'src/models/HotelProperty.js',
      'src/models/RoomType.js',
      'src/models/RoomUnit.js',
      'src/models/RoomNightInventory.js',
      'src/models/StayRule.js',
      'src/views/pages/hotel-manifest-print.ejs',
    ],
    collections: ['hotelProperties', 'roomTypes', 'roomUnits', 'roomNightInventories', 'stayRules', 'rooms', 'bookings'],
    tests: ['tests/integration/hotelOperationsD.test.js'],
  },
  {
    id: 'E',
    title: 'Multi-service cart and checkout',
    requirements: [
      'One cart can contain bus tickets, hotel rooms, future services and add-ons',
      'Cart validates inventory, pricing, service rules, passenger details, coupons, attribution and taxes before payment',
      'One payment transaction can create many booking items and tickets',
      'Partial payment or inventory failure has recovery state',
    ],
    files: [
      'src/controllers/public/cartController.js',
      'src/services/cart/cartService.js',
      'src/services/payment/paymentService.js',
      'src/models/Cart.js',
      'src/models/CartCheckoutAttempt.js',
      'src/models/PaymentIntent.js',
      'src/views/pages/cart-checkout.ejs',
    ],
    collections: ['carts', 'cartCheckoutAttempts', 'paymentIntents', 'bookings', 'payments', 'receiptInvoices'],
    tests: ['tests/integration/multiServiceCartE.test.js'],
  },
  {
    id: 'F',
    title: 'Customer, passenger and printable manifest pages',
    requirements: [
      'Filterable customer list by route, schedule, vehicle, driver, company, terminal, date, ticket, check-in, payment, promoter and source',
      'Print-ready/PDF-ready manifest with trip header, vehicle, driver, route, departure, seats, passengers, contacts, pickup/dropoff, ticket, payment, check-in, notes and signatures',
      'CSV, Excel and PDF export',
      'Before-departure and after-check-in print modes',
    ],
    files: [
      'src/services/operations/manifestService.js',
      'src/controllers/employee/manifestController.js',
      'src/views/pages/company-customer-manifest.ejs',
      'src/views/pages/driver-manifest-print.ejs',
    ],
    collections: ['bookings', 'passengers', 'ticketScans'],
    tests: ['tests/integration/customerPassengerManifestF.test.js', 'tests/integration/driverManifestPrint.test.js'],
  },
  {
    id: 'G',
    title: 'Ticket, QR and check-in',
    requirements: [
      'Each ticket has secure non-guessable QR token and hash',
      'QR token is one-time-use per ticket leg',
      'Ticket page shows booking, passenger, service, leg, seat/room, payment and status',
      'Scanner validates scope, role, status, payment, cancellation/refund and duplicate scan',
      'Manual check-in fallback exists',
      'Scan history records who, where, when, result, source and reason',
    ],
    files: [
      'src/services/qr/qrService.js',
      'src/services/qr/ticketScanService.js',
      'src/controllers/employee/scannerController.js',
      'src/controllers/company/checkinController.js',
      'src/models/TicketScan.js',
      'src/views/pages/ticket.ejs',
      'src/views/pages/driver-ticket-detail.ejs',
    ],
    collections: ['ticketScans', 'bookings', 'auditLogs'],
    tests: ['tests/integration/ticketQrCheckinG.test.js'],
  },
  {
    id: 'H',
    title: 'Correspondence and support',
    requirements: [
      'Message center linked to booking, company, ticket, refund, support case, agreement, verification, driver and customer',
      'Internal notes separated from customer-visible messages',
      'Email/SMS/WhatsApp/in-app notification delivery attempts logged',
      'Important actions appear in booking activity timeline',
    ],
    files: [
      'src/services/support/correspondenceService.js',
      'src/services/support/timelineService.js',
      'src/services/notification/notificationService.js',
      'src/models/CorrespondenceMessage.js',
      'src/models/BookingTimelineEvent.js',
      'src/models/NotificationDeliveryAttempt.js',
    ],
    collections: ['correspondenceMessages', 'bookingTimelineEvents', 'notificationDeliveryAttempts', 'supportTickets'],
    tests: ['tests/integration/correspondenceSupportH.test.js', 'tests/integration/supportTimeline.test.js'],
  },
  {
    id: 'I',
    title: 'Finance, wallet, commission and settlement',
    requirements: [
      'Payment intents, transactions, receipts, invoices, refunds, wallets, ledger, commission, settlement, payout and reconciliation records',
      'Commission split: promoter 3%, platform 7%, company 90%; no promoter platform 10%, company 90%; agreement overrides',
      'Company and promoter earnings pending until completion/check-in',
      'Refunds reverse/adjust ledger entries',
      'Super Admin controls payout approvals, exports, failures and reconciliation',
    ],
    files: [
      'src/services/payment/paymentService.js',
      'src/services/payment/webhookService.js',
      'src/services/wallet/ledgerService.js',
      'src/services/wallet/walletService.js',
      'src/services/commission/commissionService.js',
      'src/services/finance/settlementService.js',
      'src/models/SettlementBatch.js',
      'src/models/PayoutRequest.js',
      'src/models/PayoutBatch.js',
      'src/models/ReconciliationReport.js',
    ],
    collections: ['paymentIntents', 'payments', 'receiptInvoices', 'refundRequests', 'wallets', 'walletTransactions', 'commissions', 'settlementBatches', 'payoutRequests', 'payoutBatches', 'reconciliationReports'],
    tests: ['tests/integration/financeWalletSettlementI.test.js', 'tests/integration/financeSettlement.test.js'],
  },
  {
    id: 'J',
    title: 'Promoter and agent system',
    requirements: [
      'Promoter profiles, referral links, QR cards, campaigns, clicks, conversions, commission states, withdrawals and fraud review',
      'Agent/offline sales for terminals/offices',
      'Agent sales create real bookings, tickets, receipts, customer records and ledgers',
    ],
    files: [
      'src/services/promoter/promoterService.js',
      'src/services/promoter/promoterNetworkService.js',
      'src/services/promoter/offlineSalesService.js',
      'src/controllers/promoter/offlineSalesController.js',
      'src/models/AgentProfile.js',
      'src/models/OfflineSale.js',
      'src/models/CampaignConversion.js',
      'src/models/FraudSignal.js',
      'src/views/pages/promoter-qr-card.ejs',
      'src/views/pages/offline-sale-receipt.ejs',
    ],
    collections: ['promoterLinks', 'referralClicks', 'campaignConversions', 'agentProfiles', 'offlineSales', 'fraudSignals', 'commissions', 'payoutRequests'],
    tests: ['tests/integration/promoterAgentSystemJ.test.js', 'tests/integration/agentOfflineSales.test.js'],
  },
  {
    id: 'K',
    title: 'Future services architecture',
    requirements: [
      'Flights, trains, tours, car rentals, events, cargo, insurance, corporate travel and loyalty entities exist',
      'Future modules are behind feature flags and coming-soon/read-only until complete',
      'No broken future booking flows are exposed',
    ],
    files: [
      'src/services/release/futureServiceArchitecture.js',
      'src/controllers/public/futureServiceController.js',
      'src/models/FutureServiceModule.js',
      'src/models/FlightOffer.js',
      'src/models/TrainInventory.js',
      'src/models/TourPackageInventory.js',
      'src/models/CarRentalUnit.js',
      'src/models/EventTicketInventory.js',
      'src/models/CargoShipment.js',
      'src/models/InsurancePolicyRecord.js',
      'src/models/CorporateTravelAccount.js',
      'src/models/LoyaltyAccount.js',
      'src/views/pages/future-services.ejs',
    ],
    collections: ['futureServiceModules', 'flightOffers', 'trainInventories', 'tourPackageInventories', 'carRentalUnits', 'eventTicketInventories', 'cargoShipments', 'insurancePolicyRecords', 'corporateTravelAccounts', 'loyaltyAccounts'],
    tests: ['tests/integration/futureServicesK.test.js'],
  },
  {
    id: 'L',
    title: 'Unified dashboard layout',
    requirements: [
      'Shared admin-style sidebar/layout component across roles',
      'Role-based, config-driven menus',
      'Dashboards for Super Admin, Company Dashboard, Driver, Company Staff, Customer, Promoter/Agent, Support, Finance and Operations',
      'Search, active state, collapsible groups, mobile drawer, user profile, notification badge and role switcher',
    ],
    files: [
      'src/config/dashboardMenus.js',
      'src/services/dashboard/shellConfig.js',
      'src/views/partials/dashboard-sidebar.ejs',
      'src/views/partials/dashboard-topbar.ejs',
      'src/views/dashboards/admin/index.ejs',
    ],
    collections: ['notifications'],
    tests: ['tests/integration/unifiedDashboardLayoutL.test.js'],
  },
  {
    id: 'M',
    title: 'Security and reliability',
    requirements: [
      'RBAC plus company-scoped authorization on protected routes',
      'Hashed invitation/reset/QR tokens where appropriate',
      'CSRF, rate limiting, validation, upload/file type validation, audit logs and sensitive data masking',
      'Signed idempotent webhooks',
      'Atomic inventory holds prevent double booking',
      'Financial actions create reversible ledger entries',
      'Explicit auditable state transitions',
    ],
    files: [
      'src/middlewares/auth.js',
      'src/middlewares/roles.js',
      'src/middlewares/companyAccess.js',
      'src/middlewares/csrf.js',
      'src/middlewares/rateLimit.js',
      'src/middlewares/upload.js',
      'src/services/security/securityService.js',
      'src/services/payment/webhookService.js',
      'src/services/booking/inventoryHoldService.js',
      'src/models/IdempotencyKeyRecord.js',
      'src/models/SecurityEvent.js',
      'src/models/LoginAudit.js',
      'src/models/DeviceSession.js',
    ],
    collections: ['securityEvents', 'loginAudits', 'deviceSessions', 'idempotencyKeyRecords', 'auditLogs', 'inventoryHolds'],
    tests: ['tests/integration/securityReliabilityM.test.js', 'tests/integration/platformHardening.test.js'],
  },
  {
    id: 'N',
    title: 'Required acceptance tests',
    requirements: [
      'Executable tests map every Section N acceptance flow to backend and frontend evidence',
      'Test matrix is visible to developers and Super Admin implementation audit',
      'Verification command runs all integration, e2e and unit checks',
    ],
    files: [
      'tests/acceptance/masterAcceptanceMatrix.js',
      'tests/acceptance/MASTER_ACCEPTANCE_MATRIX.md',
      'scripts/acceptance-matrix.js',
      'package.json',
    ],
    collections: [],
    tests: [
      'tests/integration/requiredAcceptanceN.test.js',
      'tests/integration/onboardingAComplete.test.js',
      'tests/integration/busOperationsC.test.js',
      'tests/integration/hotelOperationsD.test.js',
      'tests/integration/multiServiceCartE.test.js',
      'tests/integration/ticketQrCheckinG.test.js',
      'tests/integration/securityReliabilityM.test.js',
    ],
  },
];

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function collectionExists(name) {
  return name === 'platformSettings'
    ? Boolean(store.state[name] && typeof store.state[name] === 'object')
    : Array.isArray(store.state[name]);
}

function modelNameForFile(relativePath) {
  const base = path.basename(relativePath, '.js');
  return relativePath.startsWith('src/models/') ? base : null;
}

function repositoryCoversModel(modelName) {
  if (!modelName) return true;
  return Object.values(repositories.entityModelMap).includes(modelName);
}

function auditSection(section) {
  const fileChecks = section.files.map((file) => ({ file, ok: exists(file) }));
  const collectionChecks = section.collections.map((collection) => ({ collection, ok: collectionExists(collection), repository: Boolean(repositories.entityModelMap[collection]) }));
  const testChecks = section.tests.map((file) => ({ file, ok: exists(file) }));
  const modelChecks = section.files.map(modelNameForFile).filter(Boolean).map((model) => ({ model, ok: repositoryCoversModel(model) }));
  const missing = [
    ...fileChecks.filter((item) => !item.ok).map((item) => `missing file ${item.file}`),
    ...collectionChecks.filter((item) => !item.ok).map((item) => `missing state collection ${item.collection}`),
    ...collectionChecks.filter((item) => !item.repository && section.id !== 'N').map((item) => `missing repository mapping ${item.collection}`),
    ...testChecks.filter((item) => !item.ok).map((item) => `missing test ${item.file}`),
    ...modelChecks.filter((item) => !item.ok).map((item) => `missing repository model ${item.model}`),
  ];
  return {
    id: section.id,
    title: section.title,
    status: missing.length ? 'incomplete' : 'implemented',
    requirements: section.requirements,
    evidence: { files: fileChecks, collections: collectionChecks, tests: testChecks, models: modelChecks },
    missing,
  };
}

function audit() {
  const sections = SECTIONS.map(auditSection);
  const missing = sections.flatMap((section) => section.missing.map((item) => `${section.id}: ${item}`));
  return {
    generatedAt: new Date().toISOString(),
    status: missing.length ? 'needs_work' : 'implemented',
    complete: missing.length === 0,
    sectionCount: sections.length,
    implementedSections: sections.filter((section) => section.status === 'implemented').length,
    sections,
    missing,
  };
}

function csv() {
  const rows = audit().sections.map((section) => [section.id, section.title, section.status, section.missing.join('; '), section.requirements.join(' | ')]);
  const escape = (value) => /[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value);
  return [['Section', 'Title', 'Status', 'Missing', 'Requirements'], ...rows].map((row) => row.map(escape).join(',')).join('\n');
}

module.exports = { SECTIONS, audit, csv };
