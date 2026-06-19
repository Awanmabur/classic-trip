const networkService = require('../../services/promoter/promoterNetworkService');
const store = require('../../services/data/persistentStore');

function promoterId(req) { return req.session?.user?.id || 'user-promoter-001'; }

function ensureAgentProfile(req, res, next) {
  try {
    networkService.ensureAgentProfile(promoterId(req), req.body, promoterId(req));
    res.redirect('/promoter/profile');
  } catch (error) { next(error); }
}

function createEnhancedLink(req, res, next) {
  try {
    networkService.createReferralLink({ ...req.body, promoterId: promoterId(req) }, promoterId(req));
    res.redirect('/promoter/links');
  } catch (error) { next(error); }
}

function qrCard(req, res, next) {
  try {
    const card = networkService.createQrReferralCard(promoterId(req), req.params.id);
    res.render('pages/promoter-qr-card', { title: 'Promoter QR Referral Card', layout: 'layouts/main', card, csrfToken: req.csrfToken?.() || '' });
  } catch (error) { next(error); }
}

function reviewFraudSignal(req, res, next) {
  try {
    networkService.reviewFraudSignal(req.params.id, req.body, req.session?.user?.id || 'admin-system');
    res.redirect(req.get('referer') || '/admin/promoters');
  } catch (error) { next(error); }
}

function adminPromoterSummary(req, res) {
  res.json({
    agentProfiles: store.state.agentProfiles,
    attributionSessions: store.state.attributionSessions,
    campaignConversions: store.state.campaignConversions,
    fraudSignals: store.state.fraudSignals,
  });
}

module.exports = { ensureAgentProfile, createEnhancedLink, qrCard, reviewFraudSignal, adminPromoterSummary };
