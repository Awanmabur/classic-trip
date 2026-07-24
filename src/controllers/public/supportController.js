const supportRepository = require('../../repositories/domain/supportRepository');
const ticketAccessService = require('../../services/booking/ticketAccessService');
const { nextId } = require('../../services/data/idService');
function cleanText(value, max = 2000) { return String(value || '').replace(/<[^>]*>/g, '').trim().replace(/\s+/g, ' ').slice(0, max); }
async function create(req, res, next) {
  try {
    const bookingRef = cleanText(req.body.bookingRef || '', 120).replace(/^#/, '');
    const booking = bookingRef ? await supportRepository.bookings.findOne({ bookingRef }) : null;
    const contact = cleanText(req.body.contact || req.body.email || req.body.phone || '', 254);
    if (booking && !(ticketAccessService.contactMatches(booking, contact) || ticketAccessService.accessCodeMatches(booking, req.body.accessCode || req.body.code || ''))) {
      const error = new Error('The booking contact or access code does not match'); error.status = 403; throw error;
    }
    if (!cleanText(req.body.message, 2000)) { const error = new Error('Support message is required'); error.status = 422; throw error; }
    const ticket = { id: await nextId('support'), ownerType: 'guest', ownerId: contact || 'guest', companyId: booking?.companyId || '', bookingRef: booking?.bookingRef || bookingRef, category: cleanText(req.body.category || req.body.topic || 'Public support', 120), subject: cleanText(req.body.subject || req.body.category || 'Public support request', 180), message: cleanText(req.body.message, 2000), priority: ['low','normal','high','urgent'].includes(String(req.body.priority || '').toLowerCase()) ? String(req.body.priority).toLowerCase() : 'normal', status: 'open', assignedTo: 'support', createdBy: contact || 'guest', createdAt: new Date().toISOString(), metadata: { name: cleanText(req.body.fullName || req.body.name || '', 160), contact, source: 'public_support_form', ip: req.ip } };
    await supportRepository.tickets.save(ticket, { id: ticket.id });
    return res.redirect('/login#support');
  } catch (error) { return next(error); }
}
module.exports = { create };
