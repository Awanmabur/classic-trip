'use strict';

// Launch media is presentation data only. The photographs are tied to an
// identified operator/public source, but they never count as compliance or
// ownership evidence and must not make a draft listing bookable.
const OPERATOR_MEDIA = Object.freeze({
  'bebeto-coach-services': Object.freeze({
    url: 'https://bebetocoachservices.com/bebeto-hero.jpg.jpeg',
    sourceUrl: 'https://bebetocoachservices.com/',
    sourceLabel: 'Bebeto Coach Services official website',
    alt: 'Bebeto Coach Services long-distance coach in East Africa',
  }),
  'trinity-express': Object.freeze({
    url: 'https://trinityexpress.rw/images/bus-hero-image.jpg',
    sourceUrl: 'https://trinityexpress.rw/',
    sourceLabel: 'Trinity Express public operator website',
    alt: 'Trinity Express coaches ready for regional service',
  }),
  'zawadi-travel-service': Object.freeze({
    url: 'https://zawadigroups.com/wp-content/uploads/2021/11/ZAWADI-BUSES.jpg',
    sourceUrl: 'https://zawadigroups.com/transport/',
    sourceLabel: 'Zawadi Group official transport page',
    alt: 'Zawadi Services passenger buses in Uganda',
  }),
  'eco-bus': Object.freeze({
    url: 'https://pbs.twimg.com/media/FaWRexRXEAANcyV.jpg',
    sourceUrl: 'https://x.com/EcobusCoaches',
    sourceLabel: 'EcoBus Coaches public operator profile',
    alt: 'EcoBus regional coach serving Uganda and South Sudan',
  }),
  'friendship-bus': Object.freeze({
    url: 'https://booking.ttta.co.ug/wp-content/uploads/2024/07/friends-bus.jpg',
    sourceUrl: 'https://booking.ttta.co.ug/Bus/friendship-bus-coaches-kampala-to-juba/',
    sourceLabel: 'Friendship Bus public booking profile',
    alt: 'Friendship Bus coach serving the Kampala and Juba corridor',
  }),
  'yy-coaches': Object.freeze({
    url: 'https://cdn.bookaway.com/media/files/69a87ac00e780962303253c5.jpeg',
    sourceUrl: 'https://www.bookaway.com/suppliers/yy-coaches',
    sourceLabel: 'YY Coaches public booking profile',
    alt: 'YY Coaches intercity bus in Uganda',
  }),
});

const BLOG_MEDIA = Object.freeze({
  'how-to-book-bus-tickets-online-uganda-east-africa': Object.freeze({ url: 'https://bebetocoachservices.com/bebeto-hero.jpg.jpeg', sourceUrl: 'https://bebetocoachservices.com/', alt: 'A real East African coach ready for an online-booked journey' }),
  'kampala-to-juba-bus-travel-guide': Object.freeze({ url: 'https://bebetocoachservices.com/bebeto18.jpg.jpeg', sourceUrl: 'https://bebetocoachservices.com/destinations', alt: 'A long-distance coach serving the Kampala and Juba travel corridor' }),
  'kampala-to-nairobi-bus-travel-guide': Object.freeze({ url: 'https://bebetocoachservices.com/bebeto-nrb1.jpg.jpeg', sourceUrl: 'https://bebetocoachservices.com/destinations', alt: 'A real coach used for travel between Kampala and Nairobi' }),
  'uganda-bus-travel-gulu-lira-arua-soroti-mbale-guide': Object.freeze({ url: 'https://zawadigroups.com/wp-content/uploads/2021/11/ZAWADI-BUSES.jpg', sourceUrl: 'https://zawadigroups.com/transport/', alt: 'Ugandan intercity buses serving regional destinations' }),
  'east-africa-cross-border-bus-travel-checklist': Object.freeze({ url: 'https://trinityexpress.rw/images/bus-hero-image.jpg', sourceUrl: 'https://trinityexpress.rw/', alt: 'Regional coaches prepared for cross-border travel in East Africa' }),
  'how-classic-trip-secure-online-bus-booking-payments-tickets': Object.freeze({ url: 'https://bebetocoachservices.com/bebeto16.jpg.jpeg', sourceUrl: 'https://bebetocoachservices.com/destinations', alt: 'A real coach representing verified online bus booking and ticketing' }),
  'when-to-book-bus-tickets-uganda-holidays-weekends-night-travel': Object.freeze({ url: 'https://cdn.bookaway.com/media/files/69a87ac00e780962303253c5.jpeg', sourceUrl: 'https://www.bookaway.com/suppliers/yy-coaches', alt: 'A Ugandan intercity bus used for daily and peak-period travel' }),
});

