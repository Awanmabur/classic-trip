const { Schema, model } = require('./_helpers');

const trainInventorySchema = new Schema({
  id: { type: String, index: true }, stationCode: String, stationName: String, routeId: String, originStation: String, destinationStation: String,
  coachCode: String, coachClass: String, seatNumber: String, scheduleId: String, departAt: Date, arriveAt: Date,
  ticketNumber: String, boardingStatus: String, manifestGroup: String, status: { type: String, default: 'planned' },
}, { timestamps: true });
module.exports = model('TrainInventory', trainInventorySchema);
