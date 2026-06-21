const store = require('../services/data/persistentStore');
const repositories = require('../repositories');

function audit(action) {
  return (req, res, next) => {
    const row = {
      id: `audit-${store.state.auditLogs.length + 1}`,
      actorId: req.session?.user?.id || 'guest',
      actorName: req.session?.user?.fullName || '',
      actorRole: req.session?.user?.role || 'guest',
      action,
      target: req.originalUrl,
      ip: req.ip,
      userAgent: req.headers?.['user-agent'] || '',
      status: 'success',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.state.auditLogs.unshift(row);
    // Persist asynchronously — do not block the request.
    repositories.repositoryFor('auditLogs').upsert(row).catch(() => {});
    next();
  };
}

module.exports = { audit };
