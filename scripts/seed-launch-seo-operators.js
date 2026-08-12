'use strict';

require('dotenv').config();
const { connectDb, mongoose } = require('../src/config/db');
const User = require('../src/models/User');
const Company = require('../src/models/Company');
const Listing = require('../src/models/Listing');
const Route = require('../src/models/Route');
const CompanyBranch = require('../src/models/CompanyBranch');
const CompanyEmployee = require('../src/models/CompanyEmployee');
const BlogPost = require('../src/models/BlogPost');
const RouteStop = require('../src/models/RouteStop');
const RouteSegment = require('../src/models/RouteSegment');
const FareProduct = require('../src/models/FareProduct');
const BusSegmentFare = require('../src/models/BusSegmentFare');
const Vehicle = require('../src/models/Vehicle');
const TripSchedule = require('../src/models/TripSchedule');
const busSetupService = require('../src/modules/bus/services/busSetupService');
const busDepartureService = require('../src/modules/bus/services/busDepartureService');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { employeePermissions } = require('../src/config/accessControl');
const { SEEDED_OPERATOR_IMAGES: OPERATOR_IMAGES, SEEDED_BLOG_IMAGES: BLOG_IMAGES, isLegacySeedBlogUrl, isLegacySeedOperatorUrl } = require('../src/utils/seedMedia');

const apply = process.argv.includes('--apply');
const SEEDED_AT = '2026-08-11T17:20:00.000Z';
const SOURCE_KEY = 'classic-trip-v1.6.44-launch-research';
const resetPartnerPasswords = process.argv.includes('--reset-partner-passwords');
const CREDENTIALS_DIR = path.join(__dirname, '..', 'seed-output');
const CREDENTIALS_PATH = path.join(CREDENTIALS_DIR, 'partner-credentials.json');



function seededMedia(url, alt, label = alt) {
  return [{ url, secureUrl: url, publicId: `seed:${url}`, resourceType: 'image', alt, label, status: 'pending_review' }];
}

