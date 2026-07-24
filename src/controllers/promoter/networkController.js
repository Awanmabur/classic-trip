const networkService = require('../../services/promoter/promoterNetworkService');
const promoterRepository = require('../../repositories/domain/promoterRepository');
const { resolvePromoterId } = require('../../utils/promoterScope');
function promoterId(req) { return resolvePromoterId(req); }
async function ensureAgentProfile(req, res, next) { try { await networkService.ensureAgentProfile(promoterId(req), req.body, promoterId(req)); return res.redirect('/promoter/profile'); } catch (error) { return next(error); } }
async function createEnhancedLink(req, res, next) { try { await networkService.createReferralLinkLive({ ...req.body, promoterId: promoterId(req) }, promoterId(req)); return res.redirect('/promoter/links'); } catch (error) { return next(error); } }
async function qrCard(req, res, next) { try { const card = await networkService.createQrReferralCardLive(promoterId(req), req.params.id); return res.render('pages/promoter-qr-card', { title: 'Promoter QR Referral Card', card, csrfToken: req.csrfToken?.() || '' }); } catch (error) { return next(error); } }
async function reviewFraudSignal(req, res, next) { try { await networkService.reviewFraudSignalLive(req.params.id, req.body, req.session?.user?.id || 'admin-system'); return res.redirect(req.get('referer') || '/admin/promoters'); } catch (error) { return next(error); } }
async function adminPromoterSummary(req, res, next) {
  try {
    const [agentProfiles, attributionSessions, campaignConversions, fraudSignals] = await Promise.all([
      promoterRepository.profiles.list({}, { sort: { createdAt: -1 }, limit: 500 }), promoterRepository.attributionSessions.list({}, { sort: { createdAt: -1 }, limit: 1000 }),
      promoterRepository.conversions.list({}, { sort: { createdAt: -1 }, limit: 1000 }), promoterRepository.fraudSignals.list({}, { sort: { createdAt: -1 }, limit: 1000 }),
    ]);
    return res.json({ agentProfiles, attributionSessions, campaignConversions, fraudSignals });
  } catch (error) { return next(error); }
}
module.exports = { ensureAgentProfile, createEnhancedLink, qrCard, reviewFraudSignal, adminPromoterSummary };
