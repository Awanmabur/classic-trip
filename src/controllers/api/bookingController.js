const bookingService = require('../../services/booking/bookingService');
const store = require('../../services/data/demoStore');
async function create(req, res, next) { try { const booking = await bookingService.createGuestBooking(req.body, req); res.status(201).json({ booking, ticketUrl: `/tickets/${booking.bookingRef}` }); } catch (error) { next(error); } }
function show(req, res) { const booking = store.findBooking(req.params.bookingRef); if (!booking) return res.status(404).json({ error: 'booking_not_found' }); return res.json({ booking }); }
module.exports = { create, show };
