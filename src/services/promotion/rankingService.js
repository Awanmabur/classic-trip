function rankListings(listings = []) {
  return listings.slice().sort((a, b) => score(b) - score(a));
}

function score(listing) {
  return (listing.isSponsored ? 20 : 0) + (listing.isVerified ? 10 : 0) + (listing.bookable ? 8 : 0) + (listing.ratingAverage || 0) * 8 + Math.min(listing.reviewCount || 0, 500) / 25;
}

module.exports = { rankListings, score };
