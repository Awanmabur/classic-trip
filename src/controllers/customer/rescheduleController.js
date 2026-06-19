const timelineService = require('../../services/support/timelineService');

async function requestReschedule(req, res, next) {
  try {
    await timelineService.requestReschedule({
      bookingRef: req.body.bookingRef || req.params.bookingRef,
      requesterId: req.session?.user?.id || 'customer',
      preferredDate: req.body.preferredDate,
      preferredTime: req.body.preferredTime,
      requestedScheduleId: req.body.requestedScheduleId,
      reason: req.body.reason,
    });
    res.redirect('/account/support');
  } catch (error) {
    next(error);
  }
}

module.exports = { requestReschedule };
