const promoterService = require('../../services/promoter/promoterService');
const { resolvePromoterId } = require('../../utils/promoterScope');

async function create(req, res, next) {
  try {
    await promoterService.createLinkLive({
      promoterId: resolvePromoterId(req),
      listingId: req.body.listingId,
      code: req.body.code,
    });
    res.redirect('/promoter/links');
  } catch (error) {
    next(error);
  }
}

async function archive(req, res, next) {
  try {
    const promoterId = resolvePromoterId(req);
    await promoterService.archiveLinkLive({
      promoterId,
      linkId: req.params.id,
      actorId: promoterId,
    });
    res.redirect('/promoter/links');
  } catch (error) {
    next(error);
  }
}

module.exports = { create, archive };
