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

function cleanMeta(meta = {}) {
  return Object.fromEntries(Object.entries(meta || {}).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

function prettyLine(level, message, meta = {}) {
  const values = cleanMeta(meta);
  const suffix = Object.entries(values)
    .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`)
    .join(' ');
  const symbol = level === 'error' ? '✖' : level === 'warn' ? '!' : level === 'debug' ? '·' : '✓';
  return `${symbol} ${message}${suffix ? ` — ${suffix}` : ''}`;
}

function write(level, message, meta = {}, { force = false } = {}) {
  if (!force && !shouldLog(level)) return;
  const productionJson = process.env.NODE_ENV === 'production' && !flag('LOG_PRETTY', false);
  const line = productionJson
    ? JSON.stringify({ time: new Date().toISOString(), level, message, ...cleanMeta(meta) })
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
};
