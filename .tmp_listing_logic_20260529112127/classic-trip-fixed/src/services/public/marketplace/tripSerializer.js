const TYPE_ORDER = ["bus", "hotel", "flight", "train"];

const DEFAULT_IMAGES = {
  bus: "https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=1200&q=70",
  hotel: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=70",
  flight: "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1200&q=70",
  train: "https://images.unsplash.com/photo-1474487548417-781cb71495f3?auto=format&fit=crop&w=1200&q=70"
};

function titleForTrip(trip) {
  const route = trip.routeId || {};
  return route.title || `${route.from || route.city || "Classic"} -> ${route.to || route.city || "Trip"}`;
}

function imageForTrip(trip) {
  const route = trip.routeId || {};
  const vehicle = trip.vehicleId || {};
  return (
    route.images?.[0]?.url ||
    vehicle.images?.[0]?.url ||
    DEFAULT_IMAGES[route.type] ||
    DEFAULT_IMAGES.bus
  );
}

function remainingSeats(trip) {
  return Math.max(
    0,
    Number(trip.totalSeats || 0) - Number(trip.bookedSeats || 0) - Number(trip.heldSeats || 0)
  );
}

function serializeTrip(trip) {
  const route = trip.routeId || {};
  const vehicle = trip.vehicleId || {};

  return {
    _id: String(trip._id),
    type: route.type || "bus",
    title: titleForTrip(trip),
    description: route.description || "",
    country: route.country || "",
    city: route.city || "",
    from: route.from || route.city || "",
    to: route.to || route.city || "",
    address: route.address || "",
    partner: vehicle.name || "Classic Trip Partner",
    departureAt: trip.departureAt,
    arriveAt: trip.arriveAt,
    basePrice: Number(trip.basePrice || 0),
    currency: trip.currency || route.currency || "UGX",
    policy: route.policy || "Instant confirmation",
    ratingAvg: Number(route.ratingAvg || 0),
    ratingCount: Number(route.ratingCount || 0),
    totalSeats: Number(trip.totalSeats || vehicle.totalSeats || 0),
    bookedSeats: Number(trip.bookedSeats || 0),
    heldSeats: Number(trip.heldSeats || 0),
    remainingSeats: remainingSeats(trip),
    image: imageForTrip(trip),
    vehicle: {
      id: vehicle._id ? String(vehicle._id) : "",
      name: vehicle.name || "",
      type: vehicle.type || route.type || "bus",
      layoutName: vehicle.layoutName || "",
      rows: Number(vehicle.rows || 0),
      cols: Number(vehicle.cols || 0)
    }
  };
}

module.exports = {
  TYPE_ORDER,
  serializeTrip
};
