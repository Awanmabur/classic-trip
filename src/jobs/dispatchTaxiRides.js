'use strict';
const taxiDispatchService = require('../modules/taxi/services/taxiDispatchService');
async function run() {
  const results = await taxiDispatchService.dispatchDueRides(150);
  return {
    checked: results.length,
    offered: results.filter((row) => Array.isArray(row.assignments) && row.assignments.length).length,
    waitingForDriver: results.filter((row) => row.noDriver).length,
    failed: results.filter((row) => row.error).length,
  };
}
module.exports = { run };
