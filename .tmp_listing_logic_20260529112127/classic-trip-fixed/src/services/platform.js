const User = require("../models/user");
const { ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD } = require("../config/env");
const { hashPassword } = require("../utils/password");

function applySession(query, session) {
  return session ? query.session(session) : query;
}

function createOptions(session) {
  return session ? { session } : undefined;
}

async function getPlatformUser(session = null) {
  let user = await applySession(User.findOne({ role: "admin" }).sort("createdAt"), session);
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
      user = await applySession(User.findOne({ email }), session);
    } else {
      throw err;
    }
  }

  return user;
}

module.exports = { getPlatformUser };
