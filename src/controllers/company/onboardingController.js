const busServiceOnboarding = require('../../services/company/busServiceOnboarding');
const { resolveCompanyId } = require('../../utils/companyScope');

function actorId(req) {
  return req.session?.user?.id || 'company-admin';
}

async function createBusService(req, res, next) {
  try {
    const companyId = resolveCompanyId(req);
    const payload = {
      listing: req.body.listing || {},
      vehicle: req.body.vehicle || {},
      route: req.body.route || {},
      schedule: req.body.schedule || {},
    };
    const result = await busServiceOnboarding.createBusService(companyId, payload, {
      actorId: actorId(req),
      idempotencyKey: req.body.idempotencyKey || req.get('Idempotency-Key') || '',
    });
    res.redirect(`/company/schedules?created=${encodeURIComponent(result.listing.id)}`);
  } catch (error) {
    next(error);
  }
}

module.exports = { createBusService };
