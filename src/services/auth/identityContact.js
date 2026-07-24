function cleanEmail(value = '') {
  return String(value || '').trim().toLowerCase().slice(0, 254);
}

function cleanPhone(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const hasInternationalPrefix = raw.startsWith('+') || raw.startsWith('00');
  const digits = raw.replace(/\D/g, '').slice(0, 15);
  if (!digits) return '';
  if (raw.startsWith('00')) return `+${digits.slice(2)}`;
  return hasInternationalPrefix ? `+${digits}` : digits;
}

function phoneVariants(value = '') {
  const normalized = cleanPhone(value);
  if (!normalized) return [];
  const variants = new Set([normalized]);
  const digits = normalized.replace(/\D/g, '');
  if (normalized.startsWith('+')) {
    variants.add(`00${digits}`);
    variants.add(digits);
  } else if (normalized.startsWith('00')) {
    variants.add(`+${digits.slice(2)}`);
  }
  return [...variants].filter(Boolean);
}

function identityLookup(identity = '') {
  const raw = String(identity || '').trim();
  if (!raw) return { email: '', phones: [] };
  if (raw.includes('@')) return { email: cleanEmail(raw), phones: [] };
  return { email: '', phones: phoneVariants(raw) };
}

module.exports = { cleanEmail, cleanPhone, phoneVariants, identityLookup };
