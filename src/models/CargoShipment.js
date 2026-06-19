const { Schema, model } = require('./_helpers');

const cargoShipmentSchema = new Schema({
  id: { type: String, index: true }, shipmentRef: { type: String, index: true }, sender: { name: String, phone: String }, receiver: { name: String, phone: String },
  routeId: String, waybillNumber: String, trackingEvents: [{ status: String, location: String, at: Date, note: String }], paymentId: String,
  deliveryProof: { receivedBy: String, signatureUrl: String, photoUrl: String, deliveredAt: Date }, status: { type: String, default: 'planned' },
}, { timestamps: true });
module.exports = model('CargoShipment', cargoShipmentSchema);