function text(value) {
  return String(value || '').trim();
}

function slug(value) {
  return text(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function mediaUrl(value) {
  if (Array.isArray(value)) return mediaUrl(value.find((item) => mediaUrl(item)) || '');
  if (value && typeof value === 'object') return text(value.secureUrl || value.url || value.image || value.src || value.publicId || value.public_id);
  return text(value);
}

function isLogoLikeImage(value) {
  const url = mediaUrl(value).toLowerCase();
  if (!url) return false;
  return /(?:^|[\/_\-.])(logo|logomark|brandmark|wordmark|favicon|app-icon|apple-touch-icon|logo-symbol|launch-lockup|classic-trip-icon)(?:[\/_\-.]|$)/i.test(url)
    || /\/images\/(?:launch-lockup|logo-symbol|classic-trip-icon|favicon|apple-touch-icon)/i.test(url);
}

function isMissingOrLogoLikeImage(value) {
  return !mediaUrl(value) || isLogoLikeImage(value);
}

function mediaAsset(definition, id, label) {
  if (!definition?.url) return null;
  return {
    id,
    url: definition.url,
    secureUrl: definition.url,
    publicId: definition.url,
    resourceType: 'image',
    alt: definition.alt,
    label,
    target: definition.sourceUrl,
    sourceLabel: definition.sourceLabel || '',
    complianceEvidence: false,
  };
}

function operatorKeyFor(listing = {}, company = {}) {
  const candidates = [
    company.slug,
    listing.companySlug,
    listing.operatorSlug,
    listing.slug,
    company.name,
    listing.companyName,
    listing.partner,
    listing.title,
  ].map(slug).filter(Boolean);
  return Object.keys(OPERATOR_MEDIA).find((key) => candidates.some((candidate) => candidate === key || candidate === `${key}-bus` || candidate.startsWith(`${key}-`))) || '';
}

function blogPresentation(blog = {}) {
  const definition = BLOG_MEDIA[slug(blog.slug)] || null;
  const current = mediaUrl(blog.image || blog.coverImage || blog.media);
  const useLaunchPhoto = Boolean(definition && isMissingOrLogoLikeImage(current));
  const image = useLaunchPhoto ? definition.url : current;
  return {
    ...blog,
    image,
    imageAlt: useLaunchPhoto ? definition.alt : (text(blog.imageAlt) || text(blog.media?.alt) || text(blog.title) || 'Classic Trip travel guide'),
    media: useLaunchPhoto ? mediaAsset(definition, `blog-photo-${slug(blog.slug)}`, 'Meaningful travel photograph') : blog.media,
    presentationMediaRepaired: useLaunchPhoto,
  };
}

function listingPresentationMedia(listing = {}, company = {}) {
  const operatorKey = operatorKeyFor(listing, company);
  const definition = operatorKey ? OPERATOR_MEDIA[operatorKey] : null;
  const existingMedia = Array.isArray(listing.media) ? listing.media.filter(Boolean) : [];
  const current = mediaUrl(listing.img || listing.image || listing.coverImage || existingMedia);
  const useOperatorPhoto = Boolean(definition && isMissingOrLogoLikeImage(current));
  const asset = useOperatorPhoto ? mediaAsset(definition, `listing-photo-${operatorKey}`, 'Real operator coach photograph') : null;
  const media = asset
    ? [asset, ...existingMedia.filter((item) => mediaUrl(item) !== asset.url && !isLogoLikeImage(item))]
    : existingMedia;
  return {
    operatorKey,
    image: asset?.url || current,
    imageAlt: asset?.alt || text(existingMedia[0]?.alt || listing.title || company.name || 'Travel service image'),
    media,
    repaired: useOperatorPhoto,
    source: definition || null,
  };
}

module.exports = {
  OPERATOR_MEDIA,
  BLOG_MEDIA,
  mediaUrl,
  isLogoLikeImage,
  isMissingOrLogoLikeImage,
  operatorKeyFor,
  blogPresentation,
  listingPresentationMedia,
  mediaAsset,
};