function slug(value = '') {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}
function uniq(values = []) { return [...new Set(values.filter(Boolean))]; }
function pair(origin, destination, extra = {}) { return { origin, destination, ...extra }; }
function withReverse(routes = []) {
  const out = [];
  for (const row of routes) {
    out.push(row);
    if (row.reverse !== false) out.push({ ...row, origin: row.destination, destination: row.origin, inferredReverse: true, fare: undefined, fareClass: undefined });
  }
  const seen = new Set();
  return out.filter((row) => { const key = `${row.origin}|${row.destination}`.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
}

const operators = [
  {
    key: 'bebeto-coach-services', name: 'Bebeto Coach Services', country: 'Uganda', city: 'Kampala', website: 'https://bebetocoachservices.com/',
    description: 'Cross-border coach operator serving major East African corridors. Public operator information is preloaded for Super Admin review; operational schedules, vehicle compliance and final fares must be confirmed by the operator before publication.',
    contacts: { phone: '+256741085037', reservations: '+256741085037', ugandaOffice: '+256760521979', kampala: '+256741085037', nairobi: '+254751237534' },
    amenities: ['Reclining seats', 'WiFi', 'Power outlets', 'Air conditioning'],
    sources: [
      { label: 'Bebeto official website', url: 'https://bebetocoachservices.com/', confidence: 'official' },
      { label: 'Bebeto destinations and offices', url: 'https://bebetocoachservices.com/destinations', confidence: 'official' },
    ],
    terminals: [
      ['Kampala', 'Bebeto Kampala — Namayiba Park', 'Namayiba Park, Kampala', 'terminal', 'active'],
      ['Nairobi', 'Bebeto Nairobi — River Road', 'River Road, opposite Kampala Business Centre, Nairobi', 'terminal', 'active'],
      ['Juba', 'Bebeto Juba — Konyokonyo', 'Konyokonyo, Juba', 'terminal', 'active'],
    ],
    routes: withReverse([
      pair('Kampala', 'Nairobi', { fare: 120000, fareClass: 'Economic Class VIP', currency: 'UGX', source: 'official' }),
      pair('Nairobi', 'Juba', { reverse: false, source: 'official' }),
      pair('Nairobi', 'Kakuma', { reverse: false, source: 'official' }),
      pair('Nairobi', 'Kigali', { source: 'official' }),
      pair('Kampala', 'Juba', { fare: 140000, fareClass: 'Economic Class VIP', currency: 'UGX', source: 'official' }),
    ]),
  },
  {
    key: 'trinity-express', name: 'Trinity Express', country: 'Uganda', city: 'Kampala', website: 'https://trinity-express.com/',
    description: 'Regional and cross-border coach operator. Routes are seeded from current public route/booking references and must be reconciled with the operator’s signed Classic Trip onboarding schedule before publication.',
    contacts: { phone: '+256747180552', whatsapp: '+256747180552', kampala: '+256747180552', kampalaOffice: '+256751494564 / +256756389102', nairobi: '+254755356109' },
    amenities: ['Cross-border travel', 'Courier service'],
    sources: [
      { label: 'Trinity Express route site', url: 'https://trinity-express.com/', confidence: 'public_operator_site' },
      { label: 'Trinity Express public social contact', url: 'https://www.instagram.com/trinity_express_bus_ltd/', confidence: 'public_social' },
      { label: 'Trinity Kenya public route site', url: 'https://trinityexpressbuske.com/', confidence: 'public_operator_site' },
    ],
    terminals: [
      ['Kampala', 'Trinity Kampala Bus Terminal', 'Kampala central booking terminal — exact bay/address to be confirmed by Trinity', 'terminal', 'paused'],
      ['Kigali', 'Trinity Kigali — Nyabugogo', 'Nyabugogo Taxi Park, Kigali — confirm bay/office', 'terminal', 'paused'],
    ],
    routes: withReverse([
      pair('Kigali', 'Kampala', { fare: 110000, fareClass: 'Standard', currency: 'UGX', source: 'booking_reference' }),
      pair('Kigali', 'Mbarara', { source: 'public_route_reference' }),
      pair('Kigali', 'Nairobi', { source: 'public_operator_site' }),
      pair('Kampala', 'Nairobi', { fare: 100000, fareClass: 'Standard', currency: 'UGX', source: 'booking_reference' }),
      pair('Kampala', 'Juba', { fare: 130000, fareClass: 'Standard', currency: 'UGX', source: 'booking_reference' }),
      pair('Juba', 'Bor', { source: 'public_operator_site' }),
    ]),
  },
  {
    key: 'zawadi-travel-service', name: 'Zawadi Travel Service', country: 'Uganda', city: 'Kampala', website: 'https://zawadigroups.com/transport/',
    description: 'Ugandan passenger transport business serving West Nile and northern Uganda. Official Zawadi office/contact data is seeded; route coverage from public booking references remains subject to operator confirmation before publication.',
    contacts: { phone: '+256773338374', email: 'info@zawadigroups.com' },
    amenities: ['Intercity travel', 'West Nile network'],
    sources: [
      { label: 'Zawadi Group transport', url: 'https://zawadigroups.com/transport/', confidence: 'official' },
      { label: 'Zawadi public route catalogue', url: 'https://safarishare.com/operators/zawadi', confidence: 'booking_reference' },
    ],
    terminals: [
      ['Kampala', 'Zawadi Kampala Office', 'Kobil Bombo Road, Kampala', 'office', 'active'],
      ['Adjumani', 'Zawadi Adjumani Office', 'Plot 14 Zawadi Services, Magni Road, Adjumani', 'terminal', 'active'],
    ],
    routes: withReverse([
      pair('Kampala', 'Adjumani', { fare: 55000, fareClass: 'Standard', currency: 'UGX', source: 'booking_reference' }),
      pair('Kampala', 'Gulu', { fare: 40000, fareClass: 'Standard', currency: 'UGX', source: 'booking_reference' }),
      pair('Kampala', 'Moyo', { fare: 60000, fareClass: 'Standard', currency: 'UGX', source: 'booking_reference' }),
      pair('Kampala', 'Nebbi', { source: 'booking_reference' }),
      pair('Kampala', 'Arua', { source: 'booking_reference' }),
      pair('Kampala', 'Pakwach', { source: 'booking_reference' }),
    ]),
  },
  {
    key: 'eco-bus', name: 'ECO Bus', country: 'Uganda', city: 'Kampala', website: 'https://www.ecobus.ss/',
    description: 'East African and South Sudan coach operator. Public route and office information is seeded for onboarding review; exact departure times, vehicle assignments and compliance documents remain operator-controlled.',
    contacts: { phone: '+256782393125', whatsapp: '+256776888055', kampala: '+256782393125', juba: '0926388115 / 0921307724', nairobi: '+254140342959 / +254140344198' },
    amenities: ['Cross-border travel', 'Intercity travel'],
    sources: [
      { label: 'ECO Bus official website', url: 'https://www.ecobus.ss/', confidence: 'official' },
      { label: 'ECO Bus contact page', url: 'https://ecobus.ss/contact', confidence: 'official' },
      { label: 'ECO public route references', url: 'https://www.facebook.com/61584384810165/', confidence: 'public_social' },
    ],
    terminals: [
      ['Kampala', 'ECO Kampala Office', 'Kampala terminal address — confirm operator bay before activation', 'terminal', 'paused'],
      ['Juba', 'ECO Juba Office — Atlabara', 'Atlabara, opposite University of Juba, Juba', 'terminal', 'active'],
      ['Nimule', 'ECO Nimule — Malakia', 'Malakia Station 5, Nimule — confirm exact bay', 'terminal', 'paused'],
    ],
    routes: withReverse([
      pair('Kampala', 'Juba', { fare: 120000, fareClass: 'Standard', currency: 'UGX', source: 'public_social' }),
      pair('Juba', 'Bor', { source: 'official' }),
      pair('Juba', 'Nimule', { source: 'official' }),
      pair('Juba', 'Nairobi', { source: 'public_operator_reference' }),
      pair('Nairobi', 'Kampala', { source: 'public_operator_reference' }),
    ]),
  },
  {
    key: 'friendship-bus', name: 'Friendship Bus', country: 'Uganda', city: 'Kampala', website: 'https://safarishare.com/operators/friendshipbus',
    description: 'Passenger coach service on Uganda and South Sudan corridors. Route data is preloaded from current public booking references and is intentionally held for operator confirmation before going live.',
    contacts: { publicBookingProfile: 'SafariShare / operator confirmation required' }, amenities: ['Intercity travel', 'Cross-border travel'],
    sources: [
      { label: 'Friendship Bus public route catalogue', url: 'https://safarishare.com/operators/friendshipbus', confidence: 'booking_reference' },
      { label: 'Kampala–Juba booking reference', url: 'https://booking.ttta.co.ug/book-friendship-bus-juba-to-kampala-tba-online/', confidence: 'booking_reference' },
    ],
    terminals: [
      ['Kampala', 'Friendship Kampala — Namayiba', 'Namayiba Bus Park, Kampala — confirm office/bay', 'terminal', 'paused'],
      ['Juba', 'Friendship Juba — Sherikat', 'Sherikat, Juba — confirm exact terminal', 'terminal', 'paused'],
    ],
    routes: withReverse([
      pair('Kampala', 'Arua', { fare: 50000, fareClass: 'Standard', currency: 'UGX', source: 'booking_reference' }),
      pair('Kampala', 'Juba', { fare: 120000, fareClass: 'Standard', currency: 'UGX', source: 'booking_reference' }),
      pair('Kampala', 'Magwi', { fare: 70000, fareClass: 'Standard', currency: 'UGX', source: 'booking_reference' }),
      pair('Kampala', 'Nebbi', { fare: 50000, fareClass: 'Standard', currency: 'UGX', source: 'booking_reference' }),
    ]),
  },
  {
    key: 'yy-coaches', name: 'YY Coaches', country: 'Uganda', city: 'Kampala', website: 'https://www.facebook.com/yycoaches/',
    description: 'Ugandan intercity coach operator serving eastern, northern and West Nile destinations. Public route data is seeded for Super Admin/operator review before live schedules and inventory are enabled.',
    contacts: { phone: '+256772268804', alternatePhone: '+256705764476', bookingReferencePhones: '+256776833837 / +256776888055' }, amenities: ['Intercity travel', 'Courier service'],
    sources: [
      { label: 'YY Coaches public route catalogue', url: 'https://safarishare.com/operators/yycoaches', confidence: 'booking_reference' },
      { label: 'YY Coaches route reference', url: 'https://www.bookaway.com/suppliers/yy-coaches', confidence: 'booking_reference' },
      { label: 'YY Coaches public route updates', url: 'https://www.facebook.com/yycoaches/', confidence: 'public_social' },
    ],
    terminals: [
      ['Kampala', 'YY Bus Terminal — Kampala', 'Sir Apollo Kaggwa Road, next to Daily Loaf bakery, Kampala — confirm current bay with YY Coaches', 'terminal', 'active'],
      ['Mbale', 'YY Mbale Bus Park', 'Mbale Bus Park, Mbale — confirm current office/bay', 'terminal', 'active'],
      ['Lira', 'YY Lira Terminal', 'Lira — confirm exact terminal address', 'terminal', 'paused'],
      ['Arua', 'YY Arua Terminal', 'Arua — confirm exact terminal address', 'terminal', 'paused'],
    ],
    routes: withReverse([
      pair('Kampala', 'Apac', { fare: 40000, fareClass: 'Standard', currency: 'UGX', source: 'booking_reference' }),
      pair('Kampala', 'Arua', { fare: 50000, fareClass: 'Standard', currency: 'UGX', source: 'booking_reference' }),
      pair('Kampala', 'Iganga', { fare: 20000, fareClass: 'Standard', currency: 'UGX', source: 'booking_reference' }),
      pair('Kampala', 'Jinja', { fare: 15000, fareClass: 'Standard', currency: 'UGX', source: 'booking_reference' }),
      pair('Kampala', 'Koboko', { fare: 70000, fareClass: 'Standard', currency: 'UGX', source: 'booking_reference' }),
      pair('Kampala', 'Kumi', { fare: 30000, fareClass: 'Standard', currency: 'UGX', source: 'booking_reference' }),
      pair('Kampala', 'Lira', { fare: 30000, fareClass: 'Standard', currency: 'UGX', source: 'booking_reference' }),
      pair('Kampala', 'Mbale', { fare: 25000, fareClass: 'Standard', currency: 'UGX', source: 'booking_reference' }),
      pair('Kampala', 'Soroti', { fare: 35000, fareClass: 'Standard', currency: 'UGX', source: 'booking_reference' }),
      pair('Kampala', 'Wakiso', { fare: 15000, fareClass: 'Standard', currency: 'UGX', source: 'booking_reference' }),
      pair('Kampala', 'Yumbe', { fare: 70000, fareClass: 'Standard', currency: 'UGX', source: 'booking_reference' }),
      pair('Kampala', 'Kitgum', { source: 'public_social' }),
    ]),
  },
];

const blogs = [
  {
    slug: 'how-to-book-bus-tickets-online-uganda-east-africa', tag: 'Bus Booking Guide',
    title: 'How to Book Bus Tickets Online in Uganda and East Africa',
    excerpt: 'A practical guide to comparing routes, choosing a real departure, selecting a seat, paying securely and keeping your digital ticket for travel across Uganda and East Africa.',
    body: `Booking a bus ticket should not require several phone calls, uncertain seat promises or a last-minute trip to a crowded terminal. Classic Trip is designed to make intercity and cross-border bus travel easier to compare and safer to confirm from one place.

Start with the actual journey you need. On Classic Trip, search the Buses marketplace using your From location, To location and travel date. Route selectors are based on transport data available on the platform, helping reduce spelling mistakes and searches for journeys that do not exist. When a partner has published a live departure, you can compare the operator, departure time, boarding point, drop-off point, ticket class and available seats before continuing.

Choose the right boarding and drop-off points carefully. A Kampala-to-Juba route, for example, may have intermediate stops. The fare for the full origin-to-destination journey can be different from the fare for a passenger boarding or leaving in the middle. Classic Trip calculates the selected journey from the actual route and departure rather than assuming every passenger pays the same amount.

Next, select your seat from the live seat map. Available, held, booked and blocked seats are tracked separately so that a seat already secured by another passenger is not presented as freely available. If you are making a return journey, select Return and choose an available reverse departure independently; the return bus does not need to leave at the same clock time as the outbound trip.

You can continue as a guest. Enter accurate passenger contact details because the confirmed ticket can be delivered through the channels configured on the platform, including email, SMS and WhatsApp. Your secure Classic Trip ticket page remains the authoritative place to view the booking and ticket details.

At payment, always follow the payment page opened by Classic Trip and do not send money to personal numbers shared by strangers. Classic Trip verifies supported provider transactions server-side before marking a booking paid. A browser redirect by itself is not proof that payment succeeded.

Before travelling, reopen your ticket and check the company, route, date, departure time, terminal, passenger name and seat. Arrive early enough for operator check-in and border procedures where relevant. Cross-border travelers should carry the documents required for their nationality and destination.

Use /buses to start a bus search, /routes to explore published corridors, and /support if a confirmed booking needs assistance. The goal is simple: compare a real trip, reserve a real seat, pay through the supported checkout, and travel with a ticket you can retrieve again.`,
  },
  {
    slug: 'kampala-to-juba-bus-travel-guide', tag: 'Route Guide',
    title: 'Kampala to Juba by Bus: Booking, Seats, Borders and Travel Checklist',
    excerpt: 'Planning a Kampala–Juba bus journey? Use this checklist to compare live departures, select the correct terminal and seat, prepare for the border and keep your ticket accessible.',
    body: `The Kampala–Juba corridor is one of the most important cross-border road journeys connecting Uganda and South Sudan. A good trip begins before boarding: choose a currently published departure, understand where the coach starts and stops, and confirm the exact ticket you are buying.

Search Kampala to Juba on Classic Trip using /buses. Results are based on operators and departures published on the platform. Do not rely only on an old social-media poster because departure times, terminals, fares and vehicle assignments can change. The live booking flow is the better source for the trip being sold on a specific date.

Compare more than the headline fare. Look at the ticket class, departure time, boarding terminal, drop-off point, seat availability, baggage rules and operator instructions. A lower fare is not useful if it is attached to the wrong terminal or travel date. If the operator has Standard and premium classes, read what is actually included before paying.

For a return journey, the Juba-to-Kampala departure is selected separately. Classic Trip searches for an available reverse service rather than demanding an identical departure time. This matters because the return timetable may be completely different from the outbound timetable.

Cross-border passengers should prepare valid travel documents before the day of travel. Entry, visa, health and identification requirements depend on nationality and can change, so confirm current requirements with the relevant authorities. Keep originals accessible rather than packing essential documents deep inside checked luggage.

On travel day, reach the confirmed terminal early. Border travel can involve passenger checks, luggage handling and immigration procedures. Keep your phone charged and save your Classic Trip ticket so you can reopen it if an operator needs the booking reference or QR details.

Classic Trip may display several operators on the corridor as they complete platform verification and publish live inventory. Inclusion in a draft company profile is not the same as a live departure: only a published, bookable departure should be treated as available for purchase.

Use /routes for the currently published corridor directory, /companies to review verified operator profiles, and /support for booking assistance. The strongest travel plan is the one based on the exact departure you booked—not a timetable remembered from a previous trip.`,
  },
  {
    slug: 'kampala-to-nairobi-bus-travel-guide', tag: 'Route Guide',
    title: 'Kampala to Nairobi by Bus: How to Choose and Book the Right Coach',
    excerpt: 'A customer-first Kampala–Nairobi bus guide covering live departures, seat selection, ticket classes, terminals, cross-border preparation and secure online payment.',
    body: `Travel between Kampala and Nairobi is competitive, which is good for passengers—but it also means there can be many different departure times, ticket classes, terminals and operator offers. The best booking is not automatically the cheapest one. It is the one whose route, date, terminal, seat and service conditions match the journey you actually want.

Begin at /buses and select Kampala as your origin and Nairobi as your destination. Choose your intended date and compare the departures that are actually published. If you are flexible, compare nearby dates rather than assuming the schedule is identical every day.

Check the terminal before checkout. Kampala has multiple bus parks and operator offices, while Nairobi operators can use different boarding areas. Your ticket should identify the boarding and drop-off points attached to the departure. If an operator changes operational details, rely on the latest confirmed booking information and official communication rather than an old screenshot.

Use the seat map instead of asking an agent to promise an unspecified seat. A live seat system helps distinguish seats that are available from those already booked, held or blocked by the operator. For groups, select the required seats in one transaction when possible so the travelers are not split across the coach.

If the trip is cross-border, carry the documents required for entry into Kenya and re-entry to Uganda where applicable. Requirements vary by traveler and can change, so verify them with the relevant immigration authorities before departure.

Classic Trip supports guest booking, so creating an account should not be a barrier to buying an eligible ticket. Accurate phone and email details remain important because they are used for booking communication and ticket delivery. Keep access to the phone number or email used during checkout.

Payment should always be tied to the booking reference shown by Classic Trip. The platform treats provider callbacks as untrusted until the payment provider confirms the transaction status server-side. This protects the booking flow from being marked paid simply because someone opened a success-looking URL.

For your next journey, compare live trips on /buses, explore corridors on /routes and review approved operators under /companies. Book the departure that fits your travel plan, then keep the digital ticket available until the journey is complete.`,
  },
  {
    slug: 'uganda-bus-travel-gulu-lira-arua-soroti-mbale-guide', tag: 'Uganda Travel',
    title: 'Uganda Bus Travel Guide: Gulu, Lira, Arua, Soroti, Mbale and Beyond',
    excerpt: 'How to compare and book major northern, West Nile and eastern Uganda bus corridors using real routes, boarding points, dated departures and digital tickets.',
    body: `Uganda’s intercity bus network connects Kampala with major commercial and regional centres including Gulu, Lira, Arua, Soroti and Mbale. Travelers also continue to destinations such as Pakwach, Nebbi, Koboko, Yumbe, Apac, Kumi, Jinja and Iganga. The challenge is often not finding a bus company—it is finding the correct departure, terminal and fare for the specific part of the route you need.

Classic Trip organizes travel around routes and dated departures. Search /buses using the location selectors instead of typing an arbitrary route name. When operator data is live, the platform can show which journeys are actually available and which boarding/drop-off choices belong to the selected route.

This is especially important on multi-stop routes. A passenger travelling Kampala to the final destination may pay a different fare from a passenger boarding later or leaving earlier. Classic Trip keeps full-route and intermediate-stop pricing distinct so a company can publish the correct fare for each passenger journey.

Northern and West Nile corridors can share parts of the same road network while serving different destinations. Do not assume a bus to Arua automatically serves every town on a different operator’s route. Select the exact boarding and drop-off points displayed for the departure.

For eastern Uganda journeys, route names such as Kampala–Jinja, Kampala–Iganga, Kampala–Mbale or Kampala–Soroti may look straightforward, but departure times and stopping patterns can vary. Check the date and terminal attached to the live departure before paying.

If you travel frequently, an online ticket gives you a reusable record of the booking details instead of depending only on a paper receipt. Guest travelers can still access their secure ticket after payment, while registered customers can also keep travel activity inside the platform account experience.

Operators joining Classic Trip pass through review and publication controls. A company record or researched route does not automatically mean the route is bookable: vehicles, fares, schedules and required compliance must be completed before live inventory is published.

Use /routes to discover corridors already available on Classic Trip and /companies to see approved operator profiles. If your destination is not yet bookable, check again as partners add their verified schedules rather than sending money outside the protected booking flow.`,
  },
  {
    slug: 'east-africa-cross-border-bus-travel-checklist', tag: 'Travel Checklist',
    title: 'East Africa Cross-Border Bus Travel Checklist: Before You Book and Before You Board',
    excerpt: 'A practical checklist for regional bus travelers covering documents, live schedules, terminals, tickets, payments, luggage, border time and communication.',
    body: `Cross-border coach travel can be affordable and convenient, but it has more moving parts than a domestic trip. A little preparation prevents many common problems.

First, verify the exact route and travel date. Cross-border timetables can change because of demand, border operations, vehicle availability and operator decisions. Search a dated departure rather than relying on a timetable copied months ago.

Second, confirm your travel documents. Passport, visa, identity, health and entry requirements depend on nationality and destination. Classic Trip is a booking platform, not an immigration authority, so travelers should verify current requirements through the relevant government sources before travel.

Third, confirm both terminals. A company may have different offices, boarding parks and city drop-off points. Read the ticket and operator instructions for the booked departure. If a location is still marked as requiring operator confirmation, it should not be treated as a final live boarding point.

Fourth, select your seat and ticket class carefully. Standard, premium or other class names mean different things between operators. Pay for the class shown on the actual departure and keep the confirmation.

Fifth, use the supported payment checkout. Do not treat a screenshot, browser redirect or unsolicited message as proof of payment. Classic Trip verifies configured payment-provider transactions against the booking reference, amount and currency before confirming the ticket.

Sixth, give accurate contact information. Cross-border trips are exactly the kind of journeys where a schedule or terminal notice may matter. A valid phone number and email also help deliver and recover the ticket.

Seventh, prepare for border time. Published journey durations are estimates, not guarantees. Immigration queues, security checks, road conditions and passenger processing can affect arrival time. Avoid planning a tightly timed onward connection based only on the advertised driving duration.

Eighth, understand baggage rules. Operators can have different baggage allowances and procedures for parcels or commercial goods. If you are carrying unusual or high-volume luggage, confirm acceptance before arriving at the terminal.

Finally, keep your ticket accessible until the trip is complete. A secure web ticket is easier to recover than a single screenshot lost with a phone gallery cleanup. Start at /buses, review /how-it-works if you are new to Classic Trip, and use /support for a booking that needs platform assistance.`,
  },
  {
    slug: 'how-classic-trip-secure-online-bus-booking-payments-tickets', tag: 'Trust & Safety',
    title: 'How Classic Trip Protects Online Bus Booking, Payments and Digital Tickets',
    excerpt: 'Understand the safeguards behind seat holds, verified payment status, guest ticket access, operator publication controls and booking notifications.',
    body: `A travel marketplace earns trust by making the important parts of a booking verifiable. Classic Trip is built around that principle: the customer should know which departure is being booked, which seat is being held, how payment is confirmed and where the ticket can be recovered.

For bus travel, availability begins with a dated departure and persisted seat inventory. A seat can move through states such as available, held, booked or blocked. The booking flow should not sell a seat that another confirmed passenger already owns.

Payment confirmation is separate from a browser success page. Payment providers redirect customers through browser URLs, but a redirect can be copied or manipulated. Classic Trip therefore uses server-side provider verification and checks the booking reference, transaction reference, amount and currency before applying a successful payment transition.

The payment webhook path is idempotent. This matters because payment providers can retry the same notification. Repeated notifications should not create repeated payments, repeated seat ownership or multiple copies of the same business event.

Guest booking is supported without making guest tickets public. A traveler can complete a booking without creating an account, while access to the resulting ticket remains protected through the guest booking access mechanism. Email, SMS and WhatsApp delivery can point the traveler back to that protected Classic Trip ticket page.

Operator publication is also controlled. Researching or creating a company profile is not the same as verifying the company. Bus listings require the operational data needed for a real booking—such as routes, fares, usable vehicle/seat setup and future departures—before publication can be considered ready.

Classic Trip also records operational notifications for important events such as confirmed bookings. Partner and platform administrators can receive in-app or push alerts according to the configured notification channels.

No online platform can promise zero risk, and customers should still protect their own credentials and devices. Classic Trip’s objective is defense in depth: minimize trust in browser-controlled data, validate money server-side, isolate inventory changes, preserve audit trails and give the traveler a secure place to retrieve the ticket.

Use /how-it-works for the customer flow, /privacy for data-handling information and /support if something about a booking does not match the confirmed ticket.`,
  },
  {
    slug: 'when-to-book-bus-tickets-uganda-holidays-weekends-night-travel', tag: 'Booking Tips',
    title: 'When to Book Bus Tickets in Uganda: Weekends, Holidays and High-Demand Travel',
    excerpt: 'A practical strategy for getting the departure and seat you want during weekends, holidays, school travel, cross-border peaks and busy evening services.',
    body: `The best time to buy a bus ticket is not defined by one universal number of days. It depends on how flexible you are and how quickly the departure you want is filling.

If you must travel on a specific evening, holiday, school opening/closing period or major weekend, book earlier than you would for an ordinary midweek trip. High-demand dates reduce your choice of seats and departure times first, even when another bus may still be available later.

Use live availability instead of guessing. Search /buses for your actual date and inspect the departures shown. If your preferred service has only a few suitable seats remaining, waiting for a theoretical last-minute discount may leave you with a worse departure or no seat together with your group.

For groups and families, earlier booking matters more because several adjacent seats are harder to find than one seat. Reserve the required passenger seats in the same booking where possible.

Night departures deserve extra attention to the date. A bus leaving at 11:00 PM belongs to a specific calendar date even though much of the journey happens the following morning. Check the departure date and time on the ticket rather than referring only to “tonight.”

Cross-border trips should be booked only after you have checked travel-document requirements. Buying very early does not help if a required document will not be ready. Once your documents and travel plan are certain, secure the departure that fits your border and arrival expectations.

Price is only one part of value. A slightly cheaper departure can cost more overall if it requires an expensive late-night transfer to a distant terminal or arrives at a time that creates an unsafe or inconvenient onward journey. Compare the complete trip.

Classic Trip’s marketplace is designed to show real published inventory as partner operators add it. If you cannot find the route today, do not pay an unknown person claiming to hold an invisible Classic Trip seat. Check /routes and /companies, or return when the operator has published the departure.

A simple booking strategy works well: decide the journey, confirm documents where needed, compare live departures, choose the right terminal and seat, pay through the supported checkout, and keep the digital ticket accessible.`,
  },
];


const staffRoles = ['Terminal Manager', 'Booking Agent', 'Dispatcher', 'Customer Care', 'Driver Coordinator'];
const rolePermissionDefaults = {
  'Terminal Manager': ['booking.view','manifest.view','inventory.update','schedule.update','schedule.delay_notice','reports.view'],
  'Booking Agent': ['booking.view','booking.create_manual','checkin.manage','manifest.view','customer.note'],
  'Dispatcher': ['booking.view','manifest.view','schedule.update','schedule.delay_notice','trip.status.update','incident.create'],
  'Customer Care': ['booking.view','support.manage','support.note','customer.note','refund.request'],
  'Driver Coordinator': ['booking.view','manifest.view','trip.status.update','incident.create','reports.view'],
};
function partnerLoginEmail(operator) { return `partner.${operator.key}@classictrip.org`; }
function generateTemporaryPassword() { return `${crypto.randomBytes(12).toString('base64url')}!A7`; }
function isBlank(value) { return value === undefined || value === null || String(value).trim() === ''; }
function placeholderName(operator, roleTitle) { return `Unassigned ${roleTitle} — ${operator.name}`; }
async function saveCredentials(rows = []) {
  const generated = rows.filter((row) => row && row.temporaryPassword);
  if (!generated.length || !apply) return;
  fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
  fs.writeFileSync(CREDENTIALS_PATH, `${JSON.stringify({ generatedAt: new Date().toISOString(), warning: 'Temporary seeded Partner Admin credentials. Change each password after first login and delete this file.', accounts: generated }, null, 2)}\n`, { mode: 0o600 });
}
async function ensurePartnerAdmin(operator, company, counts, credentialRows) {
  const companyId = company.id || String(company._id || '');
  const email = partnerLoginEmail(operator);
  let user = company.ownerId ? await User.findById(company.ownerId).catch(() => null) : null;
  if (!user) user = await User.findOne({ $or: [{ companyId, role: 'company_admin' }, { email }] });
  let temporaryPassword = '';
  if (!user) {
    temporaryPassword = generateTemporaryPassword();
    user = await User.create({
      role: 'company_admin', fullName: `${operator.name} Partner Admin`, email, phone: operator.contacts?.phone || operator.contacts?.kampala || '',
      passwordHash: await bcrypt.hash(temporaryPassword, 12), status: 'active', isVerified: false, companyId,
      verificationStatus: 'pending', onboardingStatus: 'company_verification',
      authProviders: { local: { enabled: true }, google: { enabled: false } },
      profileCompletion: { seededLaunchAccount: true, passwordChangeRequired: true, seedSource: SOURCE_KEY, accountEmailMayBeEdited: true },
      passwordChangedAt: new Date(SEEDED_AT), createdAt: SEEDED_AT, updatedAt: SEEDED_AT,
    });
    counts.partnerAccounts += 1;
  } else if (resetPartnerPasswords && user.profileCompletion?.seededLaunchAccount) {
    temporaryPassword = generateTemporaryPassword();
    user.passwordHash = await bcrypt.hash(temporaryPassword, 12);
    user.authVersion = Number(user.authVersion || 0) + 1;
    user.passwordChangedAt = new Date();
    user.profileCompletion = { ...(user.profileCompletion || {}), passwordChangeRequired: true, seededLaunchAccount: true, seedSource: SOURCE_KEY };
    await user.save();
    counts.partnerPasswordsReset += 1;
  }
  if (isBlank(company.ownerId)) { company.ownerId = String(user.id); await company.save(); counts.enriched += 1; }
  credentialRows.push({ operator: operator.name, email: user.email || email, temporaryPassword: temporaryPassword || null, companyId, note: temporaryPassword ? 'Change after first login.' : 'Existing seeded account password unchanged. Use password reset or rerun with --reset-partner-passwords.' });
  return user;
}


function operatorTerminalMap(operator) {
  const map = new Map();
  for (const t of operator.terminals) map.set(String(t[0]).toLowerCase(), t);
  const cities = uniq(operator.routes.flatMap((r) => [r.origin, r.destination]));
  for (const city of cities) {
    if (!map.has(city.toLowerCase())) map.set(city.toLowerCase(), [city, `${operator.name} ${city} terminal — confirm`, `Exact ${operator.name} terminal address in ${city} pending operator confirmation`, 'terminal', 'paused']);
  }
  return [...map.values()];
}

async function insertOnly(Model, query, doc) {
  // Seed IDs are canonical. Check them before a looser semantic query so a
  // status/name change made after an older seed cannot produce E11000 when the
  // exact seeded record already exists.
  if (doc?.id) {
    const bySeedId = await Model.findOne({ id: doc.id });
    if (bySeedId) return { row: bySeedId, created: false };
  }
  const existing = await Model.findOne(query);
  if (existing) return { row: existing, created: false };
  if (!apply) return { row: doc, created: true };
  try {
    const row = await Model.create(doc);
    return { row, created: true };
  } catch (error) {
    if (error?.code === 11000 && doc?.id) {
      const raced = await Model.findOne({ id: doc.id });
      if (raced) return { row: raced, created: false };
    }
    throw error;
  }
}
async function enrichSeededDoc(row, patch = {}, counts) {
  if (!apply || !row || typeof row.save !== 'function') return row;
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null) continue;
    if (isBlank(row[key]) || (typeof row[key] === 'string' && /pending operator confirmation|confirm exact|— confirm/i.test(row[key]))) { row[key] = value; changed = true; }
  }
  if (changed) { row.updatedAt = new Date(); await row.save(); if (counts) counts.enriched += 1; }
  return row;
}


