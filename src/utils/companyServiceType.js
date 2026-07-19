// Some signup entry points historically submitted human-readable labels ("Bus company",
// "Hotel / apartments", "Airline") instead of the canonical service-type keys the rest of
// the platform keys off ('bus', 'hotel', 'flight', ...). That mismatch silently fell through
// to the generic "partner" dashboard, and separately caused listing/route/vehicle creation to
// be rejected with "This company account can only create or edit <raw label> service records."
// The forms are fixed to submit canonical keys directly now, but this keyword match is kept
// as a safety net for old records and any other free-text entry point. Shared by every place
// that needs to compare a company's declared type against a canonical service key.
const COMPANY_TYPE_KEYWORD_MAP = [
  ['bus', 'bus'], ['coach', 'bus'],
  ['hotel', 'hotel'], ['apartment', 'hotel'], ['stay', 'hotel'],
  ['airline', 'flight'], ['flight', 'flight'],
  ['train', 'train'],
  ['tour', 'tour'],
  ['car rental', 'car_rental'], ['car_rental', 'car_rental'],
  ['ferry', 'ferry'], ['boat', 'ferry'],
  ['event', 'event'],
  ['cargo', 'cargo'],
  ['insurance', 'insurance'],
];

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeCompanyType(raw) {
  const value = normalize(raw);
  if (!value) return value;
  const match = COMPANY_TYPE_KEYWORD_MAP.find(([keyword]) => value.includes(keyword));
  return match ? match[1] : value.replace(/[\s-]+/g, '_');
}

module.exports = { normalizeCompanyType, COMPANY_TYPE_KEYWORD_MAP };
