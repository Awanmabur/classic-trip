const bookingService = require('../../services/booking/bookingService');
function cancel(req, res) { bookingService.cancelBooking(req.params.bookingRef, req.body.reason); res.redirect('/account/bookings'); }
module.exports = { cancel };
