module.exports = function paginate(items, page = 1, limit = 12) {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.max(Number(limit) || 12, 1);
  const total = items.length;
  const pages = Math.max(Math.ceil(total / safeLimit), 1);
  const start = (safePage - 1) * safeLimit;
  return { items: items.slice(start, start + safeLimit), page: safePage, limit: safeLimit, total, pages };
};
