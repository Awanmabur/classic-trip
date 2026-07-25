'use strict';

const { Schema, model } = require('./_helpers');

const taxiRideEventSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  rideId: { type: String, required: true, index: true },
  rideRef: { type: String, required: true, index: true },
  bookingRef: { type: String, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  eventType: { type: String, required: true, enum: ['requested', 'payment_confirmed', 'dispatch_started', 'driver_assigned', 'driver_accepted', 'driver_arriving', 'arrived', 'ride_started', 'location_updated', 'ride_completed', 'customer_no_show', 'cancelled', 'refunded', 'incident'], index: true },
  fromStatus: String,
  toStatus: String,
  actorType: { type: String, enum: ['system', 'customer', 'driver', 'partner_staff', 'admin'], default: 'system' },
  actorId: String,
  note: String,
  location: Schema.Types.Mixed,
  metadata: Schema.Types.Mixed,
  occurredAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

taxiRideEventSchema.index({ rideId: 1, occurredAt: 1 });
module.exports = model('TaxiRideEvent', taxiRideEventSchema);
