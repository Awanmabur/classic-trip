const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const checks = [];
const check = (name, ok) => checks.push({ name, ok: Boolean(ok) });

const manifest = JSON.parse(read('public/site.webmanifest'));
const pwa = read('public/js/pwa.js');
const sw = read('public/sw.js');
const app = read('src/app.js');
const pwaCss = read('public/css/pwa.css');

check('manifest is standalone', manifest.display === 'standalone');
check('manifest has root scope', manifest.scope === '/');
check('manifest has start URL', typeof manifest.start_url === 'string' && manifest.start_url.startsWith('/'));
check('192 icon exists', exists('public/images/logo-symbol-192.png'));
check('512 icon exists', exists('public/images/logo-symbol-512.png'));
check('apple touch icon exists', exists('public/images/apple-touch-icon.png'));
check('service worker cache version bumped', sw.includes('classic-trip-static-v1.4.0'));
check('PWA CSS is pre-cached', sw.includes("'/css/pwa.css'"));
check('service worker served no-cache', app.includes("app.get('/sw.js'") && app.includes("Service-Worker-Allowed"));
check('manifest served with manifest MIME', app.includes("app.get('/site.webmanifest'") && app.includes('application/manifest+json'));
check('service worker bypasses HTTP cache', pwa.includes("updateViaCache: 'none'"));
check('native beforeinstallprompt supported', pwa.includes("beforeinstallprompt"));
check('native prompt updates visible card', pwa.includes('if (promptElement) updatePrompt()'));
check('insecure phone context explains HTTPS requirement', pwa.includes("state === 'insecure'") && pwa.includes('HTTPS'));
check('iOS manual steps included', pwa.includes('Add to Home Screen'));
check('Android manual steps included', pwa.includes('Install app') && pwa.includes('android-manual'));
check('install card shows without native event', pwa.includes('AUTO_PROMPT_DELAY_MS') && pwa.includes('createPrompt()'));
check('dismissal is limited to one day', pwa.includes('24 * 60 * 60 * 1000'));
check('profile install action clears previous dismissal', pwa.includes('clearDismissal();\n      createPrompt({ force: true })'));
check('PWA status API exists', pwa.includes('status: () =>'));
check('PWA install card has responsive CSS', pwaCss.includes('@media(max-width:760px)'));

for (const view of [
  'src/views/partials/site-head.ejs',
  'src/views/pages/home.ejs',
  'src/views/pages/auth/login.ejs',
  'src/views/dashboards/shared/workspace.ejs',
  'src/views/pages/auth/reset-password.ejs',
  'src/views/pages/auth/phone-verification.ejs',
  'src/views/pages/invite-accept.ejs',
]) {
  const source = read(view);
  check(`${view} loads manifest`, source.includes('/site.webmanifest'));
  check(`${view} loads PWA script`, source.includes('/js/pwa.js?v='));
  check(`${view} loads scoped PWA CSS`, source.includes('/css/pwa.css?v='));
}

const failed = checks.filter((item) => !item.ok);
checks.forEach((item) => console.log(`${item.ok ? '✓' : '✗'} ${item.name}`));
if (failed.length) {
  console.error(`PWA install audit failed: ${failed.length}/${checks.length}`);
  process.exit(1);
}
console.log(`PWA install audit passed: ${checks.length}/${checks.length}`);
