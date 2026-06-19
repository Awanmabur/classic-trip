const { Schema, model } = require('./_helpers');

const eventTicketInventorySchema = new Schema({
  id: { type: String, index: true }, venueId: String, venueName: String, eventId: String, eventName: String, eventDate: Date,
  ticketTiers: [{ tierId: String, name: String, capacity: Number, price: Number }], seatMapId: String, qrEntryEnabled: Boolean,
  promoterLinkIds: [String], status: { type: String, default: 'planned' },
}, { timestamps: true });
module.exports = model('EventTicketInventory', eventTicketInventorySchema);