function fareClassValue(value = '') {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('vip')) return 'vip';
  if (normalized.includes('business')) return 'business';
  if (normalized.includes('executive')) return 'executive';
  if (normalized.includes('premium')) return 'premium';
  if (normalized.includes('express')) return 'express';
  if (normalized.includes('econom')) return 'economy';
  return 'standard';
}

async function ensureRouteInfrastructure({ operator, route, routeResearch, listing, originBranch, destinationBranch, superAdmin, counts }) {
  const companyId = route.companyId;
  let stops = await RouteStop.find({ companyId, routeId: route.id, status: { $ne: 'archived' } }).sort({ stopOrder: 1 });
  if (stops.length < 2) {
    await RouteStop.deleteMany({ companyId, routeId: route.id, id: { $regex: '^route-stop-seed-' } });
    const originStopId = `route-stop-seed-${operator.key}-${slug(routeResearch.origin)}-${slug(routeResearch.destination)}-origin`;
    const destinationStopId = `route-stop-seed-${operator.key}-${slug(routeResearch.origin)}-${slug(routeResearch.destination)}-destination`;
    const actor = superAdmin.id || String(superAdmin._id);
    const originStop = await RouteStop.findOneAndUpdate(
      { companyId, routeId: route.id, stopOrder: 1 },
      {
        $setOnInsert: {
          id: originStopId, routeId: route.id, listingId: listing.id, companyId,
          branchId: originBranch?.id || '', name: routeResearch.origin, stopType: 'origin',
          stopOrder: 1, timeOffsetMinutes: 0, pickupAllowed: true, dropoffAllowed: false,
          publicInstructions: 'Seeded route origin. Confirm the exact operator bay before publication.',
          status: 'active', createdBy: actor, createdAt: SEEDED_AT,
        },
      },
      { upsert: true, new: true },
    );
    const destinationStop = await RouteStop.findOneAndUpdate(
      { companyId, routeId: route.id, stopOrder: 2 },
      {
        $setOnInsert: {
          id: destinationStopId, routeId: route.id, listingId: listing.id, companyId,
          branchId: destinationBranch?.id || '', name: routeResearch.destination, stopType: 'destination',
          stopOrder: 2, timeOffsetMinutes: 0, pickupAllowed: false, dropoffAllowed: true,
          publicInstructions: 'Seeded route destination. Confirm the exact operator bay before publication.',
          status: 'active', createdBy: actor, createdAt: SEEDED_AT,
        },
      },
      { upsert: true, new: true },
    );
    stops = [originStop, destinationStop];
    counts.routeStops += 2;
  }

  stops = stops.sort((a, b) => Number(a.stopOrder) - Number(b.stopOrder));
  const originStop = stops[0];
  const destinationStop = stops[stops.length - 1];
  const existingSegments = await RouteSegment.find({ companyId, routeId: route.id, status: 'active' }).sort({ segmentOrder: 1 });
  let segments = existingSegments;
  if (existingSegments.length !== stops.length - 1) {
    await RouteSegment.deleteMany({ companyId, routeId: route.id });
    segments = [];
    for (let index = 0; index < stops.length - 1; index += 1) {
      const from = stops[index];
      const to = stops[index + 1];
      const segment = await RouteSegment.create({
        id: `route-segment-seed-${operator.key}-${slug(routeResearch.origin)}-${slug(routeResearch.destination)}-${index + 1}`,
        companyId, listingId: listing.id, routeId: route.id,
        fromStopId: from.id, toStopId: to.id, fromOrder: Number(from.stopOrder),
        toOrder: Number(to.stopOrder), segmentOrder: index, status: 'active',
        createdAt: SEEDED_AT, updatedAt: SEEDED_AT,
      });
      segments.push(segment);
    }
    counts.routeSegments += segments.length;
  }

  route.originStopId = originStop.id;
  route.destinationStopId = destinationStop.id;
  route.stopCount = stops.length;
  route.segmentCount = segments.length;
  route.boardingBranchIds = uniq(stops.filter((stop) => stop.pickupAllowed && stop.branchId).map((stop) => stop.branchId));
  route.dropoffBranchIds = uniq(stops.filter((stop) => stop.dropoffAllowed && stop.branchId).map((stop) => stop.branchId));
  route.boardingPoints = stops.filter((stop) => stop.pickupAllowed).map((stop) => stop.name);
  route.dropoffPoints = stops.filter((stop) => stop.dropoffAllowed).map((stop) => stop.name);
  await route.save();

  let fareProduct = null;
  if (Number(routeResearch.fare || 0) > 0) {
    const seededFareId = `fare-product-seed-${operator.key}-${slug(routeResearch.origin)}-${slug(routeResearch.destination)}`;
    fareProduct = await FareProduct.findOne({ companyId, routeId: route.id, id: seededFareId, status: 'active' });
    if (!fareProduct) {
      const operatorEditedFare = await FareProduct.findOne({ companyId, routeId: route.id, status: 'active' });
      if (operatorEditedFare) return { stops, segments, fareProduct: null, operatorEditedFarePreserved: true };
      fareProduct = await FareProduct.create({
        id: seededFareId,
        companyId, listingId: listing.id, routeId: route.id,
        name: `${routeResearch.origin} ⇄ ${routeResearch.destination} ${routeResearch.fareClass || 'Standard'} review fare`,
        fareClass: fareClassValue(routeResearch.fareClass),
        currency: String(routeResearch.currency || listing.currency || 'UGX').toUpperCase(),
        refundable: false, changeable: false, baggageAllowanceKg: 0,
        status: 'active', createdBy: superAdmin.id || String(superAdmin._id), updatedBy: superAdmin.id || String(superAdmin._id),
        createdAt: SEEDED_AT, updatedAt: SEEDED_AT,
      });
      counts.fareProducts += 1;
    }
    const existingFare = await BusSegmentFare.findOne({
      companyId, fareProductId: fareProduct.id, fromStopId: originStop.id, toStopId: destinationStop.id,
    });
    if (!existingFare) {
      await BusSegmentFare.create({
        id: `segment-fare-seed-${operator.key}-${slug(routeResearch.origin)}-${slug(routeResearch.destination)}`,
        companyId, listingId: listing.id, routeId: route.id, fareProductId: fareProduct.id,
        fromStopId: originStop.id, toStopId: destinationStop.id,
        fromOrder: Number(originStop.stopOrder), toOrder: Number(destinationStop.stopOrder),
        amount: Number(routeResearch.fare), currency: String(routeResearch.currency || listing.currency || 'UGX').toUpperCase(),
        status: 'active', createdAt: SEEDED_AT, updatedAt: SEEDED_AT,
      });
      counts.segmentFares += 1;
    }
    if (!route.activeFareProductId) {
      route.activeFareProductId = fareProduct.id;
      await route.save();
    }
  }
  return { stops, segments, fareProduct };
}

