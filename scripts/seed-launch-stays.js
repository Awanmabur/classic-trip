'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { connectDb, mongoose } = require('../src/config/db');
const User = require('../src/models/User');
const Company = require('../src/models/Company');
const Listing = require('../src/models/Listing');
const HotelProperty = require('../src/models/HotelProperty');
const { invalidateMarketplaceCache } = require('../src/services/marketplace/catalogService');
const { uploadBuffer, isConfigured: isCloudinaryConfigured } = require('../src/services/media/cloudinaryService');
const { detectedMimeType } = require('../src/services/media/uploadService');

const apply = process.argv.includes('--apply');
const resetPartnerPasswords = process.argv.includes('--reset-partner-passwords');
const SEEDED_AT = '2026-08-14T14:20:00.000Z';
const SOURCE_KEY = 'classic-trip-v1.6.72-launch-stays-real-media';
const CREDENTIALS_DIR = path.join(__dirname, '..', 'seed-output');
const CREDENTIALS_PATH = path.join(CREDENTIALS_DIR, 'stay-partner-credentials.json');

function seededMedia(media, alt, label = alt) {
  if (!media) return [];
  if (typeof media === 'object') {
    const url = media.secureUrl || media.url || '';
    if (!url) return [];
    return [{
      url, secureUrl: url,
      publicId: media.publicId || `seed:${url}`,
      resourceType: media.resourceType || 'image',
      alt, label: media.label || label, status: 'pending_review',
      sourcePage: media.sourcePage || '',
    }];
  }
  const url = String(media);
  return [{ url, secureUrl: url, publicId: `seed:${url}`, resourceType: 'image', alt, label, status: 'pending_review' }];
}

function seedOwnedMedia(items = []) {
  return Array.isArray(items) && items.length > 0 && items.every((item) => /^(?:seed:|seed-remote:|seed-cloudinary:)/.test(String(item?.publicId || '')));
}

const REAL_MEDIA_HOSTS = new Set([
  'www.facebook.com', 'facebook.com', 'm.facebook.com',
  'www.instagram.com', 'instagram.com',
  'imgservice.bedroomvillas.co.uk', 'imgservice.cabinns.com',
  'media.radissonhotels.net',
]);
const REAL_MEDIA_MAX_HTML = 2 * 1024 * 1024;
const REAL_MEDIA_MAX_IMAGE = 8 * 1024 * 1024;

