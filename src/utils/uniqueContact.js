function assertContactAvailable(store, currentUserId, { email, phone } = {}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedPhone = String(phone || '').trim();
  if (normalizedEmail) {
    const clash = store.state.users.find((user) => user.id !== currentUserId && String(user.email || '').toLowerCase() === normalizedEmail);
    if (clash) {
      const error = new Error('That email address is already in use by another account.');
      error.status = 409;
      throw error;
    }
  }
  if (normalizedPhone) {
    const clash = store.state.users.find((user) => user.id !== currentUserId && String(user.phone || '') === normalizedPhone);
    if (clash) {
      const error = new Error('That phone number is already in use by another account.');
      error.status = 409;
      throw error;
    }
  }
}

module.exports = { assertContactAvailable };
