const store = require('../../services/data/persistentStore');
const partnerPipelineService = require('../../services/onboarding/partnerPipelineService');
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
    const lead = await partnerPipelineService.createLead({
      businessName: req.body.name,
      companyType: req.body.companyType,
      contactName: req.body.contactName,
      email: req.body.email,
      phone: req.body.phone,
      whatsapp: req.body.whatsapp,
      city: req.body.city || '',
      country: req.body.country || 'Uganda',
      notes: req.body.notes,
      sourceChannel: 'public_partner_form',
      sourcePath: req.originalUrl,
    }, cleanText(req.body.email || 'public-partner-request'));

    const ticket = {
      id: nextId('support', store.state.supportTickets),
      ownerType: 'partner_lead',
      ownerId: lead.id,
      companyId: '',
      category: 'Partner onboarding',
      subject: `Partner request: ${lead.businessName}`,
      message: `Contact ${cleanText(req.body.contactName)} at ${cleanText(req.body.email)} / ${cleanText(req.body.phone)} for verification.`,
      priority: 'high',
      status: 'open',
      assignedTo: 'admin-onboarding',
      createdBy: cleanText(req.body.email || 'partner-request'),
      createdAt: new Date().toISOString(),
      meta: { source: 'public_partner_form', leadId: lead.id },
    };
    store.state.supportTickets.unshift(ticket);
    await persist(ticket);
    return res.redirect('/login#partner');
  } catch (error) {
    return next(error);
  }
}

module.exports = { create };
