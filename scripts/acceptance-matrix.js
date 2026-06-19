const acceptanceMatrix = require('../tests/acceptance/masterAcceptanceMatrix');

const rows = acceptanceMatrix.map((item) => ({
  id: item.id,
  section: item.section,
  criterion: item.criterion,
  evidence: item.evidence.join(', '),
}));

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), total: rows.length, rows }, null, 2));