async function ensureSeedReviewVehicle(operator, company, listing, superAdmin, counts) {
  const companyId = company.id || String(company._id);
  const plateOrCode = `REVIEW-${slug(operator.key).replace(/-/g, '').slice(0, 18).toUpperCase()}`;
  let vehicle = await Vehicle.findOne({ companyId, listingId: listing.id, plateOrCode, status: { $ne: 'archived' } });
  if (vehicle) {
    const seededOperatorImage = OPERATOR_IMAGES[operator.key];
    const oldSeedImagePattern = /^\/images\/operators\//i;
    const currentMedia = Array.isArray(vehicle.media) ? vehicle.media : [];
    if (!currentMedia.length) {
      vehicle.media = seededMedia(seededOperatorImage, `${operator.name} coach`, `${operator.name} real coach photo`);
      await vehicle.save();
      counts.enriched += 1;
    } else if (currentMedia.some((item) => oldSeedImagePattern.test(String(item?.url || item?.secureUrl || '')))) {
      vehicle.media = currentMedia.map((item) => oldSeedImagePattern.test(String(item?.url || item?.secureUrl || ''))
        ? { ...(typeof item.toObject === 'function' ? item.toObject() : item), url: seededOperatorImage, secureUrl: seededOperatorImage, publicId: `seed:${seededOperatorImage}` }
        : item);
      await vehicle.save();
      counts.enriched += 1;
    }
    return vehicle;
  }
  vehicle = await busSetupService.createVehicle(companyId, {
    listingId: listing.id,
    name: `${operator.name} review coach`,
    plateOrCode,
    vehicleClass: 'standard',
    layoutName: '2x2',
    totalSeats: 40,
    rows: 10,
    columns: 4,
    numberingStartSide: 'left',
    driverPosition: 'right',
    amenities: operator.amenities || [],
    imageUrl: OPERATOR_IMAGES[operator.key],
    imageAlt: `${operator.name} coach`,
    status: 'active',
    registrationCountry: operator.country,
  }, superAdmin);
  counts.vehicles += 1;
  return vehicle;
}

