'use strict';

const SEEDED_BLOG_IMAGE_FILES = Object.freeze({
  'how-to-book-bus-tickets-online-uganda-east-africa': '/images/blogs/v1645-book-bus-online.webp',
  'kampala-to-juba-bus-travel-guide': '/images/blogs/v1645-kampala-juba.webp',
  'kampala-to-nairobi-bus-travel-guide': '/images/blogs/v1645-kampala-nairobi.webp',
  'uganda-bus-travel-gulu-lira-arua-soroti-mbale-guide': '/images/blogs/v1645-uganda-intercity.jpg',
  'east-africa-cross-border-bus-travel-checklist': '/images/blogs/v1645-cross-border.webp',
  'how-classic-trip-secure-online-bus-booking-payments-tickets': '/images/blogs/v1645-secure-booking.png',
  'when-to-book-bus-tickets-uganda-holidays-weekends-night-travel': '/images/blogs/v1645-holiday-night-travel.webp',
});

const SEEDED_OPERATOR_IMAGE_FILES = Object.freeze({
  'bebeto-coach-services': '/images/operators/bebeto-coach.webp',
  'trinity-express': '/images/operators/trinity-express.webp',
  'zawadi-travel-service': '/images/operators/zawadi-travel-service.jpg',
  'eco-bus': '/images/operators/eco-bus.webp',
  'friendship-bus': '/images/operators/friendship-bus.png',
  'yy-coaches': '/images/operators/yy-coaches.webp',
});



// These URLs were used by older launch seeds. They are not user uploads: they
// are known seed values that may hotlink-block, expire or reject browser
// requests. Treating them as custom media prevented the Cloudinary migration
// from repairing exactly the records it was created to repair.
const LEGACY_SEEDED_BLOG_URLS = Object.freeze({
  'how-to-book-bus-tickets-online-uganda-east-africa': ['https://bebetocoachservices.com/bebeto-hero.jpg.jpeg'],
  'kampala-to-juba-bus-travel-guide': ['https://bebetocoachservices.com/bebeto18.jpg.jpeg'],
  'kampala-to-nairobi-bus-travel-guide': ['https://bebetocoachservices.com/bebeto-nrb1.jpg.jpeg'],
  'uganda-bus-travel-gulu-lira-arua-soroti-mbale-guide': ['https://zawadigroups.com/wp-content/uploads/2021/11/ZAWADI-BUSES.jpg'],
  'east-africa-cross-border-bus-travel-checklist': ['https://trinityexpress.rw/images/bus-hero-image.jpg'],
  'how-classic-trip-secure-online-bus-booking-payments-tickets': ['https://bebetocoachservices.com/bebeto16.jpg.jpeg'],
  'when-to-book-bus-tickets-uganda-holidays-weekends-night-travel': ['https://cdn.bookaway.com/media/files/69a87ac00e780962303253c5.jpeg'],
});

const LEGACY_SEEDED_OPERATOR_URLS = Object.freeze({
  'bebeto-coach-services': ['https://bebetocoachservices.com/bebeto-hero.jpg.jpeg'],
  'trinity-express': ['https://trinityexpress.rw/images/bus-hero-image.jpg'],
  'zawadi-travel-service': ['https://zawadigroups.com/wp-content/uploads/2021/11/ZAWADI-BUSES.jpg'],
  'eco-bus': ['https://pbs.twimg.com/media/FaWRexRXEAANcyV.jpg'],
  'friendship-bus': ['https://booking.ttta.co.ug/wp-content/uploads/2024/07/friends-bus.jpg'],
  'yy-coaches': ['https://cdn.bookaway.com/media/files/69a87ac00e780962303253c5.jpeg'],
});

function normalizedUrl(value) { return String(value || '').trim().replace(/\/$/, '').toLowerCase(); }
function legacyUrlMatches(map, key, value) {
  const current = normalizedUrl(value);
  if (!current) return false;
  return (map[String(key || '').trim()] || []).some((candidate) => normalizedUrl(candidate) === current);
}
function isLegacySeedBlogUrl(slug, value) { return legacyUrlMatches(LEGACY_SEEDED_BLOG_URLS, slug, value); }
function isLegacySeedOperatorUrl(key, value) { return legacyUrlMatches(LEGACY_SEEDED_OPERATOR_URLS, key, value); }

const SEEDED_BLOG_IMAGES = Object.freeze(Object.fromEntries(
  Object.keys(SEEDED_BLOG_IMAGE_FILES).map((slug) => [slug, `/media/blog/${encodeURIComponent(slug)}`]),
));

const SEEDED_OPERATOR_IMAGES = Object.freeze(Object.fromEntries(
  Object.keys(SEEDED_OPERATOR_IMAGE_FILES).map((key) => [key, `/media/operator/${encodeURIComponent(key)}`]),
));

module.exports = {
  SEEDED_BLOG_IMAGE_FILES,
  SEEDED_OPERATOR_IMAGE_FILES,
  SEEDED_BLOG_IMAGES,
  SEEDED_OPERATOR_IMAGES,
  LEGACY_SEEDED_BLOG_URLS,
  LEGACY_SEEDED_OPERATOR_URLS,
  isLegacySeedBlogUrl,
  isLegacySeedOperatorUrl,
};
