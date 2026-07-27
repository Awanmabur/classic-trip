'use strict';

const HOME_GROUPS = new Set(['bus', 'hotel', 'flight', 'local_transport', 'tour', 'car_rental', 'cargo']);

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function publicCatalogGroup(serviceType, rawGroup = '') {
  const service = normalize(serviceType);
  if (HOME_GROUPS.has(service)) return service;
  const group = normalize(rawGroup);
  if (HOME_GROUPS.has(group)) return group;
  return '';
}

module.exports = { publicCatalogGroup };
