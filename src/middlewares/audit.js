const store = require('../services/data/demoStore');

function audit(action) {
  return (req, res, next) => {
    store.state.auditLogs.push({
      id: `audit-${store.state.auditLogs.length + 1}`,
      actorId: req.session?.user?.id || 'guest',
      actorRole: req.session?.user?.role || 'guest',
      action,
      target: req.originalUrl,
      ip: req.ip,
      createdAt: new Date().toISOString(),
    });
    next();
  };
}

module.exports = { audit };