function reviewDepartureAt(offsetDays = 3) {
  const base = new Date();
  base.setUTCHours(6, 0, 0, 0); // 09:00 Africa/Kampala.
  base.setUTCDate(base.getUTCDate() + Math.max(3, Number(offsetDays || 3)));
  return base;
}

async function ensureReviewDeparture({ operator, company, route, fareProduct, vehicle, superAdmin, offsetDays, counts }) {
  if (!fareProduct || !vehicle) return null;
  const companyId = company.id || String(company._id);
  const marker = `Classic Trip seeded review departure — ${SOURCE_KEY} — ${route.id}`;
  const existing = await TripSchedule.findOne({
    companyId, routeId: route.id, vehicleId: vehicle.id, status: 'draft',
    departAt: { $gt: new Date() }, notes: marker,
  }).sort({ departAt: 1 });
  if (existing) return existing;
  const result = await busDepartureService.createSchedule(companyId, {
    routeId: route.id,
    vehicleId: vehicle.id,
    fareProductId: fareProduct.id,
    departAt: reviewDepartureAt(offsetDays).toISOString(),
    boardingLeadMinutes: 45,
    status: 'draft',
    notes: marker,
  }, superAdmin);
  const publishValidation = {
    ...(result.schedule.publishValidation || {}),
    seededReview: true,
    operatorConfirmationRequired: true,
    source: SOURCE_KEY,
  };
  await TripSchedule.updateOne(
    { id: result.schedule.id, companyId },
    {
      $set: {
        statusReason: 'Review draft: confirm the exact date/time, assigned vehicle, fare, terminals and compliance before publication.',
        publishValidation,
        updatedAt: new Date(),
      },
    },
  );
  counts.departures += 1;
  return TripSchedule.findOne({ id: result.schedule.id, companyId });
}

