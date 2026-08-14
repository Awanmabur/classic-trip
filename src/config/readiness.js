'use strict';

const state = {
  publicDiscoveryReady: false,
  publicDiscoveryDegraded: false,
  publicDiscoveryStartedAt: 0,
  publicDiscoveryCompletedAt: 0,
  publicDiscoveryError: '',
};

function beginPublicDiscoveryWarmup() {
  if (!state.publicDiscoveryStartedAt) state.publicDiscoveryStartedAt = Date.now();
}

function markPublicDiscoveryReady({ degraded = false, error = '' } = {}) {
  state.publicDiscoveryReady = true;
  state.publicDiscoveryDegraded = degraded === true;
  state.publicDiscoveryCompletedAt = Date.now();
  state.publicDiscoveryError = String(error || '').slice(0, 240);
}

function snapshot() {
  return { ...state };
}

module.exports = { beginPublicDiscoveryWarmup, markPublicDiscoveryReady, snapshot };
