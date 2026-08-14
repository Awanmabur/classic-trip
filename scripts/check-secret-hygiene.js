'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const failures = [];
const passes = [];

function pass(label) { passes.push(label); console.log(`✓ ${label}`); }
function fail(label, detail = '') { failures.push(detail ? `${label}: ${detail}` : label); console.error(`✗ ${label}${detail ? ` — ${detail}` : ''}`); }
function exists(rel) { return fs.existsSync(path.join(root, rel)); }
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

function isLocalEnvFile(rel = '') {
  return /^\.env(?:\.(?:local|production|development|test))?$/.test(String(rel));
}
function gitIgnored(rel) {
  if (!exists('.git')) return false;
  const result = spawnSync('git', ['check-ignore', '-q', '--', rel], { cwd: root });
  return result.status === 0;
}

const forbiddenReleaseFiles = [
  '.env', '.env.local', '.env.production', '.env.development', '.env.test',
  'credentials.json', 'service-account.json',
];
const forbiddenNamePatterns = [/(^|\/)[^/]+\.(?:pem|key|p12|pfx)$/i, /(^|\/)(?:credentials|service-account)[^/]*\.json$/i];

const releaseFindings = [];
function walk(dir, rel = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (['node_modules', '.git', 'seed-output'].includes(entry.name)) continue;
    if (entry.isDirectory()) walk(path.join(dir, entry.name), nextRel);
    else if (forbiddenReleaseFiles.includes(nextRel) || forbiddenNamePatterns.some((rx) => rx.test(nextRel))) {
      const localIgnoredEnv = isLocalEnvFile(nextRel) && exists('.git') && gitIgnored(nextRel);
      if (!localIgnoredEnv) releaseFindings.push(nextRel);
    }
  }
}
walk(root);
if (!releaseFindings.length) pass('release package contains no private env/key/credential files (ignored local .env is allowed)');
else fail('release package contains no private env/key/credential files', releaseFindings.join(', '));

const gitignore = read('.gitignore');
const requiredIgnores = ['.env', 'seed-output/', '*.pem', '*.key', '*.p12', '*.pfx'];
const missingIgnores = requiredIgnores.filter((item) => !gitignore.includes(item));
if (!missingIgnores.length) pass('Git ignores env files, generated credentials, and private-key formats');
else fail('Git ignores env files, generated credentials, and private-key formats', `missing: ${missingIgnores.join(', ')}`);

