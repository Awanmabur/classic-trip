const bcrypt = require("bcryptjs");

async function hashPassword(pw) {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(String(pw), salt);
}

async function comparePassword(pw, hash) {
  return bcrypt.compare(String(pw), String(hash));
}

module.exports = { hashPassword, comparePassword };
