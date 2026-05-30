const { User } = require("../../../models/shared");
const { ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD } = require("../../../config/app");
const { createOptions, withSession } = require("../../shared/database");
const { hashPassword } = require("../../../utils/auth");

async function getPlatformUser(session = null) {
  let user = await withSession(User.findOne({ role: "admin" }).sort("createdAt"), session);
  if (user) return user;

  const email = String(ADMIN_EMAIL || "platform@classictrip.local").toLowerCase().trim();
  const passwordHash = await hashPassword(ADMIN_PASSWORD || "AdminPass123!");

  try {
    [user] = await User.create(
      [{
        name: ADMIN_NAME || "Classic Trip Platform",
        email,
        passwordHash,
        role: "admin",
        status: "active"
      }],
      createOptions(session)
    );
  } catch (err) {
    if (String(err.code) === "11000") {
      user = await withSession(User.findOne({ email }), session);
    } else {
      throw err;
    }
  }

  return user;
}

module.exports = {
  getPlatformUser
};
