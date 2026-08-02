#!/usr/bin/env node
'use strict';

const {
  cleanCreateOptions,
  conflictingIndexes,
  desiredDescriptor,
  equivalentIndex,
  existingDescriptor,
} = require('./lib/index-reconciler');

const checks = [];
function check(label, condition) {
  if (!condition) throw new Error(label);
  checks.push(label);
}

const listingDesired = desiredDescriptor(
  { title: 'text', city: 'text', from: 'text', to: 'text', companyName: 'text' },
  { name: 'listing_search_text_v2' },
);
const oldListingText = {
  name: 'title_text',
  key: { _fts: 'text', _ftsx: 1 },
  weights: { title: 1 },
  default_language: 'english',
  language_override: 'language',
};
const currentListingText = {
  name: 'legacy_equivalent_name',
  key: { _fts: 'text', _ftsx: 1 },
  weights: { title: 1, city: 1, from: 1, to: 1, companyName: 1 },
  default_language: 'english',
  language_override: 'language',
};

check(
  'old single-field text index is detected as conflicting',
  conflictingIndexes(listingDesired, [oldListingText]).some((index) => index.name === 'title_text'),
);
check(
  'equivalent compound text index is accepted regardless of its historical name',
  equivalentIndex(listingDesired, existingDescriptor(currentListingText)),
);

const blogDesired = desiredDescriptor(
  { id: 1 },
  { name: 'blogpost_external_id_unique', unique: true, sparse: true },
);
const oldBlogIndex = { name: 'id_1', key: { id: 1 } };
check(
  'non-unique legacy blog ID index is replaced before creating the unique index',
  conflictingIndexes(blogDesired, [oldBlogIndex]).some((index) => index.name === 'id_1'),
);

const cleaned = cleanCreateOptions({ name: 'example', background: true, unique: true });
check('deprecated background option is not sent to MongoDB', cleaned.background === undefined && cleaned.unique === true);

console.log(`Index reconciliation checks passed (${checks.length}/${checks.length}).`);
