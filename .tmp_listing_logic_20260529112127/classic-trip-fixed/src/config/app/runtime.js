const startedAt = new Date();
let shuttingDown = false;

function markShuttingDown(value = true) {
  shuttingDown = Boolean(value);
}

function isShuttingDown() {
  return shuttingDown;
}

function getStartedAt() {
  return startedAt;
}

module.exports = {
  getStartedAt,
  isShuttingDown,
  markShuttingDown
};
