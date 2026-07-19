const timelineService = require('../../services/support/timelineService');
const store = require('../../services/data/persistentStore');
const { pushFlash } = require('../../middlewares/flash');
const { ownsBooking } = require('../../utils/bookingOwnership');

async function requestReschedule(req, res, next) {
  try {
    const bookingRef = req.body.bookingRef || req.params.bookingRef;
    const user = req.session?.user || {};
    const userId = user.id;
    const booking = store.findBooking(bookingRef);
    if (!booking || !ownsBooking(booking, user)) {
      pushFlash(req, 'error', 'You do not have permission to reschedule this booking.');
      return res.redirect('/account/support');
    }
    await timelineService.requestReschedule({
      bookingRef,
      requesterId: userId || 'customer',
      preferredDate: req.body.preferredDate,
      preferredTime: req.body.preferredTime,
      requestedScheduleId: req.body.requestedScheduleId,
      reason: req.body.reason,
    });
    return res.redirect('/account/support');
  } catch (error) {
    return next(error);
  }
}

module.exports = { requestReschedule };