function safeExternalUrl(value = '') {
  const parsed = new URL(String(value));
  const host = parsed.hostname.toLowerCase();
  const allowedCdn = host.endsWith('.fbcdn.net') || host.endsWith('.fbsbx.com') || host.endsWith('.cdninstagram.com');
  if (parsed.protocol !== 'https:' || (!REAL_MEDIA_HOSTS.has(host) && !allowedCdn)) throw new Error(`Unapproved Stay media host: ${parsed.hostname}`);
  return parsed.toString();
}
function decodeHtml(value = '') {
  return String(value).replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function tagAttribute(tag = '', name = '') {
  const match = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*[\"']([^\"']+)[\"']`, 'i'));
  return match ? decodeHtml(match[1]) : '';
}
function extractSocialImage(html = '') {
  const metas = String(html).match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metas) {
    const key = (tagAttribute(tag, 'property') || tagAttribute(tag, 'name')).toLowerCase();
    if (!['og:image:secure_url', 'og:image', 'twitter:image'].includes(key)) continue;
    const content = tagAttribute(tag, 'content');
    if (content) return content;
  }
  return '';
}
async function fetchBounded(url, kind = 'html') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(safeExternalUrl(url), {
      redirect: 'follow', signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ClassicTripStaySeeder/1.0; +https://classictrip.org)', Accept: kind === 'image' ? 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' : 'text/html,application/xhtml+xml' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length') || 0);
    const limit = kind === 'image' ? REAL_MEDIA_MAX_IMAGE : REAL_MEDIA_MAX_HTML;
    if (length && length > limit) throw new Error(`response too large (${length} bytes)`);
    if (kind === 'html') {
      const text = await response.text();
      if (Buffer.byteLength(text) > limit) throw new Error('HTML response exceeded media safety limit');
      return { response, text };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > limit) throw new Error('image response is empty or too large');
    const mime = detectedMimeType(buffer);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new Error('resolved media is not a supported image');
    return { response, buffer, mime };
  } finally { clearTimeout(timer); }
}
async function resolveRealStayMedia(stay) {
  if (!apply || !stay.imageSource) return stay;
  try {
    let imageUrl = '';
    if (stay.imageSource.type === 'direct') imageUrl = safeExternalUrl(stay.imageSource.url);
    else {
      const page = await fetchBounded(stay.imageSource.page, 'html');
      const found = extractSocialImage(page.text);
      if (!found) throw new Error('public page did not expose an Open Graph image');
      imageUrl = safeExternalUrl(found);
    }
    const downloaded = await fetchBounded(imageUrl, 'image');
    let media = { url: imageUrl, secureUrl: imageUrl, publicId: `seed-remote:${stay.key}`, resourceType: 'image', sourcePage: stay.imageSource.page || stay.imageSource.url, label: stay.imageSource.label };
    if (isCloudinaryConfigured()) {
      const uploaded = await uploadBuffer(downloaded.buffer, 'classic-trip/hotels/launch-stays', { resourceType: 'image' });
      media = { ...uploaded, publicId: `seed-cloudinary:${uploaded.publicId}`, sourcePage: stay.imageSource.page || stay.imageSource.url, label: stay.imageSource.label };
    }
    console.log(`✓ Resolved real Stay image — ${stay.name}${isCloudinaryConfigured() ? ' → Cloudinary' : ' → verified remote image'}`);
    return { ...stay, image: media, imageIsPlaceholder: false, imageLabel: stay.imageSource.label || `${stay.name} verified public property image` };
  } catch (error) {
    console.warn(`! Could not refresh real Stay image for ${stay.name}; existing/local fallback retained — ${error.message}`);
    return stay;
  }
}
function slug(value = '') { return String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80); }
function isBlank(value) { return value === undefined || value === null || String(value).trim() === ''; }
function partnerLoginEmail(stay) { return `partner.${stay.key}@classictrip.org`; }
function generateTemporaryPassword() { return `${crypto.randomBytes(12).toString('base64url')}!A7`; }

function stayCompanyLookup(stay) {
  const legacyKeys = Array.isArray(stay.legacyKeys) ? stay.legacyKeys : [];
  const legacyNames = Array.isArray(stay.legacyNames) ? stay.legacyNames : [];
  return {
    $or: [
      { id: `company-seed-stay-${stay.key}` },
      { slug: stay.key },
      { name: stay.name },
      ...legacyKeys.map((key) => ({ id: `company-seed-stay-${key}` })),
      ...legacyKeys.map((key) => ({ slug: key })),
      ...legacyNames.map((name) => ({ name })),
    ],
  };
}

function isLegacySeedIdentity(stay, row) {
  const legacyKeys = Array.isArray(stay.legacyKeys) ? stay.legacyKeys : [];
  const legacyNames = Array.isArray(stay.legacyNames) ? stay.legacyNames : [];
  const id = String(row?.id || '');
  const slugValue = String(row?.slug || '');
  const nameValue = String(row?.name || row?.title || row?.propertyName || '');
  return legacyKeys.some((key) => id.includes(`seed-stay-${key}`) || slugValue === key || slugValue === `${key}-stay`)
    || legacyNames.includes(nameValue);
}

