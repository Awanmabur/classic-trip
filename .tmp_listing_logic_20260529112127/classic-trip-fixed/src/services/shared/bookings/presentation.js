function toPlainObject(value) {
  if (!value) return {};
  if (typeof value.toObject === "function") {
    return value.toObject();
  }
  return { ...value };
}

function bookingCodeFor(booking) {
  return booking.guestLookupCode || String(booking._id || booking.id || "").slice(-8).toUpperCase();
}

function bookingServiceSnapshot(bookingLike) {
  const booking = toPlainObject(bookingLike);
  const trip = booking.tripId && typeof booking.tripId === "object" && !Array.isArray(booking.tripId)
    ? booking.tripId
    : {};
  const route = trip.routeId && typeof trip.routeId === "object" ? trip.routeId : {};
  const vehicle = trip.vehicleId && typeof trip.vehicleId === "object" ? trip.vehicleId : {};

  return {
    tripCatalogId: booking.tripCatalogId || null,
    tenantTripId: trip._id || booking.tripId || null,
    serviceName: booking.serviceName || route.title || "Trip",
    serviceType: booking.serviceType || route.type || "bus",
    serviceFrom: booking.serviceFrom || route.from || route.city || "",
    serviceTo: booking.serviceTo || route.to || route.city || "",
    serviceAddress: booking.serviceAddress || route.address || "",
    vehicleName: booking.vehicleName || vehicle.name || ""
  };
}

function buildPublicTripShape(bookingLike) {
  const snapshot = bookingServiceSnapshot(bookingLike);

  return {
    _id: snapshot.tripCatalogId || snapshot.tenantTripId || null,
    routeId: {
      title: snapshot.serviceName,
      type: snapshot.serviceType,
      from: snapshot.serviceFrom,
      to: snapshot.serviceTo,
      address: snapshot.serviceAddress
    },
    vehicleId: {
      name: snapshot.vehicleName
    }
  };
}

function serializePublicBooking(bookingLike) {
  const booking = toPlainObject(bookingLike);
  const snapshot = bookingServiceSnapshot(booking);

  return {
    ...booking,
    code: bookingCodeFor(booking),
    tripCatalogId: snapshot.tripCatalogId,
    tenantTripId: snapshot.tenantTripId,
    serviceName: snapshot.serviceName,
    serviceType: snapshot.serviceType,
    serviceFrom: snapshot.serviceFrom,
    serviceTo: snapshot.serviceTo,
    serviceAddress: snapshot.serviceAddress,
    vehicleName: snapshot.vehicleName,
    tripId: buildPublicTripShape(booking)
  };
}

module.exports = {
  bookingCodeFor,
  bookingServiceSnapshot,
  buildPublicTripShape,
  serializePublicBooking,
  toPlainObject
};
