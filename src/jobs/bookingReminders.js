const store = require('../services/data/demoStore');
function run() { return store.state.bookings.filter((b) => b.bookingStatus === 'confirmed').map((b) => ({ bookingRef: b.bookingRef, queued: true })); }
module.exports = { run };