// These are profile/onboarding seeds, not room-rate or inventory claims. Public
// facts are deliberately limited to details we can support from the hotel's own
// public pages or public hotel social pages. Prices, room units and dated room
// inventory remain partner-controlled and are never invented by this seed.
const stays = [
  {
    key: 'dandy-hotel',
    legacyKeys: ['daddy-hotel'],
    legacyNames: ['Daddy Hotel'],
    name: 'Dandy Hotel Juba',
    city: 'Juba',
    country: 'South Sudan',
    address: 'Shirikat off Nimule Road / Juba–Nimule Highway, Juba, South Sudan',
    website: 'https://www.instagram.com/dandyhoteljuba/',
    description: 'Dandy Hotel Juba is a hotel in Shirikat, off the Juba–Nimule Highway. Public hotel and accommodation listings describe a 45-room property with a restaurant and bar, garden and terrace, free private parking, room service, a 24-hour front desk, air-conditioned rooms, flat-screen TVs, some rooms with balconies, and continental breakfast. Classic Trip has prepared this partner profile from those public sources; live room categories, prices and dated inventory remain controlled by the hotel and must be confirmed before online booking is enabled.',
    amenities: ['Fast Wi-Fi', 'Continental breakfast', 'Restaurant', 'Bar', 'Garden', 'Terrace', 'Free private parking', 'Room service', '24-hour front desk', 'Air conditioning', 'Flat-screen TV', 'Balcony on selected rooms'],
    contacts: { phone: '+211926608007', alternatePhone: '+211917996219', email: 'info@dandyhotel.net', alternateEmail: 'dandyhotel509@gmail.com' },
    checkInTime: '12:00',
    checkOutTime: '10:00',
    starRating: 0,
    category: 'unrated',
    image: '/images/stays/dandy-hotel-real.jpg',
    imageIsPlaceholder: false,
    imageLabel: 'Dandy Hotel Juba — real public property/promotional photo',
    // The verified Dandy photo is bundled locally so the public listing never
    // depends on third-party hot-linking. External URLs stay in `sources` only.
    sources: [
      { label: 'Dandy Hotel Juba Instagram public profile', url: 'https://www.instagram.com/dandyhoteljuba/', confidence: 'public_hotel_social' },
      { label: 'Tripadvisor Dandy Hotel Juba property profile', url: 'https://www.tripadvisor.com/Hotel_Review-g776943-d27108074-Reviews-Dandy_Hotel_Juba-Juba_Central_Equatoria_State.html', confidence: 'public_hotel_directory' },
      { label: 'Public accommodation listing carrying Booking.com property data', url: 'https://www.cabinns.com/property/dandy-hotel-juba-south-sudan/BC-11300691', confidence: 'public_booking_data' },
      { label: 'Public Dandy Hotel promotional/contact image', url: 'https://imgservice.cabinns.com/680x408/dandy-hotel-juba-south-sudan-ss-juba-bc-11300691-0.jpg?property_id=BC-11300691', confidence: 'public_hotel_material' },
      { label: 'Public Dandy Hotel Juba directory/contact listing', url: 'https://xn----8sbnadqrtzjid0d5cj.cybo.com/SS/%D0%B4%D0%B6%D1%83%D0%B1%D0%B0/%D0%BF%D1%83%D1%82%D0%B5%D1%88%D0%B5%D1%81%D1%82%D0%B2%D0%B8%D1%8F-%D0%B8-%D0%BF%D0%B5%D1%80%D0%B5%D0%B2%D0%BE%D0%B7%D0%BA%D0%B8/?p=5', confidence: 'public_business_directory' },
    ],
  },
  {
    key: 'zoom-future-hotel',
    name: 'Zoom Future Hotel',
    city: 'Juba',
    country: 'South Sudan',
    address: 'Sherikat, Juba, South Sudan',
    website: 'https://www.facebook.com/p/Zoom-Future-Hotel-61554424816873/',
    description: 'Zoom Future Hotel is a hotel, bar and restaurant in the Sherikat area of Juba. Its public hotel page promotes accommodation, high-speed Wi-Fi, air conditioning and event or conference use. Classic Trip has prepared the partner profile for onboarding; room types, rates, policies and dated availability must still be confirmed by the hotel before booking is switched on.',
    amenities: ['High-speed Wi-Fi', 'Air conditioning', 'Restaurant', 'Bar', 'Conference / meeting space'],
    contacts: {},
    checkInTime: '',
    checkOutTime: '',
    starRating: 0,
    category: 'unrated',
    image: '/images/stays/zoom-future-hotel.svg',
    imageIsPlaceholder: true,
    imageLabel: 'Zoom Future Hotel fallback cover (real public photo is resolved during seed)',
    imageSource: { type: 'page', page: 'https://www.facebook.com/61554424816873/photos/122111528192147493/', label: 'Zoom Future Hotel — public hotel cover photo' },
    sources: [
      { label: 'Zoom Future Hotel public page', url: 'https://www.facebook.com/p/Zoom-Future-Hotel-61554424816873/', confidence: 'public_hotel_social' },
      { label: 'Zoom Future Hotel public accommodation post', url: 'https://www.facebook.com/223660137495701/', confidence: 'public_hotel_social' },
    ],
  },
  {
    key: 'vision-gate-hotel',
    name: 'Vision Gate Hotel',
    city: 'Juba',
    country: 'South Sudan',
    address: 'Gumbo Sherikat, Juba, South Sudan',
    website: 'https://www.facebook.com/visiongatehotel/',
    description: 'Vision Gate Hotel is a Juba accommodation property in Gumbo Sherikat. Its public hotel channels advertise self-contained accommodation with air conditioning, DSTV, free Wi-Fi, security, bar and restaurant facilities. Classic Trip has prepared this partner profile for onboarding; the operator remains responsible for confirming room inventory, live rates and booking policies.',
    amenities: ['Air conditioning', 'Free Wi-Fi', 'DSTV', 'Self-contained rooms', '24-hour security', 'Restaurant', 'Bar', 'Parking'],
    contacts: { phone: '+211929295298', whatsapp: '+211929295298' },
    checkInTime: '',
    checkOutTime: '',
    starRating: 0,
    category: 'unrated',
    image: '/images/stays/vision-gate-hotel.svg',
    imageIsPlaceholder: true,
    imageLabel: 'Vision Gate Hotel fallback cover (real accommodation photo is resolved during seed)',
    imageSource: { type: 'page', page: 'https://www.facebook.com/visiongatehotel/photos/our-accommodation-are-unrivalled-in-gumbo-sherikat-we-provide-accommodations-tha/142309521685926/', label: 'Vision Gate Hotel — public accommodation photo' },
    sources: [
      { label: 'Vision Gate Hotel public page', url: 'https://www.facebook.com/visiongatehotel/', confidence: 'public_hotel_social' },
      { label: 'Vision Gate Hotel public accommodation/contact post', url: 'https://www.facebook.com/visiongatehotel/posts/our-accommodation-is-what-it-takes-to-have-a-beautiful-sleep-for-as-little-as-12/149337210983157/', confidence: 'public_hotel_social' },
      { label: 'Vision Gate Hotel public profile', url: 'https://x.com/VisionGateHotel', confidence: 'public_hotel_social' },
    ],
  },
  {
    key: 'kal-hotel',
    name: 'Kal Hotel & Garden',
    city: 'Juba',
    country: 'South Sudan',
    address: 'Sherikat near Freedom Square (Sherikat wrestling field), Juba, South Sudan',
    website: 'https://www.facebook.com/KalhotelshirikatSSD/',
    description: 'Kal Hotel & Garden is a Juba hotel in Sherikat near Freedom Square. Its public hotel page identifies the property as a hotel and publishes a Juba contact number. Classic Trip has prepared this partner profile for onboarding after partner contact; room categories, prices, policies and dated availability remain controlled by the hotel and must be confirmed before online booking is enabled.',
    amenities: ['Garden', 'Restaurant', 'Bar'],
    contacts: { phone: '+211921661912' },
    checkInTime: '',
    checkOutTime: '',
    starRating: 0,
    category: 'unrated',
    image: '/images/stays/kal-hotel.svg',
    imageIsPlaceholder: true,
    imageLabel: 'Kal Hotel & Garden fallback cover (real external-view photo is resolved during seed)',
    imageSource: { type: 'page', page: 'https://www.facebook.com/100071841384072/posts/welcome-to-kal-hotel-and-garden-below-is-the-external-view-of-kal-hotel-and-gard/190710986666946/', label: 'Kal Hotel & Garden — public external-view photo' },
    sources: [
      { label: 'Kal Hotel Shirikat SSD public page', url: 'https://www.facebook.com/KalhotelshirikatSSD/', confidence: 'public_hotel_social' },
      { label: 'Kal Hotel & Garden public location post', url: 'https://www.facebook.com/100071841384072/posts/welcome-to-kal-hotel-and-garden-below-is-the-external-view-of-kal-hotel-and-gard/190710986666946/', confidence: 'public_hotel_social' },
    ],
  },
  {
    key: 'pyramid-continental-hotel',
    name: 'Pyramid Continental Hotel',
    city: 'Juba',
    country: 'South Sudan',
    address: 'Nimule Street, City of Juba, South Sudan',
    website: 'https://www.pyramidcontinentalhotel.com/',
    description: 'Pyramid Continental Hotel is a five-star hotel in Juba with 183 guest rooms, dining, conference and meeting facilities, spa and gym services and views across Juba and the White Nile. Classic Trip has prepared its public partner profile from the hotel’s official website; live Classic Trip room types, prices and dated room inventory remain partner-controlled.',
    amenities: ['Wi-Fi', 'Restaurants', 'Conference / meeting facilities', 'Spa', 'Gym', 'Outdoor pool', 'Laundry service'],
    contacts: { phone: '+211924001257', email: 'info@pyramidcontinentalhotel.com' },
    checkInTime: '',
    checkOutTime: '',
    starRating: 5,
    category: 'luxury',
    image: '/images/stays/pyramid-continental-hotel.jpg',
    imageIsPlaceholder: false,
    imageLabel: 'Pyramid Continental Hotel exterior — official website image',
    sources: [
      { label: 'Pyramid Continental Hotel official website', url: 'https://www.pyramidcontinentalhotel.com/', confidence: 'official' },
      { label: 'Pyramid Continental Hotel official contact', url: 'https://www.pyramidcontinentalhotel.com/careers', confidence: 'official' },
    ],
  },
  {
    key: 'radisson-blu-hotel-juba',
    name: 'Radisson Blu Hotel, Juba',
    city: 'Juba',
    country: 'South Sudan',
    address: 'Nimule Street, Hai Malakal, Juba, South Sudan',
    website: 'https://www.radissonhotels.com/en-us/hotels/radisson-blu-juba',
    description: 'Radisson Blu Hotel, Juba is a five-star hotel in central Juba with modern rooms and suites, meeting and event spaces, restaurants and bars, a wellness centre, spa, gym and outdoor pool. Classic Trip has prepared the public partner profile from Radisson’s official hotel pages; live Classic Trip rates and dated room inventory remain controlled by the hotel partner.',
    amenities: ['Outdoor pool', 'Spa', 'Fitness centre', 'Restaurants', 'Bars', 'Meeting / event facilities', 'Room service', 'Baggage storage'],
    contacts: { phone: '+211921988000', email: 'info.juba@radissonblu.com' },
    checkInTime: '14:00',
    checkOutTime: '12:00',
    starRating: 5,
    category: 'luxury',
    image: 'https://media.radissonhotels.net/image/radisson-blu-hotel-juba/exterior/16256-147543-f73969198_4K.jpg?impolicy=HomeHero',
    imageIsPlaceholder: false,
    imageLabel: 'Radisson Blu Hotel, Juba exterior — official Radisson image',
    sources: [
      { label: 'Radisson Blu Hotel, Juba official page', url: 'https://www.radissonhotels.com/en-us/hotels/radisson-blu-juba', confidence: 'official' },
      { label: 'Radisson Blu Hotel, Juba official contact', url: 'https://www.radissonhotels.com/en-us/hotels/radisson-blu-juba/contact', confidence: 'official' },
    ],
  },
];