const HIGH_CONFIDENCE_SECRET_PATTERNS = [
  { name: 'private key block', rx: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: 'GitHub token', rx: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/ },
  { name: 'Google API key', rx: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { name: 'AWS access key', rx: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Slack token', rx: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { name: 'Stripe live key', rx: /\bsk_live_[0-9A-Za-z]{16,}\b/ },
  { name: 'MongoDB URI with embedded credentials', rx: /mongodb(?:\+srv)?:\/\/[^\s:@/]+:[^\s@/]+@[^\s'"`]+/i },
];

function likelyTextFile(rel) {
  return /\.(?:js|cjs|mjs|json|ejs|md|txt|yml|yaml|env|example|css|html|xml|toml|ini|sh|ps1)$/i.test(rel)
    || ['Procfile', '.gitignore', '.npmignore', '.slugignore', '.dockerignore'].includes(path.basename(rel));
}

const sourceLeaks = [];
function scanSource(dir, rel = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (['node_modules', '.git', 'seed-output'].includes(entry.name)) continue;
    if (entry.isDirectory()) { scanSource(path.join(dir, entry.name), nextRel); continue; }
    if (!likelyTextFile(nextRel) || nextRel === '.env.example' || nextRel === 'scripts/check-secret-hygiene.js' || isLocalEnvFile(nextRel)) continue;
    let text = '';
    try { text = fs.readFileSync(path.join(root, nextRel), 'utf8'); } catch (_) { continue; }
    for (const pattern of HIGH_CONFIDENCE_SECRET_PATTERNS) if (pattern.rx.test(text)) sourceLeaks.push(`${nextRel} (${pattern.name})`);
  }
}
scanSource(root);
if (!sourceLeaks.length) pass('source tree contains no high-confidence hard-coded secrets');
else fail('source tree contains no high-confidence hard-coded secrets', sourceLeaks.slice(0, 20).join(', '));

const browserRoots = ['public', 'src/views'];
const forbiddenBrowserNames = /\b(?:MONGO_URI|SESSION_SECRET|DATA_ENCRYPTION_KEY|MFA_ENCRYPTION_KEY|PESAPAL_CONSUMER_SECRET|CLOUDINARY_API_SECRET|PAYMENT_WEBHOOK_SECRET|VAPID_PRIVATE_KEY)\b/;
const browserLeaks = [];
for (const browserRoot of browserRoots) {
  const start = path.join(root, browserRoot);
  if (!fs.existsSync(start)) continue;
  (function browserWalk(dir, rel = browserRoot) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const nextRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) browserWalk(path.join(dir, entry.name), nextRel);
      else if (likelyTextFile(nextRel)) {
        const text = fs.readFileSync(path.join(root, nextRel), 'utf8');
        if (forbiddenBrowserNames.test(text)) browserLeaks.push(nextRel);
      }
    }
  })(start);
}
if (!browserLeaks.length) pass('browser-facing assets/templates expose no server secret variable names');
else fail('browser-facing assets/templates expose no server secret variable names', browserLeaks.join(', '));

if (exists('.git')) {
  const tracked = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (tracked.status !== 0) fail('Git tracked-file secret check runs successfully', tracked.stderr.trim());
  else {
    const badTracked = tracked.stdout.split(/\r?\n/).filter(Boolean).filter((name) => forbiddenReleaseFiles.includes(name) || forbiddenNamePatterns.some((rx) => rx.test(name)));
    if (!badTracked.length) pass('Git does not currently track env/private-key/credential files');
    else fail('Git does not currently track env/private-key/credential files', badTracked.join(', '));
  }

  const historyNames = spawnSync('git', ['log', '--all', '--format=', '--name-only'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (historyNames.status !== 0) fail('Git history filename audit runs successfully', historyNames.stderr.trim());
  else {
    const historicBadNames = [...new Set(historyNames.stdout.split(/\r?\n/).filter(Boolean).filter((name) => forbiddenReleaseFiles.includes(name) || forbiddenNamePatterns.some((rx) => rx.test(name))))];
    if (!historicBadNames.length) pass('Git history contains no committed env/private-key/credential filenames');
    else fail('Git history contains no committed env/private-key/credential filenames', `${historicBadNames.join(', ')}. Purge with git filter-repo/BFG and rotate exposed credentials.`);
  }

  const history = spawnSync('git', ['log', '--all', '-p', '--no-ext-diff', '--no-color', '--', '.', ':(exclude)package-lock.json'], { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  if (history.status !== 0) fail('Git history secret-content audit runs successfully', (history.stderr || '').trim() || `exit ${history.status}`);
  else {
    const historicSecrets = HIGH_CONFIDENCE_SECRET_PATTERNS.filter((pattern) => pattern.rx.test(history.stdout)).map((pattern) => pattern.name);
    if (!historicSecrets.length) pass('Git history contains no high-confidence secret values');
    else fail('Git history contains no high-confidence secret values', `${historicSecrets.join(', ')}. Purge history and rotate the affected credentials before launch.`);
  }
} else {
  pass('Git-history audit skipped in clean production archive (no .git directory shipped)');
}

if (failures.length) {
  console.error(`\nSecret hygiene validation failed (${failures.length} issue${failures.length === 1 ? '' : 's'}).`);
  process.exit(1);
}
console.log(`\nSecret hygiene checks passed (${passes.length}/${passes.length}).`);
