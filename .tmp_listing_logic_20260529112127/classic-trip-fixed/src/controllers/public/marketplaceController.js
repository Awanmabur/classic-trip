const { asyncHandler } = require("../../middleware/http");
const { buildMarketplaceBootstrap } = require("../../services/public/marketplace");

exports.bootstrap = asyncHandler(async (req, res) => {
  const payload = await buildMarketplaceBootstrap(req.tenant || null);
  res.json({ ok: true, ...payload });
});
