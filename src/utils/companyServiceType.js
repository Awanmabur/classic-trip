'use strict';
const { SERVICE_REGISTRY, normalizeServiceType } = require('../config/serviceRegistry');
const COMPANY_TYPE_KEYWORD_MAP = Object.freeze(Object.keys(SERVICE_REGISTRY).map((key) => [key, key]));
function normalizeCompanyType(raw) { return normalizeServiceType(raw); }
module.exports = { normalizeCompanyType, COMPANY_TYPE_KEYWORD_MAP };
