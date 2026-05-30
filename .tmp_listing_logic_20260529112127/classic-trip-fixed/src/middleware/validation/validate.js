module.exports = (schema) => (req, res, next) => {
  const input = { body: req.body, params: req.params, query: req.query };
  const result = schema.safeParse(input);

  if (!result.success) {
    return res.status(400).json({
      ok: false,
      message: "Validation error",
      errors: result.error.flatten()
    });
  }

  req.validated = result.data;
  next();
};
