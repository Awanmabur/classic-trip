'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];
function expect(name, value) { checks.push({ name, ok: Boolean(value) }); }

const completion = read('public/css/completion-fixes.css');
const partnerNetwork = read('src/views/dashboards/shared/sections/admin-partner-network.ejs');
const dashboard = read('public/css/dashboard-workspace.css');
const authController = read('src/controllers/auth/authController.js');
const authService = read('src/services/auth/authService.js');
const accountState = read('src/services/auth/accountStateService.js');
const rateLimit = read('src/middlewares/rateLimit.js');
const snapshot = read('src/services/dashboard/dashboardSnapshotService.js');
const mongoDashboard = read('src/services/dashboard/mongoDashboardService.js');
const security = read('src/services/security/securityService.js');
const server = read('src/server.js');
const notifications = read('public/js/notifications.js');
const flashMiddleware = read('src/middlewares/flash.js');
const app = read('src/app.js');
const envExample = read('.env.example');

expect('dashboard body screen reset exists', /body\.dashboardBody\{[\s\S]*margin:0!important/.test(completion));
expect('dashboard dark text uses theme variable', /html\[data-theme="dark"\] body\.dashboardBody\{color:var\(--text\)/.test(completion));
expect('legacy print body leak is neutralised', dashboard.includes('body{font-family:Inter,Arial,sans-serif;margin:28px') && completion.includes('body.dashboardBody'));
expect('partner network uses explicit non-overlapping grid', /#partners>\.grid2\{[\s\S]*grid-template-columns:minmax/.test(completion));
expect('partner network collapses on tablet', /@media\(max-width:980px\)[\s\S]*#partners>\.grid2\{grid-template-columns:1fr!important/.test(completion));

expect('partner network pages use one uniform page contract', (partnerNetwork.match(/class="section adminNetworkPage"/g) || []).length === 6 && partnerNetwork.includes('class="section adminNetworkPage" id="<%= page.id %>"'));
expect('partner network data areas use one card contract', (partnerNetwork.match(/adminNetworkDataCard/g) || []).length >= 6 && (partnerNetwork.match(/adminNetworkTableWrap/g) || []).length >= 6);
expect('partner network cards are statically separated', completion.includes('.adminNetworkPage.is-open') && completion.includes('clear:both!important') && completion.includes('grid-template-rows:auto minmax(0,1fr)!important'));
expect('phone dashboard outer gutter is compact', /\.dashboardBody \.app\{width:calc\(100% - 8px\)!important/.test(completion));
expect('phone sidebar aligns to same gutter', /\.dashboardBody \.sidebar\{width:calc\(100vw - 8px\)!important/.test(completion));
expect('focused controls retain the approved neutral state', /Restore the approved neutral input state/.test(completion) && /focus-within\{[\s\S]*border-color:var\(--line2,var\(--line\)\)!important;[\s\S]*box-shadow:none!important/.test(completion) && !/light-blue active field state/.test(completion));
expect('auth error flash has dark and light contrast', completion.includes('.authPage .flashMessage.error') && completion.includes('html[data-theme="light"] .authPage .flashMessage.error'));
expect('invalid credentials create flash', authController.includes("req.flash('error', 'The email, phone number, or password is incorrect."));
expect('query login errors render human-readable feedback', authController.includes('function authQueryMessage'));
expect('account lock and pending states create flash', authController.includes("error.code === 'account_locked'") && authController.includes("error.code === 'account_pending'"));
expect('auth limiter gives browser flash feedback', rateLimit.includes('safeRateLimitRedirect') && rateLimit.includes("req.flash('error', message)"));
expect('login identity and lockout reads run concurrently', /const \[failed, user\] = await Promise\.all/.test(authService));
expect('session account checks use short GET cache', accountState.includes('authCheckedAt') && accountState.includes('60_000'));
expect('dashboard snapshot has ttl cache', snapshot.includes('SNAPSHOT_TTL_MS') && snapshot.includes('snapshotInflight'));
expect('dashboard snapshot uses stale while revalidate', snapshot.includes('Stale-while-revalidate'));
expect('web startup avoids blocking read-model pressure and warms public cache after listen', mongoDashboard.includes('prewarmForUser')
  && !server.includes("dashboardSnapshotService.prewarm('admin')")
  && server.includes('schedulePublicCatalogWarmup')
  && server.indexOf('app.listen') < server.indexOf('schedulePublicCatalogWarmup();')
  && !server.includes('restoreLegacyDemotedBusListings'));
expect('login audits write in parallel', /await Promise\.all\(\[[\s\S]*securityRepository\.loginAudits\.save/.test(security));
expect('notification panel follows active theme', notifications.includes('background:var(--panel') && notifications.includes('color:var(--text'));
expect('successful writes invalidate affected dashboard snapshots',
  flashMiddleware.includes('invalidateDashboardMutation')
  && flashMiddleware.includes('snapshotService.invalidate(role')
  && flashMiddleware.includes("snapshotService.invalidate('admin'"));
expect('slow requests expose timing and diagnostics', app.includes('Server-Timing') && app.includes("logger').warn('Slow request"));
expect('dashboard cache settings are documented', envExample.includes('DASHBOARD_SNAPSHOT_TTL_MS') && envExample.includes('DASHBOARD_SNAPSHOT_STALE_MS'));

const failed = checks.filter((check) => !check.ok);
checks.forEach((check) => console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}`));
console.log(`Deep cleanup checks: ${checks.length - failed.length}/${checks.length}`);
if (failed.length) process.exit(1);
