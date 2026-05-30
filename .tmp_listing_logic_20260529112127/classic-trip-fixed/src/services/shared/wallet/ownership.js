const { User } = require("../../../models/shared");
const { withSession } = require("../database");

async function resolveOwnerType(ownerId, session = null) {
  const user = await withSession(User.findById(ownerId).select("role"), session).lean();
  if (!user) return "user";
  if (["company_admin", "partner"].includes(user.role)) return "company";
  if (["admin", "super_admin"].includes(user.role)) return "platform";
  return "user";
}

module.exports = {
  resolveOwnerType
};
