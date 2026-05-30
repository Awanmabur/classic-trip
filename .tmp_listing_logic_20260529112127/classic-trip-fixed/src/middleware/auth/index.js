const { auth, optionalAuth } = require("./authenticate");
const { requireRole } = require("./authorize");

module.exports = {
  auth,
  optionalAuth,
  requireRole
};
