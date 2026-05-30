function generateBusLayout({ rows, config }) {
  const left = ["A", "B"];
  const right = config === "2x3" ? ["C", "D", "E"] : ["C", "D"];
  const cols = left.length + 1 + right.length;

  const seats = [];
  for (let r = 1; r <= rows; r++) {
    let colIndex = 1;

    for (const letter of left) {
      const seatId = `${r}${letter}`;
      seats.push({
        seatId,
        row: r,
        col: colIndex,
        label: seatId,
        isAisle: letter === left[left.length - 1],
        isWindow: letter === left[0],
        isDisabled: false,
        class: "standard"
      });
      colIndex++;
    }

    colIndex++; // aisle

    for (const letter of right) {
      const seatId = `${r}${letter}`;
      seats.push({
        seatId,
        row: r,
        col: colIndex,
        label: seatId,
        isAisle: letter === right[0],
        isWindow: letter === right[right.length - 1],
        isDisabled: false,
        class: "standard"
      });
      colIndex++;
    }
  }

  return { seats, cols, totalSeats: seats.length };
}

module.exports = { generateBusLayout };
