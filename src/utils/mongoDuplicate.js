function duplicateKeyFields(error = {}) {
  if (Number(error?.code) !== 11000) return [];
  const fields = new Set();
  Object.keys(error.keyPattern || {}).forEach((field) => fields.add(field));
  Object.keys(error.keyValue || {}).forEach((field) => fields.add(field));
  const message = String(error.message || '');
  const indexMatch = message.match(/index:\s+([^\s]+)\s+dup key/i);
  if (indexMatch?.[1]) {
    String(indexMatch[1]).split('_').forEach((part, index, parts) => {
      if (index % 2 === 0 && parts[index + 1] && /^-?1$/.test(parts[index + 1])) fields.add(part);
    });
  }
  return [...fields].filter(Boolean);
}

function isDuplicateKey(error, ...fields) {
  const duplicates = duplicateKeyFields(error);
  if (!duplicates.length) return Number(error?.code) === 11000 && fields.length === 0;
  return fields.some((field) => duplicates.includes(field));
}

module.exports = { duplicateKeyFields, isDuplicateKey };
