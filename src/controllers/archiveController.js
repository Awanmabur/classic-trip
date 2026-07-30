'use strict';

const archiveService = require('../services/archive/archiveService');
const { resolveCompanyId } = require('../utils/companyScope');
const { resolveCustomerId } = require('../utils/customerScope');
const { resolvePromoterId } = require('../utils/promoterScope');

const REDIRECTS = Object.freeze({
  admin: '/admin/archive',
  company: '/company/dashboard/archive',
  customer: '/account/archive',
  promoter: '/promoter/archive',
  support: '/support/dashboard/archive',
  finance: '/finance/dashboard/archive',
  operations: '/operations/dashboard/archive',
  content: '/content/dashboard/archive',
});

function contextFor(req, scope) {
  if (['company', 'employee', 'driver'].includes(scope)) {
    return { companyId: resolveCompanyId(req) };
  }
  if (scope === 'customer') return { customerId: resolveCustomerId(req) };
  if (scope === 'promoter') return { promoterId: resolvePromoterId(req) };
  return {};
}

function restoreFor(scope) {
  return async (req, res, next) => {
    try {
      const restored = await archiveService.restore({
        scope,
        modelName: String(req.params.model || ''),
        recordId: String(req.params.id || ''),
        context: contextFor(req, scope),
        actor: {
          id: req.session?.user?.id || '',
          role: req.session?.user?.role || '',
        },
      });
      if (req.flash) {
        req.flash(
          'success',
          `${restored.type} restored safely as ${restored.restoreTarget || 'inactive'}. Review it before publishing.`,
        );
      }
      res.redirect(REDIRECTS[scope] || '/');
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { restoreFor, contextFor, REDIRECTS };
