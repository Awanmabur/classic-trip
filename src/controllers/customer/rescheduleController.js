const timelineService = require('../../services/support/timelineService');
const customerService = require('../../services/customer/customerService');
const { pushFlash } = require('../../middlewares/flash');

async function requestReschedule(req, res, next) {
  try {
    const bookingRef = req.body.bookingRef || req.params.bookingRef;
    const user = await customerService.requireSessionUser(req);
    const booking = await customerService.findOwnedBooking(bookingRef, user);
    if (!booking) {
      pushFlash(req, 'error', 'You do not have permission to reschedule this booking.');
      return res.redirect('/account/support');
    }
    const customerRepository = require('../../repositories/domain/customerRepository');
    await timelineService.requestReschedule({ bookingRef: booking.bookingRef, requesterId: user.id, preferredDate: req.body.preferredDate, preferredTime: req.body.preferredTime, requestedScheduleId: req.body.requestedScheduleId, reason: req.body.reason });
    return res.redirect('/account/support');
  } catch (error) { return next(error); }
}

module.exports = { requestReschedule };