async function seedOperator(operator, superAdmin, counts, credentialRows) {
  const companyId = `company-seed-${operator.key}`;
  const listingId = `listing-seed-${operator.key}`;
  const companyDoc = {
    id: companyId,
    ownerId: '',
    name: operator.name,
    legalName: operator.name,
    slug: operator.key,
    companyType: 'bus', partnerCategory: 'bus_operator', accountModel: 'organization',
    country: operator.country, city: operator.city, website: operator.website || '', description: operator.description,
    status: 'pending', verificationStatus: 'pending', operatingCurrency: 'UGX',
    supportContacts: operator.contacts,
    onboardingProfile: { seededForOnboarding: true, authorisedRepresentativeRequired: true, source: SOURCE_KEY },
    complianceProfile: { status: 'not_submitted', operatorPermit: 'required', insurance: 'required', inspection: 'required', source: SOURCE_KEY },
    onboardingProgress: { currentStep: 'compliance', completedSteps: ['public_profile_research'], missingFields: ['authorised representative', 'registration number', 'operator permit', 'vehicle compliance', 'live schedule and fares'] },
    settings: {
      seedSource: SOURCE_KEY, researchedAt: SEEDED_AT, requiresOperatorConfirmation: true,
      researchSources: operator.sources,
      approvalNote: 'Public route/terminal research only. Do not publish until the operator has confirmed ownership, compliance, vehicles, exact terminals, schedules and fares.',
    },
    createdAt: SEEDED_AT, updatedAt: SEEDED_AT,
  };
  const companyResult = await insertOnly(Company, { slug: operator.key }, companyDoc);
  if (companyResult.created) counts.companies += 1;
  const company = companyResult.row;
  const partnerAdmin = await ensurePartnerAdmin(operator, company, counts, credentialRows);
  await enrichSeededDoc(company, {
    legalName: operator.name, country: operator.country, city: operator.city, website: operator.website || '', description: operator.description,
    headOfficeAddress: operator.terminals?.find((row) => String(row[0]).toLowerCase() === String(operator.city).toLowerCase())?.[2] || '',
  }, counts);
  if (apply && company.supportContacts && operator.contacts) {
    company.supportContacts = { ...operator.contacts, ...(company.supportContacts || {}) };
    company.onboardingProfile = { ...(company.onboardingProfile || {}), seededForOnboarding: true, source: SOURCE_KEY, seededPartnerAdminEmail: partnerAdmin.email };
    company.settings = { ...(company.settings || {}), seedSource: SOURCE_KEY, researchedAt: SEEDED_AT, researchSources: operator.sources, partnerSeedAccountEmail: partnerAdmin.email, requiresOperatorConfirmation: true };
    await company.save();
  }

  const terminals = operatorTerminalMap(operator);
  const branchByCity = new Map();
  for (const [city, name, address, branchType, status] of terminals) {
    const id = `branch-seed-${operator.key}-${slug(city)}-${slug(name).slice(0, 24)}`;
    const branchDoc = {
      id, companyId: company.id || companyId, name, branchType, city, country: city === 'Juba' || city === 'Bor' || city === 'Nimule' || city === 'Magwi' ? 'South Sudan' : city === 'Nairobi' || city === 'Kakuma' ? 'Kenya' : city === 'Kigali' ? 'Rwanda' : 'Uganda',
      address, contactPhone: operator.contacts?.[city.toLowerCase()] || operator.contacts?.phone || '', contactEmail: operator.contacts?.email || '',
      serviceCategories: ['bus'], amenities: [], status, createdBy: superAdmin.id || String(superAdmin._id), updatedBy: superAdmin.id || String(superAdmin._id), createdAt: SEEDED_AT, updatedAt: SEEDED_AT,
    };
    const result = await insertOnly(CompanyBranch, { companyId: company.id || companyId, name }, branchDoc);
    if (result.created) counts.terminals += 1;
    const branch = await enrichSeededDoc(result.row, { address, contactPhone: operator.contacts?.[city.toLowerCase()] || operator.contacts?.phone || operator.contacts?.kampala || '', contactEmail: operator.contacts?.email || '' }, counts);
    if (!branchByCity.has(city.toLowerCase()) || status === 'active') branchByCity.set(city.toLowerCase(), branch);
  }

  const researchedFares = operator.routes.filter((r) => r.fare).map((r) => ({ origin: r.origin, destination: r.destination, amount: r.fare, currency: r.currency || 'UGX', className: r.fareClass || '', source: r.source, operatorConfirmationRequired: true }));
  const listingDoc = {
    id: listingId, companyId: company.id || companyId, companySlug: operator.key, companyName: operator.name,
    serviceType: 'bus', group: 'bus', type: 'bus', listingKind: 'operator_service', title: operator.name, slug: `${operator.key}-bus`,
    shortDescription: operator.description, country: operator.country, city: operator.city, address: branchByCity.get(operator.city.toLowerCase())?.address || '',
    from: '', to: '', corridor: 'Uganda and East Africa', priceFrom: researchedFares.filter((f) => f.currency === 'UGX').reduce((min, f) => min === 0 ? f.amount : Math.min(min, f.amount), 0), currency: 'UGX',
    amenities: operator.amenities || [], contactPhone: operator.contacts?.phone || operator.contacts?.kampala || '',
    media: seededMedia(OPERATOR_IMAGES[operator.key], `${operator.name} coach`, `${operator.name} real coach photo`),
    salesChannels: ['classic_trip'], availabilityMode: 'dated_capacity', bookable: false, isVerified: false, releaseStatus: 'review', status: 'draft',
    publication: { public: false, state: 'draft', reviewStatus: 'pending', seededResearch: true, lastStatusChangeAt: SEEDED_AT },
    serviceDetails: {
      seedSource: SOURCE_KEY, researchedAt: SEEDED_AT, sources: operator.sources, researchedFares,
      routeResearch: operator.routes.map((r) => ({ origin: r.origin, destination: r.destination, confidence: r.inferredReverse ? 'inferred_reverse_requires_confirmation' : r.source || 'public_reference' })),
      approvalChecklist: ['Confirm authorised operator representative', 'Verify company registration/compliance', 'Review/replace the seeded review vehicle and confirm its seat template', 'Confirm exact active terminal addresses', 'Confirm seeded research fares and stop fares', 'Review seeded draft departures, then configure the operator’s real rolling schedule'],
      warning: 'Seeded research is editable preparation data, not approval evidence.',
    },
    createdAt: SEEDED_AT, updatedAt: SEEDED_AT,
  };
  const listingResult = await insertOnly(Listing, { companyId: company.id || companyId, serviceType: 'bus' }, listingDoc);
  if (listingResult.created) counts.listings += 1;
  const listing = await enrichSeededDoc(listingResult.row, { address: branchByCity.get(operator.city.toLowerCase())?.address || '', contactPhone: operator.contacts?.phone || operator.contacts?.kampala || '', shortDescription: operator.description }, counts);
  if (apply && listing && typeof listing.save === 'function') {
    listing.amenities = uniq([...(listing.amenities || []), ...(operator.amenities || [])]);
    const seededOperatorImage = OPERATOR_IMAGES[operator.key];
    const oldSeedImagePattern = /^\/images\/operators\//i;
    const existingSeedMedia = Array.isArray(listing.media) ? listing.media : [];
    if (!existingSeedMedia.length) {
      listing.media = seededMedia(seededOperatorImage, `${operator.name} coach`, `${operator.name} real coach photo`);
    } else if (existingSeedMedia.some((item) => oldSeedImagePattern.test(String(item?.url || item?.secureUrl || '')) || isLegacySeedOperatorUrl(operator.key, item?.secureUrl || item?.url || ''))) {
      listing.media = existingSeedMedia.map((item) => (oldSeedImagePattern.test(String(item?.url || item?.secureUrl || '')) || isLegacySeedOperatorUrl(operator.key, item?.secureUrl || item?.url || ''))
        ? { ...(typeof item.toObject === 'function' ? item.toObject() : item), url: seededOperatorImage, secureUrl: seededOperatorImage, publicId: `seed:${seededOperatorImage}` }
        : item);
      listing.img = seededOperatorImage;
    }
    listing.serviceDetails = {
      ...(listing.serviceDetails || {}),
      seedSource: SOURCE_KEY,
      researchedAt: SEEDED_AT,
      sources: operator.sources,
      researchedFares,
      realBusImage: OPERATOR_IMAGES[operator.key],
      seededReviewInventory: true,
    };
    await listing.save();
  }

  const reviewVehicle = await ensureSeedReviewVehicle(operator, company, listing, superAdmin, counts);
  let seededDepartureIndex = 0;
  for (const r of operator.routes) {
    const originBranch = branchByCity.get(r.origin.toLowerCase());
    const destinationBranch = branchByCity.get(r.destination.toLowerCase());
    const routeDoc = {
      id: `route-seed-${operator.key}-${slug(r.origin)}-${slug(r.destination)}`,
      listingId: listing.id || listingId, companyId: company.id || companyId,
      routeName: `${r.origin} ⇄ ${r.destination}`, routeCode: `${slug(operator.key).slice(0, 8).toUpperCase()}-${slug(r.origin).slice(0, 4).toUpperCase()}-${slug(r.destination).slice(0, 4).toUpperCase()}`,
      timezone: 'Africa/Kampala', origin: r.origin, destination: r.destination,
      originTerminalId: originBranch?.id || '', destinationTerminalId: destinationBranch?.id || '',
      boardingBranchIds: originBranch?.id ? [originBranch.id] : [], dropoffBranchIds: destinationBranch?.id ? [destinationBranch.id] : [],
      boardingPoints: originBranch?.name ? [originBranch.name] : [], dropoffPoints: destinationBranch?.name ? [destinationBranch.name] : [],
      corridor: `${r.origin} ⇄ ${r.destination}`, operatingDays: [],
      publicInstructions: r.inferredReverse ? 'Reverse direction was prepared from the public corridor and must be confirmed by the operator before live schedules are added.' : 'Publicly researched corridor; exact timetable, stops and operational fare must be confirmed before publication.',
      baggageRules: 'Operator rules pending confirmation.', cancellationRules: 'Classic Trip/operator cancellation terms pending approval.',
      policies: ['Operator confirmation required before publication'], status: 'active', createdAt: SEEDED_AT, updatedAt: SEEDED_AT,
    };
    const result = await insertOnly(Route, { companyId: company.id || companyId, origin: r.origin, destination: r.destination, status: 'active' }, routeDoc);
    if (result.created) counts.routes += 1;
    const route = result.row;
    const infrastructure = await ensureRouteInfrastructure({
      operator,
      route,
      routeResearch: r,
      listing,
      originBranch,
      destinationBranch,
      superAdmin,
      counts,
    });
    if (infrastructure.fareProduct) {
      await ensureReviewDeparture({
        operator,
        company,
        route,
        fareProduct: infrastructure.fareProduct,
        vehicle: reviewVehicle,
        superAdmin,
        offsetDays: 3 + (seededDepartureIndex * 2),
        counts,
      });
      seededDepartureIndex += 1;
    }
  }

  const hq = branchByCity.get(operator.city.toLowerCase()) || [...branchByCity.values()][0];
  for (const roleTitle of staffRoles) {
    const employeeDoc = {
      id: `employee-seed-${operator.key}-${slug(roleTitle)}`, companyId: company.id || companyId, userId: '', fullName: placeholderName(operator, roleTitle), email: '', phone: '',
      roleTitle, branchId: hq?.id || '', branchName: hq?.name || '', branch: hq?.name || '', listingIds: [listing.id || listingId], serviceCategories: ['bus'], permissions: employeePermissions(roleTitle, rolePermissionDefaults[roleTitle] || []),
      notes: `Editable placeholder role. Replace this placeholder with the real ${roleTitle} name/contact details before activation. No real employee identity is claimed by this seed.`,
      safetyStatus: 'not_submitted', onboardingStatus: 'operator_details_required', status: 'requested', createdAt: SEEDED_AT, updatedAt: SEEDED_AT,
    };
    const result = await insertOnly(CompanyEmployee, { companyId: company.id || companyId, roleTitle, onboardingStatus: 'operator_details_required' }, employeeDoc);
    if (result.created) counts.staffSlots += 1;
    await enrichSeededDoc(result.row, { fullName: placeholderName(operator, roleTitle), branchId: hq?.id || '', branchName: hq?.name || '', branch: hq?.name || '' }, counts);
    if (apply && result.row && typeof result.row.save === 'function' && (!result.row.permissions || result.row.permissions.length === 0)) { result.row.permissions = employeePermissions(roleTitle, rolePermissionDefaults[roleTitle] || []); await result.row.save(); counts.enriched += 1; }
  }
}

