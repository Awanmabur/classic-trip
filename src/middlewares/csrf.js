function csrfToken(req, res, next) {
  res.locals.csrfToken = '';
  next();
}

module.exports = { csrfToken };
