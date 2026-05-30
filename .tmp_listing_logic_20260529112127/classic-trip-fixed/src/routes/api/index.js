const router = require("express").Router();

const namespacedRoutes = [
  ["/public", require("./public")],
  ["/tenant", require("./tenant")],
  ["/platform", require("./platform")]
];

namespacedRoutes.forEach(([path, handler]) => router.use(path, handler));

module.exports = router;
