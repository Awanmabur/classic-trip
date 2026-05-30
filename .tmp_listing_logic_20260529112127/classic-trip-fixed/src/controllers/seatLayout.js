/**
 * Generate simple bus layouts.
 * - 2x2: [A,B] aisle [C,D]
 * - 2x3: [A,B] aisle [C,D,E]
 *
 * Returns: { cols, seats, totalSeats }
 */
function seatId(rowIdx, seatIdx) {
  const rowLetter = String.fromCharCode(65 + rowIdx); // A,B,C...
  return rowLetter + String(seatIdx);
}

function generateBusLayout({ rows = 10, config = "2x2" }) {
  const r = Number(rows || 0);
  if (r < 1) throw new Error("rows must be >= 1");

  const seats = [];
  let cols = 0;

  if (config === "2x2") {
    cols = 5;
    for (let i = 0; i < r; i++) {
      seats.push({ id: seatId(i, 1), row: i + 1, col: 1 });
      seats.push({ id: seatId(i, 2), row: i + 1, col: 2 });
      seats.push({ id: `AISLE-${i + 1}`, row: i + 1, col: 3, isAisle: true });
      seats.push({ id: seatId(i, 3), row: i + 1, col: 4 });
      seats.push({ id: seatId(i, 4), row: i + 1, col: 5 });
    }
  } else if (config === "2x3") {
    cols = 6;
    for (let i = 0; i < r; i++) {
      seats.push({ id: seatId(i, 1), row: i + 1, col: 1 });
      seats.push({ id: seatId(i, 2), row: i + 1, col: 2 });
      seats.push({ id: `AISLE-${i + 1}`, row: i + 1, col: 3, isAisle: true });
      seats.push({ id: seatId(i, 3), row: i + 1, col: 4 });
      seats.push({ id: seatId(i, 4), row: i + 1, col: 5 });
      seats.push({ id: seatId(i, 5), row: i + 1, col: 6 });
    }
  } else {
    throw new Error("Unknown bus layout config");
  }

  const totalSeats = seats.filter((s) => !s.isAisle && !s.isDisabled).length;
  return { cols, seats, totalSeats };
}

module.exports = { generateBusLayout };
