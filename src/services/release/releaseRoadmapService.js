const store = require('../data/persistentStore');

const futurePlatformFeatures = [
  {
    key: 'loyalty',
    label: 'Loyalty',
    release: 'future',
    bookable: false,
    status: 'planned',
    reason: 'Needs wallet maturity, reward rules, fraud controls, and customer account adoption.',
  },
  {
    key: 'whatsapp_automation',
    label: 'WhatsApp automation',
    release: 'future',
    bookable: false,
    status: 'planned',
    reason: 'Notification adapter is ready; automated conversational booking flows need provider templates and approval.',
  },
  {
    key: 'mobile_app',
    label: 'Mobile app',
    release: 'future',
    bookable: false,
    status: 'planned',
    reason: 'Launch after the web booking, ticketing, payouts, and support flows are stable in production.',
  },
];

function categoryRoadmap() {
  return store.state.categories.map((category) => {
    const listings = store.state.listings.filter((listing) => listing.serviceType === category.key);
    const bookableListings = listings.filter((listing) => listing.bookable && listing.status === 'active');
    return {
      key: category.key,
      label: category.label,
      icon: category.icon,
      release: category.release || (category.bookable ? 'v1' : 'architecture-ready'),
      status: category.status || 'active',
      bookable: Boolean(category.bookable),
      listingCount: listings.length,
      bookableListingCount: bookableListings.length,
      checkoutEnabled: Boolean(category.bookable && bookableListings.length),
      nextStep: category.bookable
        ? 'Keep production inventory, payment, ticketing, and support stable.'
        : 'Connect a provider, finalize inventory rules, enable checkout, then add scanner/support workflows.',
    };
  });
}

function roadmap() {
  const categories = categoryRoadmap();
  return {
    launchNow: categories.filter((item) => item.release === 'v1'),
    teasers: categories.filter((item) => item.release === 'teaser'),
    architectureReady: categories.filter((item) => item.release === 'architecture-ready'),
    plannedPlatformFeatures: futurePlatformFeatures,
  };
}

module.exports = { roadmap, categoryRoadmap };
