const store = require('../../services/data/persistentStore');
const { mongoose } = require('../../config/db');

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function nextId(prefix, rows) {
  let index = rows.length + 1;
  let id = `${prefix}-${index}`;
  while (rows.some((row) => row.id === id)) {
    index += 1;
    id = `${prefix}-${index}`;
  }
  return id;
}

async function persist(ticket) {
  if (mongoose.connection.readyState !== 1) return;
  const SupportTicket = require('../../models/SupportTicket');
  await SupportTicket.updateOne({ id: ticket.id }, { $set: ticket }, { upsert: true, runValidators: true });
}

async function create(req, res, next) {
  try {
    if (!Array.isArray(store.state.supportTickets)) store.state.supportTickets = [];
    const bookingRef = cleanText(req.body.bookingRef || '').replace(/^#/, '');
    const booking = bookingRef ? store.findBooking(bookingRef) : null;
    const contact = cleanText(req.body.contact || req.body.email || req.body.phone || '');
    const ticket = {
      id: nextId('support', store.state.supportTickets),
      ownerType: 'guest',
      ownerId: contact || 'guest',
      companyId: booking?.companyId || '',
      bookingRef: booking?.bookingRef || bookingRef,
      category: cleanText(req.body.category || req.body.topic || 'Public support'),
      subject: cleanText(req.body.subject || req.body.category || 'Public support request'),
      message: cleanText(req.body.message),
      priority: cleanText(req.body.priority || 'normal').toLowerCase(),
      status: 'open',
      assignedTo: 'support',
      createdBy: contact || 'guest',
      createdAt: new Date().toISOString(),
      metadata: {
        name: cleanText(req.body.fullName || req.body.name || ''),
        contact,
        source: 'public_support_form',
      },
    };
    store.state.supportTickets.unshift(ticket);
    await persist(ticket);
    return res.redirect('/login#support');
  } catch (error) {
    return next(error);
  }
}

module.exports = { create };
