'use strict';
window.addEventListener('DOMContentLoaded', function () {
  const bootstrapNode = document.getElementById('dashboardWorkspaceBootstrap');
  const bootstrap = bootstrapNode ? JSON.parse(bootstrapNode.textContent || '{}') : {};
  const backendDashboardData = bootstrap.dashboardData || {};
  const platformConfig = bootstrap.platformConfig || {};
  const platformDefaultCurrency = String(platformConfig.defaultCurrency || '').toUpperCase();
  const supportedCurrencies = Array.isArray(platformConfig.supportedCurrencies) && platformConfig.supportedCurrencies.length
    ? platformConfig.supportedCurrencies
    : [platformDefaultCurrency];
  const shell = bootstrap.shell || {};
  const csrfToken = window.ClassicTripCsrf?.token() || bootstrap.csrfToken || '';
  const serverFlashMessages = bootstrap.flashMessages || [];
  const runtimeServiceProfile = backendDashboardData.serviceProfile || {};
  const runtimeCompanyServiceType = String(runtimeServiceProfile.primaryServiceType || '').replace('-', '_');
  const dashboardRoleKey = String(shell.currentRole || shell.roleKey || 'admin').toLowerCase();
  function platformActionPath(domains, suffix) {
    const allowed = Array.isArray(domains) ? domains : [domains];
    return allowed.includes(dashboardRoleKey) ? `/${dashboardRoleKey}${suffix}` : `/admin${suffix}`;
  }
  function platformReportPath() {
    return ['support', 'finance', 'operations', 'content'].includes(dashboardRoleKey)
      ? `/${dashboardRoleKey}/reports/custom`
      : '/admin/reports/custom';
  }

  function setFieldError(field, message) {
    if (!field) return;
    const wrapper = field.closest('.field') || field.parentElement;
    field.classList.add('has-error');
    if (wrapper) wrapper.classList.add('has-error');
    if (wrapper && !wrapper.querySelector('.fieldError')) {
      const note = document.createElement('small');
      note.className = 'fieldError';
      note.textContent = message;
      wrapper.appendChild(note);
    }
  }

  function clearFieldError(field) {
    if (!field) return;
    const wrapper = field.closest('.field') || field.parentElement;
    field.classList.remove('has-error');
    if (wrapper) {
      wrapper.classList.remove('has-error');
      const note = wrapper.querySelector('.fieldError');
      if (note) note.remove();
    }
  }

  function validateActionForm(form) {
    if (!form || form.dataset.skipValidation === 'true') return true;
    const required = $('[required]', form).filter((field) => !field.disabled && field.type !== 'hidden');
    let firstInvalid = null;
    required.forEach((field) => {
      clearFieldError(field);
      const value = String(field.value || '').trim();
      if (!value) {
        firstInvalid = firstInvalid || field;
        setFieldError(field, 'This field is required.');
      }
    });
    const labelMode = String(form.querySelector('[name="seatLabelMode"]')?.value || '').toLowerCase();
    const seatLabelsField = form.querySelector('[name="seatLabels"]');
    const totalSeatsField = form.querySelector('[name="totalSeats"]');
    if (labelMode === 'custom' && seatLabelsField && totalSeatsField) {
      const labels = String(seatLabelsField.value || '').split(/[\n,;]+/).map(value => value.trim()).filter(Boolean);
      const expected = Number(totalSeatsField.value || 0);
      const unique = new Set(labels.map(value => value.toLowerCase()));
      clearFieldError(seatLabelsField);
      if (!expected || labels.length !== expected) {
        firstInvalid = firstInvalid || seatLabelsField;
        setFieldError(seatLabelsField, `Custom numbering needs exactly ${expected || 'the selected capacity'} unique labels; ${labels.length} provided.`);
      } else if (unique.size !== labels.length) {
        firstInvalid = firstInvalid || seatLabelsField;
        setFieldError(seatLabelsField, 'Every custom seat label must be unique.');
      }
    }
    const origin = form.querySelector('[name="originBranchId"]');
    const destination = form.querySelector('[name="destinationBranchId"]');
    if (origin?.value && destination?.value && origin.value === destination.value) {
      firstInvalid = firstInvalid || destination;
      setFieldError(destination, 'Origin and destination must be different terminals.');
    }
    const fromStop = form.querySelector('[name="fromStopId"]');
    const toStop = form.querySelector('[name="toStopId"]');
    if (fromStop?.value && toStop?.value) {
      const fromOrder = Number(fromStop.selectedOptions?.[0]?.dataset?.stopOrder || 0);
      const toOrder = Number(toStop.selectedOptions?.[0]?.dataset?.stopOrder || 0);
      if (toOrder <= fromOrder) {
        firstInvalid = firstInvalid || toStop;
        setFieldError(toStop, 'Drop-off must come after the boarding stop.');
      }
    }
    if (firstInvalid) {
      firstInvalid.focus({ preventScroll:false });
      toast('Please correct the highlighted fields before saving.');
      return false;
    }
    return true;
  }

  function dismissFlash(flash) {
    if (!flash || flash.dataset.dismissing === 'true') return;
    flash.dataset.dismissing = 'true';
    flash.style.opacity = '0';
    flash.style.transform = 'translateY(-6px)';
    window.setTimeout(() => flash.remove(), 220);
  }

  document.addEventListener('click', (event) => {
    const close = event.target.closest('[data-dismiss-flash]');
    if (close) dismissFlash(close.closest('.actionFlash'));
  });

  document.querySelectorAll('[data-flash-stack] .actionFlash').forEach((flash, index) => {
    window.setTimeout(() => dismissFlash(flash), 4000 + (index * 250));
  });

  document.addEventListener('input', (event) => {
    if (event.target.matches('input,select,textarea')) clearFieldError(event.target);
  });

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!validateActionForm(form)) event.preventDefault();
  }, true);

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

  const els = {
    pageHeading: $('#pageHeading'),
    pageSub: $('#pageSub'),
    toast: $('#toast'),
    toastText: $('#toastText'),
    sideSearch: $('#sideSearch'),
    btnTheme: $('#btnTheme'),
    themeIcon: $('#themeIcon'),
    openMenu: $('#openMenu'),
    sideBackdrop: $('#sideBackdrop'),
    crudModal: $('#crudModal'),
    crudTitle: $('#crudTitle'),
    crudSub: $('#crudSub'),
    crudBody: $('#crudBody'),
    deleteModal: $('#deleteModal'),
    deleteText: $('#deleteText'),
    confirmDelete: $('#confirmDelete'),
    deleteForm: $('#deleteForm')
  };

  const data = {};
  function mergeDashboardData(target, source) {
    if (!source || typeof source !== 'object') return target;
    Object.entries(source).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        if (value.length) target[key] = value;
        return;
      }
      if (value && typeof value === 'object') {
        if (!Array.isArray(target[key]) && target[key] && typeof target[key] === 'object') {
          target[key] = { ...target[key], ...value };
        } else if (Object.keys(value).length) {
          target[key] = value;
        }
        return;
      }
      if (value !== undefined && value !== null && value !== '') target[key] = value;
    });
    return target;
  }
  mergeDashboardData(data, backendDashboardData);

  // Dashboard JS must be safe for every role that reuses the Super Admin shell.
  // Company, finance, support, and operations dashboards may not send every
  // admin data collection. Keep missing collections as empty arrays so the
  // existing UI can open without console/runtime errors.
  const dashboardArrayKeys = [
    'overviewStats', 'liveActivity', 'recentBookings', 'bookings', 'partners',
    'listings', 'routes', 'vehicles', 'schedules', 'payments', 'promoters',
    'customers', 'support', 'ads', 'routeInventory', 'stayInventory',
    'reviewInventory', 'audit', 'financeAudit', 'securityAudit', 'admins',
    'kyc', 'refunds', 'notifications', 'branches', 'policies', 'staff',
    'drivers', 'inventory', 'hotelProperties', 'roomTypes', 'roomUnits',
    'roomNightInventory', 'bookedSeatGroups', 'hotelArrivals',
    'hotelDepartures', 'hotelInHouse', 'checkins', 'reviews', 'handovers', 'payouts',
    'saved', 'receipts', 'wallet', 'security', 'passengers',
    'links', 'share', 'commissions', 'withdrawals', 'campaigns', 'fraud', 'offlineSales',
    'agentSales', 'fraudSignals', 'referralClicks', 'attributionSessions', 'campaignConversions',
    'referralCards', 'driverOps', 'driverIncidents', 'tripStatusUpdates',
    'seatMaps', 'vehicleSeatTemplates', 'seatMapTemplates', 'seatMapVersions',
    'correspondence', 'deliveryAttempts', 'timeline', 'reschedules', 'reports',
    'scheduleRules', 'priceRules', 'payoutRequests', 'settlementBatches'
  ];
  dashboardArrayKeys.forEach(key => { if (!Array.isArray(data[key])) data[key] = []; });

  const serviceDashboards = Array.isArray(data.dashboardFeatures?.services) ? data.dashboardFeatures.services : [];
  const companyServiceProfile = data.serviceProfile || {};

  const pageMeta = {
    overview: [shell.title || 'Super Admin Dashboard', shell.subtitle || 'Manage partners, bookings, payments, commissions, promotions, and support in one place.'],
    analytics: ['Analytics', 'Clean platform insights for traffic, conversions, route demand, partner quality, and promoter performance.'],
    bookings: ['Bookings', 'Monitor customer orders, seats, rooms, ticket delivery, holds, refunds, and receipts.'],
    partners: ['Partners / Companies', 'Approve companies, verify documents, manage dashboards, and monitor performance.'],
    listings: ['Listings & Inventory', 'Control bus services, hotel properties, seats, rooms, schedules, availability, and prices.'],
    routes: ['Routes', 'Manage every bus route, corridor, boarding point, drop-off point, and route status.'],
    vehicles: ['Vehicles', 'Manage partner buses, assigned drivers, compliance, seat layouts, and operating status.'],
    schedules: ['Schedules', 'Monitor departure times, assigned vehicles, availability, capacity, and publishing status.'],
    payments: ['Payments & Commission', `Review payment settlements, ${platformConfig.partnerCommissionPercent ?? ''}% partner commission, promoter rewards funded from that commission, and partner payouts.`],
    promoters: ['Promoters', 'Manage referral links, commission balances, payout requests, and campaign performance.'],
    customers: ['Customers', 'View customer profiles, bookings, receipts, saved items, refunds, and support tickets.'],
    support: ['Support & Disputes', 'Handle payment problems, missing tickets, refund cases, and partner disputes.'],
    ads: ['Ads & Promotions', 'Manage paid boosts, sponsored cards, top placement, and partner ad campaigns.'],
    reports: ['Reports', 'Download finance, partner, customer, promoter, ad, and booking performance reports.'],
    audit: ['Audit Logs', 'Track all sensitive admin, finance, support, partner, and system actions.'],
    admins: ['Admins & Roles', 'Manage staff access, roles, permissions, 2FA, and restricted controls.'],
    kyc: ['KYC / Verification', 'Review company documents, payout accounts, business licenses, and compliance flags.'],
    refunds: ['Refunds', 'Manage cancellations, reversals, chargebacks, refund approval, and partner responsibility.'],
    notifications: ['Notifications', 'Send and manage email, SMS, WhatsApp, push messages, receipts, and templates.'],
    system: ['System Health', 'Monitor platform uptime, queues, payment webhooks, ticket delivery, and database status.'],
    settings: ['Settings', 'Control platform fee rules, hold timer, currency, security, and admin configuration.'],
    'company-profile': ['Company Profile', 'Manage company profile, branches, policies, support contacts, payout identity, and verification state.'],
    staff: ['Staff & Drivers', 'Partner Admin manages every company employee, driver, finance, support, and operations role. Super Admin approves only the partner company.'],
    'seat-maps': ['Seat Maps', 'Manage schedule seat maps, booked seats, holds, blocks, and ticket detail access.'],
    'hotel-rooms': ['Rooms & Inventory', 'Manage hotel properties, room types, room units, room-night inventory, and visual room status.'],
    manifests: ['Manifests', 'Print bus customer manifests and hotel arrival/departure/in-house lists.'],
    checkins: ['Check-ins', 'Monitor QR/manual check-ins and duplicate-scan protection.'],
    reviews: ['Reviews', 'Review customer feedback and company replies.'],
    revenue: ['Revenue', 'View company revenue, booking splits, and pending earnings.'],
    settlement: ['Settlement', 'Request payout and track pending/available/paid-out earnings.'],
    handover: ['Shift Handover', 'Create and review shift notes, cash follow-ups, bookings, and customer issues for the next staff member.'],
    profile: ['My Profile', 'Update your employee contact details, shift notes, and staff profile information.'],
    ticket: ['Current Ticket', 'View the latest active booking, QR/ticket detail, travel date, payment state, and support actions.'],
    saved: ['Saved Trips', 'Review saved listings and bookable trips for a faster return to checkout.'],
    passengers: ['Passengers', 'Manage saved passenger details and traveler records collected from bookings.'],
    receipts: ['Receipts', 'Download paid booking receipts and invoice history.'],
    wallet: ['Wallet', 'Track customer wallet balance, top-ups, credits, and refund credits.'],
    security: ['Security', 'Manage login alerts, recovery details, password state, and account protection.'],
    'customer-refunds': ['Refunds', 'Track customer refund requests, cancellation follow-up, and case status.'],
    'customer-support': ['Support', 'Create and review customer support cases linked to bookings and account activity.'],
    'customer-reviews': ['Reviews', 'Submit and review customer ratings for completed bookings.'],
    'customer-notifications': ['Notifications', 'Review booking updates, receipts, refunds, and account notices.'],
    'customer-profile': ['Profile', 'Update customer identity, contact details, travel preferences, and receipt settings.'],
    links: ['Referral Links', 'Manage promoter referral codes, QR cards, clicks, conversions, and link status.'],
    share: ['Share Listings', 'Pick bookable and sponsored listings to share with tracked referral links.'],
    campaigns: ['Campaigns', 'Manage promoter campaigns, placements, clicks, booking conversion, budget, and status.'],
    performance: ['Performance', 'Review clicks, conversion, referred revenue, commissions, and top shared listings.'],
    'offline-sales': ['Offline Sales', 'Record agent-assisted sales, receipts, payment method, and booking references.'],
    fraud: ['Traffic Review', 'Monitor promoter traffic quality, failed payments, cancellation rate, and fraud signals.'],
    commissions: ['Commissions', 'Track commission records generated from referred bookings.'],
    withdrawals: ['Withdrawals', 'Request and review promoter withdrawals and wallet payout status.'],
    payouts: ['Payout History', 'Review paid, pending, and available promoter payout rows.'],
    'promoter-support': ['Promoter Support', 'Create and review support cases for links, commissions, withdrawals, and verification.'],
    'promoter-profile': ['Profile', 'Update promoter identity, payout account, referral code, and verification state.'],
    'driver-ops': ['Driver Operations', 'Review assigned trips, status updates, vehicles, departure times, and operational state.'],
    'driver-manifest': ['Manifest', 'Review passenger or guest manifests scoped to assigned trips and company operations.'],
    'driver-incidents': ['Incidents', 'Log and review route, vehicle, customer, safety, and service incidents.']
  };
  if (companyServiceProfile && companyServiceProfile.pageMeta) { Object.entries(companyServiceProfile.pageMeta).forEach(([key, meta]) => { if (Array.isArray(meta)) pageMeta[key] = meta; }); }
  if (shell && Array.isArray(shell.groups)) { shell.groups.forEach(group => (group.items || []).forEach(item => { if (!pageMeta[item.page]) pageMeta[item.page] = [item.label || item.page, shell.subtitle || 'Classic Trip dashboard']; })); }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[char]));
  }

  function badgeFor(status) {
    const text = escapeHtml(status);
    const s = String(status).toLowerCase();
    let cls = 'info';
    if (/(paid|settled|verified|active|confirmed|ticketed|available|running|vip)/.test(s)) cls = 'ok';
    if (/(hold|review|pending|waiting|few)/.test(s)) cls = 'warn';
    if (/(refund|urgent|no seats|paused)/.test(s)) cls = 'bad';
    return `<span class="badge ${cls}">${text}</span>`;
  }

  function rowMeta(row) {
    const last = Array.isArray(row) ? row[row.length - 1] : null;
    return last && typeof last === 'object' && !Array.isArray(last) ? last : null;
  }

  function rowCells(row) {
    const meta = rowMeta(row);
    return meta ? row.slice(0, -1) : row;
  }

  function encodeDetail(detail) {
    try { return encodeURIComponent(JSON.stringify(detail || {})); } catch (error) { return ''; }
  }

  function bookingPreviewUrl(){
    const listingRows = Array.isArray(data.listings) ? data.listings : [];
    const row = listingRows.map(rowMeta).find(meta => meta?.detail?.service?.slug || meta?.slug || meta?.id);
    const detail = row?.detail || {};
    const serviceType = detail.service?.type || row?.serviceType || 'bus';
    const slug = detail.service?.slug || row?.slug || row?.id;
    return slug ? `/listings/${encodeURIComponent(serviceType)}/${encodeURIComponent(slug)}` : '/search';
  }

  function openBookingPreview(){
    window.location.href = bookingPreviewUrl();
  }


  function dashboardRecordId(detail = {}) {
    return detail?.id || detail?.listing?.id || detail?.listing?.listingId || detail?.route?.id || detail?.routeStop?.id || detail?.serviceAddon?.id || detail?.vehicle?.id || detail?.schedule?.id || detail?.room?.id || detail?.property?.id || detail?.roomType?.id || detail?.ratePlan?.id || detail?.roomUnit?.id || detail?.roomNight?.id || detail?.seatMap?.scheduleId || detail?.manifest?.scheduleId || detail?.booking?.bookingRef || '';
  }

  function mutableCompanyEntity(entity = '') {
    return ['listing','route','routestop','route_stop','vehicle','schedule','room','hotel_property','room_type','rate_plan','room_unit','room_night','seat','manifest_passenger','service_addon','add-on'].includes(String(entity || '').toLowerCase());
  }

  function archiveActionFor(entity = '', id = '') {
    const key = String(entity || '').toLowerCase();
    const safeId = encodeURIComponent(id || '');
    if (!safeId) return '';
    if (key === 'listing') return `/company/listings/${safeId}/archive`;
    if (key === 'route') return `/company/routes/${safeId}/archive`;
    if (key === 'routestop' || key === 'route_stop') return `/company/route-stops/${safeId}/archive`;
    if (key === 'vehicle') return `/company/vehicles/${safeId}/archive`;
    if (key === 'schedule') return `/company/schedules/${safeId}/archive`;
    if (key === 'room') return `/company/hotels/room-types/${safeId}/archive`;
    if (key === 'hotel_property') return `/company/hotels/properties/${safeId}/archive`;
    if (key === 'room_type') return `/company/hotels/room-types/${safeId}/archive`;
    if (key === 'rate_plan') return `/company/hotels/rate-plans/${safeId}/archive`;
    if (key === 'room_unit') return `/company/hotels/room-units/${safeId}/archive`;
    if (key === 'room_night') return `/company/hotels/inventory/${safeId}/archive`;
    if (key === 'service_addon' || key === 'add-on') return `/company/addons/${safeId}/archive`;
    return '';
  }

  function addModeButtons(entity, safeLabel, safeType, detailAttr, idAttr, id) {
    const key = String(entity || safeType || '').toLowerCase();
    if ((shell.currentRole || 'admin') !== 'company' || !id || !mutableCompanyEntity(key)) return '';
    return `
      <button class="tinyBtn" data-modal="edit" data-type="${escapeHtml(key)}" data-label="${safeLabel}"${detailAttr}${idAttr} title="Edit"><i class="fa-solid fa-pen"></i></button>
      <button class="tinyBtn danger" data-modal="delete" data-type="${escapeHtml(key)}" data-label="${safeLabel}"${detailAttr}${idAttr} title="Delete / archive"><i class="fa-solid fa-trash"></i></button>`;
  }

  function rowActions(label, type, meta = null) {
    const safeLabel = escapeHtml(label);
    const safeType = escapeHtml(type);
    const detailAttr = meta?.detail ? ` data-row-detail="${escapeHtml(encodeDetail(meta.detail))}"` : '';
    const idAttr = meta?.id ? ` data-row-id="${escapeHtml(meta.id)}"` : '';
    if (meta?.entity === 'partner') {
      const slug = encodeURIComponent(meta.slug || meta.id || label);
      const status = String(meta.status || '').toLowerCase();
      const approve = status !== 'verified' ? `<form method="POST" action="/admin/companies/${slug}/approve" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="tinyBtn" type="submit" title="Approve"><i class="fa-solid fa-circle-check"></i></button></form>` : '';
      const reject = !/(verified|suspended|rejected)/.test(status) ? `<form method="POST" action="/admin/companies/${slug}/reject" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="tinyBtn danger" type="submit" title="Reject"><i class="fa-solid fa-ban"></i></button></form>` : '';
      const suspend = status !== 'suspended' ? `<form method="POST" action="/admin/companies/${slug}/suspend" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="tinyBtn danger" type="submit" title="Suspend"><i class="fa-solid fa-pause"></i></button></form>` : '';
      return `<div class="rowActions">
        <button class="tinyBtn" data-modal="view" data-type="${safeType}" data-label="${safeLabel}"${detailAttr}${idAttr} title="View full details"><i class="fa-regular fa-eye"></i></button>
        <button class="tinyBtn" data-copy-value="${safeLabel}" title="Copy reference"><i class="fa-regular fa-copy"></i></button>
        <button class="tinyBtn" data-export-row="${safeType}" data-label="${safeLabel}"${detailAttr} title="Export row"><i class="fa-solid fa-file-export"></i></button>
        <button class="tinyBtn" data-modal="edit" data-type="partner commission" data-label="${safeLabel}"${detailAttr}${idAttr} title="Edit commission percentage"><i class="fa-solid fa-percent"></i></button>
        ${approve}${reject}${suspend}
      </div>`;
    }
    const role = shell.currentRole || 'admin';
    const entity = String(meta?.entity || type || '').toLowerCase();
    const detailBooking = meta?.detail?.booking?.booking || meta?.detail?.booking || {};
    const detailServiceType = String(detailBooking.serviceType || meta?.detail?.service?.type || '').toLowerCase();
    const isHotelBooking = entity === 'hotel_booking' || detailServiceType === 'hotel';
    const paymentStatusKey = String(detailBooking.paymentStatus || meta?.detail?.payment?.status || '').toLowerCase().replace(/[\s-]+/g, '_');
    const bookingStatusKey = String(detailBooking.bookingStatus || meta?.status || '').toLowerCase().replace(/[\s-]+/g, '_');
    const stayStatusKey = String(detailBooking.hotelStay?.status || bookingStatusKey).toLowerCase().replace(/[\s-]+/g, '_');
    if (role === 'admin' && entity === 'kyc') {
      const detail = meta?.detail || {};
      const targetType = encodeURIComponent(detail.targetType || 'company');
      const targetId = encodeURIComponent(detail.targetId || meta?.id || '');
      const review = detail.verificationReview || {};
      const checklist = Array.isArray(review.checklist) ? review.checklist : [];
      const pendingItems = checklist.filter(item => /submitted|pending|review/i.test(String(item.status || '')));
      const checklistButtons = pendingItems.map(item => {
        const key = encodeURIComponent(item.key || '');
        if (!key) return '';
        return `<form method="POST" action="/admin/verification/${targetType}/${targetId}/items/${key}/approve" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><input type="hidden" name="next" value="/admin/kyc"><button class="tinyBtn" type="submit" title="Approve ${escapeHtml(item.label || item.key)}"><i class="fa-solid fa-check"></i></button></form>`;
      }).join('');
      const requiredOutstanding = checklist.some(item => item.required !== false && !/approved|waived/i.test(String(item.status || '')));
      const partnerManagedEmployee = targetType === 'driver';
      const activate = !partnerManagedEmployee && !requiredOutstanding && targetId
        ? `<form method="POST" action="/admin/verification/${targetType}/${targetId}/activate" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><input type="hidden" name="next" value="/admin/kyc"><button class="tinyBtn" type="submit" title="Activate verified account"><i class="fa-solid fa-circle-check"></i></button></form>`
        : '';
      const reject = !partnerManagedEmployee && targetId
        ? `<form method="POST" action="/admin/verification/${targetType}/${targetId}/reject" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><input type="hidden" name="next" value="/admin/kyc"><input type="hidden" name="reason" value="Verification rejected by administrator"><button class="tinyBtn danger" type="submit" title="Reject verification"><i class="fa-solid fa-ban"></i></button></form>`
        : '';
      return `<div class="rowActions">
        <button class="tinyBtn" data-modal="view" data-type="${safeType}" data-label="${safeLabel}"${detailAttr}${idAttr} title="View full checklist"><i class="fa-regular fa-eye"></i></button>
        ${partnerManagedEmployee ? '' : checklistButtons}${activate}${reject}
      </div>`;
    }
    const rawId = meta?.id || dashboardRecordId(meta?.detail || {});
    const id = rawId ? encodeURIComponent(rawId) : '';
    let scopedActions = '';
    const modeActions = addModeButtons(entity, safeLabel, safeType, detailAttr, idAttr, rawId);
    if (role === 'company' && id) {
      if (entity === 'listing') {
        const listingDetail = meta?.detail?.listing || {};
        const listingServiceType = String(listingDetail.serviceType || meta?.serviceType || '').toLowerCase();
        scopedActions += `<form method="POST" action="/company/listings/${id}/publish" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="tinyBtn" type="submit" title="Finish setup and publish listing"><i class="fa-solid fa-upload"></i></button></form>`;
        if (listingServiceType === 'bus' && listingDetail.bookable !== true) {
          scopedActions += `<a class="tinyBtn" href="/company/schedules" title="Create and publish a dated departure to enable bookings"><i class="fa-regular fa-calendar-plus"></i></a>`;
        }
        scopedActions += `<form method="POST" action="/company/listings/${id}/archive" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="tinyBtn danger" type="submit" title="Archive listing"><i class="fa-solid fa-box-archive"></i></button></form>`;
      }
      if (entity === 'route') {
        scopedActions += `<button class="tinyBtn" data-modal="create" data-type="route stop" data-label="${safeLabel}"${detailAttr}${idAttr} title="Add route stop"><i class="fa-solid fa-map-pin"></i></button>`;
        scopedActions += `<form method="POST" action="/company/routes/${id}/archive" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="tinyBtn danger" type="submit" title="Archive route"><i class="fa-solid fa-box-archive"></i></button></form>`;
      }
      if (entity === 'routestop') {
        scopedActions += `<form method="POST" action="/company/route-stops/${id}/move" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><input type="hidden" name="direction" value="up"><button class="tinyBtn" type="submit" title="Move stop up"><i class="fa-solid fa-arrow-up"></i></button></form>`;
        scopedActions += `<form method="POST" action="/company/route-stops/${id}/move" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><input type="hidden" name="direction" value="down"><button class="tinyBtn" type="submit" title="Move stop down"><i class="fa-solid fa-arrow-down"></i></button></form>`;
        scopedActions += `<form method="POST" action="/company/route-stops/${id}/archive" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="tinyBtn danger" type="submit" title="Archive stop"><i class="fa-solid fa-box-archive"></i></button></form>`;
      }
      if (entity === 'vehicle') {
        scopedActions += `<button class="tinyBtn" data-modal="edit" data-type="vehicle seat template" data-label="${safeLabel}"${detailAttr}${idAttr} title="Edit seat template"><i class="fa-solid fa-chair"></i></button>`;
        scopedActions += `<button class="tinyBtn" data-modal="edit" data-type="vehicle status" data-label="${safeLabel}"${detailAttr}${idAttr} title="Update vehicle status"><i class="fa-solid fa-screwdriver-wrench"></i></button>`;
        scopedActions += `<form method="POST" action="/company/vehicles/${id}/archive" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="tinyBtn danger" type="submit" title="Archive vehicle"><i class="fa-solid fa-box-archive"></i></button></form>`;
      }
      if (entity === 'employee') {
        const staffDetail = meta?.detail?.staff || {};
        const currentStatus = String(staffDetail.status || meta?.status || '').toLowerCase();
        if (currentStatus !== 'active') {
          scopedActions += `<form method="POST" action="/company/staff/${id}/role" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><input type="hidden" name="status" value="active"><button class="tinyBtn" type="submit" title="Activate employee"><i class="fa-solid fa-user-check"></i></button></form>`;
        } else {
          scopedActions += `<form method="POST" action="/company/staff/${id}/role" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><input type="hidden" name="status" value="suspended"><button class="tinyBtn danger" type="submit" title="Suspend employee"><i class="fa-solid fa-user-slash"></i></button></form>`;
        }
        scopedActions += `<button class="tinyBtn" data-modal="edit" data-type="staff status" data-label="${safeLabel}"${detailAttr}${idAttr} title="Manage employee role and status"><i class="fa-solid fa-user-gear"></i></button>`;
      }
      if (entity === 'driver') {
        const driverDetail = meta?.detail?.driver || {};
        const activation = meta?.detail?.partnerActivation || {};
        const currentStatus = String(driverDetail.status || meta?.status || '').toLowerCase();
        if (currentStatus !== 'active') {
          const licence = escapeHtml(driverDetail.licenseNumber || '');
          const documentReference = escapeHtml(activation.licenseDocumentReference || '');
          scopedActions += `<form method="POST" action="/company/drivers/${id}/activate" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><input type="hidden" name="status" value="active"><input type="hidden" name="safetyStatus" value="cleared"><input type="hidden" name="licenseNumber" value="${licence}"><input type="hidden" name="documentReference" value="${documentReference}"><button class="tinyBtn" type="submit" title="Set driver active"><i class="fa-solid fa-user-check"></i></button></form>`;
        }
        scopedActions += `<button class="tinyBtn" data-modal="edit" data-type="driver activation" data-label="${safeLabel}"${detailAttr}${idAttr} title="Manage driver status"><i class="fa-solid fa-user-gear"></i></button>`;
      }
      if (entity === 'schedule') {
        scopedActions += `<a class="tinyBtn" href="/company/schedules/${id}/manifest" title="Open printable manifest"><i class="fa-solid fa-file-lines"></i></a>`;
        scopedActions += `<a class="tinyBtn" href="/company/schedules/${id}/manifest.pdf" title="Download manifest PDF"><i class="fa-solid fa-file-pdf"></i></a>`;
        scopedActions += `<a class="tinyBtn" href="/company/schedules/${id}/manifest.csv" title="Download manifest CSV"><i class="fa-solid fa-file-csv"></i></a>`;
        scopedActions += `<button class="tinyBtn" data-modal="view" data-type="publish readiness" data-label="${safeLabel}"${detailAttr}${idAttr} title="Check publish readiness"><i class="fa-solid fa-list-check"></i></button>`;
        scopedActions += `<form method="POST" action="/company/schedules/${id}/publish" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="tinyBtn" type="submit" title="Publish schedule"><i class="fa-solid fa-upload"></i></button></form>`;
        scopedActions += `<button class="tinyBtn" data-modal="edit" data-type="schedule status" data-label="${safeLabel}"${detailAttr}${idAttr} title="Update trip status"><i class="fa-solid fa-road-circle-check"></i></button>`;
        scopedActions += `<form method="POST" action="/company/schedules/${id}/complete" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="tinyBtn" type="submit" title="Complete trip and release eligible earnings"><i class="fa-solid fa-flag-checkered"></i></button></form>`;
        scopedActions += `<button class="tinyBtn" data-modal="create" data-type="duplicate schedule" data-label="${safeLabel}"${detailAttr}${idAttr} title="Duplicate schedule"><i class="fa-regular fa-copy"></i></button>`;
        scopedActions += `<form method="POST" action="/company/schedules/${id}/archive" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="tinyBtn danger" type="submit" title="Archive schedule"><i class="fa-solid fa-box-archive"></i></button></form>`;
      }
      if (entity === 'booking' || entity === 'checkin' || entity === 'manifest_passenger' || entity === 'hotel_booking') {
        scopedActions += `<a class="tinyBtn" href="${isHotelBooking ? `/company/hotels/bookings/${id}/voucher` : `/company/tickets/${id}`}" title="Open ${isHotelBooking ? 'hotel voucher' : 'operational ticket'}"><i class="fa-solid fa-ticket"></i></a>`;
        if (isHotelBooking) {
          if (paymentStatusKey === 'successful' && ['confirmed', 'booked'].includes(bookingStatusKey) && !['checked_in', 'occupied', 'in_house'].includes(stayStatusKey)) {
            scopedActions += `<form method="POST" action="/company/hotels/bookings/${id}/check-in" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="tinyBtn" type="submit" title="Guest check-in"><i class="fa-solid fa-person-circle-check"></i></button></form>`;
            scopedActions += `<form method="POST" action="/company/hotels/bookings/${id}/no-show" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="tinyBtn danger" type="submit" title="Mark hotel no-show"><i class="fa-solid fa-user-slash"></i></button></form>`;
          }
          if (['checked_in', 'occupied', 'in_house'].includes(stayStatusKey)) {
            scopedActions += `<form method="POST" action="/company/hotels/bookings/${id}/check-out" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="tinyBtn" type="submit" title="Guest check-out"><i class="fa-solid fa-door-open"></i></button></form>`;
          }
        } else {
          scopedActions += `<form method="POST" action="/company/scanner/validate" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><input type="hidden" name="bookingRef" value="${id}"><button class="tinyBtn" type="submit" title="Manual check-in"><i class="fa-solid fa-qrcode"></i></button></form>`;
          scopedActions += `<form method="POST" action="/company/scanner/no-show" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><input type="hidden" name="bookingRef" value="${id}"><button class="tinyBtn danger" type="submit" title="Mark no-show"><i class="fa-solid fa-user-slash"></i></button></form>`;
        }
      }
      if (entity === 'seat') {
        scopedActions += `<button class="tinyBtn" data-modal="edit" data-type="seat status" data-label="${safeLabel}"${detailAttr}${idAttr} title="Update seat status"><i class="fa-solid fa-chair"></i></button>`;
        const parts = String(rawId || '').split(':');
        const scheduleId = encodeURIComponent(parts[0] || meta?.detail?.seat?.scheduleId || meta?.detail?.seatMap?.scheduleId || '');
        const seatNo = encodeURIComponent(parts[1] || meta?.detail?.seat?.seatNumber || '');
        if (scheduleId && seatNo) scopedActions += `<a class="tinyBtn" href="/company/seats/${scheduleId}/${seatNo}/ticket" title="Open seat ticket"><i class="fa-solid fa-ticket"></i></a>`;
      }
      if (entity === 'hotel_property') {
        const listingId = encodeURIComponent(meta?.detail?.property?.listingId || meta?.detail?.listing?.id || rawId || '');
        if (listingId) {
          scopedActions += `<a class="tinyBtn" href="/company/hotels/${listingId}/manifest" title="Open hotel manifest"><i class="fa-solid fa-list-check"></i></a>`;
          scopedActions += `<a class="tinyBtn" href="/company/hotels/${listingId}/manifest.pdf" title="Download hotel manifest PDF"><i class="fa-solid fa-file-pdf"></i></a>`;
        }
        scopedActions += `<form method="POST" action="/company/hotels/properties/${id}/archive" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="tinyBtn danger" type="submit" title="Archive property"><i class="fa-solid fa-box-archive"></i></button></form>`;
      }
      if (entity === 'room_type') {
        scopedActions += `<button class="tinyBtn" data-modal="create" data-type="room units" data-label="${safeLabel}"${detailAttr}${idAttr} title="Add room units"><i class="fa-solid fa-door-open"></i></button>`;
        scopedActions += `<button class="tinyBtn" data-modal="create" data-type="room night inventory" data-label="${safeLabel}"${detailAttr}${idAttr} title="Add room-night inventory"><i class="fa-regular fa-calendar-plus"></i></button>`;
        scopedActions += `<form method="POST" action="/company/hotels/room-types/${id}/archive" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="tinyBtn danger" type="submit" title="Archive room type"><i class="fa-solid fa-box-archive"></i></button></form>`;
      }
      if (entity === 'rate_plan') {
        scopedActions += `<form method="POST" action="/company/hotels/rate-plans/${id}/archive" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="tinyBtn danger" type="submit" title="Archive rate plan"><i class="fa-solid fa-box-archive"></i></button></form>`;
      }
      if (entity === 'room_unit') {
        scopedActions += `<button class="tinyBtn" data-modal="edit" data-type="housekeeping" data-label="${safeLabel}"${detailAttr}${idAttr} title="Update housekeeping"><i class="fa-solid fa-broom"></i></button>`;
        scopedActions += `<form method="POST" action="/company/hotels/room-units/${id}/archive" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="tinyBtn danger" type="submit" title="Archive room unit"><i class="fa-solid fa-box-archive"></i></button></form>`;
      }
      if (entity === 'room_night') {
        const bookingRef = encodeURIComponent(meta?.detail?.roomNight?.bookingRef || meta?.detail?.booking?.bookingRef || '');
        const roomBooking = meta?.detail?.booking?.booking || meta?.detail?.booking || {};
        const roomPaymentStatus = String(roomBooking.paymentStatus || '').toLowerCase();
        const roomBookingStatus = String(roomBooking.bookingStatus || '').toLowerCase().replace(/[\s-]+/g, '_');
        const roomStayStatus = String(roomBooking.hotelStay?.status || roomBookingStatus).toLowerCase().replace(/[\s-]+/g, '_');
        scopedActions += `<button class="tinyBtn" data-modal="edit" data-type="room night" data-label="${safeLabel}"${detailAttr}${idAttr} title="Update room-night status"><i class="fa-solid fa-calendar-check"></i></button>`;
        if (bookingRef && roomPaymentStatus === 'successful' && ['confirmed', 'booked'].includes(roomBookingStatus) && !['checked_in', 'occupied', 'in_house'].includes(roomStayStatus)) {
          scopedActions += `<form method="POST" action="/company/hotels/bookings/${bookingRef}/check-in" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="tinyBtn" type="submit" title="Guest check-in"><i class="fa-solid fa-person-circle-check"></i></button></form>`;
          scopedActions += `<form method="POST" action="/company/hotels/bookings/${bookingRef}/no-show" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="tinyBtn danger" type="submit" title="Mark hotel no-show"><i class="fa-solid fa-user-slash"></i></button></form>`;
        }
        if (bookingRef && ['checked_in', 'occupied', 'in_house'].includes(roomStayStatus)) {
          scopedActions += `<form method="POST" action="/company/hotels/bookings/${bookingRef}/check-out" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="tinyBtn" type="submit" title="Guest check-out"><i class="fa-solid fa-door-open"></i></button></form>`;
        }
        scopedActions += `<form method="POST" action="/company/hotels/inventory/${id}/archive" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="tinyBtn danger" type="submit" title="Archive room-night"><i class="fa-solid fa-box-archive"></i></button></form>`;
      }
    }
    if (role === 'employee' && id) {
      if (entity === 'booking' || entity === 'checkin' || entity === 'manifest_passenger' || entity === 'hotel_booking') {
        const bookingRef = encodeURIComponent(meta?.detail?.seat?.bookingRef || meta?.detail?.booking?.bookingRef || rawId || '');
        if (bookingRef) {
          scopedActions += `<a class="tinyBtn" href="${isHotelBooking ? `/employee/hotels/bookings/${bookingRef}/voucher` : `/driver/tickets/${bookingRef}`}" title="Open ${isHotelBooking ? 'hotel voucher' : 'ticket'}"><i class="fa-solid fa-ticket"></i></a>`;
          if (isHotelBooking) {
            if (paymentStatusKey === 'successful' && ['confirmed', 'booked'].includes(bookingStatusKey) && !['checked_in', 'occupied', 'in_house'].includes(stayStatusKey)) {
              scopedActions += `<form method="POST" action="/employee/hotels/bookings/${bookingRef}/check-in" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="tinyBtn" type="submit" title="Guest check-in"><i class="fa-solid fa-person-circle-check"></i></button></form>`;
              scopedActions += `<form method="POST" action="/employee/hotels/bookings/${bookingRef}/no-show" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="tinyBtn danger" type="submit" title="Mark hotel no-show"><i class="fa-solid fa-user-slash"></i></button></form>`;
            }
            if (['checked_in', 'occupied', 'in_house'].includes(stayStatusKey)) {
              scopedActions += `<form method="POST" action="/employee/hotels/bookings/${bookingRef}/check-out" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="tinyBtn" type="submit" title="Guest check-out"><i class="fa-solid fa-door-open"></i></button></form>`;
            }
          } else {
            scopedActions += `<form method="POST" action="/employee/bookings/${bookingRef}/check-in" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="tinyBtn" type="submit" title="Check in"><i class="fa-solid fa-qrcode"></i></button></form>`;
            scopedActions += `<form method="POST" action="/employee/bookings/${bookingRef}/no-show" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="tinyBtn danger" type="submit" title="No-show"><i class="fa-solid fa-user-slash"></i></button></form>`;
          }
          if (paymentStatusKey !== 'successful') scopedActions += `<button class="tinyBtn" data-modal="create" data-type="payment" data-label="${safeLabel}"${detailAttr}${idAttr} title="Record payment"><i class="fa-solid fa-wallet"></i></button>`;
          scopedActions += `<button class="tinyBtn" data-modal="create" data-type="refund" data-label="${safeLabel}"${detailAttr}${idAttr} title="Request refund"><i class="fa-solid fa-rotate-left"></i></button>`;
          scopedActions += `<button class="tinyBtn" data-modal="create" data-type="support notice" data-label="${safeLabel}"${detailAttr}${idAttr} title="Support notice"><i class="fa-solid fa-headset"></i></button>`;
        }
      }
      if (entity === 'schedule' || entity === 'manifest') {
        scopedActions += `<a class="tinyBtn" href="/driver/schedules/${id}/manifest" title="Open manifest"><i class="fa-solid fa-file-lines"></i></a>`;
        scopedActions += `<a class="tinyBtn" href="/driver/schedules/${id}/manifest.pdf" title="Download manifest PDF"><i class="fa-solid fa-file-pdf"></i></a>`;
        scopedActions += `<a class="tinyBtn" href="/driver/schedules/${id}/manifest.csv" title="Download manifest CSV"><i class="fa-solid fa-file-csv"></i></a>`;
        scopedActions += `<button class="tinyBtn" data-modal="create" data-type="delay notice" data-label="${safeLabel}"${detailAttr}${idAttr} title="Send delay notice"><i class="fa-solid fa-triangle-exclamation"></i></button>`;
      }
      if (entity === 'seat' || entity === 'inventory') {
        scopedActions += `<button class="tinyBtn" data-modal="edit" data-type="seat status" data-label="${safeLabel}"${detailAttr}${idAttr} title="Update inventory status"><i class="fa-solid fa-chair"></i></button>`;
        const parts = String(rawId || '').split(':');
        const scheduleId = encodeURIComponent(parts[0] || meta?.detail?.inventory?.scheduleId || meta?.detail?.seat?.scheduleId || meta?.detail?.seatMap?.scheduleId || '');
        const seatNo = encodeURIComponent(parts[1] || meta?.detail?.inventory?.seatNumber || meta?.detail?.seat?.seatNumber || '');
        if (scheduleId && seatNo) scopedActions += `<a class="tinyBtn" href="/driver/seats/${scheduleId}/${seatNo}/ticket" title="Open seat ticket"><i class="fa-solid fa-ticket"></i></a>`;
      }
    }
    return `<div class="rowActions">
      <button class="tinyBtn" data-modal="view" data-type="${safeType}" data-label="${safeLabel}"${detailAttr}${idAttr} title="View full details"><i class="fa-regular fa-eye"></i></button>
      ${modeActions}
      <button class="tinyBtn" data-copy-value="${safeLabel}" title="Copy reference"><i class="fa-regular fa-copy"></i></button>
      <button class="tinyBtn" data-export-row="${safeType}" data-label="${safeLabel}"${detailAttr} title="Export row"><i class="fa-solid fa-file-export"></i></button>
      ${scopedActions}
    </div>`;
  }

  function parseDetailFromElement(el) {
    const raw = el?.dataset?.rowDetail || '';
    if (!raw) return null;
    try { return JSON.parse(decodeURIComponent(raw)); } catch (error) { return null; }
  }

  function shouldShowDetailKey(label, value) {
    const key = String(label || '').toLowerCase();
    if (/token|hash|nonce|secret|password|rawpayload|raw_payload|metadata|__v|publicid|public_id|cloudinary|signature|session|cookie/.test(key)) return false;
    if (/^id$|\.id$/.test(key) && String(value || '').length > 18) return false;
    return true;
  }

  function cleanDetailLabel(label) {
    return String(label || '').split('.').pop().replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function flattenEntries(obj = {}, prefix = '') {
    const entries = [];
    Object.entries(obj || {}).forEach(([key, value]) => {
      const label = prefix ? `${prefix}.${key}` : key;
      if (!shouldShowDetailKey(label, value)) return;
      if (value && typeof value === 'object' && !Array.isArray(value)) entries.push(...flattenEntries(value, label));
      else if (Array.isArray(value)) entries.push([label, value.slice(0, 5).map(item => typeof item === 'object' ? JSON.stringify(item) : item).join(', ')]);
      else entries.push([label, value]);
    });
    return entries.slice(0, 30);
  }

  function detailItem(label, value) {
    const shown = value === undefined || value === null || value === '' ? '-' : value;
    return `<div class="detailItem"><span>${escapeHtml(cleanDetailLabel(label))}</span><b>${escapeHtml(shown)}</b></div>`;
  }

  function detailGroup(title, value, limit = 12) {
    const rawEntries = Array.isArray(value) ? value.map((item, index) => [`${title} ${index + 1}`, typeof item === 'object' ? JSON.stringify(item) : item]) : flattenEntries(value || {});
    const entries = rawEntries.filter(([, val]) => val !== undefined && val !== null && val !== '').slice(0, limit);
    if (!entries.length) return '';
    const longText = entries.some(([, val]) => String(val || '').length > 90);
    const cls = longText ? ' is-wide' : entries.length <= 4 ? ' is-compact' : '';
    return `<div class="detailGroup${cls}"><h4>${escapeHtml(title)}</h4><div class="detailGrid">${entries.map(([label, val]) => detailItem(label, val)).join('')}</div></div>`;
  }

  function entityFromDetail(type = '', detail = {}) {
    const raw = String(detail?.entity || type || '').toLowerCase().replace(/\s+/g, '_');
    if (raw === 'route_stop') return 'routestop';
    if (raw === 'hotel_property') return 'hotel_property';
    if (raw === 'room_type') return 'room_type';
    if (raw === 'room_unit') return 'room_unit';
    if (raw === 'room_night') return 'room_night';
    if (raw === 'seat_map' || raw === 'seatmap') return 'seat_map';
    if (raw === 'manifest') return 'manifest';
    if (raw.includes('publish') || raw.includes('readiness')) return 'publish_readiness';
    if (raw.includes('schedule') || detail.schedule) return 'schedule';
    if (raw.includes('vehicle') || detail.vehicle) return 'vehicle';
    if (raw.includes('route') || detail.route) return 'route';
    if (raw.includes('room') || detail.room) return 'room';
    if (raw.includes('booking') || detail.booking) return 'booking';
    if (raw.includes('listing') || detail.listing) return 'listing';
    return raw || 'record';
  }

  function valueByPath(source = {}, path = '') {
    return String(path || '').split('.').reduce((obj, part) => (obj && typeof obj === 'object') ? obj[part] : undefined, source);
  }

  function firstValue(source = {}, paths = []) {
    for (const path of paths) {
      const value = valueByPath(source, path);
      if (value !== undefined && value !== null && value !== '') return Array.isArray(value) ? value.join(', ') : value;
    }
    return '';
  }

  function curatedField(label, paths) { return { label, paths: Array.isArray(paths) ? paths : [paths] }; }

  function curatedDetailGroups(entity, detail = {}) {
    const commonOwner = [
      curatedField('Company', ['company.name','owner.companyName','listing.owner.companyName']),
      curatedField('Verification', ['company.verificationStatus','owner.verification']),
    ];
    const maps = {
      listing: [
        ['Service overview', [curatedField('Title', ['listing.title','service.title','title']), curatedField('Service type', ['listing.serviceType','service.type','serviceType']), curatedField('Status', ['listing.status','status']), curatedField('Price from', ['listing.priceFrom','inventory.basePrice','priceFrom']), curatedField('Currency', ['listing.currency','owner.currency','currency'])]],
        ['Location', [curatedField('City', ['listing.city','service.city','city']), curatedField('Country', ['listing.country','service.country','country']), curatedField('From', ['listing.from','service.from','from']), curatedField('To / area', ['listing.to','service.to','to'])]],
        ['Company', commonOwner],
      ],
      route: [
        ['Route', [curatedField('Route name', ['route.routeName','route.name','routeName']), curatedField('Origin', ['route.origin','origin']), curatedField('Destination', ['route.destination','destination']), curatedField('Status', ['route.status','status'])]],
        ['Operations', [curatedField('Boarding points', ['route.boardingPoints','boardingPoints']), curatedField('Drop-off points', ['route.dropoffPoints','dropoffPoints']), curatedField('Distance KM', ['route.distanceKm','distanceKm']), curatedField('Duration', ['route.estimatedDuration','estimatedDuration'])]],
        ['Policy', [curatedField('Baggage rules', ['route.baggageRules','baggageRules']), curatedField('Cancellation rules', ['route.cancellationRules','cancellationRules'])]],
      ],
      routestop: [
        ['Stop details', [curatedField('Name', ['routeStop.name','name']), curatedField('Type', ['routeStop.stopType','stopType']), curatedField('Order', ['routeStop.stopOrder','stopOrder']), curatedField('Time offset', ['routeStop.timeOffsetMinutes','timeOffsetMinutes'])]],
        ['Boarding rules', [curatedField('Pickup allowed', ['routeStop.pickupAllowed','pickupAllowed']), curatedField('Drop-off allowed', ['routeStop.dropoffAllowed','dropoffAllowed']), curatedField('Instructions', ['routeStop.publicInstructions','publicInstructions'])]],
      ],
      vehicle: [
        ['Vehicle', [curatedField('Name', ['vehicle.name','vehicle.vehicleName','name']), curatedField('Plate / code', ['vehicle.plateOrCode','vehicle.registrationNumber','plateOrCode']), curatedField('Status', ['vehicle.status','status']), curatedField('Service type', ['vehicle.serviceType','serviceType'])]],
        ['Seat layout', [curatedField('Layout', ['vehicle.layoutName','layoutName']), curatedField('Rows', ['vehicle.rows','rows']), curatedField('Capacity', ['vehicle.totalSeats','vehicle.capacity','totalSeats']), curatedField('Amenities', ['vehicle.amenities','amenities'])]],
      ],
      publish_readiness: [
        ['Publish readiness', [curatedField('Schedule ID', ['schedule.id','id']), curatedField('Current status', ['schedule.status','status']), curatedField('Ready', ['schedule.publishValidation.ok','publishValidation.ok']), curatedField('Route', ['route.routeName','schedule.routeId']), curatedField('Vehicle', ['vehicle.name','schedule.vehicleName','schedule.vehicleId'])]],
        ['Required checks', [curatedField('Validation failures', ['schedule.publishValidation.failures','publishValidation.failures']), curatedField('Driver', ['schedule.driverName','driverName']), curatedField('Departure', ['schedule.departAt','departAt']), curatedField('Base fare', ['schedule.basePrice','basePrice']), curatedField('Total seats', ['schedule.totalSeats','totalSeats'])]],
        ['Next action', [curatedField('Fix notes', ['schedule.publishValidation.message','publishValidation.message','schedule.notes']), curatedField('Boarding start', ['schedule.boardingStartAt','boardingStartAt']), curatedField('Currency', ['schedule.currency','currency'])]],
      ],
      schedule: [
        ['Schedule', [curatedField('Schedule ID', ['schedule.id','id']), curatedField('Route', ['schedule.routeLabel','route.routeName','schedule.routeId','routeId']), curatedField('Vehicle', ['schedule.vehicleName','vehicle.name','schedule.vehicleId','vehicleId']), curatedField('Status', ['schedule.status','status'])]],
        ['Timing and fare', [curatedField('Departure', ['schedule.departAt','schedule.departure','departAt']), curatedField('Arrival estimate', ['schedule.arriveAt','schedule.arrival','arriveAt']), curatedField('Base fare', ['schedule.basePrice','schedule.price','basePrice']), curatedField('Currency', ['schedule.currency','currency'])]],
        ['Operations', [curatedField('Driver', ['schedule.driverName','driverName']), curatedField('Available seats', ['schedule.availableSeats','availableSeats']), curatedField('Total seats', ['schedule.totalSeats','totalSeats']), curatedField('Notes', ['schedule.notes','notes'])]],
      ],
      room: [
        ['Room inventory', [curatedField('Room type', ['room.roomType','roomType']), curatedField('Capacity', ['room.capacity','capacity']), curatedField('Available units', ['room.inventory','inventory']), curatedField('Nightly price', ['room.nightlyPrice','nightlyPrice']), curatedField('Status', ['room.status','status'])]],
        ['Guest features', [curatedField('Amenities', ['room.amenities','amenities']), curatedField('Property', ['listing.service.title','listing.title'])]],
      ],
      hotel_property: [
        ['Property', [curatedField('Name', ['property.propertyName','listing.service.title','listing.title','propertyName']), curatedField('Status', ['property.status','status']), curatedField('City', ['property.city','listing.service.city','city']), curatedField('Country', ['property.country','listing.service.country','country'])]],
        ['Stay rules', [curatedField('Address', ['property.address','address']), curatedField('Check-in', ['property.checkInTime','checkInTime']), curatedField('Check-out', ['property.checkOutTime','checkOutTime']), curatedField('Amenities', ['property.amenities','amenities'])]],
      ],
      room_type: [
        ['Room type', [curatedField('Name', ['roomType.name','name']), curatedField('Capacity', ['roomType.capacity','capacity']), curatedField('Base price', ['roomType.basePrice','basePrice']), curatedField('Status', ['roomType.status','status'])]],
        ['Rules', [curatedField('Amenities', ['roomType.amenities','amenities']), curatedField('Policies', ['roomType.policies','policies'])]],
      ],
      rate_plan: [
        ['Rate plan', [curatedField('Name', ['ratePlan.name','name']), curatedField('Code', ['ratePlan.code','code']), curatedField('Status', ['ratePlan.status','status']), curatedField('Currency', ['ratePlan.currency','currency'])]],
        ['Price and meal', [curatedField('Base price', ['ratePlan.basePrice','basePrice']), curatedField('Pricing mode', ['ratePlan.pricingMode','pricingMode']), curatedField('Meal plan', ['ratePlan.mealPlan','mealPlan']), curatedField('Refundable', ['ratePlan.refundable','refundable'])]],
        ['Policies', [curatedField('Cancellation deadline', ['ratePlan.cancellationDeadlineHours','cancellationDeadlineHours']), curatedField('Penalty', ['ratePlan.cancellationPenaltyType','cancellationPenaltyType']), curatedField('Payment timing', ['ratePlan.paymentTiming','paymentTiming']), curatedField('Stay limits', ['ratePlan.minStay','minStay'])]],
      ],
      room_unit: [
        ['Room unit', [curatedField('Unit number', ['roomUnit.unitNumber','unitNumber']), curatedField('Floor', ['roomUnit.floor','floor']), curatedField('Wing', ['roomUnit.wing','wing']), curatedField('Status', ['roomUnit.status','status'])]],
        ['Housekeeping', [curatedField('Housekeeping status', ['roomUnit.housekeepingStatus','housekeepingStatus']), curatedField('Notes', ['roomUnit.notes','notes'])]],
      ],
      room_night: [
        ['Room night', [curatedField('Date', ['roomNight.date','date']), curatedField('Room unit', ['roomUnit.unitNumber','roomNight.roomUnitId','roomUnitId']), curatedField('Room type', ['roomType.name','roomNight.roomTypeId']), curatedField('Status', ['roomNight.status','status']), curatedField('Price', ['roomNight.price','price'])]],
        ['Guest / booking', [curatedField('Booking ref', ['roomNight.bookingRef','booking.bookingRef']), curatedField('Guest', ['roomNight.guestName','booking.guestSnapshot.fullName']), curatedField('Phone', ['booking.guestSnapshot.phone']), curatedField('Check-in state', ['roomNight.checkInStatus','booking.hotelStay.status'])]],
        ['Operations', [curatedField('Property', ['property.propertyName','listing.service.title','listing.title']), curatedField('Housekeeping', ['roomUnit.housekeepingStatus','roomNight.housekeepingStatus','housekeepingStatus']), curatedField('Notes', ['roomNight.notes','roomUnit.notes','notes'])]],
      ],
      hotel_booking: [
        ['Stay', [curatedField('Booking ref', ['booking.bookingRef','bookingRef']), curatedField('Status', ['booking.hotelStay.status','booking.bookingStatus','status']), curatedField('Payment', ['booking.paymentStatus','paymentStatus']), curatedField('Amount', ['booking.pricing.total','pricing.total','amount'])]],
        ['Guest', [curatedField('Name', ['booking.guestSnapshot.fullName','guestSnapshot.fullName','customer.name']), curatedField('Phone', ['booking.guestSnapshot.phone','guestSnapshot.phone','customer.phone']), curatedField('Email', ['booking.guestSnapshot.email','guestSnapshot.email','customer.email']), curatedField('Adults / children', ['booking.hotelStay.adults','hotelStay.adults'])]],
        ['Room and dates', [curatedField('Check-in', ['booking.hotelStay.checkIn','hotelStay.checkIn']), curatedField('Check-out', ['booking.hotelStay.checkOut','hotelStay.checkOut']), curatedField('Rooms', ['booking.hotelStay.roomCount','hotelStay.roomCount']), curatedField('Room units', ['booking.hotelStay.roomUnitIds','hotelStay.roomUnitIds']), curatedField('Requests', ['booking.hotelStay.specialRequests','hotelStay.specialRequests'])]],
      ],

      seat: [
        ['Seat', [curatedField('Seat No', ['seat.seatNumber','seatNumber']), curatedField('Schedule', ['seat.scheduleId','schedule.id','scheduleId']), curatedField('Route', ['seatMap.routeLabel','routeLabel']), curatedField('Vehicle', ['seatMap.vehicleName','vehicleName']), curatedField('Status', ['seat.status','status'])]],
        ['Ticket/customer', [curatedField('Booking ref', ['seat.bookingRef','booking.bookingRef','bookingRef']), curatedField('Passenger', ['seat.passengerName','passengerName']), curatedField('Phone', ['seat.passengerPhone','passengerPhone']), curatedField('Payment', ['seat.paymentStatus','paymentStatus']), curatedField('Check-in', ['seat.checkInStatus','checkInStatus'])]],
        ['Operations', [curatedField('Class', ['seat.seatClass','seatClass']), curatedField('Type', ['seat.seatType','seatType']), curatedField('Price delta', ['seat.priceDelta','priceDelta']), curatedField('Blocked reason', ['seat.blockedReason','blockedReason'])]],
      ],
      manifest_passenger: [
        ['Passenger', [curatedField('Seat No', ['seat.seatNumber','seatNumber']), curatedField('Name', ['seat.passengerName','passengerName']), curatedField('Phone', ['seat.passengerPhone','passengerPhone']), curatedField('Email', ['seat.passengerEmail','passengerEmail'])]],
        ['Booking', [curatedField('Booking ref', ['seat.bookingRef','booking.bookingRef','bookingRef']), curatedField('Ticket', ['seat.ticketNumber','ticketNumber']), curatedField('Payment', ['seat.paymentStatus','paymentStatus']), curatedField('Check-in', ['seat.checkInStatus','checkInStatus']), curatedField('Status', ['seat.status','status'])]],
        ['Trip', [curatedField('Schedule', ['manifest.scheduleId','schedule.id','scheduleId']), curatedField('Route', ['manifest.routeLabel','routeLabel']), curatedField('Vehicle', ['manifest.vehicleName','vehicleName']), curatedField('Date', ['manifest.travelDate','travelDate'])]],
      ],
      seat_map: [
        ['Seat map', [curatedField('Schedule', ['seatMap.scheduleId','schedule.id','scheduleId']), curatedField('Route', ['seatMap.routeLabel','routeLabel']), curatedField('Vehicle', ['seatMap.vehicleName','vehicleName']), curatedField('Status', ['seatMap.status','status'])]],
        ['Capacity', [curatedField('Total seats', ['seatMap.totalSeats','totalSeats']), curatedField('Booked', ['seatMap.bookedSeats','seatMap.soldSeats','bookedSeats','soldSeats']), curatedField('Held', ['seatMap.heldSeats','heldSeats']), curatedField('Blocked', ['seatMap.blockedSeats','blockedSeats'])]],
      ],
      manifest: [
        ['Manifest', [curatedField('Schedule', ['manifest.scheduleId','schedule.id','scheduleId']), curatedField('Route', ['manifest.routeLabel','routeLabel']), curatedField('Vehicle', ['manifest.vehicleName','vehicleName']), curatedField('Date', ['manifest.travelDate','travelDate']), curatedField('Status', ['manifest.status','status'])]],
        ['Boarding summary', [curatedField('Booked seats', ['manifest.totalBooked','totalBooked']), curatedField('Held seats', ['manifest.totalHeld','totalHeld']), curatedField('Checked in', ['manifest.totalCheckedIn','totalCheckedIn']), curatedField('No-shows', ['manifest.totalNoShow','totalNoShow'])]],
      ],
      booking: [
        ['Booking', [curatedField('Reference', ['booking.bookingRef','bookingRef']), curatedField('Service', ['booking.serviceType','serviceType']), curatedField('Status', ['booking.bookingStatus','status']), curatedField('Payment', ['booking.paymentStatus','paymentStatus']), curatedField('Amount', ['booking.pricing.total','pricing.total','amount'])]],
        ['Customer', [curatedField('Name', ['booking.guestSnapshot.fullName','guestSnapshot.fullName','customer.name']), curatedField('Phone', ['booking.guestSnapshot.phone','guestSnapshot.phone','customer.phone']), curatedField('Email', ['booking.guestSnapshot.email','guestSnapshot.email','customer.email'])]],
        ['Inventory', [curatedField('Listing', ['listing.service.title','booking.listingTitle','listing.title']), curatedField('Schedule', ['booking.scheduleId','scheduleId']), curatedField('Seat / room', ['booking.selected','selected','ticket.seatNumber','ticket.roomNumber'])]],
      ],
    };
    return maps[entity] || [];
  }

  function uniqueDetailEntries(entries = [], limit = 14) {
    const seen = new Set();
    return entries.filter(([label, value]) => {
      const cleanLabel = cleanDetailLabel(label);
      const key = cleanLabel.toLowerCase();
      if (!cleanLabel || seen.has(key)) return false;
      if (value === undefined || value === null || value === '') return false;
      seen.add(key);
      return true;
    }).slice(0, limit);
  }

  function balancedSupplementGroups(entity, detail = {}, usedLabels = new Set()) {
    const buckets = [
      ['Reference', ['id','bookingRef','ticketNumber','schedule.id','route.id','vehicle.id','listing.id','property.id','roomType.id','roomUnit.id','roomNight.id']],
      ['Operational status', ['status','bookingStatus','paymentStatus','checkInStatus','settlementStatus','verificationStatus','housekeepingStatus','serviceType','companyType']],
      ['Dates and timing', ['createdAt','updatedAt','departAt','arriveAt','departureTime','arrivalTime','date','travelDate','checkInTime','checkOutTime']],
      ['Commercial', ['price','priceFrom','basePrice','nightlyPrice','amount','currency','availableSeats','totalSeats','inventory','capacity']],
      ['Notes and policy', ['notes','description','publicInstructions','baggageRules','cancellationRules','policies','amenities','supportNote']]
    ];
    const groups = [];
    buckets.forEach(([title, paths]) => {
      const entries = uniqueDetailEntries(paths.map(path => [cleanDetailLabel(path), firstValue(detail, [path])]).filter(([, value]) => value !== ''), 6)
        .filter(([label]) => !usedLabels.has(label.toLowerCase()));
      if (entries.length) {
        entries.forEach(([label]) => usedLabels.add(label.toLowerCase()));
        groups.push(`<div class="detailGroup"><h4>${escapeHtml(title)}</h4><div class="detailGrid">${entries.map(([label, val]) => detailItem(label, val)).join('')}</div></div>`);
      }
    });
    return groups.join('');
  }

  function balancedFallbackMarkup(detail = {}, entity = '') {
    const entries = uniqueDetailEntries(flattenEntries(detail || {}, ''), 18);
    if (!entries.length) return '<div class="notice">No useful details are available for this row yet.</div>';
    const first = entries.slice(0, 6);
    const rest = entries.slice(6, 18);
    const groups = [];
    groups.push(`<div class="detailGroup is-compact"><h4>Summary</h4><div class="detailGrid">${first.map(([label, val]) => detailItem(label, val)).join('')}</div></div>`);
    if (rest.length) groups.push(`<div class="detailGroup"><h4>Additional useful details</h4><div class="detailGrid">${rest.map(([label, val]) => detailItem(label, val)).join('')}</div></div>`);
    return `<div class="detailBlock">${groups.join('')}</div>`;
  }

  function detailMarkup(detail = {}, type = '') {
    const entity = entityFromDetail(type, detail);
    const usedLabels = new Set();
    const curatedGroups = curatedDetailGroups(entity, detail).map(([title, fields]) => {
      const entries = uniqueDetailEntries(fields.map(field => [field.label, firstValue(detail, field.paths)]), 8);
      if (!entries.length) return '';
      entries.forEach(([label]) => usedLabels.add(String(label || '').toLowerCase()));
      const longText = entries.some(([, val]) => String(val || '').length > 90);
      const cls = longText ? ' is-wide' : entries.length <= 4 ? ' is-compact' : '';
      return `<div class="detailGroup${cls}"><h4>${escapeHtml(title)}</h4><div class="detailGrid">${entries.map(([label, val]) => detailItem(label, val)).join('')}</div></div>`;
    }).join('');
    const supplements = balancedSupplementGroups(entity, detail, usedLabels);
    if (curatedGroups || supplements) return `<div class="detailBlock">${curatedGroups}${supplements}</div>`;
    return balancedFallbackMarkup(detail, entity);
  }

  function detailActionBar(type, label, detail = {}) {
    const entity = entityFromDetail(type, detail);
    const recordId = detail?.id || dashboardRecordId(detail || {});
    const encodedDetail = escapeHtml(encodeDetail(detail));
    const safeLabel = escapeHtml(label || detail?.label || recordId || 'Record');
    const safeType = escapeHtml(entity || type || 'record');
    const idAttr = recordId ? ` data-row-id="${escapeHtml(recordId)}"` : '';
    const detailAttr = ` data-row-detail="${encodedDetail}"`;
    const archiveAction = archiveActionFor(entity, recordId);
    const detailBooking = detail?.booking?.booking || detail?.booking || detail?.reservation || {};
    const detailServiceType = String(detailBooking.serviceType || detail?.serviceType || '').toLowerCase();
    const isHotelDetail = entity === 'hotel_booking' || entity === 'hotel_reservation' || detailServiceType === 'hotel';
    const canMutate = (shell.currentRole || 'admin') === 'company' && recordId && mutableCompanyEntity(entity);
    const editBtn = canMutate ? `<button class="btn btnPrimary" type="button" data-modal="edit" data-type="${safeType}" data-label="${safeLabel}"${detailAttr}${idAttr}><i class="fa-solid fa-pen"></i> Edit</button>` : '';
    const deleteBtn = canMutate && archiveAction ? `<button class="btn danger" type="button" data-modal="delete" data-type="${safeType}" data-label="${safeLabel}"${detailAttr}${idAttr}><i class="fa-solid fa-box-archive"></i> Delete / archive</button>` : '';
    let opsBtn = '';
    if ((shell.currentRole || 'admin') === 'company' && entity === 'seat') {
      const parts = String(recordId || '').split(':');
      const scheduleId = encodeURIComponent(parts[0] || detail?.seat?.scheduleId || detail?.seatMap?.scheduleId || detail?.schedule?.id || '');
      const seatNo = encodeURIComponent(String(parts[1] || detail?.seat?.seatNumber || '').replace(/^seat\s*(no\.?|number)?\s*/i, '').replace(/^[A-Za-z](\d+)$/, '$1'));
      opsBtn += `<button class="btn btnPrimary" type="button" data-modal="edit" data-type="seat status" data-label="${safeLabel}"${detailAttr}${idAttr}><i class="fa-solid fa-chair"></i> Update status</button>`;
      if (scheduleId && seatNo) opsBtn += `<a class="btn" href="/company/seats/${scheduleId}/${seatNo}/ticket"><i class="fa-solid fa-ticket"></i> Seat ticket</a>`;
    }
    if ((shell.currentRole || 'admin') === 'company' && isHotelDetail && recordId) {
      const bookingRef = encodeURIComponent(detailBooking.bookingRef || detail?.bookingRef || recordId);
      const bookingStatus = String(detailBooking.bookingStatus || detailBooking.status || '').toLowerCase().replace(/[\s-]+/g, '_');
      const stayStatus = String(detailBooking.hotelStay?.status || bookingStatus).toLowerCase().replace(/[\s-]+/g, '_');
      const paymentStatus = String(detailBooking.paymentStatus || '').toLowerCase();
      opsBtn += `<a class="btn" href="/company/hotels/bookings/${bookingRef}/voucher"><i class="fa-solid fa-hotel"></i> Hotel voucher</a>`;
      opsBtn += `<a class="btn" href="/company/hotels/bookings/${bookingRef}/voucher.pdf"><i class="fa-solid fa-file-pdf"></i> Voucher PDF</a>`;
      if (paymentStatus === 'successful' && ['confirmed', 'booked'].includes(bookingStatus) && !['checked_in', 'occupied', 'in_house'].includes(stayStatus)) {
        opsBtn += `<form method="POST" action="/company/hotels/bookings/${bookingRef}/check-in" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="btn btnPrimary" type="submit"><i class="fa-solid fa-person-circle-check"></i> Check in</button></form>`;
        opsBtn += `<form method="POST" action="/company/hotels/bookings/${bookingRef}/no-show" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="btn danger" type="submit"><i class="fa-solid fa-user-slash"></i> No-show</button></form>`;
      }
      if (['checked_in', 'occupied', 'in_house'].includes(stayStatus)) {
        opsBtn += `<form method="POST" action="/company/hotels/bookings/${bookingRef}/check-out" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="btn btnPrimary" type="submit"><i class="fa-solid fa-door-open"></i> Check out</button></form>`;
      }
    }
    if ((shell.currentRole || 'admin') === 'company' && entity === 'manifest_passenger') {
      const bookingRef = encodeURIComponent(recordId || detail?.seat?.bookingRef || detail?.bookingRef || '');
      if (bookingRef) {
        opsBtn += `<a class="btn" href="/company/tickets/${bookingRef}"><i class="fa-solid fa-ticket"></i> Ticket</a>`;
        opsBtn += `<form method="POST" action="/company/scanner/validate" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><input type="hidden" name="bookingRef" value="${bookingRef}"><button class="btn btnPrimary" type="submit"><i class="fa-solid fa-qrcode"></i> Check in</button></form>`;
        opsBtn += `<form method="POST" action="/company/scanner/no-show" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><input type="hidden" name="bookingRef" value="${bookingRef}"><button class="btn danger" type="submit"><i class="fa-solid fa-user-slash"></i> No-show</button></form>`;
      }
    }
    if ((shell.currentRole || 'admin') === 'employee' && (entity === 'seat' || entity === 'inventory')) {
      const parts = String(recordId || '').split(':');
      const scheduleId = encodeURIComponent(parts[0] || detail?.inventory?.scheduleId || detail?.seat?.scheduleId || detail?.seatMap?.scheduleId || detail?.schedule?.id || '');
      const seatNo = encodeURIComponent(String(parts[1] || detail?.inventory?.seatNumber || detail?.seat?.seatNumber || '').replace(/^seat\s*(no\.?|number)?\s*/i, '').replace(/^[A-Za-z](\d+)$/, '$1'));
      opsBtn += `<button class="btn btnPrimary" type="button" data-modal="edit" data-type="seat status" data-label="${safeLabel}"${detailAttr}${idAttr}><i class="fa-solid fa-chair"></i> Update status</button>`;
      if (scheduleId && seatNo) opsBtn += `<a class="btn" href="/driver/seats/${scheduleId}/${seatNo}/ticket"><i class="fa-solid fa-ticket"></i> Seat ticket</a>`;
    }
    if ((shell.currentRole || 'admin') === 'employee' && isHotelDetail && recordId) {
      const bookingRef = encodeURIComponent(detailBooking.bookingRef || detail?.bookingRef || recordId);
      const bookingStatus = String(detailBooking.bookingStatus || detailBooking.status || '').toLowerCase().replace(/[\s-]+/g, '_');
      const stayStatus = String(detailBooking.hotelStay?.status || bookingStatus).toLowerCase().replace(/[\s-]+/g, '_');
      const paymentStatus = String(detailBooking.paymentStatus || '').toLowerCase();
      opsBtn += `<a class="btn" href="/employee/hotels/bookings/${bookingRef}/voucher"><i class="fa-solid fa-hotel"></i> Hotel voucher</a>`;
      opsBtn += `<a class="btn" href="/employee/hotels/bookings/${bookingRef}/voucher.pdf"><i class="fa-solid fa-file-pdf"></i> Voucher PDF</a>`;
      if (paymentStatus === 'successful' && ['confirmed', 'booked'].includes(bookingStatus) && !['checked_in', 'occupied', 'in_house'].includes(stayStatus)) {
        opsBtn += `<form method="POST" action="/employee/hotels/bookings/${bookingRef}/check-in" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="btn btnPrimary" type="submit"><i class="fa-solid fa-person-circle-check"></i> Check in</button></form>`;
        opsBtn += `<form method="POST" action="/employee/hotels/bookings/${bookingRef}/no-show" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="btn danger" type="submit"><i class="fa-solid fa-user-slash"></i> No-show</button></form>`;
      }
      if (['checked_in', 'occupied', 'in_house'].includes(stayStatus)) {
        opsBtn += `<form method="POST" action="/employee/hotels/bookings/${bookingRef}/check-out" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="btn btnPrimary" type="submit"><i class="fa-solid fa-door-open"></i> Check out</button></form>`;
      }
    }
    if ((shell.currentRole || 'admin') === 'employee' && !isHotelDetail && (entity === 'manifest_passenger' || entity === 'booking' || entity === 'checkin')) {
      const bookingRef = encodeURIComponent(recordId || detail?.seat?.bookingRef || detail?.booking?.bookingRef || detail?.bookingRef || '');
      if (bookingRef) {
        opsBtn += `<a class="btn" href="/driver/tickets/${bookingRef}"><i class="fa-solid fa-ticket"></i> Ticket</a>`;
        opsBtn += `<form method="POST" action="/employee/bookings/${bookingRef}/check-in" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="btn btnPrimary" type="submit"><i class="fa-solid fa-qrcode"></i> Check in</button></form>`;
        opsBtn += `<form method="POST" action="/employee/bookings/${bookingRef}/no-show" style="margin:0"><input type="hidden" name="_csrf" value="${csrfToken}"><button class="btn danger" type="submit"><i class="fa-solid fa-user-slash"></i> No-show</button></form>`;
        opsBtn += `<button class="btn" type="button" data-modal="create" data-type="payment" data-label="${safeLabel}"${detailAttr}${idAttr}><i class="fa-solid fa-wallet"></i> Payment</button>`;
        opsBtn += `<button class="btn" type="button" data-modal="create" data-type="support notice" data-label="${safeLabel}"${detailAttr}${idAttr}><i class="fa-solid fa-headset"></i> Support</button>`;
      }
    }
    if ((shell.currentRole || 'admin') === 'employee' && (entity === 'schedule' || entity === 'manifest')) {
      const scheduleId = encodeURIComponent(recordId || detail?.manifest?.scheduleId || detail?.schedule?.id || '');
      if (scheduleId) {
        opsBtn += `<a class="btn" href="/driver/schedules/${scheduleId}/manifest"><i class="fa-solid fa-file-lines"></i> Manifest</a>`;
        opsBtn += `<a class="btn" href="/driver/schedules/${scheduleId}/manifest.pdf"><i class="fa-solid fa-file-pdf"></i> PDF</a>`;
        opsBtn += `<button class="btn" type="button" data-modal="create" data-type="delay notice" data-label="${safeLabel}"${detailAttr}${idAttr}><i class="fa-solid fa-triangle-exclamation"></i> Delay notice</button>`;
      }
    }
    return `<div class="detailActions">
      <button class="btn" type="button" data-export-row="${safeType}" data-label="${safeLabel}"${detailAttr}><i class="fa-solid fa-file-pdf"></i> Export PDF</button>
      <button class="btn" type="button" data-copy-value="${safeLabel}"><i class="fa-regular fa-copy"></i> Copy ref</button>
      ${editBtn}${deleteBtn}${opsBtn}
      <button class="btn btnBlue" type="button" data-close-modal>Close</button>
    </div>`;
  }

  function openDetailModal(type, label, detail) {
    if (!els.crudModal || !els.crudTitle || !els.crudBody) return;
    const entity = entityFromDetail(type, detail || {});
    els.crudTitle.textContent = `View ${cleanDetailLabel(entity || type || 'record')}`;
    if (els.crudSub) els.crudSub.textContent = label ? `Selected: ${label}` : 'Important record details';
    els.crudBody.innerHTML = detailMarkup(detail || {}, entity) + detailActionBar(entity, label, detail || {});
    els.crudModal.classList.add('is-open');
  }

  function downloadText(filename, text, mime = 'text/plain') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }


  function exportDetailPdf(detail, name){
    const title = String(name || 'dashboard-record');
    const win = window.open('', '_blank', 'noopener,noreferrer,width=900,height=720');
    if(!win){ if(typeof toast === 'function') toast('Allow popups to export PDF'); else if(typeof showToast === 'function') showToast('Allow popups to export PDF'); return; }
    const body = detailMarkup(detail || {});
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)} PDF</title></head><body><div class="brand"><div><h1>Classic Trip Dashboard Record</h1><p>${escapeHtml(title)} · ${new Date().toLocaleString()}</p></div><button id="printRecordButton" type="button">Print / Save PDF</button></div>${body}<script>document.getElementById('printRecordButton').addEventListener('click',function(){window.print();});setTimeout(function(){window.print();},300);<\/script></body></html>`);
    win.document.close();
  }

  function exportRows(filename, rows) {
    const csv = rows.map(row => rowCells(row).map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    downloadText(filename, csv, 'text/csv');
  }

  function setHtml(selector, html) {
    const node = $(selector);
    if (node) node.innerHTML = html;
  }

  function fillOverviewStats() {
    const stats = Array.isArray(data.overviewStats) ? data.overviewStats : [];
    const grid = $('#overview .statsGrid');
    if (grid && stats.length > grid.querySelectorAll('.statCard').length) {
      stats.slice(grid.querySelectorAll('.statCard').length).forEach((stat) => {
        const card = document.createElement('article');
        card.className = 'statCard';
        card.innerHTML = `<div class="statTop"><div class="statIcon"><i class="fa-solid ${escapeHtml(stat.icon || 'fa-chart-simple')}"></i></div><span class="trend"><i class="fa-solid fa-circle-info"></i> ${escapeHtml(stat.hint || 'Live')}</span></div><div class="statNumber">${escapeHtml(stat.value || '-')}</div><div class="statLabel">${escapeHtml(stat.label || 'Metric')}</div>`;
        grid.appendChild(card);
      });
    }
    const cards = $$('#overview .statsGrid .statCard');
    stats.slice(0, cards.length).forEach((stat, index) => {
      const card = cards[index];
      const number = card.querySelector('.statNumber');
      const label = card.querySelector('.statLabel');
      const trend = card.querySelector('.trend');
      const icon = card.querySelector('.statIcon i');
      if (number) number.textContent = stat.value || '-';
      if (label) label.textContent = stat.label || 'Metric';
      if (trend) trend.innerHTML = `<i class="fa-solid fa-circle-info"></i> ${escapeHtml(stat.hint || 'Live')}`;
      if (icon && stat.icon) icon.className = `fa-solid ${stat.icon}`;
    });
    const liveItems = $$('#overview .liveItem');
    (data.liveActivity || []).slice(0, liveItems.length).forEach((item, index) => {
      const node = liveItems[index];
      const span = node.querySelector('span');
      const strong = node.querySelector('strong');
      if (span) span.textContent = item[0];
      if (strong) strong.textContent = item[1];
    });
  }

  function enhanceTables() {
    $$('.tableWrap').forEach((wrap, index) => {
      if (wrap.dataset.enhanced === 'true') return;
      const table = wrap.querySelector('table');
      if (!table) return;
      wrap.dataset.enhanced = 'true';
      const tools = document.createElement('div');
      tools.className = 'tableTools';
      tools.innerHTML = `
        <div class="control"><i class="fa-solid fa-magnifying-glass"></i><input data-table-search placeholder="Search this table"></div>
        <div class="control"><i class="fa-solid fa-filter"></i><select data-table-status><option value="">All statuses</option><option>active</option><option>confirmed</option><option>pending</option><option>review</option><option>refund</option><option>suspended</option></select></div>
        <div class="control"><i class="fa-regular fa-calendar"></i><input data-table-date type="date"></div>
        <button class="btn" type="button" data-export-table><i class="fa-solid fa-download"></i> Export CSV</button>`;
      wrap.parentNode.insertBefore(tools, wrap);
      const runFilter = () => {
        const q = tools.querySelector('[data-table-search]').value.toLowerCase().trim();
        const status = tools.querySelector('[data-table-status]').value.toLowerCase().trim();
        const date = tools.querySelector('[data-table-date]').value;
        Array.from(table.tBodies[0]?.rows || []).forEach(row => {
          const text = row.textContent.toLowerCase();
          const okQ = !q || text.includes(q);
          const okS = !status || text.includes(status);
          const okD = !date || text.includes(date);
          row.style.display = okQ && okS && okD ? '' : 'none';
        });
      };
      tools.addEventListener('input', runFilter);
      tools.addEventListener('change', runFilter);
      tools.querySelector('[data-export-table]').addEventListener('click', () => {
        const rows = Array.from(table.rows).filter(row => row.style.display !== 'none').map(row => Array.from(row.cells).map(cell => cell.textContent.trim()));
        const csv = rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
        downloadText(`classic-trip-table-${index + 1}.csv`, csv, 'text/csv');
        toast('Table CSV exported');
      });
    });
  }


  function rowOpenAttrs(label, type, meta = null) {
    if (!meta?.detail) return '';
    const safeLabel = escapeHtml(label || meta.label || 'Record');
    const safeType = escapeHtml(meta.entity || type || 'record');
    const detailAttr = ` data-row-detail="${escapeHtml(encodeDetail(meta.detail))}"`;
    const idAttr = meta.id ? ` data-row-id="${escapeHtml(meta.id)}"` : '';
    return ` class="clickableRow" data-modal="view" data-type="${safeType}" data-label="${safeLabel}"${detailAttr}${idAttr}`;
  }

  function fillRecent() {
    const recentRows = Array.isArray(data.recentBookings) ? data.recentBookings : [];
    setHtml('#recentBookings', recentRows.map(b => {
      const meta = rowMeta(b);
      const row = rowCells(b);
      return `<tr${rowOpenAttrs(row[0], 'booking', meta)}>
        <td><div class="nameCell"><div class="miniLogo">#</div><div><strong>${escapeHtml(row[0])}</strong><span>${escapeHtml(meta?.detail?.booking?.createdAt ? new Date(meta.detail.booking.createdAt).toLocaleString() : '-')}</span></div></div></td>
        <td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2])}</td><td>${escapeHtml(row[3])}</td><td>${badgeFor(row[4])}</td><td>${escapeHtml(row[5])}</td><td>${rowActions(row[0], 'booking', meta)}</td>
      </tr>`;
    }).join(''));
  }

  function fillTable(selector, rows, type = 'booking') {
    rows = Array.isArray(rows) ? rows : [];
    if (!rows.length) {
      setHtml(selector, '<tr class="emptyTableRow"><td colspan="99"><div class="emptyTableState"><div class="miniLogo"><i class="fa-solid fa-circle-info"></i></div><div><strong>No records found</strong><span>This tab has no matching records yet. Use the page action above to create the first connected record.</span></div></div></td></tr>');
      return;
    }
    setHtml(selector, rows.map(r => {
      const meta = rowMeta(r);
      const row = rowCells(r);
      const initial = escapeHtml(String(row[0] || '?').charAt(0));
      if (type === 'partners') return `<tr${rowOpenAttrs(row[0], 'partner', meta)}><td><div class="nameCell"><div class="miniLogo">${initial}</div><div><strong>${escapeHtml(row[0])}</strong><span>Partner account</span></div></div></td><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2])}</td><td>${escapeHtml(row[3])}</td><td>${badgeFor(row[4])}</td><td>${escapeHtml(row[5])}</td><td>${escapeHtml(row[6])}</td><td>${rowActions(row[0], 'partner', meta)}</td></tr>`;
      if (type === 'listings') return `<tr${rowOpenAttrs(row[0], 'listing', meta)}><td><div class="nameCell"><div class="miniLogo"><i class="fa-solid fa-layer-group"></i></div><div><strong>${escapeHtml(row[0])}</strong><span>Inventory listing</span></div></div></td><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2])}</td><td>${escapeHtml(row[3])}</td><td>${escapeHtml(row[4])}</td><td>${badgeFor(row[5])}</td><td>${escapeHtml(row[6])}</td><td>${rowActions(row[0], 'listing', meta)}</td></tr>`;
      if (type === 'routes') return `<tr${rowOpenAttrs(row[0], 'route', meta)}><td><div class="nameCell"><div class="miniLogo"><i class="fa-solid fa-route"></i></div><div><strong>${escapeHtml(row[0])}</strong><span>Route corridor</span></div></div></td><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2])}</td><td>${escapeHtml(row[3])}</td><td>${escapeHtml(row[4])}</td><td>${badgeFor(row[5])}</td><td>${rowActions(row[0], 'route', meta)}</td></tr>`;
      if (type === 'vehicles') return `<tr${rowOpenAttrs(row[0], 'vehicle', meta)}><td><div class="nameCell"><div class="miniLogo"><i class="fa-solid fa-bus-simple"></i></div><div><strong>${escapeHtml(row[0])}</strong><span>Fleet vehicle</span></div></div></td><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2])}</td><td>${escapeHtml(row[3])}</td><td>${escapeHtml(row[4])}</td><td>${badgeFor(row[5])}</td><td>${rowActions(row[0], 'vehicle', meta)}</td></tr>`;
      if (type === 'schedules') return `<tr${rowOpenAttrs(row[0], 'schedule', meta)}><td><div class="nameCell"><div class="miniLogo"><i class="fa-solid fa-calendar-days"></i></div><div><strong>${escapeHtml(row[0])}</strong><span>Departure schedule</span></div></div></td><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2])}</td><td>${escapeHtml(row[3])}</td><td>${escapeHtml(row[4])}</td><td>${badgeFor(row[5])}</td><td>${rowActions(row[0], 'schedule', meta)}</td></tr>`;
      if (type === 'payments') return `<tr${rowOpenAttrs(row[0], 'payment', meta)}><td>${escapeHtml(row[0])}</td><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2])}</td><td>${escapeHtml(row[3])}</td><td>${escapeHtml(row[4])}</td><td>${escapeHtml(row[5])}</td><td>${badgeFor(row[6])}</td><td>${rowActions(row[0], 'payment', meta)}</td></tr>`;
      if (type === 'promoters') return `<tr${rowOpenAttrs(row[0], 'promoter', meta)}><td><div class="nameCell"><div class="miniLogo">${initial}</div><div><strong>${escapeHtml(row[0])}</strong><span>Referral account</span></div></div></td><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2])}</td><td>${escapeHtml(row[3])}</td><td>${escapeHtml(row[4])}</td><td>${badgeFor(row[5])}</td><td>${rowActions(row[0], 'promoter', meta)}</td></tr>`;
      if (type === 'customers') return `<tr${rowOpenAttrs(row[0], 'customer', meta)}><td><div class="nameCell"><div class="miniLogo">${initial}</div><div><strong>${escapeHtml(row[0])}</strong><span>Customer profile</span></div></div></td><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2])}</td><td>${escapeHtml(row[3])}</td><td>${escapeHtml(row[4])}</td><td>${badgeFor(row[5])}</td><td>${rowActions(row[0], 'customer', meta)}</td></tr>`;
      if (type === 'support') return `<tr${rowOpenAttrs(row[0], 'support ticket', meta)}><td>${escapeHtml(row[0])}</td><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2])}</td><td>${badgeFor(row[3])}</td><td>${badgeFor(row[4])}</td><td>${escapeHtml(row[5])}</td><td>${rowActions(row[0], 'support ticket', meta)}</td></tr>`;
      if (type === 'ads') return `<tr${rowOpenAttrs(row[0], 'ad campaign', meta)}><td><div class="nameCell"><div class="miniLogo"><i class="fa-solid fa-rectangle-ad"></i></div><div><strong>${escapeHtml(row[0])}</strong><span>Promotion campaign</span></div></div></td><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2])}</td><td>${escapeHtml(row[3])}</td><td>${escapeHtml(row[4])}</td><td>${escapeHtml(row[5])}</td><td>${badgeFor(row[6])}</td><td>${rowActions(row[0], 'ad campaign', meta)}</td></tr>`;
      if (type === 'audit') return `<tr${rowOpenAttrs(row[2], 'audit log', meta)}><td>${escapeHtml(row[0])}</td><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2])}</td><td>${escapeHtml(row[3])}</td><td>${escapeHtml(row[4])}</td><td>${badgeFor(row[5])}</td><td>${rowActions(row[2], 'audit log', meta)}</td></tr>`;
      if (type === 'admins') return `<tr${rowOpenAttrs(row[0], 'admin user', meta)}><td><div class="nameCell"><div class="miniLogo"><i class="fa-solid fa-user-shield"></i></div><div><strong>${escapeHtml(row[0])}</strong><span>Team member</span></div></div></td><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2])}</td><td>${badgeFor(row[3])}</td><td>${escapeHtml(row[4])}</td><td>${badgeFor(row[5])}</td><td>${rowActions(row[0], 'admin user', meta)}</td></tr>`;
      if (type === 'kyc') return `<tr${rowOpenAttrs(row[0], 'verification case', meta)}><td><div class="nameCell"><div class="miniLogo"><i class="fa-solid fa-id-card"></i></div><div><strong>${escapeHtml(row[0])}</strong><span>Verification case</span></div></div></td><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2])}</td><td>${escapeHtml(row[3])}</td><td>${badgeFor(row[4])}</td><td>${badgeFor(row[5])}</td><td>${rowActions(row[0], 'verification case', meta)}</td></tr>`;
      if (type === 'refunds') return `<tr${rowOpenAttrs(row[0], 'refund', meta)}><td>${escapeHtml(row[0])}</td><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2])}</td><td>${escapeHtml(row[3])}</td><td>${escapeHtml(row[4])}</td><td>${badgeFor(row[5])}</td><td>${rowActions(row[0], 'refund', meta)}</td></tr>`;
      if (type === 'notifications') return `<tr${rowOpenAttrs(row[0], 'notification', meta)}><td><div class="nameCell"><div class="miniLogo"><i class="fa-solid fa-bell"></i></div><div><strong>${escapeHtml(row[0])}</strong><span>Message campaign</span></div></div></td><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2])}</td><td>${escapeHtml(row[3])}</td><td>${escapeHtml(row[4])}</td><td>${badgeFor(row[5])}</td><td>${rowActions(row[0], 'notification', meta)}</td></tr>`;
      if (type === 'generic') return `<tr${rowOpenAttrs(row[0], meta?.entity || 'record', meta)}>${row.slice(0, 7).map((cell, idx) => idx === 0 ? `<td><div class="nameCell"><div class="miniLogo">${initial}</div><div><strong>${escapeHtml(cell)}</strong><span>${escapeHtml(meta?.entity || 'Record')}</span></div></div></td>` : idx === Math.min(row.length - 1, 5) ? `<td>${badgeFor(cell)}</td>` : `<td>${escapeHtml(cell)}</td>`).join('')}<td>${rowActions(row[0], meta?.entity || 'record', meta)}</td></tr>`;
      return `<tr${rowOpenAttrs(row[0], 'booking', meta)}><td><div class="nameCell"><div class="miniLogo">#</div><div><strong>${escapeHtml(row[0])}</strong><span>Booking order</span></div></div></td><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2])}</td><td>${escapeHtml(row[3])}</td><td>${escapeHtml(row[4])}</td><td>${badgeFor(row[5])}</td><td>${escapeHtml(row[6])}</td><td>${rowActions(row[0], 'booking', meta)}</td></tr>`;
    }).join(''));
  }

  function fillBars(id, rows) {
    const safeRows = (Array.isArray(rows) ? rows : [])
      .map(([label, value]) => [String(label || ''), Math.max(0, Number(value) || 0)])
      .filter(([label]) => Boolean(label));
    if (!safeRows.length) {
      setHtml('#' + id, '<div class="emptyState"><strong>No records yet</strong><span>This chart will populate from MongoDB data.</span></div>');
      return;
    }
    const max = Math.max(...safeRows.map(([, value]) => value), 0);
    setHtml('#' + id, safeRows.map(([label, value]) => {
      const height = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 4;
      return `<div class="bar" style="height:${height}%" title="${escapeHtml(`${label}: ${value}`)}"><span>${escapeHtml(label)} · ${escapeHtml(String(value))}</span></div>`;
    }).join(''));
  }

  function renderSeatMapTable(maps) {
    const rows = (Array.isArray(maps) ? maps : []).map((m, idx) => {
      const total = Number(m.totalSeats || m.totals?.total || (m.seats || []).length || 0);
      const booked = Number(m.soldSeats || m.bookedSeats || m.totals?.booked || (m.seats || []).filter(s => /booked|taken|sold/i.test(s.status || '')).length || 0);
      const held = Number(m.heldSeats || m.totals?.held || (m.seats || []).filter(s => /hold|lock/i.test(s.status || '')).length || 0);
      const blocked = Number(m.blockedSeats || m.totals?.blocked || (m.seats || []).filter(s => /block|maintenance|disabled/i.test(s.status || '')).length || 0);
      const mapId = String(m.scheduleId || m.id || `seat-map-${idx}`);
      return [m.scheduleId || m.id || m.routeLabel || 'Seat map', m.routeLabel || m.listingTitle || '-', m.vehicleName || '-', String(total), String(booked), `${held} / ${blocked}`, m.status || 'active', { entity: 'seat_map', id: mapId, detail: { entity: 'seat_map', seatMap: m, schedule: { id: m.scheduleId || m.id, status: m.status }, routeLabel: m.routeLabel, vehicleName: m.vehicleName, totalSeats: total, bookedSeats: booked, heldSeats: held, blockedSeats: blocked, status: m.status } }];
    });
    fillTable('#companySeatMapsTable', rows, 'generic');
    const tbody = document.querySelector('#companySeatMapsTable');
    if (tbody) {
      Array.from(tbody.querySelectorAll('tr')).forEach((row, idx) => {
        const map = maps[idx] || {};
        row.dataset.seatMapRow = String(map.scheduleId || map.id || `seat-map-${idx}`);
      });
    }
    syncSelectedSeatMap();
  }

  function syncSelectedSeatMap() {
    const select = document.querySelector('[data-seat-map-select]');
    if (!select) return;
    const selected = String(select.value || '');
    const selectedOption = select.options[select.selectedIndex];
    const statTotal = document.querySelector('[data-seat-map-total]');
    const statBooked = document.querySelector('[data-seat-map-booked]');
    const statHeld = document.querySelector('[data-seat-map-held]');
    const statBlocked = document.querySelector('[data-seat-map-blocked]');
    if (selectedOption) {
      if (statTotal) statTotal.textContent = selectedOption.dataset.total || '0';
      if (statBooked) statBooked.textContent = selectedOption.dataset.booked || '0';
      if (statHeld) statHeld.textContent = selectedOption.dataset.held || '0';
      if (statBlocked) statBlocked.textContent = selectedOption.dataset.blocked || '0';
    }
    document.querySelectorAll('[data-seat-map-panel]').forEach(panel => {
      panel.hidden = String(panel.getAttribute('data-seat-map-panel')) !== selected;
    });
    const rows = document.querySelectorAll('[data-seat-map-row]');
    rows.forEach(row => {
      row.style.display = String(row.dataset.seatMapRow || '') === selected ? '' : 'none';
    });
    const empty = document.querySelector('[data-empty-for="#companySeatMapsTable"]');
    if (empty) empty.style.display = Array.from(rows).some(row => row.style.display !== 'none') ? 'none' : 'block';
  }

  function applyDashboardFilter(filterBox) {
    if (!filterBox) return;
    const target = filterBox.getAttribute('data-filter-target');
    const tbody = target ? document.querySelector(target) : null;
    if (!tbody) return;
    const query = String(filterBox.querySelector('[data-filter-search]')?.value || '').trim().toLowerCase();
    const selectValues = Array.from(filterBox.querySelectorAll('[data-filter-select]')).map(sel => String(sel.value || '').trim().toLowerCase()).filter(Boolean);
    let visible = 0;
    Array.from(tbody.querySelectorAll('tr')).forEach(row => {
      const hay = row.textContent.toLowerCase();
      const matchesSearch = !query || hay.includes(query);
      const matchesSelects = selectValues.every(value => hay.includes(value));
      let scopedMatch = true;
      if (target === '#companySeatMapsTable') {
        const seatMapSelect = document.querySelector('[data-seat-map-select]');
        const selectedMap = String(seatMapSelect?.value || '');
        scopedMatch = !selectedMap || !row.dataset.seatMapRow || String(row.dataset.seatMapRow) === selectedMap;
      }
      const show = matchesSearch && matchesSelects && scopedMatch;
      row.style.display = show ? '' : 'none';
      if (show) visible += 1;
    });
    const empty = document.querySelector(`[data-empty-for="${target}"]`);
    if (empty) empty.style.display = visible ? 'none' : 'block';
  }

  function initDashboardFilters(scope = document) {
    scope.querySelectorAll('[data-filter-target]').forEach(applyDashboardFilter);
  }

  function closeMenu() {
    document.body.classList.remove('menu-open');
  }

  function activateTab(button, shouldScroll = true) {
    if (!button) return;
    const group = button.closest('.innerTabs[data-tab-group]');
    const targetId = button.dataset ? button.dataset.tabTarget : '';
    if (!group || !targetId) return;

    const scope = group.closest('.card') || group.closest('.section') || document;
    const tabButtons = Array.from(group.querySelectorAll('.tabBtn[data-tab-target]'));
    const paneIds = tabButtons.map(btn => btn.dataset.tabTarget).filter(Boolean);

    tabButtons.forEach(btn => {
      const active = btn === button;
      btn.classList.toggle('is-on', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.setAttribute('tabindex', active ? '0' : '-1');
    });

    paneIds.forEach(id => {
      const pane = document.getElementById(id);
      if (!pane || !scope.contains(pane)) return;
      const open = id === targetId;
      pane.classList.toggle('is-open', open);
      pane.hidden = !open;
      pane.setAttribute('aria-hidden', open ? 'false' : 'true');
      pane.style.display = open ? 'block' : 'none';
    });

    if (shouldScroll) {
      const topbar = $('.topbar');
      const offset = (topbar ? topbar.getBoundingClientRect().height : 52) + 6;
      const y = window.scrollY + group.getBoundingClientRect().top - offset;
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    }
  }

  function placePageUnderTopNav(behavior = 'auto') {
    const app = $('.app');
    const top = Math.max(0, app ? app.offsetTop : 0);
    window.scrollTo({ top, behavior });
    document.documentElement.scrollTop = top;
    document.body.scrollTop = top;
  }

  function canonicalPage(page) {
    const role = shell.currentRole || 'admin';
    const aliases = {
          company: { payouts: 'settlement' },
          customer: { refunds: 'customer-refunds', support: 'customer-support', reviews: 'customer-reviews', notifications: 'customer-notifications', profile: 'customer-profile' },
      promoter: { support: 'promoter-support', profile: 'promoter-profile' },
      employee: { checkin: 'checkins', schedule: 'schedules', inventory: 'seat-maps', shift: 'handover', 'shift-handover': 'handover', 'my-profile': 'profile' },
      driver: { checkin: 'checkins', schedule: 'schedules', inventory: 'seat-maps', shift: 'handover', 'shift-handover': 'handover', 'my-profile': 'profile' },
      operations: { checkin: 'checkins', schedule: 'schedules', inventory: 'seat-maps' }
    };
    return aliases[role]?.[page] || page;
  }

  function showPage(page) {
    const requestedPage = page || 'overview';
    page = canonicalPage(requestedPage);
    $$('.section').forEach(section => section.classList.remove('is-open'));
    let target = $('#' + page);
    if (!target) {
      const label = (pageMeta[page] && pageMeta[page][0]) || page.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const main = $('.main');
      target = document.createElement('section');
      target.className = 'section';
      target.id = page;
      target.innerHTML = `<div class="card"><div class="cardHead"><div class="cardTitle"><h3>${escapeHtml(label)}</h3><p>${escapeHtml((pageMeta[page] && pageMeta[page][1]) || 'This page uses the shared admin dashboard shell and should be wired to role-scoped backend data.')}</p></div><span class="badge warn">Configured</span></div><div class="splitGrid"><div class="splitItem"><div class="splitTop"><span>Route/menu exists</span><span class="badge ok">Yes</span></div></div><div class="splitItem"><div class="splitTop"><span>Uses shared admin UI</span><span class="badge ok">Yes</span></div></div><div class="splitItem"><div class="splitTop"><span>Backend data needed</span><span class="badge warn">Wire service</span></div></div></div></div>`;
      main.appendChild(target);
    }
    if (target) target.classList.add('is-open');
    const navButtons = $$('.navBtn');
    const hasExactNav = navButtons.some(btn => btn.dataset.page === requestedPage);
    navButtons.forEach(btn => btn.classList.toggle('is-active', hasExactNav ? btn.dataset.page === requestedPage : canonicalPage(btn.dataset.page) === page));
    const meta = pageMeta[requestedPage] || pageMeta[page] || pageMeta.overview;
    if (els.pageHeading) els.pageHeading.textContent = meta[0];
    if (els.pageSub) els.pageSub.textContent = meta[1];
    closeMenu();
    placePageUnderTopNav('auto');
    requestAnimationFrame(() => {
      placePageUnderTopNav('auto');
      requestAnimationFrame(() => placePageUnderTopNav('auto'));
    });
    setTimeout(() => placePageUnderTopNav('auto'), 40);
  }

  function toast(text) {
    if (!els.toast || !els.toastText) return;
    els.toastText.textContent = text;
    els.toast.classList.add('show');
    clearTimeout(window.__ctToastTimer);
    window.__ctToastTimer = setTimeout(() => els.toast.classList.remove('show'), 2100);
  }

  const OPTION_META_KEYS = [
    'id','companyId','listingId','routeId','scheduleId','vehicleId','fareProductId','originStopId','destinationStopId','branchId','propertyId','roomTypeId','roomUnitId','serviceType','branchType','status','userId','driverEmployeeId',
    'title','currency','country','city','address','timezone','terminalCode','routeName','routeCode','origin','destination','estimatedDuration','estimatedDurationMinutes','operatingDays','activeFareProductId',
    'layoutName','seatLabelMode','seatLabelPrefix','rows','columns','cols','totalSeats','seatLabels','vipSeats','accessibleSeats','crewSeats','disabledSeats','blockedSeats','defaultSeatClass','vipPriceDelta','activeSeatMapVersionId','seatMapVersionId','seatMapVersion','seatMapStatus',
    'plateOrCode','manufacturer','modelName','modelYear','operatorPermitRef','operatorPermitExpiresAt','inspectionRef','inspectionExpiresAt','insuranceRef','insuranceExpiresAt','amenities',
    'fareClass','amount','baggageAllowanceKg','refundable','changeable','departAt','arriveAt','stopOrder','stopType','pickupAllowed','dropoffAllowed','baggageRules','cancellationRules'
  ];

  function optionMetadata(source = {}) {
    const metadata = {};
    OPTION_META_KEYS.forEach((key) => {
      if (source && source[key] !== undefined && source[key] !== null && source[key] !== '') metadata[key] = source[key];
    });
    return metadata;
  }

  function optionFromRows(rows, fallback = 'Select item', valueIndex = 0, labelIndex = 0) {
    const options = (rows || []).map(row => {
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        const value = row.value || row.id || row.slug || row.key || '';
        const label = row.label || row.title || row.name || row.routeLabel || value;
        return { value, label, ...optionMetadata(row) };
      }
      const meta = rowMeta(row);
      const cells = rowCells(row);
      const detail = meta?.detail || {};
      const entity = detail.listing || detail.route || detail.schedule || detail.vehicle || detail.branch || detail.property || detail.roomType || detail.roomUnit || detail.driver || detail.user || {};
      return {
        value: meta?.id || cells[valueIndex] || cells[labelIndex],
        label: cells[labelIndex] || meta?.label || meta?.id,
        ...optionMetadata(meta || {}),
        ...optionMetadata(entity),
      };
    }).filter(item => item.value);
    return options.length ? options : [{ value: '', label: fallback, placeholder: true }];
  }

  function kebabCase(value = '') {
    return String(value).replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/_/g, '-').toLowerCase();
  }

  function optionDataAttributes(item = {}) {
    if (!item || typeof item === 'string') return '';
    return OPTION_META_KEYS.map((key) => item[key] === undefined || item[key] === null || item[key] === '' ? '' : ` data-${kebabCase(key)}="${escapeHtml(item[key])}"`).join('');
  }

  function selectOptions(items, selected = '') {
    const normalized = Array.isArray(items) ? items : [];
    const hasPlaceholder = normalized.some(item => typeof item === 'object' && (item.placeholder || item.value === ''));
    const rows = hasPlaceholder ? normalized : [{ value: '', label: 'Select an option', placeholder: true }, ...normalized];
    return rows.map(item => {
      const value = typeof item === 'string' ? item : item.value;
      const label = typeof item === 'string' ? item : item.label;
      const disabled = item && typeof item === 'object' && item.placeholder ? ' disabled' : '';
      return `<option value="${escapeHtml(value)}"${optionDataAttributes(item)}${String(value) === String(selected) ? ' selected' : ''}${disabled}>${escapeHtml(label)}</option>`;
    }).join('');
  }

  function dependencyAttributes(field = {}) {
    if (!field.dependsOn) return '';
    return ` data-depends-on="${escapeHtml(field.dependsOn)}" data-filter-key="${escapeHtml(field.filterKey || '')}" data-parent-meta-key="${escapeHtml(field.parentMetaKey || '')}"`;
  }

  function adminFieldHtml(field, readonly = false, disabled = false) {
    const ro = readonly || field.readonly ? 'readonly' : '';
    const dis = disabled || field.disabled ? 'disabled' : '';
    const required = field.required ? 'required' : '';
    const help = field.help ? `<small class="fieldHelp">${escapeHtml(field.help)}</small>` : '';
    const showFor = field.showFor ? ` data-show-for="${escapeHtml([].concat(field.showFor).join(','))}"` : '';
    const requiredMeta = field.required ? ' data-original-required="true"' : '';
    const dependency = dependencyAttributes(field);
    const smart = field.smart ? ` data-smart="${escapeHtml(field.smart)}"` : '';
    if (field.type === 'hidden') return `<input type="hidden" name="${escapeHtml(field.name)}" value="${escapeHtml(field.value || '')}">`;
    if (field.type === 'smart-summary') {
      return `<div class="field full smartBusSummary" data-smart-summary="${escapeHtml(field.summary || 'bus')}"><div class="smartBusSummaryInner"><i class="fa-solid ${field.icon || 'fa-wand-magic-sparkles'}"></i><div><strong>${escapeHtml(field.label || 'Smart form')}</strong><span data-smart-summary-text>${escapeHtml(field.help || 'Select the related record and the form will fill verified details automatically.')}</span></div></div></div>`;
    }
    if (field.type === 'seat-labels') {
      return `<div class="field full seatLabelEditor" data-seat-label-editor><label>${escapeHtml(field.label)}${field.required ? ' *' : ''}</label><div class="control"><textarea name="${escapeHtml(field.name)}" placeholder="${escapeHtml(field.placeholder || '1, 2, 3, 4...')}" ${ro} ${required}${requiredMeta}${smart}>${escapeHtml(field.value || '')}</textarea></div><div class="seatLabelTools"><span data-seat-label-count>0 labels</span><button class="tinyBtn" type="button" data-generate-seat-labels="numeric"><i class="fa-solid fa-arrow-down-1-9"></i> Numeric</button><button class="tinyBtn" type="button" data-generate-seat-labels="row_letters"><i class="fa-solid fa-table-cells"></i> Row letters</button></div>${help}</div>`;
    }
    if (field.type === 'textarea') {
      return `<div class="field ${field.full ? 'full' : ''}"${showFor}><label>${escapeHtml(field.label)}${field.required ? ' *' : ''}</label><div class="control"><textarea name="${escapeHtml(field.name)}" placeholder="${escapeHtml(field.placeholder || '')}" ${ro} ${required}${requiredMeta}${smart}>${escapeHtml(field.value || '')}</textarea></div>${help}</div>`;
    }
    if (field.type === 'select') {
      return `<div class="field ${field.full ? 'full' : ''}"${showFor}><label>${escapeHtml(field.label)}${field.required ? ' *' : ''}</label><div class="control"><i class="fa-solid ${field.icon || 'fa-list'}"></i><select name="${escapeHtml(field.name)}" ${dis} ${required}${requiredMeta}${dependency}${smart}>${selectOptions(field.options, field.value || '')}</select></div>${help}</div>`;
    }
    if (field.type === 'multiselect') {
      const name = String(field.name).endsWith('[]') ? field.name : `${field.name}[]`;
      const selectedValues = Array.isArray(field.value)
        ? field.value.map(String)
        : String(field.value || '').split(',').map(v => v.trim()).filter(Boolean);
      const options = (field.options || []).filter(item => !(item && typeof item === 'object' && item.placeholder)).map(item => {
        const value = typeof item === 'string' ? item : item.value;
        const optionLabel = typeof item === 'string' ? item : item.label;
        const checked = selectedValues.includes(String(value)) ? 'checked' : '';
        return `<label class="foldOption" title="${escapeHtml(optionLabel)}"${optionDataAttributes(item)}><input type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(value)}" ${checked} ${dis}><span>${escapeHtml(optionLabel)}</span></label>`;
      }).join('') || `<div class="notice">No options available yet. Add the related records first.</div>`;
      return `<div class="field ${field.full ? 'full' : ''}"${showFor}><label>${escapeHtml(field.label)}${field.required ? ' *' : ''}</label><details class="foldSelect" data-fold-select data-field-name="${escapeHtml(field.name)}"${dependency}><summary><span class="foldSelectTitle"><i class="fa-solid ${field.icon || 'fa-list-check'}"></i><span>${escapeHtml(field.placeholder || 'Select options')}</span></span><span class="foldSelectCount" data-fold-count>0 selected <i class="fa-solid fa-chevron-down"></i></span></summary><div class="foldSelectPanel">${options}</div></details>${help}</div>`;
    }
    return `<div class="field ${field.full ? 'full' : ''}"${showFor}><label>${escapeHtml(field.label)}${field.required ? ' *' : ''}</label><div class="control"><i class="fa-solid ${field.icon || 'fa-pen'}"></i><input name="${escapeHtml(field.name)}" type="${escapeHtml(field.type || 'text')}" value="${escapeHtml(field.value || '')}" placeholder="${escapeHtml(field.placeholder || '')}" ${ro} ${required}${requiredMeta}${smart}></div>${help}</div>`;
  }

  function selectedOptionMeta(select, key) {
    const option = select?.selectedOptions?.[0];
    if (!option || !key) return '';
    return option.getAttribute(`data-${kebabCase(key)}`) || '';
  }

  function refreshDependentControl(control, form) {
    const parentName = control.dataset.dependsOn;
    if (!parentName || !form) return;
    const parent = form.elements[parentName];
    if (!parent) return;
    const parentMetaKey = control.dataset.parentMetaKey;
    const parentValue = parentMetaKey ? selectedOptionMeta(parent, parentMetaKey) : parent.value;
    const filterKey = control.dataset.filterKey;
    if (!filterKey) return;
    const attribute = `data-${kebabCase(filterKey)}`;
    if (control.matches('select')) {
      Array.from(control.options).forEach((option) => {
        if (!option.value) { option.hidden = false; option.disabled = option.dataset.placeholder === 'true' || option.disabled; return; }
        const matchValue = option.getAttribute(attribute) || '';
        const visible = !parentValue || String(matchValue) === String(parentValue);
        option.hidden = !visible;
        option.disabled = !visible;
        if (!visible && option.selected) option.selected = false;
      });
      if (control.selectedIndex < 0 || control.options[control.selectedIndex]?.disabled) control.value = '';
      control.disabled = !parentValue;
    } else if (control.matches('[data-fold-select]')) {
      let visibleCount = 0;
      control.querySelectorAll('.foldOption').forEach((label) => {
        const matchValue = label.getAttribute(attribute) || '';
        const visible = !parentValue || String(matchValue) === String(parentValue);
        label.hidden = !visible;
        const input = label.querySelector('input');
        if (input) { input.disabled = !visible; if (!visible) input.checked = false; }
        if (visible) visibleCount += 1;
      });
      control.classList.toggle('is-disabled', !parentValue || visibleCount === 0);
      updateFoldSelectCount(control);
    }
  }

  function bindDependentFields(root) {
    const form = root?.querySelector?.('form') || root?.closest?.('form') || (root?.matches?.('form') ? root : null);
    if (!form) return;
    form.querySelectorAll('[data-depends-on]').forEach((control) => refreshDependentControl(control, form));
  }

  function refreshDependentsFor(parent) {
    const form = parent?.form || parent?.closest?.('form');
    if (!form || !parent.name) return;
    form.querySelectorAll(`[data-depends-on="${CSS.escape(parent.name)}"]`).forEach((control) => refreshDependentControl(control, form));
  }

  function csvValues(value = '') {
    return String(value || '').split(/[\n,;]+/).map(item => item.trim()).filter(Boolean);
  }

  function fieldControl(form, name) {
    const value = form?.elements?.[name];
    if (!value) return null;
    if (typeof RadioNodeList !== 'undefined' && value instanceof RadioNodeList) return value[0] || null;
    return value;
  }

  function autoSetField(form, name, value, { force = false } = {}) {
    const control = fieldControl(form, name);
    if (!control || value === undefined || value === null) return false;
    if (!force && control.dataset.smartUserEdited === 'true' && String(control.value || '').trim()) return false;
    const next = String(value);
    if (control.matches('select') && next && !Array.from(control.options).some(option => String(option.value) === next && !option.disabled)) return false;
    if (String(control.value || '') === next) return false;
    form.dataset.smartSyncing = 'true';
    control.value = next;
    control.dataset.smartManaged = 'true';
    clearFieldError(control);
    if (control.matches('select')) refreshDependentsFor(control);
    delete form.dataset.smartSyncing;
    return true;
  }

  function setFoldSelectValues(form, name, values = []) {
    const wanted = new Set([].concat(values || []).flatMap(csvValues).map(String));
    const selector = `[data-fold-select] input[name="${CSS.escape(String(name).replace(/\[\]$/, ''))}[]"]`;
    const inputs = Array.from(form?.querySelectorAll(selector) || []);
    if (!inputs.length) return;
    form.dataset.smartSyncing = 'true';
    inputs.forEach(input => { input.checked = !input.disabled && wanted.has(String(input.value)); });
    inputs.forEach(input => updateFoldSelectCount(input.closest('[data-fold-select]')));
    delete form.dataset.smartSyncing;
  }

  function visibleSelectOptions(select) {
    return Array.from(select?.options || []).filter(option => option.value && !option.disabled && !option.hidden);
  }

  function autoSelectRelated(select, preferredValue = '') {
    if (!select || select.disabled) return false;
    const visible = visibleSelectOptions(select);
    const preferred = visible.find(option => String(option.value) === String(preferredValue || ''));
    const target = preferred || (visible.length === 1 ? visible[0] : null);
    if (!target || String(select.value) === String(target.value)) return false;
    const form = select.form;
    if (form) form.dataset.smartSyncing = 'true';
    select.value = target.value;
    select.dataset.smartManaged = 'true';
    refreshDependentsFor(select);
    if (form) delete form.dataset.smartSyncing;
    return true;
  }

  function selectedMeta(select) {
    const option = select?.selectedOptions?.[0];
    if (!option) return {};
    const result = { value: option.value, label: option.textContent.trim() };
    OPTION_META_KEYS.forEach(key => {
      const value = option.getAttribute(`data-${kebabCase(key)}`);
      if (value !== null) result[key] = value;
    });
    return result;
  }

  function parseDurationMinutesBrowser(value = '') {
    if (value === '' || value == null) return 0;
    if (Number.isFinite(Number(value))) return Math.max(0, Math.round(Number(value)));
    const text = String(value).toLowerCase().trim();
    const clock = text.match(/^(\d{1,3}):([0-5]\d)$/);
    if (clock) return (Number(clock[1]) * 60) + Number(clock[2]);
    const days = text.match(/(\d+(?:\.\d+)?)\s*(?:d|day|days)\b/);
    const hours = text.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/);
    const mins = text.match(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/);
    return Math.round((days ? Number(days[1]) * 1440 : 0) + (hours ? Number(hours[1]) * 60 : 0) + (mins ? Number(mins[1]) : 0));
  }

  function localDateTimeValue(date) {
    const value = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(value.getTime())) return '';
    const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  }

  function timezoneForCountryBrowser(country = '') {
    const key = String(country).toLowerCase().replace(/[\s-]+/g, '_');
    return ({ uganda:'Africa/Kampala', kenya:'Africa/Nairobi', rwanda:'Africa/Kigali', tanzania:'Africa/Dar_es_Salaam', south_sudan:'Africa/Juba', burundi:'Africa/Bujumbura', somalia:'Africa/Mogadishu' })[key] || 'Africa/Kampala';
  }

  function layoutColumns(layoutName = '2x2') {
    const key = String(layoutName || '').toLowerCase();
    const map = { '1x1':2, '1x2':3, '2x1':3, '2x2':4, '2x3':5, '3x2':5, '3x3':6, sleeper:2, custom:4 };
    return map[key] || 4;
  }

  function rowLetter(index) {
    let value = Math.max(1, Number(index) || 1);
    let result = '';
    while (value > 0) { value -= 1; result = String.fromCharCode(65 + (value % 26)) + result; value = Math.floor(value / 26); }
    return result;
  }

  function browserGeneratedSeatLabels(form, modeOverride = '') {
    const total = Math.max(0, Number(fieldControl(form, 'totalSeats')?.value || 0));
    const layout = fieldControl(form, 'layoutName')?.value || '2x2';
    const columns = Math.max(1, Number(selectedOptionMeta(fieldControl(form, 'layoutName'), 'columns') || layoutColumns(layout)));
    const mode = modeOverride || fieldControl(form, 'seatLabelMode')?.value || 'automatic';
    const prefix = String(fieldControl(form, 'seatLabelPrefix')?.value || 'S').trim().toUpperCase();
    return Array.from({ length: total }, (_, index) => {
      if (mode === 'row_letters') return `${rowLetter(Math.floor(index / columns) + 1)}${(index % columns) + 1}`;
      if (mode === 'prefix_numeric') return `${prefix || 'S'}${index + 1}`;
      return String(index + 1);
    });
  }

  function setSmartSummary(form, text, state = '') {
    const node = form?.querySelector('[data-smart-summary-text]');
    const wrapper = form?.querySelector('[data-smart-summary]');
    if (node) node.textContent = text;
    if (wrapper) {
      wrapper.dataset.state = state;
      wrapper.classList.toggle('is-warning', state === 'warning');
      wrapper.classList.toggle('is-ready', state === 'ready');
    }
  }

  function refreshSeatSpecialOptions(form) {
    if (!form?.querySelector('[data-seat-label-editor]')) return;
    const mode = fieldControl(form, 'seatLabelMode')?.value || 'automatic';
    const explicitLabels = csvValues(fieldControl(form, 'seatLabels')?.value || '');
    const labels = ['custom', 'preserve'].includes(mode) && explicitLabels.length
      ? explicitLabels
      : browserGeneratedSeatLabels(form, mode);
    const vehicleId = fieldControl(form, 'vehicleId')?.value || '';
    ['vipSeats','accessibleSeats','crewSeats','disabledSeats','blockedSeats'].forEach((name) => {
      const details = Array.from(form.querySelectorAll('[data-fold-select]')).find(node => node.dataset.fieldName === name);
      if (!details) return;
      const panel = details.querySelector('.foldSelectPanel');
      if (!panel) return;
      const existing = new Set(Array.from(details.querySelectorAll('input[type="checkbox"]:checked')).map(input => String(input.value)));
      panel.innerHTML = labels.length
        ? labels.map(label => `<label class="foldOption" title="Seat ${escapeHtml(label)}" data-vehicle-id="${escapeHtml(vehicleId)}"><input type="checkbox" name="${escapeHtml(name)}[]" value="${escapeHtml(label)}"${existing.has(String(label)) ? ' checked' : ''}><span>Seat ${escapeHtml(label)}</span></label>`).join('')
        : '<div class="notice">Choose a valid capacity and numbering method first.</div>';
      updateFoldSelectCount(details);
      if (details.dataset.dependsOn) refreshDependentControl(details, form);
    });
  }

  function refreshSeatLabelEditor(form) {
    const editor = form?.querySelector('[data-seat-label-editor]');
    if (!editor) return;
    const mode = fieldControl(form, 'seatLabelMode')?.value || 'automatic';
    const textarea = editor.querySelector('textarea[name="seatLabels"]');
    const custom = mode === 'custom';
    editor.hidden = !custom;
    if (textarea) textarea.disabled = !custom;
    const prefix = fieldControl(form, 'seatLabelPrefix');
    const prefixField = prefix?.closest('.field');
    if (prefixField) {
      prefixField.hidden = mode !== 'prefix_numeric';
      prefix.disabled = mode !== 'prefix_numeric';
    }
    const expected = Math.max(0, Number(fieldControl(form, 'totalSeats')?.value || 0));
    const labels = custom ? csvValues(textarea?.value) : browserGeneratedSeatLabels(form, mode);
    const count = editor.querySelector('[data-seat-label-count]');
    if (count) count.textContent = custom ? `${labels.length} of ${expected} labels` : `${labels.length} labels generated automatically`;
    if (custom && textarea) {
      const valid = expected > 0 && labels.length === expected && new Set(labels.map(label => label.toUpperCase())).size === labels.length;
      editor.classList.toggle('has-error', labels.length > 0 && !valid);
    } else editor.classList.remove('has-error');
    refreshSeatSpecialOptions(form);
  }

  function syncVehicleSeatTemplateForm(form, changedName = '') {
    const vehicleSelect = fieldControl(form, 'vehicleId');
    const vehicle = selectedMeta(vehicleSelect);
    if (vehicleSelect && vehicle.value && (!changedName || changedName === 'vehicleId')) {
      autoSetField(form, 'layoutName', vehicle.layoutName || '2x2', { force:true });
      autoSetField(form, 'rows', vehicle.rows || '', { force:true });
      autoSetField(form, 'totalSeats', vehicle.totalSeats || csvValues(vehicle.seatLabels).length || '', { force:true });
      autoSetField(form, 'seatLabelMode', vehicle.seatLabels ? 'preserve' : (vehicle.seatLabelMode || 'automatic'), { force:true });
      autoSetField(form, 'seatLabelPrefix', vehicle.seatLabelPrefix || '', { force:true });
      autoSetField(form, 'seatLabels', vehicle.seatLabels || '', { force:true });
      autoSetField(form, 'defaultSeatClass', vehicle.defaultSeatClass || 'Standard', { force:true });
      autoSetField(form, 'vipPriceDelta', vehicle.vipPriceDelta || 0, { force:true });
      bindDependentFields(form);
      setFoldSelectValues(form, 'vipSeats', vehicle.vipSeats || '');
      setFoldSelectValues(form, 'accessibleSeats', vehicle.accessibleSeats || '');
      setFoldSelectValues(form, 'crewSeats', vehicle.crewSeats || '');
      setFoldSelectValues(form, 'disabledSeats', vehicle.disabledSeats || '');
      setFoldSelectValues(form, 'blockedSeats', vehicle.blockedSeats || '');
    }
    refreshSeatLabelEditor(form);
    if (vehicle.value) {
      const version = vehicle.seatMapVersion ? `seat-map v${vehicle.seatMapVersion}` : 'published seat map';
      setSmartSummary(form, `${vehicle.label}: ${vehicle.layoutName || 'layout'} · ${vehicle.totalSeats || 0} seats · ${version}. Choose “Keep current labels” unless you intentionally want to renumber the bus.`, 'ready');
    }
  }

  function syncBusServiceWizard(form) {
    const listingBranch = selectedMeta(fieldControl(form, 'listing[branchId]'));
    const origin = selectedMeta(fieldControl(form, 'route[originBranchId]'));
    const destination = selectedMeta(fieldControl(form, 'route[destinationBranchId]'));
    const driverSelect = fieldControl(form, 'schedule[driverId]');
    autoSelectRelated(driverSelect);
    const selectedDriver = selectedMeta(driverSelect);
    if (!selectedDriver.value) {
      autoSetField(form, 'listing[status]', 'draft', { force:true });
      autoSetField(form, 'schedule[status]', 'draft', { force:true });
    }
    const layout = fieldControl(form, 'vehicle[layoutName]');
    const total = fieldControl(form, 'vehicle[totalSeats]');
    const rows = fieldControl(form, 'vehicle[rows]');
    if (layout && total && rows && !rows.dataset.smartUserEdited && Number(total.value) > 0) {
      autoSetField(form, 'vehicle[rows]', Math.ceil(Number(total.value) / layoutColumns(layout.value || '2x2')), { force:true });
    }
    if (origin.value && destination.value && origin.value !== destination.value) {
      const routeName = `${origin.title || origin.label} to ${destination.title || destination.label}`;
      autoSetField(form, 'route[routeName]', routeName);
      const fareClass = fieldControl(form, 'fare[fareClass]')?.value || 'standard';
      autoSetField(form, 'fare[name]', `${routeName} ${fareClass} fare`);
      const depart = fieldControl(form, 'schedule[departAt]');
      const duration = parseDurationMinutesBrowser(fieldControl(form, 'route[estimatedDuration]')?.value || '');
      if (depart?.value) {
        const date = new Date(depart.value);
        if (!Number.isNaN(date.getTime())) {
          if (duration > 0) autoSetField(form, 'schedule[arriveAt]', localDateTimeValue(new Date(date.getTime() + duration * 60_000)));
          autoSetField(form, 'schedule[boardingStartAt]', localDateTimeValue(new Date(date.getTime() - 30 * 60_000)));
        }
      }
      setSmartSummary(form, selectedDriver.value
        ? `${routeName}: listing, bus, automatic seat map, route stops, fare and first published departure will be created as one connected service with ${selectedDriver.label}.`
        : `${routeName}: the full connected service will be saved as Draft because no saved driver record is selected yet. Create or select any driver record, then publish.`, 'ready');
    } else if (origin.value && destination.value) {
      setSmartSummary(form, 'Origin and destination must be different terminals.', 'warning');
    } else if (listingBranch.value) {
      setSmartSummary(form, `${listingBranch.label}: continue with the bus and route. Seat numbering, route segments and schedule inventory will be generated automatically.`, 'ready');
    }
  }

  function syncListingForm(form) {
    const branch = selectedMeta(fieldControl(form, 'branchId'));
    if (!branch.value) return;
    autoSetField(form, 'city', branch.city || '');
    autoSetField(form, 'country', branch.country || '');
    autoSetField(form, 'address', branch.address || '');
    setSmartSummary(form, `${branch.label}: city, country and operating address come from this verified terminal/branch. Enter the public service identity, contact and policies only.`, 'ready');
  }

  function routeCodePart(meta = {}) {
    const source = meta.terminalCode || meta.city || meta.title || meta.label || '';
    const words = String(source).replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (words.length > 1) return words.map(word => word[0]).join('').slice(0, 4).toUpperCase();
    return String(words[0] || 'LOC').slice(0, 3).toUpperCase();
  }

  function syncRouteForm(form) {
    const listing = selectedMeta(fieldControl(form, 'listingId'));
    const origin = selectedMeta(fieldControl(form, 'originBranchId'));
    const destination = selectedMeta(fieldControl(form, 'destinationBranchId'));
    if (listing.value) {
      autoSetField(form, 'baggageRules', listing.baggageRules || '');
      autoSetField(form, 'cancellationRules', listing.cancellationRules || '');
    }
    if (origin.value && destination.value) {
      if (origin.value === destination.value) {
        setSmartSummary(form, 'Origin and destination must be different terminals.', 'warning');
        return;
      }
      const originName = origin.title || origin.label;
      const destinationName = destination.title || destination.label;
      autoSetField(form, 'routeName', `${originName} to ${destinationName}`);
      autoSetField(form, 'routeCode', `${routeCodePart(origin)}-${routeCodePart(destination)}`);
      autoSetField(form, 'timezone', timezoneForCountryBrowser(origin.country || listing.country));
      setSmartSummary(form, `${originName} → ${destinationName}. Route name, code, timezone, listing policies, endpoint stops and route segments are generated from these selections.`, 'ready');
    }
  }

  function syncVehicleCreateForm(form) {
    const layout = fieldControl(form, 'layoutName');
    const total = fieldControl(form, 'totalSeats');
    const rows = fieldControl(form, 'rows');
    if (layout && total && rows && !rows.dataset.smartUserEdited && Number(total.value) > 0) autoSetField(form, 'rows', Math.ceil(Number(total.value) / layoutColumns(layout.value)), { force:true });
    refreshSeatLabelEditor(form);
    const listing = selectedMeta(fieldControl(form, 'listingId'));
    if (listing.value) setSmartSummary(form, `${listing.label}: vehicle identity and compliance are entered once. A published seat-map version will be generated automatically from the layout, capacity and numbering method.`, 'ready');
  }

  function syncScheduleDerivedTimes(form, route) {
    const depart = fieldControl(form, 'departAt');
    if (!depart?.value) return;
    const departure = new Date(depart.value);
    if (Number.isNaN(departure.getTime())) return;
    const duration = Number(route.estimatedDurationMinutes || parseDurationMinutesBrowser(route.estimatedDuration) || 0);
    if (duration > 0) autoSetField(form, 'arriveAt', localDateTimeValue(new Date(departure.getTime() + duration * 60_000)));
    autoSetField(form, 'boardingStartAt', localDateTimeValue(new Date(departure.getTime() - 30 * 60_000)));
    autoSetField(form, 'durationMinutes', duration || '');
  }

  function syncScheduleForm(form) {
    const routeSelect = fieldControl(form, 'routeId');
    const route = selectedMeta(routeSelect);
    const vehicleSelect = fieldControl(form, 'vehicleId');
    const fareSelect = fieldControl(form, 'fareProductId');
    const driverSelect = fieldControl(form, 'driverId') || fieldControl(form, 'driverIds');
    if (route.value) {
      bindDependentFields(form);
      autoSelectRelated(vehicleSelect);
      autoSelectRelated(fareSelect, route.activeFareProductId);
      autoSelectRelated(driverSelect);
      autoSetField(form, 'timezone', route.timezone || 'Africa/Kampala');
      syncScheduleDerivedTimes(form, route);
    }
    const vehicle = selectedMeta(vehicleSelect);
    const fare = selectedMeta(fareSelect);
    const driver = selectedMeta(driverSelect);
    let status = fieldControl(form, 'status')?.value || fieldControl(form, 'schedule[status]')?.value || 'published';
    const departAt = fieldControl(form, 'departAt')?.value || fieldControl(form, 'schedule[departAt]')?.value || '';
    const hasSelectableDriver = visibleSelectOptions(driverSelect).some((option) => option.value);
    if (!hasSelectableDriver && !driver.value) {
      if (fieldControl(form, 'schedule[status]')) autoSetField(form, 'schedule[status]', 'draft', { force:true });
      else if (fieldControl(form, 'status')) autoSetField(form, 'status', 'draft', { force:true });
      status = 'draft';
    }
    bindDependentFields(form);
    if (route.value && vehicle.value && fare.value && status === 'published' && !driver.value) {
      setSmartSummary(form, 'Published departures require an assigned driver selection. Any saved request, invitation, or driver record is accepted; verification and account status remain visible as warnings.', 'warning');
    } else if (route.value && vehicle.value && fare.value && status !== 'published' && !driver.value) {
      setSmartSummary(form, 'Draft departure ready: route, vehicle, fare, seat map and inventory can be saved now. Select any saved driver request, invitation, or record when you are ready to publish.', 'ready');
    } else if (route.value && vehicle.value && fare.value && status !== 'published') {
      setSmartSummary(form, 'This departure will remain a draft. The bus listing activation check accepts a future Published departure with any assigned saved driver record.', 'warning');
    } else if (route.value && vehicle.value && fare.value && driver.value && departAt) {
      const price = fare.amount !== '' && fare.amount != null ? `${fare.currency || route.currency || ''} ${fare.amount}`.trim() : `${fare.currency || route.currency || ''} fare`.trim();
      setSmartSummary(form, `${route.routeName || route.label} · ${vehicle.label} · ${vehicle.totalSeats || 0} seats · ${price} · ${driver.label}. Publishing will create the exact seat inventory and make this departure eligible for bus activation.`, 'ready');
    } else if (route.value) {
      setSmartSummary(form, 'This route needs an active vehicle with a published seat map, an active fare plan, an assigned saved driver request/invitation/record, and a future departure time.', 'warning');
    }
  }

  function syncFareForm(form) {
    const route = selectedMeta(fieldControl(form, 'routeId'));
    const fareClass = fieldControl(form, 'fareClass')?.value || 'standard';
    if (route.value) {
      autoSetField(form, 'currency', route.currency || backendDashboardData.company?.defaultCurrency || platformDefaultCurrency, { force:true });
      autoSetField(form, 'name', `${route.routeName || route.label} ${fareClass} fare`);
      setSmartSummary(form, `${route.routeName || route.label}: currency and route endpoints come from the route/listing. Enter the commercial amount and policy choices only.`, 'ready');
    }
  }

  function syncSegmentFareForm(form) {
    const fare = selectedMeta(fieldControl(form, 'fareProductId'));
    const from = fieldControl(form, 'fromStopId');
    const to = fieldControl(form, 'toStopId');
    if (fare.value) {
      bindDependentFields(form);
      const fromOptions = visibleSelectOptions(from).sort((a, b) => Number(a.dataset.stopOrder || 0) - Number(b.dataset.stopOrder || 0));
      const toOptions = visibleSelectOptions(to).sort((a, b) => Number(a.dataset.stopOrder || 0) - Number(b.dataset.stopOrder || 0));
      if (!from.value && fromOptions[0]) autoSetField(form, 'fromStopId', fromOptions[0].value, { force:true });
      if (!to.value && toOptions.length) autoSetField(form, 'toStopId', toOptions[toOptions.length - 1].value, { force:true });
      const fromOrder = Number(selectedOptionMeta(from, 'stopOrder') || 0);
      Array.from(to?.options || []).forEach(option => {
        if (!option.value) return;
        const routeMatch = String(option.dataset.routeId || '') === String(fare.routeId || '');
        const afterOrigin = Number(option.dataset.stopOrder || 0) > fromOrder;
        option.hidden = !routeMatch || !afterOrigin;
        option.disabled = !routeMatch || !afterOrigin;
      });
      if (to?.selectedOptions?.[0]?.disabled) to.value = '';
      setSmartSummary(form, `${fare.label}: only ordered stops from this fare’s route are selectable, and the destination must come after the boarding stop.`, 'ready');
    }
  }

  function syncRouteStopForm(form) {
    const type = fieldControl(form, 'stopType')?.value || 'intermediate';
    const pickup = ['boarding', 'pickup', 'intermediate'].includes(type);
    const dropoff = ['dropoff', 'intermediate'].includes(type);
    autoSetField(form, 'pickupAllowed', String(pickup), { force:true });
    autoSetField(form, 'dropoffAllowed', String(dropoff), { force:true });
    const branch = selectedMeta(fieldControl(form, 'branchId'));
    if (branch.value) setSmartSummary(form, `${branch.label}: name, city and address come from the selected terminal. The system inserts it before the destination and rebuilds route segments automatically.`, 'ready');
  }

  const addonTemplateDefaults = Object.freeze({
    extra_luggage: { name:'Extra luggage', description:'Adds one extra checked-luggage allowance for each selected traveler.', category:'baggage', chargeBasis:'per_passenger', availableFor:'all' },
    priority_boarding: { name:'Priority boarding', description:'Board before general boarding and settle into your seat earlier.', category:'boarding', chargeBasis:'per_passenger', availableFor:'all' },
    sms_whatsapp_ticket: { name:'SMS and WhatsApp ticket', description:'Receive the ticket and journey updates by both SMS and WhatsApp.', category:'communication', chargeBasis:'per_booking', availableFor:'all' },
    travel_insurance: { name:'Travel insurance', description:'Optional trip protection for each traveler, subject to the partner policy.', category:'insurance', chargeBasis:'per_passenger', availableFor:'all' },
    meal_pack: { name:'Meal pack', description:'A meal or refreshment pack provided on each selected trip leg.', category:'meal', chargeBasis:'per_passenger_per_leg', availableFor:'all' },
    lounge_access: { name:'Terminal lounge access', description:'Access the partner lounge before departure.', category:'comfort', chargeBasis:'per_passenger_per_leg', availableFor:'all' },
    flexible_change: { name:'Flexible ticket change', description:'Adds a more flexible change option for this booking, subject to availability.', category:'flexibility', chargeBasis:'per_booking', availableFor:'all' },
    premium_wifi: { name:'Premium Wi-Fi', description:'Higher-priority onboard internet access for each traveler and trip leg.', category:'comfort', chargeBasis:'per_passenger_per_leg', availableFor:'all' },
    breakfast: { name:'Breakfast', description:'Breakfast for each selected guest on every night of the stay.', category:'meal', chargeBasis:'per_passenger_per_leg', availableFor:'all' },
    airport_transfer: { name:'Airport transfer', description:'One airport pickup or drop-off arranged for this hotel booking.', category:'comfort', chargeBasis:'per_booking', availableFor:'all' },
    parking: { name:'Secure parking', description:'Secure parking charged for each reserved room-night.', category:'comfort', chargeBasis:'per_trip_leg', availableFor:'all' },
    late_checkout: { name:'Late checkout', description:'A later checkout time for the booking, subject to hotel confirmation.', category:'flexibility', chargeBasis:'per_booking', availableFor:'all' },
    extra_bed: { name:'Extra bed', description:'An extra bed for each selected guest-night, subject to room capacity.', category:'comfort', chargeBasis:'per_passenger_per_leg', availableFor:'all' },
    spa_access: { name:'Spa access', description:'Spa access for each selected guest during the stay.', category:'comfort', chargeBasis:'per_passenger', availableFor:'all' },
    meal_plan: { name:'Meal plan', description:'A hotel meal plan for each selected guest-night.', category:'meal', chargeBasis:'per_passenger_per_leg', availableFor:'all' },
    room_upgrade_request: { name:'Room upgrade request', description:'Request an upgraded room category, subject to availability and confirmation.', category:'comfort', chargeBasis:'per_booking', availableFor:'all' },
  });

  function syncAddonForm(form, changedName = '') {
    if (!['template','listingId'].includes(changedName)) return;
    const key = fieldControl(form, 'template')?.value || '';
    const template = addonTemplateDefaults[key];
    const listing = selectedMeta(fieldControl(form, 'listingId'));
    const listingCurrency = String(listing.currency || '').toUpperCase();
    if (!template) {
      if (changedName === 'template') {
        autoSetField(form, 'name', '', { force:true });
        autoSetField(form, 'description', '', { force:true });
        autoSetField(form, 'category', 'other', { force:true });
        autoSetField(form, 'price', '', { force:true });
        autoSetField(form, 'chargeBasis', 'per_booking', { force:true });
        autoSetField(form, 'availableFor', 'all', { force:true });
      }
      setSmartSummary(form, 'Custom add-on selected. Enter exactly what the traveler receives and how the unit price should be multiplied.', 'ready');
      return;
    }
    if (changedName === 'template') {
      Object.entries(template).forEach(([name, value]) => autoSetField(form, name, value, { force:true }));
      autoSetField(form, 'price', '', { force:true });
    }
    setSmartSummary(form, `${template.name}: enter the unit price yourself in ${listingCurrency || 'the selected listing currency'}. Templates never choose or copy a price.`, 'ready');
  }

  function syncBookingForm(form) {
    const scheduleSelect = fieldControl(form, 'scheduleId');
    const seatSelect = fieldControl(form, 'selected') || fieldControl(form, 'seatNumber');
    bindDependentFields(form);
    autoSelectRelated(scheduleSelect);
    if (scheduleSelect?.value) {
      refreshDependentsFor(scheduleSelect);
      autoSelectRelated(seatSelect);
      const schedule = selectedMeta(scheduleSelect);
      setSmartSummary(form, `${schedule.label}: route, vehicle, fare, currency and availability are taken from this live departure. Only customer and passenger details are entered manually.`, 'ready');
    }
  }

  function syncSmartBusForm(form, changedName = '') {
    if (!form || form.dataset.smartSyncing === 'true') return;
    const type = String(form.dataset.formType || '').toLowerCase();
    if (type === 'bus service') syncBusServiceWizard(form);
    else if (type === 'vehicle seat template') syncVehicleSeatTemplateForm(form, changedName);
    else if (type === 'listing') syncListingForm(form);
    else if (type === 'route') syncRouteForm(form);
    else if (type === 'vehicle') syncVehicleCreateForm(form);
    else if (type === 'schedule' || type === 'schedule rule') syncScheduleForm(form);
    else if (type === 'fare product') syncFareForm(form);
    else if (type === 'segment fare') syncSegmentFareForm(form);
    else if (type === 'add-on' || type === 'service_addon') syncAddonForm(form, changedName);
    else if (type === 'route stop' || type === 'routestop' || type === 'route_stop') syncRouteStopForm(form);
    else if (type === 'booking' || type === 'seat status' || type === 'inventory') syncBookingForm(form);
  }

  function adminFormConfig(type, label = '', detail = {}, mode = 'create') {
    const key = String(type || '').toLowerCase();
    const currentRole = shell.currentRole || 'admin';
    const isCompanyRole = currentRole === 'company';
    const isEmployeeRole = currentRole === 'employee';
    const serviceListingTypes = ['bus','hotel'];
    const requestedServiceListing = serviceListingTypes.find(serviceType => key === `${serviceType} listing` || key === `${serviceType.replace('_', '-')} listing`);
    const requestedServiceLabel = requestedServiceListing ? requestedServiceListing.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '';
    const companyServiceType = String(companyServiceProfile.primaryServiceType || 'partner').replace('-', '_');
    const serviceLabel = companyServiceProfile.primaryLabel || 'Service';
    const dayOptions = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    const busAmenityOptions = ['AC','WiFi','USB charging','Reclining seats','Toilet','TV','Water','Extra luggage','Executive class'];
    const hotelAmenityOptions = ['WiFi','Breakfast','Parking','Airport shuttle','Pool','Gym','Restaurant','Air conditioning','Room service','Conference room'];
    const listingStatusOptions = ['draft','active','paused','archived'];
    const scheduleStatusOptions = ['draft','active','published','boarding','departed','arrived','completed','delayed','cancelled','archived'];
    const listingSource = companyServiceType === 'hotel' ? (data.options?.hotelListings || data.options?.listings || data.listings) : companyServiceType === 'bus' ? (data.options?.busListings || data.options?.listings || data.listings) : (data.options?.listings || data.listings);
    const listings = optionFromRows(listingSource, 'Create a listing first');
    const routes = optionFromRows(data.options?.routes || data.routes, 'Create a route first');
    const vehicles = optionFromRows(data.options?.vehicles || data.vehicles, 'Create a vehicle first');
    const fareProducts = optionFromRows(data.options?.fareProducts || data.fareProducts, 'Create an active fare plan first');
    const routeStops = optionFromRows(data.options?.routeStops || data.routeStops, 'Create route stops first');
    const vehicleSeatOptions = optionFromRows(data.options?.vehicleSeats || [], 'Select a vehicle with a published seat map first');
    const vehicleRecords = Array.isArray(data.vehicles) ? data.vehicles : [];
    const schedules = optionFromRows(data.options?.schedules || data.schedules, 'Create a schedule first');
    const branches = optionFromRows(data.options?.branches || data.branches, 'Create a branch / terminal / property desk first');
    const policies = optionFromRows(data.policies, 'Create a policy first');
    const hotelProperties = optionFromRows(data.options?.hotelProperties || data.hotelProperties, 'Create a hotel property first');
    const roomTypes = optionFromRows(data.options?.roomTypes || data.roomTypes, 'Create a room type first');
    const ratePlans = optionFromRows(data.options?.ratePlans || data.ratePlans, 'Create a rate plan first');
    const roomUnits = optionFromRows(data.options?.roomUnits || data.roomUnits, 'Create room units first');
    const roomNights = optionFromRows(data.options?.roomNights || data.roomNightInventory, 'Create room-night inventory first');
    const serviceAddonOptions = (data.options?.serviceAddons || data.serviceAddons || [])
      .filter(addon => currentRole === 'promoter' || !addon?.serviceType || String(addon.serviceType).replace('-', '_') === companyServiceType)
      .map(addon => ({
        value: addon.id,
        label: `${addon.name || addon.title || 'Optional extra'}${addon.price !== undefined ? ` · ${addon.currency || ''} ${Number(addon.price || 0).toLocaleString()}` : ''}`.trim(),
        listingId: addon.listingId || '',
        serviceType: addon.serviceType || companyServiceType,
        chargeBasis: addon.chargeBasis || 'per_booking',
      }))
      .filter(addon => addon.value);
    const projectedSeats = optionFromRows(data.options?.seats || [], 'Create a schedule and seat map first');
    const rooms = optionFromRows(data.options?.rooms || data.rooms, 'Create a room type first');
    const drivers = optionFromRows(data.options?.drivers || data.drivers, 'Create or save a driver request first');
    const driverEligibility = Array.isArray(data.options?.driverEligibility) ? data.options.driverEligibility : [];
    const pendingDriverRequests = Array.isArray(data.options?.pendingDriverRequests) ? data.options.pendingDriverRequests : [];
    const pendingStaffInvitations = Array.isArray(data.options?.pendingStaffInvitations) ? data.options.pendingStaffInvitations : [];
    const hasAssignableDriver = drivers.some(option => option && option.value);
    const hasActiveDriver = hasAssignableDriver;
    const firstBlockedDriver = driverEligibility.find((row) => row && row.eligible === false && Array.isArray(row.reasons) && row.reasons.length);
    const driverWorkflowHint = hasAssignableDriver
      ? 'Only active driver accounts with accepted membership, verified identity and phone, approved licence, safety clearance, and all required operational permissions can be assigned.'
      : firstBlockedDriver
        ? `${firstBlockedDriver.label || 'The driver'} cannot be assigned: ${firstBlockedDriver.reasons.join('; ')}.`
        : pendingDriverRequests.length
          ? `${pendingDriverRequests.length} driver request${pendingDriverRequests.length === 1 ? '' : 's'} still need invitation acceptance, verification, safety clearance and activation before assignment.`
          : 'Create and fully approve a driver before publishing a departure.';
    const staff = optionFromRows(data.options?.staff || data.staff, pendingStaffInvitations.length ? 'Staff invitations are awaiting acceptance' : 'Activate staff first');
    const seatMapOptions = Array.isArray(data.seatMaps) ? data.seatMaps.flatMap(map => (map.seats || []).map(seat => ({ value: seat.seatNumber || seat.id, scheduleId: map.scheduleId || seat.scheduleId || '', listingId: map.listingId || '', label: `${map.routeLabel || map.scheduleId} - Seat No ${String(seat.seatNumber || seat.id || '').replace(/^seat\s*(no\.?|number)?\s*/i, '').replace(/^[A-Za-z](\d+)$/, '$1')} (${seat.status || 'available'})` }))) : [];
    const inventorySeatOptions = (Array.isArray(data.inventory) ? data.inventory : []).map(row => {
      const meta = rowMeta(row);
      const cells = rowCells(row);
      const inventory = meta?.detail?.inventory || meta?.detail?.seat || {};
      const scheduleId = inventory.scheduleId || cells[0] || '';
      const seatNumber = inventory.seatNumber || cells[1] || meta?.label || '';
      if (!seatNumber) return null;
      return { value: seatNumber, scheduleId, listingId: inventory.listingId || '', label: `${scheduleId || 'Inventory'} - Seat No ${String(seatNumber).replace(/^seat\s*(no\.?|number)?\s*/i, '')} (${inventory.status || cells[6] || 'available'})` };
    }).filter(Boolean);
    const seatOptions = (projectedSeats.length && projectedSeats[0]?.value ? projectedSeats : (seatMapOptions.length ? seatMapOptions : inventorySeatOptions)).slice(0, 200);
    const companies = optionFromRows(data.partners, 'Select partner');
    const bookings = (data.bookings || []).map(row => rowCells(row)[0]).filter(Boolean);
    const bookingOptions = bookings.length ? bookings : [''];
    const payments = optionFromRows(data.payments, 'Select transaction');
    const customers = optionFromRows(data.customers, 'Select customer');
    const promoters = optionFromRows(data.promoters, 'Select promoter');
    const employeeProfile = data.profile || {};
    const recordId = detail?.id || detail?.listing?.id || detail?.listing?.listingId || detail?.route?.id || detail?.vehicle?.id || detail?.schedule?.id || detail?.routeStop?.id || detail?.room?.id || detail?.property?.id || detail?.roomType?.id || detail?.ratePlan?.id || detail?.roomUnit?.id || detail?.roomNight?.id || '';
    const recordLabel = label || detail?.label || recordId || 'selected record';


    const record = detail?.listing || detail?.route || detail?.routeStop || detail?.vehicle || detail?.schedule || detail?.room || detail?.property || detail?.roomType || detail?.roomUnit || detail?.roomNight || detail || {};
    const fieldValue = (...keys) => {
      for (const key of keys) {
        const value = key.split('.').reduce((obj, part) => (obj && typeof obj === 'object') ? obj[part] : undefined, detail);
        if (value !== undefined && value !== null && value !== '') return Array.isArray(value) ? value.join(', ') : value;
      }
      for (const key of keys) {
        const value = record?.[key];
        if (value !== undefined && value !== null && value !== '') return Array.isArray(value) ? value.join(', ') : value;
      }
      return '';
    };
    const editActionFor = (entityKey) => {
      const safeId = encodeURIComponent(recordId || '');
      if (!safeId) return '';
      if (entityKey === 'listing') return `/company/listings/${safeId}`;
      if (entityKey === 'route') return `/company/routes/${safeId}`;
      if (entityKey === 'routestop' || entityKey === 'route_stop') return `/company/route-stops/${safeId}`;
      if (entityKey === 'vehicle') return `/company/vehicles/${safeId}`;
      if (entityKey === 'schedule') return `/company/schedules/${safeId}`;
      if (entityKey === 'room') return `/company/hotels/room-types/${safeId}/inventory`;
      if (entityKey === 'hotel_property') return `/company/hotels/properties/${safeId}`;
      if (entityKey === 'room_type') return `/company/hotels/room-types/${safeId}`;
      if (entityKey === 'rate_plan') return `/company/hotels/rate-plans/${safeId}`;
      if (entityKey === 'room_unit') return `/company/hotels/room-units/${safeId}`;
      if (entityKey === 'room_night') return `/company/hotels/inventory/${safeId}/status`;
      return '';
    };

    if (isEmployeeRole && key === 'booking') {
      if (companyServiceType === 'hotel') return {
        action: '/employee/bookings', submit: 'Create hotel booking',
        fields: [
          { name:'listingId', label:'Hotel listing', type:'select', icon:'fa-hotel', options:listings, required:true, value: fieldValue('booking.listingId','listing.id','listingId'), help:'A listing is the public hotel service customers see.' },
          { name:'roomTypeId', label:'Room type', type:'select', icon:'fa-bed', options:roomTypes, required:true, dependsOn:'listingId', filterKey:'listingId', value: fieldValue('booking.roomTypeId','roomType.id','roomTypeId'), help:'Only room types belonging to the selected hotel listing are shown.' },
          { name:'ratePlanId', label:'Rate plan', type:'select', icon:'fa-tags', options:ratePlans, dependsOn:'roomTypeId', filterKey:'roomTypeId', value: fieldValue('booking.hotelStay.ratePlanId','ratePlanId'), help:'Cancellation, meal, occupancy, and stay rules are frozen from this rate plan.' },
          { name:'roomUnitIds', label:'Preferred room units', type:'multiselect', icon:'fa-door-open', options:roomUnits, dependsOn:'roomTypeId', filterKey:'roomTypeId', value: fieldValue('booking.hotelStay.roomUnitIds','roomUnitIds'), help:'Optional. Leave empty for automatic assignment from available room nights.' },
          { name:'addons', label:'Hotel extras', type:'multiselect', icon:'fa-circle-plus', options:serviceAddonOptions, dependsOn:'listingId', filterKey:'listingId', value: fieldValue('booking.addons','addons'), help:'Only active extras created for this hotel listing are shown. Prices are recalculated by the server.' },
          { name:'checkInDate', label:'Check-in date', type:'date', icon:'fa-calendar-days', required:true, value: fieldValue('booking.hotelStay.checkIn','checkInDate') },
          { name:'checkOutDate', label:'Check-out date', type:'date', icon:'fa-calendar-check', required:true, value: fieldValue('booking.hotelStay.checkOut','checkOutDate') },
          { name:'roomCount', label:'Rooms required', type:'number', icon:'fa-door-open', required:true, value: fieldValue('booking.hotelStay.roomCount','roomCount') || '1' },
          { name:'adults', label:'Adults', type:'number', icon:'fa-user-group', required:true, value: fieldValue('booking.hotelStay.adults','adults') || '1' },
          { name:'children', label:'Children', type:'number', icon:'fa-child', value: fieldValue('booking.hotelStay.children','children') || '0' },
          { name:'infants', label:'Infants', type:'number', icon:'fa-baby', value: fieldValue('booking.hotelStay.infants','infants') || '0' },
          { name:'fullName', label:'Lead guest name', icon:'fa-user', required:true, placeholder:'Jane Guest', value: fieldValue('booking.guestSnapshot.fullName','guestSnapshot.fullName','customer.name') },
          { name:'email', label:'Guest email', type:'email', icon:'fa-envelope', required:true, placeholder:'Enter email address', value: fieldValue('booking.guestSnapshot.email','guestSnapshot.email','customer.email') },
          { name:'phone', label:'Guest phone', icon:'fa-phone', required:true, placeholder:'Enter phone number', value: fieldValue('booking.guestSnapshot.phone','guestSnapshot.phone','customer.phone') },
          { name:'identityType', label:'ID type', type:'select', icon:'fa-id-card', options:['national_id','passport','student_id','birth_certificate'] },
          { name:'identityNumber', label:'ID / passport number', icon:'fa-id-card-clip' },
          { name:'nationality', label:'Nationality', icon:'fa-earth-africa' },
          { name:'dateOfBirth', label:'Date of birth', type:'date', icon:'fa-cake-candles' },
          { name:'emergencyContactName', label:'Emergency contact name', icon:'fa-user-shield' },
          { name:'emergencyContactPhone', label:'Emergency contact phone', icon:'fa-phone-volume' },
          { name:'estimatedArrivalTime', label:'Estimated arrival', type:'time', icon:'fa-clock' },
          { name:'additionalGuestNames', label:'Other guest names', type:'textarea', full:true, placeholder:'One guest name per line. Include every traveler so the hotel manifest is complete.' },
          { name:'specialRequests', label:'Stay notes', type:'textarea', full:true, placeholder:'Accessibility, bedding, airport pickup, meals, or other request...' }
        ]
      };
      return {
        action: '/employee/bookings', submit: 'Create bus booking',
        fields: [
          { type:'smart-summary', label:'Smart counter booking', help:'Service, departure and available seat choices stay linked to live bus records; staff enter passenger details only.' },
          { name:'listingId', label:'Bus listing', type:'select', icon:'fa-layer-group', options:listings, required:true, value: fieldValue('booking.listingId','listing.id','listingId'), help:'Choose the public service first.' },
          { name:'scheduleId', label:'Departure schedule', type:'select', icon:'fa-calendar-days', options:schedules, required:true, dependsOn:'listingId', filterKey:'listingId', value: fieldValue('booking.scheduleId','schedule.id','scheduleId'), help:'Only departures created under the selected listing are shown.' },
          { name:'selected', label:'Seat No', type:'select', icon:'fa-chair', options:seatOptions, required:true, dependsOn:'scheduleId', filterKey:'scheduleId', value: fieldValue('booking.selected','ticket.seatNumber','seat.seatNumber','selected'), help:'Only seats from the selected departure are shown.' },
          { name:'fullName', label:'Passenger name', icon:'fa-user', required:true, placeholder:'Jane Passenger', value: fieldValue('booking.guestSnapshot.fullName','guestSnapshot.fullName','customer.name') },
          { name:'email', label:'Email', type:'email', icon:'fa-envelope', placeholder:'customer@example.com', value: fieldValue('booking.guestSnapshot.email','guestSnapshot.email','customer.email') },
          { name:'phone', label:'Phone', icon:'fa-phone', required:true, placeholder:'Enter phone number', value: fieldValue('booking.guestSnapshot.phone','guestSnapshot.phone','customer.phone') },
          { name:'addons', label:'Add-ons / notes', icon:'fa-plus', placeholder:'luggage, meal, accessibility note' }
        ]
      };
    }
    if (isEmployeeRole && (key === 'inventory' || key === 'seat status' || key === 'seat map')) return {
      action: '/employee/inventory', submit: 'Update inventory',
      fields: companyServiceType === 'hotel' ? [
        { name:'roomTypeId', label:'Room type', type:'select', icon:'fa-bed', options:roomTypes, required:true, value: fieldValue('inventory.roomTypeId','roomType.id','roomTypeId'), help:'Choose the room category first.' },
        { name:'roomUnitId', label:'Room unit / number', type:'select', icon:'fa-door-open', options:roomUnits, required:true, dependsOn:'roomTypeId', filterKey:'roomTypeId', value: fieldValue('inventory.roomUnitId','roomUnit.id','roomUnitId'), help:'Only physical rooms under the selected room type are shown.' },
        { name:'inventoryId', label:'Specific night (optional)', type:'select', icon:'fa-calendar-day', options:roomNights, dependsOn:'roomUnitId', filterKey:'roomUnitId', help:'Select a night only when updating date-specific availability. Leave empty to update the physical room/housekeeping state.' },
        { name:'status', label:'Room / night status', type:'select', icon:'fa-circle-check', options:['available','open','maintenance','cleaning','cancelled'], required:true, value: fieldValue('inventory.status','roomUnit.status','roomNight.status','status') || 'available' },
        { name:'housekeepingStatus', label:'Housekeeping state', type:'select', icon:'fa-broom', options:['clean','dirty','cleaning','inspected','maintenance','occupied','ready'], value: fieldValue('roomUnit.housekeepingStatus','housekeepingStatus') || 'clean' },
        { name:'notes', label:'Reason / note', type:'textarea', full:true, placeholder:'Why this room or room-night status is changing' }
      ] : [
        { name:'scheduleId', label:'Schedule', type:'select', icon:'fa-calendar-days', options:schedules, required:true, value: fieldValue('inventory.scheduleId','seat.scheduleId','seatMap.scheduleId','schedule.id') },
        { name:'seatNumber', label:'Seat No', type:'select', icon:'fa-chair', options:seatOptions, required:true, dependsOn:'scheduleId', filterKey:'scheduleId', value: fieldValue('inventory.seatNumber','seat.seatNumber','selected'), help:'Only seats generated for the selected departure are shown. Create and select a schedule first.' },
        { name:'status', label:'Status', type:'select', icon:'fa-circle-check', options:['available','blocked','maintenance','reserved','disabled'], required:true, value: fieldValue('inventory.status','seat.status','status') || 'blocked' },
        { name:'priceDelta', label:'Price delta', type:'number', icon:'fa-coins', value: fieldValue('inventory.price','seat.priceDelta','priceDelta') },
        { name:'note', label:'Reason / note', type:'textarea', full:true, placeholder:'Reason for blocked or maintenance seat' }
      ]
    };
    if (isEmployeeRole && (key === 'support notice' || key === 'notice' || key === 'support task')) return {
      action: '/employee/support/notice', submit: 'Create support notice',
      fields: [
        { name:'bookingRef', label:'Booking', type:'select', icon:'fa-ticket', options:bookingOptions, value: fieldValue('booking.bookingRef','seat.bookingRef','bookingRef') },
        { name:'priority', label:'Priority', type:'select', icon:'fa-flag', options:['normal','high','urgent'], value: fieldValue('case.priority','priority') || 'normal' },
        { name:'subject', label:'Subject', icon:'fa-heading', placeholder:'Customer notice', value: fieldValue('case.subject','subject') },
        { name:'message', label:'Message', type:'textarea', full:true, required:true, placeholder:'Write notice message...', value: fieldValue('case.message','message','note') }
      ]
    };
    if ((isEmployeeRole || isCompanyRole) && key === 'payment') return {
      action: isCompanyRole ? '/company/payments' : '/employee/payments', submit: 'Record payment',
      fields: [
        { name:'bookingRef', label:'Booking', type:'select', icon:'fa-ticket', options:bookingOptions, required:true, value: fieldValue('booking.bookingRef','payment.bookingRef','bookingRef') },
        { name:'method', label:'Method', type:'select', icon:'fa-money-bill', options:['cash','mobile_money','card','bank_transfer','voucher'], value: fieldValue('payment.provider','method') || 'cash' },
        { name:'amount', label:'Amount', type:'number', icon:'fa-coins', required:true, value: fieldValue('payment.amount','booking.pricing.total','pricing.total','amount') },
        { name:'currency', label:'Currency', icon:'fa-money-bill', value: fieldValue('payment.currency','booking.pricing.currency','currency') || backendDashboardData.company?.defaultCurrency || platformDefaultCurrency, readonly:true, help:'Inherited from the booking or company operating currency.' },
        { name:'status', label:'Status', type:'select', icon:'fa-circle-check', options:['successful','paid','pending','failed'], value: fieldValue('payment.status','paymentStatus','status') || 'successful' }
      ]
    };
    if (isEmployeeRole && key === 'refund') return {
      action: '/employee/refunds', submit: 'Request refund',
      fields: [
        { name:'bookingRef', label:'Booking', type:'select', icon:'fa-ticket', options:bookingOptions, required:true, value: fieldValue('booking.bookingRef','refund.bookingRef','bookingRef') },
        { name:'amount', label:'Amount', type:'number', icon:'fa-coins', value: fieldValue('refund.amount','booking.pricing.total','pricing.total','amount') },
        { name:'reason', label:'Reason', type:'textarea', full:true, required:true, placeholder:'Refund reason', value: fieldValue('refund.reason','reason') }
      ]
    };
    if (isEmployeeRole && key === 'handover') return {
      action: '/employee/handovers', submit: 'Create handover',
      fields: [
        { name:'shift', label:'Shift', icon:'fa-clock', value: fieldValue('handover.shift','shift') || employeeProfile.shift || 'Current shift' },
        { name:'nextStaff', label:'Next staff', icon:'fa-user-group', value: fieldValue('handover.nextStaff','nextStaff') },
        { name:'note', label:'Handover note', type:'textarea', full:true, required:true, placeholder:'Cash, bookings, check-ins, issues, and follow-ups', value: fieldValue('handover.note','note') }
      ]
    };
    if (isEmployeeRole && key === 'profile') return {
      action: '/employee/profile', submit: 'Save profile',
      fields: [
        { name:'fullName', label:'Full name', icon:'fa-user', required:true, value: fieldValue('profile.fullName','fullName') || employeeProfile.fullName || shell.profileName || '' },
        { name:'email', label:'Email', type:'email', icon:'fa-envelope', value: fieldValue('profile.email','email') || employeeProfile.email || '' },
        { name:'phone', label:'Phone', icon:'fa-phone', value: fieldValue('profile.phone','phone') || employeeProfile.phone || '' },
        { name:'shift', label:'Shift', icon:'fa-clock', value: fieldValue('profile.shift','shift') || employeeProfile.shift || '' },
        { name:'notes', label:'Notes', type:'textarea', full:true, value: fieldValue('profile.notes','notes') || employeeProfile.notes || '' }
      ]
    };
    if (isEmployeeRole && (key === 'schedule' || key === 'delay notice')) return {
      action: '/employee/schedules/delay', submit: 'Send delay notice',
      fields: [
        { name:'scheduleId', label:'Schedule', type:'select', icon:'fa-calendar-days', options:schedules, required:true, value: fieldValue('schedule.id','scheduleId') },
        { name:'priority', label:'Priority', type:'select', icon:'fa-flag', options:['normal','high','urgent'], value:'high' },
        { name:'message', label:'Message', type:'textarea', full:true, required:true, placeholder:'Departure delayed by 20 minutes' }
      ]
    };

    if (isCompanyRole && mode === 'edit' && key === 'listing') return {
      action: editActionFor('listing'), submit: 'Save listing changes',
      fields: [
        ...(companyServiceType === 'bus' ? [{ type:'smart-summary', label:'Smart bus listing', help:'Select the operating terminal and its verified location details are reused automatically.' }] : []),
        { name:'serviceType', type:'hidden', value: companyServiceType },
        { name:'title', label:`${serviceLabel} listing title`, icon:'fa-pen', required:true, value: fieldValue('listing.title','title') },
        { name:'branchId', label:'Primary branch / terminal / property desk', type:'select', icon:'fa-building', options:branches, value: fieldValue('listing.branchId','branchId'), help:'This connects the public listing to the operating location.' },
        ...(companyServiceType === 'bus' ? [
          { name:'shortDescription', label:'Short public description', icon:'fa-align-left', required:true, value: fieldValue('listing.shortDescription','listing.sub','shortDescription') },
          { name:'operatorLicenceRef', label:'Operator licence / permit ref', icon:'fa-id-card', value: fieldValue('listing.operatorLicenceRef','operatorLicenceRef') },
          { name:'contactPhone', label:'Booking support phone', icon:'fa-phone', value: fieldValue('listing.contactPhone','contactPhone') },
          { name:'salesChannels', label:'Sales channels', type:'multiselect', icon:'fa-cart-shopping', options:['web','mobile','agent','counter'], value: fieldValue('listing.salesChannels','salesChannels') },
          { name:'imageFile', label:'Add service image', type:'file', icon:'fa-image' }
        ] : []),
        ...(companyServiceType === 'hotel' ? [{ name:'city', label:'City', icon:'fa-location-dot', value: fieldValue('listing.city','service.city','city') }] : []),
        ...(companyServiceType === 'hotel' ? [
          { name:'from', label:'Location / area', icon:'fa-location-dot', value: fieldValue('listing.from','service.from','from') },
          { name:'to', label:'Nearby landmark', icon:'fa-location-dot', value: fieldValue('listing.to','service.to','to') }
        ] : []),
        ...(companyServiceType === 'bus' ? [
          { name:'baggageRules', label:'Baggage rules', type:'textarea', full:true, value: fieldValue('listing.baggageRules','baggageRules') },
          { name:'cancellationRules', label:'Cancellation / refund rules', type:'textarea', full:true, value: fieldValue('listing.cancellationRules','cancellationRules') }
        ] : [{ name:'priceFrom', label:'Price from', type:'number', icon:'fa-coins', value: fieldValue('listing.priceFrom','inventory.basePrice','priceFrom') }]),
        { name:'status', label:'Status', type:'select', icon:'fa-circle-check', options:['draft','active','paused','archived'], value: fieldValue('listing.status','status') || 'draft', help: companyServiceType === 'bus' ? 'Active is allowed only after the profile, route, compliant vehicle, published seat map, active fare, active verified and safety-cleared driver, live inventory and at least one future published dated departure are complete.' : '' },
        { name:'description', label:'Description', type:'textarea', full:true, value: fieldValue('listing.description','listing.sub','description') }
      ]
    };
    if (isCompanyRole && mode === 'edit' && key === 'route') return {
      action: editActionFor('route'), submit: 'Save route changes',
      fields: [
        { type:'smart-summary', label:'Smart route update', help:'Changing endpoint terminals refreshes the generated route identity, endpoint stops and route segments while preserving linked operational records safely.' },
        { name:'listingId', type:'hidden', value: fieldValue('route.listingId','listing.listing.listingId','listingId') },
        { name:'routeName', label:'Route name', icon:'fa-route', value: fieldValue('route.routeName','routeName') },
        { name:'routeCode', label:'Route code', icon:'fa-hashtag', value: fieldValue('route.routeCode','routeCode') },
        { name:'timezone', label:'Route timezone', type:'select', icon:'fa-clock', options:['Africa/Kampala','Africa/Nairobi','Africa/Kigali','Africa/Dar_es_Salaam','Africa/Juba','Africa/Bujumbura','Africa/Mogadishu'], value: fieldValue('route.timezone','timezone') || 'Africa/Kampala' },
        { name:'originBranchId', label:'Origin terminal / branch', type:'select', icon:'fa-location-dot', options:branches, required:true, value: fieldValue('route.originBranchId','route.originTerminalId','originBranchId','originTerminalId'), help:'Select the existing operating location. The public origin name is derived from it.' },
        { name:'destinationBranchId', label:'Destination terminal / branch', type:'select', icon:'fa-location-dot', options:branches, required:true, value: fieldValue('route.destinationBranchId','route.destinationTerminalId','destinationBranchId','destinationTerminalId'), help:'Select a different destination location.' },
        { name:'distanceKm', label:'Distance KM', type:'number', icon:'fa-road', value: fieldValue('route.distanceKm','distanceKm') },
        { name:'estimatedDuration', label:'Estimated duration', icon:'fa-clock', value: fieldValue('route.estimatedDuration','estimatedDuration') },
        { name:'operatingDays', label:'Operating days', type:'multiselect', icon:'fa-calendar-week', options:dayOptions, value: fieldValue('route.operatingDays','operatingDays'), help:'Pick every day this route can run.' },
        { name:'status', label:'Status', type:'select', icon:'fa-circle-check', options:['active','archived'], value: fieldValue('route.status','status') || 'active' },
        { name:'baggageRules', label:'Baggage rules', type:'textarea', full:true, value: fieldValue('route.baggageRules','baggageRules') },
        { name:'cancellationRules', label:'Cancellation/refund rules', type:'textarea', full:true, value: fieldValue('route.cancellationRules','cancellationRules') }
      ]
    };
    if (isCompanyRole && mode === 'edit' && (key === 'routestop' || key === 'route_stop')) return {
      action: editActionFor('routestop'), submit: 'Save stop changes',
      fields: [
        { type:'smart-summary', label:'Smart route stop update', help:'Terminal identity and pickup/drop-off permissions are derived from the selected branch and stop type.' },
        { name:'branchId', label:'Branch / terminal', type:'select', icon:'fa-building', options:branches, required:true, value: fieldValue('routeStop.branchId','branchId'), help:'The stop name, city and address are derived from the selected location.' },
        { name:'stopType', label:'Stop type', type:'select', icon:'fa-layer-group', options:[{value:'boarding',label:'Boarding only'},{value:'pickup',label:'Pickup stop'},{value:'intermediate',label:'Pickup and drop-off'},{value:'dropoff',label:'Drop-off only'}], value: fieldValue('routeStop.stopType','stopType') || 'intermediate', help:'Use the row move controls to change route order.' },
        { name:'timeOffsetMinutes', label:'Minutes after route origin', type:'number', icon:'fa-clock', value: fieldValue('routeStop.timeOffsetMinutes','timeOffsetMinutes') },
        { name:'pickupAllowed', type:'hidden', value: String(fieldValue('routeStop.pickupAllowed','pickupAllowed') ?? 'true') },
        { name:'dropoffAllowed', type:'hidden', value: String(fieldValue('routeStop.dropoffAllowed','dropoffAllowed') ?? 'true') },
        { name:'publicInstructions', label:'Public instructions', type:'textarea', full:true, value: fieldValue('routeStop.publicInstructions','publicInstructions') }
      ]
    };
    if (isCompanyRole && mode === 'edit' && key === 'vehicle') return {
      action: editActionFor('vehicle'), submit: 'Save vehicle changes',
      fields: [
        { name:'listingId', type:'hidden', value: fieldValue('vehicle.listingId','listingId') },
        { name:'serviceType', type:'hidden', value: companyServiceType },
        { name:'name', label:'Vehicle name', icon:'fa-bus-simple', required:true, value: fieldValue('vehicle.name','name') },
        { name:'plateOrCode', label:'Plate / fleet code', icon:'fa-hashtag', required:true, value: fieldValue('vehicle.plateOrCode','plateOrCode') },
        { name:'manufacturer', label:'Manufacturer', icon:'fa-industry', value: fieldValue('vehicle.manufacturer','manufacturer') },
        { name:'model', label:'Model', icon:'fa-bus', value: fieldValue('vehicle.model','model') },
        { name:'modelYear', label:'Model year', type:'number', icon:'fa-calendar', value: fieldValue('vehicle.modelYear','modelYear') },
        { name:'operatorPermitRef', label:'Operating permit ref', icon:'fa-id-card', value: fieldValue('vehicle.operatorPermitRef','operatorPermitRef') },
        { name:'operatorPermitExpiresAt', label:'Permit expiry', type:'date', icon:'fa-calendar-xmark', value: fieldValue('vehicle.operatorPermitExpiresAt','operatorPermitExpiresAt') },
        { name:'inspectionRef', label:'Inspection ref', icon:'fa-screwdriver-wrench', value: fieldValue('vehicle.inspectionRef','inspectionRef') },
        { name:'inspectionExpiresAt', label:'Inspection expiry', type:'date', icon:'fa-calendar-xmark', value: fieldValue('vehicle.inspectionExpiresAt','inspectionExpiresAt') },
        { name:'insuranceRef', label:'Insurance ref', icon:'fa-shield-halved', value: fieldValue('vehicle.insuranceRef','insuranceRef') },
        { name:'insuranceExpiresAt', label:'Insurance expiry', type:'date', icon:'fa-calendar-xmark', value: fieldValue('vehicle.insuranceExpiresAt','insuranceExpiresAt') },
        { name:'imageFile', label:'Add vehicle photo', type:'file', icon:'fa-image' },
        { name:'status', label:'Status', type:'select', icon:'fa-circle-check', options:['active','maintenance','paused','archived'], value: fieldValue('vehicle.status','status') || 'active' },
        { name:'amenities', label:'Amenities', type:'multiselect', icon:'fa-wifi', options:busAmenityOptions, value: fieldValue('vehicle.amenities','amenities'), help:'Select all amenities available in this vehicle.' },
        { name:'maintenanceNote', label:'Maintenance / compliance note', type:'textarea', full:true, value: fieldValue('vehicle.maintenanceNote','maintenanceNote') }
      ]
    };
    if (isCompanyRole && mode === 'edit' && key === 'schedule') return {
      action: editActionFor('schedule'), submit: 'Save schedule changes',
      fields: [
        { type:'smart-summary', label:'Smart departure update', help:'Vehicle, seat-map and fare selections remain linked to verified records. Published departures are replaced safely rather than mutating sold-ticket snapshots.' },
        { name:'routeId', label:'Route', type:'select', icon:'fa-route', options:routes, value: fieldValue('schedule.routeId','routeId'), required:true },
        { name:'vehicleId', label:'Vehicle', type:'select', icon:'fa-bus-simple', options:vehicles, value: fieldValue('schedule.vehicleId','vehicleId'), required:true, dependsOn:'routeId', filterKey:'listingId', parentMetaKey:'listingId', help:'Automatically selected when only one eligible bus exists.' },
        { name:'departAt', label:'Departure time', type:'datetime-local', icon:'fa-calendar-days', value: fieldValue('schedule.departAt','schedule.departure','departAt') },
        { name:'arriveAt', label:'Arrival estimate', type:'datetime-local', icon:'fa-calendar-check', value: fieldValue('schedule.arriveAt','schedule.arrival','arriveAt') },
        { name:'fareProductId', label:'Fare plan', type:'select', icon:'fa-coins', options:fareProducts, required:true, value: fieldValue('schedule.fareProductId','fareProductId'), dependsOn:'routeId', filterKey:'routeId', help:'Changing a published departure creates a replacement so sold tickets retain their original snapshot.' },
        { name:'boardingStartAt', label:'Boarding start time', type:'datetime-local', icon:'fa-clock', value: fieldValue('schedule.boardingStartAt','boardingStartAt') },
        { name:'status', label:'Status', type:'select', icon:'fa-circle-check', options:scheduleStatusOptions, value: fieldValue('schedule.status','status') || 'draft' },
        { name:'driverId', label:'Assigned driver', type:'select', icon:'fa-user-tie', options:drivers, value: fieldValue('schedule.driverEmployeeId','driverEmployeeId'), help:'Only an active driver account with accepted membership, verified identity and phone, valid licence, safety clearance, and all operational permissions can be assigned.' },
        { name:'blockedSeats', label:'Blocked seats for replacement', type:'multiselect', icon:'fa-ban', options:vehicleSeatOptions, dependsOn:'vehicleId', filterKey:'vehicleId', help:'Uses the selected bus’s published seat labels.' },
        { name:'notes', label:'Schedule notes', type:'textarea', full:true, value: fieldValue('schedule.notes','notes') }
      ]
    };
    if (isCompanyRole && mode === 'edit' && key === 'hotel_property') return {
      action: editActionFor('hotel_property'), submit: 'Save property',
      fields: [
        { type:'smart-summary', label:'Hotel property profile', help:'Public identity, guest policies, taxes, contact, accessibility and operational times stay linked to this property and its listing.' },
        { name:'propertyName', label:'Property name', icon:'fa-hotel', required:true, value: fieldValue('property.propertyName','propertyName') },
        { name:'propertyType', label:'Property type', type:'select', icon:'fa-building', options:['hotel','lodge','resort','guest_house','serviced_apartment','hostel','camp'], value: fieldValue('property.propertyType','propertyType') || 'hotel' },
        { name:'category', label:'Category', type:'select', icon:'fa-star', options:['unrated','budget','standard','premium','luxury'], value: fieldValue('property.category','category') || 'unrated' },
        { name:'starRating', label:'Star rating', type:'number', icon:'fa-star', value: fieldValue('property.starRating','starRating') || '0' },
        { name:'address', label:'Address', icon:'fa-map-pin', value: fieldValue('property.address','address') },
        { name:'city', label:'City', icon:'fa-location-dot', value: fieldValue('property.city','city') },
        { name:'country', label:'Country', icon:'fa-earth-africa', value: fieldValue('property.country','country') },
        { name:'timezone', label:'Timezone', icon:'fa-globe', value: fieldValue('property.timezone','timezone'), placeholder:'Africa/Kampala' },
        { name:'mapLocation', label:'GPS coordinates', icon:'fa-map-location-dot', value: fieldValue('property.mapLocation','mapLocation'), placeholder:'0.3476,32.5825' },
        { name:'contactEmail', label:'Property email', type:'email', icon:'fa-envelope', value: fieldValue('property.contactEmail','contactEmail') },
        { name:'contactPhone', label:'Property phone', icon:'fa-phone', value: fieldValue('property.contactPhone','contactPhone') },
        { name:'checkInTime', label:'Check-in time', type:'time', icon:'fa-clock', value: fieldValue('property.checkInTime','checkInTime') },
        { name:'checkOutTime', label:'Check-out time', type:'time', icon:'fa-clock', value: fieldValue('property.checkOutTime','checkOutTime') },
        { name:'taxPercent', label:'Tax percentage', type:'number', icon:'fa-receipt', value: fieldValue('property.taxPercent','taxPercent') || '0' },
        { name:'serviceFeePercent', label:'Service fee percentage', type:'number', icon:'fa-percent', value: fieldValue('property.serviceFeePercent','serviceFeePercent') || '0' },
        { name:'status', label:'Status', type:'select', icon:'fa-circle-check', options:['active','paused'], value: fieldValue('property.status','status') || 'active', help:'Use the Archive action to retire a property after reservation checks.' },
        { name:'amenities', label:'Amenities', type:'multiselect', icon:'fa-wifi', options:hotelAmenityOptions, value: fieldValue('property.amenities','amenities') },
        { name:'accessibilityFeatures', label:'Accessibility', type:'multiselect', icon:'fa-wheelchair', options:['step_free_access','accessible_room','accessible_bathroom','lift','visual_alerts','hearing_support','accessible_parking'], value: fieldValue('property.accessibilityFeatures','accessibilityFeatures') },
        { name:'childPolicy', label:'Child policy', type:'textarea', full:true, value: fieldValue('property.childPolicy','childPolicy') },
        { name:'petPolicy', label:'Pet policy', type:'textarea', full:true, value: fieldValue('property.petPolicy','petPolicy') },
        { name:'smokingPolicy', label:'Smoking policy', type:'textarea', full:true, value: fieldValue('property.smokingPolicy','smokingPolicy') },
        { name:'paymentPolicy', label:'Payment policy', type:'textarea', full:true, value: fieldValue('property.paymentPolicy','paymentPolicy') },
        { name:'depositPolicy', label:'Security / incidental policy', type:'textarea', full:true, value: fieldValue('property.depositPolicy','depositPolicy'), help:'Describe refundable key, damage or incidental rules only. Booking payment remains pay-now.' },
        { name:'houseRules', label:'House rules', type:'textarea', full:true, value: fieldValue('property.houseRules','houseRules') },
        { name:'policies', label:'Other property policies', type:'textarea', full:true, value: fieldValue('property.policies','policies') }
      ]
    };
    if (isCompanyRole && mode === 'edit' && key === 'room_type') return {
      action: editActionFor('room_type'), submit: 'Save room type',
      fields: [
        { type:'smart-summary', label:'Room type and occupancy', help:'Capacity, bedding, included guests, stay limits and fees drive search, pricing and room assignment.' },
        { name:'name', label:'Room type', icon:'fa-bed', required:true, value: fieldValue('roomType.name','name') },
        { name:'capacity', label:'Total capacity', type:'number', icon:'fa-users', required:true, value: fieldValue('roomType.capacity','capacity') },
        { name:'maxAdults', label:'Maximum adults', type:'number', icon:'fa-user-group', required:true, value: fieldValue('roomType.maxAdults','maxAdults') },
        { name:'maxChildren', label:'Maximum children', type:'number', icon:'fa-child', value: fieldValue('roomType.maxChildren','maxChildren') || '0' },
        { name:'maxInfants', label:'Maximum infants', type:'number', icon:'fa-baby', value: fieldValue('roomType.maxInfants','maxInfants') || '0' },
        { name:'bedType', label:'Primary bed type', type:'select', icon:'fa-bed', options:['single','double','twin','queen','king','family','suite'], value: fieldValue('roomType.bedType','bedType') || 'double' },
        { name:'singleBeds', label:'Single beds', type:'number', icon:'fa-bed', value: fieldValue('roomType.bedConfiguration.single','singleBeds') || '0' },
        { name:'doubleBeds', label:'Double beds', type:'number', icon:'fa-bed', value: fieldValue('roomType.bedConfiguration.double','doubleBeds') || '0' },
        { name:'sofaBeds', label:'Sofa beds', type:'number', icon:'fa-couch', value: fieldValue('roomType.bedConfiguration.sofa','sofaBeds') || '0' },
        { name:'sizeSqm', label:'Room size (m²)', type:'number', icon:'fa-ruler-combined', value: fieldValue('roomType.sizeSqm','sizeSqm') || '0' },
        { name:'basePrice', label:'Base nightly price', type:'number', icon:'fa-coins', required:true, value: fieldValue('roomType.basePrice','basePrice') },
        { name:'mealPlan', label:'Default meal plan', type:'select', icon:'fa-utensils', options:['room_only','breakfast','half_board','full_board','all_inclusive'], value: fieldValue('roomType.mealPlan','mealPlan') || 'room_only' },
        { name:'extraAdultFee', label:'Extra adult fee', type:'number', icon:'fa-user-plus', value: fieldValue('roomType.extraAdultFee','extraAdultFee') || '0' },
        { name:'extraChildFee', label:'Extra child fee', type:'number', icon:'fa-child-reaching', value: fieldValue('roomType.extraChildFee','extraChildFee') || '0' },
        { name:'minStay', label:'Minimum stay', type:'number', icon:'fa-calendar-minus', value: fieldValue('roomType.minStay','minStay') || '1' },
        { name:'maxStay', label:'Maximum stay', type:'number', icon:'fa-calendar-plus', value: fieldValue('roomType.maxStay','maxStay') || '90' },
        { name:'status', label:'Status', type:'select', icon:'fa-circle-check', options:['active','paused'], value: fieldValue('roomType.status','status') || 'active', help:'Use the Archive action so active assignments and inventory are checked first.' },
        { name:'amenities', label:'Amenities', type:'multiselect', icon:'fa-wifi', options:hotelAmenityOptions, value: fieldValue('roomType.amenities','amenities') },
        { name:'accessibilityFeatures', label:'Accessibility', type:'multiselect', icon:'fa-wheelchair', options:['step_free_access','accessible_bathroom','grab_rails','visual_alerts','hearing_support'], value: fieldValue('roomType.accessibilityFeatures','accessibilityFeatures') },
        { name:'policies', label:'Room policies', type:'textarea', full:true, value: fieldValue('roomType.policies','policies') }
      ]
    };
    if (isCompanyRole && mode === 'edit' && key === 'rate_plan') return {
      action: editActionFor('rate_plan'), submit: 'Save rate plan',
      fields: [
        { type:'smart-summary', label:'Rate and policy rules', help:'Prices, meal plan, cancellation, deposit and stay limits are frozen into each reservation at booking.' },
        { name:'name', label:'Rate plan name', icon:'fa-tags', required:true, value: fieldValue('ratePlan.name','name') },
        { name:'pricingMode', label:'Pricing source', type:'select', icon:'fa-coins', options:[{value:'nightly_inventory',label:'Room-night calendar price'},{value:'fixed',label:'Fixed plan price'}], value: fieldValue('ratePlan.pricingMode','pricingMode') || 'nightly_inventory' },
        { name:'basePrice', label:'Base price', type:'number', icon:'fa-coins', value: fieldValue('ratePlan.basePrice','basePrice') || '0' },
        { name:'mealPlan', label:'Meal plan', type:'select', icon:'fa-utensils', options:['room_only','breakfast','half_board','full_board','all_inclusive'], value: fieldValue('ratePlan.mealPlan','mealPlan') || 'room_only' },
        { name:'refundable', label:'Refundable', type:'select', icon:'fa-rotate-left', options:['true','false'], value: String(fieldValue('ratePlan.refundable','refundable') ?? 'true') },
        { name:'cancellationDeadlineHours', label:'Free-cancellation deadline (hours)', type:'number', icon:'fa-clock', value: fieldValue('ratePlan.cancellationDeadlineHours','cancellationDeadlineHours') || '24' },
        { name:'cancellationPenaltyType', label:'Cancellation penalty', type:'select', icon:'fa-ban', options:['none','first_night','percentage','full_stay'], value: fieldValue('ratePlan.cancellationPenaltyType','cancellationPenaltyType') || 'first_night' },
        { name:'cancellationPenaltyValue', label:'Penalty value', type:'number', icon:'fa-percent', value: fieldValue('ratePlan.cancellationPenaltyValue','cancellationPenaltyValue') || '0' },
        { name:'paymentTiming', label:'Payment timing', type:'select', icon:'fa-credit-card', options:['pay_now'], value:'pay_now', help:'Hotel bookings are confirmed only through the platform payment flow.' },
        { name:'minStay', label:'Minimum stay', type:'number', icon:'fa-calendar-minus', value: fieldValue('ratePlan.minStay','minStay') || '1' },
        { name:'maxStay', label:'Maximum stay', type:'number', icon:'fa-calendar-plus', value: fieldValue('ratePlan.maxStay','maxStay') || '90' },
        { name:'includedAdults', label:'Included adults', type:'number', icon:'fa-user-group', value: fieldValue('ratePlan.includedAdults','includedAdults') || '1' },
        { name:'includedChildren', label:'Included children', type:'number', icon:'fa-child', value: fieldValue('ratePlan.includedChildren','includedChildren') || '0' },
        { name:'extraAdultFee', label:'Extra adult fee', type:'number', icon:'fa-user-plus', value: fieldValue('ratePlan.extraAdultFee','extraAdultFee') || '0' },
        { name:'extraChildFee', label:'Extra child fee', type:'number', icon:'fa-child-reaching', value: fieldValue('ratePlan.extraChildFee','extraChildFee') || '0' },
        { name:'status', label:'Status', type:'select', icon:'fa-circle-check', options:['active','paused'], value: fieldValue('ratePlan.status','status') || 'active' }
      ]
    };
    if (isCompanyRole && mode === 'edit' && key === 'room_unit') return {
      action: editActionFor('room_unit'), submit: 'Save room unit',
      fields: [
        { name:'unitNumber', label:'Room / unit number', icon:'fa-door-open', required:true, value: fieldValue('roomUnit.unitNumber','unitNumber') },
        { name:'floor', label:'Floor', icon:'fa-layer-group', value: fieldValue('roomUnit.floor','floor') },
        { name:'wing', label:'Wing', icon:'fa-building', value: fieldValue('roomUnit.wing','wing') },
        { name:'housekeepingStatus', label:'Housekeeping', type:'select', icon:'fa-broom', options:['clean','dirty','cleaning','inspected','ready','maintenance'], value: fieldValue('roomUnit.housekeepingStatus','housekeepingStatus') || 'clean' },
        { name:'status', label:'Status', type:'select', icon:'fa-circle-check', options:['available','maintenance','cleaning'], value: fieldValue('roomUnit.status','status') || 'available' },
        { name:'notes', label:'Notes', type:'textarea', full:true, value: fieldValue('roomUnit.notes','notes') }
      ]
    };
    if (isCompanyRole && mode === 'edit' && key === 'room_night') return {
      action: editActionFor('room_night'), submit: 'Save room-night status',
      fields: [
        { name:'status', label:'Status', type:'select', icon:'fa-circle-check', options:['available','open','maintenance','cleaning','cancelled'], value: fieldValue('roomNight.status','status') || 'available' },
        { name:'price', label:'Night price', type:'number', icon:'fa-coins', value: fieldValue('roomNight.price','price') },
        { name:'housekeepingStatus', label:'Housekeeping', type:'select', icon:'fa-broom', options:['clean','dirty','cleaning','inspected','maintenance'] },
        { name:'notes', label:'Notes', type:'textarea', full:true, value: fieldValue('roomNight.notes','notes') }
      ]
    };

    if (isCompanyRole && key === 'route stop') return {
      action: `/company/routes/${encodeURIComponent(recordId)}/stops`, submit: 'Add route stop',
      fields: [
        { type:'smart-summary', label:'Smart route stop', help:'Select an existing terminal. Name, city, address, pickup/drop-off permissions, insertion order and route segments are handled automatically.' },
        { name:'branchId', label:'Branch / terminal', type:'select', icon:'fa-building', options:branches, required:true, help:'Select the existing location. Its verified operating details are reused.' },
        { name:'stopType', label:'Stop type', type:'select', icon:'fa-layer-group', options:[{value:'boarding',label:'Boarding only'},{value:'pickup',label:'Pickup stop'},{value:'intermediate',label:'Pickup and drop-off'},{value:'dropoff',label:'Drop-off only'}], value:'intermediate' },
        { name:'pickupAllowed', type:'hidden', value:'true' },
        { name:'dropoffAllowed', type:'hidden', value:'true' },
        { name:'timeOffsetMinutes', label:'Minutes after route origin', type:'number', icon:'fa-clock', placeholder:'90', help:'Optional operational estimate. Leave empty when it is not known yet.' },
        { name:'publicInstructions', label:'Public instructions', type:'textarea', full:true, placeholder:`Instructions for ${recordLabel}` }
      ]
    };
    if (isCompanyRole && key === 'vehicle seat template') {
      const vehicleDetail = detail?.vehicle || {};
      const templateSeats = Array.isArray(vehicleDetail.seats) ? vehicleDetail.seats : [];
      const currentLabels = templateSeats.map(seat => seat.seatNumber || seat.label || seat.id).filter(Boolean);
      const templateSeatOptions = templateSeats.length
        ? templateSeats.map(seat => ({ value: seat.seatNumber || seat.id, vehicleId: recordId || vehicleDetail.id || '', label: `Seat ${seat.seatNumber || seat.id} (${seat.seatClass || seat.seatType || seat.status || 'standard'})` }))
        : vehicleSeatOptions;
      return {
        action: recordId ? `/company/vehicles/${encodeURIComponent(recordId)}/seats` : '/company/vehicles/seat-template',
        submit: 'Save seat template',
        fields: [
          { type:'smart-summary', label:'Smart seat map', help:'Select a bus and its live layout, capacity and current labels will load automatically. Normal numbering does not require manual labels.' },
          ...(recordId ? [{ name:'vehicleId', type:'hidden', value:recordId }] : [{ name:'vehicleId', label:'Vehicle', type:'select', icon:'fa-bus-simple', options:vehicles, required:true }]),
          { name:'layoutName', label:'Layout pattern', type:'select', icon:'fa-chair', options:[{value:'1x1',label:'1 + 1 with aisle'},{value:'1x2',label:'1 + 2 with aisle'},{value:'2x1',label:'2 + 1 with aisle'},{value:'2x2',label:'2 + 2 with aisle'},{value:'2x3',label:'2 + 3 with aisle'},{value:'3x2',label:'3 + 2 with aisle'},{value:'3x3',label:'3 + 3 with aisle'},{value:'sleeper',label:'Sleeper berths'},{value:'custom',label:'Custom layout'}], value: fieldValue('vehicle.layoutName','layoutName') || '2x2' },
          { name:'rows', label:'Rows', type:'number', icon:'fa-grip', value: fieldValue('vehicle.rows','rows') },
          { name:'totalSeats', label:'Passenger seats', type:'number', icon:'fa-users', required:true, value: fieldValue('vehicle.totalSeats','totalSeats') },
          { name:'seatLabelMode', label:'Seat numbering', type:'select', icon:'fa-wand-magic-sparkles', options:[{value:'preserve',label:'Keep current labels'},{value:'automatic',label:'Automatic 1, 2, 3…'},{value:'row_letters',label:'Rows and positions: A1, A2…'},{value:'prefix_numeric',label:'Prefix and number: S1, S2…'},{value:'custom',label:'Custom labels'}], value: currentLabels.length ? 'preserve' : (fieldValue('vehicle.seatLabelMode','seatLabelMode') || 'automatic') },
          { name:'seatLabelPrefix', label:'Label prefix', icon:'fa-font', value: fieldValue('vehicle.seatLabelPrefix','seatLabelPrefix'), placeholder:'S', help:'Used only for prefix numbering.' },
          { name:'seatLabels', label:'Custom seat labels', type:'seat-labels', full:true, value:currentLabels.join(', '), help:'Required only in Custom mode. It must contain one unique label for every passenger seat.' },
          { name:'vipSeats', label:'VIP / premium seats', type:'multiselect', icon:'fa-star', options:templateSeatOptions, dependsOn:recordId ? '' : 'vehicleId', filterKey:'vehicleId', value: templateSeats.filter(seat => /vip|premium|business|executive/i.test([seat.seatClass, seat.seatType].join(' '))).map(seat => seat.seatNumber || seat.id).join(',') },
          { name:'accessibleSeats', label:'Accessibility seats', type:'multiselect', icon:'fa-wheelchair', options:templateSeatOptions, dependsOn:recordId ? '' : 'vehicleId', filterKey:'vehicleId', value: templateSeats.filter(seat => seat.accessible || /accessible|wheelchair/i.test(String(seat.seatType || ''))).map(seat => seat.seatNumber || seat.id).join(',') },
          { name:'crewSeats', label:'Crew-only seats', type:'multiselect', icon:'fa-user-shield', options:templateSeatOptions, dependsOn:recordId ? '' : 'vehicleId', filterKey:'vehicleId', value: templateSeats.filter(seat => /crew/i.test(String(seat.seatType || seat.blockedReason || ''))).map(seat => seat.seatNumber || seat.id).join(',') },
          { name:'disabledSeats', label:'Non-sellable spaces', type:'multiselect', icon:'fa-ban', options:templateSeatOptions, dependsOn:recordId ? '' : 'vehicleId', filterKey:'vehicleId', value: templateSeats.filter(seat => seat.enabled === false || seat.isDisabled).map(seat => seat.seatNumber || seat.id).join(','), help:'Doors, aisles, broken seats or other permanent non-passenger positions.' },
          { name:'blockedSeats', label:'Initially blocked seats', type:'multiselect', icon:'fa-lock', options:templateSeatOptions, dependsOn:recordId ? '' : 'vehicleId', filterKey:'vehicleId', value: templateSeats.filter(seat => /blocked|maintenance|reserved/i.test(String(seat.status || seat.blockedReason || ''))).map(seat => seat.seatNumber || seat.id).join(',') },
          { name:'defaultSeatClass', label:'Default class', type:'select', icon:'fa-tag', options:['Standard','Economy','Executive','Business','VIP'], value: fieldValue('vehicle.defaultSeatClass','defaultSeatClass') || 'Standard' },
          { name:'vipPriceDelta', label:'VIP price difference', type:'number', icon:'fa-coins', value: fieldValue('vehicle.vipPriceDelta','vipPriceDelta') || '0' }
        ]
      };
    }
    if (isCompanyRole && key === 'vehicle status') return {
      action: `/company/vehicles/${encodeURIComponent(recordId)}/status`, submit: 'Update vehicle status',
      fields: [
        { name:'status', label:'Status', type:'select', icon:'fa-circle-check', options:['active','maintenance','paused','archived'], required:true },
        { name:'maintenanceReason', label:'Reason / note', type:'textarea', full:true, placeholder:'Why status changed' }
      ]
    };
    if (isCompanyRole && key === 'schedule status') return {
      action: `/company/schedules/${encodeURIComponent(recordId)}/status`, submit: 'Update schedule status',
      fields: [
        { name:'status', label:'Next status', type:'select', icon:'fa-road-circle-check', options:['draft','active','published','boarding','departed','arrived','completed','delayed','cancelled','archived'], required:true },
        { name:'reason', label:'Reason / operational note', type:'textarea', full:true, placeholder:'Delay, cancellation, completion note...' }
      ]
    };
    if (isCompanyRole && key === 'seat status') {
      const seatDetail = detail?.seat || {};
      const mapDetail = detail?.seatMap || {};
      const parts = String(recordId || '').split(':');
      return {
        action: '/company/seats/status', submit: 'Update seat status',
        fields: [
          { type:'smart-summary', label:'Live seat operation', help:'Choose a departure and only seats from its frozen vehicle seat-map snapshot are available.' },
          { name:'scheduleId', label:'Schedule', type:'select', icon:'fa-calendar-days', options:schedules, required:true, value: seatDetail.scheduleId || mapDetail.scheduleId || parts[0] || '', help:'Select an existing departure schedule. Internal IDs are never typed.' },
          { name:'seatNumber', label:'Seat No', type:'select', icon:'fa-chair', options: seatOptions, required:true, dependsOn:'scheduleId', filterKey:'scheduleId', value: seatDetail.seatNumber || parts[1] || '', help:'Select a seat generated for the chosen departure.' },
          { name:'status', label:'Seat status', type:'select', icon:'fa-circle-check', options:['available','held','booked','checked-in','no-show','cancelled','refunded','blocked','maintenance','reserved','disabled'], required:true, value: seatDetail.status || 'blocked' },
          { name:'reason', label:'Reason / note', type:'textarea', full:true, placeholder:'Why this seat is blocked, released, reserved, or changed', value: seatDetail.blockedReason || '' }
        ]
      };
    }
    if (isCompanyRole && key === 'duplicate schedule') return {
      action: `/company/schedules/${encodeURIComponent(recordId)}/duplicate`, submit: 'Duplicate schedule',
      fields: [
        { name:'departAt', label:'New departure time', type:'datetime-local', icon:'fa-calendar-days', required:true },
        { name:'arriveAt', label:'New arrival estimate', type:'datetime-local', icon:'fa-calendar-check' },
        { name:'basePrice', label:'Base fare override', type:'number', icon:'fa-coins', placeholder:'65000' },
        { name:'status', label:'New status', type:'select', icon:'fa-circle-check', options:['draft','active','published'] },
        { name:'notes', label:'Notes', type:'textarea', full:true, placeholder:'Duplicated schedule notes' }
      ]
    };

    if (isCompanyRole && key === 'housekeeping') return {
      action: `/company/hotels/housekeeping/${encodeURIComponent(recordId)}`,
      submit: 'Update housekeeping',
      fields: [
        { name:'taskId', type:'hidden', value: fieldValue('housekeepingTask.id','task.id','taskId') },
        { name:'inventoryId', type:'hidden', value: fieldValue('roomNight.id','inventoryId') },
        { name:'targetDate', label:'Room service date', type:'date', icon:'fa-calendar-day', value: fieldValue('housekeepingTask.targetDate','roomNight.date','targetDate'), help:'Only this task/date is changed; future room nights are not edited.' },
        { name:'housekeepingStatus', label:'Housekeeping status', type:'select', icon:'fa-broom', options:['dirty','cleaning','inspected','clean','ready','maintenance'], required:true, value: fieldValue('roomUnit.housekeepingStatus','housekeepingStatus') || 'dirty' },
        { name:'taskStatus', label:'Task status', type:'select', icon:'fa-list-check', options:['open','in_progress','blocked','completed','cancelled'], value: fieldValue('housekeepingTask.status','roomUnit.housekeepingTaskStatus','taskStatus') || 'open' },
        { name:'priority', label:'Priority', type:'select', icon:'fa-flag', options:['low','normal','high','urgent'], value: fieldValue('roomUnit.housekeepingPriority','priority') || 'normal' },
        { name:'assignedTo', label:'Assigned staff', type:'select', icon:'fa-user-check', options:staff, value: fieldValue('roomUnit.housekeepingAssignedTo','assignedTo'), help:'Select an active hotel employee; do not type a name that is not linked to an account.' },
        { name:'dueAt', label:'Due time', type:'datetime-local', icon:'fa-clock', value: fieldValue('roomUnit.housekeepingDueAt','dueAt') },
        { name:'startDate', label:'Maintenance start', type:'date', icon:'fa-calendar-plus', help:'Used only when housekeeping status is maintenance.' },
        { name:'endDate', label:'Maintenance end', type:'date', icon:'fa-calendar-minus', help:'Must be after the start date.' },
        { name:'status', label:'Room status', type:'select', icon:'fa-circle-check', options:['available','occupied','maintenance','cleaning','reserved'], value: fieldValue('roomUnit.status','status') || 'cleaning' },
        { name:'notes', label:'Housekeeping note', type:'textarea', full:true, value: fieldValue('roomUnit.notes','notes'), placeholder:'Cleaning, inspection, damage, or maintenance note' }
      ]
    };


    if (isCompanyRole && key === 'booking') {
      if (companyServiceType === 'hotel') return {
        action: '/company/hotels/bookings', submit: 'Create hotel booking',
        fields: [
          { name:'listingId', label:'Hotel listing', type:'select', icon:'fa-hotel', options:listings, required:true, help:'The public hotel service customers see.' },
          { name:'roomTypeId', label:'Room type', type:'select', icon:'fa-bed', options:roomTypes, required:true, dependsOn:'listingId', filterKey:'listingId', help:'Only room types belonging to the selected listing are shown.' },
          { name:'ratePlanId', label:'Rate plan', type:'select', icon:'fa-tags', options:ratePlans, dependsOn:'roomTypeId', filterKey:'roomTypeId', help:'Select the cancellation, meal, occupancy, and stay-rule product.' },
          { name:'roomUnitIds', label:'Preferred room units', type:'multiselect', icon:'fa-door-open', options:roomUnits, dependsOn:'roomTypeId', filterKey:'roomTypeId', help:'Optional. Leave empty to let the system assign available rooms.' },
          { name:'addons', label:'Hotel extras', type:'multiselect', icon:'fa-circle-plus', options:serviceAddonOptions, dependsOn:'listingId', filterKey:'listingId', help:'Only active extras created for this hotel listing are shown. Prices are recalculated by the server.' },
          { name:'checkInDate', label:'Check-in date', type:'date', icon:'fa-calendar-days', required:true },
          { name:'checkOutDate', label:'Check-out date', type:'date', icon:'fa-calendar-check', required:true },
          { name:'roomCount', label:'Rooms required', type:'number', icon:'fa-door-open', required:true, value:'1' },
          { name:'adults', label:'Adults', type:'number', icon:'fa-user-group', required:true, value:'1' },
          { name:'children', label:'Children', type:'number', icon:'fa-child', value:'0' },
          { name:'infants', label:'Infants', type:'number', icon:'fa-baby', value:'0' },
          { name:'fullName', label:'Lead guest name', icon:'fa-user', required:true, placeholder:'Jane Guest' },
          { name:'email', label:'Guest email', type:'email', icon:'fa-envelope', required:true, placeholder:'Enter email address' },
          { name:'phone', label:'Guest phone', icon:'fa-phone', required:true, placeholder:'Enter phone number' },
          { name:'identityType', label:'ID type', type:'select', icon:'fa-id-card', options:['national_id','passport','student_id','birth_certificate'] },
          { name:'identityNumber', label:'ID / passport number', icon:'fa-id-card-clip' },
          { name:'nationality', label:'Nationality', icon:'fa-earth-africa' },
          { name:'dateOfBirth', label:'Date of birth', type:'date', icon:'fa-cake-candles' },
          { name:'emergencyContactName', label:'Emergency contact name', icon:'fa-user-shield' },
          { name:'emergencyContactPhone', label:'Emergency contact phone', icon:'fa-phone-volume' },
          { name:'estimatedArrivalTime', label:'Estimated arrival', type:'time', icon:'fa-clock' },
          { name:'additionalGuestNames', label:'Other guest names', type:'textarea', full:true, placeholder:'One guest name per line. Include every traveler so the hotel manifest is complete.' },
          { name:'paymentProvider', label:'Payment method', type:'select', icon:'fa-wallet', options:['cash','bank_transfer','card','mobile_money'], value:'cash' },
          { name:'paymentStatus', label:'Payment status', type:'select', icon:'fa-money-check', options:[{value:'successful',label:'Paid / confirmed'},{value:'pending',label:'Payment pending'}], value:'successful', help:'Choose Paid only when the partner has actually received and verified the payment.' },
          { name:'specialRequests', label:'Special requests / stay notes', type:'textarea', full:true, placeholder:'Accessibility, bedding, airport pickup, meals, or other request...' }
        ]
      };
      return {
        action: '/company/bookings', submit: `Create ${serviceLabel.toLowerCase()} booking`,
        fields: [
          { type:'smart-summary', label:'Smart bus booking', help:'Choose the service and departure. Route, bus, fare, currency and available seats come from the live schedule; only passenger details are entered.' },
          { name:'listingId', label:`${serviceLabel} listing`, type:'select', icon:'fa-layer-group', options:listings, required:true, help:'Choose the public service first.' },
          { name:'scheduleId', label:'Departure schedule', type:'select', icon:'fa-calendar-days', options:schedules, required:true, dependsOn:'listingId', filterKey:'listingId', help:'Only departures belonging to the selected listing are shown.' },
          { name:'fullName', label:'Passenger/customer name', icon:'fa-user', required:true, placeholder:'Jane Customer' },
          { name:'email', label:'Email', type:'email', icon:'fa-envelope', required:true, placeholder:'customer@example.com' },
          { name:'phone', label:'Phone', icon:'fa-phone', required:true, placeholder:'Enter phone number' },
          { name:'selected', label:'Seat No', type:'select', icon:'fa-chair', options:seatOptions, required:true, dependsOn:'scheduleId', filterKey:'scheduleId', help:'Only seats created from the selected vehicle seat map for this departure are shown.' },
          { name:'addons', label:'Add-ons / notes', icon:'fa-plus', placeholder:'luggage,meal' }
        ]
      };
    }
    if (isCompanyRole && key === 'listing') return {
      action: '/company/listings', submit: `Create ${serviceLabel.toLowerCase()} listing`,
      fields: [
        ...(companyServiceType === 'bus' ? [{ type:'smart-summary', label:'Smart bus listing', help:'Select the operating terminal and city, country and address are reused instead of typed again.' }] : []),
        { name:'serviceType', type:'hidden', value: companyServiceType },
        { name:'title', label:`${serviceLabel} listing title`, icon:'fa-pen', required:true, placeholder: companyServiceType === 'hotel' ? 'Enter the property listing title' : 'Enter the public bus service name' },
        { name:'branchId', label:'Branch / terminal / property', type:'select', icon:'fa-building', options:branches, required: companyServiceType === 'bus', help: companyServiceType === 'bus' ? 'Country, city and address are inherited from this terminal.' : 'Select a saved branch or property desk when applicable.' },
        ...(companyServiceType === 'bus' ? [
          { name:'shortDescription', label:'Short public description', icon:'fa-align-left', required:true, placeholder:'Verified bus service with daily departures' },
          { name:'operatorLicenceRef', label:'Operator licence / permit ref', icon:'fa-id-card', placeholder:'Bus operator licence reference' },
          { name:'contactPhone', label:'Booking support phone', icon:'fa-phone', placeholder:'Enter phone number' },
          { name:'salesChannels', label:'Sales channels', type:'multiselect', icon:'fa-cart-shopping', options:['web','mobile','agent','counter'] },
          { name:'imageFile', label:'Bus service image', type:'file', icon:'fa-image', required:true, help:'Upload at least one real service or fleet image before publication.' }
        ] : []),
        ...(companyServiceType === 'hotel' ? [{ name:'city', label:'City', icon:'fa-location-dot', placeholder:'Enter the property city' }] : []),
        ...(companyServiceType === 'hotel' ? [
          { name:'from', label:'Location / area', icon:'fa-location-dot', placeholder:'Kampala' },
          { name:'to', label:'Nearby landmark', icon:'fa-location-dot', placeholder:'City center' }
        ] : []),
        { name:'address', label:'Address', icon:'fa-map-pin', placeholder:'Plot 1 Main Street', showFor:['hotel'] },
        { name:'layout', label:'Default layout', type:'select', icon:'fa-chair', options:['bus-2-2','bus-2-1'], showFor:['bus'] },
        { name:'checkInTime', label:'Check-in time', type:'time', icon:'fa-clock', value:'14:00', showFor:'hotel' },
        { name:'checkOutTime', label:'Check-out time', type:'time', icon:'fa-clock', value:'11:00', showFor:'hotel' },
        { name:'amenities', label:'Amenities', type:'multiselect', icon:'fa-wifi', options:hotelAmenityOptions, showFor:['hotel'] },
        { name:'roomType', label:'First room type', icon:'fa-bed', placeholder:'Standard Queen', showFor:'hotel' },
        { name:'capacity', label:'Room capacity', type:'number', icon:'fa-users', value:'2', showFor:'hotel' },
        { name:'nightlyPrice', label:'Nightly price', type:'number', icon:'fa-coins', placeholder:'180000', showFor:'hotel' },
        { name:'inventory', label:'Room stock', type:'number', icon:'fa-door-open', value:'1', showFor:'hotel' },
        { name:'pickupInstructions', label:'Pickup instructions', icon:'fa-map-pin', placeholder:'Pickup desk or terminal', showFor:['bus'] },
        { name:'dropoffInstructions', label:'Dropoff instructions', icon:'fa-location-dot', placeholder:'Arrival desk or drop-off point', showFor:['bus'] },
        ...(companyServiceType === 'bus' ? [
          { name:'baggageRules', label:'Baggage rules', type:'textarea', full:true, placeholder:'Included allowance and excess baggage rules' },
          { name:'cancellationRules', label:'Cancellation / refund rules', type:'textarea', full:true, placeholder:'When changes, cancellations and refunds are allowed' }
        ] : [{ name:'priceFrom', label:'Price from', type:'number', icon:'fa-coins', required:true, placeholder:'65000' }]),
        { name:'status', label:'Status', type:'select', icon:'fa-circle-check', options: companyServiceType === 'bus' ? ['draft'] : ['draft','active','paused'], value:'draft', help: companyServiceType === 'bus' ? 'Create the profile as draft, then edit it to Active when the public image, contact, licence and policies are complete. Keep the listing as draft until a future published departure completes the exact route, vehicle, fare, seat-map, driver and inventory chain. Then edit the listing to Active.' : '' },
        { name:'description', label:'Description', type:'textarea', full:true, placeholder:'Service details' }
      ]
    };
    if (isCompanyRole && key === 'route') return {
      action: '/company/routes', submit: 'Create route',
      fields: [
        { type:'smart-summary', label:'Smart route setup', help:'Choose the bus listing and endpoint terminals. Route name, code, timezone and service policies are reused or generated automatically.' },
        { name:'listingId', label:'Bus listing', type:'select', icon:'fa-layer-group', options:listings, required:true },
        { name:'routeName', label:'Route name', icon:'fa-route', placeholder:'Generated from terminals' },
        { name:'routeCode', label:'Route code', icon:'fa-hashtag', placeholder:'Generated automatically' },
        { name:'timezone', label:'Route timezone', type:'select', icon:'fa-clock', options:['Africa/Kampala','Africa/Nairobi','Africa/Kigali','Africa/Dar_es_Salaam','Africa/Juba','Africa/Bujumbura','Africa/Mogadishu'], value:'Africa/Kampala' },
        { name:'originBranchId', label:'Origin terminal / branch', type:'select', icon:'fa-location-dot', options:branches, required:true, help:'Create the terminal/branch first, then select it here.' },
        { name:'destinationBranchId', label:'Destination terminal / branch', type:'select', icon:'fa-location-dot', options:branches, required:true },
        { name:'boardingBranchIds', label:'Additional boarding branches', type:'multiselect', icon:'fa-map-pin', options:branches, help:'Select existing branches/terminals; do not type IDs.' },
        { name:'dropoffBranchIds', label:'Additional drop-off branches', type:'multiselect', icon:'fa-map-pin', options:branches, help:'Select existing branches/terminals; do not type IDs.' },
        { name:'distanceKm', label:'Distance KM', type:'number', icon:'fa-road', placeholder:'650' },
        { name:'estimatedDuration', label:'Estimated duration', icon:'fa-clock', placeholder:'12h' },
        { name:'operatingDays', label:'Operating days', type:'multiselect', icon:'fa-calendar-week', options:dayOptions, help:'Pick all days this route normally runs.' },
        { name:'baggageRules', label:'Baggage rules', type:'textarea', full:true, placeholder:'Passenger baggage policy' },
        { name:'cancellationRules', label:'Cancellation/refund rules', type:'textarea', full:true, placeholder:'Cancellation and refund policy for this route' }
      ]
    };
    if (isCompanyRole && key === 'vehicle') return {
      action: '/company/vehicles', submit: 'Create vehicle',
      fields: [
        { type:'smart-summary', label:'Smart vehicle setup', help:'The selected service supplies operator context. Capacity and numbering generate a complete versioned seat map without retyping labels.' },
        { name:'listingId', label:`${serviceLabel} listing`, type:'select', icon:'fa-layer-group', options:listings, required:true },
        { name:'serviceType', type:'hidden', value: companyServiceType },
        { name:'name', label:'Vehicle name', icon:'fa-bus-simple', required:true, placeholder:'Bus 01' },
        { name:'plateOrCode', label:'Plate / fleet code', icon:'fa-hashtag', required:true, placeholder:'UAX 000A' },
        { name:'layoutName', label:'Layout', type:'select', icon:'fa-chair', options:['1x1','1x2','2x1','2x2','2x3','3x2','3x3','sleeper','custom'], value:'2x2' },
        { name:'rows', label:'Rows', type:'number', icon:'fa-grip', placeholder:'12' },
        { name:'totalSeats', label:'Capacity / seats', type:'number', icon:'fa-users', required:true, value:'48' },
        { name:'seatLabelMode', label:'Seat numbering', type:'select', icon:'fa-wand-magic-sparkles', options:[{value:'automatic',label:'Automatic 1, 2, 3…'},{value:'row_letters',label:'Rows and positions: A1, A2…'},{value:'prefix_numeric',label:'Prefix and number: S1, S2…'},{value:'custom',label:'Custom labels'}], value:'automatic' },
        { name:'seatLabelPrefix', label:'Label prefix', icon:'fa-font', placeholder:'S' },
        { name:'seatLabels', label:'Custom seat labels', type:'seat-labels', full:true, help:'Only needed for Custom mode; provide one unique label for every seat.' },
        { name:'manufacturer', label:'Manufacturer', icon:'fa-industry', placeholder:'Scania' },
        { name:'model', label:'Model', icon:'fa-bus', placeholder:'Enter vehicle model' },
        { name:'modelYear', label:'Model year', type:'number', icon:'fa-calendar', placeholder:'2025' },
        { name:'operatorPermitRef', label:'Operating permit ref', icon:'fa-id-card', required:true },
        { name:'operatorPermitExpiresAt', label:'Permit expiry', type:'date', icon:'fa-calendar-xmark', required:true },
        { name:'inspectionRef', label:'Inspection ref', icon:'fa-screwdriver-wrench', required:true },
        { name:'inspectionExpiresAt', label:'Inspection expiry', type:'date', icon:'fa-calendar-xmark', required:true },
        { name:'insuranceRef', label:'Insurance ref', icon:'fa-shield-halved', required:true },
        { name:'insuranceExpiresAt', label:'Insurance expiry', type:'date', icon:'fa-calendar-xmark', required:true },
        { name:'imageFile', label:'Vehicle photo', type:'file', icon:'fa-image' },
        { name:'status', label:'Status', type:'select', icon:'fa-circle-check', options:['active','maintenance','paused','archived'], value:'active' },
        { name:'amenities', label:'Amenities', type:'multiselect', icon:'fa-wifi', options:busAmenityOptions, help:'Select all onboard amenities.' },
        { name:'documentReference', label:'Compliance document ref', icon:'fa-id-card', placeholder:'Permit or inspection reference' },
        { name:'maintenanceNote', label:'Maintenance note', type:'textarea', full:true, placeholder:'Maintenance/compliance note if any' }
      ]
    };
    if (isCompanyRole && key === 'schedule') return {
      action: '/company/schedules', submit: 'Create departure(s)',
      fields: [
        { type:'smart-summary', label:'Smart departure setup', help: hasActiveDriver ? 'Select a route. The matching bus, published seat map, active fare, currency, arrival, boarding time and saved driver are selected or calculated automatically where unambiguous.' : driverWorkflowHint },
        { name:'routeId', label:'Route', type:'select', icon:'fa-route', options:routes, required:true },
        { name:'vehicleId', label:'Vehicle', type:'select', icon:'fa-bus-simple', options:vehicles, required:true, dependsOn:'routeId', filterKey:'listingId', parentMetaKey:'listingId', help:'Automatically selected when only one eligible bus exists.' },
        { name:'departAt', label:'First departure time', type:'datetime-local', icon:'fa-calendar-days', required:true },
        { name:'arriveAt', label:'Arrival estimate', type:'datetime-local', icon:'fa-calendar-check' },
        { name:'fareProductId', label:'Fare plan', type:'select', icon:'fa-coins', options:fareProducts, required:true, dependsOn:'routeId', filterKey:'routeId', help:'Price, currency and policies are inherited from the selected route fare plan; they are never retyped into a departure.' },
        { name:'driverId', label:'Assigned driver', type:'select', icon:'fa-user-tie', options:drivers, required:false, help:driverWorkflowHint },
        { name:'boardingStartAt', label:'Boarding start time', type:'datetime-local', icon:'fa-clock' },
        { name:'status', label:'Initial status', type:'select', icon:'fa-circle-check', options:['published','draft'], value:hasAssignableDriver ? 'published' : 'draft', help:hasAssignableDriver ? 'Published is required for bus activation and public visibility. Only an approved operational driver can be selected.' : 'Approve a driver before publishing.' },
        { name:'blockedSeats', label:'Blocked seats for this departure', type:'multiselect', icon:'fa-ban', options:vehicleSeatOptions, dependsOn:'vehicleId', filterKey:'vehicleId', help:'Loads the actual published seat labels of the selected bus.' },
        { name:'repeatUntil', label:'Repeat daily until', type:'date', icon:'fa-repeat', help:'Optional. Create the same departure every day (at the time above) from the first departure through this date - set a month or more ahead to create a full month of trips in one click.' },
        { name:'repeatDays', label:'Only repeat on these days', type:'multiselect', icon:'fa-calendar-week', options:dayOptions, help:'Optional. Leave empty to repeat every day in the range above.' },
        { name:'notes', label:'Schedule notes', type:'textarea', full:true, placeholder:'Boarding instructions and internal notes' }
      ]
    };
    if (isCompanyRole && key === 'schedule rule') return {
      action: '/company/schedule-rules', submit: 'Create recurring departure',
      fields: [
        { type:'smart-summary', label:'Smart recurring schedule', help:'Route-linked bus, fare, timezone, duration and real seat labels are reused for every generated departure.' },
        { name:'routeId', label:'Route', type:'select', icon:'fa-route', options:routes, required:true },
        { name:'vehicleId', label:'Vehicle', type:'select', icon:'fa-bus-simple', options:vehicles, required:true, dependsOn:'routeId', filterKey:'listingId', parentMetaKey:'listingId', help:'Automatically selected when only one eligible bus exists.' },
        { name:'driverId', label:'Assigned driver', type:'select', icon:'fa-user-tie', options:drivers, required:false, help:driverWorkflowHint },
        { name:'status', label:'Rule status', type:'select', icon:'fa-circle-check', options:['active','draft','paused'], value:hasAssignableDriver ? 'active' : 'draft', help:hasAssignableDriver ? 'Active rules generate dated departures automatically. The assigned driver must remain verified and operational.' : 'Approve a driver before activating the recurring rule.' },
        { name:'departureTime', label:'Departure time (HH:MM, 24h)', icon:'fa-clock', required:true, placeholder:'08:00' },
        { name:'startDate', label:'Starts on', type:'date', icon:'fa-calendar-days', required:true },
        { name:'endDate', label:'Ends on (optional)', type:'date', icon:'fa-calendar-xmark', help:'Leave empty for an indefinite recurring departure.' },
        { name:'daysOfWeek', label:'Repeats on', type:'multiselect', icon:'fa-calendar-week', options:dayOptions, help:'Leave empty to repeat every day.' },
        { name:'fareProductId', label:'Fare plan', type:'select', icon:'fa-coins', options:fareProducts, required:true, dependsOn:'routeId', filterKey:'routeId' },
        { name:'blockedSeats', label:'Blocked seats', type:'multiselect', icon:'fa-ban', options:vehicleSeatOptions, dependsOn:'vehicleId', filterKey:'vehicleId', help:'Applied to every departure generated from this rule.' },
        { name:'notes', label:'Boarding notes', type:'textarea', full:true, placeholder:'Boarding instructions and internal notes' }
      ]
    };
    if (isCompanyRole && key === 'fare product') return {
      action: '/company/fares', submit: 'Create fare plan',
      fields: [
        { type:'smart-summary', label:'Smart fare setup', help:'Route, currency and full origin-to-destination segment are reused automatically. Enter only the commercial values and policy choices.' },
        { name:'routeId', label:'Route', type:'select', icon:'fa-route', options:routes, required:true },
        { name:'name', label:'Fare plan name', icon:'fa-tag', placeholder:'Generated from route and class' },
        { name:'fareClass', label:'Fare class', type:'select', icon:'fa-star', options:['standard','economy','business','executive','vip','premium','express'], value:'standard' },
        { name:'amount', label:'Full-route fare', type:'number', icon:'fa-coins', required:true, help:'Creates the initial origin-to-destination fare. Add partial-route fares separately when passengers may board or leave at intermediate stops.' },
        { name:'baggageAllowanceKg', label:'Included baggage KG', type:'number', icon:'fa-suitcase', value:'0' },
        { name:'refundable', label:'Refundable', type:'select', icon:'fa-rotate-left', options:['true','false'], value:'false' },
        { name:'changeable', label:'Changeable', type:'select', icon:'fa-calendar-pen', options:['true','false'], value:'false' },
        { name:'status', label:'Status', type:'select', icon:'fa-circle-check', options:['active','draft'], value:'active' }
      ]
    };
    if (isCompanyRole && key === 'segment fare') return {
      action: '/company/fare-segments', submit: 'Save stop-to-stop price',
      fields: [
        { type:'smart-summary', label:'Smart stop-to-stop price', help:'Only stops belonging to the selected route are shown, in route order. The drop-off must come after the boarding stop.' },
        { name:'fareProductId', label:'Fare plan', type:'select', icon:'fa-tag', options:fareProducts, required:true },
        { name:'fromStopId', label:'Boarding stop', type:'select', icon:'fa-location-dot', options:routeStops, required:true, dependsOn:'fareProductId', filterKey:'routeId', parentMetaKey:'routeId' },
        { name:'toStopId', label:'Drop-off stop', type:'select', icon:'fa-flag-checkered', options:routeStops, required:true, dependsOn:'fareProductId', filterKey:'routeId', parentMetaKey:'routeId' },
        { name:'amount', label:'Boarding-to-drop-off fare', type:'number', icon:'fa-coins', required:true, help:'Enter what one passenger pays between these two stops. Exact stop-pair prices take priority; otherwise connected configured fare ranges are combined.' },
        { name:'status', label:'Status', type:'select', icon:'fa-circle-check', options:['active','archived'], value:'active' }
      ]
    };

    if (isCompanyRole && (key === 'add-on' || key === 'service_addon')) {
      const addonId = detail?.serviceAddon?.id || detail?.id || '';
      const editing = mode === 'edit' && addonId;
      const hotelAddon = companyServiceType === 'hotel';
      const starterOptions = hotelAddon ? [
        {value:'',label:'Custom hotel extra'}, {value:'breakfast',label:'Breakfast'}, {value:'airport_transfer',label:'Airport transfer'}, {value:'parking',label:'Secure parking'}, {value:'late_checkout',label:'Late checkout'}, {value:'extra_bed',label:'Extra bed'}, {value:'spa_access',label:'Spa access'}, {value:'meal_plan',label:'Meal plan'}, {value:'room_upgrade_request',label:'Room upgrade request'}
      ] : [
        {value:'',label:'Custom add-on'}, {value:'extra_luggage',label:'Extra luggage'}, {value:'priority_boarding',label:'Priority boarding'}, {value:'sms_whatsapp_ticket',label:'SMS and WhatsApp ticket'}, {value:'travel_insurance',label:'Travel insurance'}, {value:'meal_pack',label:'Meal pack'}, {value:'lounge_access',label:'Terminal lounge access'}, {value:'flexible_change',label:'Flexible ticket change'}, {value:'premium_wifi',label:'Premium Wi-Fi'}
      ];
      const chargeOptions = hotelAddon ? [
        {value:'per_booking',label:'Once per stay'}, {value:'per_passenger',label:'For each guest'}, {value:'per_trip_leg',label:'For each room-night'}, {value:'per_passenger_per_leg',label:'For each guest-night'}
      ] : [
        {value:'per_booking',label:'Once per booking'}, {value:'per_passenger',label:'For each traveler'}, {value:'per_trip_leg',label:'For each trip leg'}, {value:'per_passenger_per_leg',label:'For each traveler on each leg'}
      ];
      const fields = [
        { type:'smart-summary', label: hotelAddon ? 'Guest-facing optional hotel extra' : 'Traveler-facing optional extra', help: hotelAddon ? 'Choose a hotel starter or create a custom extra. The partner enters the price; the server applies it by stay, guest, room-night, or guest-night.' : 'Choose a starter type or create a custom extra. The partner admin must enter the price; the server then applies it by booking, traveler, or trip leg.' },
        ...(!editing ? [{ name:'template', label:'Starter type', type:'select', icon:'fa-wand-magic-sparkles', options:starterOptions, help:'This fills only the name, description and charging method. Enter the price below.' }] : []),
        { name:'listingId', label: hotelAddon ? 'Hotel listing' : 'Bus listing', type:'select', icon:hotelAddon ? 'fa-hotel' : 'fa-bus', options:listings, required:true, value:fieldValue('serviceAddon.listingId','listingId') },
        { name:'name', label:'Add-on name', icon:'fa-tag', required:true, value:fieldValue('serviceAddon.name','name'), placeholder:hotelAddon ? 'Breakfast' : 'Extra luggage' },
        { name:'description', label:hotelAddon ? 'Guest description' : 'Traveler description', type:'textarea', full:true, value:fieldValue('serviceAddon.description','description'), placeholder:'Explain exactly what the customer receives.' },
        { name:'category', label:'Category', type:'select', icon:'fa-layer-group', options:['baggage','boarding','communication','comfort','meal','insurance','flexibility','accessibility','other'], value:fieldValue('serviceAddon.category','category') || 'other' },
        { name:'price', label:'Admin-entered unit price', type:'number', icon:'fa-coins', required:true, value:fieldValue('serviceAddon.price','price'), placeholder:'Enter amount', help:'Required. Currency is inherited from the selected listing; no preset price is selected for you.' },
        { name:'chargeBasis', label:'Charge this price', type:'select', icon:'fa-calculator', options:chargeOptions, value:fieldValue('serviceAddon.chargeBasis','chargeBasis') || 'per_booking' },
        { name:'sortOrder', label:'Display order', type:'number', icon:'fa-arrow-down-1-9', value:fieldValue('serviceAddon.sortOrder','sortOrder') || '0' },
        { name:'status', label:'Status', type:'select', icon:'fa-circle-check', options:['active','draft','paused','archived'], value:fieldValue('serviceAddon.status','status') || 'active' }
      ];
      if (!hotelAddon) fields.splice(fields.length - 2, 0, { name:'availableFor', label:'Available for', type:'select', icon:'fa-right-left', options:[{value:'all',label:'One-way and return'},{value:'one_way',label:'One-way bookings only'},{value:'round_trip',label:'Return bookings only'}], value:fieldValue('serviceAddon.availableFor','availableFor') || 'all' });
      return {
        action: editing ? `/company/addons/${encodeURIComponent(addonId)}` : '/company/addons',
        submit: editing ? 'Update optional extra' : 'Create optional extra',
        fields
      };
    }

    if (isCompanyRole && key === 'bus service') return {
      action: '/company/bus-services', submit: 'Create bus service',
      fields: [
        { type:'smart-summary', label:'Smart complete bus setup', help:'Create one connected service. Seat numbering, route stops/segments, fare linkage, arrival, boarding time and live inventory are generated from your selections.' },
        { name:'idempotencyKey', type:'hidden', value: `wizard-${Date.now()}-${Math.random().toString(36).slice(2)}` },
        { name:'listing[title]', label:'Listing title', icon:'fa-pen', required:true, placeholder:'Enter the listing title' },
        { name:'listing[branchId]', label:'Primary operating terminal', type:'select', icon:'fa-building', options:branches, required:true, help:'The public listing is owned by this operating terminal. Create terminals/branches first.' },
        { name:'listingImageFile', label:'Bus service image', type:'file', icon:'fa-image', required:true, help:'This becomes the public service image. Prices come only from the fare plan below.' },
        { name:'listing[contactPhone]', label:'Public operations phone', icon:'fa-phone', required:true, placeholder:'Enter phone number' },
        { name:'listing[operatorLicenceRef]', label:'Operator licence reference', icon:'fa-id-card', required:true, placeholder:'TSA/OP/2026/001' },
        { name:'listing[baggageRules]', label:'Baggage policy', type:'textarea', full:true, required:true, placeholder:'Included weight, excess baggage rules, restricted items and claim process.' },
        { name:'listing[cancellationRules]', label:'Cancellation and change policy', type:'textarea', full:true, required:true, placeholder:'Refund deadlines, fees, no-show rules and rescheduling conditions.' },
        { name:'listing[status]', label:'Publish immediately?', type:'select', icon:'fa-circle-check', options:['active','draft'], value:hasActiveDriver ? 'active' : 'draft', help:hasActiveDriver ? 'Active publishes only after every readiness and safety check passes.' : 'No selectable driver exists yet, so the complete setup will be saved safely as Draft.' },
        { name:'vehicle[name]', label:'Vehicle name', icon:'fa-bus-simple', required:true, placeholder:'Bus 01' },
        { name:'vehicle[plateOrCode]', label:'Plate / code', icon:'fa-hashtag', required:true, placeholder:'UAX 000A' },
        { name:'vehicleImageFile', label:'Vehicle photo', type:'file', icon:'fa-camera', required:true },
        { name:'vehicle[layoutName]', label:'Seat layout', type:'select', icon:'fa-chair', options:['1x1','1x2','2x1','2x2','2x3','3x2','3x3','sleeper','custom'], value:'2x2' },
        { name:'vehicle[seatLabelMode]', type:'hidden', value:'automatic' },
        { name:'vehicle[rows]', label:'Rows', type:'number', icon:'fa-grip', placeholder:'12' },
        { name:'vehicle[totalSeats]', label:'Capacity / seats', type:'number', icon:'fa-users', required:true, value:'48' },
        { name:'vehicle[amenities]', label:'Onboard amenities', type:'multiselect', icon:'fa-wifi', options:busAmenityOptions, help:'Select all onboard amenities.' },
        { name:'vehicle[operatorPermitRef]', label:'Vehicle operator permit', icon:'fa-file-shield', required:true, placeholder:'PERMIT-001' },
        { name:'vehicle[operatorPermitExpiresAt]', label:'Permit expiry', type:'date', icon:'fa-calendar-xmark', required:true },
        { name:'vehicle[inspectionRef]', label:'Inspection reference', icon:'fa-screwdriver-wrench', required:true, placeholder:'INSPECT-001' },
        { name:'vehicle[inspectionExpiresAt]', label:'Inspection expiry', type:'date', icon:'fa-calendar-xmark', required:true },
        { name:'vehicle[insuranceRef]', label:'Insurance reference', icon:'fa-shield-halved', required:true, placeholder:'POLICY-001' },
        { name:'vehicle[insuranceExpiresAt]', label:'Insurance expiry', type:'date', icon:'fa-calendar-xmark', required:true },
        { name:'route[routeName]', label:'Route name', icon:'fa-route', placeholder:'Kampala to Mbarara' },
        { name:'route[originBranchId]', label:'Origin terminal / branch', type:'select', icon:'fa-location-dot', options:branches, required:true, help:'The origin name and city are derived from this record.' },
        { name:'route[destinationBranchId]', label:'Destination terminal / branch', type:'select', icon:'fa-location-dot', options:branches, required:true, help:'Must be different from the origin.' },
        { name:'route[boardingBranchIds]', label:'Additional boarding points', type:'multiselect', icon:'fa-map-pin', options:branches, help:'Select existing company branches. The origin is added automatically.' },
        { name:'route[dropoffBranchIds]', label:'Additional drop-off points', type:'multiselect', icon:'fa-map-pin', options:branches, help:'Select existing company branches. The destination is added automatically.' },
        { name:'route[distanceKm]', label:'Distance KM', type:'number', icon:'fa-road', placeholder:'270' },
        { name:'route[estimatedDuration]', label:'Estimated duration', icon:'fa-clock', placeholder:'5h' },
        { name:'route[operatingDays]', label:'Operating days', type:'multiselect', icon:'fa-calendar-week', options:dayOptions, help:'Pick all days this route normally runs.' },
        { name:'schedule[departAt]', label:'First departure time', type:'datetime-local', icon:'fa-calendar-days', required:true },
        { name:'schedule[arriveAt]', label:'Arrival estimate', type:'datetime-local', icon:'fa-calendar-check' },
        { name:'schedule[boardingStartAt]', label:'Boarding start time', type:'datetime-local', icon:'fa-clock' },
        { name:'fare[name]', label:'Fare plan name', icon:'fa-tag', placeholder:'Generated from route and class' },
        { name:'fare[amount]', label:'Full-route fare', type:'number', icon:'fa-coins', required:true, placeholder:'45000' },
        { name:'fare[baggageAllowanceKg]', label:'Included baggage KG', type:'number', icon:'fa-suitcase', value:'0' },
        { name:'fare[refundable]', label:'Refundable', type:'select', icon:'fa-rotate-left', options:['true','false'], value:'false' },
        { name:'fare[changeable]', label:'Changeable', type:'select', icon:'fa-calendar-pen', options:['true','false'], value:'false' },
        { name:'schedule[driverId]', label:'Assigned driver', type:'select', icon:'fa-user-tie', options:drivers, required:false, help:driverWorkflowHint },
        { name:'fare[fareClass]', label:'Fare class', type:'select', icon:'fa-tag', options:['standard','economy','business','executive','vip','premium'] },
        { name:'schedule[status]', label:'Departure status', type:'select', icon:'fa-circle-check', options:['published','draft'], value:hasActiveDriver ? 'published' : 'draft', help:hasActiveDriver ? 'Published is required before the bus listing can be activated.' : 'Draft saves the complete connected setup now; select an approved driver and publish later.' },
        { name:'schedule[notes]', label:'Boarding notes', type:'textarea', full:true, placeholder:'Boarding instructions and internal notes' }
      ]
    };
    if (isCompanyRole && key === 'room type') return {
      action: '/company/hotels/room-types', submit: 'Create room type',
      fields: [
        { name:'listingId', label:'Hotel listing', type:'select', icon:'fa-hotel', options:listings, required:true },
        { name:'propertyId', label:'Hotel property', type:'select', icon:'fa-building', options:hotelProperties, required:true, dependsOn:'listingId', filterKey:'listingId', help:'Only properties linked to the selected hotel listing are shown.' },
        { name:'name', label:'Room type', icon:'fa-bed', required:true, placeholder:'Deluxe Double' },
        { name:'capacity', label:'Total guest capacity', type:'number', icon:'fa-users', required:true, placeholder:'2' },
        { name:'maxAdults', label:'Maximum adults', type:'number', icon:'fa-user-group', required:true, placeholder:'2' },
        { name:'maxChildren', label:'Maximum children', type:'number', icon:'fa-child', value:'0' },
        { name:'maxInfants', label:'Maximum infants', type:'number', icon:'fa-baby', value:'0' },
        { name:'basePrice', label:'Base nightly price', type:'number', icon:'fa-coins', required:true, placeholder:'180000' },
        { name:'defaultInventory', label:'Initial physical room units', type:'number', icon:'fa-door-open', placeholder:'10' },
        { name:'unitPrefix', label:'Generated unit prefix', icon:'fa-hashtag', placeholder:'DLX' },
        { name:'floor', label:'Default floor', icon:'fa-layer-group', placeholder:'1' },
        { name:'bedType', label:'Primary bed type', type:'select', icon:'fa-bed', options:['single','double','twin','queen','king','family','suite'] },
        { name:'singleBeds', label:'Single beds', type:'number', icon:'fa-bed', value:'0' },
        { name:'doubleBeds', label:'Double beds', type:'number', icon:'fa-bed', value:'1' },
        { name:'sofaBeds', label:'Sofa beds', type:'number', icon:'fa-couch', value:'0' },
        { name:'sizeSqm', label:'Room size (m²)', type:'number', icon:'fa-ruler-combined', value:'0' },
        { name:'mealPlan', label:'Default meal plan', type:'select', icon:'fa-utensils', options:['room_only','breakfast','half_board','full_board','all_inclusive'], value:'room_only' },
        { name:'extraAdultFee', label:'Extra adult fee', type:'number', icon:'fa-user-plus', value:'0' },
        { name:'extraChildFee', label:'Extra child fee', type:'number', icon:'fa-child-reaching', value:'0' },
        { name:'minStay', label:'Minimum stay', type:'number', icon:'fa-calendar-minus', value:'1' },
        { name:'maxStay', label:'Maximum stay', type:'number', icon:'fa-calendar-plus', value:'90' },
        { name:'status', label:'Status', type:'select', icon:'fa-circle-check', options:['active','paused'], value:'active' },
        { name:'amenities', label:'Amenities', type:'multiselect', icon:'fa-wifi', options:hotelAmenityOptions },
        { name:'accessibilityFeatures', label:'Accessibility', type:'multiselect', icon:'fa-wheelchair', options:['step_free_access','accessible_bathroom','grab_rails','visual_alerts','hearing_support'] },
        { name:'policies', label:'Room policies', type:'textarea', full:true, placeholder:'Bedding, extra guest, children and room-specific rules' }
      ]
    };
    if (isCompanyRole && key === 'room units') return {
      action: '/company/hotels/room-units', submit: 'Add room units',
      fields: [
        { name:'roomTypeId', label:'Room type', type:'select', icon:'fa-bed', options:roomTypes, required:true, value: fieldValue('roomType.id','roomTypeId') || recordId },
        { name:'unitNumbers', label:'Room numbers', icon:'fa-door-open', required:true, placeholder:'101,102,103' },
        { name:'floor', label:'Floor', icon:'fa-layer-group', placeholder:'1' },
        { name:'wing', label:'Wing / block', icon:'fa-building', placeholder:'North wing' },
        { name:'status', label:'Initial room status', type:'select', icon:'fa-circle-check', options:['available','maintenance','cleaning'] },
        { name:'housekeepingStatus', label:'Housekeeping', type:'select', icon:'fa-broom', options:['clean','dirty','cleaning','inspected','ready','maintenance'] },
        { name:'viewType', label:'View / outlook', icon:'fa-binoculars', placeholder:'City, garden, lake, courtyard...' },
        { name:'accessible', label:'Accessible room', type:'select', icon:'fa-wheelchair', options:['false','true'], value:'false' },
        { name:'smokingAllowed', label:'Smoking allowed', type:'select', icon:'fa-smoking', options:['false','true'], value:'false' },
        { name:'connectingRoom', label:'Connecting room', type:'select', icon:'fa-link', options:['false','true'], value:'false' },
        { name:'notes', label:'Notes', type:'textarea', full:true, placeholder:'Internal room-unit notes' }
      ]
    };
    if (isCompanyRole && key === 'room night inventory') return {
      action: '/company/hotels/inventory', submit: 'Create room-night inventory',
      fields: [
        { name:'roomTypeId', label:'Room type', type:'select', icon:'fa-bed', options:roomTypes, required:true, value: fieldValue('roomType.id','roomTypeId') || recordId },
        { name:'roomUnitIds', label:'Room units', type:'multiselect', icon:'fa-door-open', options:roomUnits, dependsOn:'roomTypeId', filterKey:'roomTypeId', help:'Only units belonging to the selected room type are shown.' },
        { name:'ratePlanId', label:'Rate plan', type:'select', icon:'fa-tags', options:ratePlans, dependsOn:'roomTypeId', filterKey:'roomTypeId', help:'Optional. Defaults to the room type’s active plan.' },
        { name:'startDate', label:'Start date', type:'date', icon:'fa-calendar-days', required:true },
        { name:'endDate', label:'End date', type:'date', icon:'fa-calendar-check', required:true },
        { name:'price', label:'Night price override', type:'number', icon:'fa-coins', placeholder:'180000' },
        { name:'minStay', label:'Minimum stay', type:'number', icon:'fa-calendar-minus', value:'1' },
        { name:'maxStay', label:'Maximum stay', type:'number', icon:'fa-calendar-plus', value:'90' },
        { name:'closedToArrival', label:'Closed to arrival', type:'select', icon:'fa-door-closed', options:['false','true'], value:'false' },
        { name:'closedToDeparture', label:'Closed to departure', type:'select', icon:'fa-door-closed', options:['false','true'], value:'false' },
        { name:'status', label:'Initial status', type:'select', icon:'fa-circle-check', options:['available','open','maintenance','cleaning'], value:'available' },
        { name:'notes', label:'Inventory notes', type:'textarea', full:true, placeholder:'Seasonal price, blackout reason, promo note...' }
      ]
    };

    if (isCompanyRole && key === 'hotel property') return {
      action: '/company/hotels/properties', submit: 'Add hotel property',
      fields: [
        { type:'smart-summary', label:'Connected hotel property', help:'Select the existing public hotel listing; the property profile becomes the operational source for rooms, policies, taxes, guest manifests and availability.' },
        { name:'listingId', label:'Hotel listing', type:'select', icon:'fa-hotel', options:listings, required:true },
        { name:'propertyName', label:'Property name', icon:'fa-hotel', required:true, placeholder:'Classic City Hotel' },
        { name:'propertyType', label:'Property type', type:'select', icon:'fa-building', options:['hotel','lodge','resort','guest_house','serviced_apartment','hostel','camp'], value:'hotel' },
        { name:'category', label:'Category', type:'select', icon:'fa-star', options:['unrated','budget','standard','premium','luxury'], value:'unrated' },
        { name:'starRating', label:'Star rating', type:'number', icon:'fa-star', value:'0' },
        { name:'city', label:'City', icon:'fa-location-dot', required:true, placeholder:'Kampala' },
        { name:'country', label:'Country', icon:'fa-earth-africa', required:true, value:data.company?.country || '' },
        { name:'timezone', label:'Timezone', icon:'fa-globe', value:data.company?.timezone || 'Africa/Kampala' },
        { name:'address', label:'Address', icon:'fa-map-pin', required:true, placeholder:'Plot 1, City Center' },
        { name:'mapLocation', label:'Map location / GPS', icon:'fa-map-location-dot', placeholder:'0.3476,32.5825' },
        { name:'contactEmail', label:'Property email', type:'email', icon:'fa-envelope' },
        { name:'contactPhone', label:'Property phone', icon:'fa-phone' },
        { name:'checkInTime', label:'Check-in time', type:'time', icon:'fa-clock', value:'14:00' },
        { name:'checkOutTime', label:'Check-out time', type:'time', icon:'fa-clock', value:'11:00' },
        { name:'taxPercent', label:'Tax percentage', type:'number', icon:'fa-receipt', value:'0' },
        { name:'serviceFeePercent', label:'Service fee percentage', type:'number', icon:'fa-percent', value:'0' },
        { name:'status', label:'Status', type:'select', icon:'fa-circle-check', options:['active','paused'], value:'active' },
        { name:'amenities', label:'Amenities', type:'multiselect', icon:'fa-wifi', options:hotelAmenityOptions },
        { name:'accessibilityFeatures', label:'Accessibility', type:'multiselect', icon:'fa-wheelchair', options:['step_free_access','accessible_room','accessible_bathroom','lift','visual_alerts','hearing_support','accessible_parking'] },
        { name:'childPolicy', label:'Child policy', type:'textarea', full:true },
        { name:'petPolicy', label:'Pet policy', type:'textarea', full:true },
        { name:'smokingPolicy', label:'Smoking policy', type:'textarea', full:true },
        { name:'paymentPolicy', label:'Payment policy', type:'textarea', full:true },
        { name:'depositPolicy', label:'Security / incidental policy', type:'textarea', full:true, help:'Describe refundable key, damage or incidental rules only. Booking payment remains pay-now.' },
        { name:'houseRules', label:'House rules', type:'textarea', full:true },
        { name:'policies', label:'Other policies', type:'textarea', full:true }
      ]
    };
    if (isCompanyRole && key === 'rate plan') return {
      action: '/company/hotels/rate-plans', submit: 'Add rate plan',
      fields: [
        { type:'smart-summary', label:'Bookable rate plan', help:'Select a room type. Cancellation, payment, meal, occupancy and stay-limit rules are validated and frozen into every reservation.' },
        { name:'roomTypeId', label:'Room type', type:'select', icon:'fa-bed', options:roomTypes, required:true },
        { name:'name', label:'Rate plan name', icon:'fa-tags', required:true, placeholder:'Flexible with breakfast' },
        { name:'code', label:'Rate code', icon:'fa-hashtag', placeholder:'FLEX_BREAKFAST' },
        { name:'pricingMode', label:'Pricing source', type:'select', icon:'fa-coins', options:[{value:'nightly_inventory',label:'Room-night calendar price'},{value:'fixed',label:'Fixed plan price'}], value:'nightly_inventory' },
        { name:'basePrice', label:'Base price', type:'number', icon:'fa-coins', value:'0' },
        { name:'mealPlan', label:'Meal plan', type:'select', icon:'fa-utensils', options:['room_only','breakfast','half_board','full_board','all_inclusive'], value:'room_only' },
        { name:'refundable', label:'Refundable', type:'select', icon:'fa-rotate-left', options:['true','false'], value:'true' },
        { name:'cancellationDeadlineHours', label:'Free-cancellation deadline (hours)', type:'number', icon:'fa-clock', value:'24' },
        { name:'cancellationPenaltyType', label:'Cancellation penalty', type:'select', icon:'fa-ban', options:['none','first_night','percentage','full_stay'], value:'first_night' },
        { name:'cancellationPenaltyValue', label:'Penalty value', type:'number', icon:'fa-percent', value:'0' },
        { name:'paymentTiming', label:'Payment timing', type:'select', icon:'fa-credit-card', options:['pay_now'], value:'pay_now', help:'Hotel bookings are confirmed only through the platform payment flow.' },
        { name:'minStay', label:'Minimum stay', type:'number', icon:'fa-calendar-minus', value:'1' },
        { name:'maxStay', label:'Maximum stay', type:'number', icon:'fa-calendar-plus', value:'90' },
        { name:'includedAdults', label:'Included adults', type:'number', icon:'fa-user-group', value:'1' },
        { name:'includedChildren', label:'Included children', type:'number', icon:'fa-child', value:'0' },
        { name:'extraAdultFee', label:'Extra adult fee', type:'number', icon:'fa-user-plus', value:'0' },
        { name:'extraChildFee', label:'Extra child fee', type:'number', icon:'fa-child-reaching', value:'0' },
        { name:'status', label:'Status', type:'select', icon:'fa-circle-check', options:['active','paused'], value:'active' }
      ]
    };


    if (isCompanyRole && key === 'profile') return {
      action: '/company/settings', submit: 'Save company profile',
      fields: [
        { name:'name', label:'Trading / brand name', icon:'fa-building', required:true, value: data.company?.name || '' },
        { name:'legalName', label:'Registered legal name', icon:'fa-file-signature', value: data.company?.legalName || data.company?.name || '', help:'Must match the business registration document.' },
        { name:'registrationNumber', label:'Registration number', icon:'fa-hashtag', value: data.company?.registrationNumber || '' },
        { name:'taxNumber', label:'Tax / TIN number', icon:'fa-receipt', value: data.company?.taxNumber || '' },
        { name:'headOfficeAddress', label:'Head-office address', icon:'fa-map-pin', value: data.company?.headOfficeAddress || '' },
        { name:'website', label:'Website', type:'url', icon:'fa-globe', value: data.company?.website || '' },
        { name:'city', label:'Head-office city', icon:'fa-location-dot', value: data.company?.city || '' },
        { name:'country', label:'Country', type:'select', icon:'fa-earth-africa', options:['Uganda','Kenya','Rwanda','Tanzania','South Sudan','DR Congo'], value: data.company?.country || '', required:true },
        { name:'ownerEmail', label:'Owner login email', type:'email', icon:'fa-user-shield', required:true, value: data.company?.ownerEmail || '', help:'Changing this email requires fresh email verification.' },
        { name:'ownerPhone', label:'Owner verified phone', icon:'fa-mobile-screen', required:true, value: data.company?.ownerPhone || '', help:'Changing this phone sends a new six-digit verification code.' },
        { name:'supportEmail', label:'Support email', type:'email', icon:'fa-envelope', value: data.company?.supportEmail || '' },
        { name:'supportPhone', label:'Support phone', icon:'fa-phone', value: data.company?.supportPhone || '' },
        { name:'payoutAccount', label:'Payout account', icon:'fa-building-columns', value: data.company?.payoutAccount || '' },
        { name:'description', label:'Public description', type:'textarea', full:true, value: data.company?.description || '' }
      ]
    };
    if (isCompanyRole && (key === 'staff' || key === 'hotel staff')) return {
      action: '/company/employees/invite', submit: key === 'hotel staff' ? 'Invite hotel staff' : 'Invite staff',
      fields: [
        { name:'fullName', label:'Full name', icon:'fa-user', required:true, placeholder:'Staff name' },
        { name:'email', label:'Email', type:'email', icon:'fa-envelope', required:true, placeholder:'staff@example.com' },
        { name:'phone', label:'Phone', icon:'fa-phone', placeholder:'Enter phone number' },
        { name:'roleTitle', label:'Role title', type:'select', icon:'fa-user-tie', options: companyServiceType === 'hotel' ? ['Front Desk','Housekeeping','Hotel Manager','Inventory Manager','Finance','Support','Report Viewer'] : ['Scanner','Route Manager','Inventory Manager','Finance','Support','Report Viewer'], required:true },
        { name:'branchId', label:'Branch / terminal / property desk', type:'select', icon:'fa-location-dot', options:branches, help:'This controls the staff member’s operating location.' },
        { name:'listingIds', label:'Assigned listings', type:'multiselect', icon:'fa-layer-group', options:listings, help:'Optional. Select only the public services this staff member may work with.' },
        { name:'scheduleIds', label:'Assigned schedules / departures', type:'multiselect', icon:'fa-calendar-days', options:schedules, help:'Optional. Selected schedules must belong to the selected listings and this company.' },
        { name:'permissions', label:'Permissions', type:'multiselect', icon:'fa-key', options: companyServiceType === 'hotel' ? [{value:'booking.view',label:'View reservations'},{value:'booking.create_manual',label:'Create front-desk bookings'},{value:'checkin.manage',label:'Check guests in/out'},{value:'checkin.no_show',label:'Mark hotel no-show'},{value:'manifest.view',label:'View hotel manifests'},{value:'inventory.update',label:'Room inventory / housekeeping'},{value:'payment.record',label:'Record payments'},{value:'refund.request',label:'Request refunds'},{value:'support.manage',label:'Manage guest support'},{value:'customer.note',label:'Add guest notes'},{value:'handover.create',label:'Create shift handovers'},{value:'reports.view',label:'View reports'},{value:'profile.update',label:'Update own profile'}] : [{value:'booking.view',label:'View bookings'},{value:'booking.create_manual',label:'Create counter bookings'},{value:'checkin.scan',label:'Scan tickets'},{value:'checkin.manage',label:'Check in passengers'},{value:'checkin.no_show',label:'Mark no-show'},{value:'manifest.view',label:'View manifests'},{value:'inventory.update',label:'Update seat inventory'},{value:'schedule.update',label:'Manage routes and schedules'},{value:'schedule.delay_notice',label:'Send delay notices'},{value:'payment.record',label:'Record payments'},{value:'refund.request',label:'Request refunds'},{value:'support.manage',label:'Manage support'},{value:'customer.note',label:'Add customer notes'},{value:'handover.create',label:'Create shift handovers'},{value:'reports.view',label:'View reports'},{value:'profile.update',label:'Update own profile'}] },
      ]
    };
    if (isCompanyRole && key === 'driver') return {
      action: '/company/driver-requests', submit: 'Add and invite driver',
      fields: [
        { name:'fullName', label:'Driver name', icon:'fa-user-tie', required:true, placeholder:'Driver full name' },
        { name:'email', label:'Driver email', type:'email', icon:'fa-envelope', required:true, placeholder:'driver@example.com', help:'A signed invitation and account setup link will be sent to this address.' },
        { name:'phone', label:'Driver phone', icon:'fa-phone', required:true, placeholder:'Enter phone number' },
        { name:'licenseNumber', label:'License number', icon:'fa-id-card', placeholder:'DL-0000' },
        { name:'licenseClass', label:'License class', type:'select', icon:'fa-id-card', options:['A','B','C','D','E','F','G','H'] },
        { name:'vehicleId', label:'Assigned vehicle (optional)', type:'select', icon:'fa-bus-simple', options:vehicles, help:'Select an existing vehicle owned by this company. Trip-specific assignment is completed in Driver Assignment.' },
        { name:'scheduleId', label:'Preferred schedule', type:'select', icon:'fa-calendar-days', options:schedules },
        { name:'note', label:'Internal note', type:'textarea', full:true, placeholder:'Optional note for this company driver' }
      ]
    };
    if (isCompanyRole && mode === 'edit' && key === 'staff status') return {
      action: `/company/staff/${encodeURIComponent(recordId)}/role`, submit: 'Save employee access',
      fields: [
        { type:'smart-summary', label:'Partner Admin employee control', help:'Super Admin approves the partner company only. The Partner Admin activates, suspends, scopes, and assigns permissions to company employees.' },
        { name:'roleTitle', label:'Role title', type:'select', icon:'fa-user-tie', options: companyServiceType === 'hotel' ? ['Front Desk','Housekeeping','Hotel Manager','Inventory Manager','Finance','Support','Report Viewer'] : ['Scanner','Route Manager','Inventory Manager','Finance','Support','Report Viewer'], required:true, value:fieldValue('staff.roleTitle') },
        { name:'status', label:'Employee status', type:'select', icon:'fa-circle-check', options:['active','pending_verification','invited','requested','suspended','rejected','revoked'], required:true, value:fieldValue('staff.status') || 'active' },
        { name:'branchId', label:'Branch / terminal / property desk', type:'select', icon:'fa-location-dot', options:branches, value:fieldValue('staff.branchId') },
        { name:'listingIds', label:'Assigned listings', type:'multiselect', icon:'fa-layer-group', options:listings, value:fieldValue('staff.listingIds') },
        { name:'scheduleIds', label:'Assigned schedules / departures', type:'multiselect', icon:'fa-calendar-days', options:schedules, value:fieldValue('staff.scheduleIds') },
        { name:'permissions', label:'Permissions', type:'multiselect', icon:'fa-key', options: companyServiceType === 'hotel' ? [{value:'booking.view',label:'View reservations'},{value:'booking.create_manual',label:'Create front-desk bookings'},{value:'checkin.manage',label:'Check guests in/out'},{value:'checkin.no_show',label:'Mark hotel no-show'},{value:'manifest.view',label:'View hotel manifests'},{value:'inventory.update',label:'Room inventory / housekeeping'},{value:'payment.record',label:'Record payments'},{value:'refund.request',label:'Request refunds'},{value:'support.manage',label:'Manage guest support'},{value:'customer.note',label:'Add guest notes'},{value:'handover.create',label:'Create shift handovers'},{value:'reports.view',label:'View reports'},{value:'profile.update',label:'Update own profile'}] : [{value:'booking.view',label:'View bookings'},{value:'booking.create_manual',label:'Create counter bookings'},{value:'checkin.scan',label:'Scan tickets'},{value:'checkin.manage',label:'Check in passengers'},{value:'checkin.no_show',label:'Mark no-show'},{value:'manifest.view',label:'View manifests'},{value:'inventory.update',label:'Update seat inventory'},{value:'schedule.update',label:'Manage routes and schedules'},{value:'schedule.delay_notice',label:'Send delay notices'},{value:'payment.record',label:'Record payments'},{value:'refund.request',label:'Request refunds'},{value:'support.manage',label:'Manage support'},{value:'customer.note',label:'Add customer notes'},{value:'handover.create',label:'Create shift handovers'},{value:'reports.view',label:'View reports'},{value:'profile.update',label:'Update own profile'}], value:fieldValue('staff.permissions') },
      ]
    };
    if (isCompanyRole && mode === 'edit' && key === 'driver activation') return {
      action: `/company/drivers/${encodeURIComponent(recordId)}/activate`, submit: 'Activate driver',
      fields: [
        { type:'smart-summary', label:'Partner Admin driver management', help:'Super Admin approves only the partner company. Partner Admin controls this driver’s status, permissions, licence details, and assignments. Account setup may continue separately.' },
        { name:'licenseNumber', label:'Driver licence number', icon:'fa-id-card', required:false, value: fieldValue('driver.licenseNumber','invitation.licenseNumber') },
        { name:'licenseClass', label:'Licence class', type:'select', icon:'fa-id-card', options:['A','B','C','D','E','F','G','H'], value: fieldValue('driver.licenseClass','invitation.licenseClass') },
        { name:'licenseExpiresAt', label:'Licence expiry date', type:'date', icon:'fa-calendar-check', value: fieldValue('driver.licenseExpiresAt') },
        { name:'documentReference', label:'Licence document reference', icon:'fa-file-shield', value: fieldValue('partnerActivation.licenseDocumentReference'), help:'Leave unchanged when the driver already uploaded a licence document.' },
        { name:'status', label:'Driver status', type:'select', icon:'fa-circle-check', options:['active','pending_verification','invited','requested','suspended'], required:true, value:fieldValue('driver.status','active') || 'active' },
        { name:'safetyStatus', label:'Safety status', type:'select', icon:'fa-shield-halved', options:['cleared','pending_review','not_submitted','rejected'], required:true, value:fieldValue('driver.safetyStatus','cleared') || 'cleared' },
        { name:'note', label:'Approval note', type:'textarea', full:true, placeholder:'Optional internal approval note' }
      ]
    };
    if (isCompanyRole && key === 'branch') return {
      action: '/company/branches', submit: companyServiceType === 'hotel' ? 'Add hotel branch/property desk' : 'Add branch / terminal',
      fields: [
        { name:'name', label:'Name', icon:'fa-building', required:true, placeholder: companyServiceType === 'hotel' ? 'Front desk / branch' : 'Terminal / branch' },
        { name:'branchType', label:'Type', type:'select', icon:'fa-layer-group', options: companyServiceType === 'hotel' ? ['property','front_desk','office','branch'] : ['terminal','branch','pickup_point','dropoff_point','office'] },
        { name:'terminalCode', label:'Short code', icon:'fa-hashtag', placeholder: companyServiceType === 'hotel' ? 'KLA-FD' : 'KLA-01' },
        ...(companyServiceType === 'hotel' ? [{ name:'city', label:'City', icon:'fa-location-dot', placeholder:'Enter the property city' }] : []),
        { name:'address', label:'Address', icon:'fa-map-pin', placeholder:'Street / terminal address' },
        { name:'contactPhone', label:'Contact phone', icon:'fa-phone' },
        { name:'operatingHours', label:'Operating hours', icon:'fa-clock', placeholder:'08:00 - 18:00' },
        { name:'status', label:'Status', type:'select', icon:'fa-circle-check', options:['active','paused','archived'], value:'active' }
      ]
    };
    if (isCompanyRole && key === 'policy') return {
      action: '/company/policies', submit: 'Add policy',
      fields: [
        { name:'title', label:'Policy title', icon:'fa-file-lines', required:true, placeholder: companyServiceType === 'hotel' ? 'Hotel cancellation policy' : 'Passenger baggage policy' },
        { name:'policyType', label:'Policy type', type:'select', icon:'fa-list-check', options: companyServiceType === 'hotel' ? ['cancellation','refund','check_in','check_out','housekeeping','support'] : ['cancellation','refund','baggage','boarding','no_show','support'] },
        { name:'serviceType', type:'hidden', value: companyServiceType },
        { name:'customerVisible', label:'Customer visible', type:'select', icon:'fa-eye', options:['true','false'], value:'false' },
        { name:'branchIds', label:'Applies to branches / terminals / property desks', type:'multiselect', icon:'fa-building', options:branches, help:'Leave empty to apply company-wide.' },
        { name:'status', label:'Status', type:'select', icon:'fa-circle-check', options:['active','paused','archived'], value:'active' },
        { name:'summary', label:'Policy summary', type:'textarea', full:true, required:true, placeholder:'Write the policy that staff and customers should follow' }
      ]
    };
    if (isCompanyRole && key === 'seat map') return {
      action: '/company/seats/status', submit: 'Update seat status',
      fields: [
        { name:'scheduleId', label:'Schedule', type:'select', icon:'fa-calendar-days', options:schedules, required:true },
        { name:'seatNumber', label:'Seat No', type:'select', icon:'fa-chair', options:seatOptions, required:true, dependsOn:'scheduleId', filterKey:'scheduleId', placeholder:'1' },
        { name:'status', label:'Status', type:'select', icon:'fa-circle-check', options:['available','blocked','maintenance','reserved','disabled'], required:true },
        { name:'priceDelta', label:'Price delta', type:'number', icon:'fa-coins', placeholder:'0' },
        { name:'blockedReason', label:'Reason / note', type:'textarea', full:true, placeholder:'Reason for blocked or maintenance seat' }
      ]
    };
    if (isCompanyRole && key === 'payout') return {
      action: '/company/payouts', submit: 'Request payout',
      fields: [
        { name:'amount', label:'Amount', type:'number', icon:'fa-coins', required:true, placeholder:'500000' },
        { name:'payoutAccount', label:'Payout account', icon:'fa-building-columns', placeholder:'Bank/MoMo account reference' },
        { name:'note', label:'Finance note', type:'textarea', full:true, placeholder:'Optional payout request note' }
      ]
    };
    if (isCompanyRole && (key === 'notice' || key === 'support notice')) return {
      action: '/company/support/notices', submit: 'Create support notice',
      fields: [
        { name:'audience', label:'Audience', type:'select', icon:'fa-users', options:['customers','employees','support','internal'] },
        { name:'priority', label:'Priority', type:'select', icon:'fa-flag', options:['normal','high','urgent'] },
        { name:'subject', label:'Subject', icon:'fa-heading', required:true, placeholder:'Schedule update' },
        { name:'message', label:'Message', type:'textarea', full:true, required:true, placeholder:'Write notice message...' }
      ]
    };

    if (currentRole === 'promoter' && key === 'offline sale') return {
      action: '/promoter/offline-sales', submit: 'Issue canonical cash booking',
      fields: [
        { type:'smart-summary', label:'Verified offline sale', help:'Choose live inventory already linked to your promoter account. The server recalculates the total, creates the canonical reservation and ticket/voucher, and records cash only after validation.' },
        { name:'listingId', label:'Linked bus or hotel listing', type:'select', icon:'fa-layer-group', options:listings, required:true, help:'Only active listings represented by your referral links are available.' },
        { name:'scheduleId', label:'Outbound departure', type:'select', icon:'fa-calendar-days', options:schedules, required:true, dependsOn:'listingId', filterKey:'listingId', showFor:'bus' },
        { name:'originStopId', label:'Boarding stop', type:'select', icon:'fa-person-walking-luggage', options:routeStops, required:true, dependsOn:'scheduleId', filterKey:'routeId', parentMetaKey:'routeId', showFor:'bus' },
        { name:'destinationStopId', label:'Drop-off stop', type:'select', icon:'fa-location-dot', options:routeStops, required:true, dependsOn:'scheduleId', filterKey:'routeId', parentMetaKey:'routeId', showFor:'bus' },
        { name:'selectedSeats', label:'Outbound seats', type:'multiselect', icon:'fa-chair', options:seatOptions, required:true, dependsOn:'scheduleId', filterKey:'scheduleId', showFor:'bus', help:'Choose one live seat for every passenger. Segment availability is checked again by the server.' },
        { name:'returnScheduleId', label:'Return departure', type:'select', icon:'fa-rotate', options:schedules, dependsOn:'listingId', filterKey:'listingId', showFor:'bus', help:'Optional. The return must reverse the outbound journey and depart after arrival.' },
        { name:'returnOriginStopId', label:'Return boarding stop', type:'select', icon:'fa-person-walking-luggage', options:routeStops, dependsOn:'returnScheduleId', filterKey:'routeId', parentMetaKey:'routeId', showFor:'bus' },
        { name:'returnDestinationStopId', label:'Return drop-off stop', type:'select', icon:'fa-location-dot', options:routeStops, dependsOn:'returnScheduleId', filterKey:'routeId', parentMetaKey:'routeId', showFor:'bus' },
        { name:'returnSeats', label:'Return seats', type:'multiselect', icon:'fa-chair', options:seatOptions, dependsOn:'returnScheduleId', filterKey:'scheduleId', showFor:'bus' },
        { name:'passengerNames', label:'Passenger names', type:'textarea', full:true, required:true, showFor:'bus', placeholder:'One passenger name per line, in the same order as the selected seats', help:'Include the lead passenger. Return bookings use the same passenger order.' },
        { name:'identityNumbers', label:'Passenger ID / passport numbers', type:'textarea', full:true, showFor:'bus', placeholder:'One per line, matching passenger order' },
        { name:'nationalities', label:'Passenger nationalities', type:'textarea', full:true, showFor:'bus', placeholder:'One per line, matching passenger order' },
        { name:'luggageCounts', label:'Luggage item counts', type:'textarea', full:true, showFor:'bus', placeholder:'One number per line, matching passenger order' },
        { name:'roomTypeId', label:'Room type', type:'select', icon:'fa-bed', options:roomTypes, required:true, dependsOn:'listingId', filterKey:'listingId', showFor:'hotel' },
        { name:'ratePlanId', label:'Rate plan', type:'select', icon:'fa-tags', options:ratePlans, dependsOn:'roomTypeId', filterKey:'roomTypeId', showFor:'hotel' },
        { name:'roomUnitIds', label:'Preferred room units', type:'multiselect', icon:'fa-door-open', options:roomUnits, dependsOn:'roomTypeId', filterKey:'roomTypeId', showFor:'hotel', help:'Optional. Leave empty for automatic allocation from available room nights.' },
        { name:'checkInDate', label:'Check-in date', type:'date', icon:'fa-calendar-day', required:true, showFor:'hotel' },
        { name:'checkOutDate', label:'Check-out date', type:'date', icon:'fa-calendar-check', required:true, showFor:'hotel' },
        { name:'roomCount', label:'Rooms', type:'number', icon:'fa-door-open', required:true, value:'1', showFor:'hotel' },
        { name:'adults', label:'Adults', type:'number', icon:'fa-user-group', required:true, value:'1', showFor:'hotel' },
        { name:'children', label:'Children', type:'number', icon:'fa-child', value:'0', showFor:'hotel' },
        { name:'infants', label:'Infants', type:'number', icon:'fa-baby', value:'0', showFor:'hotel' },
        { name:'additionalGuestNames', label:'Other hotel guest names', type:'textarea', full:true, showFor:'hotel', placeholder:'One name per line after the lead guest', help:'The total named guests must equal adults + children + infants, with at least one lead guest per room.' },
        { name:'fullName', label:'Lead customer / guest name', icon:'fa-user', required:true, placeholder:'Jane Customer' },
        { name:'email', label:'Customer email', type:'email', icon:'fa-envelope', required:true, placeholder:'customer@example.com' },
        { name:'phone', label:'Customer phone', icon:'fa-phone', required:true, placeholder:'Enter phone number' },
        { name:'identityType', label:'Lead ID type', type:'select', icon:'fa-id-card', options:['national_id','passport','student_id','birth_certificate'] },
        { name:'identityNumber', label:'Lead ID / passport number', icon:'fa-id-card-clip' },
        { name:'nationality', label:'Lead nationality', icon:'fa-earth-africa' },
        { name:'dateOfBirth', label:'Lead date of birth', type:'date', icon:'fa-cake-candles' },
        { name:'emergencyContactName', label:'Emergency contact name', icon:'fa-user-shield' },
        { name:'emergencyContactPhone', label:'Emergency contact phone', icon:'fa-phone-volume' },
        { name:'addons', label:'Approved extras', type:'multiselect', icon:'fa-circle-plus', options:serviceAddonOptions, dependsOn:'listingId', filterKey:'listingId' },
        { name:'amountCollected', label:'Cash collected', type:'number', icon:'fa-money-bill-wave', required:true, placeholder:'Enter the exact amount received', help:'The server rejects any amount below the authoritative booking total.' },
        { name:'currency', label:'Currency', type:'select', icon:'fa-coins', options:supportedCurrencies, required:true, value:platformDefaultCurrency },
        { name:'paymentReference', label:'Receipt / cash reference', icon:'fa-receipt', required:true, placeholder:'Unique receipt or till reference' },
        { name:'agentLocation', label:'Sale location', icon:'fa-location-dot', placeholder:'Terminal, office or hotel desk' },
        { name:'specialRequests', label:'Special requests / travel notes', type:'textarea', full:true, placeholder:'Accessibility, arrival, luggage or room requests' },
        { name:'notes', label:'Internal sale note', type:'textarea', full:true, placeholder:'Optional promoter note' },
        { name:'paymentMethod', type:'hidden', value:'cash' }
      ]
    };

    if (key === 'booking') return {
      action: platformActionPath('operations', '/bookings'), submit: 'Create booking',
      fields: [
        { name:'listingId', label:'Public listing', type:'select', icon:'fa-layer-group', options:listings, required:true, help:'Choose the approved public service. Its service type controls which inventory fields appear.' },
        { name:'scheduleId', label:'Departure schedule', type:'select', icon:'fa-calendar-days', options:schedules, required:true, dependsOn:'listingId', filterKey:'listingId', showFor:['bus'], help:'Only departures connected to the selected listing are shown.' },
        { name:'selected', label:'Available seat', type:'select', icon:'fa-chair', options:seatOptions, required:true, dependsOn:'scheduleId', filterKey:'scheduleId', showFor:['bus'], help:'Choose a live seat from the selected departure; internal seat IDs are never typed.' },
        { name:'roomTypeId', label:'Room type', type:'select', icon:'fa-bed', options:roomTypes, required:true, dependsOn:'listingId', filterKey:'listingId', showFor:'hotel', help:'Only room types belonging to the selected hotel listing are shown.' },
        { name:'ratePlanId', label:'Rate plan', type:'select', icon:'fa-tags', options:ratePlans, dependsOn:'roomTypeId', filterKey:'roomTypeId', showFor:'hotel', help:'The selected pay-now cancellation, meal, occupancy and stay rules are frozen into the reservation.' },
        { name:'roomUnitIds', label:'Preferred room units', type:'multiselect', icon:'fa-door-open', options:roomUnits, dependsOn:'roomTypeId', filterKey:'roomTypeId', showFor:'hotel', help:'Optional. Leave empty for secure automatic allocation from dated room inventory.' },
        { name:'checkInDate', label:'Check-in date', type:'date', icon:'fa-calendar-day', required:true, showFor:'hotel' },
        { name:'checkOutDate', label:'Check-out date', type:'date', icon:'fa-calendar-check', required:true, showFor:'hotel' },
        { name:'roomCount', label:'Rooms required', type:'number', icon:'fa-door-open', required:true, value:'1', showFor:'hotel' },
        { name:'adults', label:'Adults', type:'number', icon:'fa-user-group', required:true, value:'1', showFor:'hotel' },
        { name:'children', label:'Children', type:'number', icon:'fa-child', value:'0', showFor:'hotel' },
        { name:'infants', label:'Infants', type:'number', icon:'fa-baby', value:'0', showFor:'hotel' },
        { name:'fullName', label:'Customer / lead guest name', icon:'fa-user', required:true, placeholder:'Jane Customer' },
        { name:'email', label:'Email', type:'email', icon:'fa-envelope', required:true, placeholder:'customer@example.com' },
        { name:'phone', label:'Phone', icon:'fa-phone', required:true, placeholder:'Enter phone number' },
        { name:'identityType', label:'ID type', type:'select', icon:'fa-id-card', options:['national_id','passport','student_id','birth_certificate'], showFor:'hotel' },
        { name:'identityNumber', label:'ID / passport number', icon:'fa-id-card-clip', showFor:'hotel' },
        { name:'nationality', label:'Nationality', icon:'fa-earth-africa', showFor:'hotel' },
        { name:'emergencyContactName', label:'Emergency contact name', icon:'fa-user-shield', showFor:'hotel' },
        { name:'emergencyContactPhone', label:'Emergency contact phone', icon:'fa-phone-volume', showFor:'hotel' },
        { name:'additionalGuestNames', label:'Other guest names', type:'textarea', full:true, showFor:'hotel', placeholder:'One guest per line. Include every adult, child and infant after the lead guest.' },
        { name:'paymentProvider', label:'Payment method', type:'select', icon:'fa-wallet', options:['cash','bank_transfer','card','mobile_money'], value:'cash', showFor:'hotel' },
        { name:'paymentStatus', label:'Payment status', type:'select', icon:'fa-money-check', options:[{value:'successful',label:'Paid / confirmed'},{value:'pending',label:'Payment pending'}], value:'successful', showFor:'hotel' },
        { name:'addons', label:'Add-ons / stay notes', icon:'fa-plus', placeholder:'luggage, meal, accessibility request' },
        { name:'specialRequests', label:'Hotel special requests', type:'textarea', full:true, showFor:'hotel', placeholder:'Accessibility, bedding, meals, arrival or other request' }
      ]
    };
    if (key === 'listing' || requestedServiceListing) return {
      action: platformActionPath(['content', 'operations'], '/listings'), submit: requestedServiceListing ? `Create ${requestedServiceLabel} listing` : 'Create listing',
      fields: [
        { name:'companyId', label:'Partner', type:'select', icon:'fa-building', options:companies, required:true },
        { name:'title', label:'Title', icon:'fa-pen', required:true, placeholder: requestedServiceListing === 'hotel' ? 'Kampala City Hotel' : requestedServiceListing ? `${requestedServiceLabel} service` : 'Kampala to Nairobi bus service' },
        ...(requestedServiceListing
          ? [{ name:'serviceType', type:'hidden', value: requestedServiceListing }]
          : [{ name:'serviceType', label:'Service type', type:'select', icon:'fa-layer-group', options:serviceListingTypes }]),
        { name:'from', label: requestedServiceListing === 'hotel' ? 'Location / area' : 'From', icon:'fa-location-dot', placeholder:'Kampala' },
        { name:'to', label: requestedServiceListing === 'hotel' ? 'Nearby landmark' : 'To / location', icon:'fa-location-dot', placeholder: requestedServiceListing === 'hotel' ? 'City center' : 'Nairobi' },
        { name:'address', label:'Address', icon:'fa-map-pin', placeholder:'Plot 1 Main Street', showFor:['hotel'] },
        { name:'layout', label:'Default layout', type:'select', icon:'fa-chair', options:['bus-2-2','bus-2-1'], showFor:['bus'] },
        { name:'checkInTime', label:'Check-in time', type:'time', icon:'fa-clock', value:'14:00', showFor:'hotel' },
        { name:'checkOutTime', label:'Check-out time', type:'time', icon:'fa-clock', value:'11:00', showFor:'hotel' },
        { name:'amenities', label:'Amenities', type:'multiselect', icon:'fa-wifi', options:hotelAmenityOptions, showFor:['hotel'] },
        { name:'roomType', label:'First room type', icon:'fa-bed', placeholder:'Standard Queen', showFor:'hotel' },
        { name:'capacity', label:'Room capacity', type:'number', icon:'fa-users', value:'2', showFor:'hotel' },
        { name:'nightlyPrice', label:'Nightly price', type:'number', icon:'fa-coins', placeholder:'180000', showFor:'hotel' },
        { name:'inventory', label:'Room stock', type:'number', icon:'fa-door-open', value:'1', showFor:'hotel' },
        { name:'pickupInstructions', label:'Pickup instructions', icon:'fa-map-pin', placeholder:'Pickup desk or terminal', showFor:['bus'] },
        { name:'dropoffInstructions', label:'Dropoff instructions', icon:'fa-location-dot', placeholder:'Arrival desk or drop-off point', showFor:['bus'] },
        { name:'priceFrom', label:'Price from', type:'number', icon:'fa-coins', required:true, placeholder:'65000' },
        { name:'description', label:'Description', type:'textarea', full:true, placeholder:'Listing details' }
      ]
    };
    if (key === 'payment') return {
      action: platformActionPath('finance', '/payments/freeze'), submit: 'Freeze payout/payment',
      fields: [
        { name:'transactionId', label:'Transaction', type:'select', icon:'fa-receipt', options:payments, required:true },
        { name:'reason', label:'Reason', type:'textarea', full:true, required:true, placeholder:'Why this payout needs review' }
      ]
    };
    if (key === 'payout') return {
      action: platformActionPath('finance', '/payouts/run'), submit: 'Run payout',
      fields: [
        { name:'transactionId', label:'Pending payout', type:'select', icon:'fa-wallet', options:payments },
        { name:'note', label:'Finance note', type:'textarea', full:true, placeholder:'Optional payout batch note' }
      ]
    };
    if (key === 'partner commission') {
      const companyId = detail?.main?.slug || detail?.main?.companyId || detail?.id || recordId;
      const currentCommission = fieldValue('commercialTerms.commissionPercent') || platformConfig.partnerCommissionPercent || 0;
      const currentPayout = Math.max(0, 100 - Number(currentCommission || 0));
      return {
        action: `/admin/companies/${encodeURIComponent(companyId)}/commission`, submit: 'Save partner commission',
        fields: [
          { type:'smart-summary', label:'Percentage commission contract', help:`Classic Trip retains ${Number(currentCommission).toFixed(2)}%. The partner currently receives ${currentPayout.toFixed(2)}%. Existing bookings keep their frozen historical percentage.` },
          { name:'commissionPercent', label:'Partner commission %', type:'number', icon:'fa-percent', value:String(currentCommission), required:true, help:'Enter one percentage from 0 to 100. No plan, renewal, recurring fee, or second partner charge is created.' },
          { name:'reason', label:'Change reason', type:'textarea', full:true, required:true, placeholder:'Why this partner-specific percentage is being changed' }
        ]
      };
    }
    if (key === 'finance rules') return {
      action: platformActionPath('finance', '/finance-rules'), submit: 'Save finance rules',
      fields: [
        { name:'partnerCommissionPercent', label:'Partner commission %', type:'number', icon:'fa-percent', value:String(platformConfig.partnerCommissionPercent ?? ''), help:'Classic Trip retains this percentage from completed bookings. The partner receives the remainder.' },
        { name:'promoterSharePercent', label:'Promoter share of commission %', type:'number', icon:'fa-percent', value:String(platformConfig.promoterSharePercent ?? ''), help:'Paid from Classic Trip’s commission when a valid referral exists; never deducted again from the partner.' },
        { name:'customerServiceFeePercent', label:'Customer service fee %', type:'number', icon:'fa-percent', value:String(platformConfig.customerServiceFeePercent ?? '') },
        { name:'customerServiceFeeFlat', label:'Customer flat service fee', type:'number', icon:'fa-coins', value:String(platformConfig.customerServiceFeeFlat ?? '') },
        { name:'customerTaxPercent', label:'Customer tax %', type:'number', icon:'fa-percent', value:String(platformConfig.customerTaxPercent ?? '') },
        { name:'holdMinutes', label:'Hold timer minutes', type:'number', icon:'fa-clock', value:String(platformConfig.holdMinutes ?? '') },
        { name:'defaultCurrency', label:'Default currency', type:'select', icon:'fa-coins', options:supportedCurrencies, value:platformDefaultCurrency },
        { name:'supportedCurrencies', label:'Supported currencies', icon:'fa-coins', value:supportedCurrencies.join(', '), help:'Configure once here. Company and service forms reuse these codes.' }
      ]
    };
    if (key === 'price rule') return {
      action: platformActionPath('content', '/price-rules'), submit: 'Save price rule',
      fields: [
        { name:'listingId', label:'Listing', type:'select', icon:'fa-layer-group', options:listings },
        { name:'ruleName', label:'Rule name', icon:'fa-tags', required:true, placeholder:'Holiday surge' },
        { name:'percent', label:'Price change %', type:'number', icon:'fa-percent', placeholder:'10' },
        { name:'startsAt', label:'Starts', type:'date', icon:'fa-calendar' },
        { name:'endsAt', label:'Ends', type:'date', icon:'fa-calendar' },
        { name:'note', label:'Note', type:'textarea', full:true, placeholder:'Pricing rule details' }
      ]
    };
    if (key === 'campaign' || key === 'ad' || key === 'ad campaign') return {
      action: platformActionPath('content', '/promotions'), submit: 'Create campaign',
      fields: [
        { name:'listingId', label:'Listing', type:'select', icon:'fa-layer-group', options:listings, required:true },
        { name:'promoterId', label:'Promoter', type:'select', icon:'fa-bullhorn', options:promoters },
        { name:'name', label:'Campaign name', icon:'fa-rectangle-ad', required:true, placeholder:'Featured East Africa routes' },
        { name:'placement', label:'Placement', type:'select', icon:'fa-location-crosshairs', options:['marketplace_top','route_card','hotel_card','banner','promoter_share'] },
        { name:'budget', label:'Budget', type:'number', icon:'fa-coins', placeholder:'250000' },
        { name:'status', label:'Status', type:'select', icon:'fa-toggle-on', options:['active','draft','paused'] }
      ]
    };
    if (key === 'customer note') return {
      action: platformActionPath('support', '/customer-notes'), submit: 'Add note',
      fields: [
        { name:'customerId', label:'Customer', type:'select', icon:'fa-user', options:customers, required:true },
        { name:'subject', label:'Subject', icon:'fa-pen', value:label || 'Customer note' },
        { name:'priority', label:'Priority', type:'select', icon:'fa-flag', options:['normal','high','urgent'] },
        { name:'message', label:'Note', type:'textarea', full:true, required:true, placeholder:'Internal customer note' }
      ]
    };
    if (key === 'notice' || key === 'notification') return {
      action: key === 'notice' ? platformActionPath(['support', 'content'], '/notices') : platformActionPath('content', '/notifications'),
      submit: key === 'notice' ? 'Create notice' : 'Send notification',
      fields: [
        { name:'audience', label:'Audience', type:'select', icon:'fa-users', options:['customers','partners','promoters','admins'] },
        { name:'channels', label:'Channels', type:'select', icon:'fa-paper-plane', options:['email','sms','whatsapp','email,sms'] },
        { name:'subject', label:'Subject', icon:'fa-heading', required:true, placeholder:'Service update' },
        { name:'priority', label:'Priority', type:'select', icon:'fa-flag', options:['normal','high','urgent'] },
        { name:'message', label:'Message', type:'textarea', full:true, required:true, placeholder:'Write the notice message' }
      ]
    };
    if (key === 'custom report') return {
      action: platformReportPath(), submit: 'Download report',
      fields: [
        { name:'type', label:'Report type', type:'select', icon:'fa-file-lines', options:['bookings','payments','partners','promoters','customers','support','promotions','refunds'] },
        { name:'dateFrom', label:'From', type:'date', icon:'fa-calendar' },
        { name:'dateTo', label:'To', type:'date', icon:'fa-calendar' }
      ]
    };
    if (key === 'admin user') return {
      action: '/admin/admin-users', submit: 'Invite admin',
      fields: [
        { name:'fullName', label:'Full name', icon:'fa-user', required:true, placeholder:'Finance Lead' },
        { name:'email', label:'Email', type:'email', icon:'fa-envelope', required:true, placeholder:'admin@example.com' },
        { name:'phone', label:'Phone', icon:'fa-phone', placeholder:'Enter phone number' },
        { name:'role', label:'Role', type:'select', icon:'fa-user-shield', options:['admin','finance_admin','support_admin','operations_admin','content_admin'] },
        { name:'permissionsLabel', label:'Permissions label', icon:'fa-key', placeholder:'Finance controls' }
      ]
    };
    if (key === 'verification task') return {
      action: '/admin/verification-tasks', submit: 'Create review',
      fields: [
        { name:'companyId', label:'Company', type:'select', icon:'fa-building', options:companies, required:true },
        { name:'subject', label:'Review title', icon:'fa-id-card', required:true, placeholder:'Payout account review' },
        { name:'priority', label:'Risk', type:'select', icon:'fa-triangle-exclamation', options:['high','medium','low'] },
        { name:'message', label:'Review note', type:'textarea', full:true, required:true, placeholder:'What needs verification' }
      ]
    };
    if (key === 'refund') return {
      action: platformActionPath('support', '/refunds'), submit: 'Create refund',
      fields: [
        { name:'bookingRef', label:'Booking', type:'select', icon:'fa-ticket', options:bookingOptions, required:true },
        { name:'amount', label:'Amount', type:'number', icon:'fa-coins', placeholder:'25000' },
        { name:'reason', label:'Reason', type:'textarea', full:true, required:true, placeholder:'Refund reason' }
      ]
    };
    if (key === 'template') return {
      action: platformActionPath('content', '/templates'), submit: 'Save template',
      fields: [
        { name:'templateKey', label:'Template key', icon:'fa-envelope-open-text', value:label || 'template' },
        { name:'subject', label:'Subject', icon:'fa-heading', value:label || '' },
        { name:'status', label:'Status', type:'select', icon:'fa-toggle-on', options:['active','review','paused'] },
        { name:'body', label:'Template body', type:'textarea', full:true, required:true, placeholder:'Message body' }
      ]
    };
    return null;
  }


    function updateFoldSelectCount(root) {
      if (!root) return;
      const checked = root.querySelectorAll('input[type="checkbox"]:checked').length;
      const count = root.querySelector('[data-fold-count]');
      if (count) count.innerHTML = `${checked} selected <i class="fa-solid fa-chevron-down"></i>`;
    }

    function initFoldSelects(scope = document) {
      scope.querySelectorAll('[data-fold-select]').forEach(updateFoldSelectCount);
    }

    function normalizedServiceValue(value) {
      return String(value || '').trim().replace(/-/g, '_').toLowerCase();
    }

    function applyShowForFields(scope = document) {
      scope.querySelectorAll('form').forEach((form) => {
        const serviceField = form.querySelector('[name="serviceType"]');
        const listingField = form.querySelector('select[name="listingId"]');
        const listingServiceType = listingField?.selectedOptions?.[0]?.dataset?.serviceType || '';
        const serviceValue = normalizedServiceValue(serviceField?.value || listingServiceType || runtimeCompanyServiceType);
        form.querySelectorAll('[data-show-for]').forEach((field) => {
          const allowed = String(field.dataset.showFor || '').split(',').map(normalizedServiceValue).filter(Boolean);
          const shouldShow = !allowed.length || allowed.includes(serviceValue);
          field.hidden = !shouldShow;
          field.querySelectorAll('input,select,textarea').forEach((input) => {
            if (input.dataset.originalRequired === 'true') input.required = shouldShow;
            if (!shouldShow) input.setCustomValidity('');
          });
        });
      });
    }

  function openCrud(mode, type, label = '', detail = {}) {
    if (mode === 'delete') {
      const entity = String(detail?.entity || type || '').toLowerCase();
      const recordId = detail?.id || dashboardRecordId(detail || {});
      const action = archiveActionFor(entity, recordId);
      if (els.deleteText) els.deleteText.textContent = `Are you sure you want to archive ${label || 'this ' + type}?`;
      if (els.deleteForm) els.deleteForm.setAttribute('action', action || '');
      if (els.confirmDelete) els.confirmDelete.disabled = !action;
      if (els.deleteModal) els.deleteModal.classList.add('is-open');
      return;
    }

    if (!els.crudModal || !els.crudTitle || !els.crudBody) return;
    const cleanType = type || 'record';
    const title = mode === 'view' ? `View ${cleanType}` : mode === 'edit' ? `Edit ${cleanType}` : `Create ${cleanType}`;
    els.crudTitle.textContent = title.charAt(0).toUpperCase() + title.slice(1);
    if (els.crudSub) els.crudSub.textContent = label ? `Selected: ${label}` : 'Fill the details below. This modal uses the dashboard data model.';

    const readonly = mode === 'view';
    const disabled = mode === 'view';
    if (mode === 'create' && /partner|company/i.test(cleanType)) {
      els.crudSub.textContent = 'Create the partner account, upload logo or document to Cloudinary, then approve it from the table.';
      els.crudBody.innerHTML = `
        <form class="formPanel" id="crudForm" method="POST" action="/admin/companies" enctype="multipart/form-data">
          <input type="hidden" name="_csrf" value="${csrfToken}">
          <div class="formGrid">
            <div class="field"><label>Company name</label><div class="control"><i class="fa-solid fa-building"></i><input name="name" placeholder="Enter company name" required></div></div>
            <div class="field"><label>Company type</label><div class="control"><i class="fa-solid fa-briefcase"></i><select name="companyType"><option value="bus">Bus company</option><option value="hotel">Hotel</option></select></div></div>
            <div class="field"><label>Country</label><div class="control"><i class="fa-solid fa-earth-africa"></i><select name="country" required><option value="" selected disabled>Select country</option><option>Uganda</option><option>Kenya</option><option>Rwanda</option><option>Tanzania</option><option>South Sudan</option><option>DR Congo</option></select></div></div>
            <div class="field"><label>Operating currency</label><div class="control"><i class="fa-solid fa-money-bill"></i><select name="operatingCurrency">${supportedCurrencies.map(code => `<option value="${escapeHtml(code)}"${code === platformDefaultCurrency ? ' selected' : ''}>${escapeHtml(code)}</option>`).join('')}</select></div></div>
            <div class="field"><label>Partner commission %</label><div class="control"><i class="fa-solid fa-percent"></i><input type="number" name="commissionPercent" min="0" max="100" step="0.01" value="${escapeHtml(String(platformConfig.partnerCommissionPercent ?? 0))}" required></div><small class="fieldHelp">One percentage only. The partner receives the remainder.</small></div>
            <div class="field"><label>City</label><div class="control"><i class="fa-solid fa-location-dot"></i><input name="city" placeholder="Kampala"></div></div>
            <div class="field"><label>Support email</label><div class="control"><i class="fa-solid fa-envelope"></i><input name="email" type="email" placeholder="ops@example.com"></div></div>
            <div class="field"><label>Support phone</label><div class="control"><i class="fa-solid fa-phone"></i><input name="phone" placeholder="Enter phone number"></div></div>
            <div class="field"><label>Upload type</label><div class="control"><i class="fa-solid fa-folder-open"></i><select name="mediaTarget"><option value="companyLogo">Company logo</option><option value="companyDocument">Business document</option></select></div></div>
            <div class="field"><label>Document type</label><div class="control"><i class="fa-regular fa-id-card"></i><select name="documentType"><option value="business_license">Business license</option><option value="tax_certificate">Tax certificate</option><option value="operator_permit">Operator permit</option><option value="payout_proof">Payout proof</option><option value="owner_id">Owner ID</option></select></div></div>
            <div class="field"><label>Document reference</label><div class="control"><i class="fa-solid fa-hashtag"></i><input name="documentReference" placeholder="License, TIN, or permit number"></div></div>
            <div class="field"><label>Cloudinary file</label><div class="control"><i class="fa-solid fa-cloud-arrow-up"></i><input type="file" name="imageFile" accept="image/*,application/pdf"></div></div>
            <div class="field full"><label>Description</label><div class="control"><textarea name="description" placeholder="Business profile, routes, hotels, or services offered."></textarea></div></div>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
            <button class="btn" type="button" data-close-modal>Cancel</button>
            <button class="btn btnPrimary" type="submit"><i class="fa-solid fa-floppy-disk"></i> Create partner</button>
          </div>
        </form>`;
      els.crudModal.classList.add('is-open');
      initFoldSelects(els.crudModal);
      applyShowForFields(els.crudModal);
      bindDependentFields(els.crudModal);
      return;
    }
    const config = adminFormConfig(cleanType, label, detail, mode);
    if (!config) {
      els.crudBody.innerHTML = `
        <div class="notice">This admin action is handled by row-level controls, report exports, or a dedicated dashboard page.</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
          <button class="btn btnBlue" type="button" data-close-modal>Done</button>
        </div>`;
      els.crudModal.classList.add('is-open');
      initFoldSelects(els.crudModal);
      applyShowForFields(els.crudModal);
      bindDependentFields(els.crudModal);
      return;
    }
    const fields = config.fields.map(field => adminFieldHtml(field, readonly, disabled)).join('');
    const multipart = config.fields.some(field => field.type === 'file') ? ' enctype="multipart/form-data"' : '';
    els.crudBody.innerHTML = `
      <form class="formPanel" id="crudForm" data-form-type="${escapeHtml(cleanType)}" data-form-mode="${escapeHtml(mode)}" method="POST" action="${escapeHtml(config.action)}"${multipart}>
        <input type="hidden" name="_csrf" value="${csrfToken}">
        <div class="formGrid">${fields}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
          <button class="btn" type="button" data-close-modal>Cancel</button>
          ${mode === 'view' ? `<button class="btn btnBlue" type="button" data-close-modal>Done</button>` : `<button class="btn btnPrimary" type="submit"><i class="fa-solid fa-floppy-disk"></i> ${escapeHtml(config.submit || 'Save')}</button>`}
        </div>
      </form>`;
    els.crudModal.classList.add('is-open');
    initFoldSelects(els.crudModal);
    applyShowForFields(els.crudModal);
    bindDependentFields(els.crudModal);
    syncSmartBusForm(els.crudModal.querySelector('#crudForm'));
  }

  function bindEvents() {
    document.addEventListener('change', function (e) {
      const foldInput = e.target.closest('[data-fold-select] input[type="checkbox"]');
      if (foldInput) updateFoldSelectCount(foldInput.closest('[data-fold-select]'));
      const filterBox = e.target.closest('[data-filter-target]');
      if (filterBox) applyDashboardFilter(filterBox);
      const seatMapSelect = e.target.closest('[data-seat-map-select]');
      if (seatMapSelect) syncSelectedSeatMap();
      if (e.target.matches('[name="serviceType"], select[name="listingId"]')) applyShowForFields(e.target.closest('form') || document);
      if (e.target.matches('select')) refreshDependentsFor(e.target);
      const smartForm = e.target.closest('#crudForm');
      if (smartForm) {
        if (smartForm.dataset.smartSyncing !== 'true') e.target.dataset.smartUserEdited = 'true';
        syncSmartBusForm(smartForm, e.target.name || '');
      }
    });

    document.addEventListener('input', function (e) {
      const filterBox = e.target.closest('[data-filter-target]');
      if (filterBox) applyDashboardFilter(filterBox);
      const smartForm = e.target.closest('#crudForm');
      if (smartForm) {
        if (smartForm.dataset.smartSyncing !== 'true') e.target.dataset.smartUserEdited = 'true';
        syncSmartBusForm(smartForm, e.target.name || '');
      }
    });

    document.addEventListener('click', function (e) {
      const generateLabelsButton = e.target.closest('[data-generate-seat-labels]');
      if (generateLabelsButton) {
        e.preventDefault();
        const form = generateLabelsButton.closest('form');
        const total = Number(fieldControl(form, 'totalSeats')?.value || 0);
        const layout = fieldControl(form, 'layoutName')?.value || '2x2';
        const mode = generateLabelsButton.dataset.generateSeatLabels || 'numeric';
        autoSetField(form, 'totalSeats', total, { force:true });
        autoSetField(form, 'layoutName', layout, { force:true });
        const labels = browserGeneratedSeatLabels(form, mode === 'numeric' ? 'automatic' : mode);
        autoSetField(form, 'seatLabelMode', 'custom', { force:true });
        autoSetField(form, 'seatLabels', labels.join(', '), { force:true });
        const labelsField = fieldControl(form, 'seatLabels');
        if (labelsField) labelsField.dataset.smartUserEdited = 'true';
        refreshSeatLabelEditor(form);
        return;
      }
      const focusSeatMapList = e.target.closest('[data-seat-map-focus-list]');
      if (focusSeatMapList) {
        e.preventDefault();
        document.querySelector('#seatMapListCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const resetBtn = e.target.closest('[data-filter-reset]');
      if (resetBtn) {
        e.preventDefault();
        const filterBox = resetBtn.closest('[data-filter-target]');
        if (filterBox) {
          filterBox.querySelectorAll('input, select').forEach(control => { control.value = ''; });
          applyDashboardFilter(filterBox);
        }
        return;
      }
      const tabBtn = e.target.closest('.innerTabs .tabBtn[data-tab-target]');
      if (!tabBtn) return;
      e.preventDefault();
      e.stopPropagation();
      activateTab(tabBtn);
    }, true);

    document.addEventListener('keydown', function (e) {
      const tabBtn = e.target.closest && e.target.closest('.innerTabs .tabBtn[data-tab-target]');
      if (!tabBtn || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      activateTab(tabBtn);
    });

    document.addEventListener('click', function (e) {
      const nav = e.target.closest('.navBtn');
      if (nav && nav.dataset.page) {
        e.preventDefault();
        nav.blur();
        showPage(nav.dataset.page);
        if (nav.getAttribute('href') && nav.getAttribute('href').charAt(0) !== '#') {
          history.pushState({ page: nav.dataset.page }, '', nav.getAttribute('href'));
        }
        return;
      }

      const jump = e.target.closest('[data-jump]');
      if (jump && jump.dataset.jump) {
        e.preventDefault();
        showPage(jump.dataset.jump);
        return;
      }

      const tabBtn = e.target.closest('.tabBtn');
      if (tabBtn) {
        e.preventDefault();
        activateTab(tabBtn);
        return;
      }

      const chip = e.target.closest('.chip');
      if (chip) {
        const row = chip.parentElement;
        if (row) row.querySelectorAll('.chip').forEach(c => c.classList.remove('is-on'));
        chip.classList.add('is-on');
        toast('Filter applied: ' + chip.textContent.trim());
      }

      const copyBtn = e.target.closest('[data-copy-value]');
      if (copyBtn) {
        e.preventDefault();
        navigator.clipboard?.writeText(copyBtn.dataset.copyValue || '').catch(() => {});
        toast('Copied reference');
        return;
      }

      const exportRowBtn = e.target.closest('[data-export-row]');
      if (exportRowBtn) {
        e.preventDefault();
        const detail = parseDetailFromElement(exportRowBtn) || { label: exportRowBtn.dataset.label || '' };
        exportDetailPdf(detail, exportRowBtn.dataset.exportRow || exportRowBtn.dataset.label || 'record');
        toast('PDF export opened');
        return;
      }

      const modalBtn = e.target.closest('[data-modal]');
      if (modalBtn) {
        if (modalBtn.matches('tr') && e.target.closest('button,a,form,input,select,textarea,label')) return;
        e.preventDefault();
        const detail = parseDetailFromElement(modalBtn);
        if (modalBtn.dataset.modal === 'view' && detail) openDetailModal(modalBtn.dataset.type, modalBtn.dataset.label || '', detail);
        else openCrud(modalBtn.dataset.modal, modalBtn.dataset.type, modalBtn.dataset.label || '', detail || { id: modalBtn.dataset.rowId || '' });
        return;
      }

      if (e.target.closest('[data-close-modal]')) {
        $$('.modal').forEach(m => m.classList.remove('is-open'));
        return;
      }

      if (e.target.closest('#btnExport')) toast('Export started');
    });

    document.addEventListener('submit', function (e) {
      if (e.target.matches('#crudForm,#noticeForm,#settingsForm')) {
        if (e.target.hasAttribute('action')) return;
        e.preventDefault();
        $$('.modal').forEach(m => m.classList.remove('is-open'));
        toast('Action saved');
      }
    });

    if (els.openMenu) els.openMenu.addEventListener('click', () => document.body.classList.add('menu-open'));
    if (els.sideBackdrop) els.sideBackdrop.addEventListener('click', closeMenu);

    const savedDashboardTheme = (() => {
      try { return localStorage.getItem('classicTripTheme') || localStorage.getItem('ct-theme') || localStorage.getItem('ct_auth_theme'); } catch (_) { return null; }
    })();
    if (savedDashboardTheme === 'light' || savedDashboardTheme === 'dark') {
      document.documentElement.dataset.theme = savedDashboardTheme;
      if (els.themeIcon) els.themeIcon.className = savedDashboardTheme === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    }

    if (els.btnTheme) {
      els.btnTheme.addEventListener('click', function () {
        const root = document.documentElement;
        const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
        root.dataset.theme = next;
        try { localStorage.setItem('classicTripTheme', next); } catch (_) { /* Storage can be unavailable. */ }
        if (els.themeIcon) els.themeIcon.className = next === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
        toast(next === 'dark' ? 'Dark mode enabled' : 'Light mode enabled');
      });
    }

    const btnNew = $('#btnNew');
    function defaultCreateModalType() {
      if (shell.currentRole === 'company') return runtimeCompanyServiceType === 'hotel' ? 'room night inventory' : runtimeCompanyServiceType === 'bus' ? 'schedule' : 'listing';
      if (shell.currentRole === 'employee') return 'booking';
      return 'partner';
    }
    if (btnNew) btnNew.addEventListener('click', () => openCrud('create', defaultCreateModalType()));

    if (els.sideSearch) {
      els.sideSearch.addEventListener('input', function (e) {
        const q = e.target.value.toLowerCase().trim();
        $$('#sideNav .navBtn').forEach(btn => {
          btn.style.display = btn.textContent.toLowerCase().includes(q) ? 'flex' : 'none';
        });
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeMenu();
        $$('.modal').forEach(m => m.classList.remove('is-open'));
      }
    });
  }


  function normalizeHotelStatus(value = '') {
    const text = String(value || '').toLowerCase();
    if (/checked.?out|complete/.test(text)) return 'checked-out';
    if (/checked.?in|occupied|booked/.test(text)) return /booked/.test(text) ? 'booked' : 'occupied';
    if (/hold|reserved/.test(text)) return 'held';
    if (/cleaning/.test(text)) return 'cleaning';
    if (/maintenance|blocked|cancel/.test(text)) return 'maintenance';
    return text || 'available';
  }

  function parseHotelCalendarRows(rows = []) {
    return (Array.isArray(rows) ? rows : []).map((row) => {
      const cells = rowCells(row);
      const meta = rowMeta(row) || {};
      const detail = meta.detail || {};
      const night = detail.roomNight || {};
      const unit = detail.roomUnit || {};
      const type = detail.roomType || {};
      const booking = detail.booking || {};
      const date = night.date || cells[0] || '';
      const unitLabel = unit.unitNumber || night.roomUnitId || cells[1] || 'Room';
      const status = normalizeHotelStatus(night.status || cells[3] || meta.status || 'available');
      return {
        id: night.id || meta.id || `${unitLabel}-${date}`,
        date,
        unit: unitLabel,
        roomType: type.name || cells[2] || 'Room type',
        status,
        displayStatus: night.status || cells[3] || status,
        bookingRef: night.bookingRef || booking.bookingRef || cells[4] || '',
        guest: night.guestName || booking.guestSnapshot?.fullName || cells[5] || '',
        price: night.price || cells[6] || '',
        search: [date, unitLabel, type.name, cells.join(' '), night.bookingRef, night.guestName, booking.bookingRef].filter(Boolean).join(' ').toLowerCase(),
        detail: detail.roomNight ? detail : { ...detail, roomNight: night, roomUnit: unit, roomType: type, booking }
      };
    }).filter((item) => item.date || item.unit);
  }

  function dateAdd(date, days) {
    const d = new Date(`${date}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + Number(days || 0));
    return d.toISOString().slice(0, 10);
  }

  function renderHotelRoomCalendar() {
    const grid = $('#hotelRoomCalendarGrid');
    if (!grid) return;
    const rows = parseHotelCalendarRows(data.roomNightInventory || []);
    const search = ($('#hotelCalendarSearch')?.value || '').trim().toLowerCase();
    const rawStatus = $('#hotelCalendarStatus')?.value || '';
    const days = Math.max(1, Math.min(30, Number($('#hotelCalendarDays')?.value || 7)));
    const today = new Date().toISOString().slice(0, 10);
    const firstDataDate = rows.map(r => r.date).filter(Boolean).sort()[0] || today;
    const start = $('#hotelCalendarStart')?.value || firstDataDate;
    const dates = Array.from({ length: days }, (_, i) => dateAdd(start, i));
    grid.style.setProperty('--hotel-days', String(days));
    if (!rows.length) {
      grid.innerHTML = `<div class="hotelCalHead">Room</div><div class="hotelCalHead">No inventory</div><div class="hotelCalUnit"><strong>No room-night inventory yet</strong><span>Add inventory to build the calendar.</span></div><button class="hotelCalCell available" type="button" data-modal="create" data-type="room night inventory"><strong>Add nights</strong><span>Open form</span></button>`;
      return;
    }
    const filtered = rows.filter((r) => {
      const matchesSearch = !search || r.search.includes(search);
      const matchesStatus = !rawStatus || r.status === rawStatus || (rawStatus === 'booked' && /booked|occupied|checked-in/.test(r.status)) || (rawStatus === 'held' && /held|reserved/.test(r.status));
      const matchesDate = dates.includes(r.date);
      return matchesSearch && matchesStatus && matchesDate;
    });
    const units = Array.from(new Set(filtered.map(r => r.unit))).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
    const byUnitDate = new Map(filtered.map((r) => [`${r.unit}::${r.date}`, r]));
    let html = `<div class="hotelCalHead">Room</div>` + dates.map((d) => `<div class="hotelCalHead">${escapeHtml(new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month:'short', day:'numeric' }))}</div>`).join('');
    if (!units.length) {
      html += `<div class="hotelCalUnit"><strong>No matching rooms</strong><span>Adjust calendar filters.</span></div>` + dates.map(() => `<div class="hotelCalCell"><strong>-</strong><span>No match</span></div>`).join('');
      grid.innerHTML = html;
      return;
    }
    units.forEach((unit) => {
      const representative = filtered.find(r => r.unit === unit) || rows.find(r => r.unit === unit) || {};
      html += `<div class="hotelCalUnit"><strong>${escapeHtml(unit)}</strong><span>${escapeHtml(representative.roomType || 'Room')}</span></div>`;
      dates.forEach((date) => {
        const item = byUnitDate.get(`${unit}::${date}`);
        if (!item) {
          html += `<button class="hotelCalCell" type="button" data-modal="create" data-type="room night inventory"><strong>Not set</strong><span>Add inventory</span></button>`;
          return;
        }
        const detailAttr = encodeDetail({ entity:'room_night', ...item.detail, roomNight: { ...(item.detail?.roomNight || {}), id: item.id, date: item.date, status: item.displayStatus, bookingRef: item.bookingRef, guestName: item.guest }, roomUnit: { ...(item.detail?.roomUnit || {}), unitNumber: item.unit }, roomType: { ...(item.detail?.roomType || {}), name: item.roomType } });
        const label = `${item.unit} ${item.date}`;
        html += `<button class="hotelCalCell ${escapeHtml(item.status)}" type="button" data-modal="view" data-type="room night" data-label="${escapeHtml(label)}" data-row-id="${escapeHtml(item.id)}" data-row-detail="${escapeHtml(detailAttr)}"><strong>${escapeHtml(item.displayStatus || item.status)}</strong><span>${escapeHtml(item.bookingRef || item.guest || item.price || 'Open')}</span></button>`;
      });
    });
    grid.innerHTML = html;
  }

  function initHotelCalendarControls() {
    ['hotelCalendarSearch','hotelCalendarStatus','hotelCalendarStart','hotelCalendarDays'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', renderHotelRoomCalendar);
      if (el) el.addEventListener('change', renderHotelRoomCalendar);
    });
    const reset = document.getElementById('hotelCalendarReset');
    if (reset) reset.addEventListener('click', () => {
      ['hotelCalendarSearch','hotelCalendarStatus','hotelCalendarStart'].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ''; });
      const days = document.getElementById('hotelCalendarDays'); if (days) days.value = '7';
      renderHotelRoomCalendar();
    });
  }

  function customerTicketRows() {
    if (Array.isArray(data.bookings) && data.bookings.length) return data.bookings.slice(0, 1);
    const ticket = data.currentTicket && typeof data.currentTicket === 'object' ? data.currentTicket : null;
    if (!ticket) return [];
    const booking = ticket.booking || ticket;
    const service = ticket.service || {};
    const customer = ticket.customer || {};
    return [[
      booking.bookingRef || booking.id || 'Current ticket',
      service.title || booking.serviceTitle || booking.serviceType || 'Booked service',
      ticket.company?.name || booking.companyName || '-',
      booking.travelDate || booking.departure || booking.createdAt || '-',
      customer.fullName || booking.passengerName || booking.customerName || '-',
      booking.status || booking.bookingStatus || 'Active',
      booking.total || booking.amount || '-',
      { entity: 'ticket', id: booking.bookingRef || booking.id || 'current-ticket', detail: ticket },
    ]];
  }

  function customerPassengerRows() {
    if (Array.isArray(data.passengers) && data.passengers.length) return data.passengers;
    return (data.bookings || []).flatMap((row) => {
      const meta = rowMeta(row);
      const cells = rowCells(row);
      const detail = meta?.detail || {};
      const booking = detail.booking || {};
      const customer = detail.customer || booking.guestSnapshot || {};
      const passengers = Array.isArray(booking.passengers) && booking.passengers.length ? booking.passengers : [customer].filter(item => Object.keys(item || {}).length);
      return passengers.map((passenger, index) => [
        passenger.fullName || passenger.name || cells[2] || 'Passenger',
        booking.bookingRef || cells[0] || '-',
        passenger.seatOrRoom || passenger.seatNumber || passenger.roomNumber || cells[4] || '-',
        passenger.phone || customer.phone || '-',
        passenger.email || customer.email || '-',
        booking.bookingStatus || booking.status || cells[5] || 'Booked',
        { entity: 'passenger', id: passenger.id || `${cells[0] || 'booking'}-${index}`, detail: { passenger, booking, customer, source: detail } },
      ]);
    });
  }

  function customerRefundRows() {
    return (data.refunds || []).map((row) => {
      const meta = rowMeta(row);
      const cells = rowCells(row);
      return [
        cells[0] || 'Refund',
        cells[1] || '-',
        data.profile?.fullName || shell.profileName || 'Customer',
        cells[2] || cells[3] || '-',
        cells[3] || cells[4] || '-',
        cells[4] || cells[5] || 'Pending',
        meta,
      ];
    });
  }

  function customerSupportRows() {
    return (data.support || []).map((row) => {
      const meta = rowMeta(row);
      const cells = rowCells(row);
      return [
        cells[0] || 'Case',
        cells[2] || cells[1] || 'Support request',
        cells[3] || 'Normal',
        cells[4] || 'Open',
        cells[5] || '-',
        cells[1] || 'General',
        meta,
      ];
    });
  }

  function driverManifestRows() {
    const bookingRows = data.bookings || [];
    return bookingRows.flatMap((row) => {
      const meta = rowMeta(row);
      const cells = rowCells(row);
      const detail = meta?.detail || {};
      const booking = detail.booking || {};
      const customer = detail.customer || booking.guestSnapshot || {};
      const passengers = Array.isArray(booking.passengers) && booking.passengers.length ? booking.passengers : [customer].filter(item => Object.keys(item || {}).length);
      return passengers.map((passenger, index) => [
        passenger.fullName || passenger.name || cells[2] || 'Passenger',
        booking.bookingRef || cells[0] || '-',
        passenger.seatOrRoom || passenger.seatNumber || passenger.roomNumber || cells[3] || '-',
        passenger.phone || customer.phone || '-',
        detail.payment?.status || booking.paymentStatus || '-',
        booking.checkInStatus || cells[5] || 'Pending',
        booking.bookingStatus || cells[5] || 'Booked',
        { entity: 'manifest_passenger', id: passenger.id || `${cells[0] || 'manifest'}-${index}`, detail: { passenger, booking, customer, source: detail } },
      ]);
    });
  }

  function promoterSupportRows() {
    return (data.support || []).map((row) => {
      const meta = rowMeta(row);
      const cells = rowCells(row);
      return [
        cells[0] || 'Case',
        cells[1] || 'Promoter support',
        cells[2] || 'Normal',
        cells[3] || 'Open',
        cells[4] || '-',
        'Promoter',
        meta,
      ];
    });
  }

  function renderPromoterPerformance() {
    const performance = data.performance && typeof data.performance === 'object' ? data.performance : {};
    const bars = Array.isArray(performance.bars) ? performance.bars : [];
    fillBars('promoterPerformanceBars', bars);
    const channels = [
      ...(Array.isArray(performance.bestListings) ? performance.bestListings.map(item => ['Listing', item]) : []),
      ...(Array.isArray(performance.bestCompanies) ? performance.bestCompanies.map(item => ['Company', item]) : []),
    ].slice(0, 6);
    setHtml('#promoterBestChannels', (channels.length ? channels : [['Channel', 'No performance records yet']]).map(([type, label], index) => `
      <div class="metricRow">
        <div><strong>${escapeHtml(label || '-')}</strong><span>${escapeHtml(type)} ${index + 1}</span></div>
        <b class="badge ${index < 2 ? 'ok' : 'info'}">${index < 2 ? 'Top' : 'Track'}</b>
      </div>`).join(''));
  }

  function init() {
    fillOverviewStats();
    fillRecent();
    fillTable('#bookingsTable', data.bookings);
    fillTable('#bookingsBusTable', data.bookings.filter(r => /bus/i.test(r[1])));
    fillTable('#bookingsHotelTable', data.bookings.filter(r => /hotel/i.test(r[1])));
    fillTable('#bookingsHoldTable', data.bookings.filter(r => /hold/i.test(r[5]) || /left/i.test(r[4])));
    fillTable('#bookingsRefundedTable', data.bookings.filter(r => /refund/i.test(r[5])));
    fillTable('#partnersTable', data.partners, 'partners');
    fillTable('#partnersBusTable', data.partners.filter(r => /bus/i.test(r[1])), 'partners');
    fillTable('#partnersHotelTable', data.partners.filter(r => /hotel/i.test(r[1])), 'partners');
    fillTable('#partnersPendingTable', data.partners.filter(r => /pending|review/i.test(r[4])), 'partners');
    fillTable('#listingsTable', data.listings, 'listings');
    fillTable('#adminRoutesTable', data.routes || data.routeInventory || [], 'routes');
    fillTable('#adminVehiclesTable', data.vehicles || [], 'vehicles');
    fillTable('#adminSchedulesTable', data.schedules || [], 'schedules');
    fillTable('#companyFareProductsTable', data.fareProductRows || [], 'generic');
    fillTable('#companySegmentFaresTable', data.segmentFareRows || [], 'generic');
    fillTable('#companyServiceAddonsTable', data.serviceAddonRows || [], 'generic');
    fillTable('#paymentsTable', data.payments, 'payments');
    fillTable('#promotersTable', data.promoters, 'promoters');
    fillTable('#customersTable', data.customers, 'customers');
    fillTable('#supportTable', data.support, 'support');
    fillTable('#adsTable', data.ads, 'ads');
    fillTable('#routeInventoryTable', data.routeInventory, 'listings');
    fillTable('#stayInventoryTable', data.stayInventory, 'listings');
    fillTable('#reviewInventoryTable', data.reviewInventory, 'refunds');
    fillTable('#auditTable', data.audit, 'audit');
    fillTable('#financeAuditTable', data.financeAudit, 'audit');
    fillTable('#securityAuditTable', data.securityAudit, 'audit');
    fillTable('#adminsTable', data.admins, 'admins');
    fillTable('#kycTable', data.kyc.filter(r => /pending|review/i.test(r[5])), 'kyc');
    fillTable('#kycApprovedTable', data.kyc.filter(r => /approved|verified/i.test(r[5])), 'kyc');
    fillTable('#kycRejectedTable', data.kyc.filter(r => /rejected|failed/i.test(r[5])), 'kyc');
    fillTable('#kycBankTable', data.kyc.filter(r => /bank|mismatch/i.test(r[3]) || /bank|mismatch/i.test(r[5])), 'kyc');
    fillTable('#kycExpiredTable', data.kyc.filter(r => /expired/i.test(r[1]) || /expired/i.test(r[5])), 'kyc');
    fillTable('#refundsTable', data.refunds, 'refunds');
    fillTable('#customerTicketTable', customerTicketRows());
    fillTable('#customerSavedTable', data.saved, 'generic');
    fillTable('#customerPassengersTable', customerPassengerRows(), 'generic');
    fillTable('#customerReceiptsTable', data.receipts, 'generic');
    fillTable('#customerWalletTable', data.wallet, 'generic');
    fillTable('#customerSecurityTable', data.security, 'generic');
    fillTable('#customerRefundsTable', customerRefundRows(), 'refunds');
    fillTable('#customerSupportTable', customerSupportRows(), 'support');
    fillTable('#customerReviewsTable', data.reviews, 'generic');
    fillTable('#customerNotificationsTable', data.notifications, 'notifications');
    fillTable('#promoterLinksTable', data.links, 'generic');
    fillTable('#promoterShareTable', data.share, 'generic');
    fillTable('#promoterCampaignsTable', data.campaigns, 'generic');
    fillTable('#promoterOfflineSalesTable', data.offlineSales.length ? data.offlineSales : data.agentSales, 'generic');
    fillTable('#promoterFraudTable', data.fraud.length ? data.fraud : data.fraudSignals, 'generic');
    fillTable('#promoterCommissionsTable', data.commissions, 'generic');
    fillTable('#promoterWithdrawalsTable', data.withdrawals, 'generic');
    fillTable('#promoterPayoutsTable', data.payouts, 'generic');
    fillTable('#promoterSupportTable', promoterSupportRows(), 'support');
    fillTable('#driverOpsTable', data.driverOps.length ? data.driverOps : data.schedules, 'generic');
    fillTable('#driverManifestTable', driverManifestRows(), 'generic');
    fillTable('#driverIncidentsTable', data.driverIncidents.length ? data.driverIncidents : data.support, 'generic');
    renderPromoterPerformance();
    fillTable('#employeeHandoversTable', data.handovers, 'generic');
    fillTable('#notificationsTable', data.notifications, 'notifications');
    fillTable('#companyBranchesTable', data.branches || [], 'generic');
    fillTable('#companyPoliciesTable', data.policies || [], 'generic');
    fillTable('#companyStaffTable', data.staff || [], 'generic');
    fillTable('#companyDriversTable', data.drivers || [], 'generic');
    renderSeatMapTable(data.seatMaps || []);
    fillTable('#companyHotelPropertiesTable', data.hotelProperties || [], 'generic');
    fillTable('#companyRoomTypesTable', data.roomTypes || [], 'generic');
    fillTable('#companyRatePlansTable', data.ratePlans || [], 'generic');
    fillTable('#companyRoomUnitsTable', data.roomUnits || [], 'generic');
    const housekeepingRows = data.hotelHousekeepingTasks || (data.roomUnits || []).filter(r => /dirty|cleaning|maintenance|occupied/i.test(rowCells(r).join(' ')));
    fillTable('#companyHousekeepingTable', housekeepingRows, 'generic');
    const hkTextRows = housekeepingRows.map(row => rowCells(row).join(' ').toLowerCase());
    const hkOpen = document.getElementById('hkOpenCount'); if (hkOpen) hkOpen.textContent = String(hkTextRows.filter(text => /open|in_progress|blocked/.test(text)).length);
    const hkCleaning = document.getElementById('hkCleaningCount'); if (hkCleaning) hkCleaning.textContent = String(hkTextRows.filter(text => /cleaning/.test(text)).length);
    const hkMaintenance = document.getElementById('hkMaintenanceCount'); if (hkMaintenance) hkMaintenance.textContent = String(hkTextRows.filter(text => /maintenance/.test(text)).length);
    fillTable('#companyRoomNightInventoryTable', data.roomNightInventory || [], 'generic');
    renderHotelRoomCalendar();
    initHotelCalendarControls();
    fillTable('#companyBusManifestTable', (data.bookedSeatGroups || []).map(g => [g.scheduleId || '-', g.routeLabel || '-', g.vehicleName || '-', g.travelDate || g.departAt || '-', String(g.totalBooked || 0), String(g.totalHeld || 0), g.status || 'active', { entity: 'manifest', id: g.scheduleId || '', detail: { entity: 'manifest', manifest: g, schedule: { id: g.scheduleId, status: g.status }, routeLabel: g.routeLabel, vehicleName: g.vehicleName, travelDate: g.travelDate, totalBooked: g.totalBooked, totalHeld: g.totalHeld, status: g.status } }]), 'generic');
    const busPassengerRows = (data.bookedSeatGroups || []).flatMap(g => (g.seats || []).map(seat => [
      seat.seatNumber || '-',
      seat.passengerName || 'Passenger pending',
      seat.bookingRef || '-',
      seat.passengerPhone || '-',
      seat.paymentStatus || '-',
      seat.checkInStatus || '-',
      seat.status || '-',
      { entity: 'manifest_passenger', id: seat.bookingRef || `${g.scheduleId}:${seat.seatNumber}`, label: seat.passengerName || seat.seatNumber || 'Passenger', detail: { entity: 'manifest_passenger', manifest: g, seat, schedule: { id: g.scheduleId, status: g.status }, routeLabel: g.routeLabel, vehicleName: g.vehicleName, travelDate: g.travelDate } }
    ]));
    fillTable('#companyBusPassengerManifestTable', busPassengerRows, 'generic');
    fillTable('#companyHotelManifestTable', data.hotelManifestAll || [], 'generic');
    fillTable('#companyHotelArrivalsTable', data.hotelArrivals || [], 'generic');
    fillTable('#companyHotelDeparturesTable', data.hotelDepartures || [], 'generic');
    fillTable('#companyHotelInHouseTable', data.hotelInHouse || [], 'generic');
    fillTable('#companyCheckinsTable', data.checkins || [], 'generic');
    fillTable('#companyReviewsTable', data.reviews || [], 'generic');
    fillTable('#companyRevenueTable', data.revenueDrilldown || data.payouts || [], 'generic');
    fillTable('#companySettlementBatchTable', data.settlementBatches || [], 'generic');
    fillTable('#companySettlementLedgerTable', data.settlementLedger || [], 'generic');
    fillTable('#companyPayoutRequestTable', data.payoutRequests || [], 'generic');
    fillTable('#companyFinanceStatementTable', data.financeStatements || [], 'generic');
    initDashboardFilters(document);

    serviceDashboards.forEach(service => {
      const key = String(service.key || '').replace(/-/g, '');
      const rx = new RegExp(service.serviceType || service.label || service.key, 'i');
      const listingRows = (data.listings || []).filter(r => rx.test([...(rowCells(r) || []), rowMeta(r)?.serviceType || '', rowMeta(r)?.entity || ''].join(' ')));
      fillTable('#' + key + 'Table', listingRows, 'generic');
    });

    const categoryCounts = new Map();
    (data.listings || []).forEach(row => {
      const cells = rowCells(row);
      const meta = rowMeta(row) || {};
      const rawType = String(meta.serviceType || cells[1] || 'Other').trim();
      if (!rawType) return;
      const label = rawType.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
      categoryCounts.set(label, (categoryCounts.get(label) || 0) + 1);
    });
    fillBars('categoryBars', Array.from(categoryCounts.entries()).sort((a, b) => b[1] - a[1]));

    $$('.innerTabs').forEach(group => {
      group.querySelectorAll('.tabBtn').forEach(btn => {
        btn.type = 'button';
        btn.setAttribute('role', 'tab');
        btn.onclick = function(event) {
          event.preventDefault();
          event.stopPropagation();
          activateTab(btn);
          return false;
        };
      });
      const firstActive = group.querySelector('.tabBtn.is-on') || group.querySelector('.tabBtn');
      if (firstActive) activateTab(firstActive, false);
    });

    enhanceTables();
    bindEvents();
    const initialPage = shell.activePage || new URLSearchParams(window.location.search).get('page') || String(window.location.hash || '').replace('#', '') || 'overview';
    showPage(initialPage);
    window.addEventListener('popstate', function () {
      const fromPath = String(window.location.pathname || '').split('/').filter(Boolean).pop();
      const page = String(window.location.hash || '').replace('#', '') || (fromPath === 'dashboard' ? 'overview' : fromPath) || 'overview';
      showPage(page);
    });
    window.ClassicTripDashboardReady = true;
  }

  try {
    init();
  } catch (error) {
    console.error('Classic Trip dashboard failed to initialize:', error);
    toast('Dashboard could not load. Check server data and permissions.');
  }
});
