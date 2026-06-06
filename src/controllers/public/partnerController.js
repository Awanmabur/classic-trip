const companyService = require('../../services/company/companyService');
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
    const company = await companyService.createCompany({
      name: req.body.name,
      companyType: req.body.companyType,
      country: req.body.country,
      city: req.body.city || '',
      email: req.body.email,
      phone: req.body.phone,
      description: `Partner request from ${cleanText(req.body.contactName || req.body.email)}`,
    });

    const ticket = {
      id: nextId('support', store.state.supportTickets),
      ownerType: 'company',
      ownerId: company.id,
      companyId: company.id,
      category: 'Partner onboarding',
      subject: `Partner request: ${company.name}`,
      message: `Contact ${cleanText(req.body.contactName)} at ${cleanText(req.body.email)} / ${cleanText(req.body.phone)} for verification.`,
      priority: 'high',
      status: 'open',
      assignedTo: 'admin-onboarding',
      createdBy: cleanText(req.body.email || 'partner-request'),
      createdAt: new Date().toISOString(),
      meta: { source: 'public_partner_form', companySlug: company.slug },
    };
    store.state.supportTickets.unshift(ticket);
    await persist(ticket);
    return res.redirect('/login#partner');
  } catch (error) {
    return next(error);
  }
}

module.exports = { create };
