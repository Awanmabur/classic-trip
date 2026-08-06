'use strict';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeFallback(value) {
  return clean(value)
    .replace(/\s+(?:to|→|->|↔|⇄)\s+/gi, ' ⇄ ')
    .replace(/\s*⇄\s*/g, ' ⇄ ');
}

function formatRouteLabel(origin, destination, fallback = '') {
  const from = clean(origin);
  const to = clean(destination);
  if (from && to) return `${from} ⇄ ${to}`;
  return normalizeFallback(fallback || from || to);
}

module.exports = { formatRouteLabel, normalizeFallback };
