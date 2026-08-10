'use strict';
const fs = require('fs');
function read(file){ return fs.readFileSync(file,'utf8'); }
let passed=0; function check(name, ok){ if(!ok){ console.error('FAIL:',name); process.exitCode=1; } else { passed++; console.log('PASS:',name); } }
const controller=read('src/controllers/public/partnerController.js');
const validator=read('src/validators/partnerValidator.js');
const auth=read('src/services/auth/authService.js');
const login=read('src/controllers/auth/authController.js');
check('partner currency derives from country server-side', validator.includes('currencyForCountry(req.body.country)') && validator.includes('req.body.operatingCurrency = derived'));
check('partner failures preserve form draft', controller.includes('partnerFormDraft = partnerDraft(req.body)'));
check('partner failures have partner-specific logging', controller.includes("logger.error('Partner onboarding failed'"));
check('partner controller owns all onboarding errors', controller.includes("return redirectToPartnerForm(res, error.code || 'partner_signup_failed')"));
check('session regeneration cannot fake signup failure', controller.includes('Partner signup succeeded but session regeneration failed') && controller.includes('const signedIn = await establishPartnerSession'));
check('successful signup can fall back to login', controller.includes("'/login?created=partner#login'"));
check('partner draft restores after redirect', login.includes('req.session?.partnerFormDraft') && login.includes('...partnerDraft'));
check('verification review is recoverable', auth.includes('Partner verification review initialization deferred'));
check('registration audit is recoverable', auth.includes('Partner registration audit initialization deferred'));
check('wallet initialization is recoverable', auth.includes('Partner wallet initialization deferred') && auth.includes("walletService.getOrCreateWallet('company', company.id, company.operatingCurrency)"));
if(!process.exitCode) console.log(`v1.6.39 partner signup checks passed (${passed}/10).`);
