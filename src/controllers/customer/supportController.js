const store = require('../../services/data/demoStore');
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
    const user = req.session?.user || {};
    const message = cleanText(req.body.message);
    if (!message) {
      const error = new Error('Support message is required');
      error.status = 422;
      throw error;
    }
    const bookingRef = cleanText(req.body.bookingRef || '').replace(/^#/, '');
    const booking = bookingRef ? store.findBookingByAny(bookingRef) : null;
    const ticket = {
      id: nextId('support', store.state.supportTickets),
      ownerType: 'customer',
      ownerId: user.id || user.email || 'customer',
      companyId: booking?.companyId || '',
      bookingRef: booking?.bookingRef || bookingRef,
      category: cleanText(req.body.category || 'Customer support'),
      subject: cleanText(req.body.category || `Customer support ${booking?.bookingRef || ''}`),
      message,
      priority: cleanText(req.body.priority || 'normal').toLowerCase(),
      status: 'open',
      assignedTo: 'support',
      createdBy: user.id || 'customer',
      createdAt: new Date().toISOString(),
    };
    store.state.supportTickets.unshift(ticket);
    await persist(ticket);
    res.redirect('/account#support');
  } catch (error) {
    next(error);
  }
}

module.exports = { create };
