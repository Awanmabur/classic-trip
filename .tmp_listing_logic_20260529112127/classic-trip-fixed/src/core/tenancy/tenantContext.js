function setTenantContext(req, tenant, tenantConnection = null) {
  req.tenant = tenant || null;
  req.tenantConnection = tenantConnection || null;
}

function getTenantContext(req) {
  return {
    tenant: req.tenant || null,
    tenantConnection: req.tenantConnection || null
  };
}

module.exports = {
  getTenantContext,
  setTenantContext
};
