module.exports = (schema) => (req, res, next) => {
  const input = { body: req.body, params: req.params, query: req.query };
  const r = schema.safeParse(input);
  if (!r.success) {
    return res.status(400).json({
      ok: false,
      message: "Validation error",
      errors: r.error.flatten()
    });
  }
  req.validated = r.data;
  next();
};