async function seedBlogs(superAdmin, counts) {
  const actorId = superAdmin.id || String(superAdmin._id);
  for (const post of blogs) {
    const image = BLOG_IMAGES[post.slug] || '/images/blogs/bus-seat-booking.webp';
    const doc = {
      id: `blog-seed-${slug(post.slug)}`,
      slug: post.slug, tag: post.tag, title: post.title, excerpt: post.excerpt, body: post.body,
      image, imageAlt: `${post.title} — East Africa travel`,
      status: 'published', publishedAt: SEEDED_AT, createdBy: actorId, updatedBy: actorId, createdAt: SEEDED_AT, updatedAt: SEEDED_AT,
    };
    const result = await insertOnly(BlogPost, { slug: post.slug }, doc);
    if (result.created) {
      counts.blogs += 1;
    } else if (result.row && (isBlank(result.row.image) || isLegacySeedBlogUrl(post.slug, result.row.image) || /launch-lockup|logo-symbol|\/images\/operators\/|\/images\/blogs\/(?:bus-seat-booking|v1644-|v1645-)/i.test(String(result.row.image)))) {
      result.row.image = image;
      result.row.imageAlt = `${post.title} — East Africa travel`;
      result.row.updatedBy = actorId;
      result.row.updatedAt = new Date();
      await result.row.save();
      counts.enriched += 1;
    }
  }
}

