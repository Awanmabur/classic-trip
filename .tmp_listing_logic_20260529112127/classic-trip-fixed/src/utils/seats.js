function uniqueSeatIds(seats) {
  const seen = new Set();
  const out = [];

  for (const seat of Array.isArray(seats) ? seats : []) {
    const id = String(seat || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }

  return out;
}

function normalizeSeatCell(seat) {
  const id = String(seat?.id || seat?.seatId || seat?.label || "").trim();
  const row = Number(seat?.row);
  const col = Number(seat?.col);

  if (!id || !Number.isFinite(row) || row < 1 || !Number.isFinite(col) || col < 1) {
    const err = new Error("Each seat must include a valid id, row, and col.");
    err.statusCode = 400;
    throw err;
  }

  return {
    id,
    row,
    col,
    isAisle: Boolean(seat?.isAisle),
    isDisabled: Boolean(seat?.isDisabled),
    label: String(seat?.label || id).trim() || id
  };
}

function normalizeSeatCells(seats) {
  const seen = new Set();
  const normalized = [];

  for (const seat of Array.isArray(seats) ? seats : []) {
    const item = normalizeSeatCell(seat);
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    normalized.push(item);
  }

  return normalized;
}

function getBookableSeatIds(seats) {
  return new Set(
    normalizeSeatCells(seats)
      .filter((seat) => !seat.isAisle && !seat.isDisabled)
      .map((seat) => seat.id)
  );
}

module.exports = {
  uniqueSeatIds,
  normalizeSeatCell,
  normalizeSeatCells,
  getBookableSeatIds
};
