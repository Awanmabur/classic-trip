const LEVELS = Object.freeze({ error: 0, warn: 1, info: 2, debug: 3 });

function flag(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function currentLevel() {
  const configured = String(process.env.LOG_LEVEL || '').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(LEVELS, configured)) return configured;
  return process.env.NODE_ENV === 'production' ? 'info' : 'warn';
}

function shouldLog(level) {
  return LEVELS[level] <= LEVELS[currentLevel()];
}

const SECRET_LOG_KEY_PARTS = ['password', 'secret', 'token', 'authorization', 'cookie', 'apikey', 'consumerkey', 'privatekey', 'webhooksecret', 'sessionsecret', 'encryptionkey', 'mongouri', 'redisurl', 'redisuri', 'connectionstring', 'identitynumber', 'documentnumber', 'nationalid', 'licencenumber', 'passportnumber', 'accountnumber'];

function secretLogKey(key = '') {
  const normalized = String(key || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  return SECRET_LOG_KEY_PARTS.some((part) => normalized.includes(part));
}

function redactString(value) {
  return String(value || '')
    // Authorization headers/tokens embedded in free-form messages.
    .replace(/(bearer\s+)[A-Za-z0-9._~+\/-]+/ig, '$1[REDACTED]')
    .replace(/((?:authorization|proxy-authorization)\s*[:=]\s*)(?!\[REDACTED\])[^\r\n,;]+/ig, '$1[REDACTED]')
    // Cookie headers may contain session identifiers and CSRF state. Redact the full value.
    .replace(/((?:set-cookie|cookie)\s*[:=]\s*)(?!\[REDACTED\])[^\r\n]+/ig, '$1[REDACTED]')
    // Common secret-bearing query/body/log assignments such as token=, password:, api_key=, etc.
    .replace(/((?:password|passwd|pwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|consumer[_-]?secret|client[_-]?secret|webhook[_-]?secret|signature|session[_-]?secret|encryption[_-]?key)\s*[=:]\s*)(?!\[REDACTED\])([^&\s,;}]+)/ig, '$1[REDACTED]')
    .replace(/([?&](?:password|passwd|pwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|consumer[_-]?secret|client[_-]?secret|webhook[_-]?secret|signature|session[_-]?secret|encryption[_-]?key)=)(?!%5Bredacted%5D|\[REDACTED\])[^&#\s]*/ig, '$1[REDACTED]')
    // Basic-auth style credentials embedded in URLs, including mongodb/redis/http URLs.
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s@/]+@/ig, '$1[REDACTED]@');
}

function sanitizeLogValue(value, key = '', depth = 0, seen = new WeakSet()) {
  if (secretLogKey(key)) return '[REDACTED]';
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object' || depth > 8) return value;
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeLogValue(item, '', depth + 1, seen));
  const clean = {};
  for (const [nestedKey, nestedValue] of Object.entries(value)) clean[nestedKey] = sanitizeLogValue(nestedValue, nestedKey, depth + 1, seen);
  return clean;
}

function cleanMeta(meta = {}) {
  return Object.fromEntries(Object.entries(meta || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => [key, sanitizeLogValue(value, key)]));
}

function prettyLine(level, message, meta = {}) {
  const safeMessage = redactString(message);
  const values = cleanMeta(meta);
  const suffix = Object.entries(values)
    .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`)
    .join(' ');
  const symbol = level === 'error' ? '✖' : level === 'warn' ? '!' : level === 'debug' ? '·' : '✓';
  return `${symbol} ${safeMessage}${suffix ? ` — ${suffix}` : ''}`;
}

function write(level, message, meta = {}, { force = false } = {}) {
  if (!force && !shouldLog(level)) return;
  const productionJson = process.env.NODE_ENV === 'production' && !flag('LOG_PRETTY', false);
  const safeMessage = redactString(message);
  const line = productionJson
    ? JSON.stringify({ time: new Date().toISOString(), level, message: safeMessage, ...cleanMeta(meta) })
    : prettyLine(level, message, meta);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

module.exports = {
  startup: (message, meta) => write('info', message, meta, { force: true }),
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta, { force: true }),
  debug: (message, meta) => write('debug', message, meta),
  sanitizeLogValue,
};