async function insertOnly(Model, query, doc) {
  if (doc?.id) {
    const bySeedId = await Model.findOne({ id: doc.id });
    if (bySeedId) return { row: bySeedId, created: false };
  }
  const existing = await Model.findOne(query);
  if (existing) return { row: existing, created: false };
  if (!apply) return { row: doc, created: true };
  try { return { row: await Model.create(doc), created: true }; }
  catch (error) {
    if (error?.code === 11000 && doc?.id) {
      const raced = await Model.findOne({ id: doc.id });
      if (raced) return { row: raced, created: false };
    }
    throw error;
  }
}

async function ensurePartnerAdmin(stay, company, counts, credentialRows) {
  const companyId = company.id || String(company._id || '');
  const email = partnerLoginEmail(stay);
  let user = company.ownerId ? await User.findById(company.ownerId).catch(() => null) : null;
  if (!user) user = await User.findOne({ $or: [{ companyId, role: 'company_admin' }, { email }] });
  let temporaryPassword = '';
  if (user && Array.isArray(stay.legacyNames) && stay.legacyNames.some((legacyName) => user.fullName === `${legacyName} Partner Admin`)) {
    user.fullName = `${stay.name} Partner Admin`;
    user.profileCompletion = { ...(user.profileCompletion || {}), seededLaunchAccount: true, seedSource: SOURCE_KEY };
    await user.save();
    counts.enriched += 1;
  }
  if (!user) {
    temporaryPassword = generateTemporaryPassword();
    user = await User.create({
      role: 'company_admin', fullName: `${stay.name} Partner Admin`, email,
      phone: stay.contacts?.phone || '', passwordHash: await bcrypt.hash(temporaryPassword, 12),
      status: 'active', isVerified: false, companyId, verificationStatus: 'pending', onboardingStatus: 'company_verification',
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
  credentialRows.push({ property: stay.name, email: user.email || email, temporaryPassword: temporaryPassword || null, companyId, note: temporaryPassword ? 'Change after first login.' : 'Existing seeded account password unchanged.' });
  return user;
}

async function seedStay(stay, superAdmin, counts, credentialRows) {
  const actorId = superAdmin.id || String(superAdmin._id);
  const companyId = `company-seed-stay-${stay.key}`;
  const listingId = `listing-seed-stay-${stay.key}`;
  const propertyId = `hotel-property-seed-${stay.key}`;
  const companyDoc = {
    id: companyId, ownerId: '', name: stay.name, legalName: stay.name, slug: stay.key,
    companyType: 'hotel', partnerCategory: 'hotel_partner', accountModel: 'organization',
    country: stay.country, city: stay.city, website: stay.website || '', description: stay.description,
    headOfficeAddress: stay.address, status: 'pending', verificationStatus: 'pending', operatingCurrency: 'USD',
    supportContacts: stay.contacts || {},
    onboardingProfile: { seededForOnboarding: true, authorisedRepresentativeRequired: true, partnerContactReportedByPlatformOwner: true, source: SOURCE_KEY },
    complianceProfile: { status: 'not_submitted', hotelLicence: 'required', propertyVerification: 'required', source: SOURCE_KEY },
    onboardingProgress: { currentStep: 'inventory', completedSteps: ['partner_contact', 'public_profile_research'], missingFields: ['authorised representative verification', 'hotel/property compliance', 'room types', 'live rates', 'dated room inventory'] },
    settings: {
      seedSource: SOURCE_KEY, researchedAt: SEEDED_AT, researchSources: stay.sources,
      requiresPartnerConfirmation: true,
      approvalNote: 'Public partner profile only. Do not enable booking until the hotel confirms room types, rates, policies, compliance and dated inventory.',
    },
    createdAt: SEEDED_AT, updatedAt: SEEDED_AT,
  };
  const companyResult = await insertOnly(Company, stayCompanyLookup(stay), companyDoc);
  if (companyResult.created) counts.companies += 1;
  const company = companyResult.row;
  const partnerAdmin = apply ? await ensurePartnerAdmin(stay, company, counts, credentialRows) : null;
  if (apply && company && typeof company.save === 'function') {
    let changed = false;
    const legacyIdentity = isLegacySeedIdentity(stay, company);
    if (legacyIdentity) {
      company.name = stay.name;
      company.legalName = stay.name;
      company.slug = stay.key;
      company.country = stay.country;
      company.city = stay.city;
      company.website = stay.website || '';
      company.description = stay.description;
      company.headOfficeAddress = stay.address;
      changed = true;
    }
    for (const [key, value] of Object.entries({ country: stay.country, city: stay.city, website: stay.website || '', description: stay.description, headOfficeAddress: stay.address })) {
      if (value && isBlank(company[key])) { company[key] = value; changed = true; }
    }
    company.supportContacts = { ...(stay.contacts || {}), ...(company.supportContacts || {}) };
    company.settings = { ...(company.settings || {}), seedSource: SOURCE_KEY, researchedAt: SEEDED_AT, researchSources: stay.sources, partnerSeedAccountEmail: partnerAdmin?.email || company.settings?.partnerSeedAccountEmail || '' };
    company.onboardingProfile = { ...(company.onboardingProfile || {}), seededForOnboarding: true, source: SOURCE_KEY, seededPartnerAdminEmail: partnerAdmin?.email || '' };
    if (changed) counts.enriched += 1;
    await company.save();
  }

  const listingDoc = {
    id: listingId, companyId: company.id || companyId, companySlug: stay.key, companyName: stay.name,
    serviceType: 'hotel', group: 'hotel', type: 'hotel', listingKind: 'property', title: stay.name, slug: `${stay.key}-stay`,
    shortDescription: stay.description, country: stay.country, city: stay.city, address: stay.address,
    priceFrom: 0, currency: 'USD', media: seededMedia(stay.image, stay.name, stay.imageLabel), amenities: stay.amenities,
    checkInTime: stay.checkInTime, checkOutTime: stay.checkOutTime, contactPhone: stay.contacts?.phone || '', stayType: 'hotel', pricingUnit: 'per_night',
    inventory: 0, remainingInventory: 0, availabilityMode: 'date_range',
    isFeatured: true, isVerified: false, bookable: false, releaseStatus: 'published', status: 'active', publishedAt: SEEDED_AT,
    publication: { public: true, state: 'profile_only', reviewStatus: 'partner_inventory_pending', seededResearch: true, lastStatusChangeAt: SEEDED_AT },
    serviceDetails: {
      seedSource: SOURCE_KEY, researchedAt: SEEDED_AT, sources: stay.sources,
      publicProfileOnly: true, partnerContactReportedByPlatformOwner: true, inventorySource: 'partner_required', imageReviewRequired: Boolean(stay.imageIsPlaceholder || !stay.image),
      approvalChecklist: ['Confirm authorised hotel representative', 'Verify hotel/property compliance', 'Upload partner-approved property media', 'Create real room types and physical room units', 'Set live room rates and dated inventory', 'Publish booking only after the stay readiness gate passes'],
      warning: 'Public partner profile only. Classic Trip has not invented room availability, rates or guest policies.',
    },
    createdAt: SEEDED_AT, updatedAt: SEEDED_AT,
  };
  const listingResult = await insertOnly(Listing, { companyId: company.id || companyId, serviceType: 'hotel' }, listingDoc);
  if (listingResult.created) counts.listings += 1;
  const listing = listingResult.row;
  if (apply && listing && typeof listing.save === 'function') {
    const legacyIdentity = isLegacySeedIdentity(stay, listing) || (Array.isArray(stay.legacyNames) && stay.legacyNames.includes(String(listing.companyName || '')));
    if (legacyIdentity) {
      listing.companySlug = stay.key;
      listing.companyName = stay.name;
      listing.title = stay.name;
      listing.slug = `${stay.key}-stay`;
      listing.shortDescription = stay.description;
      listing.address = stay.address;
      listing.city = stay.city;
      listing.country = stay.country;
      listing.contactPhone = stay.contacts?.phone || '';
      listing.checkInTime = stay.checkInTime || listing.checkInTime;
      listing.checkOutTime = stay.checkOutTime || listing.checkOutTime;
    }
    if (isBlank(listing.shortDescription)) listing.shortDescription = stay.description;
    if (isBlank(listing.address)) listing.address = stay.address;
    if (isBlank(listing.city)) listing.city = stay.city;
    if (isBlank(listing.country)) listing.country = stay.country;
    if (isBlank(listing.contactPhone) && stay.contacts?.phone) listing.contactPhone = stay.contacts.phone;
    if (isBlank(listing.checkInTime) && stay.checkInTime) listing.checkInTime = stay.checkInTime;
    if (isBlank(listing.checkOutTime) && stay.checkOutTime) listing.checkOutTime = stay.checkOutTime;
    listing.amenities = [...new Set([...(listing.amenities || []), ...(stay.amenities || [])].filter(Boolean))];
    if (stay.image) {
      const currentMedia = Array.isArray(listing.media) ? listing.media : [];
      const currentSeedOwned = seedOwnedMedia(currentMedia);
      if (!currentMedia.length || currentSeedOwned) listing.media = seededMedia(stay.image, stay.name, stay.imageLabel);
    }
    listing.serviceDetails = { ...(listing.serviceDetails || {}), seedSource: SOURCE_KEY, researchedAt: SEEDED_AT, sources: stay.sources, publicProfileOnly: listing.bookable !== true, partnerContactReportedByPlatformOwner: true, inventorySource: 'partner_required', imageReviewRequired: Boolean(stay.imageIsPlaceholder || !stay.image) };
    if (listing.bookable !== true && String(listing.releaseStatus || '').toLowerCase() !== 'published') {
      listing.status = 'active'; listing.releaseStatus = 'published'; listing.publishedAt = listing.publishedAt || new Date(SEEDED_AT);
    }
    await listing.save();
  }

  const propertyDoc = {
    id: propertyId, companyId: company.id || companyId, listingId: listing.id || listingId,
    propertyName: stay.name, normalizedName: stay.name.toLowerCase(), propertyType: 'hotel', rentalMode: 'room_based', hostType: 'business', hostDisplayName: stay.name,
    instantBook: false, maxGuests: 1, category: stay.category, starRating: stay.starRating,
    address: stay.address, city: stay.city, country: stay.country, timezone: 'Africa/Juba', mapLocation: stay.address,
    contactEmail: stay.contacts?.email || '', contactPhone: stay.contacts?.phone || '', checkInTime: stay.checkInTime, checkOutTime: stay.checkOutTime,
    amenities: stay.amenities, media: seededMedia(stay.image, stay.name, stay.imageLabel),
    paymentPolicy: 'Live Classic Trip payment terms pending partner room/rate setup.', depositPolicy: 'Pending partner confirmation.',
    policies: ['Public partner profile only — room inventory and rates pending hotel setup.'],
    status: 'active', createdBy: actorId, updatedBy: actorId, createdAt: SEEDED_AT, updatedAt: SEEDED_AT,
  };
  const propertyResult = await insertOnly(HotelProperty, { companyId: company.id || companyId, listingId: listing.id || listingId, status: { $ne: 'archived' } }, propertyDoc);
  if (propertyResult.created) counts.properties += 1;
  const property = propertyResult.row;
  if (apply && property && typeof property.save === 'function') {
    const legacyIdentity = isLegacySeedIdentity(stay, property);
    if (legacyIdentity) {
      property.propertyName = stay.name;
      property.normalizedName = stay.name.toLowerCase();
      property.hostDisplayName = stay.name;
      property.address = stay.address;
      property.city = stay.city;
      property.country = stay.country;
      property.contactEmail = stay.contacts?.email || '';
      property.contactPhone = stay.contacts?.phone || '';
      property.checkInTime = stay.checkInTime || property.checkInTime;
      property.checkOutTime = stay.checkOutTime || property.checkOutTime;
    }
    for (const [key, value] of Object.entries({ address: stay.address, city: stay.city, country: stay.country, contactEmail: stay.contacts?.email || '', contactPhone: stay.contacts?.phone || '', checkInTime: stay.checkInTime, checkOutTime: stay.checkOutTime })) {
      if (value && isBlank(property[key])) property[key] = value;
    }
    property.amenities = [...new Set([...(property.amenities || []), ...(stay.amenities || [])].filter(Boolean))];
    if (stay.image) {
      const currentMedia = Array.isArray(property.media) ? property.media : [];
      const currentSeedOwned = seedOwnedMedia(currentMedia);
      if (!currentMedia.length || currentSeedOwned) property.media = seededMedia(stay.image, stay.name, stay.imageLabel);
    }
    await property.save();
  }
}

async function saveCredentials(rows = []) {
  const generated = rows.filter((row) => row?.temporaryPassword);
  if (!apply || !generated.length) return;
  fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
  fs.writeFileSync(CREDENTIALS_PATH, `${JSON.stringify({ generatedAt: new Date().toISOString(), warning: 'Temporary seeded Stay Partner Admin credentials. Change each password after first login and delete this file.', accounts: generated }, null, 2)}\n`, { mode: 0o600 });
}

async function main() {
  await connectDb();
  const superAdmin = await User.findOne({ role: 'super_admin', status: 'active' }).sort({ createdAt: 1 });
  if (!superAdmin) throw new Error('No active Super Admin exists. Run npm run seed:superadmin first.');
  if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', requested: { stays: stays.map((stay) => stay.name), count: stays.length }, safety: 'Creates public profile-only stay listings and partner-admin onboarding accounts. It does not invent room prices, room units or dated inventory, and booking remains disabled until the hotel readiness workflow is completed.' }, null, 2));
    return;
  }
  const counts = { companies: 0, listings: 0, properties: 0, partnerAccounts: 0, partnerPasswordsReset: 0, enriched: 0 };
  const credentialRows = [];
  for (const baseStay of stays) {
    const stay = await resolveRealStayMedia(baseStay);
    await seedStay(stay, superAdmin, counts, credentialRows);
  }
  await saveCredentials(credentialRows);
  invalidateMarketplaceCache();
  console.log(JSON.stringify({ mode: 'apply', created: counts, credentialsFile: CREDENTIALS_PATH, partnerCredentials: credentialRows, note: 'Stay partner profiles are public for discovery but non-bookable. Add partner-approved media, room types, physical room units, rate plans and dated inventory, then publish through the hotel readiness gate before accepting payment.' }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await mongoose.disconnect().catch(() => {}); });