async function main() {
  await connectDb();
  const superAdmin = await User.findOne({ role: 'super_admin', status: 'active' }).sort({ createdAt: 1 });
  if (!superAdmin) throw new Error('No active Super Admin exists. Run npm run seed:superadmin first.');
  const counts = { blogs: 0, companies: 0, listings: 0, routes: 0, routeStops: 0, routeSegments: 0, fareProducts: 0, segmentFares: 0, vehicles: 0, departures: 0, terminals: 0, staffSlots: 0, partnerAccounts: 0, partnerPasswordsReset: 0, enriched: 0 };
  const credentialRows = [];
  if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', owner: superAdmin.email || superAdmin.id || superAdmin._id, requested: { blogs: blogs.length, operators: operators.length, routeRecords: operators.reduce((n, o) => n + o.routes.length, 0) }, safety: 'Existing user-edited images are preserved. Seeded logo blog images are upgraded. Operator services remain pending/draft; seeded vehicles/fares/departures are review inventory and cannot become live without compliance/publication checks.' }, null, 2));
    return;
  }
  await seedBlogs(superAdmin, counts);
  for (const operator of operators) await seedOperator(operator, superAdmin, counts, credentialRows);
  await saveCredentials(credentialRows);
  console.log(JSON.stringify({ mode: 'apply', owner: superAdmin.email || superAdmin.id || superAdmin._id, created: counts, credentialsFile: CREDENTIALS_PATH, partnerCredentials: credentialRows, note: 'Seed complete. Partner Admin accounts are usable for editing. Real bus photos, route-backed review vehicles, researched fares and fully persisted draft departures were added; listings remain non-public until operator confirmation and compliance checks pass.' }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await mongoose.disconnect().catch(() => {}); });
